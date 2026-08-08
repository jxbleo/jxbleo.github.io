"use strict";

const EXCLUDED_PROGRESS_MODES = new Set(["vocabulary_practice_timed"]);

function dateValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function effectivePercentage(attempt) {
  return Number(attempt && (attempt.adjusted_percentage == null
    ? attempt.display_percentage == null
      ? attempt.percentage || 0
      : attempt.display_percentage
    : attempt.adjusted_percentage));
}

function rawPercentage(attempt) {
  return Number(attempt && (attempt.raw_percentage == null
    ? effectivePercentage(attempt)
    : attempt.raw_percentage));
}

function isCountableProgressAttempt(attempt) {
  return Boolean(attempt && attempt.set_id && !EXCLUDED_PROGRESS_MODES.has(String(attempt.mode || "")));
}

function orderedAttempts(attempts) {
  return (attempts || [])
    .filter(isCountableProgressAttempt)
    .slice()
    .sort((left, right) => dateValue(left.submitted_at) - dateValue(right.submitted_at));
}

function summarizeExerciseProgress(attempts, options = {}) {
  const records = orderedAttempts(attempts);
  if (!records.length) return null;
  const lockAt = dateValue(options.scoreLockedAt);
  const eligible = lockAt
    ? records.filter((attempt) => dateValue(attempt.submitted_at) <= lockAt)
    : records;
  if (!eligible.length) return null;

  let best = null;
  let bestPercentage = null;
  let bestImprovedAt = null;
  let rawBestPercentage = null;
  eligible.forEach((attempt) => {
    const percentage = effectivePercentage(attempt);
    const raw = rawPercentage(attempt);
    rawBestPercentage = rawBestPercentage == null ? raw : Math.max(rawBestPercentage, raw);
    if (bestPercentage == null || percentage > bestPercentage) {
      best = attempt;
      bestPercentage = percentage;
      bestImprovedAt = attempt.submitted_at || null;
    }
  });

  const latest = records[records.length - 1];
  const passingPercentage = Number(options.passingPercentage);
  const masteryPercentage = Number(options.masteryPercentage);
  const masteryEnabled = options.masteryEnabled === true;
  const passed = Number.isFinite(passingPercentage) && bestPercentage >= passingPercentage;
  const mastered = masteryEnabled
    && Number.isFinite(masteryPercentage)
    && bestPercentage >= masteryPercentage;
  const firstPassing = passed
    ? eligible.find((attempt) => effectivePercentage(attempt) >= passingPercentage) || null
    : null;
  const firstMastery = mastered
    ? eligible.find((attempt) => effectivePercentage(attempt) >= masteryPercentage) || null
    : null;

  return {
    attempt_count: records.length,
    best,
    best_attempt_id: best && (best.attempt_id || best._id) || null,
    best_percentage: bestPercentage,
    raw_best_percentage: rawBestPercentage,
    best_improved_at: bestImprovedAt,
    latest,
    latest_attempt_id: latest && (latest.attempt_id || latest._id) || null,
    latest_percentage: effectivePercentage(latest),
    latest_raw_percentage: rawPercentage(latest),
    latest_submitted_at: latest && latest.submitted_at || null,
    passed,
    mastered,
    status: mastered ? "mastered" : passed ? "passed" : "to_do",
    completed_at: firstPassing && firstPassing.submitted_at || null,
    mastered_at: firstMastery && firstMastery.submitted_at || null,
    score_locked_at: lockAt ? options.scoreLockedAt : null,
  };
}

module.exports = {
  effectivePercentage,
  isCountableProgressAttempt,
  rawPercentage,
  summarizeExerciseProgress,
};
