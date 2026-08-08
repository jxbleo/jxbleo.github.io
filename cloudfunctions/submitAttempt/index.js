const cloudbase = require("@cloudbase/node-sdk");
const starRewards = require("../_shared/star-rewards");
const exerciseProgress = require("../_shared/exercise-progress");
const {
  assertVocabularyContentVersion,
  buildVocabularyGradingSnapshot,
  gradingKeyFromSessionSnapshot,
} = require("./vocabulary-versioning");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const READ_PAGE_LIMIT = 500;
const VOCABULARY_TEST_SESSION_COLLECTION = "vocabulary_test_sessions";
const VOCABULARY_TEST_MIN_GROUPS = 5;
const VOCABULARY_TEST_SECONDS_PER_GROUP = 90;
const VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS = 60 * 1000;
const VOCABULARY_TEST_SUBMIT_GRACE_MS = 30 * 1000;

function normalize(value) {
  return String(value == null ? "" : value).trim().toLowerCase().replace(/\s+/g, " ");
}

function isCorrect(submitted, expected) {
  const accepted = Array.isArray(expected) ? expected : [expected];
  return accepted.some((answer) => normalize(answer) === normalize(submitted));
}

async function getAuthenticatedStudent() {
  const userInfo = await app.auth().getUserInfo();
  const uid = userInfo && (userInfo.uid || userInfo.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");
  const result = await db.collection("students").where({
    auth_uid: String(uid),
    active: true,
  }).limit(1).get();
  const student = result.data && result.data[0];
  if (!student) throw new Error("STUDENT_NOT_LINKED");
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

function effectivePercentage(attempt) {
  return Number(
    attempt.adjusted_percentage == null ? attempt.percentage || 0 : attempt.adjusted_percentage
  );
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

function passingPercentageForAssignment(assignment, set) {
  return Number(assignment && assignment.passing_percentage != null
    ? assignment.passing_percentage
    : passingPercentageForSet(set));
}

function masteryPercentageForAssignment(assignment, set) {
  return Number(assignment && assignment.mastery_percentage != null
    ? assignment.mastery_percentage
    : masteryPercentageForSet(set));
}

function assignmentMasteryLocked(assignment) {
  return Boolean(assignment && assignment.mastery_locked === true && assignment.status !== "mastered");
}

function assignmentMasteryEnabled(assignment) {
  return Boolean(assignment && assignment.mastery_enabled === true);
}

function displayPercentage(rawPercentage, assignment, masteryPercentage) {
  return assignmentMasteryLocked(assignment) && rawPercentage >= masteryPercentage ? masteryPercentage - 0.01 : rawPercentage;
}

function statusForPercentage(rawPercentage, passingPercentage, masteryPercentage, assignment) {
  if (assignmentMasteryEnabled(assignment) && !assignmentMasteryLocked(assignment) && rawPercentage >= masteryPercentage) return "mastered";
  if (displayPercentage(rawPercentage, assignment, masteryPercentage) >= passingPercentage) return "passed";
  return "to_do";
}

function normalizedAssignmentStatus(status) {
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "mastered") return "mastered";
  if (status === "passed" || status === "done") return "passed";
  return "to_do";
}

function statusRank(status) {
  const normalized = normalizedAssignmentStatus(status);
  if (normalized === "mastered") return 2;
  if (normalized === "passed") return 1;
  return 0;
}

function monotonicAssignmentStatus(currentStatus, attemptStatus) {
  if (normalizedAssignmentStatus(currentStatus) === "cancelled") return "cancelled";
  return statusRank(currentStatus) > statusRank(attemptStatus)
    ? normalizedAssignmentStatus(currentStatus)
    : normalizedAssignmentStatus(attemptStatus);
}

function isOpenAssignment(assignment) {
  return ["not_done", "failed", "to_do"].includes(assignment && (assignment.status || "to_do"));
}

function isCancelledAssignment(assignment) {
  return normalizedAssignmentStatus(assignment && assignment.status) === "cancelled";
}

function dateValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function uniqueStrings(values, limit = 500) {
  const seen = new Set();
  const output = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    output.push(text);
  });
  return output.slice(0, limit);
}

function sameStringList(left, right) {
  const leftList = uniqueStrings(left);
  const rightList = uniqueStrings(right);
  if (leftList.length !== rightList.length) return false;
  const rightSet = new Set(rightList);
  return leftList.every((value) => rightSet.has(value));
}

function clientIds(event) {
  return {
    deviceId: String(event && event._client_device_id || "").trim().slice(0, 128),
    instanceId: String(event && event._client_instance_id || "").trim().slice(0, 128),
  };
}

function requireClientInstance(event) {
  const ids = clientIds(event);
  if (!ids.instanceId) throw new Error("CLIENT_SESSION_REQUIRED");
  return ids;
}

function isSessionOwner(session, ids) {
  return Boolean(
    session
      && ids
      && ids.instanceId
      && session.client_instance_id
      && String(session.client_instance_id) === ids.instanceId
  );
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

function sessionHeartbeatExpired(session, now) {
  const lastSeen = dateValue(session.last_heartbeat_at || session.started_at || session.created_at);
  return Boolean(lastSeen && now.getTime() - lastSeen > VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS);
}

function sessionTimeExpired(session, now) {
  const expiresAt = dateValue(session.expires_at);
  return Boolean(expiresAt && now.getTime() > expiresAt);
}

function sessionView(session) {
  return {
    test_session_id: session.test_session_id,
    set_id: session.set_id,
    assignment_id: session.assignment_id || null,
    status: session.status || "active",
    selected_group_count: Number(session.selected_group_count || 0),
    selected_group_ids: session.selected_group_ids || [],
    question_ids: session.question_ids || [],
    grading_version: session.grading_version || null,
    started_at: session.started_at || null,
    due_at: session.due_at || null,
    expires_at: session.expires_at || null,
    last_heartbeat_at: session.last_heartbeat_at || null,
  };
}

async function markVocabularySessionEnded(session, status, reason, extra = {}) {
  if (!session || !session._id) return;
  const now = new Date();
  const update = {
    status,
    updated_at: now,
    ...extra,
  };
  if (status === "abandoned") {
    update.abandoned_at = extra.abandoned_at || now;
    update.abandoned_reason = reason || extra.abandoned_reason || "abandoned";
    update.integrity_flags = appendIntegrityFlag(session, reason);
  }
  if (status === "invalidated") {
    update.invalidated_at = extra.invalidated_at || now;
    update.invalidated_reason = reason || extra.invalidated_reason || "invalidated";
    update.integrity_flags = appendIntegrityFlag(session, reason);
  }
  if (status === "submitted") {
    update.submitted_at = extra.submitted_at || now;
  }
  await db.collection(VOCABULARY_TEST_SESSION_COLLECTION).doc(session._id).update(update);
}

async function activeVocabularySessions(studentUid, now = new Date()) {
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
  for (const raw of result.data || []) {
    const session = normalizeRecord(raw);
    if (sessionTimeExpired(session, now)) {
      await markVocabularySessionEnded(session, "abandoned", "time_expired");
      continue;
    }
    if (sessionHeartbeatExpired(session, now)) {
      await markVocabularySessionEnded(session, "abandoned", "heartbeat_timeout");
      continue;
    }
    active.push(session);
  }
  return active;
}

async function assertNoOtherActiveVocabularyTest(student, event) {
  const ids = clientIds(event);
  const active = await activeVocabularySessions(student.auth_uid);
  const other = active.find((session) => !isSessionOwner(session, ids));
  if (other) throw new Error("VOCABULARY_TEST_DEVICE_BLOCKED");
}

async function assertNoActiveVocabularySelfTestLeak(student, event, setId) {
  const active = await activeVocabularySessions(student.auth_uid);
  const sameSet = active.find((session) => String(session.set_id || "") === String(setId || ""));
  if (sameSet) throw new Error("VOCABULARY_TEST_ACTIVE");
}

async function findOpenAssignmentForSet(studentUid, setId) {
  const result = await db.collection("assignments").where({
    student_uid: studentUid,
    set_id: setId,
  }).limit(100).get();
  const openAssignments = (result.data || [])
    .map(normalizeRecord)
    .filter(isOpenAssignment)
    .sort((left, right) =>
      dateValue(right.due_at || right.assigned_at || right.created_at) - dateValue(left.due_at || left.assigned_at || left.created_at)
    );
  return openAssignments[0] || null;
}

function gradeAnswers(submittedAnswers, gradingKey, mode, allowedQuestionIds) {
  const answers = gradingKey.answers || {};
  const explanations = gradingKey.explanations || {};
  const constrainedQuestionIds = Array.isArray(allowedQuestionIds) && allowedQuestionIds.length
    ? allowedQuestionIds
    : null;
  const questionIds = constrainedQuestionIds
    ? constrainedQuestionIds.filter((questionId) => Object.prototype.hasOwnProperty.call(answers, questionId))
    : mode === "vocabulary_test" || mode === "vocabulary_practice" || mode === "vocabulary_practice_timed"
    ? Object.keys(submittedAnswers).filter((questionId) => Object.prototype.hasOwnProperty.call(answers, questionId))
    : Object.keys(answers);
  const results = questionIds.map((questionId) => {
    const correct = isCorrect(submittedAnswers[questionId], answers[questionId]);
    return {
      question_id: questionId,
      submitted_answer: submittedAnswers[questionId] == null ? "" : submittedAnswers[questionId],
      correct,
      correct_answer: answers[questionId],
      explanation: explanations[questionId] || "",
    };
  });
  const correctCount = results.filter((item) => item.correct).length;
  const percentage = questionIds.length ? Math.round(correctCount / questionIds.length * 10000) / 100 : 0;
  return { results, correctCount, questionCount: questionIds.length, percentage };
}

function attachQuestionSnapshots(results, snapshots) {
  const source = snapshots && typeof snapshots === "object" && !Array.isArray(snapshots) ? snapshots : {};
  return (results || []).map((item) => ({
    ...item,
    question_text_snapshot: String(source[item.question_id] || "").trim().slice(0, 2000),
  }));
}

function assertSetContentVersion(event, set, gradingKey) {
  const expected = String(set && set.content_version || "").trim();
  if (!expected) return null;
  const submitted = String(event && event.content_version || "").trim();
  const gradingVersion = String(gradingKey && gradingKey.grading_version || "1").trim();
  if (!submitted || submitted !== expected || gradingVersion !== expected) {
    throw new Error("CONTENT_OUTDATED");
  }
  return expected;
}

function isBbcMultipleChoiceQuestion(questionId) {
  return /^mc-/i.test(String(questionId || ""));
}

function bbcMultipleChoiceQuestionIds(gradingKey) {
  return Object.keys((gradingKey && gradingKey.answers) || {}).filter(isBbcMultipleChoiceQuestion);
}

function normalizeRecord(record) {
  return record && record.data && typeof record.data === "object"
    ? { ...record.data, _id: record._id }
    : record;
}

function lockedBbcMultipleChoiceAnswers(previousAttempts, questionIds) {
  const locked = {};
  const mcIds = new Set(questionIds || []);
  (previousAttempts || [])
    .map(normalizeRecord)
    .sort((left, right) => new Date(left.submitted_at || 0) - new Date(right.submitted_at || 0))
    .forEach((attempt) => {
      const answers = attempt && attempt.bbc_mc_locked_answers && typeof attempt.bbc_mc_locked_answers === "object"
        ? attempt.bbc_mc_locked_answers
        : attempt && attempt.answers && typeof attempt.answers === "object"
          ? attempt.answers
          : {};
      (questionIds && questionIds.length ? questionIds : Object.keys(answers)).forEach((questionId) => {
        if (!mcIds.size && !isBbcMultipleChoiceQuestion(questionId)) return;
        if (mcIds.size && !mcIds.has(questionId)) return;
        if (Object.prototype.hasOwnProperty.call(locked, questionId)) return;
        if (!Object.prototype.hasOwnProperty.call(answers, questionId)) return;
        locked[questionId] = answers[questionId] == null ? "" : answers[questionId];
      });
    });
  return locked;
}

function bbcMultipleChoiceAnswers(answers, questionIds) {
  const locked = {};
  (questionIds && questionIds.length ? questionIds : Object.keys(answers || {})).forEach((questionId) => {
    if (!isBbcMultipleChoiceQuestion(questionId)) return;
    locked[questionId] = answers && answers[questionId] != null ? answers[questionId] : "";
  });
  return locked;
}

function attemptDisplayPercentage(attempt) {
  return Number(attempt.display_percentage == null ? attempt.percentage || 0 : attempt.display_percentage);
}

function attemptRawPercentage(attempt) {
  return Number(attempt.raw_percentage == null ? attemptDisplayPercentage(attempt) : attempt.raw_percentage);
}

function globalScoreLockAt(set, assignments) {
  if (!isBbcSet(set)) return null;
  return (assignments || [])
    .filter((item) => item && (item.mastery_locked === true || item.answer_revealed === true))
    .map((item) => item.mastery_locked_at || item.answer_revealed_at)
    .filter(Boolean)
    .sort((left, right) => dateValue(left) - dateValue(right))[0] || null;
}

function globalAssignmentSummary(assignment, set, attempts, scoreLockedAt) {
  const passingPercentage = passingPercentageForAssignment(assignment, set);
  const masteryPercentage = masteryPercentageForAssignment(assignment, set);
  const progress = exerciseProgress.summarizeExerciseProgress(attempts, {
    passingPercentage,
    masteryPercentage,
    masteryEnabled: assignmentMasteryEnabled(assignment),
    scoreLockedAt,
  });
  if (!progress) return null;
  const status = monotonicAssignmentStatus(assignment.status, progress.status);
  return {
    progress,
    status,
    update: {
      status,
      attempt_count: progress.attempt_count,
      latest_attempt_id: progress.latest_attempt_id,
      latest_percentage: progress.latest_percentage,
      latest_raw_percentage: progress.latest_raw_percentage,
      best_attempt_id: progress.best_attempt_id,
      best_percentage: progress.best_percentage,
      raw_best_percentage: progress.raw_best_percentage,
      best_correct_count: progress.best ? progress.best.correct_count : null,
      best_question_count: progress.best ? progress.best.question_count : null,
      best_improved_at: progress.best_improved_at,
      progress_updated_at: progress.best_improved_at,
      completed_at: assignment.completed_at || progress.completed_at,
      mastered_at: assignment.mastered_at || progress.mastered_at,
      completed_before_assignment: Boolean(
        progress.completed_at
        && assignment.created_at
        && dateValue(progress.completed_at) < dateValue(assignment.created_at)
      ),
      updated_at: new Date(),
    },
  };
}

function isSelfStudyAchievement(item) {
  return starRewards.isBlueAchievement(item);
}

async function protectSelfStudyStar(student, attempt, now) {
  const set = await getOne("sets", { set_id: attempt.set_id });
  return starRewards.protectBlueStar({
    db,
    student,
    attempt: { ...attempt, percentage: Number(attempt.display_percentage || attempt.percentage || 0) },
    now,
    passingPercentage: passingPercentageForSet(set),
    masteryPercentage: masteryPercentageForSet(set),
  });
}

async function protectAssignmentStar(student, assignment, attempt, now) {
  const set = await getOne("sets", { set_id: assignment.set_id });
  return starRewards.protectYellowStar({
    db,
    student,
    assignment,
    attempt,
    bestPercentage: Number(attempt.display_percentage || attempt.percentage || 0),
    now,
    masteryEnabled: assignmentMasteryEnabled(assignment),
    passingPercentage: passingPercentageForAssignment(assignment, set),
    starRate: masteryPercentageForAssignment(assignment, set),
  });
}

async function resolveAssignment(student, setId, assignmentId) {
  let resolvedAssignmentId = assignmentId ? String(assignmentId) : null;
  let assignment = null;
  if (resolvedAssignmentId) {
    assignment = await getOne("assignments", {
      assignment_id: resolvedAssignmentId,
      student_uid: student.auth_uid,
      set_id: setId,
    });
    if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
    if (isCancelledAssignment(assignment)) throw new Error("ASSIGNMENT_CANCELLED");
  } else {
    assignment = await findOpenAssignmentForSet(student.auth_uid, setId);
    if (assignment) resolvedAssignmentId = String(assignment.assignment_id || assignment._id);
  }
  return { assignment, assignmentId: resolvedAssignmentId };
}

function vocabularySessionId(student, setId) {
  return [
    "vocabtest",
    student.auth_uid,
    setId,
    Date.now(),
    Math.random().toString(36).slice(2, 8),
  ].join("-");
}

async function checkVocabularyTestAccess(student, event) {
  const ids = clientIds(event);
  const active = await activeVocabularySessions(student.auth_uid);
  const other = active.find((session) => !isSessionOwner(session, ids));
  if (other) {
    return {
      success: false,
      code: "VOCABULARY_TEST_DEVICE_BLOCKED",
      message: "A vocabulary test is already in progress on another device or browser tab.",
      active_session: sessionView(other),
    };
  }
  return {
    success: true,
    active_session: active.find((session) => isSessionOwner(session, ids))
      ? sessionView(active.find((session) => isSessionOwner(session, ids)))
      : null,
  };
}

function validateVocabularyQuestionIds(gradingKey, questionIds) {
  const answerMap = gradingKey.answers || {};
  const missing = questionIds.filter((questionId) => !Object.prototype.hasOwnProperty.call(answerMap, questionId));
  if (missing.length) throw new Error("VOCABULARY_TEST_QUESTION_MISMATCH");
}

async function startVocabularyTestSession(student, event) {
  const ids = requireClientInstance(event);
  const setId = String(event.set_id || "").trim();
  const selectedGroupIds = uniqueStrings(event.selected_group_ids, 80);
  const questionIds = uniqueStrings(event.question_ids, 1000);
  const requestedGroupCount = Number(event.selected_group_count || selectedGroupIds.length || 0);
  const selectedGroupCount = selectedGroupIds.length;
  if (!setId) throw new Error("SET_REQUIRED");
  if (requestedGroupCount && requestedGroupCount !== selectedGroupCount) throw new Error("VOCABULARY_TEST_GROUP_MISMATCH");
  if (selectedGroupCount < VOCABULARY_TEST_MIN_GROUPS) throw new Error("VOCABULARY_TEST_SESSION_NOT_REQUIRED");
  if (selectedGroupIds.length < VOCABULARY_TEST_MIN_GROUPS) throw new Error("VOCABULARY_TEST_GROUPS_REQUIRED");
  if (!questionIds.length) throw new Error("VOCABULARY_TEST_QUESTIONS_REQUIRED");

  const set = await getOne("sets", { set_id: setId, visible: true });
  if (!set) throw new Error("SET_NOT_FOUND");
  if (!isVocabularySet(set)) throw new Error("VOCABULARY_SET_REQUIRED");
  const gradingKey = await getOne("grading_keys", { set_id: setId });
  if (!gradingKey) throw new Error("GRADING_KEY_NOT_FOUND");
  const gradingVersion = assertVocabularyContentVersion(event.content_version, gradingKey);
  validateVocabularyQuestionIds(gradingKey, questionIds);
  const gradingSnapshot = buildVocabularyGradingSnapshot(gradingKey, questionIds);
  const { assignment, assignmentId } = await resolveAssignment(student, setId, event.assignment_id ? String(event.assignment_id) : null);

  const active = await activeVocabularySessions(student.auth_uid);
  const other = active.find((session) => !isSessionOwner(session, ids));
  if (other) throw new Error("VOCABULARY_TEST_DEVICE_BLOCKED");
  for (const session of active.filter((item) => isSessionOwner(item, ids))) {
    await markVocabularySessionEnded(session, "invalidated", "replaced_by_new_test");
  }

  const now = new Date();
  const totalSeconds = Math.max(60, selectedGroupCount * VOCABULARY_TEST_SECONDS_PER_GROUP);
  const dueAt = new Date(now.getTime() + totalSeconds * 1000);
  const expiresAt = new Date(dueAt.getTime() + VOCABULARY_TEST_SUBMIT_GRACE_MS);
  const record = {
    test_session_id: vocabularySessionId(student, setId),
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    set_id: setId,
    assignment_id: assignmentId || null,
    assignment_doc_id: assignment && assignment._id || null,
    status: "active",
    selected_group_count: selectedGroupCount,
    selected_group_ids: selectedGroupIds,
    question_ids: questionIds,
    grading_version: gradingVersion,
    grading_answers_snapshot: gradingSnapshot.answers,
    grading_explanations_snapshot: gradingSnapshot.explanations,
    client_device_id: ids.deviceId || null,
    client_instance_id: ids.instanceId,
    started_at: now,
    due_at: dueAt,
    expires_at: expiresAt,
    last_heartbeat_at: now,
    heartbeat_timeout_seconds: VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS / 1000,
    integrity_flags: [],
    created_at: now,
    updated_at: now,
  };
  await db.collection(VOCABULARY_TEST_SESSION_COLLECTION).add(record);
  return {
    success: true,
    test_session: sessionView(record),
    heartbeat_interval_seconds: 10,
    heartbeat_timeout_seconds: VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS / 1000,
  };
}

async function getOwnedVocabularySession(student, event) {
  const sessionId = String(event.test_session_id || "").trim();
  if (!sessionId) throw new Error("VOCABULARY_TEST_SESSION_REQUIRED");
  const session = await getOne(VOCABULARY_TEST_SESSION_COLLECTION, {
    test_session_id: sessionId,
    student_uid: student.auth_uid,
  });
  if (!session) throw new Error("VOCABULARY_TEST_SESSION_NOT_FOUND");
  return normalizeRecord(session);
}

async function ensureActiveOwnedVocabularySession(student, event) {
  const ids = requireClientInstance(event);
  const session = await getOwnedVocabularySession(student, event);
  if (!isSessionOwner(session, ids)) throw new Error("VOCABULARY_TEST_DEVICE_BLOCKED");
  if ((session.status || "") !== "active") throw new Error("VOCABULARY_TEST_SESSION_CLOSED");
  if (String(event.content_version || "") !== String(session.grading_version || "")) {
    throw new Error("VOCABULARY_CONTENT_OUTDATED");
  }
  const now = new Date();
  if (sessionTimeExpired(session, now)) {
    await markVocabularySessionEnded(session, "abandoned", "time_expired");
    throw new Error("VOCABULARY_TEST_SESSION_EXPIRED");
  }
  if (sessionHeartbeatExpired(session, now)) {
    await markVocabularySessionEnded(session, "abandoned", "heartbeat_timeout");
    throw new Error("VOCABULARY_TEST_SESSION_EXPIRED");
  }
  return session;
}

async function resumeVocabularyTestSession(student, event) {
  const session = await ensureActiveOwnedVocabularySession(student, event);
  const now = new Date();
  await db.collection(VOCABULARY_TEST_SESSION_COLLECTION).doc(session._id).update({
    last_heartbeat_at: now,
    updated_at: now,
  });
  const dueAt = dateValue(session.due_at);
  return {
    success: true,
    test_session: sessionView({
      ...session,
      last_heartbeat_at: now,
    }),
    remaining_seconds: dueAt ? Math.max(0, Math.ceil((dueAt - now.getTime()) / 1000)) : null,
    heartbeat_interval_seconds: 10,
    heartbeat_timeout_seconds: VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS / 1000,
  };
}

async function heartbeatVocabularyTestSession(student, event) {
  const session = await ensureActiveOwnedVocabularySession(student, event);
  const now = new Date();
  await db.collection(VOCABULARY_TEST_SESSION_COLLECTION).doc(session._id).update({
    last_heartbeat_at: now,
    updated_at: now,
  });
  return {
    success: true,
    test_session: sessionView({
      ...session,
      last_heartbeat_at: now,
    }),
  };
}

async function abandonVocabularyTestSession(student, event) {
  const ids = requireClientInstance(event);
  const session = await getOwnedVocabularySession(student, event);
  if (!isSessionOwner(session, ids)) throw new Error("VOCABULARY_TEST_DEVICE_BLOCKED");
  if ((session.status || "") !== "active") return { success: true, test_session: sessionView(session) };
  const reason = String(event.reason || "abandoned").trim().slice(0, 80) || "abandoned";
  await markVocabularySessionEnded(session, "abandoned", reason);
  return {
    success: true,
    test_session: sessionView({
      ...session,
      status: "abandoned",
    }),
  };
}

async function validateVocabularyTestSessionForSubmit(student, event, setId, assignmentId, answers) {
  const session = await ensureActiveOwnedVocabularySession(student, event);
  if (String(session.set_id || "") !== String(setId || "")) throw new Error("VOCABULARY_TEST_SESSION_MISMATCH");
  if (String(session.assignment_id || "") !== String(assignmentId || "")) throw new Error("VOCABULARY_TEST_SESSION_MISMATCH");
  const sessionGroupIds = uniqueStrings(session.selected_group_ids, 80);
  const sessionQuestionIds = uniqueStrings(session.question_ids, 1000);
  if (Number(session.selected_group_count || 0) < VOCABULARY_TEST_MIN_GROUPS) {
    throw new Error("VOCABULARY_TEST_SESSION_INVALID");
  }
  if (!sameStringList(event.selected_group_ids || [], sessionGroupIds)) {
    throw new Error("VOCABULARY_TEST_GROUP_MISMATCH");
  }
  const constrainedAnswers = {};
  sessionQuestionIds.forEach((questionId) => {
    constrainedAnswers[questionId] = answers && answers[questionId] != null ? answers[questionId] : "";
  });
  return {
    session,
    selectedGroupIds: sessionGroupIds,
    selectedGroupCount: Number(session.selected_group_count || sessionGroupIds.length),
    questionIds: sessionQuestionIds,
    answers: constrainedAnswers,
    gradingKey: gradingKeyFromSessionSnapshot(session),
  };
}

exports.main = async (event = {}) => {
  try {
    const student = await getAuthenticatedStudent();
    const action = String(event.action || "");
    if (action === "checkVocabularyTestAccess") return await checkVocabularyTestAccess(student, event);
    if (action === "startVocabularyTestSession") return await startVocabularyTestSession(student, event);
    if (action === "resumeVocabularyTestSession") return await resumeVocabularyTestSession(student, event);
    if (action === "heartbeatVocabularyTestSession") return await heartbeatVocabularyTestSession(student, event);
    if (action === "abandonVocabularyTestSession") return await abandonVocabularyTestSession(student, event);

    await assertNoOtherActiveVocabularyTest(student, event);

    const setId = String(event.set_id || "");
    let assignmentId = event.assignment_id ? String(event.assignment_id) : null;
    const mode = String(event.mode || "default");
    let answers = event.answers && typeof event.answers === "object" ? event.answers : {};
    let selectedGroupCountForAttempt = event.selected_group_count || null;
    let selectedGroupIdsForAttempt = uniqueStrings(event.selected_group_ids || [], 80);
    let vocabularyTestSession = null;
    let vocabularyTestQuestionIds = null;
    let vocabularyTestGradingKey = null;

    if (!setId) throw new Error("SET_REQUIRED");
    const set = await getOne("sets", { set_id: setId, visible: true });
    if (!set) throw new Error("SET_NOT_FOUND");
    const gradingKey = await getOne("grading_keys", { set_id: setId });
    if (!gradingKey) throw new Error("GRADING_KEY_NOT_FOUND");
    const setContentVersion = isVocabularySet(set) ? null : assertSetContentVersion(event, set, gradingKey);

    const submittedGroupCount = Number(event.selected_group_count || 0);
    const isVocabularyTimedPractice = mode === "vocabulary_practice_timed";
    const isCountedVocabularyTest = mode === "vocabulary_test" && submittedGroupCount >= VOCABULARY_TEST_MIN_GROUPS;
    const isVocabularySelfCheck = mode === "vocabulary_practice"
      || (mode === "vocabulary_test" && submittedGroupCount < VOCABULARY_TEST_MIN_GROUPS);

    const resolvedAssignment = isVocabularyTimedPractice
      ? { assignment: null, assignmentId: null }
      : await resolveAssignment(student, setId, assignmentId);
    const assignment = resolvedAssignment.assignment;
    assignmentId = resolvedAssignment.assignmentId;

    if (isVocabularySelfCheck || isVocabularyTimedPractice) {
      assertVocabularyContentVersion(event.content_version, gradingKey);
      await assertNoActiveVocabularySelfTestLeak(student, event, setId);
    }
    if (isCountedVocabularyTest) {
      const validatedSession = await validateVocabularyTestSessionForSubmit(student, event, setId, assignmentId, answers);
      vocabularyTestSession = validatedSession.session;
      vocabularyTestQuestionIds = validatedSession.questionIds;
      vocabularyTestGradingKey = validatedSession.gradingKey;
      answers = validatedSession.answers;
      selectedGroupCountForAttempt = validatedSession.selectedGroupCount;
      selectedGroupIdsForAttempt = validatedSession.selectedGroupIds;
      if (!event.started_at) event.started_at = vocabularyTestSession.started_at || null;
    }

    const bbcMcQuestionIds = mode === "bbc" ? bbcMultipleChoiceQuestionIds(gradingKey) : [];
    if (mode === "bbc") {
      const previousAttemptResult = await db.collection("attempts").where({
        student_uid: student.auth_uid,
        set_id: setId,
        assignment_id: assignmentId,
      }).limit(500).get();
      const bbcMcLockedAnswers = lockedBbcMultipleChoiceAnswers(previousAttemptResult.data || [], bbcMcQuestionIds);
      answers = { ...answers, ...bbcMcLockedAnswers };
    }

    const effectiveGradingKey = vocabularyTestGradingKey || gradingKey;
    const grading = gradeAnswers(answers, effectiveGradingKey, mode, vocabularyTestQuestionIds);
    grading.results = attachQuestionSnapshots(grading.results, event.question_snapshots);
    if (!grading.questionCount) throw new Error("NO_GRADED_QUESTIONS");
    const passingPercentage = passingPercentageForAssignment(assignment, set);
    const masteryPercentage = masteryPercentageForAssignment(assignment, set);
    const displayedPercentage = displayPercentage(grading.percentage, assignment, masteryPercentage);
    const progressAssignment = assignment || (!isVocabularyTimedPractice ? { mastery_enabled: true } : null);
    const attemptStatus = statusForPercentage(
      grading.percentage,
      passingPercentage,
      masteryPercentage,
      progressAssignment
    );
    const assignmentStatus = assignment
      ? monotonicAssignmentStatus(assignment.status, attemptStatus)
      : attemptStatus;
    const passed = attemptStatus === "passed" || attemptStatus === "mastered";
    const mastered = attemptStatus === "mastered";
    const isUnrecordedPractice = mode === "vocabulary_practice"
      || (mode === "vocabulary_test" && Number(event.selected_group_count || 0) < 5);
    const feedbackPolicy = set.feedback_policy || "always";
    const mayShowFeedback = mode === "vocabulary_test" || isVocabularyTimedPractice
      ? true
      : isUnrecordedPractice
      ? feedbackPolicy === "always" || passed
      : passed;
    if (isUnrecordedPractice) {
      return {
        success: true,
        recorded: false,
        correct_count: grading.correctCount,
        question_count: grading.questionCount,
        percentage: grading.percentage,
        display_percentage: grading.percentage,
        passing_percentage: passingPercentage,
        mastery_percentage: masteryPercentage,
        mastery_enabled: assignmentMasteryEnabled(assignment),
        passed,
        mastered,
        status: "self_test",
        attempt_status: attemptStatus,
        question_results: mayShowFeedback ? grading.results : grading.results.map((item) => ({
          question_id: item.question_id,
          submitted_answer: item.submitted_answer,
          correct: item.correct,
        })),
        group_results: [],
        feedback_locked: !mayShowFeedback,
      };
    }
    const previousAttempts = await db.collection("attempts").where({
      student_uid: student.auth_uid,
      set_id: setId,
      assignment_id: assignmentId,
    }).count();
    const attemptNumber = Number(previousAttempts.total || 0) + 1;
    const attemptId = [
      student.auth_uid,
      setId,
      Date.now(),
      Math.random().toString(36).slice(2, 8),
    ].join("-");
    const submittedAt = new Date();
    const groupResults = mode === "vocabulary_test" || isVocabularyTimedPractice
      ? (selectedGroupIdsForAttempt || []).map((groupId) => {
          const groupQuestions = grading.results.filter((item) => item.question_id.indexOf(`${groupId}:`) === 0);
          const groupCorrect = groupQuestions.filter((item) => item.correct).length;
          return {
            group_id: groupId,
            correct_count: groupCorrect,
            question_count: groupQuestions.length,
            percentage: groupQuestions.length
              ? Math.round(groupCorrect / groupQuestions.length * 10000) / 100
              : 0,
          };
        })
      : [];
    const attempt = {
      attempt_id: attemptId,
      student_uid: student.auth_uid,
      student_id_snapshot: student.student_id,
      set_id: setId,
      assignment_id: assignmentId,
      mode,
      attempt_number: attemptNumber,
      answers,
      question_results: grading.results,
      correct_count: grading.correctCount,
      question_count: grading.questionCount,
      raw_percentage: grading.percentage,
      percentage: displayedPercentage,
      display_percentage: displayedPercentage,
      passing_percentage: passingPercentage,
      mastery_percentage: masteryPercentage,
      mastery_enabled: assignment ? assignmentMasteryEnabled(assignment) : !isVocabularyTimedPractice,
      passed,
      mastered,
      mastery_eligible: mastered,
      mastery_blocked_reason: assignment && !assignmentMasteryEnabled(assignment)
        ? "mastery_disabled"
        : assignmentMasteryLocked(assignment) ? "answer_revealed" : "",
      feedback_policy: feedbackPolicy,
      started_at: event.started_at || null,
      submitted_at: submittedAt,
      duration_seconds: event.duration_seconds == null ? null : Number(event.duration_seconds),
      audio_started_at: event.audio_started_at || null,
      audio_to_submit_seconds: event.audio_to_submit_seconds == null ? null : Number(event.audio_to_submit_seconds),
      practice_context: isVocabularyTimedPractice ? "practice" : assignmentId ? "assignment" : "resource",
      grading_version: effectiveGradingKey.grading_version || "1",
      content_version: setContentVersion || event.content_version || null,
      selected_group_count: selectedGroupCountForAttempt,
      selected_group_ids: selectedGroupIdsForAttempt,
      group_results: groupResults,
      test_session_id: vocabularyTestSession && vocabularyTestSession.test_session_id || null,
      bbc_mc_locked_answers: mode === "bbc" ? bbcMultipleChoiceAnswers(answers, bbcMcQuestionIds) : null,
    };

    await db.collection("attempts").add(attempt);

    let finalAssignmentStatus = assignmentStatus;
    if (!isVocabularyTimedPractice) {
      const [setAttempts, studentAssignments] = await Promise.all([
        getAll("attempts", { where: { student_uid: student.auth_uid, set_id: setId } }),
        getAll("assignments", { where: { student_uid: student.auth_uid, set_id: setId } }),
      ]);
      const activeAssignments = studentAssignments.map(normalizeRecord).filter((item) => !isCancelledAssignment(item));
      const scoreLockedAt = globalScoreLockAt(set, activeAssignments);
      let linkedSummary = null;
      for (const target of activeAssignments) {
        const summary = globalAssignmentSummary(target, set, setAttempts, scoreLockedAt);
        if (!summary) continue;
        await db.collection("assignments").doc(target._id).update(summary.update);
        const revised = { ...target, ...summary.update };
        if (String(target.assignment_id || target._id) === String(assignmentId || "")) linkedSummary = summary;
        if (!linkedSummary && assignment && target._id === assignment._id) linkedSummary = summary;
        if (summary.status === "mastered") {
          await protectAssignmentStar(student, revised, summary.progress.best || attempt, submittedAt);
        }
      }
      if (linkedSummary) finalAssignmentStatus = linkedSummary.status;
      else if (activeAssignments.length) {
        const newestAssignment = activeAssignments.slice().sort((left, right) =>
          dateValue(right.created_at || right.due_at) - dateValue(left.created_at || left.due_at)
        )[0];
        const newestSummary = globalAssignmentSummary(newestAssignment, set, setAttempts, scoreLockedAt);
        if (newestSummary) finalAssignmentStatus = newestSummary.status;
      } else if (mastered) {
        await protectSelfStudyStar(student, attempt, submittedAt);
      }
    }

    if (vocabularyTestSession) {
      await markVocabularySessionEnded(vocabularyTestSession, "submitted", "submitted", {
        attempt_id: attemptId,
        submitted_at: submittedAt,
      });
    }

    return {
      success: true,
      recorded: true,
      attempt_id: attemptId,
      assignment_id: assignmentId || null,
      attempt_number: attemptNumber,
      correct_count: grading.correctCount,
      question_count: grading.questionCount,
      raw_percentage: grading.percentage,
      percentage: displayedPercentage,
      display_percentage: displayedPercentage,
      passing_percentage: passingPercentage,
      mastery_percentage: masteryPercentage,
      mastery_enabled: assignment ? assignmentMasteryEnabled(assignment) : !isVocabularyTimedPractice,
      passed,
      mastered,
      status: finalAssignmentStatus,
      assignment_status: finalAssignmentStatus,
      attempt_status: attemptStatus,
      mastery_eligible: mastered,
      mastery_blocked_reason: assignment && !assignmentMasteryEnabled(assignment)
        ? "mastery_disabled"
        : assignmentMasteryLocked(assignment) ? "answer_revealed" : "",
      question_results: mayShowFeedback ? grading.results : grading.results.map((item) => ({
        question_id: item.question_id,
        submitted_answer: item.submitted_answer,
        correct: item.correct,
      })),
      bbc_mc_locked_answers: mode === "bbc" ? bbcMultipleChoiceAnswers(answers, bbcMcQuestionIds) : {},
      group_results: groupResults,
      feedback_locked: !mayShowFeedback,
    };
  } catch (error) {
    console.error("submitAttempt failed", error);
    return {
      success: false,
      code: error.message || "SUBMIT_ERROR",
      message: `Unable to submit this attempt (${error.message || "SUBMIT_ERROR"}).`,
    };
  }
};
