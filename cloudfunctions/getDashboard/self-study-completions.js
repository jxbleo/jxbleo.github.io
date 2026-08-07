function dateValue(value) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function effectivePercentage(attempt) {
  return Number(
    attempt && attempt.adjusted_percentage == null
      ? attempt && (attempt.display_percentage == null ? attempt.percentage || 0 : attempt.display_percentage)
      : attempt && attempt.adjusted_percentage || 0
  );
}

function effectivePassed(attempt, passingPercentage) {
  if (!attempt) return false;
  const recordedPassed = attempt.adjusted_passed == null
    ? attempt.passed === true
    : attempt.adjusted_passed === true;
  return recordedPassed || effectivePercentage(attempt) >= Number(passingPercentage || 0);
}

function compareBest(left, right) {
  const byPercentage = effectivePercentage(right) - effectivePercentage(left);
  if (byPercentage) return byPercentage;
  return dateValue(right && right.submitted_at) - dateValue(left && left.submitted_at);
}

function summarizeSelfStudyAttempts(attempts, passingPercentage) {
  const records = (attempts || []).filter((attempt) =>
    attempt && !attempt.assignment_id && attempt.mode !== "vocabulary_practice_timed"
  );
  const passingRecords = records.filter((attempt) => effectivePassed(attempt, passingPercentage));
  if (!passingRecords.length) return null;

  const best = records.slice().sort(compareBest)[0] || null;
  const latest = records.slice().sort((left, right) =>
    dateValue(right && right.submitted_at) - dateValue(left && left.submitted_at)
  )[0] || null;
  const firstPassing = passingRecords.slice().sort((left, right) =>
    dateValue(left && left.submitted_at) - dateValue(right && right.submitted_at)
  )[0] || null;

  return {
    attempt_count: records.length,
    best,
    latest,
    first_passing: firstPassing,
    best_percentage: best ? effectivePercentage(best) : null,
    latest_percentage: latest ? effectivePercentage(latest) : null,
    completed_at: firstPassing && firstPassing.submitted_at || null,
  };
}

module.exports = {
  effectivePercentage,
  summarizeSelfStudyAttempts,
};
