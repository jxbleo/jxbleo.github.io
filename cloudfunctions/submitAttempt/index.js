const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const READ_PAGE_LIMIT = 500;
const VOCABULARY_TEST_SESSION_COLLECTION = "vocabulary_test_sessions";
const VOCABULARY_TEST_MIN_GROUPS = 5;
const VOCABULARY_TEST_SECONDS_PER_GROUP = 60;
const VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS = 30 * 1000;
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

function defaultPassingPercentageForSet(set) {
  return isVocabularySet(set) ? 80 : 50;
}

function defaultMasteryPercentageForSet(set) {
  return isVocabularySet(set) ? 100 : 90;
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
  return !assignment || assignment.mastery_enabled !== false;
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
      dateValue(right.assigned_at || right.created_at) - dateValue(left.assigned_at || left.created_at)
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
    : mode === "vocabulary_test" || mode === "vocabulary_practice"
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

function attemptDateValue(attempt) {
  return dateValue(attempt && attempt.submitted_at);
}

function attemptStatus(attempt, passingPercentage, masteryPercentage, assignment) {
  if (attempt.mastered === true) return "mastered";
  if (attempt.passed === true) return "passed";
  return statusForPercentage(attemptRawPercentage(attempt), passingPercentage, masteryPercentage, assignment);
}

function bestAttemptRecord(attempts) {
  return attempts.slice().sort((left, right) => {
    const byScore = attemptDisplayPercentage(right) - attemptDisplayPercentage(left);
    if (byScore) return byScore;
    return attemptDateValue(right) - attemptDateValue(left);
  })[0] || null;
}

function latestAttemptRecord(attempts) {
  return attempts.slice().sort((left, right) => attemptDateValue(right) - attemptDateValue(left))[0] || null;
}

function earliestStatusDate(attempts, passingPercentage, masteryPercentage, assignment, status) {
  const matching = attempts
    .filter((attempt) => statusRank(attemptStatus(attempt, passingPercentage, masteryPercentage, assignment)) >= statusRank(status))
    .sort((left, right) => attemptDateValue(left) - attemptDateValue(right));
  return matching[0] && matching[0].submitted_at || null;
}

function assignmentSummaryFromAttempts(assignment, set, attempts, fallbackAttempt) {
  const records = attempts.map(normalizeRecord);
  if (fallbackAttempt && !records.some((item) => item.attempt_id === fallbackAttempt.attempt_id)) {
    records.push(fallbackAttempt);
  }
  const passingPercentage = passingPercentageForAssignment(assignment, set);
  const masteryPercentage = masteryPercentageForAssignment(assignment, set);
  const latest = latestAttemptRecord(records);
  const best = bestAttemptRecord(records);
  const bestStatus = records.reduce((status, attempt) =>
    monotonicAssignmentStatus(status, attemptStatus(attempt, passingPercentage, masteryPercentage, assignment)), "to_do");
  const assignmentStatus = monotonicAssignmentStatus(assignment.status, bestStatus);
  const bestPercentage = best ? attemptDisplayPercentage(best) : Number(assignment.best_percentage || 0);
  const rawBestPercentage = records.reduce((value, attempt) =>
    Math.max(value, attemptRawPercentage(attempt)), Number(assignment.raw_best_percentage || 0));
  const update = {
    status: assignmentStatus,
    latest_attempt_id: latest && latest.attempt_id || assignment.latest_attempt_id || null,
    attempt_count: Math.max(Number(assignment.attempt_count || 0), records.length),
    latest_percentage: latest ? attemptDisplayPercentage(latest) : assignment.latest_percentage || null,
    latest_raw_percentage: latest ? attemptRawPercentage(latest) : assignment.latest_raw_percentage || null,
    best_percentage: Math.max(Number(assignment.best_percentage || 0), bestPercentage),
    raw_best_percentage: rawBestPercentage,
    best_attempt_id: best && best.attempt_id || assignment.best_attempt_id || assignment.latest_attempt_id || null,
    best_correct_count: best ? best.correct_count : assignment.best_correct_count || null,
    best_question_count: best ? best.question_count : assignment.best_question_count || null,
    updated_at: fallbackAttempt && fallbackAttempt.submitted_at || new Date(),
  };
  if (statusRank(assignmentStatus) >= statusRank("passed") && !assignment.completed_at) {
    update.completed_at = earliestStatusDate(records, passingPercentage, masteryPercentage, assignment, "passed")
      || fallbackAttempt && fallbackAttempt.submitted_at
      || new Date();
  }
  if (assignmentStatus === "mastered" && !assignment.mastered_at) {
    update.mastered_at = earliestStatusDate(records, passingPercentage, masteryPercentage, assignment, "mastered")
      || fallbackAttempt && fallbackAttempt.submitted_at
      || new Date();
  }
  return { update, latest, best, status: assignmentStatus };
}

function isSelfStudyAchievement(item) {
  return Boolean(
    item && !item.assignment_id && (item.source === "self_study" || item.source === "explore")
  );
}

async function protectSelfStudyStar(student, attempt, now) {
  const result = await db.collection("student_set_achievements").where({
    student_uid: student.auth_uid,
    set_id: attempt.set_id,
  }).limit(100).get();
  const achievements = result.data || [];
  const existingAssignmentStar = achievements.find((item) => item.assignment_id);
  if (existingAssignmentStar) return;
  const existing = achievements.find(isSelfStudyAchievement);
  const update = {
    source: "self_study",
    status: "star",
    protected: true,
    updated_at: now,
  };
  if (!existing || Number(attempt.display_percentage || attempt.percentage || 0) > Number(existing.best_percentage || 0)) {
    update.best_attempt_id = attempt.attempt_id;
    update.best_percentage = Number(attempt.display_percentage || attempt.percentage || 0);
  }
  if (existing) {
    await db.collection("student_set_achievements").doc(existing._id).update(update);
    return;
  }
  await db.collection("student_set_achievements").add({
    achievement_id: [student.auth_uid, attempt.set_id, "self"].join("::"),
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    set_id: attempt.set_id,
    assignment_id: null,
    status: "star",
    protected: true,
    source: "self_study",
    claimed_at: now,
    first_earned_at: now,
    first_qualifying_attempt_id: attempt.attempt_id,
    best_attempt_id: attempt.attempt_id,
    best_percentage: Number(attempt.display_percentage || attempt.percentage || 0),
    created_at: now,
    updated_at: now,
  });
}

async function protectAssignmentStar(student, assignment, attempt, now) {
  const assignmentId = assignment.assignment_id || assignment._id;
  if (!assignmentId) return;
  const percentage = Number(attempt.display_percentage || attempt.percentage || 0);
  const existing = await getOne("student_set_achievements", {
    student_uid: student.auth_uid,
    assignment_id: assignmentId,
  });
  if (existing) {
    const update = {
      source: "assignment_claim",
      status: "star",
      protected: true,
      updated_at: now,
    };
    if (percentage > Number(existing.best_percentage || 0)) {
      update.best_attempt_id = attempt.attempt_id;
      update.best_percentage = percentage;
    }
    await db.collection("student_set_achievements").doc(existing._id).update(update);
    return;
  }
  const sameSetResult = await db.collection("student_set_achievements").where({
    student_uid: student.auth_uid,
    set_id: assignment.set_id,
  }).limit(100).get();
  const selfStudyStar = (sameSetResult.data || []).find(isSelfStudyAchievement);
  if (selfStudyStar) {
    const update = {
      achievement_id: [student.auth_uid, assignmentId].join("::"),
      assignment_id: assignmentId,
      source: "assignment_claim",
      status: "star",
      protected: true,
      converted_from_self_study: true,
      converted_at: now,
      claimed_at: selfStudyStar.claimed_at || now,
      first_earned_at: selfStudyStar.first_earned_at || now,
      first_qualifying_attempt_id: selfStudyStar.first_qualifying_attempt_id || attempt.attempt_id,
      best_attempt_id: attempt.attempt_id || selfStudyStar.best_attempt_id || null,
      best_percentage: Math.max(percentage, Number(selfStudyStar.best_percentage || 0)),
      updated_at: now,
    };
    await db.collection("student_set_achievements").doc(selfStudyStar._id).update(update);
    return;
  }
  await db.collection("student_set_achievements").add({
    achievement_id: [student.auth_uid, assignmentId].join("::"),
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    set_id: assignment.set_id,
    assignment_id: assignmentId,
    status: "star",
    protected: true,
    source: "assignment_claim",
    claimed_at: now,
    first_earned_at: now,
    first_qualifying_attempt_id: attempt.attempt_id,
    best_attempt_id: attempt.attempt_id,
    best_percentage: percentage,
    created_at: now,
    updated_at: now,
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
  validateVocabularyQuestionIds(gradingKey, questionIds);
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

    if (!setId) throw new Error("SET_REQUIRED");
    const set = await getOne("sets", { set_id: setId, visible: true });
    if (!set) throw new Error("SET_NOT_FOUND");
    const gradingKey = await getOne("grading_keys", { set_id: setId });
    if (!gradingKey) throw new Error("GRADING_KEY_NOT_FOUND");

    const resolvedAssignment = await resolveAssignment(student, setId, assignmentId);
    const assignment = resolvedAssignment.assignment;
    assignmentId = resolvedAssignment.assignmentId;

    const submittedGroupCount = Number(event.selected_group_count || 0);
    const isCountedVocabularyTest = mode === "vocabulary_test" && submittedGroupCount >= VOCABULARY_TEST_MIN_GROUPS;
    const isVocabularySelfCheck = mode === "vocabulary_practice"
      || (mode === "vocabulary_test" && submittedGroupCount < VOCABULARY_TEST_MIN_GROUPS);
    if (isVocabularySelfCheck) {
      await assertNoActiveVocabularySelfTestLeak(student, event, setId);
    }
    if (isCountedVocabularyTest) {
      const validatedSession = await validateVocabularyTestSessionForSubmit(student, event, setId, assignmentId, answers);
      vocabularyTestSession = validatedSession.session;
      vocabularyTestQuestionIds = validatedSession.questionIds;
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

    const grading = gradeAnswers(answers, gradingKey, mode, vocabularyTestQuestionIds);
    if (!grading.questionCount) throw new Error("NO_GRADED_QUESTIONS");
    const passingPercentage = passingPercentageForAssignment(assignment, set);
    const masteryPercentage = masteryPercentageForAssignment(assignment, set);
    const displayedPercentage = displayPercentage(grading.percentage, assignment, masteryPercentage);
    const attemptStatus = statusForPercentage(grading.percentage, passingPercentage, masteryPercentage, assignment);
    const assignmentStatus = assignment
      ? monotonicAssignmentStatus(assignment.status, attemptStatus)
      : attemptStatus;
    const passed = attemptStatus === "passed" || attemptStatus === "mastered";
    const mastered = attemptStatus === "mastered";
    const isUnrecordedPractice = mode === "vocabulary_practice"
      || (mode === "vocabulary_test" && Number(event.selected_group_count || 0) < 5);
    const feedbackPolicy = set.feedback_policy || "always";
    const mayShowFeedback = mode === "vocabulary_test"
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
    const groupResults = mode === "vocabulary_test"
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
      mastery_enabled: assignmentMasteryEnabled(assignment),
      passed,
      mastered,
      mastery_eligible: mastered,
      mastery_blocked_reason: !assignmentMasteryEnabled(assignment)
        ? "mastery_disabled"
        : assignmentMasteryLocked(assignment) ? "answer_revealed" : "",
      feedback_policy: feedbackPolicy,
      started_at: event.started_at || null,
      submitted_at: submittedAt,
      duration_seconds: event.duration_seconds == null ? null : Number(event.duration_seconds),
      audio_started_at: event.audio_started_at || null,
      audio_to_submit_seconds: event.audio_to_submit_seconds == null ? null : Number(event.audio_to_submit_seconds),
      practice_context: assignmentId ? "assignment" : "resource",
      grading_version: gradingKey.grading_version || "1",
      selected_group_count: selectedGroupCountForAttempt,
      selected_group_ids: selectedGroupIdsForAttempt,
      group_results: groupResults,
      test_session_id: vocabularyTestSession && vocabularyTestSession.test_session_id || null,
      bbc_mc_locked_answers: mode === "bbc" ? bbcMultipleChoiceAnswers(answers, bbcMcQuestionIds) : null,
    };

    await db.collection("attempts").add(attempt);

    let finalAssignmentStatus = assignmentStatus;
    if (assignment) {
      const assignmentAttempts = await getAll("attempts", {
        where: {
          student_uid: student.auth_uid,
          set_id: setId,
          assignment_id: assignmentId,
        },
      });
      const summary = assignmentSummaryFromAttempts(assignment, set, assignmentAttempts, attempt);
      finalAssignmentStatus = summary.status;
      await db.collection("assignments").doc(assignment._id).update(summary.update);
      const verifyResult = await db.collection("assignments").doc(assignment._id).get();
      const verified = verifyResult.data && verifyResult.data[0];
      if (!verified) {
        throw new Error("ASSIGNMENT_UPDATE_FAILED");
      }
      if (summary.status === "mastered") await protectAssignmentStar(student, verified, summary.best || attempt, submittedAt);
    } else if (mastered) {
      await protectSelfStudyStar(student, attempt, submittedAt);
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
      mastery_enabled: assignmentMasteryEnabled(assignment),
      passed,
      mastered,
      status: finalAssignmentStatus,
      assignment_status: finalAssignmentStatus,
      attempt_status: attemptStatus,
      mastery_eligible: mastered,
      mastery_blocked_reason: !assignmentMasteryEnabled(assignment)
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
