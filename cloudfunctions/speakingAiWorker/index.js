"use strict";

const crypto = require("crypto");
const irRetry = require("../_shared/speaking-ir-retry");
const cloudbase = require("@cloudbase/node-sdk");
const { CloudBase } = require("@cloudbase/node-sdk/dist/cloudbase");
const tcbApiCaller = require("@cloudbase/node-sdk/dist/utils/tcbapirequester");
const voiceprintProvider = require("../_shared/tencent-asr-voiceprint");

const JOBS = "speaking_ai_jobs";
const DISCUSSIONS = "speaking_discussions";
const ASSETS = "speaking_audio_assets";
const PARTICIPANTS = "speaking_participants";
const INDIVIDUAL_RESPONSES = "speaking_individual_responses";
const SHARES = "speaking_share_links";
const VOICEPRINTS = "speaking_voiceprints";
const VOICEPRINT_EVENTS = "speaking_voiceprint_events";
const MAX_ATTEMPTS = 5;
const LIMIT = 20;
const WORKER_BUDGET_MS = 52000;
const WORKER_EXIT_RESERVE_MS = 6000;
const WORKER_SDK_TIMEOUT_MS = 5000;
const FOREGROUND_BUDGET_MS = 30000;
const DISPATCH_CONCURRENCY = 3;
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV, timeout: WORKER_SDK_TIMEOUT_MS });
const db = app.database();

function isTimerEvent(event) {
  if (!event || event.Type !== "Timer" || event.TriggerName !== "speaking-ai-worker-minute") return false;
  const triggeredAt = Date.parse(String(event.Time || ""));
  return Number.isFinite(triggeredAt);
}
function stable(prefix, ...parts) { return `${prefix}_${crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 40)}`; }
function withinBudget(runtime, reserve = WORKER_EXIT_RESERVE_MS) {
  return !runtime || Date.now() + reserve < runtime.deadlineAt;
}
function remainingBudget(runtime) {
  return runtime ? Math.max(0, runtime.deadlineAt - Date.now()) : 10000;
}
function sdkTimeout(runtime) {
  return Math.min(WORKER_SDK_TIMEOUT_MS, Math.max(1000, remainingBudget(runtime) - WORKER_EXIT_RESERVE_MS));
}
async function invokeFunction(data, runtime) {
  const context = CloudBase.getCloudbaseContext();
  const routeKey = context && context.TCB_ROUTE_KEY;
  const timeout = Math.min(10000, Math.max(1000, remainingBudget(runtime) - WORKER_EXIT_RESERVE_MS));
  const result = await tcbApiCaller.request({ config: app.config, params: { action: "functions.invokeFunction", function_name: "speakingLab", async: true, request_data: JSON.stringify(data || {}) }, method: "post", opts: { timeout }, headers: { "content-type": "application/json", ...(routeKey ? { "X-TCB-Route-Key": routeKey } : {}) } });
  if (result && result.code) throw new Error("SPEAKING_JOB_DISPATCH_FAILED");
}
async function recoverLeases(now, runtime) {
  if (!withinBudget(runtime)) return 0;
  const result = await db.collection(JOBS).where({ status: "processing", lease_until: db.command.lte(now) }).limit(LIMIT).get();
  let count = 0;
  for (const job of result.data || []) {
    if (!withinBudget(runtime)) break;
    if (!job.dispatch_token || Number(job.attempt_count || 0) >= MAX_ATTEMPTS) continue;
    let recovered = false;
    await db.runTransaction(async (transaction) => {
      const currentResult = await transaction.collection(JOBS).where({ job_id: job.job_id }).limit(1).get();
      const current = currentResult.data && currentResult.data[0];
      if (!current || current.status !== "processing"
        || String(current.lease_token || "") !== String(job.lease_token || "")
        || Number(current.attempt_count || 0) !== Number(job.attempt_count || 0)
        || Number(new Date(current.lease_until || 0).getTime()) > now.getTime()) return;
      await transaction.collection(JOBS).doc(current._id || current.job_id).update({ status: "queued", lease_token: null, lease_until: null, next_retry_at: new Date(irRetry.recoveredRetryAt(current, now.getTime())), updated_at: now });
      recovered = true;
    });
    if (recovered) count += 1;
  }
  return count;
}
async function runBounded(items, concurrency, worker, runtime) {
  const rows = Array.isArray(items) ? items : [];
  let cursor = 0;
  let completed = 0;
  async function consume() {
    while (withinBudget(runtime) && cursor < rows.length) {
      const row = rows[cursor++];
      const result = await worker(row);
      if (result !== false) completed += 1;
    }
  }
  const count = Math.min(Math.max(1, Number(concurrency) || 1), rows.length);
  await Promise.all(Array.from({ length: count }, () => consume()));
  return completed;
}
async function dispatchQueued(now, runtime) {
  if (!withinBudget(runtime)) return 0;
  const result = await db.collection(JOBS).where({ status: "queued", next_retry_at: db.command.lte(now) }).limit(LIMIT).get();
  const jobs = (result.data || []).filter((item) => item.job_id && item.dispatch_token && Number(item.attempt_count || 0) < MAX_ATTEMPTS);
  return runBounded(jobs, DISPATCH_CONCURRENCY, async (job) => {
    try { await invokeFunction({ action: "processQueuedJob", job_id: job.job_id, dispatch_token: job.dispatch_token }, runtime); return true; }
    catch (error) { console.error("speakingAiWorker dispatch failed", job.job_id, error && error.message); return false; }
  }, runtime);
}
async function failExhausted(now, runtime) {
  if (!withinBudget(runtime)) return 0;
  // The scanned job snapshot is only a hint; every mutation below uses the
  // transaction's freshly re-read current job type.
  let count = 0;
  const groups = [await db.collection(JOBS).where({ status: "processing", lease_until: db.command.lte(now) }).limit(LIMIT).get()];
  if (withinBudget(runtime)) groups.push(await db.collection(JOBS).where({ status: "queued", next_retry_at: db.command.lte(now) }).limit(LIMIT).get());
  for (const [groupIndex, result] of groups.entries()) {
    for (const job of result.data || []) {
      if (!withinBudget(runtime)) return count;
      if (Number(job.attempt_count || 0) < MAX_ATTEMPTS) continue;
      let exhausted = false;
      await db.runTransaction(async (transaction) => {
        const currentResult = await transaction.collection(JOBS).where({ job_id: job.job_id }).limit(1).get();
        const current = currentResult.data && currentResult.data[0];
        const currentDue = groupIndex === 0
          ? current && current.status === "processing" && Number(new Date(current.lease_until || 0).getTime()) <= now.getTime()
          : current && current.status === "queued" && Number(new Date(current.next_retry_at || 0).getTime()) <= now.getTime();
        if (!current || !currentDue || Number(current.attempt_count || 0) !== Number(job.attempt_count || 0)
          || (groupIndex === 0 && String(current.lease_token || "") !== String(job.lease_token || ""))
          || String(current.dispatch_token || "") !== String(job.dispatch_token || "")) return;
        await transaction.collection(JOBS).doc(current._id || current.job_id).update({ status: "failed", safe_error_code: "SPEAKING_AI_RETRY_EXHAUSTED", lease_token: null, lease_until: null, finished_at: now, updated_at: now });
        if (current.job_type === "individual_response_analysis") {
          const responseResult = await transaction.collection(INDIVIDUAL_RESPONSES).where({ response_session_id: current.response_session_id }).limit(1).get();
          const response = responseResult.data && responseResult.data[0];
          if (response && String(response.active_analysis_job_id || "") === String(current.job_id)) await transaction.collection(INDIVIDUAL_RESPONSES).doc(response._id || response.response_session_id).update({ analysis_status: "failed", updated_at: now });
        } else {
          const activeJobField = current.job_type === "voice_rematch" ? "active_voice_match_job_id" : "active_analysis_job_id";
          const discussionResult = await transaction.collection(DISCUSSIONS).where({ discussion_id: current.discussion_id }).limit(1).get();
          const discussion = discussionResult.data && discussionResult.data[0];
          if (discussion && String(discussion[activeJobField] || "") === String(current.job_id)) await transaction.collection(DISCUSSIONS).doc(discussion._id || discussion.discussion_id).update(current.job_type === "voice_rematch"
            ? { voice_match_status: "failed", voice_match_safe_error_code: "SPEAKING_AI_RETRY_EXHAUSTED", voice_match_last_run_at: now, updated_at: now }
            : { analysis_status: "failed", updated_at: now });
        }
        exhausted = true;
      });
      if (exhausted) count += 1;
    }
  }
  return count;
}
async function cleanupAssets(now, runtime) {
  if (!withinBudget(runtime)) return 0;
  let count = 0;
  const deletable = [await db.collection(ASSETS).where({ status: "uploaded", delete_after: db.command.lte(now) }).limit(LIMIT).get()];
  if (withinBudget(runtime)) deletable.push(await db.collection(ASSETS).where({ status: "superseded", delete_after: db.command.lte(now) }).limit(LIMIT).get());
  for (const result of deletable) {
    for (const asset of result.data || []) {
      if (!withinBudget(runtime)) return count;
      // Protect submitted originals, including legacy rows already scheduled for deletion.
      // Only temporary voice references belong to this cleanup queue.
      if (asset.asset_kind !== "voice_reference") {
        await db.collection(ASSETS).doc(asset._id || asset.asset_id).update({ delete_after: null, updated_at: now });
        continue;
      }
      // CloudBase file/DB calls are not cancellable. Start only with the
      // reserve available and wait for the result before recording state.
      if (asset.file_id) { try { await app.deleteFile({ fileList: [asset.file_id] }, { timeout: sdkTimeout(runtime) }); } catch (error) { console.error("speakingAiWorker asset cleanup deferred", asset.asset_id, error && error.message); continue; } }
      // Keep the asset eligible until dependent participant cleanup completes.
      if (!withinBudget(runtime)) return count;
      if (asset.asset_kind === "voice_reference" && asset.participant_id) {
        const participantResult = await db.collection(PARTICIPANTS).where({ participant_id: asset.participant_id, voice_reference_asset_id: asset.asset_id }).limit(1).get();
        const participant = participantResult.data && participantResult.data[0];
        if (!withinBudget(runtime)) return count;
        if (participant) await db.collection(PARTICIPANTS).doc(participant._id || participant.participant_id).update({ voice_reference_status: "deleted", updated_at: now });
      }
      if (!withinBudget(runtime)) return count;
      try { await db.collection(ASSETS).doc(asset._id || asset.asset_id).update({ status: "deleted", deleted_at: now, updated_at: now }); } catch (error) { console.error("speakingAiWorker asset state update deferred", asset.asset_id, error && error.message); continue; }
      count += 1;
    }
  }
  if (!withinBudget(runtime)) return count;
  const pending = await db.collection(ASSETS).where({ status: "uploading", expires_at: db.command.lte(now) }).limit(LIMIT).get();
  for (const asset of pending.data || []) {
    if (!withinBudget(runtime)) return count;
    if (asset.file_id) { try { await app.deleteFile({ fileList: [asset.file_id] }, { timeout: sdkTimeout(runtime) }); } catch (_error) { continue; } }
    if (!withinBudget(runtime)) return count;
    try { await db.collection(ASSETS).doc(asset._id || asset.asset_id).update({ status: "deleted", deleted_at: now, updated_at: now }); } catch (_error) { continue; }
    count += 1;
  }
  return count;
}
async function expireShares(now, runtime) {
  if (!withinBudget(runtime)) return 0;
  const result = await db.collection(SHARES).where({ status: "active", expires_at: db.command.lte(now) }).limit(LIMIT).get();
  let count = 0;
  for (const share of result.data || []) {
    if (!withinBudget(runtime)) break;
    try { await db.collection(SHARES).doc(share._id || share.share_id).update({ status: "expired", updated_at: now }); count += 1; } catch (_error) { break; }
  }
  return count;
}
async function cleanupVoiceprints(now, runtime) {
  if (!withinBudget(runtime)) return 0;
  if (!voiceprintProvider.configured()) return 0;
  const result = await db.collection(VOICEPRINTS).where({ status: "delete_pending" }).limit(LIMIT).get();
  let count = 0;
  for (const profile of result.data || []) {
    if (!withinBudget(runtime)) break;
    if (!profile.provider_voiceprint_id) continue;
    let requestId = null;
    try {
      const timeoutMs = remainingBudget(runtime) - WORKER_EXIT_RESERVE_MS;
      if (timeoutMs <= 0) break;
      const removed = await voiceprintProvider.remove({ voiceprintId: profile.provider_voiceprint_id }, { timeoutMs: Math.min(30000, timeoutMs) });
      requestId = removed.requestId || null;
    } catch (error) {
      if (!error || error.code !== "VOICEPRINT_NOT_FOUND") {
        console.error("speakingAiWorker voiceprint cleanup deferred", profile.voiceprint_profile_id, error && error.code || "VOICEPRINT_PROVIDER_FAILED");
        continue;
      }
    }
    // Keep delete_pending if the provider used the remaining budget. The next
    // timer reconciles an already-removed voiceprint through NOT_FOUND.
    if (!withinBudget(runtime)) break;
    const eventId = stable("voiceprint_cleanup", profile.voiceprint_profile_id, String(profile.enrollment_revision || 0));
    await db.runTransaction(async (transaction) => {
      const currentResult = await transaction.collection(VOICEPRINTS).where({ voiceprint_profile_id: profile.voiceprint_profile_id }).limit(1).get();
      const current = currentResult.data && currentResult.data[0];
      if (!current || current.status !== "delete_pending" || String(current.provider_voiceprint_id || "") !== String(profile.provider_voiceprint_id || "")) return;
      await transaction.collection(VOICEPRINTS).doc(current._id || current.voiceprint_profile_id).update({ status: "deleted", provider_voiceprint_id: null, provider_group_id: null, deleted_at: now, deleted_by_uid: current.delete_requested_by_uid || null, last_provider_request_id: requestId, updated_at: now });
      const existingEvent = await transaction.collection(VOICEPRINT_EVENTS).where({ event_id: eventId }).limit(1).get();
      if (!(existingEvent.data && existingEvent.data[0])) await transaction.collection(VOICEPRINT_EVENTS).doc(eventId).create({ event_id: eventId, operation_id: eventId, voiceprint_profile_id: current.voiceprint_profile_id, subject_key: current.subject_key, subject_kind: current.subject_kind, participant_id: current.participant_id || null, discussion_id: current.discussion_id || null, event_type: "deleted", enrollment_revision: Number(current.enrollment_revision || 0), actor_uid: current.delete_requested_by_uid || null, actor_role: "system", provider: "tencent_asr", provider_request_id: requestId, created_at: now });
    });
    count += 1;
  }
  return count;
}

exports.main = async (event = {}) => {
  // CloudBase function ACL must keep this worker at `invoke: false`. CloudBase
  // documents that client ACLs do not apply to timer triggers, so the platform
  // timer can still run while browser SDK calls are rejected before execution.
  if (!isTimerEvent(event)) return { success: false, code: "AUTH_REQUIRED" };
  const current = new Date();
  const startedAt = Date.now();
  const runtime = { startedAt, deadlineAt: startedAt + WORKER_BUDGET_MS };
  const foreground = { startedAt, deadlineAt: startedAt + FOREGROUND_BUDGET_MS };
  const recovered = await recoverLeases(current, foreground);
  const dispatched = await dispatchQueued(current, foreground);
  const exhausted = await failExhausted(current, foreground);
  const maintenance = [
    () => cleanupAssets(current, runtime),
    () => cleanupVoiceprints(current, runtime),
    () => expireShares(current, runtime),
  ];
  const rotation = Math.floor(current.getTime() / 60000) % maintenance.length;
  const maintenanceResults = [0, 0, 0];
  for (let offset = 0; offset < maintenance.length && withinBudget(runtime); offset += 1) {
    const index = (rotation + offset) % maintenance.length;
    maintenanceResults[index] = await maintenance[index]();
  }
  const assets_deleted = maintenanceResults[0];
  const voiceprints_deleted = maintenanceResults[1];
  const shares_expired = maintenanceResults[2];
  return { success: true, recovered, dispatched, exhausted, assets_deleted, voiceprints_deleted, shares_expired };
};

exports._test = { stable, isTimerEvent, withinBudget, remainingBudget, sdkTimeout, runBounded, MAX_ATTEMPTS, WORKER_BUDGET_MS, WORKER_EXIT_RESERVE_MS, WORKER_SDK_TIMEOUT_MS, FOREGROUND_BUDGET_MS, DISPATCH_CONCURRENCY };
