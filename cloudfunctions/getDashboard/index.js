const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

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

function effectivePassed(attempt) {
  return attempt.adjusted_passed == null ? attempt.passed === true : attempt.adjusted_passed === true;
}

function effectiveQuestionResults(attempt) {
  return attempt.adjusted_question_results || attempt.question_results || [];
}

function masteryPercentageForSet(set) {
  return Number(!set || set.mastery_percentage == null ? 90 : set.mastery_percentage);
}

function passingPercentageForSet(set) {
  return Number(!set || set.passing_percentage == null ? 50 : set.passing_percentage);
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

function normalizedStatus(status, percentage, passingPercentage, masteryPercentage) {
  if (status === "mastered") return "mastered";
  if (status === "passed") return "passed";
  if (status === "to_do") return "to_do";
  if (status === "done" && percentage >= masteryPercentage) return "mastered";
  if (status === "done") return "passed";
  if (percentage >= masteryPercentage) return "mastered";
  if (percentage >= passingPercentage) return "passed";
  return "to_do";
}

function displayPercentage(value) {
  return value == null ? null : Number(value);
}

function dateValue(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
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

async function getAttemptReview(student, event) {
  const attemptId = String(event.attempt_id || "");
  if (!attemptId) throw new Error("ATTEMPT_REQUIRED");
  const attempt = await getOne("attempts", {
    attempt_id: attemptId,
    student_uid: student.auth_uid,
  });
  if (!attempt) throw new Error("ATTEMPT_NOT_FOUND");
  const set = await getOne("sets", { set_id: attempt.set_id });
  return {
    success: true,
    review: {
      attempt_id: attempt.attempt_id,
      set_id: attempt.set_id,
      set_title: set && set.title || attempt.set_id,
      percentage: effectivePercentage(attempt),
      submitted_at: attempt.submitted_at || null,
      answers: effectiveQuestionResults(attempt).map((item) => ({
        question_id: item.question_id,
        submitted_answer: item.submitted_answer == null ? "" : item.submitted_answer,
        correct: item.correct === true,
      })),
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
  return {
    success: true,
    disputes: (result.data || []).map((item) => ({
      dispute_id: item.dispute_id || item._id,
      question_id: item.question_id,
      status: item.status || "pending",
      decision: item.decision || null,
      teacher_note: item.teacher_note || "",
      student_reason: item.student_reason || "",
      created_at: item.created_at || null,
      updated_at: item.updated_at || null,
      resolved_at: item.resolved_at || null,
    })),
  };
}

async function revealAnswers(student, event) {
  const assignmentId = String(event.assignment_id || "");
  if (!assignmentId) throw new Error("ASSIGNMENT_REQUIRED");
  const assignment = await getOne("assignments", {
    assignment_id: assignmentId,
    student_uid: student.auth_uid,
  });
  if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
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
  const result = await db.collection("student_set_achievements").where({
    student_uid: student.auth_uid,
  }).limit(500).get();
  return (result.data || []).length;
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

  const existing = await getOne("student_set_achievements", {
    student_uid: student.auth_uid,
    assignment_id: assignmentId,
  });
  if (!existing) {
    const now = new Date();
    await db.collection("student_set_achievements").add({
      achievement_id: [student.auth_uid, assignmentId].join("::"),
      student_uid: student.auth_uid,
      student_id_snapshot: student.student_id,
      set_id: assignment.set_id,
      assignment_id: assignmentId,
      status: "star",
      protected: true,
      source: "assignment_claim",
      first_earned_at: assignment.mastered_at || now,
      claimed_at: now,
      first_qualifying_attempt_id: assignment.best_attempt_id || assignment.latest_attempt_id || null,
      best_attempt_id: assignment.best_attempt_id || assignment.latest_attempt_id || null,
      best_percentage: Number(assignment.best_percentage || assignment.latest_percentage || 0),
      created_at: now,
      updated_at: now,
    });
  }
  return { success: true, star_count: await starCount(student) };
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

exports.main = async (event = {}) => {
  try {
    const student = await getAuthenticatedStudent();
    const action = String(event.action || "dashboard");
    if (action === "getAttemptReview") return await getAttemptReview(student, event);
    if (action === "submitDispute") return await submitDispute(student, event);
    if (action === "listDisputesForAttempt") return await listDisputesForAttempt(student, event);
    if (action === "revealAnswers") return await revealAnswers(student, event);
    if (action === "getAttemptForRetry") return await getAttemptForRetry(student, event);
    if (action === "claimStar") return await claimStar(student, event);

    const assignmentResult = await db.collection("assignments")
      .where({ student_uid: student.auth_uid })
      .orderBy("assigned_at", "desc")
      .limit(100)
      .get();
    const assignments = assignmentResult.data || [];
    const attemptResult = await db.collection("attempts")
      .where({ student_uid: student.auth_uid })
      .limit(500)
      .get();
    const attempts = attemptResult.data || [];
    const setIds = [...new Set(
      assignments.map((item) => item.set_id)
        .filter(Boolean)
    )];
    const setMap = new Map();
    const starResult = await db.collection("student_set_achievements").where({
      student_uid: student.auth_uid,
    }).limit(500).get();
    const claimedAssignmentIds = new Set((starResult.data || [])
      .map((item) => item.assignment_id)
      .filter(Boolean));

    for (const setId of setIds) {
      const setResult = await db.collection("sets").where({
        set_id: setId,
        visible: true,
      }).limit(1).get();
      if (setResult.data && setResult.data[0]) setMap.set(setId, setResult.data[0]);
    }

    const attemptsByAssignment = new Map();
    attempts.forEach((attempt) => {
      if (!attempt.assignment_id) return;
      const items = attemptsByAssignment.get(attempt.assignment_id) || [];
      items.push(attempt);
      attemptsByAssignment.set(attempt.assignment_id, items);
    });

    const assignmentViews = assignments.map((assignment) => {
      const set = setMap.get(assignment.set_id);
      const passingPercentage = passingPercentageForAssignment(assignment, set);
      const masteryPercentage = masteryPercentageForAssignment(assignment, set);
      const assignmentId = assignment.assignment_id || assignment._id;
      const assignmentAttempts = attemptsByAssignment.get(assignmentId) || [];
      const computedBestAttempt = bestAttempt(assignmentAttempts);
      const computedLatestAttempt = newestAttempt(assignmentAttempts);
      const computedBestPercentage = computedBestAttempt ? effectivePercentage(computedBestAttempt) : null;
      const savedBestPercentage = assignment.best_percentage == null ? null : Number(assignment.best_percentage);
      const useComputedBest = computedBestAttempt && (
        !assignment.best_attempt_id
        || savedBestPercentage == null
        || computedBestPercentage >= savedBestPercentage
      );
      const bestSource = useComputedBest ? computedBestAttempt : null;
      const fallbackLatestSource = computedLatestAttempt || null;
      const bestAttemptId = bestSource
        ? bestSource.attempt_id
        : (assignment.best_attempt_id || assignment.latest_attempt_id || (fallbackLatestSource && fallbackLatestSource.attempt_id) || null);
      const bestValue = bestSource
        ? computedBestPercentage
        : (assignment.best_percentage == null
          ? (computedBestPercentage == null ? assignment.latest_percentage : computedBestPercentage)
          : assignment.best_percentage);
      const percentage = displayPercentage(bestValue);
      const status = normalizedStatus(assignment.status, Number(percentage || 0), passingPercentage, masteryPercentage);
      const completedAt = assignment.completed_at
        || (status === "passed" || status === "mastered"
          ? (computedBestAttempt && computedBestAttempt.submitted_at) || null
          : null);
      const masteredAt = assignment.mastered_at
        || (status === "mastered"
          ? (computedBestAttempt && computedBestAttempt.submitted_at) || completedAt
          : null);
      return {
        assignment_id: assignmentId,
        status,
        assigned_at: assignment.assigned_at || null,
        due_at: assignment.due_at || null,
        completed_at: completedAt,
        mastered_at: masteredAt,
        updated_at: assignment.updated_at || (computedLatestAttempt && computedLatestAttempt.submitted_at) || null,
        attempt_count: Math.max(Number(assignment.attempt_count || 0), assignmentAttempts.length),
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
        star_claimed: claimedAssignmentIds.has(assignment.assignment_id || assignment._id),
        passing_percentage: passingPercentage,
        mastery_percentage: masteryPercentage,
        set: set || {
          set_id: assignment.set_id,
          title: assignment.set_id,
          link: "#",
        },
      };
    });

    return {
      success: true,
      assignments: assignmentViews,
      star_count: (starResult.data || []).length,
    };
  } catch (error) {
    return {
      success: false,
      code: error.message,
      message: error.message === "AUTH_REQUIRED" ? "Please log in." : "Unable to load assignments.",
      assignments: [],
    };
  }
};
