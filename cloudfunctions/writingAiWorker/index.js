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
const MODEL_USAGE_EVENTS = "writing_model_usage_events";
const EMAIL_EVENTS = "writing_teacher_email_events";
const DISPATCH_LIMIT = 20;
const TOKEN_AUDIT_LIMIT = 100;
const TOKEN_TELEMETRY_VERSION = "writing-token-usage-v1";

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

function stableId(prefix, ...parts) {
  const digest = crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 40);
  return `${prefix}_${digest}`;
}

function tokenSummary(events) {
  const rows = Array.isArray(events) ? events : [];
  const sum = (field) => rows.reduce((total, row) => total + (Number.isInteger(row && row[field]) ? row[field] : 0), 0);
  return {
    call_count: rows.length,
    recorded_call_count: rows.filter((row) => row && row.usage_status === "recorded").length,
    missing_call_count: rows.filter((row) => !row || row.usage_status !== "recorded").length,
    input_tokens: sum("input_tokens"),
    output_tokens: sum("output_tokens"),
    total_tokens: sum("total_tokens"),
    cached_input_tokens: sum("cached_input_tokens"),
    reasoning_output_tokens: sum("reasoning_output_tokens"),
  };
}

function tokenAuditReasons(job, events) {
  const summary = tokenSummary(events);
  const reasons = [];
  if (!summary.call_count) reasons.push("NO_MODEL_USAGE_EVENT");
  const groups = new Map();
  (Array.isArray(events) ? events : []).forEach((row) => {
    const key = `${Number(row && row.job_attempt || 0)}:${String(row && row.stage || "unknown")}`;
    const group = groups.get(key) || { expected: 0, indexes: new Set() };
    group.expected = Math.max(group.expected, Number(row && row.stage_call_count || 0));
    if (Number.isInteger(row && row.provider_call_index)) group.indexes.add(row.provider_call_index);
    groups.set(key, group);
  });
  if ([...groups.values()].some((group) => group.expected > group.indexes.size)) reasons.push("USAGE_EVENT_GAP");
  if (summary.missing_call_count) reasons.push("PROVIDER_USAGE_MISSING");
  if (job && job.token_usage_persistence_error === true) reasons.push("USAGE_EVENT_PERSISTENCE_FAILED");
  return { summary, reasons };
}

async function auditTokenUsage(now) {
  const result = await db.collection(JOBS).where({
    token_usage_audit_status: "pending",
  }).limit(TOKEN_AUDIT_LIMIT).get();
  const candidates = result.data || [];
  let audited = 0;
  let alerts = 0;
  for (const job of candidates) {
    if (job.telemetry_version !== TOKEN_TELEMETRY_VERSION) continue;
    if (job.status === "superseded") {
      await db.collection(JOBS).doc(job._id).update({
        token_usage_audit_status: "not_applicable", token_usage_audited_at: now,
      });
      audited += 1;
      continue;
    }
    if (!["succeeded", "failed"].includes(job.status)) continue;
    const usageResult = await db.collection(MODEL_USAGE_EVENTS).where({ job_id: job.job_id }).limit(100).get();
    const events = usageResult.data || [];
    const { summary, reasons } = tokenAuditReasons(job, events);
    if (!reasons.length) {
      await db.collection(JOBS).doc(job._id).update({
        token_usage_audit_status: "complete", token_usage_summary: summary,
        token_usage_audited_at: now,
      });
      audited += 1;
      continue;
    }
    const eventId = stableId("writing_token_alert", job.job_id);
    const alert = {
      event_id: eventId,
      event_type: "model_usage_alert",
      telemetry_version: TOKEN_TELEMETRY_VERSION,
      job_id: job.job_id,
      job_type: job.job_type,
      composition_id: job.composition_id,
      job_status: job.status,
      job_attempt_count: Number(job.attempt_count || 0),
      alert_reasons: reasons,
      stages: [...new Set(events.map((row) => row.stage).filter(Boolean))].slice(0, 12),
      models: [...new Set(events.map((row) => row.model).filter(Boolean))].slice(0, 12),
      usage_summary: summary,
      status: "pending",
      created_at: now,
      updated_at: now,
    };
    try {
      const created = await db.collection(EMAIL_EVENTS).doc(eventId).create(alert);
      if (created && created.code) throw created;
    } catch (_error) {
      const existing = await db.collection(EMAIL_EVENTS).where({ event_id: eventId }).limit(1).get();
      if (!(existing.data || []).length) throw _error;
    }
    await db.collection(JOBS).doc(job._id).update({
      token_usage_audit_status: "alert_queued", token_usage_summary: summary,
      token_usage_alert_reasons: reasons, token_usage_audited_at: now,
    });
    audited += 1;
    alerts += 1;
  }
  return { audited, alerts };
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
    const token_usage = await auditTokenUsage(now);
    return { success: true, recovered, dispatched, photos_deleted, token_usage };
  } catch (error) {
    console.error("writingAiWorker failed", error && error.message);
    return { success: false, code: error && error.message || "WRITING_AI_WORKER_ERROR" };
  }
};

exports._test = {
  dateMs, tokenSummary, tokenAuditReasons,
  recoverExpiredLeases, dispatchQueued, cleanupExpiredPhotos, auditTokenUsage,
};
