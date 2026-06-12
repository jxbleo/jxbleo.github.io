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

async function protectHistoricalStars(student, attempts) {
  const bestBySet = new Map();
  attempts.filter(effectivePassed).forEach((attempt) => {
    const current = bestBySet.get(attempt.set_id);
    if (!current || effectivePercentage(attempt) > effectivePercentage(current)) {
      bestBySet.set(attempt.set_id, attempt);
    }
  });

  for (const [setId, best] of bestBySet.entries()) {
    const existing = await getOne("student_set_achievements", {
      student_uid: student.auth_uid,
      set_id: setId,
    });
    if (existing) {
      if (effectivePercentage(best) > Number(existing.best_percentage || 0)) {
        await db.collection("student_set_achievements").doc(existing._id).update({
          best_percentage: effectivePercentage(best),
          best_attempt_id: best.attempt_id,
          updated_at: new Date(),
        });
      }
      continue;
    }
    const earnedAt = best.submitted_at || new Date();
    await db.collection("student_set_achievements").add({
      achievement_id: [student.auth_uid, setId].join("::"),
      student_uid: student.auth_uid,
      student_id_snapshot: student.student_id,
      set_id: setId,
      status: "star",
      protected: true,
      source: best.assignment_id ? "assignment" : "explore",
      first_earned_at: earnedAt,
      first_qualifying_attempt_id: best.attempt_id,
      best_attempt_id: best.attempt_id,
      best_percentage: effectivePercentage(best),
      created_at: earnedAt,
      updated_at: new Date(),
    });
  }
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

exports.main = async (event = {}) => {
  try {
    const student = await getAuthenticatedStudent();
    const action = String(event.action || "dashboard");
    if (action === "getAttemptReview") return await getAttemptReview(student, event);
    if (action === "submitDispute") return await submitDispute(student, event);

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
    await protectHistoricalStars(student, attempts);
    const achievementResult = await db.collection("student_set_achievements")
      .where({ student_uid: student.auth_uid, status: "star" })
      .limit(200)
      .get();
    const achievements = achievementResult.data || [];
    const setIds = [...new Set(
      assignments.map((item) => item.set_id)
        .concat(achievements.map((item) => item.set_id))
        .filter(Boolean)
    )];
    const setMap = new Map();

    for (const setId of setIds) {
      const setResult = await db.collection("sets").where({
        set_id: setId,
        visible: true,
      }).limit(1).get();
      if (setResult.data && setResult.data[0]) setMap.set(setId, setResult.data[0]);
    }

    const assignmentViews = assignments.map((assignment) => {
      const achievement = achievements.find((item) => item.set_id === assignment.set_id);
      return {
        assignment_id: assignment.assignment_id || assignment._id,
        status: achievement ? "done" : (assignment.status || "not_done"),
        assigned_at: assignment.assigned_at || null,
        due_at: assignment.due_at || null,
        completed_at: achievement && achievement.first_earned_at || assignment.completed_at || null,
        updated_at: assignment.updated_at || null,
        attempt_count: assignment.attempt_count || 0,
        latest_percentage: assignment.latest_percentage == null ? null : assignment.latest_percentage,
        best_percentage: achievement
          ? achievement.best_percentage
          : (assignment.best_percentage == null ? null : assignment.best_percentage),
        review_attempt_id: achievement && achievement.best_attempt_id || assignment.latest_attempt_id || null,
        star_protected: Boolean(achievement),
        star_source: achievement && achievement.source || null,
        set: setMap.get(assignment.set_id) || {
          set_id: assignment.set_id,
          title: assignment.set_id,
          link: "#",
        },
      };
    }).filter((item, index, items) => {
      if (item.status !== "done") return true;
      return items.findIndex((candidate) =>
        candidate.status === "done" && candidate.set.set_id === item.set.set_id
      ) === index;
    });
    const assignedSetIds = new Set(assignments.map((item) => item.set_id));
    const exploreStars = achievements.filter((item) => !assignedSetIds.has(item.set_id)).map((achievement) => ({
      assignment_id: null,
      status: "done",
      assigned_at: achievement.first_earned_at || null,
      due_at: null,
      completed_at: achievement.first_earned_at || null,
      updated_at: achievement.updated_at || null,
      attempt_count: attempts.filter((item) => item.set_id === achievement.set_id).length,
      latest_percentage: achievement.best_percentage,
      best_percentage: achievement.best_percentage,
      review_attempt_id: achievement.best_attempt_id,
      star_protected: true,
      star_source: achievement.source || "explore",
      set: setMap.get(achievement.set_id) || {
        set_id: achievement.set_id,
        title: achievement.set_id,
        link: "#",
      },
    }));

    return {
      success: true,
      assignments: assignmentViews.concat(exploreStars),
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
