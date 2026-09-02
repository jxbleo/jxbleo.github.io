"use strict";

const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");
const { CloudBase } = require("@cloudbase/node-sdk/dist/cloudbase");
const tcbApiCaller = require("@cloudbase/node-sdk/dist/utils/tcbapirequester");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const SESSIONS = "vocabulary_scan_sessions";
const PAGES = "vocabulary_scan_pages";
const JOBS = "vocabulary_scan_jobs";
const ACTIVE = ["uploading", "queued", "processing", "review", "partial_failure", "committing"];
const TERMINAL = ["completed", "discarded", "expired"];
const MAX_BATCH = 50;
const MAX_PAGES = 5;

function now() { return new Date(); }
function dateMs(value) {
  const result = value ? new Date(value).getTime() : 0;
  return Number.isFinite(result) ? result : 0;
}
function secretMatches(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function timerToken(event = {}) {
  if (event.token) return event.token;
  const message = event.Message;
  if (message && typeof message === "object") return message.token || "";
  if (typeof message === "string") {
    try {
      const parsed = JSON.parse(message);
      return parsed && typeof parsed === "object" ? parsed.token || "" : parsed;
    } catch (_error) {
      return message;
    }
  }
  return event.cron_token || event.TCB_TIMER_TOKEN || "";
}
function isTimerEvent(event) {
  return !event || !event.Type || (event.Type === "Timer" && (!event.TriggerName || event.TriggerName === "vocabulary-scan-worker-minute"));
}

async function invoke(job) {
  const context = CloudBase.getCloudbaseContext();
  const routeKey = context && context.TCB_ROUTE_KEY;
  const result = await tcbApiCaller.request({
    config: app.config,
    params: {
      action: "functions.invokeFunction",
      function_name: "vocabularyScan",
      async: true,
      request_data: JSON.stringify({ action: "processQueuedPageJob", job_id: job.job_id, dispatch_token: job.dispatch_token }),
    },
    method: "post",
    headers: { "content-type": "application/json", ...(routeKey ? { "X-TCB-Route-Key": routeKey } : {}) },
  });
  if (result && result.code) throw new Error("SCAN_DISPATCH_FAILED");
}

async function clearStudentPointer(scan) {
  const result = await db.collection("students").where({ auth_uid: scan.student_uid }).limit(1).get();
  const student = result.data && result.data[0];
  if (student && student.active_vocabulary_scan_id === scan.scan_id) {
    await db.collection("students").doc(student._id).update({ active_vocabulary_scan_id: null });
  }
}

async function refundUnusedQuota(scan) {
  if (!scan.quota_reserved_at || scan.provider_call_started || scan.quota_refunded_at) return false;
  let refunded = false;
  await db.runTransaction(async (transaction) => {
    const scanResult = await transaction.collection(SESSIONS).where({ scan_id: scan.scan_id, student_uid: scan.student_uid }).limit(1).get();
    const current = scanResult.data && scanResult.data[0];
    if (!current || !current.quota_reserved_at || current.provider_call_started || current.quota_refunded_at) return;
    const studentResult = await transaction.collection("students").where({ auth_uid: scan.student_uid }).limit(1).get();
    const student = studentResult.data && studentResult.data[0];
    const at = now();
    await transaction.collection(SESSIONS).doc(current._id).update({ quota_refunded_at: at, updated_at: at });
    if (student && student.vocabulary_scan_usage_day === current.day_key) {
      await transaction.collection("students").doc(student._id).update({
        vocabulary_scan_count_today: Math.max(0, Number(student.vocabulary_scan_count_today || 0) - 1),
        vocabulary_scan_pages_today: Math.max(0, Number(student.vocabulary_scan_pages_today || 0) - Number(current.quota_reserved_pages || current.page_count || 0)),
      });
    }
    refunded = true;
  });
  return refunded;
}

async function cleanupScan(scan) {
  const rows = await db.collection(PAGES).where({ scan_id: scan.scan_id, student_uid: scan.student_uid }).limit(MAX_PAGES).get();
  const files = (rows.data || []).map((row) => row.file_id).filter(Boolean);
  if (files.length) {
    try {
      await app.deleteFile({ fileList: files });
    } catch (_error) {
      const at = now();
      await db.collection(SESSIONS).doc(scan._id).update({ cleanup_status: "error", cleanup_error: "PHOTO_DELETE_RETRY_REQUIRED", updated_at: at });
      for (const row of rows.data || []) {
        if (row.file_id) await db.collection(PAGES).doc(row._id).update({ cleanup_error: "PHOTO_DELETE_RETRY_REQUIRED", updated_at: at });
      }
      return false;
    }
  }
  const at = now();
  for (const row of rows.data || []) {
    await db.collection(PAGES).doc(row._id).update({ status: "deleted", file_id: null, cloud_path: null, cleanup_error: null, deleted_at: row.deleted_at || at, updated_at: at });
  }
  await db.collection(SESSIONS).doc(scan._id).update({ cleanup_status: "complete", cleanup_error: null, cleaned_at: at, updated_at: at });
  return true;
}

async function cleanupRemovedPage(page) {
  if (!page.file_id) return true;
  try {
    await app.deleteFile({ fileList: [page.file_id] });
  } catch (_error) {
    return false;
  }
  const at = now();
  await db.collection(PAGES).doc(page._id).update({ file_id: null, cloud_path: null, cleanup_error: null, deleted_at: page.deleted_at || at, updated_at: at });
  return true;
}

async function recoverExpiredLeases(at) {
  let recovered = 0;
  const result = await db.collection(JOBS).where({ status: "processing" }).orderBy("lease_until", "asc").limit(MAX_BATCH).get();
  for (const job of result.data || []) {
    if (!dateMs(job.lease_until) || dateMs(job.lease_until) > at) continue;
    await db.collection(JOBS).doc(job._id).update({ status: "queued", lease_token: null, lease_until: null, next_retry_at: new Date(at), updated_at: new Date(at) });
    recovered += 1;
  }
  return recovered;
}

async function dispatchDueJobs(at) {
  let dispatched = 0;
  const result = await db.collection(JOBS).where({ status: "queued" }).orderBy("next_retry_at", "asc").limit(MAX_BATCH).get();
  for (const job of result.data || []) {
    if (dateMs(job.next_retry_at) > at) continue;
    try {
      await invoke(job);
      dispatched += 1;
    } catch (_error) {
      // The durable queued record remains eligible for the next worker tick.
    }
  }
  return dispatched;
}

async function expireSessions(at) {
  let expired = 0;
  for (const status of ACTIVE) {
    const result = await db.collection(SESSIONS).where({ status }).orderBy("expires_at", "asc").limit(MAX_BATCH).get();
    for (const scan of result.data || []) {
      if (!dateMs(scan.expires_at) || dateMs(scan.expires_at) > at) continue;
      const changedAt = new Date(at);
      const jobs = await db.collection(JOBS).where({ scan_id: scan.scan_id, student_uid: scan.student_uid }).limit(MAX_PAGES).get();
      for (const job of jobs.data || []) {
        if (!["succeeded", "failed", "superseded"].includes(job.status)) {
          await db.collection(JOBS).doc(job._id).update({ status: "superseded", lease_token: null, lease_until: null, next_retry_at: null, updated_at: changedAt });
        }
      }
      await db.collection(SESSIONS).doc(scan._id).update({ status: "expired", candidates: [], cleanup_status: "pending", expired_at: changedAt, updated_at: changedAt });
      await clearStudentPointer(scan);
      await refundUnusedQuota({ ...scan, status: "expired" });
      expired += 1;
    }
  }
  return expired;
}

async function retryCleanup() {
  let cleaned = 0;
  let cleanupErrors = 0;
  for (const status of TERMINAL) {
    for (const cleanupStatus of ["pending", "error"]) {
      const result = await db.collection(SESSIONS).where({ status, cleanup_status: cleanupStatus }).orderBy("updated_at", "asc").limit(MAX_BATCH).get();
      for (const scan of result.data || []) {
        if (await cleanupScan(scan)) cleaned += 1;
        else cleanupErrors += 1;
      }
    }
  }
  const removed = await db.collection(PAGES).where({ status: "deleted", cleanup_error: "PHOTO_DELETE_RETRY_REQUIRED" }).limit(MAX_BATCH).get();
  for (const page of removed.data || []) {
    if (await cleanupRemovedPage(page)) cleaned += 1;
    else cleanupErrors += 1;
  }
  return { cleaned, cleanupErrors };
}

async function main(event = {}) {
  if (!isTimerEvent(event)) return { success: false, code: "WORKER_UNAUTHORIZED" };
  const supplied = timerToken(event);
  if (!secretMatches(supplied, process.env.VOCAB_SCAN_WORKER_CRON_TOKEN)) return { success: false, code: "WORKER_UNAUTHORIZED" };
  const at = Date.now();
  const recovered = await recoverExpiredLeases(at);
  const dispatched = await dispatchDueJobs(at);
  const expired = await expireSessions(at);
  const cleanupResult = await retryCleanup();
  return { success: true, recovered, dispatched, expired, cleaned: cleanupResult.cleaned, cleanup_errors: cleanupResult.cleanupErrors };
}

exports.main = main;
exports._test = { secretMatches, timerToken, isTimerEvent, dateMs };
