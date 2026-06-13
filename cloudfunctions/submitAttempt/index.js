const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

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
  if (!result.data || !result.data[0]) throw new Error("STUDENT_NOT_LINKED");
  return result.data[0];
}

async function getOne(collection, query) {
  const result = await db.collection(collection).where(query).limit(1).get();
  return result.data && result.data[0];
}

function effectivePercentage(attempt) {
  return Number(
    attempt.adjusted_percentage == null ? attempt.percentage || 0 : attempt.adjusted_percentage
  );
}

function masteryPercentageForSet(set) {
  return Number(!set || set.mastery_percentage == null ? 90 : set.mastery_percentage);
}

function passingPercentageForSet(set) {
  return Number(!set || set.passing_percentage == null ? 50 : set.passing_percentage);
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

function displayPercentage(rawPercentage, assignment, masteryPercentage) {
  return assignmentMasteryLocked(assignment) && rawPercentage >= masteryPercentage ? masteryPercentage - 0.01 : rawPercentage;
}

function statusForPercentage(rawPercentage, passingPercentage, masteryPercentage, assignment) {
  if (assignment && assignment.status === "mastered") return "mastered";
  if (!assignmentMasteryLocked(assignment) && rawPercentage >= masteryPercentage) return "mastered";
  if (displayPercentage(rawPercentage, assignment, masteryPercentage) >= passingPercentage) return "passed";
  return "to_do";
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

async function protectSelfStudyStar(student, attempt, now) {
  const result = await db.collection("student_set_achievements").where({
    student_uid: student.auth_uid,
    set_id: attempt.set_id,
  }).limit(100).get();
  const achievements = result.data || [];
  const existingAssignmentStar = achievements.find((item) => item.assignment_id);
  if (existingAssignmentStar) return;
  const existing = achievements.find((item) =>
    !item.assignment_id && (item.source === "self_study" || item.source === "explore")
  );
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

exports.main = async (event) => {
  try {
    const student = await getAuthenticatedStudent();
    const setId = String(event.set_id || "");
    const assignmentId = event.assignment_id ? String(event.assignment_id) : null;
    const mode = String(event.mode || "default");
    const answers = event.answers && typeof event.answers === "object" ? event.answers : {};

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
    }

    const grading = gradeAnswers(answers, gradingKey, mode);
    if (!grading.questionCount) throw new Error("NO_GRADED_QUESTIONS");
    const passingPercentage = passingPercentageForAssignment(assignment, set);
    const masteryPercentage = masteryPercentageForAssignment(assignment, set);
    const displayedPercentage = displayPercentage(grading.percentage, assignment, masteryPercentage);
    const status = statusForPercentage(grading.percentage, passingPercentage, masteryPercentage, assignment);
    const passed = status === "passed" || status === "mastered";
    const mastered = status === "mastered";
    const isUnrecordedPractice = mode === "vocabulary_practice"
      || (mode === "vocabulary_test" && Number(event.selected_group_count || 0) < 5);
    const feedbackPolicy = set.feedback_policy || "always";
    const mayShowFeedback = isUnrecordedPractice
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
        passed,
        mastered,
        status: "self_test",
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
      passed,
      mastered,
      mastery_eligible: mastered,
      mastery_blocked_reason: assignmentMasteryLocked(assignment) ? "answer_revealed" : "",
      feedback_policy: feedbackPolicy,
      started_at: event.started_at || null,
      submitted_at: submittedAt,
      duration_seconds: event.duration_seconds == null ? null : Number(event.duration_seconds),
      practice_context: assignmentId ? "assignment" : "resource",
      grading_version: gradingKey.grading_version || "1",
      selected_group_count: event.selected_group_count || null,
      selected_group_ids: event.selected_group_ids || [],
      group_results: groupResults,
    };

    await db.collection("attempts").add(attempt);

    if (assignment) {
      const best = Math.max(Number(assignment.best_percentage || 0), displayedPercentage);
      const rawBest = Math.max(Number(assignment.raw_best_percentage || 0), grading.percentage);
      const update = {
        status,
        latest_attempt_id: attemptId,
        attempt_count: Number(assignment.attempt_count || 0) + 1,
        latest_percentage: displayedPercentage,
        latest_raw_percentage: grading.percentage,
        best_percentage: best,
        raw_best_percentage: rawBest,
        best_attempt_id: best === displayedPercentage ? attemptId : assignment.best_attempt_id || assignment.latest_attempt_id || null,
        best_correct_count: best === displayedPercentage ? grading.correctCount : assignment.best_correct_count || null,
        best_question_count: best === displayedPercentage ? grading.questionCount : assignment.best_question_count || null,
        updated_at: submittedAt,
      };
      if (passed && !assignment.completed_at) update.completed_at = submittedAt;
      if (mastered && !assignment.mastered_at) update.mastered_at = submittedAt;
      await db.collection("assignments").doc(assignment._id).update(update);
      const verifyResult = await db.collection("assignments").doc(assignment._id).get();
      const verified = verifyResult.data && verifyResult.data[0];
      if (!verified || verified.latest_attempt_id !== attemptId) {
        throw new Error("ASSIGNMENT_UPDATE_FAILED");
      }
    } else if (mastered) {
      await protectSelfStudyStar(student, attempt, submittedAt);
    }

    return {
      success: true,
      recorded: true,
      attempt_id: attemptId,
      attempt_number: attemptNumber,
      correct_count: grading.correctCount,
      question_count: grading.questionCount,
      raw_percentage: grading.percentage,
      percentage: displayedPercentage,
      display_percentage: displayedPercentage,
      passing_percentage: passingPercentage,
      mastery_percentage: masteryPercentage,
      passed,
      mastered,
      status,
      mastery_eligible: mastered,
      mastery_blocked_reason: assignmentMasteryLocked(assignment) ? "answer_revealed" : "",
      question_results: mayShowFeedback ? grading.results : grading.results.map((item) => ({
        question_id: item.question_id,
        submitted_answer: item.submitted_answer,
        correct: item.correct,
      })),
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
