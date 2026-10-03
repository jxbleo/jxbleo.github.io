"use strict";

// Scheduling only: never sleep while holding a worker invocation or dispatch
// a second request to test whether an existing provider request is alive.
const UNCERTAIN_GRACE_MS = 60000;
const timestamp = value => Number(new Date(value || 0).getTime()) || 0;
function uncertainUntil(job, nowMs = Date.now()) {
  return Math.max(nowMs, timestamp(job.lease_until), timestamp(job.model_request_deadline_at)) + UNCERTAIN_GRACE_MS;
}
function retryPlan(job, error, count, nowMs = Date.now()) {
  const code = error && (error.code || error.message);
  if (["SPEAKING_AI_SCHEMA_INVALID", "SPEAKING_AI_INVALID_RESPONSE"].includes(code)) {
    return { kind: "invalid_response", at: nowMs };
  }
  if (["SPEAKING_AI_TIMEOUT", "SPEAKING_AI_TRANSPORT_ERROR", "SPEAKING_IR_CHECKPOINT_FAILED"].includes(code)
      && !error.responseCompletedAt) {
    return { kind: "outcome_unknown", at: uncertainUntil(job, nowMs) };
  }
  if (code === "SPEAKING_AI_RATE_LIMITED") {
    return { kind: "rate_limited", at: nowMs + Math.max(60000 * Math.min(count, 5), Number(error.retryAfterMs) || 0) };
  }
  return { kind: code === "SPEAKING_IR_STORAGE_FAILED" ? "storage" : "provider_error",
    at: nowMs + Math.max(Math.min(60000, 15000 * Math.pow(2, Math.max(0, count - 1))), Number(error.retryAfterMs) || 0) };
}
// A process may disappear after dispatch but before recording a response. The
// expired lease alone does not prove that the remote provider stopped work.
function recoveredRetryAt(job, nowMs = Date.now()) {
  if (job.job_type !== "individual_response_analysis" || job.exam_family === "ielts"
      || job.stage !== "analysis" || job.ir_model_result) return nowMs;
  return Math.max(nowMs, timestamp(job.lease_until) + UNCERTAIN_GRACE_MS,
    timestamp(job.model_request_deadline_at) + UNCERTAIN_GRACE_MS);
}
module.exports = { retryPlan, uncertainUntil, recoveredRetryAt, UNCERTAIN_GRACE_MS };
