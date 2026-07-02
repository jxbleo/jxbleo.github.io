const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const READ_PAGE_LIMIT = 500;

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

function gradeAnswers(submittedAnswers, gradingKey, mode) {
  const answers = gradingKey.answers || {};
  const explanations = gradingKey.explanations || {};
  const questionIds = mode === "vocabulary_test" || mode === "vocabulary_practice"
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

exports.main = async (event) => {
  try {
    const student = await getAuthenticatedStudent();
    const setId = String(event.set_id || "");
    let assignmentId = event.assignment_id ? String(event.assignment_id) : null;
    const mode = String(event.mode || "default");
    let answers = event.answers && typeof event.answers === "object" ? event.answers : {};

    if (!setId) throw new Error("SET_REQUIRED");
    const set = await getOne("sets", { set_id: setId, visible: true });
    if (!set) throw new Error("SET_NOT_FOUND");
    const gradingKey = await getOne("grading_keys", { set_id: setId });
    if (!gradingKey) throw new Error("GRADING_KEY_NOT_FOUND");

    let assignment = null;
    if (assignmentId) {
      assignment = await getOne("assignments", {
        assignment_id: assignmentId,
        student_uid: student.auth_uid,
        set_id: setId,
      });
      if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
      if (isCancelledAssignment(assignment)) throw new Error("ASSIGNMENT_CANCELLED");
    } else {
      assignment = await findOpenAssignmentForSet(student.auth_uid, setId);
      if (assignment) assignmentId = String(assignment.assignment_id || assignment._id);
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

    const grading = gradeAnswers(answers, gradingKey, mode);
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
      ? (event.selected_group_ids || []).map((groupId) => {
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
      selected_group_count: event.selected_group_count || null,
      selected_group_ids: event.selected_group_ids || [],
      group_results: groupResults,
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
