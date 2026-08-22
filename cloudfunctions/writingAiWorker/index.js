"use strict";

const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");
const tcbApiCaller = require("@cloudbase/node-sdk/dist/utils/tcbapirequester");
const { CloudBase } = require("@cloudbase/node-sdk/dist/cloudbase");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const JOBS = "writing_ai_jobs";
const UPLOADS = "writing_photo_uploads";
const COMPOSITIONS = "writing_compositions";
const DISPATCH_LIMIT = 20;

function secretMatches(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function timerToken(event = {}) {
  if (event.token) return event.token;
  const message = event.Message;
  if (message && typeof message === "object") return message.token || "";
  if (typeof message !== "string") return "";
  try {
    const parsed = JSON.parse(message);
    if (parsed && typeof parsed === "object") return parsed.token || "";
    return typeof parsed === "string" ? parsed : message;
  } catch (error) {
    return message;
  }
}

function dateMs(value) {
  const result = value ? new Date(value).getTime() : 0;
  return Number.isFinite(result) ? result : 0;
}

async function invokeFunctionAsync(functionName, data) {
  const { TCB_ROUTE_KEY } = CloudBase.getCloudbaseContext();
  const result = await tcbApiCaller.request({
    config: app.config,
    params: {
      action: "functions.invokeFunction",
      function_name: functionName,
      async: true,
      request_data: JSON.stringify(data || {}),
    },
    method: "post",
    headers: {
      "content-type": "application/json",
      ...(TCB_ROUTE_KEY ? { "X-TCB-Route-Key": TCB_ROUTE_KEY } : {}),
    },
  });
  if (result && result.code) throw new Error("AI_JOB_DISPATCH_FAILED");
}

async function recoverExpiredLeases(now) {
  const result = await db.collection(JOBS).where({
    status: "processing", lease_until: db.command.lte(now),
  }).limit(DISPATCH_LIMIT).get();
  const expired = result.data || [];
  for (const job of expired) {
    try {
      await invokeFunctionAsync("writingTutor", {
        action: "processQueuedJob",
        job_id: job.job_id,
        dispatch_token: job.dispatch_token,
      });
    } catch (error) {
      console.error("writingAiWorker lease recovery failed", job.job_id, error && error.message);
    }
  }
  return expired.length;
}

async function dispatchQueued(now) {
  const result = await db.collection(JOBS).where({
    status: "queued", next_retry_at: db.command.lte(now),
  }).limit(DISPATCH_LIMIT).get();
  const ready = (result.data || []).filter((job) => job.job_id && job.dispatch_token);
  let dispatched = 0;
  for (const job of ready) {
    try {
      await invokeFunctionAsync("writingTutor", {
        action: "processQueuedJob",
        job_id: job.job_id,
        dispatch_token: job.dispatch_token,
      });
      dispatched += 1;
    } catch (error) {
      console.error("writingAiWorker dispatch failed", job.job_id, error && error.message);
    }
  }
  return dispatched;
}

async function cleanupExpiredPhotos(now) {
  const command = db.command;
  const results = await Promise.all(["uploading", "uploaded"].map((status) =>
    db.collection(UPLOADS).where({ status, expires_at: command.lte(now) }).limit(DISPATCH_LIMIT).get()));
  const expired = results.flatMap((result) => result.data || []);
  if (!expired.length) return 0;
  const fileList = expired.map((row) => row.file_id).filter(Boolean);
  if (fileList.length) {
    try {
      await app.deleteFile({ fileList });
    } catch (error) {
      console.error("writingAiWorker photo deletion deferred", error && error.message);
      return 0;
    }
  }
  await Promise.all(expired.map((row) => db.collection(UPLOADS).doc(row._id).update({
    status: "deleted", deleted_at: now, cleanup_error: null, updated_at: now,
  })));
  const operations = new Map();
  expired.forEach((row) => {
    if (!row.composition_id || !row.student_uid || !row.operation_id) return;
    operations.set(`${row.student_uid}:${row.composition_id}:${row.operation_id}`, row);
  });
  for (const row of operations.values()) {
    const result = await db.collection(COMPOSITIONS).where({
      composition_id: row.composition_id, student_uid: row.student_uid,
    }).limit(1).get();
    const composition = (result.data || [])[0];
    if (!composition || !composition.pending_upload
      || composition.pending_upload.operation_id !== row.operation_id) continue;
    const revisionScan = composition.pending_upload.kind === "revision_scan"
      || row.upload_kind === "revision_scan";
    const failedJob = {
      operation_id: row.operation_id,
      job_type: revisionScan ? "revision_ocr" : "ocr",
      status: "failed",
      error_code: "PHOTO_UPLOAD_EXPIRED",
      updated_at: now,
    };
    await db.collection(COMPOSITIONS).doc(composition._id).update(revisionScan ? {
      pending_upload: null,
      status: "revision_ocr_failed",
      active_job: failedJob,
      updated_at: now,
    } : {
      pending_upload: null,
      status: "ocr_failed",
      ocr_job: failedJob,
      updated_at: now,
    });
  }
  return expired.length;
}

exports.main = async (event = {}) => {
  try {
    if (!secretMatches(timerToken(event), process.env.WRITING_AI_WORKER_CRON_TOKEN)) {
      return { success: false, code: "WORKER_UNAUTHORIZED" };
    }
    const now = new Date();
    const recovered = await recoverExpiredLeases(now);
    const dispatched = await dispatchQueued(now);
    const photos_deleted = await cleanupExpiredPhotos(now);
    return { success: true, recovered, dispatched, photos_deleted };
  } catch (error) {
    console.error("writingAiWorker failed", error && error.message);
    return { success: false, code: error && error.message || "WRITING_AI_WORKER_ERROR" };
  }
};

exports._test = { dateMs, recoverExpiredLeases, dispatchQueued, cleanupExpiredPhotos };
