"use strict";

const OPEN_REQUEST_STATUSES = new Set(["awaiting_proof", "awaiting_teacher"]);
const TERMINAL_REQUEST_STATUSES = new Set([
  "completed",
  "rejected",
  "cancelled",
  "expired",
  "refunded",
]);
const EVIDENCE_LIMIT = 3;
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const DISPLAY_EVIDENCE_BYTES = 2 * 1024 * 1024;
const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UPLOAD_TTL_MS = 15 * 60 * 1000;

function dateValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function achievementId(item) {
  return String(item && (item.achievement_id || item._id) || "");
}

function isYellowAchievement(item) {
  if (!item) return false;
  if (item.star_type === "yellow") return true;
  if (item.star_type === "blue") return false;
  return Boolean(item.assignment_id) || item.source === "assignment_claim" || item.source === "assignment";
}

function isBlueAchievement(item) {
  if (!item) return false;
  if (item.star_type === "blue") return true;
  if (item.star_type === "yellow") return false;
  return !item.assignment_id && (item.source === "self_study" || item.source === "explore");
}

function isActiveBlueAchievement(item) {
  return isBlueAchievement(item) && item.status !== "converted";
}

function normalizedStarBuckets(achievements) {
  const yellowById = new Map();
  const blueBySet = new Map();
  (achievements || []).forEach((item) => {
    if (!item) return;
    if (isYellowAchievement(item)) {
      const key = achievementId(item) || `${item.student_uid || ""}::${item.set_id || ""}::${item.assignment_id || ""}`;
      if (!yellowById.has(key)) yellowById.set(key, item);
      return;
    }
    if (!isBlueAchievement(item)) return;
    const key = String(item.set_id || achievementId(item));
    const current = blueBySet.get(key);
    if (!current || dateValue(item.updated_at || item.created_at) > dateValue(current.updated_at || current.created_at)) {
      blueBySet.set(key, item);
    }
  });
  return {
    yellowStars: [...yellowById.values()],
    blueStars: [...blueBySet.values()],
    activeBlueStars: [...blueBySet.values()].filter(isActiveBlueAchievement),
  };
}

function splitStarCounts(achievements) {
  const buckets = normalizedStarBuckets(achievements);
  return {
    assignment_star_count: buckets.yellowStars.length,
    self_study_star_count: buckets.activeBlueStars.length,
    star_count: buckets.yellowStars.length + buckets.activeBlueStars.length,
    lifetime_yellow_star_count: buckets.yellowStars.length,
    active_blue_star_count: buckets.activeBlueStars.length,
  };
}

function yellowAchievementId(studentUid, setId) {
  return [studentUid, setId, "yellow"].join("::");
}

function blueAchievementId(studentUid, setId) {
  return [studentUid, setId, "blue"].join("::");
}

function canConvertBlueToYellow(options) {
  const source = options || {};
  if (source.masteryEnabled !== true || source.masteryLocked === true) return false;
  const percentage = Number(source.bestPercentage);
  const starRate = Number(source.starRate);
  return Number.isFinite(percentage) && Number.isFinite(starRate) && percentage >= starRate;
}

function ledgerEntry(options) {
  const source = options || {};
  const ids = Array.from(new Set((source.achievementIds || []).map(String).filter(Boolean)));
  const count = ids.length;
  const deltas = {
    credit: [count, 0, 0],
    reserve: [-count, count, 0],
    release: [count, -count, 0],
    redeem: [0, -count, count],
    refund: [count, 0, -count],
  }[source.entryType];
  if (!deltas) throw new Error("LEDGER_ENTRY_TYPE_INVALID");
  return {
    ledger_id: String(source.ledgerId || ""),
    student_uid: String(source.studentUid || ""),
    request_id: source.requestId ? String(source.requestId) : null,
    achievement_ids: ids,
    entry_type: source.entryType,
    available_delta: deltas[0],
    reserved_delta: deltas[1],
    spent_delta: deltas[2],
    actor_uid: String(source.actorUid || "system"),
    reason: String(source.reason || "").trim().slice(0, 500),
    created_at: source.createdAt || new Date(),
  };
}

function walletProjection(entries) {
  return (entries || []).reduce((wallet, entry) => {
    wallet.available += Number(entry.available_delta || 0);
    wallet.reserved += Number(entry.reserved_delta || 0);
    wallet.spent += Number(entry.spent_delta || 0);
    if (entry.entry_type === "credit") wallet.lifetimeEarned += (entry.achievement_ids || []).length;
    return wallet;
  }, { available: 0, reserved: 0, spent: 0, lifetimeEarned: 0 });
}

function yellowCreditStates(achievements, entries) {
  const states = new Map();
  normalizedStarBuckets(achievements).yellowStars.forEach((item) => {
    const id = achievementId(item);
    if (id) states.set(id, "uncredited");
  });
  (entries || []).slice().sort((left, right) => dateValue(left.created_at) - dateValue(right.created_at))
    .forEach((entry) => {
      const next = {
        credit: "available",
        reserve: "reserved",
        release: "available",
        redeem: "spent",
        refund: "available",
      }[entry.entry_type];
      if (!next) return;
      (entry.achievement_ids || []).forEach((id) => {
        if (states.has(String(id))) states.set(String(id), next);
      });
    });
  return states;
}

function availableYellowAchievements(achievements, entries) {
  const states = yellowCreditStates(achievements, entries);
  return normalizedStarBuckets(achievements).yellowStars
    .filter((item) => states.get(achievementId(item)) === "available")
    .sort((left, right) => dateValue(left.first_earned_at || left.created_at) - dateValue(right.first_earned_at || right.created_at));
}

function wholeStarCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) throw new Error("STAR_COUNT_INVALID");
  return count;
}

function isOpenRequest(request) {
  return Boolean(request && OPEN_REQUEST_STATUSES.has(request.status));
}

function isTerminalRequest(request) {
  return Boolean(request && TERMINAL_REQUEST_STATUSES.has(request.status));
}

function isRequestExpired(request, nowValue) {
  if (!isOpenRequest(request)) return false;
  const now = dateValue(nowValue || new Date());
  return Boolean(dateValue(request.expires_at) && dateValue(request.expires_at) <= now);
}

function requestExpiresAt(createdAt) {
  return new Date(dateValue(createdAt || new Date()) + REQUEST_TTL_MS);
}

function attemptPercentage(attempt) {
  return Number(attempt && (attempt.adjusted_percentage == null
    ? attempt.percentage || attempt.best_percentage || 0
    : attempt.adjusted_percentage));
}

async function achievementsForSet(db, studentUid, setId) {
  const result = await db.collection("student_set_achievements").where({
    student_uid: studentUid,
    set_id: setId,
  }).limit(100).get();
  return result.data || [];
}

async function markBlueConverted(db, blue, yellow, now) {
  if (!blue || !blue._id || blue.status === "converted") return;
  await db.collection("student_set_achievements").doc(blue._id).update({
    star_type: "blue",
    status: "converted",
    protected: false,
    reward_eligible: false,
    converted_to_achievement_id: achievementId(yellow),
    converted_at: now,
    updated_at: now,
  });
}

async function protectYellowStar(options) {
  const source = options || {};
  const { db, student, assignment, attempt } = source;
  if (!db || !student || !assignment || !assignment.set_id) return null;
  if (source.masteryEnabled !== true || assignment.mastery_enabled !== true) return null;
  const now = source.now || new Date();
  const percentage = Number(source.bestPercentage == null ? attemptPercentage(attempt) : source.bestPercentage);
  const starRate = Number(source.starRate);
  if (assignment.mastery_locked === true || !Number.isFinite(percentage) || !Number.isFinite(starRate) || percentage < starRate) return null;
  const rows = await achievementsForSet(db, student.auth_uid, assignment.set_id);
  const existingYellow = rows.find(isYellowAchievement);
  const activeBlue = rows.find(isActiveBlueAchievement);
  const assignmentId = assignment.assignment_id || assignment._id || null;
  const bestAttemptId = source.bestAttemptId
    || attempt && attempt.attempt_id
    || assignment.best_attempt_id
    || assignment.latest_attempt_id
    || null;

  if (existingYellow) {
    const update = {
      star_type: "yellow",
      status: "star",
      protected: true,
      reward_eligible: true,
      source: "assignment_claim",
      updated_at: now,
    };
    if (percentage > Number(existingYellow.best_percentage || 0)) {
      update.best_percentage = percentage;
      update.best_attempt_id = bestAttemptId;
    }
    await db.collection("student_set_achievements").doc(existingYellow._id).update(update);
    const yellow = { ...existingYellow, ...update };
    await markBlueConverted(db, activeBlue, yellow, now);
    return yellow;
  }

  const record = {
    achievement_id: yellowAchievementId(student.auth_uid, assignment.set_id),
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    set_id: assignment.set_id,
    assignment_id: assignmentId,
    star_type: "yellow",
    status: "star",
    protected: true,
    reward_eligible: true,
    source: "assignment_claim",
    claimed_at: now,
    first_earned_at: now,
    first_qualifying_attempt_id: bestAttemptId,
    best_attempt_id: bestAttemptId,
    best_percentage: percentage,
    passing_percentage_snapshot: source.passingPercentage == null ? null : Number(source.passingPercentage),
    mastery_percentage_snapshot: source.starRate == null ? null : Number(source.starRate),
    converted_from_achievement_id: activeBlue ? achievementId(activeBlue) : null,
    converted_at: activeBlue ? now : null,
    created_at: now,
    updated_at: now,
  };
  try {
    await db.collection("student_set_achievements").add(record);
  } catch (error) {
    const duplicate = await db.collection("student_set_achievements").where({
      achievement_id: record.achievement_id,
    }).limit(1).get();
    if (!duplicate.data || !duplicate.data[0]) throw error;
    const stored = duplicate.data[0];
    await markBlueConverted(db, activeBlue, stored, now);
    return stored;
  }
  await markBlueConverted(db, activeBlue, record, now);
  return record;
}

async function protectBlueStar(options) {
  const source = options || {};
  const { db, student, attempt } = source;
  if (!db || !student || !attempt || !attempt.set_id) return null;
  const now = source.now || new Date();
  const percentage = attemptPercentage(attempt);
  const masteryPercentage = Number(source.masteryPercentage);
  if (!Number.isFinite(percentage) || !Number.isFinite(masteryPercentage) || percentage < masteryPercentage) return null;
  const rows = await achievementsForSet(db, student.auth_uid, attempt.set_id);
  if (rows.some(isYellowAchievement)) return null;
  const existing = rows.find(isBlueAchievement);
  if (existing && existing.status === "converted") return existing;
  if (existing) {
    const update = {
      star_type: "blue",
      status: "active",
      protected: false,
      reward_eligible: false,
      source: "self_study",
      updated_at: now,
    };
    if (percentage > Number(existing.best_percentage || 0)) {
      update.best_percentage = percentage;
      update.best_attempt_id = attempt.attempt_id || existing.best_attempt_id || null;
    }
    await db.collection("student_set_achievements").doc(existing._id).update(update);
    return { ...existing, ...update };
  }
  const record = {
    achievement_id: blueAchievementId(student.auth_uid, attempt.set_id),
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    set_id: attempt.set_id,
    assignment_id: null,
    star_type: "blue",
    status: "active",
    protected: false,
    reward_eligible: false,
    source: "self_study",
    claimed_at: now,
    first_earned_at: now,
    first_qualifying_attempt_id: attempt.attempt_id || null,
    best_attempt_id: attempt.attempt_id || null,
    best_percentage: percentage,
    passing_percentage_snapshot: source.passingPercentage == null ? null : Number(source.passingPercentage),
    mastery_percentage_snapshot: source.masteryPercentage == null ? null : Number(source.masteryPercentage),
    converted_to_achievement_id: null,
    converted_at: null,
    created_at: now,
    updated_at: now,
  };
  try {
    await db.collection("student_set_achievements").add(record);
  } catch (error) {
    const duplicate = await db.collection("student_set_achievements").where({
      achievement_id: record.achievement_id,
    }).limit(1).get();
    if (!duplicate.data || !duplicate.data[0]) throw error;
    return duplicate.data[0];
  }
  return record;
}

module.exports = {
  DISPLAY_EVIDENCE_BYTES,
  EVIDENCE_LIMIT,
  MAX_EVIDENCE_BYTES,
  OPEN_REQUEST_STATUSES,
  REQUEST_TTL_MS,
  TERMINAL_REQUEST_STATUSES,
  UPLOAD_TTL_MS,
  achievementId,
  availableYellowAchievements,
  blueAchievementId,
  canConvertBlueToYellow,
  isActiveBlueAchievement,
  isBlueAchievement,
  isOpenRequest,
  isRequestExpired,
  isTerminalRequest,
  isYellowAchievement,
  ledgerEntry,
  normalizedStarBuckets,
  protectBlueStar,
  protectYellowStar,
  requestExpiresAt,
  splitStarCounts,
  walletProjection,
  wholeStarCount,
  yellowAchievementId,
  yellowCreditStates,
};
