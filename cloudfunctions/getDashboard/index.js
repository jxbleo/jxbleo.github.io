const cloudbase = require("@cloudbase/node-sdk");
const starRewards = require("../_shared/star-rewards");
const exerciseProgress = require("../_shared/exercise-progress");
const { summarizeSelfStudyAttempts } = require("./self-study-completions");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const _ = db.command;
const READ_PAGE_LIMIT = 500;
const SET_LOOKUP_CHUNK_SIZE = 100;
const VOCABULARY_TEST_SESSION_COLLECTION = "vocabulary_test_sessions";
const VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS = 60 * 1000;
const STAR_LEDGER_COLLECTION = "star_reward_ledger";
const STAR_REQUEST_COLLECTION = "star_redemption_requests";
const STAR_EVIDENCE_COLLECTION = "star_redemption_evidence";
const DASHBOARD_ASSIGNMENT_PAGE_SIZE = 10;

async function getAuthenticatedStudent() {
  const userInfo = await app.auth().getUserInfo();
  const uid = userInfo && (userInfo.uid || userInfo.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");
  const authUid = String(uid);
  const result = await db.collection("students").where({
    auth_uid: authUid,
    active: true,
  }).limit(1).get();
  if (!result.data || !result.data[0]) throw new Error("STUDENT_NOT_LINKED");
  const student = result.data[0];
  if (String(student.auth_uid || "") !== authUid) throw new Error("STUDENT_NOT_LINKED");
  if ((student.role || "student") !== "student") throw new Error("STUDENT_REQUIRED");
  return student;
}

async function getOne(collection, query) {
  const result = await db.collection(collection).where(query).limit(1).get();
  return result.data && result.data[0];
}

async function getAll(collection, options = {}) {
  const pageSize = Number(options.pageSize || READ_PAGE_LIMIT);
  let offset = 0;
  const output = [];
  while (true) {
    let query = db.collection(collection);
    if (options.where) query = query.where(options.where);
    if (options.orderBy) query = query.orderBy(options.orderBy.field, options.orderBy.direction || "asc");
    const result = await query.skip(offset).limit(pageSize).get();
    const rows = result.data || [];
    output.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return output;
}

async function getVisibleSetsByIds(setIds) {
  const ids = [...new Set((setIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const chunks = [];
  for (let index = 0; index < ids.length; index += SET_LOOKUP_CHUNK_SIZE) {
    chunks.push(ids.slice(index, index + SET_LOOKUP_CHUNK_SIZE));
  }
  const pages = await Promise.all(chunks.map((chunk) => getAll("sets", {
    where: {
      set_id: _.in(chunk),
      visible: true,
    },
    pageSize: SET_LOOKUP_CHUNK_SIZE,
  })));
  return pages.flat();
}

function effectivePercentage(attempt) {
  return Number(
    attempt.adjusted_percentage == null ? attempt.percentage || 0 : attempt.adjusted_percentage
  );
}

function effectivePassed(attempt) {
  return attempt.adjusted_passed == null ? attempt.passed === true : attempt.adjusted_passed === true;
}

function effectiveQuestionResults(attempt) {
  return attempt.adjusted_question_results || attempt.question_results || [];
}

function countsTowardStudentProgress(attempt) {
  return !attempt || attempt.mode !== "vocabulary_practice_timed";
}

function isVocabularySet(set) {
  if (!set) return false;
  return [
    set.section_id,
    set.section,
    set.type,
    set.course,
    set.category,
  ].some((value) => String(value || "").toLowerCase() === "vocabulary");
}

function isBbcSet(set) {
  if (!set) return false;
  if (/^BBC-/i.test(String(set.set_id || ""))) return true;
  return [
    set.section_id,
    set.section,
    set.type,
    set.course,
    set.category,
  ].some((value) => {
    const normalized = String(value || "").toLowerCase();
    return normalized === "bbc" || normalized === "bbc-six-minute-english";
  });
}

function isIeltsSet(set) {
  if (!set) return false;
  return [set.section_id, set.section, set.type, set.course, set.category].some((value) =>
    String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-").startsWith("ielts-")
  );
}

function defaultPassingPercentageForSet(set) {
  if (isVocabularySet(set)) return 90;
  if (isBbcSet(set)) return 80;
  return 50;
}

function defaultMasteryPercentageForSet(set) {
  if (isVocabularySet(set)) return 100;
  if (isBbcSet(set)) return 95;
  return 90;
}

function masteryPercentageForSet(set) {
  return Number(!set || set.mastery_percentage == null ? defaultMasteryPercentageForSet(set) : set.mastery_percentage);
}

function passingPercentageForSet(set) {
  return Number(!set || set.passing_percentage == null ? defaultPassingPercentageForSet(set) : set.passing_percentage);
}

function masteryPercentageForAssignment(assignment, set) {
  return Number(assignment && assignment.mastery_percentage != null
    ? assignment.mastery_percentage
    : masteryPercentageForSet(set));
}

function passingPercentageForAssignment(assignment, set) {
  return Number(assignment && assignment.passing_percentage != null
    ? assignment.passing_percentage
    : passingPercentageForSet(set));
}

function assignmentMasteryEnabled(assignment) {
  return Boolean(assignment && assignment.mastery_enabled === true);
}

function normalizedStatus(status, percentage, passingPercentage, masteryPercentage, assignment) {
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "mastered") return "mastered";
  if (assignmentMasteryEnabled(assignment) && percentage >= masteryPercentage) return "mastered";
  if (percentage >= passingPercentage) return "passed";
  if (status === "passed" || status === "done") return "passed";
  return "to_do";
}

function isCancelledAssignment(assignment) {
  return Boolean(
    assignment && (assignment.status === "cancelled" || assignment.status === "canceled")
  );
}

function displayPercentage(value) {
  return value == null ? null : Number(value);
}

function dateValue(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function shanghaiDateParts(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const output = {};
  parts.forEach((part) => {
    if (part.type !== "literal") output[part.type] = Number(part.value);
  });
  return output.year && output.month && output.day ? output : null;
}

function dueWeekEnd(value) {
  const parts = shanghaiDateParts(value);
  if (!parts) return null;
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const mondayIndex = (day.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + (6 - mondayIndex), 15, 59, 59));
}

function effectiveAssignmentDueAt(assignment) {
  const explicit = assignment && assignment.due_at ? new Date(assignment.due_at) : null;
  if (explicit && Number.isFinite(explicit.getTime())) return explicit;
  return dueWeekEnd(assignment && (assignment.assigned_at || assignment.created_at));
}

function clientInstanceId(event) {
  return String(event && event._client_instance_id || "").trim().slice(0, 128);
}

function isSameInstance(session, instanceId) {
  return Boolean(instanceId && session && session.client_instance_id && String(session.client_instance_id) === instanceId);
}

function appendIntegrityFlag(session, flag) {
  const flags = Array.isArray(session && session.integrity_flags)
    ? session.integrity_flags.map((item) => String(item || "")).filter(Boolean)
    : [];
  if (flag && !flags.includes(flag)) flags.push(flag);
  return flags;
}

function isMissingCollectionError(error) {
  const message = String(error && (error.message || error.code || error.errMsg || error) || "");
  return /COLLECTION.*NOT.*EXIST|collection.*not.*exist|collection.*not.*found/i.test(message);
}

async function markVocabularySessionAbandoned(session, reason) {
  if (!session || !session._id) return;
  const now = new Date();
  await db.collection(VOCABULARY_TEST_SESSION_COLLECTION).doc(session._id).update({
    status: "abandoned",
    abandoned_at: now,
    abandoned_reason: reason,
    integrity_flags: appendIntegrityFlag(session, reason),
    updated_at: now,
  });
}

async function activeVocabularySessions(studentUid) {
  const now = new Date();
  let result;
  try {
    result = await db.collection(VOCABULARY_TEST_SESSION_COLLECTION).where({
      student_uid: studentUid,
      status: "active",
    }).limit(100).get();
  } catch (error) {
    if (isMissingCollectionError(error)) return [];
    throw error;
  }
  const active = [];
  for (const session of result.data || []) {
    const expiresAt = dateValue(session.expires_at);
    const lastSeen = dateValue(session.last_heartbeat_at || session.started_at || session.created_at);
    if (expiresAt && now.getTime() > expiresAt) {
      await markVocabularySessionAbandoned(session, "time_expired");
      continue;
    }
    if (lastSeen && now.getTime() - lastSeen > VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS) {
      await markVocabularySessionAbandoned(session, "heartbeat_timeout");
      continue;
    }
    active.push(session);
  }
  return active;
}

async function assertNoOtherActiveVocabularyTest(student, event) {
  const instanceId = clientInstanceId(event);
  const active = await activeVocabularySessions(student.auth_uid);
  const other = active.find((session) => !isSameInstance(session, instanceId));
  if (other) throw new Error("VOCABULARY_TEST_DEVICE_BLOCKED");
}

function attemptCorrectCount(attempt) {
  return attempt.adjusted_correct_count == null
    ? attempt.correct_count
    : attempt.adjusted_correct_count;
}

function attemptQuestionCount(attempt) {
  return attempt.question_count == null
    ? (effectiveQuestionResults(attempt) || []).length
    : attempt.question_count;
}

function newestAttempt(attempts) {
  return attempts.slice().sort((left, right) =>
    dateValue(right.submitted_at) - dateValue(left.submitted_at)
  )[0] || null;
}

function bestAttempt(attempts) {
  return attempts.slice().sort((left, right) => {
    const byScore = effectivePercentage(right) - effectivePercentage(left);
    if (byScore) return byScore;
    return dateValue(right.submitted_at) - dateValue(left.submitted_at);
  })[0] || null;
}

function disputeStatusLabel(item) {
  if ((item.decision || "") === "keep" || item.status === "rejected") return "Original ruling kept";
  if ((item.decision || "") === "replace") return "Answer rule updated";
  if ((item.decision || "") === "add" || item.status === "approved") return "Accepted";
  return "Waiting for teacher";
}

function disputeSeen(item) {
  return item.student_seen === true || Boolean(item.student_seen_at);
}

function disputeBelongsToStudent(item, student) {
  const studentUid = String(student && student.auth_uid || "");
  return Boolean(studentUid && item && String(item.student_uid || "") === studentUid);
}

function filterDisputesForStudent(items, student) {
  return (items || []).filter((item) => disputeBelongsToStudent(item, student));
}

function disputeReplyView(item, set) {
  return {
    dispute_id: item.dispute_id || item._id,
    set_id: item.set_id,
    set_title: set && set.title || item.set_id,
    attempt_id: item.attempt_id || null,
    assignment_id: item.assignment_id || null,
    question_id: item.question_id,
    question_text: item.question_text_snapshot || "",
    submitted_answer: item.submitted_answer == null ? "" : item.submitted_answer,
    answer_snapshot: item.answer_snapshot == null ? null : item.answer_snapshot,
    student_reason: item.student_reason || "",
    status: item.status || "pending",
    decision: item.decision || null,
    decision_label: disputeStatusLabel(item),
    teacher_note: item.teacher_note || "",
    created_at: item.created_at || null,
    resolved_at: item.resolved_at || item.updated_at || null,
    student_seen: disputeSeen(item),
  };
}

function resolvedTeacherReplyItems(items, student) {
  return filterDisputesForStudent(items, student).filter((item) =>
    item && item.status !== "pending"
  ).sort((left, right) =>
    dateValue(right.resolved_at || right.updated_at) - dateValue(left.resolved_at || left.updated_at)
  );
}

async function getAttemptReview(student, event) {
  const attemptId = String(event.attempt_id || "");
  if (!attemptId) throw new Error("ATTEMPT_REQUIRED");
  const attempt = await getOne("attempts", {
    attempt_id: attemptId,
    student_uid: student.auth_uid,
  });
  if (!attempt) throw new Error("ATTEMPT_NOT_FOUND");
  const set = await getOne("sets", { set_id: attempt.set_id });
  const assignment = attempt.assignment_id ? await getOne("assignments", {
    assignment_id: attempt.assignment_id,
    student_uid: student.auth_uid,
  }) : null;
  const canShowFeedback = Boolean(
    assignment && assignment.answer_revealed === true ||
    effectivePassed(attempt) ||
    attempt.mastered === true
  );
  const disputeResult = await db.collection("answer_disputes").where({
    attempt_id: attemptId,
    student_uid: student.auth_uid,
  }).limit(100).get();
  const ownedDisputes = filterDisputesForStudent(disputeResult.data || [], student)
    .filter((item) => String(item.attempt_id || "") === attemptId);
  return {
    success: true,
    review: {
      attempt_id: attempt.attempt_id,
      set_id: attempt.set_id,
      set_title: set && set.title || attempt.set_id,
      percentage: effectivePercentage(attempt),
      grading_version: attempt.grading_version || "1",
      submitted_at: attempt.submitted_at || null,
      feedback_available: canShowFeedback,
      answers: effectiveQuestionResults(attempt).map((item) => ({
        question_id: item.question_id,
        question_text_snapshot: item.question_text_snapshot || "",
        submitted_answer: item.submitted_answer == null ? "" : item.submitted_answer,
        correct: item.correct === true,
        feedback_available: canShowFeedback,
        correct_answer: canShowFeedback && item.correct_answer != null ? item.correct_answer : null,
        explanation: canShowFeedback ? item.explanation || "" : "",
      })),
      disputes: ownedDisputes.map((item) => disputeReplyView(item, set)),
    },
  };
}

async function submitDispute(student, event) {
  const attemptId = String(event.attempt_id || "");
  const questionId = String(event.question_id || "");
  const reason = String(event.reason || "").trim().slice(0, 1000);
  const questionText = String(event.question_text || "").trim().slice(0, 2000);
  if (!attemptId || !questionId) throw new Error("DISPUTE_FIELDS_REQUIRED");

  const attempt = await getOne("attempts", {
    attempt_id: attemptId,
    student_uid: student.auth_uid,
  });
  if (!attempt) throw new Error("ATTEMPT_NOT_FOUND");
  const attemptSet = await getOne("sets", { set_id: attempt.set_id });
  if (isIeltsSet(attemptSet)) throw new Error("IELTS_ARGUE_NOT_AVAILABLE");
  const question = effectiveQuestionResults(attempt).find((item) =>
    String(item.question_id) === questionId
  );
  if (!question || question.correct === true) throw new Error("QUESTION_NOT_DISPUTABLE");
  if (await getOne("answer_disputes", { attempt_id: attemptId, question_id: questionId })) {
    throw new Error("DISPUTE_ALREADY_EXISTS");
  }

  const now = new Date();
  const disputeId = [attemptId, questionId].join("::");
  await db.collection("answer_disputes").add({
    dispute_id: disputeId,
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    set_id: attempt.set_id,
    attempt_id: attemptId,
    assignment_id: attempt.assignment_id || null,
    question_id: questionId,
    question_text_snapshot: questionText,
    submitted_answer: question.submitted_answer == null ? "" : question.submitted_answer,
    answer_snapshot: question.correct_answer == null ? null : question.correct_answer,
    explanation_snapshot: question.explanation || "",
    student_reason: reason,
    status: "pending",
    created_at: now,
    updated_at: now,
  });
  return { success: true, dispute_id: disputeId };
}

async function listDisputesForAttempt(student, event) {
  const attemptId = String(event.attempt_id || "");
  if (!attemptId) throw new Error("ATTEMPT_REQUIRED");
  const attempt = await getOne("attempts", {
    attempt_id: attemptId,
    student_uid: student.auth_uid,
  });
  if (!attempt) throw new Error("ATTEMPT_NOT_FOUND");
  const result = await db.collection("answer_disputes").where({
    attempt_id: attemptId,
    student_uid: student.auth_uid,
  }).limit(100).get();
  const ownedDisputes = filterDisputesForStudent(result.data || [], student)
    .filter((item) => String(item.attempt_id || "") === attemptId);
  return {
    success: true,
    disputes: ownedDisputes.map((item) => ({
      dispute_id: item.dispute_id || item._id,
      question_id: item.question_id,
      question_text: item.question_text_snapshot || "",
      submitted_answer: item.submitted_answer == null ? "" : item.submitted_answer,
      answer_snapshot: item.answer_snapshot == null ? null : item.answer_snapshot,
      status: item.status || "pending",
      decision: item.decision || null,
      decision_label: disputeStatusLabel(item),
      teacher_note: item.teacher_note || "",
      student_reason: item.student_reason || "",
      student_seen: disputeSeen(item),
      created_at: item.created_at || null,
      updated_at: item.updated_at || null,
      resolved_at: item.resolved_at || null,
    })),
  };
}

async function listTeacherReplies(student) {
  const rows = await getAll("answer_disputes", { where: {
    student_uid: student.auth_uid,
  } });
  const resolved = resolvedTeacherReplyItems(rows, student);
  const setIds = [...new Set(resolved.map((item) => item.set_id).filter(Boolean))];
  const setMap = new Map((await getVisibleSetsByIds(setIds)).map((set) => [set.set_id, set]));
  return resolved.map((item) => disputeReplyView(item, setMap.get(item.set_id)));
}

function assignmentViewFromStoredSummary(assignment, set, claimedAssignmentIds) {
  const passingPercentage = passingPercentageForAssignment(assignment, set);
  const masteryPercentage = masteryPercentageForAssignment(assignment, set);
  const assignmentId = assignment.assignment_id || assignment._id;
  const bestValue = assignment.best_percentage == null
    ? assignment.latest_percentage
    : assignment.best_percentage;
  const percentage = bestValue == null ? null : displayPercentage(bestValue);
  const status = normalizedStatus(
    assignment.status,
    Number(percentage || 0),
    passingPercentage,
    masteryPercentage,
    assignment
  );
  const completedAt = assignment.completed_at
    || (status === "passed" || status === "mastered" ? assignment.progress_updated_at || null : null);
  const masteredAt = assignment.mastered_at || (status === "mastered" ? completedAt : null);
  const bestAttemptId = assignment.best_attempt_id || assignment.latest_attempt_id || null;
  return {
    assignment_id: assignmentId,
    status,
    assigned_at: assignment.assigned_at || null,
    due_at: effectiveAssignmentDueAt(assignment),
    created_at: assignment.created_at || null,
    completed_at: completedAt,
    mastered_at: masteredAt,
    updated_at: assignment.best_improved_at || assignment.progress_updated_at || completedAt || null,
    best_improved_at: assignment.best_improved_at || null,
    latest_submitted_at: assignment.latest_submitted_at || null,
    attempt_count: Number(assignment.attempt_count || 0),
    latest_percentage: assignment.latest_percentage == null ? null : assignment.latest_percentage,
    best_percentage: percentage,
    best_correct_count: assignment.best_correct_count == null ? null : assignment.best_correct_count,
    best_question_count: assignment.best_question_count == null ? null : assignment.best_question_count,
    review_attempt_id: bestAttemptId,
    history_attempt_id: bestAttemptId,
    prefill_attempt_id: status === "passed" || status === "mastered" ? bestAttemptId : null,
    answer_revealed: assignment.answer_revealed === true,
    mastery_locked: assignment.mastery_locked === true,
    completed_before_assignment: Boolean(
      completedAt && assignment.created_at && dateValue(completedAt) < dateValue(assignment.created_at)
    ),
    star_claimed: claimedAssignmentIds.has(assignmentId),
    passing_percentage: passingPercentage,
    mastery_percentage: masteryPercentage,
    mastery_enabled: assignmentMasteryEnabled(assignment),
    teacher_replies: [],
    teacher_reply_count: 0,
    set: set || {
      set_id: assignment.set_id,
      title: assignment.set_id,
      link: "#",
    },
  };
}

function dedupeStoredAssignmentViews(views) {
  return [...views.reduce((groups, item) => {
    const setId = String(item && item.set && item.set.set_id || "");
    if (!setId) return groups;
    const current = groups.get(setId);
    if (!current) {
      groups.set(setId, item);
      return groups;
    }
    const itemOpen = item.status === "to_do";
    const currentOpen = current.status === "to_do";
    if (itemOpen !== currentOpen) {
      if (itemOpen) groups.set(setId, item);
      return groups;
    }
    if (dateValue(item.created_at || item.due_at) > dateValue(current.created_at || current.due_at)) {
      groups.set(setId, item);
    }
    return groups;
  }, new Map()).values()];
}

function shanghaiDateKey(value) {
  const parts = shanghaiDateParts(value);
  return parts
    ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
    : "";
}

function shanghaiWeekKeysFrom(value, offset = 0) {
  const parts = shanghaiDateParts(value);
  const today = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const mondayIndex = (today.getUTCDay() + 6) % 7;
  const start = new Date(today.getTime());
  start.setUTCDate(start.getUTCDate() - mondayIndex + (Number(offset || 0) * 7));
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 6);
  const key = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  return { start: key(start), end: key(end) };
}

function storedAssignmentBuckets(views) {
  const currentWeek = shanghaiWeekKeysFrom(new Date(), 0);
  const nextWeek = shanghaiWeekKeysFrom(new Date(), 1);
  const todo = views.filter((item) => item.status === "to_do").sort((left, right) => {
    const leftKey = shanghaiDateKey(left.due_at);
    const rightKey = shanghaiDateKey(right.due_at);
    const leftUpcoming = leftKey && leftKey > currentWeek.end ? 1 : 0;
    const rightUpcoming = rightKey && rightKey > currentWeek.end ? 1 : 0;
    if (leftUpcoming !== rightUpcoming) return leftUpcoming - rightUpcoming;
    return dateValue(left.due_at || left.created_at) - dateValue(right.due_at || right.created_at);
  });
  const finished = views.filter((item) => item.status === "passed" || item.status === "mastered")
    .sort((left, right) => dateValue(
      right.best_improved_at || right.completed_at || right.updated_at
    ) - dateValue(
      left.best_improved_at || left.completed_at || left.updated_at
    ));
  const realAssignments = views.filter((item) => item.assignment_id);
  const overdue = realAssignments.filter((item) =>
    item.status === "to_do" && dateValue(item.due_at) > 0 && dateValue(item.due_at) < Date.now()
  );
  const thisWeek = realAssignments.filter((item) => {
    const key = shanghaiDateKey(item.due_at);
    return key && key >= currentWeek.start && key <= currentWeek.end;
  });
  const nextWeekItems = realAssignments.filter((item) => {
    const key = shanghaiDateKey(item.due_at);
    return key && key >= nextWeek.start && key <= nextWeek.end;
  });
  return {
    todo,
    finished,
    counts: {
      todo: todo.filter((item) => {
        const key = shanghaiDateKey(item.due_at);
        return !key || key <= currentWeek.end;
      }).length,
      upcoming: todo.filter((item) => {
        const key = shanghaiDateKey(item.due_at);
        return key && key > currentWeek.end;
      }).length,
      finished: finished.length,
    },
    weekly: {
      overdue_count: overdue.length,
      this_week_total: thisWeek.length + overdue.length,
      this_week_finished: thisWeek.filter((item) => item.status === "passed" || item.status === "mastered").length,
      next_week_total: nextWeekItems.length,
      next_week_finished: nextWeekItems.filter((item) => item.status === "passed" || item.status === "mastered").length,
    },
  };
}

async function storedAssignmentSnapshot(student, claimedAssignmentIds = new Set(), providedAssignmentRows) {
  const assignmentRows = providedAssignmentRows || await getAll("assignments", { where: { student_uid: student.auth_uid } });
  const activeRows = assignmentRows.filter((assignment) => !isCancelledAssignment(assignment));
  const visibleSets = await getVisibleSetsByIds(activeRows.map((assignment) => assignment.set_id));
  const setMap = new Map(visibleSets.map((set) => [set.set_id, set]));
  return storedAssignmentBuckets(dedupeStoredAssignmentViews(activeRows.map((assignment) =>
    assignmentViewFromStoredSummary(assignment, setMap.get(assignment.set_id), claimedAssignmentIds)
  )));
}

function assignmentPage(bucket, cursorValue) {
  const cursor = Math.max(0, Number(cursorValue || 0));
  const items = bucket.slice(cursor, cursor + DASHBOARD_ASSIGNMENT_PAGE_SIZE);
  const nextCursor = cursor + items.length;
  return {
    items,
    total_count: bucket.length,
    next_cursor: nextCursor < bucket.length ? nextCursor : null,
    has_more: nextCursor < bucket.length,
  };
}

async function dashboardBootstrap(student) {
  const [assignmentRows, achievements, disputeRows] = await Promise.all([
    getAll("assignments", { where: { student_uid: student.auth_uid } }),
    getAll("student_set_achievements", { where: { student_uid: student.auth_uid } }),
    getAll("answer_disputes", { where: { student_uid: student.auth_uid } }),
  ]);
  const claimedAssignmentIds = new Set(normalizedStarBuckets(achievements).assignmentStars
    .map((item) => item.assignment_id)
    .filter(Boolean));
  const buckets = await storedAssignmentSnapshot(student, claimedAssignmentIds, assignmentRows);
  const resolvedReplies = resolvedTeacherReplyItems(disputeRows, student);
  const unreadReplies = resolvedReplies.filter((item) => !disputeSeen(item));
  return {
    success: true,
    bootstrap: true,
    assignments: assignmentPage(buckets.todo, 0).items.concat(assignmentPage(buckets.finished, 0).items),
    assignment_pages: {
      todo: assignmentPage(buckets.todo, 0),
      finished: assignmentPage(buckets.finished, 0),
    },
    assignment_counts: buckets.counts,
    weekly_summary: buckets.weekly,
    teacher_reply_count: resolvedReplies.length,
    teacher_reply_unread_count: unreadReplies.length,
    teacher_replies: unreadReplies.map((item) => disputeReplyView(item, null)),
    ...splitStarCounts(achievements),
  };
}

async function listAssignmentPage(student, event) {
  const kind = String(event.kind || "todo") === "finished" ? "finished" : "todo";
  const buckets = await storedAssignmentSnapshot(student);
  return { success: true, kind, page: assignmentPage(buckets[kind], event.cursor) };
}

async function markTeacherRepliesSeen(student, event) {
  const ids = Array.isArray(event.dispute_ids)
    ? event.dispute_ids.map((item) => String(item || "")).filter(Boolean)
    : [];
  if (!ids.length) return { success: true, seen_count: 0 };
  const rows = await getAll("answer_disputes", { where: {
    student_uid: student.auth_uid,
  } });
  const idSet = new Set(ids);
  const now = new Date();
  let seenCount = 0;
  for (const item of rows) {
    const disputeId = item.dispute_id || item._id;
    if (!disputeBelongsToStudent(item, student) || !idSet.has(disputeId) || item.status === "pending") continue;
    await db.collection("answer_disputes").doc(item._id).update({
      student_seen: true,
      student_seen_at: now,
      updated_at: now,
    });
    seenCount += 1;
  }
  return { success: true, seen_count: seenCount };
}

async function revealAnswers(student, event) {
  const assignmentId = String(event.assignment_id || "");
  if (!assignmentId) throw new Error("ASSIGNMENT_REQUIRED");
  const assignment = await getOne("assignments", {
    assignment_id: assignmentId,
    student_uid: student.auth_uid,
  });
  if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
  if (isCancelledAssignment(assignment)) throw new Error("ASSIGNMENT_CANCELLED");
  const set = await getOne("sets", { set_id: assignment.set_id });
  const masteryPercentage = masteryPercentageForAssignment(assignment, set);
  const now = new Date();
  const update = {
    answer_revealed: true,
    answer_revealed_at: assignment.answer_revealed_at || now,
    updated_at: now,
  };
  if (assignment.status !== "mastered") {
    update.mastery_locked = true;
    update.mastery_locked_at = assignment.mastery_locked_at || now;
    if (Number(assignment.best_percentage || 0) >= masteryPercentage) {
      update.best_percentage = masteryPercentage - 0.01;
    }
    if (Number(assignment.latest_percentage || 0) >= masteryPercentage) {
      update.latest_percentage = masteryPercentage - 0.01;
    }
  }
  await db.collection("assignments").doc(assignment._id).update(update);
  return { success: true };
}

async function starCount(student) {
  const rows = await getAll("student_set_achievements", { where: {
    student_uid: student.auth_uid,
  } });
  return rows.length;
}

function isSelfStudyAchievement(item) {
  return starRewards.isBlueAchievement(item);
}

function normalizedStarBuckets(achievements) {
  const buckets = starRewards.normalizedStarBuckets(achievements);
  return {
    assignmentStars: buckets.yellowStars,
    selfStudyStars: buckets.activeBlueStars,
    blueHistory: buckets.blueStars,
  };
}

function splitStarCounts(achievements) {
  return starRewards.splitStarCounts(achievements);
}

function starAchievementView(achievement, set, attempt) {
  const assignmentId = achievement.assignment_id || null;
  const earnedAt = achievement.first_earned_at
    || achievement.claimed_at
    || achievement.created_at
    || null;
  const percentage = achievement.best_percentage == null
    ? (attempt ? effectivePercentage(attempt) : null)
    : Number(achievement.best_percentage);
  return {
    achievement_id: achievement.achievement_id || achievement._id,
    star_type: starRewards.isYellowAchievement(achievement) ? "yellow" : "blue",
    legacy_star_type: assignmentId ? "assignment" : "self_study",
    source: achievement.source || (assignmentId ? "assignment_claim" : "self_study"),
    set_id: achievement.set_id,
    assignment_id: assignmentId,
    earned_at: earnedAt,
    best_percentage: percentage,
    best_attempt_id: achievement.best_attempt_id || null,
    status: achievement.status || (assignmentId ? "star" : "active"),
    reward_eligible: starRewards.isYellowAchievement(achievement),
    passing_percentage_snapshot: achievement.passing_percentage_snapshot == null ? null : Number(achievement.passing_percentage_snapshot),
    mastery_percentage_snapshot: achievement.mastery_percentage_snapshot == null ? null : Number(achievement.mastery_percentage_snapshot),
    converted_to_achievement_id: achievement.converted_to_achievement_id || null,
    converted_from_achievement_id: achievement.converted_from_achievement_id || null,
    converted_at: achievement.converted_at || null,
    set: set || {
      set_id: achievement.set_id,
      title: achievement.set_id,
      link: "#",
    },
  };
}

async function protectAssignmentStar(student, assignment, bestAttemptId, bestPercentage, earnedAt) {
  const set = await getOne("sets", { set_id: assignment.set_id });
  return starRewards.protectYellowStar({
    db,
    student,
    assignment,
    bestAttemptId,
    bestPercentage,
    now: earnedAt || new Date(),
    masteryEnabled: assignmentMasteryEnabled(assignment),
    passingPercentage: passingPercentageForAssignment(assignment, set),
    starRate: masteryPercentageForAssignment(assignment, set),
  });
}

async function protectSelfStudyStar(student, attempt, earnedAt) {
  const set = await getOne("sets", { set_id: attempt.set_id });
  return starRewards.protectBlueStar({
    db,
    student,
    attempt,
    now: earnedAt || new Date(),
    passingPercentage: passingPercentageForSet(set),
    masteryPercentage: masteryPercentageForSet(set),
  });
}

function randomRecordId(prefix) {
  const crypto = require("crypto");
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

async function appendLedgerEntry(collection, entry) {
  const existing = await collection.where({ ledger_id: entry.ledger_id }).limit(1).get();
  if (existing.data && existing.data[0]) return existing.data[0];
  await collection.add(entry);
  return entry;
}

async function syncYellowStarCredits(student, achievementRows) {
  const achievements = achievementRows || await getAll("student_set_achievements", { where: {
    student_uid: student.auth_uid,
  } });
  const ledger = await getAll(STAR_LEDGER_COLLECTION, { where: { student_uid: student.auth_uid } });
  const credited = new Set();
  ledger.forEach((entry) => {
    if (entry.entry_type !== "credit") return;
    (entry.achievement_ids || []).forEach((id) => credited.add(String(id)));
  });
  for (const achievement of starRewards.normalizedStarBuckets(achievements).yellowStars) {
    const id = starRewards.achievementId(achievement);
    if (!id || credited.has(id)) continue;
    const entry = starRewards.ledgerEntry({
      ledgerId: `credit::${id}`,
      studentUid: student.auth_uid,
      achievementIds: [id],
      entryType: "credit",
      actorUid: "system",
      reason: "Yellow STAR credit",
      createdAt: achievement.first_earned_at || achievement.created_at || new Date(),
    });
    await appendLedgerEntry(db.collection(STAR_LEDGER_COLLECTION), entry);
    ledger.push(entry);
    credited.add(id);
  }
  return ledger;
}

function redemptionRequestView(request) {
  return {
    request_id: request.request_id || request._id,
    reward_type: request.reward_type || "cash",
    star_count: Number(request.star_count || 0),
    status: request.status || "awaiting_proof",
    evidence_count: Number(request.evidence_count || 0),
    created_at: request.created_at || null,
    updated_at: request.updated_at || null,
    expires_at: request.expires_at || null,
    completed_at: request.completed_at || null,
    rejected_at: request.rejected_at || null,
    cancelled_at: request.cancelled_at || null,
    expired_at: request.expired_at || null,
    refunded_at: request.refunded_at || null,
    decision_reason: request.decision_reason || "",
    student_seen: request.student_seen !== false,
  };
}

async function releaseExpiredCashRequest(student, request) {
  if (!starRewards.isRequestExpired(request, new Date())) return false;
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(STAR_REQUEST_COLLECTION).where({
      request_id: request.request_id || request._id,
      student_uid: student.auth_uid,
    }).limit(1).get();
    const current = result.data && result.data[0];
    if (!current || !starRewards.isRequestExpired(current, new Date())) return;
    const now = new Date();
    const entry = starRewards.ledgerEntry({
      ledgerId: `release::${current.request_id}::expired`,
      studentUid: student.auth_uid,
      requestId: current.request_id,
      achievementIds: current.achievement_ids || [],
      entryType: "release",
      actorUid: "system",
      reason: "Cash Request expired",
      createdAt: now,
    });
    await appendLedgerEntry(transaction.collection(STAR_LEDGER_COLLECTION), entry);
    await transaction.collection(STAR_REQUEST_COLLECTION).doc(current._id).update({
      status: "expired",
      expired_at: now,
      updated_at: now,
      student_seen: false,
      student_seen_at: null,
    });
  });
  return true;
}

async function expireStudentCashRequests(student) {
  const rows = await getAll(STAR_REQUEST_COLLECTION, { where: { student_uid: student.auth_uid } });
  for (const request of rows) await releaseExpiredCashRequest(student, request);
}

async function createCashRequest(student, event) {
  const count = starRewards.wholeStarCount(event.star_count);
  await expireStudentCashRequests(student);
  const achievements = await getAll("student_set_achievements", { where: { student_uid: student.auth_uid } });
  await syncYellowStarCredits(student, achievements);
  const requestId = randomRecordId("cash");
  const now = new Date();
  await db.runTransaction(async (transaction) => {
    const openResult = await transaction.collection(STAR_REQUEST_COLLECTION).where({
      student_uid: student.auth_uid,
      status: _.in([...starRewards.OPEN_REQUEST_STATUSES]),
    }).limit(1).get();
    if (openResult.data && openResult.data[0]) throw new Error("CASH_REQUEST_ALREADY_OPEN");
    const achievementResult = await transaction.collection("student_set_achievements").where({
      student_uid: student.auth_uid,
    }).limit(500).get();
    const ledgerResult = await transaction.collection(STAR_LEDGER_COLLECTION).where({
      student_uid: student.auth_uid,
    }).limit(500).get();
    const available = starRewards.availableYellowAchievements(
      achievementResult.data || [],
      ledgerResult.data || []
    );
    if (count > available.length) throw new Error("STAR_BALANCE_INSUFFICIENT");
    const achievementIds = available.slice(0, count).map(starRewards.achievementId);
    const request = {
      request_id: requestId,
      student_uid: student.auth_uid,
      student_id_snapshot: student.student_id,
      student_name_snapshot: student.name || student.student_id,
      reward_type: "cash",
      star_count: count,
      achievement_ids: achievementIds,
      status: "awaiting_proof",
      evidence_count: 0,
      expires_at: starRewards.requestExpiresAt(now),
      student_seen: true,
      student_seen_at: now,
      created_at: now,
      updated_at: now,
    };
    await transaction.collection(STAR_REQUEST_COLLECTION).add(request);
    await transaction.collection(STAR_LEDGER_COLLECTION).add(starRewards.ledgerEntry({
      ledgerId: `reserve::${requestId}`,
      studentUid: student.auth_uid,
      requestId,
      achievementIds,
      entryType: "reserve",
      actorUid: student.auth_uid,
      reason: "Cash Request created",
      createdAt: now,
    }));
  });
  return { success: true, request_id: requestId };
}

async function cancelCashRequest(student, event) {
  const requestId = String(event.request_id || "");
  if (!requestId) throw new Error("CASH_REQUEST_REQUIRED");
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(STAR_REQUEST_COLLECTION).where({
      request_id: requestId,
      student_uid: student.auth_uid,
    }).limit(1).get();
    const request = result.data && result.data[0];
    if (!request) throw new Error("CASH_REQUEST_NOT_FOUND");
    if (request.status === "cancelled") return;
    if (!starRewards.isOpenRequest(request)) throw new Error("CASH_REQUEST_NOT_CANCELLABLE");
    const now = new Date();
    await appendLedgerEntry(transaction.collection(STAR_LEDGER_COLLECTION), starRewards.ledgerEntry({
      ledgerId: `release::${requestId}::cancelled`,
      studentUid: student.auth_uid,
      requestId,
      achievementIds: request.achievement_ids || [],
      entryType: "release",
      actorUid: student.auth_uid,
      reason: "Cancelled by student",
      createdAt: now,
    }));
    await transaction.collection(STAR_REQUEST_COLLECTION).doc(request._id).update({
      status: "cancelled",
      cancelled_at: now,
      updated_at: now,
      student_seen: true,
      student_seen_at: now,
    });
  });
  return { success: true };
}

function evidenceExtension(mimeType) {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mimeType] || "";
}

function uploadMetadataView(metadata, cloudPath) {
  const data = metadata && metadata.data || {};
  return {
    url: data.url,
    token: data.token,
    authorization: data.authorization,
    file_id: data.fileId,
    cos_file_id: data.cosFileId,
    cloud_path: cloudPath,
  };
}

async function beginCashEvidenceUpload(student, event) {
  const requestId = String(event.request_id || "");
  const mimeType = String(event.mime_type || "").toLowerCase();
  const originalName = String(event.file_name || "image").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const sizeBytes = Number(event.size_bytes || 0);
  const extension = evidenceExtension(mimeType);
  if (!requestId) throw new Error("CASH_REQUEST_REQUIRED");
  if (!extension || !Number.isFinite(sizeBytes) || sizeBytes < 1 || sizeBytes > starRewards.MAX_EVIDENCE_BYTES) {
    throw new Error("EVIDENCE_FILE_INVALID");
  }
  const request = await getOne(STAR_REQUEST_COLLECTION, { request_id: requestId, student_uid: student.auth_uid });
  if (!request) throw new Error("CASH_REQUEST_NOT_FOUND");
  if (!starRewards.isOpenRequest(request)) throw new Error("CASH_REQUEST_EVIDENCE_CLOSED");
  const evidenceRows = await getAll(STAR_EVIDENCE_COLLECTION, { where: { request_id: requestId } });
  const activeCount = evidenceRows.filter((item) => ["uploading", "active"].includes(item.status)).length;
  if (activeCount >= starRewards.EVIDENCE_LIMIT) throw new Error("EVIDENCE_LIMIT_REACHED");
  const evidenceId = randomRecordId("evidence");
  const root = `star-redemptions/${student.auth_uid}/${requestId}/${evidenceId}`;
  const originalCloudPath = `${root}/original.${extension}`;
  const displayCloudPath = `${root}/display.jpg`;
  const [originalMetadata, displayMetadata] = await Promise.all([
    app.getUploadMetadata({ cloudPath: originalCloudPath }),
    app.getUploadMetadata({ cloudPath: displayCloudPath }),
  ]);
  const now = new Date();
  await db.collection(STAR_EVIDENCE_COLLECTION).add({
    evidence_id: evidenceId,
    request_id: requestId,
    student_uid: student.auth_uid,
    uploader_uid: student.auth_uid,
    uploader_role: "student",
    status: "uploading",
    original_file_id: originalMetadata.data.fileId,
    display_file_id: displayMetadata.data.fileId,
    original_name: originalName,
    mime_type: mimeType,
    expected_size_bytes: sizeBytes,
    upload_expires_at: new Date(now.getTime() + starRewards.UPLOAD_TTL_MS),
    created_at: now,
    updated_at: now,
  });
  return {
    success: true,
    evidence_id: evidenceId,
    original_upload: uploadMetadataView(originalMetadata, originalCloudPath),
    display_upload: uploadMetadataView(displayMetadata, displayCloudPath),
  };
}

function fileInfoFor(result, fileId) {
  return (result && result.fileList || []).find((item) => item.fileID === fileId) || null;
}

async function finishCashEvidenceUpload(student, event) {
  const evidenceId = String(event.evidence_id || "");
  const evidence = await getOne(STAR_EVIDENCE_COLLECTION, { evidence_id: evidenceId, student_uid: student.auth_uid });
  if (!evidence) throw new Error("EVIDENCE_NOT_FOUND");
  if (evidence.status === "active") return { success: true };
  if (evidence.status !== "uploading" || new Date(evidence.upload_expires_at || 0).getTime() < Date.now()) {
    throw new Error("EVIDENCE_UPLOAD_EXPIRED");
  }
  const request = await getOne(STAR_REQUEST_COLLECTION, { request_id: evidence.request_id, student_uid: student.auth_uid });
  if (!request || !starRewards.isOpenRequest(request)) throw new Error("CASH_REQUEST_EVIDENCE_CLOSED");
  const info = await app.getFileInfo({ fileList: [evidence.original_file_id, evidence.display_file_id] });
  const original = fileInfoFor(info, evidence.original_file_id);
  const display = fileInfoFor(info, evidence.display_file_id);
  if (!original || !display || Number(original.size || 0) < 1 || Number(original.size || 0) > starRewards.MAX_EVIDENCE_BYTES
    || Number(display.size || 0) < 1 || Number(display.size || 0) > starRewards.DISPLAY_EVIDENCE_BYTES) {
    throw new Error("EVIDENCE_UPLOAD_INVALID");
  }
  const now = new Date();
  await db.collection(STAR_EVIDENCE_COLLECTION).doc(evidence._id).update({
    status: "active",
    size_bytes: Number(original.size || 0),
    display_size_bytes: Number(display.size || 0),
    uploaded_at: now,
    updated_at: now,
  });
  const activeRows = await getAll(STAR_EVIDENCE_COLLECTION, { where: { request_id: request.request_id } });
  const activeCount = activeRows.filter((item) => item.status === "active" || item.evidence_id === evidenceId).length;
  await db.collection(STAR_REQUEST_COLLECTION).doc(request._id).update({
    status: "awaiting_teacher",
    evidence_count: activeCount,
    updated_at: now,
  });
  return { success: true };
}

async function cashEvidenceViews(student, event) {
  const requestId = String(event.request_id || "");
  const request = await getOne(STAR_REQUEST_COLLECTION, { request_id: requestId, student_uid: student.auth_uid });
  if (!request) throw new Error("CASH_REQUEST_NOT_FOUND");
  const evidence = (await getAll(STAR_EVIDENCE_COLLECTION, { where: { request_id: requestId } }))
    .filter((item) => item.status === "active" || item.status === "superseded")
    .sort((left, right) => dateValue(left.created_at) - dateValue(right.created_at));
  if (!evidence.length) return { success: true, evidence: [] };
  const urls = await app.getTempFileURL({ fileList: evidence.map((item) => ({
    fileID: item.display_file_id || item.original_file_id,
    maxAge: 600,
  })) });
  const urlMap = new Map((urls.fileList || []).map((item) => [item.fileID, item.tempFileURL]));
  return {
    success: true,
    evidence: evidence.map((item) => ({
      evidence_id: item.evidence_id || item._id,
      uploader_role: item.uploader_role,
      status: item.status,
      original_name: item.original_name,
      uploaded_at: item.uploaded_at || item.created_at || null,
      url: urlMap.get(item.display_file_id || item.original_file_id) || "",
    })),
  };
}

async function supersedeCashEvidence(student, event) {
  const evidenceId = String(event.evidence_id || "");
  const evidence = await getOne(STAR_EVIDENCE_COLLECTION, {
    evidence_id: evidenceId,
    student_uid: student.auth_uid,
    uploader_uid: student.auth_uid,
  });
  if (!evidence) throw new Error("EVIDENCE_NOT_FOUND");
  if (evidence.status === "superseded") return { success: true };
  if (evidence.status !== "active") throw new Error("EVIDENCE_NOT_ACTIVE");
  const request = await getOne(STAR_REQUEST_COLLECTION, {
    request_id: evidence.request_id,
    student_uid: student.auth_uid,
  });
  if (!request || !starRewards.isOpenRequest(request)) throw new Error("CASH_REQUEST_EVIDENCE_CLOSED");
  const now = new Date();
  await db.collection(STAR_EVIDENCE_COLLECTION).doc(evidence._id).update({
    status: "superseded",
    superseded_at: now,
    superseded_by_uid: student.auth_uid,
    updated_at: now,
  });
  const rows = await getAll(STAR_EVIDENCE_COLLECTION, { where: { request_id: evidence.request_id } });
  const activeCount = rows.filter((item) => item.status === "active" && item.evidence_id !== evidenceId).length;
  await db.collection(STAR_REQUEST_COLLECTION).doc(request._id).update({
    status: activeCount > 0 ? "awaiting_teacher" : "awaiting_proof",
    evidence_count: activeCount,
    updated_at: now,
  });
  return { success: true };
}

async function markCashRequestsSeen(student, event) {
  const ids = new Set((Array.isArray(event.request_ids) ? event.request_ids : []).map(String));
  const rows = await getAll(STAR_REQUEST_COLLECTION, { where: { student_uid: student.auth_uid } });
  const now = new Date();
  let count = 0;
  for (const request of rows) {
    if (!ids.has(String(request.request_id || request._id)) || request.student_seen !== false) continue;
    await db.collection(STAR_REQUEST_COLLECTION).doc(request._id).update({
      student_seen: true,
      student_seen_at: now,
      updated_at: now,
    });
    count += 1;
  }
  return { success: true, seen_count: count };
}

async function studentRewardSnapshot(student, achievements) {
  try {
    await expireStudentCashRequests(student);
    const ledger = await syncYellowStarCredits(student, achievements);
    const requests = await getAll(STAR_REQUEST_COLLECTION, {
      where: { student_uid: student.auth_uid },
      orderBy: { field: "created_at", direction: "desc" },
    });
    const wallet = starRewards.walletProjection(ledger);
    return {
      available: true,
      wallet: {
        available_yellow_stars: Math.max(0, wallet.available),
        reserved_yellow_stars: Math.max(0, wallet.reserved),
        spent_yellow_stars: Math.max(0, wallet.spent),
        lifetime_yellow_stars: wallet.lifetimeEarned,
      },
      cash_requests: requests.map(redemptionRequestView),
      unread_count: requests.filter((request) => request.student_seen === false).length,
    };
  } catch (error) {
    console.error("STAR wallet unavailable", error);
    return {
      available: false,
      code: "STAR_WALLET_UNAVAILABLE",
      wallet: null,
      cash_requests: [],
      unread_count: 0,
    };
  }
}

async function claimStar(student, event) {
  const assignmentId = String(event.assignment_id || "");
  if (!assignmentId) throw new Error("ASSIGNMENT_REQUIRED");
  const assignment = await getOne("assignments", {
    assignment_id: assignmentId,
    student_uid: student.auth_uid,
  });
  if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
  if (assignment.status !== "mastered") throw new Error("ASSIGNMENT_NOT_MASTERED");

  const now = new Date();
  const protectedStar = await protectAssignmentStar(
    student,
    assignment,
    assignment.best_attempt_id || assignment.latest_attempt_id || null,
    Number(assignment.best_percentage || assignment.latest_percentage || 0),
    assignment.mastered_at || now
  );
  const achievements = await getAll("student_set_achievements", { where: {
    student_uid: student.auth_uid,
  } });
  return {
    success: true,
    star_achievement: protectedStar ? starAchievementView(protectedStar, null, null) : null,
    ...splitStarCounts(achievements),
  };
}

async function getAttemptForRetry(student, event) {
  const attemptId = String(event.attempt_id || "");
  if (!attemptId) throw new Error("ATTEMPT_REQUIRED");
  const attempt = await getOne("attempts", {
    attempt_id: attemptId,
    student_uid: student.auth_uid,
  });
  if (!attempt) throw new Error("ATTEMPT_NOT_FOUND");
  return {
    success: true,
    attempt: {
      attempt_id: attempt.attempt_id,
      set_id: attempt.set_id,
      answers: attempt.answers || {},
    },
  };
}

async function getLatestAttemptForSet(student, event) {
  const setId = String(event.set_id || "");
  if (!setId) throw new Error("SET_REQUIRED");
  const attempts = await getAll("attempts", {
    where: {
      student_uid: student.auth_uid,
      set_id: setId,
    },
  });
  const progressAttempts = attempts.filter(countsTowardStudentProgress);
  const best = progressAttempts.sort((left, right) => {
    const byScore = effectivePercentage(right) - effectivePercentage(left);
    if (byScore) return byScore;
    return dateValue(right.submitted_at) - dateValue(left.submitted_at);
  })[0] || null;
  return {
    success: true,
    attempt: best ? {
      attempt_id: best.attempt_id,
      set_id: best.set_id,
      assignment_id: best.assignment_id || null,
      percentage: effectivePercentage(best),
      passed: effectivePassed(best),
      mastered: best.mastered === true,
      submitted_at: best.submitted_at || null,
    } : null,
  };
}

exports.main = async (event = {}) => {
  try {
    const student = await getAuthenticatedStudent();
    await assertNoOtherActiveVocabularyTest(student, event);
    const action = String(event.action || "dashboard");
    if (action === "getAttemptReview") return await getAttemptReview(student, event);
    if (action === "submitDispute") return await submitDispute(student, event);
    if (action === "listDisputesForAttempt") return await listDisputesForAttempt(student, event);
    if (action === "dashboardBootstrap") return await dashboardBootstrap(student);
    if (action === "listAssignmentPage") return await listAssignmentPage(student, event);
    if (action === "listTeacherReplies") return {
      success: true,
      teacher_replies: await listTeacherReplies(student),
    };
    if (action === "markTeacherRepliesSeen") return await markTeacherRepliesSeen(student, event);
    if (action === "revealAnswers") return await revealAnswers(student, event);
    if (action === "getAttemptForRetry") return await getAttemptForRetry(student, event);
    if (action === "getLatestAttemptForSet") return await getLatestAttemptForSet(student, event);
    if (action === "claimStar") return await claimStar(student, event);
    if (action === "createCashRequest") return await createCashRequest(student, event);
    if (action === "cancelCashRequest") return await cancelCashRequest(student, event);
    if (action === "beginCashEvidenceUpload") return await beginCashEvidenceUpload(student, event);
    if (action === "finishCashEvidenceUpload") return await finishCashEvidenceUpload(student, event);
    if (action === "getCashEvidence") return await cashEvidenceViews(student, event);
    if (action === "supersedeCashEvidence") return await supersedeCashEvidence(student, event);
    if (action === "markCashRequestsSeen") return await markCashRequestsSeen(student, event);

    const [assignmentRows, attempts, disputeRows, achievements] = await Promise.all([
      getAll("assignments", { where: { student_uid: student.auth_uid } }),
      getAll("attempts", { where: { student_uid: student.auth_uid } }),
      getAll("answer_disputes", { where: { student_uid: student.auth_uid } }),
      getAll("student_set_achievements", { where: { student_uid: student.auth_uid } }),
    ]);
    const assignments = assignmentRows.sort((left, right) =>
      dateValue(effectiveAssignmentDueAt(right)) - dateValue(effectiveAssignmentDueAt(left))
    );
    const progressAttempts = attempts.filter(countsTowardStudentProgress);
    const setMap = new Map();
    const teacherReplyItems = resolvedTeacherReplyItems(disputeRows, student);
    const starBuckets = normalizedStarBuckets(achievements);
    const claimedAssignmentIds = new Set(starBuckets.assignmentStars
      .map((item) => item.assignment_id)
      .filter(Boolean));
    let selfStudyStars = starBuckets.selfStudyStars;
    const resourceAttempts = progressAttempts.filter((item) => !item.assignment_id && item.set_id);
    const setIds = [...new Set(
      assignments.map((item) => item.set_id)
        .concat(achievements.map((item) => item.set_id))
        .concat(resourceAttempts.map((item) => item.set_id))
        .concat(teacherReplyItems.map((item) => item.set_id))
        .filter(Boolean)
    )];

    const visibleSets = await getVisibleSetsByIds(setIds);
    visibleSets.forEach((set) => setMap.set(set.set_id, set));

    const assignmentStarSetIds = new Set(starBuckets.assignmentStars
      .map((item) => item.set_id)
      .filter(Boolean));
    const selfStudySetIds = new Set(selfStudyStars.map((item) => item.set_id).filter(Boolean));
    const scoreLockBySet = new Map();
    assignments.forEach((assignment) => {
      const set = setMap.get(assignment.set_id);
      if (!isBbcSet(set) || (assignment.mastery_locked !== true && assignment.answer_revealed !== true)) return;
      const value = assignment.mastery_locked_at || assignment.answer_revealed_at;
      if (!value) return;
      const current = scoreLockBySet.get(String(assignment.set_id));
      if (!current || dateValue(value) < dateValue(current)) scoreLockBySet.set(String(assignment.set_id), value);
    });
    const bestResourceAttemptsBySet = new Map();
    [...new Set(resourceAttempts.map((attempt) => String(attempt.set_id)))].forEach((setId) => {
      const set = setMap.get(setId);
      const masteryPercentage = set ? masteryPercentageForSet(set) : 90;
      const progress = exerciseProgress.summarizeExerciseProgress(
        resourceAttempts.filter((attempt) => String(attempt.set_id) === setId),
        {
          passingPercentage: set ? passingPercentageForSet(set) : 50,
          masteryPercentage,
          masteryEnabled: true,
          scoreLockedAt: scoreLockBySet.get(setId) || null,
        }
      );
      if (progress && progress.mastered && progress.best) bestResourceAttemptsBySet.set(setId, progress.best);
    });
    for (const [setId, attempt] of bestResourceAttemptsBySet.entries()) {
      if (assignmentStarSetIds.has(setId) || selfStudySetIds.has(setId)) continue;
      const protectedStar = await protectSelfStudyStar(
        student,
        attempt,
        attempt.submitted_at || new Date()
      );
      if (protectedStar) {
        achievements.push(protectedStar);
        selfStudyStars = selfStudyStars.concat(protectedStar);
        selfStudySetIds.add(setId);
      }
    }

    const attemptsBySet = new Map();
    progressAttempts.forEach((attempt) => {
      if (attempt.set_id) {
        const setItems = attemptsBySet.get(String(attempt.set_id)) || [];
        setItems.push(attempt);
        attemptsBySet.set(String(attempt.set_id), setItems);
      }
    });
    const teacherRepliesByAssignment = new Map();
    const teacherRepliesBySelfStudySet = new Map();
    teacherReplyItems.forEach((item) => {
      if (item.assignment_id) {
        const key = String(item.assignment_id);
        const items = teacherRepliesByAssignment.get(key) || [];
        items.push(item);
        teacherRepliesByAssignment.set(key, items);
        return;
      }
      if (item.set_id) {
        const key = String(item.set_id);
        const items = teacherRepliesBySelfStudySet.get(key) || [];
        items.push(item);
        teacherRepliesBySelfStudySet.set(key, items);
      }
    });

    const assignmentViews = [];
    for (const assignment of assignments) {
      if (isCancelledAssignment(assignment)) continue;
      const set = setMap.get(assignment.set_id);
      const passingPercentage = passingPercentageForAssignment(assignment, set);
      const masteryPercentage = masteryPercentageForAssignment(assignment, set);
      const assignmentId = assignment.assignment_id || assignment._id;
      const assignmentAttempts = attemptsBySet.get(String(assignment.set_id)) || [];
      const globalProgress = exerciseProgress.summarizeExerciseProgress(assignmentAttempts, {
        passingPercentage,
        masteryPercentage,
        masteryEnabled: assignmentMasteryEnabled(assignment),
        scoreLockedAt: scoreLockBySet.get(String(assignment.set_id)) || null,
      });
      const computedBestAttempt = globalProgress && globalProgress.best || bestAttempt(assignmentAttempts);
      const computedLatestAttempt = globalProgress && globalProgress.latest || newestAttempt(assignmentAttempts);
      const computedBestPercentage = computedBestAttempt ? effectivePercentage(computedBestAttempt) : null;
      const bestSource = computedBestAttempt || null;
      const fallbackLatestSource = computedLatestAttempt || null;
      const bestAttemptId = bestSource
        ? bestSource.attempt_id
        : (assignment.best_attempt_id || assignment.latest_attempt_id || (fallbackLatestSource && fallbackLatestSource.attempt_id) || null);
      const bestValue = bestSource
        ? computedBestPercentage
        : (assignment.best_percentage == null ? assignment.latest_percentage : assignment.best_percentage);
      const percentage = displayPercentage(bestValue);
      const status = normalizedStatus(assignment.status, Number(percentage || 0), passingPercentage, masteryPercentage, assignment);
      const completedAt = assignment.completed_at
        || (status === "passed" || status === "mastered"
          ? (computedBestAttempt && computedBestAttempt.submitted_at) || null
          : null);
      const masteredAt = assignment.mastered_at
        || (status === "mastered"
          ? (computedBestAttempt && computedBestAttempt.submitted_at) || completedAt
          : null);
      if (status === "mastered" && !claimedAssignmentIds.has(assignmentId)) {
        const protectedStar = await protectAssignmentStar(
          student,
          assignment,
          bestAttemptId,
          percentage,
          masteredAt || completedAt || new Date()
        );
        if (protectedStar) {
          achievements.push(protectedStar);
          claimedAssignmentIds.add(assignmentId);
          if (protectedStar.set_id) {
            assignmentStarSetIds.add(protectedStar.set_id);
            selfStudyStars = selfStudyStars.filter((item) => item.set_id !== protectedStar.set_id);
            selfStudySetIds.delete(protectedStar.set_id);
          }
        }
      }
      const teacherReplies = (teacherRepliesByAssignment.get(String(assignmentId)) || [])
        .map((item) => disputeReplyView(item, set));
      const dueAt = effectiveAssignmentDueAt(assignment);
      assignmentViews.push({
        assignment_id: assignmentId,
        status,
        assigned_at: assignment.assigned_at || null,
        due_at: dueAt,
        created_at: assignment.created_at || null,
        completed_at: completedAt,
        mastered_at: masteredAt,
        updated_at: globalProgress && globalProgress.best_improved_at
          || assignment.best_improved_at
          || assignment.progress_updated_at
          || completedAt
          || null,
        best_improved_at: globalProgress && globalProgress.best_improved_at || assignment.best_improved_at || null,
        latest_submitted_at: globalProgress && globalProgress.latest_submitted_at || null,
        attempt_count: globalProgress ? globalProgress.attempt_count : Math.max(Number(assignment.attempt_count || 0), assignmentAttempts.length),
        latest_percentage: assignment.latest_percentage == null
          ? (computedLatestAttempt ? effectivePercentage(computedLatestAttempt) : null)
          : assignment.latest_percentage,
        best_percentage: percentage,
        best_correct_count: assignment.best_correct_count == null
          ? (computedBestAttempt ? attemptCorrectCount(computedBestAttempt) : null)
          : assignment.best_correct_count,
        best_question_count: assignment.best_question_count == null
          ? (computedBestAttempt ? attemptQuestionCount(computedBestAttempt) : null)
          : assignment.best_question_count,
        review_attempt_id: bestAttemptId,
        history_attempt_id: bestAttemptId,
        prefill_attempt_id: status === "passed" || status === "mastered" ? bestAttemptId : null,
        answer_revealed: assignment.answer_revealed === true,
        mastery_locked: assignment.mastery_locked === true,
        completed_before_assignment: Boolean(
          completedAt && assignment.created_at && dateValue(completedAt) < dateValue(assignment.created_at)
        ),
        star_claimed: claimedAssignmentIds.has(assignment.assignment_id || assignment._id),
        passing_percentage: passingPercentage,
        mastery_percentage: masteryPercentage,
        mastery_enabled: assignmentMasteryEnabled(assignment),
        teacher_replies: teacherReplies,
        teacher_reply_count: teacherReplies.length,
        set: set || {
          set_id: assignment.set_id,
          title: assignment.set_id,
          link: "#",
        },
      });
    }
    const visibleAssignmentViews = [...assignmentViews.reduce((groups, item) => {
      const setId = String(item && item.set && item.set.set_id || "");
      if (!setId) return groups;
      const current = groups.get(setId);
      if (!current) {
        groups.set(setId, item);
        return groups;
      }
      const itemOpen = item.status === "to_do";
      const currentOpen = current.status === "to_do";
      if (itemOpen !== currentOpen) {
        if (itemOpen) groups.set(setId, item);
        return groups;
      }
      if (dateValue(item.created_at || item.due_at) > dateValue(current.created_at || current.due_at)) {
        groups.set(setId, item);
      }
      return groups;
    }, new Map()).values()];
    const representedFinishedAssignmentSetIds = new Set(visibleAssignmentViews
      .filter((assignment) => assignment && (assignment.status === "passed" || assignment.status === "mastered"))
      .map((assignment) => String(assignment.set && assignment.set.set_id || ""))
      .filter(Boolean));
    const selfStudyStarBySet = new Map(selfStudyStars
      .filter((achievement) => achievement && achievement.set_id)
      .map((achievement) => [String(achievement.set_id), achievement]));
    const resourceAttemptsBySet = new Map();
    resourceAttempts.forEach((attempt) => {
      const key = String(attempt.set_id);
      const items = resourceAttemptsBySet.get(key) || [];
      items.push(attempt);
      resourceAttemptsBySet.set(key, items);
    });
    const selfStudyCompletionSetIds = new Set([
      ...resourceAttemptsBySet.keys(),
      ...selfStudyStarBySet.keys(),
    ]);
    const selfStudyViews = [];
    for (const setId of selfStudyCompletionSetIds) {
      if (representedFinishedAssignmentSetIds.has(setId)) continue;
      const set = setMap.get(setId);
      if (!set) continue;
      const passingPercentage = passingPercentageForSet(set);
      const masteryPercentage = masteryPercentageForSet(set);
      const setAttempts = resourceAttemptsBySet.get(setId) || [];
      const summary = summarizeSelfStudyAttempts(setAttempts, passingPercentage);
      const achievement = selfStudyStarBySet.get(setId) || null;
      if (!summary && !achievement) continue;
      const bestAttempt = summary && summary.best || null;
      const latestAttempt = summary && summary.latest || null;
      const bestAttemptId = bestAttempt && bestAttempt.attempt_id || achievement && achievement.best_attempt_id || null;
      const achievementPercentage = achievement && achievement.best_percentage == null
        ? null
        : Number(achievement && achievement.best_percentage);
      const percentage = achievementPercentage == null
        ? summary && summary.best_percentage
        : Math.max(Number(summary && summary.best_percentage || 0), achievementPercentage);
      const completedAt = summary && summary.completed_at
        || achievement && (achievement.first_earned_at || achievement.created_at)
        || null;
      const masteredAt = achievement
        ? achievement.first_earned_at || achievement.created_at || completedAt
        : null;
      const teacherReplies = (teacherRepliesBySelfStudySet.get(setId) || [])
        .map((item) => disputeReplyView(item, set));
      const bestImprovedAt = bestAttempt && bestAttempt.submitted_at || completedAt;
      selfStudyViews.push({
        assignment_id: null,
        achievement_id: achievement && (achievement.achievement_id || achievement._id) || null,
        source: "self_study",
        status: achievement ? "mastered" : "passed",
        assigned_at: completedAt,
        due_at: null,
        completed_at: completedAt,
        mastered_at: masteredAt,
        updated_at: bestImprovedAt || masteredAt || completedAt,
        best_improved_at: bestImprovedAt || null,
        progress_updated_at: bestImprovedAt || null,
        latest_submitted_at: latestAttempt && latestAttempt.submitted_at || null,
        attempt_count: summary ? summary.attempt_count : 1,
        latest_percentage: summary ? summary.latest_percentage : percentage,
        best_percentage: percentage,
        best_correct_count: bestAttempt ? attemptCorrectCount(bestAttempt) : null,
        best_question_count: bestAttempt ? attemptQuestionCount(bestAttempt) : null,
        review_attempt_id: bestAttemptId,
        history_attempt_id: bestAttemptId,
        prefill_attempt_id: bestAttemptId,
        answer_revealed: false,
        mastery_locked: false,
        star_claimed: Boolean(achievement),
        passing_percentage: passingPercentage,
        mastery_percentage: masteryPercentage,
        mastery_enabled: true,
        teacher_replies: teacherReplies,
        teacher_reply_count: teacherReplies.length,
        set,
      });
    }
    const finalStarBuckets = normalizedStarBuckets(achievements);
    const libraryProgressBySet = new Map();
    progressAttempts.forEach((attempt) => {
      if (!attempt || !attempt.set_id) return;
      const key = String(attempt.set_id);
      const current = libraryProgressBySet.get(key) || {
        set_id: key,
        best_percentage: null,
        status: "not-passed",
        grading_version: null,
      };
      const percentage = effectivePercentage(attempt);
      if (current.best_percentage == null || percentage > current.best_percentage) {
        current.best_percentage = percentage;
        current.grading_version = attempt.grading_version || null;
      }
      if (attempt.mastered === true || attempt.adjusted_mastered === true) current.status = "mastered";
      else if (current.status !== "mastered" && effectivePassed(attempt)) current.status = "passed";
      libraryProgressBySet.set(key, current);
    });
    const attemptMap = new Map(attempts
      .filter((attempt) => attempt && attempt.attempt_id)
      .map((attempt) => [attempt.attempt_id, attempt]));
    const starAchievements = finalStarBuckets.assignmentStars
      .concat(finalStarBuckets.blueHistory)
      .map((achievement) => starAchievementView(
        achievement,
        setMap.get(achievement.set_id),
        attemptMap.get(achievement.best_attempt_id) || null
      ))
      .sort((left, right) => dateValue(right.earned_at) - dateValue(left.earned_at));
    const rewards = await studentRewardSnapshot(student, achievements);

    return {
      success: true,
      assignments: visibleAssignmentViews.concat(selfStudyViews),
      library_progress: [...libraryProgressBySet.values()],
      star_achievements: starAchievements,
      teacher_replies: teacherReplyItems.map((item) => disputeReplyView(item, setMap.get(item.set_id))),
      star_rewards: rewards,
      available_yellow_star_count: rewards.wallet ? rewards.wallet.available_yellow_stars : 0,
      ...splitStarCounts(achievements),
    };
  } catch (error) {
    const starMessages = {
      CASH_REQUEST_ALREADY_OPEN: "You already have an open Cash request.",
      CASH_REQUEST_NOT_FOUND: "This Cash request was not found.",
      CASH_REQUEST_NOT_CANCELLABLE: "This Cash request can no longer be cancelled.",
      CASH_REQUEST_EVIDENCE_CLOSED: "Photos can no longer be changed for this Cash request.",
      STAR_BALANCE_INSUFFICIENT: "You do not have enough available Yellow STARs.",
      STAR_COUNT_INVALID: "Choose a whole number of available Yellow STARs.",
      EVIDENCE_FILE_INVALID: "Choose a JPG, PNG, or WebP photo up to 10 MB.",
      EVIDENCE_LIMIT_REACHED: "A Cash request can keep up to three active photos.",
      EVIDENCE_UPLOAD_EXPIRED: "The photo upload expired. Please choose the photo again.",
      EVIDENCE_UPLOAD_INVALID: "The uploaded photo could not be verified.",
      EVIDENCE_NOT_FOUND: "This proof photo was not found.",
      EVIDENCE_NOT_ACTIVE: "This proof photo is no longer active.",
    };
    return {
      success: false,
      code: error.message,
      message: error.message === "AUTH_REQUIRED"
        ? "Please log in."
        : error.message === "VOCABULARY_TEST_DEVICE_BLOCKED"
        ? "This account is taking a vocabulary test on another device or browser tab. Please finish that test first."
        : starMessages[error.message] || "Unable to load assignments.",
      assignments: [],
    };
  }
};
