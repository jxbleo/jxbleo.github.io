"use strict";

/* Owner-gated timer job. It never accepts browser identity and never returns
 * transcript, scores, or storage URLs. Configure LISTENING_MAINTENANCE_TOKEN
 * only in CloudBase timer environment; do not add a timer until reviewed. */
const cloudbase = require("@cloudbase/node-sdk");
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const TAKE_COLLECTION = "listening_shadowing_takes";
const USAGE_COLLECTION = "listening_shadowing_usage";

async function rows(collection, where) {
  const result = await db.collection(collection).where(where).limit(500).get();
  return result.data || [];
}

async function cleanTake(take, now) {
  if (take.file_id && !take.audio_deleted_at) {
    try { await app.deleteFile({ fileList: [take.file_id] }); } catch (_error) { return false; }
  }
  await db.collection(TAKE_COLLECTION).doc(take._id || take.take_id).update({ audio_deleted_at: take.audio_deleted_at || now, updated_at: now });
  return true;
}

exports.main = async (event = {}) => {
  const expected = String(process.env.LISTENING_MAINTENANCE_TOKEN || "").trim();
  const supplied = String(event.timer_token || event.Message || event.message || "").trim();
  if (!expected || supplied !== expected) return { success: false, code: "TIMER_UNAUTHORIZED" };
  const now = new Date();
  const reserved = await rows(TAKE_COLLECTION, { status: "reserved" });
  const uploaded = await rows(TAKE_COLLECTION, { status: "uploaded" });
  const expired = reserved.concat(uploaded);
  let expiredCount = 0;
  for (const take of expired) {
    if (new Date(take.expires_at || 0).getTime() > now.getTime()) continue;
    await db.collection(TAKE_COLLECTION).doc(take._id || take.take_id).update({ status: "expired", expired_at: now, updated_at: now });
    await cleanTake(take, now);
    expiredCount += 1;
  }
  const cleanupStatuses = ["scored", "invalid", "provider_failed", "outcome_unknown", "expired"];
  const cleanupRows = [];
  for (const status of cleanupStatuses) cleanupRows.push(...await rows(TAKE_COLLECTION, { status }));
  let deletedCount = 0;
  for (const take of cleanupRows) {
    if (take.audio_deleted_at || new Date(take.delete_after || 0).getTime() > now.getTime()) continue;
    if (await cleanTake(take, now)) deletedCount += 1;
  }
  const staleUsage = await rows(USAGE_COLLECTION, { status: "reserved" });
  let releasedCount = 0;
  for (const usage of staleUsage) {
    if (new Date(usage.created_at || 0).getTime() > now.getTime() - 15 * 60 * 1000) continue;
    await db.collection(USAGE_COLLECTION).doc(usage._id || usage.usage_id).update({ status: "expired", expired_at: now, updated_at: now });
    releasedCount += 1;
  }
  return { success: true, expired_takes: expiredCount, deleted_audio: deletedCount, released_usage: releasedCount };
};

exports.__test = { TAKE_COLLECTION, USAGE_COLLECTION };
