"use strict";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EXCLUDED_PROGRESS_MODES = new Set(["vocabulary_practice_timed"]);

function text(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeChineseName(value) {
  return text(value);
}

function normalizeEnglishName(value) {
  return text(value).replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function dateValue(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function shanghaiDate(utcLike) {
  const shifted = new Date(dateValue(utcLike) + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

function shanghaiInstant(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute, second, millisecond));
}

function weekPeriod(value) {
  const parts = shanghaiDate(value);
  const mondayOffset = (parts.weekday + 6) % 7;
  const anchor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - mondayOffset));
  const startAt = shanghaiInstant(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, anchor.getUTCDate());
  const endAnchor = new Date(anchor.getTime() + 6 * 86400000);
  const endAt = shanghaiInstant(
    endAnchor.getUTCFullYear(),
    endAnchor.getUTCMonth() + 1,
    endAnchor.getUTCDate(),
    23,
    59,
    59,
    999
  );
  return { type: "week", start_at: startAt, end_at: endAt };
}

function monthPeriod(value, monthKey) {
  let year;
  let month;
  const match = text(monthKey).match(/^(\d{4})-(\d{2})$/);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
  } else {
    const parts = shanghaiDate(value);
    year = parts.year;
    month = parts.month;
  }
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("PARENT_PERIOD_INVALID");
  }
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    type: "month",
    key: `${year}-${String(month).padStart(2, "0")}`,
    start_at: shanghaiInstant(year, month, 1),
    end_at: new Date(shanghaiInstant(next.year, next.month, 1).getTime() - 1),
  };
}

function periodForScope(scope, now = new Date(), monthKey = "") {
  const normalized = text(scope).toLowerCase();
  if (normalized === "month") return monthPeriod(now);
  if (normalized === "history") return monthPeriod(now, monthKey);
  return weekPeriod(now);
}

function effectivePercentage(attempt) {
  if (!attempt) return 0;
  return Number(attempt.adjusted_percentage == null
    ? attempt.display_percentage == null
      ? attempt.percentage || 0
      : attempt.display_percentage
    : attempt.adjusted_percentage);
}

function countableAttempt(attempt) {
  return Boolean(attempt && attempt.set_id && !EXCLUDED_PROGRESS_MODES.has(text(attempt.mode)));
}

function attemptSummary(attempts, options = {}) {
  const cutoff = dateValue(options.cutoff_at) || Number.POSITIVE_INFINITY;
  const lockAt = dateValue(options.score_locked_at);
  const records = (attempts || []).filter((attempt) =>
    countableAttempt(attempt)
    && dateValue(attempt.submitted_at) <= cutoff
  ).sort((left, right) => dateValue(left.submitted_at) - dateValue(right.submitted_at));
  const eligible = lockAt
    ? records.filter((attempt) => dateValue(attempt.submitted_at) <= lockAt)
    : records;
  if (!eligible.length) {
    return {
      attempt_count: records.length,
      has_attempt: records.length > 0,
      best_percentage: null,
      latest_percentage: records.length ? effectivePercentage(records[records.length - 1]) : null,
      status: "unsubmitted",
      qualified: false,
      mastered: false,
      completed_at: null,
    };
  }
  const passing = Number(options.passing_percentage || 0);
  const mastery = Number(options.mastery_percentage || 101);
  const masteryEnabled = options.mastery_enabled === true;
  let best = eligible[0];
  eligible.forEach((attempt) => {
    if (effectivePercentage(attempt) > effectivePercentage(best)) best = attempt;
  });
  const bestPercentage = effectivePercentage(best);
  const qualified = bestPercentage >= passing;
  const mastered = masteryEnabled && bestPercentage >= mastery;
  const firstQualified = qualified
    ? eligible.find((attempt) => effectivePercentage(attempt) >= passing)
    : null;
  return {
    attempt_count: records.length,
    has_attempt: records.length > 0,
    best_percentage: bestPercentage,
    latest_percentage: records.length ? effectivePercentage(records[records.length - 1]) : null,
    best_attempt_id: best.attempt_id || best._id || null,
    latest_attempt_id: records.length
      ? records[records.length - 1].attempt_id || records[records.length - 1]._id || null
      : null,
    status: mastered ? "qualified" : qualified ? "qualified" : "not_qualified",
    qualified,
    mastered,
    completed_at: firstQualified && firstQualified.submitted_at || null,
  };
}

function assignmentCategories(assignment, now = new Date()) {
  const status = text(assignment && assignment.parent_status);
  const due = dateValue(assignment && assignment.due_at);
  const week = weekPeriod(now);
  const output = [];
  if (status === "qualified") output.push("completed");
  if (!due) return output;
  if (due < dateValue(now) && status !== "qualified") output.push("overdue");
  if (due >= dateValue(week.start_at) && due <= dateValue(week.end_at)) output.push("this_week");
  if (due > dateValue(week.end_at)) output.push("upcoming");
  return output;
}

function matrixStats(cells) {
  const records = Array.isArray(cells) ? cells : [];
  const completed = records.filter((cell) => cell && cell.status === "qualified").length;
  const totalScore = records.reduce((sum, cell) => sum + Number(cell && cell.best_percentage || 0), 0);
  return {
    task_count: records.length,
    completed_count: completed,
    completion_ratio: records.length ? completed / records.length : null,
    average_best_percentage: records.length ? totalScore / records.length : 0,
  };
}

function rankMatrixStudents(students, ownStudentUid) {
  const rows = (students || []).map((student) => ({
    ...student,
    ...matrixStats(student.cells),
  }));
  function compare(left, right) {
    const completionDifference = right.completed_count - left.completed_count;
    if (completionDifference) return completionDifference;
    const scoreDifference = right.average_best_percentage - left.average_best_percentage;
    if (Math.abs(scoreDifference) > 1e-9) return scoreDifference;
    return text(left.display_name).localeCompare(text(right.display_name), "zh-Hans-CN");
  }
  const ranked = rows.filter((row) => row.ranking_eligible !== false).slice().sort(compare);
  let previousKey = null;
  let currentRank = 0;
  ranked.forEach((row, index) => {
    const key = `${row.completed_count}::${row.average_best_percentage.toFixed(6)}`;
    if (key !== previousKey) currentRank = index + 1;
    row.rank = currentRank;
    previousKey = key;
  });
  rows.filter((row) => row.ranking_eligible === false).forEach((row) => { row.rank = null; });
  const own = rows.find((row) => text(row.student_uid) === text(ownStudentUid)) || null;
  const peers = rows.filter((row) => !own || text(row.student_uid) !== text(own.student_uid)).sort((left, right) => {
    if (left.ranking_eligible !== right.ranking_eligible) return left.ranking_eligible === false ? 1 : -1;
    return compare(left, right);
  });
  return own ? [own, ...peers] : peers;
}

function membershipOverlaps(membership, period, cutoffAt) {
  const start = dateValue(membership && (membership.started_at || membership.created_at));
  const end = dateValue(membership && membership.ended_at) || Number.POSITIVE_INFINITY;
  const cutoff = Math.min(dateValue(period.end_at), dateValue(cutoffAt) || dateValue(period.end_at));
  return start <= cutoff && end >= dateValue(period.start_at);
}

function membershipCovers(membership, period, cutoffAt) {
  const start = dateValue(membership && (membership.started_at || membership.created_at));
  const end = dateValue(membership && membership.ended_at) || Number.POSITIVE_INFINITY;
  const cutoff = Math.min(dateValue(period.end_at), dateValue(cutoffAt) || dateValue(period.end_at));
  return start <= dateValue(period.start_at) && end >= cutoff;
}

module.exports = {
  SESSION_TTL_MS,
  text,
  normalizeChineseName,
  normalizeEnglishName,
  dateValue,
  shanghaiDate,
  weekPeriod,
  monthPeriod,
  periodForScope,
  effectivePercentage,
  countableAttempt,
  attemptSummary,
  assignmentCategories,
  matrixStats,
  rankMatrixStudents,
  membershipOverlaps,
  membershipCovers,
};
