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
    const passingPercentage = Number(
      set.passing_percentage == null ? 50 : set.passing_percentage
    );
    const passed = grading.percentage >= passingPercentage;
    const feedbackPolicy = set.feedback_policy || "always";
    const isUnrecordedPractice = mode === "vocabulary_practice"
      || (mode === "vocabulary_test" && Number(event.selected_group_count || 0) < 5);
    const mayShowFeedback = feedbackPolicy === "always" || passed;
    if (isUnrecordedPractice) {
      return {
        success: true,
        recorded: false,
        correct_count: grading.correctCount,
        question_count: grading.questionCount,
        percentage: grading.percentage,
        passing_percentage: passingPercentage,
        passed,
        status: "self_test",
        question_results: mayShowFeedback ? grading.results : grading.results.map((item) => ({
          question_id: item.question_id,
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
      percentage: grading.percentage,
      passing_percentage: passingPercentage,
      passed,
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

    await db.collection("attempts").add({ data: attempt });

    if (assignment) {
      const best = Math.max(Number(assignment.best_percentage || 0), grading.percentage);
      const update = {
        status: passed ? "done" : (assignment.status === "done" ? "done" : "failed"),
        latest_attempt_id: attemptId,
        attempt_count: Number(assignment.attempt_count || 0) + 1,
        latest_percentage: grading.percentage,
        best_percentage: best,
        updated_at: submittedAt,
      };
      if (passed && !assignment.completed_at) update.completed_at = submittedAt;
      await db.collection("assignments").doc(assignment._id).update(update);
      const verifyResult = await db.collection("assignments").doc(assignment._id).get();
      const verified = verifyResult.data && verifyResult.data[0];
      if (!verified || verified.latest_attempt_id !== attemptId) {
        throw new Error("ASSIGNMENT_UPDATE_FAILED");
      }
    }

    return {
      success: true,
      recorded: true,
      attempt_id: attemptId,
      attempt_number: attemptNumber,
      correct_count: grading.correctCount,
      question_count: grading.questionCount,
      percentage: grading.percentage,
      passing_percentage: passingPercentage,
      passed,
      status: passed ? "done" : "failed",
      question_results: mayShowFeedback ? grading.results : grading.results.map((item) => ({
        question_id: item.question_id,
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
