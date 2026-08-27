"use strict";

const exerciseProgress = require("./exercise-progress");

// The report domain deliberately has no CloudBase dependency. Keeping period
// math and snapshot projection here makes the security-sensitive functions
// small and gives us deterministic unit tests around Shanghai calendar rules.

const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateValue(value) {
  const date = validDate(value);
  return date ? date.getTime() : 0;
}

function assertPeriodType(periodType) {
  if (periodType !== "weekly" && periodType !== "monthly") throw new Error("REPORT_PERIOD_TYPE_INVALID");
  return periodType;
}

function shanghaiParts(value) {
  const date = validDate(value);
  if (!date) throw new Error("REPORT_DATE_INVALID");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const fields = Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return {
    year: Number(fields.year),
    month: Number(fields.month),
    day: Number(fields.day),
    hour: Number(fields.hour),
    minute: Number(fields.minute),
    second: Number(fields.second),
  };
}

function calendarDay(parts) {
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function addCalendarDays(parts, amount) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(amount || 0)));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function calendarDayValue(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function calendarDaysBetween(left, right) {
  return Math.round((calendarDayValue(right) - calendarDayValue(left)) / (24 * 60 * 60 * 1000));
}

function weekdayForCalendarDay(parts) {
  return new Date(calendarDayValue(parts)).getUTCDay();
}

function shanghaiDate(parts, hour = 0, minute = 0, second = 0, millisecond = 0) {
  // Asia/Shanghai uses UTC+08:00 for the report periods supported by this app.
  // Calendar arithmetic is performed in UTC first so month/year boundaries are
  // not affected by the host machine's timezone.
  return new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    Number(hour) - 8,
    Number(minute),
    Number(second),
    Number(millisecond)
  ));
}

function mondayForCalendarDay(parts) {
  const weekday = weekdayForCalendarDay(parts);
  return addCalendarDays(parts, -((weekday + 6) % 7));
}

function isoWeekForMonday(monday) {
  const thursday = addCalendarDays(monday, 3);
  const weekYear = thursday.year;
  const firstMonday = mondayForCalendarDay({ year: weekYear, month: 1, day: 4 });
  const weekNumber = 1 + Math.floor(calendarDaysBetween(firstMonday, monday) / 7);
  return { year: weekYear, number: weekNumber };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function periodForDate(periodType, value = new Date()) {
  assertPeriodType(periodType);
  const local = calendarDay(shanghaiParts(value));
  if (periodType === "monthly") {
    const endDay = new Date(Date.UTC(local.year, local.month, 0)).getUTCDate();
    const start = { year: local.year, month: local.month, day: 1 };
    const end = { year: local.year, month: local.month, day: endDay };
    return {
      period_type: periodType,
      period_key: `${local.year}-${pad(local.month)}`,
      start_at: shanghaiDate(start),
      end_at: shanghaiDate(end, 23, 59, 59, 999),
      display_label: `${local.year}-${pad(local.month)}`,
    };
  }

  const start = mondayForCalendarDay(local);
  const end = addCalendarDays(start, 6);
  const iso = isoWeekForMonday(start);
  return {
    period_type: periodType,
    period_key: `${iso.year}-W${pad(iso.number)}`,
    start_at: shanghaiDate(start),
    end_at: shanghaiDate(end, 23, 59, 59, 999),
    display_label: `${iso.year} W${pad(iso.number)}`,
  };
}

function previousPeriod(period) {
  if (!period || !period.start_at) throw new Error("REPORT_PERIOD_INVALID");
  return periodForDate(period.period_type, new Date(dateValue(period.start_at) - 1));
}

function latestClosedPeriod(periodType, now = new Date()) {
  return previousPeriod(periodForDate(periodType, now));
}

function isPeriodClosed(period, now = new Date()) {
  return dateValue(now) > dateValue(period && period.end_at);
}

function reportIdFor(classId, period) {
  const normalizedClassId = text(classId);
  if (!normalizedClassId) throw new Error("CLASS_ID_REQUIRED");
  if (!period || !period.period_key) throw new Error("REPORT_PERIOD_INVALID");
  return `lr-${period.period_type}-${period.period_key}-${encodeURIComponent(normalizedClassId)}`;
}

function reportUrlFor(reportId) {
  return `reports.html?report=${encodeURIComponent(text(reportId))}`;
}

function recordData(record) {
  return record && record.data && typeof record.data === "object"
    ? { ...record.data, _id: record._id }
    : record || {};
}

function effectivePassed(attempt) {
  return attempt && (attempt.adjusted_passed == null ? attempt.passed === true : attempt.adjusted_passed === true);
}

function normalizedAssignmentStatus(status) {
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "passed" || status === "mastered" || status === "done") return "passed";
  return "to_do";
}

function countableAttempt(attempt) {
  return Boolean(attempt) && attempt.mode !== "vocabulary_practice_timed";
}

function passingPercentageForAssignment(assignment, set) {
  const stored = Number(assignment && assignment.passing_percentage);
  if (Number.isFinite(stored)) return stored;
  const setValue = Number(set && set.passing_percentage);
  if (Number.isFinite(setValue)) return setValue;
  const family = familyForSet(set, assignment && assignment.set_id);
  if (family === "vocabulary") return 90;
  if (family === "bbc") return 80;
  return 50;
}

function familyForSet(set, fallbackSetId = "") {
  const source = set || {};
  const values = [
    source.section_id,
    source.section,
    source.type,
    source.course,
    source.category,
    source.family,
    fallbackSetId || source.set_id,
  ].map((item) => text(item).toLowerCase()).join(" ");
  if (values.includes("intensive-listening") || /^il-/i.test(text(fallbackSetId || source.set_id))) {
    return "intensive-listening";
  }
  if (values.includes("vocab")) return "vocabulary";
  if (values.includes("bbc")) return "bbc";
  if (values.includes("ielts") && values.includes("listening")) return "ielts-listening";
  if (values.includes("ielts") && values.includes("reading")) return "ielts-reading";
  if (values.includes("ielts")) return "ielts";
  if (values.includes("listening")) return "listening";
  if (values.includes("reading")) return "reading";
  return "other";
}

function intensiveProgressKey(studentUid, setId) {
  return `${text(studentUid)}::${text(setId)}`;
}

function currentIntensiveProgress(progress, set) {
  if (!progress) return null;
  const expectedVersion = text(set && set.content_version);
  const progressVersion = text(progress.content_version);
  if (expectedVersion && progressVersion && expectedVersion !== progressVersion) return null;
  return progress;
}

function studentNames(student, membership) {
  const source = student || {};
  const membershipSource = membership || {};
  const chineseName = text(source.chinese_name) || text(membershipSource.chinese_name_snapshot);
  const englishName = text(source.english_name) || text(membershipSource.english_name_snapshot);
  const displayName = text(source.name)
    || text(membershipSource.student_name_snapshot)
    || [chineseName, englishName].filter(Boolean).join(" / ");
  return { chinese_name: chineseName, english_name: englishName, display_name: displayName };
}

function membershipStartValue(membership) {
  return dateValue(membership && (membership.started_at || membership.created_at));
}

function membershipEndValue(membership) {
  const raw = membership && membership.ended_at;
  return raw == null ? Number.POSITIVE_INFINITY : dateValue(raw);
}

function membershipOverlapsPeriod(membership, period, cutoffAt) {
  const start = membershipStartValue(membership);
  const end = membershipEndValue(membership);
  const periodStart = dateValue(period && period.start_at);
  const cutoff = dateValue(cutoffAt || period && period.end_at);
  return Boolean(start) && start <= cutoff && end >= periodStart;
}

function membershipCoversPeriod(membership, period, cutoffAt) {
  const start = membershipStartValue(membership);
  const end = membershipEndValue(membership);
  return Boolean(start) && start <= dateValue(period && period.start_at) && end > dateValue(cutoffAt || period && period.end_at);
}

function membershipCandidateScore(membership, period, cutoffAt) {
  const end = membershipEndValue(membership);
  const cutoff = dateValue(cutoffAt || period && period.end_at);
  return (membershipCoversPeriod(membership, period, cutoffAt) ? 4 : 0)
    + (end > cutoff ? 2 : 0)
    + Math.min(membershipStartValue(membership) / 1e15, 1);
}

function uniqueReportMemberships(memberships, profilesByUid, period, cutoffAt) {
  const selected = new Map();
  (memberships || []).map(recordData).forEach((membership) => {
    const studentUid = text(membership.student_uid);
    const student = profilesByUid.get(studentUid);
    if (!studentUid || student && (student.role || "student") !== "student") return;
    if (!membershipOverlapsPeriod(membership, period, cutoffAt)) return;
    const existing = selected.get(studentUid);
    if (!existing || membershipCandidateScore(membership, period, cutoffAt) > membershipCandidateScore(existing, period, cutoffAt)) {
      selected.set(studentUid, membership);
    }
  });
  return [...selected.entries()].map(([student_uid, membership]) => ({
    student_uid,
    membership,
    student: profilesByUid.get(student_uid) || {
      auth_uid: student_uid,
      student_id: membership.student_id_snapshot || "",
      name: membership.student_name_snapshot || "",
      chinese_name: membership.chinese_name_snapshot || "",
      english_name: membership.english_name_snapshot || "",
      role: "student",
      active: false,
    },
  }));
}

function dateInRange(value, startAt, endAt) {
  const number = dateValue(value);
  return Boolean(number) && number >= dateValue(startAt) && number <= dateValue(endAt);
}

function assignmentDueInPeriod(assignment, period) {
  return dateInRange(assignment && assignment.due_at, period.start_at, period.end_at);
}

function assignmentPassedAt(assignment, attemptsByStudentSet, set, cutoffAt, scoreLockedAt, intensiveProgressByStudentSet) {
  const cutoff = dateValue(cutoffAt);
  if (familyForSet(set, assignment && assignment.set_id) === "intensive-listening") {
    const progress = currentIntensiveProgress(
      intensiveProgressByStudentSet && intensiveProgressByStudentSet.get(intensiveProgressKey(assignment.student_uid, assignment.set_id)),
      set
    );
    const progressDate = progress && (progress.completed_at || progress.updated_at);
    if (progress && dateValue(progressDate) > 0 && dateValue(progressDate) <= cutoff
      && Number(progress.percentage) >= passingPercentageForAssignment(assignment, set)) {
      return progress.completed_at || progress.updated_at;
    }
    const status = normalizedAssignmentStatus(assignment && assignment.status);
    if (status === "passed" && dateValue(assignment && assignment.completed_at) <= cutoff) {
      return assignment.completed_at;
    }
    return null;
  }
  const key = `${text(assignment && assignment.student_uid)}::${text(assignment && assignment.set_id)}`;
  const eligibleAttempts = (attemptsByStudentSet.get(key) || []).filter((attempt) =>
    dateValue(attempt.submitted_at) <= cutoff
    && (!scoreLockedAt || dateValue(attempt.submitted_at) <= dateValue(scoreLockedAt))
  );
  const progress = exerciseProgress.summarizeExerciseProgress(
    eligibleAttempts,
    {
      passingPercentage: passingPercentageForAssignment(assignment, set),
      masteryPercentage: 101,
      masteryEnabled: false,
      scoreLockedAt,
    }
  );
  if (progress && progress.passed) return progress.completed_at;
  const legacyPassed = eligibleAttempts
    .filter((attempt) => effectivePassed(attempt)
      && attempt.adjusted_percentage == null
      && attempt.display_percentage == null
      && attempt.percentage == null)
    .sort((left, right) => dateValue(left.submitted_at) - dateValue(right.submitted_at))[0];
  if (legacyPassed) return legacyPassed.submitted_at;
  const status = normalizedAssignmentStatus(assignment && assignment.status);
  if (status === "passed" && dateValue(assignment && assignment.completed_at) <= cutoff) {
    return assignment.completed_at;
  }
  return null;
}

function summaryFamilies(attempts, setById) {
  const buckets = new Map();
  (attempts || []).forEach((attempt) => {
    const family = familyForSet(setById.get(attempt.set_id), attempt.set_id);
    const bucket = buckets.get(family) || { family, attempt_count: 0, passed_attempt_count: 0 };
    bucket.attempt_count += 1;
    if (effectivePassed(attempt)) bucket.passed_attempt_count += 1;
    buckets.set(family, bucket);
  });
  return [...buckets.values()].sort((left, right) => left.family.localeCompare(right.family));
}

function activitySummary(attempts, setById) {
  const countable = (attempts || []).filter(countableAttempt);
  return {
    countable_attempt_count: countable.length,
    passed_attempt_count: countable.filter(effectivePassed).length,
    families: summaryFamilies(countable, setById),
  };
}

function selfStudySummary(attempts, setById, intensiveProgressByStudentSet, periodStart, cutoffAt, assignedSetIds = new Set()) {
  const countable = (attempts || []).filter((attempt) => countableAttempt(attempt) && !attempt.assignment_id);
  const completedSetIds = new Set(countable.filter(effectivePassed).map((attempt) => text(attempt.set_id)).filter(Boolean));
  const intensive = [];
  (intensiveProgressByStudentSet || new Map()).forEach((progress, key) => {
    const [studentUid, setId] = key.split("::");
    if (!studentUid || !setId || !setById.has(setId)) return;
    if (assignedSetIds.has(setId)) return;
    const set = setById.get(setId);
    if (familyForSet(set, setId) !== "intensive-listening") return;
    const current = currentIntensiveProgress(progress, set);
    const completionDate = current && (current.completed_at || current.updated_at);
    if (!current || !dateInRange(completionDate, periodStart, cutoffAt)
      || Number(current.percentage) < passingPercentageForAssignment({}, set)) return;
    intensive.push({
      set_id: setId,
      title: text(set.title) || setId,
      completion_percentage: Number(current.percentage) || 0,
      completed_unit_count: Number(current.completed_unit_count) || 0,
      independent_unit_count: Number(current.independent_unit_count) || 0,
      assisted_unit_count: Number(current.assisted_unit_count) || 0,
      completed_at: completionDate,
    });
  });
  return {
    self_study_attempt_count: countable.length,
    passed_self_study_attempt_count: countable.filter(effectivePassed).length,
    completed_self_study_item_count: completedSetIds.size + intensive.length,
    intensive_listening_completed_count: intensive.length,
    intensive_listening_items: intensive,
    families: summaryFamilies(countable, setById),
  };
}

function classTaskItemsForStudent(studentUid, classAssignments, attemptsByStudentSet, scoreLockByStudentSet, setById, cutoffAt, intensiveProgressByStudentSet) {
  const tasks = new Map();
  classAssignments.filter((assignment) => text(assignment.student_uid) === studentUid).forEach((assignment) => {
    const taskId = text(assignment.class_task_id || assignment.assignment_batch_id || assignment.assignment_id || assignment._id);
    if (!taskId) return;
    const entries = tasks.get(taskId) || [];
    entries.push(assignment);
    tasks.set(taskId, entries);
  });

  return [...tasks.entries()].map(([classTaskId, assignments]) => {
    const representative = assignments.slice().sort((left, right) =>
      dateValue(left.due_at) - dateValue(right.due_at)
    )[0];
    const set = setById.get(representative.set_id) || {};
    const progressKey = `${studentUid}::${text(representative.set_id)}`;
    const passedDates = assignments.map((assignment) => assignmentPassedAt(
      assignment,
      attemptsByStudentSet,
      set,
      cutoffAt,
      scoreLockByStudentSet.get(progressKey) || null,
      intensiveProgressByStudentSet
    ))
      .filter(Boolean)
      .sort((left, right) => dateValue(left) - dateValue(right));
    const isIntensive = familyForSet(set, representative.set_id) === "intensive-listening";
    const intensiveProgress = isIntensive && currentIntensiveProgress(
      intensiveProgressByStudentSet && intensiveProgressByStudentSet.get(intensiveProgressKey(studentUid, representative.set_id)),
      set
    );
    return {
      class_task_id: classTaskId,
      set_id: representative.set_id || "",
      title: text(set.title) || text(representative.set_id),
      family: familyForSet(set, representative.set_id),
      due_at: representative.due_at || null,
      passed: passedDates.length > 0,
      passed_at: passedDates[0] || null,
      ...(isIntensive ? {
        completion_percentage: Number(intensiveProgress && intensiveProgress.percentage) || 0,
        completed_unit_count: Number(intensiveProgress && intensiveProgress.completed_unit_count) || 0,
        independent_unit_count: Number(intensiveProgress && intensiveProgress.independent_unit_count) || 0,
        assisted_unit_count: Number(intensiveProgress && intensiveProgress.assisted_unit_count) || 0,
      } : {}),
    };
  }).sort((left, right) => dateValue(left.due_at) - dateValue(right.due_at)
    || left.title.localeCompare(right.title));
}

function sanitizeComment(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, 2000);
}

function sanitizeGoals(value) {
  const input = Array.isArray(value) ? value : [];
  return input.map((item) => sanitizeComment(item).slice(0, 240)).filter(Boolean).slice(0, 3);
}

function previousDetailMap(previousReport) {
  const map = new Map();
  if (!previousReport || previousReport.status !== "published") return map;
  (previousReport.student_details || []).forEach((detail) => {
    if (text(detail && detail.student_uid)) map.set(text(detail.student_uid), detail);
  });
  return map;
}

function preservedTeacherNotes(existingReport) {
  const map = new Map();
  (existingReport && existingReport.student_details || []).forEach((detail) => {
    const studentUid = text(detail && detail.student_uid);
    if (!studentUid) return;
    map.set(studentUid, {
      teacher_comment: sanitizeComment(detail.teacher_comment),
      teacher_goals: sanitizeGoals(detail.teacher_goals),
      comment_updated_at: detail.comment_updated_at || null,
    });
  });
  return map;
}

function buildReportSnapshot(options = {}) {
  const period = options.period;
  if (!period || !period.start_at || !period.end_at) throw new Error("REPORT_PERIOD_INVALID");
  const cutoffAt = validDate(options.cutoff_at || period.end_at);
  if (!cutoffAt) throw new Error("REPORT_DATE_INVALID");
  const classId = text(options.class_id || options.classRecord && options.classRecord.class_id);
  if (!classId) throw new Error("CLASS_ID_REQUIRED");

  const profilesByUid = new Map((options.students || []).map(recordData)
    .filter((student) => text(student.auth_uid))
    .map((student) => [text(student.auth_uid), student]));
  const setById = new Map((options.sets || []).map(recordData)
    .filter((set) => text(set.set_id))
    .map((set) => [text(set.set_id), set]));
  const reportMembers = uniqueReportMemberships(options.memberships || [], profilesByUid, period, cutoffAt);
  const memberUids = new Set(reportMembers.map((item) => item.student_uid));
  const attempts = (options.attempts || []).map(recordData)
    .filter((attempt) => memberUids.has(text(attempt.student_uid)));
  const intensiveProgressByStudentSet = new Map((options.intensive_progress || []).map(recordData)
    .filter((progress) => memberUids.has(text(progress.student_uid)) && text(progress.set_id))
    .map((progress) => [intensiveProgressKey(progress.student_uid, progress.set_id), progress]));
  const attemptsByStudentUid = new Map();
  const attemptsByStudentSet = new Map();
  attempts.forEach((attempt) => {
    const studentUid = text(attempt.student_uid);
    const ownAttempts = attemptsByStudentUid.get(studentUid) || [];
    ownAttempts.push(attempt);
    attemptsByStudentUid.set(studentUid, ownAttempts);
    const progressKey = `${studentUid}::${text(attempt.set_id)}`;
    const setAttempts = attemptsByStudentSet.get(progressKey) || [];
    setAttempts.push(attempt);
    attemptsByStudentSet.set(progressKey, setAttempts);
  });

  const scoreLockByStudentSet = new Map();
  (options.assignments || []).map(recordData).forEach((assignment) => {
    const set = setById.get(text(assignment.set_id));
    if (familyForSet(set, assignment.set_id) !== "bbc"
      || (assignment.mastery_locked !== true && assignment.answer_revealed !== true)) return;
    const value = assignment.mastery_locked_at || assignment.answer_revealed_at;
    if (!value) return;
    const key = `${text(assignment.student_uid)}::${text(assignment.set_id)}`;
    const current = scoreLockByStudentSet.get(key);
    if (!current || dateValue(value) < dateValue(current)) scoreLockByStudentSet.set(key, value);
  });

  const classAssignments = (options.assignments || []).map(recordData).filter((assignment) =>
    assignment.assignment_scope === "class"
    && text(assignment.class_id) === classId
    && text(assignment.class_task_id)
    && normalizedAssignmentStatus(assignment.status) !== "cancelled"
    && assignmentDueInPeriod(assignment, period)
  );
  const priorDetails = previousDetailMap(options.previous_report);
  const notes = preservedTeacherNotes(options.existing_report);
  const assignedSetIdsByStudent = new Map();
  (options.assignments || []).map(recordData).forEach((assignment) => {
    const studentUid = text(assignment.student_uid);
    const setId = text(assignment.set_id);
    if (!studentUid || !setId) return;
    const setIds = assignedSetIdsByStudent.get(studentUid) || new Set();
    setIds.add(setId);
    assignedSetIdsByStudent.set(studentUid, setIds);
  });
  const studentDetails = reportMembers.map(({ student_uid: studentUid, membership, student }) => {
    const personalAttempts = (attemptsByStudentUid.get(studentUid) || []).filter((attempt) =>
      dateInRange(attempt.submitted_at, period.start_at, cutoffAt)
    );
    const classTaskItems = classTaskItemsForStudent(
      studentUid,
      classAssignments,
      attemptsByStudentSet,
      scoreLockByStudentSet,
      setById,
      cutoffAt,
      intensiveProgressByStudentSet
    );
    const completedClassItemCount = classTaskItems.filter((item) => item.passed).length;
    const prior = priorDetails.get(studentUid);
    const note = notes.get(studentUid) || {};
    return {
      student_uid: studentUid,
      student_id_snapshot: text(membership.student_id_snapshot)
        || (/^__deleted__:/.test(text(student.student_id)) ? "" : text(student.student_id)),
      ...studentNames(student, membership),
      membership_id: text(membership.membership_id || membership._id),
      membership_started_at: membership.started_at || membership.created_at || null,
      membership_ended_at: membership.ended_at || null,
      ranking_eligible: membershipCoversPeriod(membership, period, cutoffAt),
      rank: null,
      class_task_summary: {
        assigned_class_item_count: classTaskItems.length,
        completed_class_item_count: completedClassItemCount,
        pending_class_item_count: Math.max(0, classTaskItems.length - completedClassItemCount),
        items: classTaskItems,
      },
      delta_completed_class_item_count: prior
        ? completedClassItemCount - Number(prior.class_task_summary && prior.class_task_summary.completed_class_item_count || 0)
        : null,
      actual_activity: activitySummary(personalAttempts, setById),
      self_study: selfStudySummary(
        personalAttempts,
        setById,
        new Map([...intensiveProgressByStudentSet].filter(([key]) => key.startsWith(`${studentUid}::`))),
        period.start_at,
        cutoffAt,
        assignedSetIdsByStudent.get(studentUid) || new Set()
      ),
      teacher_comment: note.teacher_comment || "",
      teacher_goals: note.teacher_goals || [],
      comment_updated_at: note.comment_updated_at || null,
    };
  });

  const ranked = studentDetails.filter((detail) => detail.ranking_eligible).sort((left, right) => {
    const completedDifference = right.class_task_summary.completed_class_item_count - left.class_task_summary.completed_class_item_count;
    if (completedDifference) return completedDifference;
    return left.display_name.localeCompare(right.display_name);
  });
  let previousCount = null;
  let currentRank = 0;
  ranked.forEach((detail, index) => {
    const count = detail.class_task_summary.completed_class_item_count;
    if (previousCount == null || count !== previousCount) currentRank = index + 1;
    detail.rank = currentRank;
    previousCount = count;
  });

  const leaderboard = ranked.map((detail) => ({
    student_uid: detail.student_uid,
    rank: detail.rank,
    chinese_name: detail.chinese_name,
    english_name: detail.english_name,
    display_name: detail.display_name,
    completed_class_item_count: detail.class_task_summary.completed_class_item_count,
    assigned_class_item_count: detail.class_task_summary.assigned_class_item_count,
    self_study_completed_count: detail.self_study.completed_self_study_item_count,
    delta_completed_class_item_count: detail.delta_completed_class_item_count,
  }));
  const membershipSnapshot = studentDetails.map((detail) => ({
    student_uid: detail.student_uid,
    membership_id: detail.membership_id,
    ranking_eligible: detail.ranking_eligible,
    membership_started_at: detail.membership_started_at,
    membership_ended_at: detail.membership_ended_at,
  }));

  return { membership_snapshot: membershipSnapshot, leaderboard, student_details: studentDetails };
}

function publicLeaderboard(leaderboard) {
  return (leaderboard || []).map((row) => ({
    rank: row.rank == null ? null : Number(row.rank),
    chinese_name: text(row.chinese_name),
    english_name: text(row.english_name),
    display_name: text(row.display_name),
    completed_class_item_count: Number(row.completed_class_item_count || 0),
    assigned_class_item_count: Number(row.assigned_class_item_count || 0),
    self_study_completed_count: Number(row.self_study_completed_count || 0),
    delta_completed_class_item_count: row.delta_completed_class_item_count == null
      ? null
      : Number(row.delta_completed_class_item_count),
  }));
}

function studentDetailView(detail) {
  if (!detail) return null;
  const {
    student_uid: _studentUid,
    student_id_snapshot: _studentId,
    membership_id: _membershipId,
    ...safeDetail
  } = detail;
  return safeDetail;
}

module.exports = {
  SHANGHAI_TIME_ZONE,
  SHANGHAI_OFFSET_MS,
  text,
  validDate,
  dateValue,
  shanghaiParts,
  shanghaiDate,
  periodForDate,
  previousPeriod,
  latestClosedPeriod,
  isPeriodClosed,
  reportIdFor,
  reportUrlFor,
  recordData,
  effectivePassed,
  countableAttempt,
  familyForSet,
  membershipOverlapsPeriod,
  membershipCoversPeriod,
  sanitizeComment,
  sanitizeGoals,
  buildReportSnapshot,
  publicLeaderboard,
  studentDetailView,
};
