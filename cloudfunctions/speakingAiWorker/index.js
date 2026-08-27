"use strict";

const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");
const { CloudBase } = require("@cloudbase/node-sdk/dist/cloudbase");
const tcbApiCaller = require("@cloudbase/node-sdk/dist/utils/tcbapirequester");
const voiceprintProvider = require("../_shared/tencent-asr-voiceprint");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const JOBS = "speaking_ai_jobs";
const DISCUSSIONS = "speaking_discussions";
const ASSETS = "speaking_audio_assets";
const PARTICIPANTS = "speaking_participants";
const SHARES = "speaking_share_links";
const VOICEPRINTS = "speaking_voiceprints";
const VOICEPRINT_EVENTS = "speaking_voiceprint_events";
const MAX_ATTEMPTS = 5;
const LIMIT = 20;

function text(value, limit = 200) { return String(value == null ? "" : value).trim().slice(0, limit); }
function isTimerEvent(event) {
  if (!event || event.Type !== "Timer" || event.TriggerName !== "speaking-ai-worker-minute") return false;
  const triggeredAt = Date.parse(String(event.Time || ""));
  return Number.isFinite(triggeredAt);
}
function stable(prefix, ...parts) { return `${prefix}_${crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 40)}`; }
async function invokeFunction(data) {
  const context = CloudBase.getCloudbaseContext();
  const routeKey = context && context.TCB_ROUTE_KEY;
  const result = await tcbApiCaller.request({ config: app.config, params: { action: "functions.invokeFunction", function_name: "speakingLab", async: true, request_data: JSON.stringify(data || {}) }, method: "post", headers: { "content-type": "application/json", ...(routeKey ? { "X-TCB-Route-Key": routeKey } : {}) } });
  if (result && result.code) throw new Error("SPEAKING_JOB_DISPATCH_FAILED");
}
async function recoverLeases(now) {
  const result = await db.collection(JOBS).where({ status: "processing", lease_until: db.command.lte(now) }).limit(LIMIT).get();
  let count = 0;
  for (const job of result.data || []) {
    if (!job.dispatch_token || Number(job.attempt_count || 0) >= MAX_ATTEMPTS) continue;
    // Re-queue only expired work; the gateway will claim it with a fresh
    // lease. The dispatch token remains the private job capability.
    await db.collection(JOBS).doc(job._id || job.job_id).update({ status: "queued", lease_token: null, lease_until: null, next_retry_at: now, updated_at: now });
    count += 1;
  }
  return count;
}
async function dispatchQueued(now) {
  const result = await db.collection(JOBS).where({ status: "queued", next_retry_at: db.command.lte(now) }).limit(LIMIT).get();
  let count = 0;
  for (const job of (result.data || []).filter((item) => item.job_id && item.dispatch_token && Number(item.attempt_count || 0) < MAX_ATTEMPTS)) {
    try { await invokeFunction({ action: "processQueuedJob", job_id: job.job_id, dispatch_token: job.dispatch_token }); count += 1; } catch (error) { console.error("speakingAiWorker dispatch failed", job.job_id, error && error.message); }
  }
  return count;
}
async function failExhausted(now) {
  let count = 0;
  const groups = [
    await db.collection(JOBS).where({ status: "processing", lease_until: db.command.lte(now) }).limit(LIMIT).get(),
    await db.collection(JOBS).where({ status: "queued", next_retry_at: db.command.lte(now) }).limit(LIMIT).get(),
  ];
  for (const result of groups) {
    for (const job of result.data || []) {
      if (Number(job.attempt_count || 0) < MAX_ATTEMPTS) continue;
      await db.collection(JOBS).doc(job._id || job.job_id).update({ status: "failed", safe_error_code: "SPEAKING_AI_RETRY_EXHAUSTED", lease_token: null, lease_until: null, finished_at: now, updated_at: now });
      const discussionResult = await db.collection(DISCUSSIONS).where({ discussion_id: job.discussion_id, active_analysis_job_id: job.job_id }).limit(1).get();
      const discussion = discussionResult.data && discussionResult.data[0];
      if (discussion) await db.collection(DISCUSSIONS).doc(discussion._id || discussion.discussion_id).update({ analysis_status: "failed", updated_at: now });
      count += 1;
    }
  }
  return count;
}
async function cleanupAssets(now) {
  let count = 0;
  const deletable = [
    await db.collection(ASSETS).where({ status: "uploaded", delete_after: db.command.lte(now) }).limit(LIMIT).get(),
    await db.collection(ASSETS).where({ status: "superseded", delete_after: db.command.lte(now) }).limit(LIMIT).get(),
  ];
  for (const result of deletable) {
    for (const asset of result.data || []) {
      if (asset.file_id) { try { await app.deleteFile({ fileList: [asset.file_id] }); } catch (error) { console.error("speakingAiWorker asset cleanup deferred", asset.asset_id, error && error.message); continue; } }
      await db.collection(ASSETS).doc(asset._id || asset.asset_id).update({ status: "deleted", deleted_at: now, updated_at: now }); count += 1;
      if (asset.asset_kind === "voice_reference" && asset.participant_id) {
        const participantResult = await db.collection(PARTICIPANTS).where({ participant_id: asset.participant_id, voice_reference_asset_id: asset.asset_id }).limit(1).get();
        const participant = participantResult.data && participantResult.data[0];
        if (participant) await db.collection(PARTICIPANTS).doc(participant._id || participant.participant_id).update({ voice_reference_status: "deleted", updated_at: now });
      }
    }
  }
  const pending = await db.collection(ASSETS).where({ status: "uploading", expires_at: db.command.lte(now) }).limit(LIMIT).get();
  for (const asset of pending.data || []) {
    if (asset.file_id) { try { await app.deleteFile({ fileList: [asset.file_id] }); } catch (_error) { continue; } }
    await db.collection(ASSETS).doc(asset._id || asset.asset_id).update({ status: "deleted", deleted_at: now, updated_at: now }); count += 1;
  }
  return count;
}
async function expireShares(now) {
  const result = await db.collection(SHARES).where({ status: "active", expires_at: db.command.lte(now) }).limit(LIMIT).get();
  await Promise.all((result.data || []).map((share) => db.collection(SHARES).doc(share._id || share.share_id).update({ status: "expired", updated_at: now })));
  return (result.data || []).length;
}
async function cleanupVoiceprints(now) {
  if (!voiceprintProvider.configured()) return 0;
  const result = await db.collection(VOICEPRINTS).where({ status: "delete_pending" }).limit(LIMIT).get();
  let count = 0;
  for (const profile of result.data || []) {
    if (!profile.provider_voiceprint_id) continue;
    let requestId = null;
    try {
      const removed = await voiceprintProvider.remove({ voiceprintId: profile.provider_voiceprint_id });
      requestId = removed.requestId || null;
    } catch (error) {
      if (!error || error.code !== "VOICEPRINT_NOT_FOUND") {
        console.error("speakingAiWorker voiceprint cleanup deferred", profile.voiceprint_profile_id, error && error.code || "VOICEPRINT_PROVIDER_FAILED");
        continue;
      }
    }
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
  const recovered = await recoverLeases(current);
  const dispatched = await dispatchQueued(current);
  const exhausted = await failExhausted(current);
  const assets_deleted = await cleanupAssets(current);
  const voiceprints_deleted = await cleanupVoiceprints(current);
  const shares_expired = await expireShares(current);
  return { success: true, recovered, dispatched, exhausted, assets_deleted, voiceprints_deleted, shares_expired };
};

exports._test = { stable, isTimerEvent, MAX_ATTEMPTS };
