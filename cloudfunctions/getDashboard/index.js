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
  if (percentage >= masteryPercentage) return "mastered";
  if (percentage >= passingPercentage) return "passed";
  if (status === "passed" || status === "done") return "passed";
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

function disputeStatusLabel(item) {
  if ((item.decision || "") === "keep" || item.status === "rejected") return "Original ruling kept";
  if ((item.decision || "") === "replace") return "Answer rule updated";
  if ((item.decision || "") === "add" || item.status === "approved") return "Accepted";
  return "Waiting for teacher";
}

function disputeSeen(item) {
  return item.student_seen === true || Boolean(item.student_seen_at);
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
    student_reason: item.student_reason || "",
    status: item.status || "pending",
    decision: item.decision || null,
    decision_label: disputeStatusLabel(item),
    teacher_note: item.teacher_note || "",
    resolved_at: item.resolved_at || item.updated_at || null,
    student_seen: disputeSeen(item),
  };
}

function resolvedTeacherReplyItems(items) {
  return (items || []).filter((item) =>
    item && item.status !== "pending" && !disputeSeen(item)
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
  const disputeResult = await db.collection("answer_disputes").where({
    attempt_id: attemptId,
    student_uid: student.auth_uid,
  }).limit(100).get();
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
      disputes: (disputeResult.data || []).map((item) => disputeReplyView(item, set)),
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
      question_text: item.question_text_snapshot || "",
      submitted_answer: item.submitted_answer == null ? "" : item.submitted_answer,
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
  const result = await db.collection("answer_disputes").where({
    student_uid: student.auth_uid,
  }).limit(200).get();
  const resolved = resolvedTeacherReplyItems(result.data || []);
  const setIds = [...new Set(resolved.map((item) => item.set_id).filter(Boolean))];
  const setMap = new Map();
  await Promise.all(setIds.map(async (setId) => {
    const set = await getOne("sets", { set_id: setId });
    if (set) setMap.set(setId, set);
  }));
  return resolved.slice(0, 50).map((item) => disputeReplyView(item, setMap.get(item.set_id)));
}

async function markTeacherRepliesSeen(student, event) {
  const ids = Array.isArray(event.dispute_ids)
    ? event.dispute_ids.map((item) => String(item || "")).filter(Boolean)
    : [];
  if (!ids.length) return { success: true, seen_count: 0 };
  const result = await db.collection("answer_disputes").where({
    student_uid: student.auth_uid,
  }).limit(200).get();
  const idSet = new Set(ids);
  const now = new Date();
  let seenCount = 0;
  for (const item of result.data || []) {
    const disputeId = item.dispute_id || item._id;
    if (!idSet.has(disputeId) || item.status === "pending") continue;
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

function isSelfStudyAchievement(item) {
  return Boolean(
    item && !item.assignment_id && (item.source === "self_study" || item.source === "explore")
  );
}

function normalizedStarBuckets(achievements) {
  const assignmentById = new Map();
  const assignmentSetIds = new Set();
  (achievements || []).forEach((item) => {
    if (!item || !item.assignment_id) return;
    const key = String(item.assignment_id);
    if (!assignmentById.has(key)) assignmentById.set(key, item);
    if (item.set_id) assignmentSetIds.add(item.set_id);
  });

  const selfStudyBySet = new Map();
  (achievements || []).forEach((item) => {
    if (!isSelfStudyAchievement(item)) return;
    if (item.set_id && assignmentSetIds.has(item.set_id)) return;
    const key = item.set_id || item.achievement_id || item._id;
    if (!selfStudyBySet.has(key)) selfStudyBySet.set(key, item);
  });

  return {
    assignmentStars: [...assignmentById.values()],
    selfStudyStars: [...selfStudyBySet.values()],
  };
}

function splitStarCounts(achievements) {
  const buckets = normalizedStarBuckets(achievements);
  const assignment = buckets.assignmentStars.length;
  const selfStudy = buckets.selfStudyStars.length;
  return {
    assignment_star_count: assignment,
    self_study_star_count: selfStudy,
    star_count: assignment + selfStudy,
  };
}

async function protectAssignmentStar(student, assignment, bestAttemptId, bestPercentage, earnedAt) {
  const assignmentId = assignment.assignment_id || assignment._id;
  if (!assignmentId) return null;
  const now = new Date();
  const percentage = Number(bestPercentage || 0);
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
      update.best_percentage = percentage;
      update.best_attempt_id = bestAttemptId || existing.best_attempt_id || null;
    }
    await db.collection("student_set_achievements").doc(existing._id).update(update);
    return { ...existing, ...update };
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
      claimed_at: selfStudyStar.claimed_at || earnedAt || now,
      first_earned_at: selfStudyStar.first_earned_at || earnedAt || now,
      first_qualifying_attempt_id: selfStudyStar.first_qualifying_attempt_id
        || bestAttemptId
        || assignment.best_attempt_id
        || assignment.latest_attempt_id
        || null,
      best_attempt_id: bestAttemptId
        || selfStudyStar.best_attempt_id
        || assignment.best_attempt_id
        || assignment.latest_attempt_id
        || null,
      best_percentage: Math.max(percentage, Number(selfStudyStar.best_percentage || 0)),
      updated_at: now,
    };
    await db.collection("student_set_achievements").doc(selfStudyStar._id).update(update);
    return { ...selfStudyStar, ...update };
  }

  const record = {
    achievement_id: [student.auth_uid, assignmentId].join("::"),
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    set_id: assignment.set_id,
    assignment_id: assignmentId,
    status: "star",
    protected: true,
    source: "assignment_claim",
    claimed_at: earnedAt || now,
    first_earned_at: earnedAt || now,
    first_qualifying_attempt_id: bestAttemptId || assignment.best_attempt_id || assignment.latest_attempt_id || null,
    best_attempt_id: bestAttemptId || assignment.best_attempt_id || assignment.latest_attempt_id || null,
    best_percentage: percentage,
    created_at: now,
    updated_at: now,
  };
  await db.collection("student_set_achievements").add(record);
  return record;
}

async function protectSelfStudyStar(student, attempt, earnedAt) {
  const result = await db.collection("student_set_achievements").where({
    student_uid: student.auth_uid,
    set_id: attempt.set_id,
  }).limit(100).get();
  const achievements = result.data || [];
  if (achievements.find((item) => item.assignment_id)) return null;
  const existing = achievements.find((item) =>
    !item.assignment_id && (item.source === "self_study" || item.source === "explore")
  );
  const now = new Date();
  const percentage = effectivePercentage(attempt);
  if (existing) {
    const update = {
      source: "self_study",
      status: "star",
      protected: true,
      updated_at: now,
    };
    if (percentage > Number(existing.best_percentage || 0)) {
      update.best_percentage = percentage;
      update.best_attempt_id = attempt.attempt_id;
    }
    await db.collection("student_set_achievements").doc(existing._id).update(update);
    return { ...existing, ...update };
  }
  const record = {
    achievement_id: [student.auth_uid, attempt.set_id, "self"].join("::"),
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    set_id: attempt.set_id,
    assignment_id: null,
    status: "star",
    protected: true,
    source: "self_study",
    claimed_at: earnedAt || now,
    first_earned_at: earnedAt || now,
    first_qualifying_attempt_id: attempt.attempt_id,
    best_attempt_id: attempt.attempt_id,
    best_percentage: percentage,
    created_at: now,
    updated_at: now,
  };
  await db.collection("student_set_achievements").add(record);
  return record;
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
  await protectAssignmentStar(
    student,
    assignment,
    assignment.best_attempt_id || assignment.latest_attempt_id || null,
    Number(assignment.best_percentage || assignment.latest_percentage || 0),
    assignment.mastered_at || now
  );
  const starResult = await db.collection("student_set_achievements").where({
    student_uid: student.auth_uid,
  }).limit(500).get();
  return { success: true, ...splitStarCounts(starResult.data || []) };
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
    if (action === "markTeacherRepliesSeen") return await markTeacherRepliesSeen(student, event);
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
    const setMap = new Map();
    const disputeResult = await db.collection("answer_disputes").where({
      student_uid: student.auth_uid,
    }).limit(500).get();
    const teacherReplyItems = resolvedTeacherReplyItems(disputeResult.data || []);
    const starResult = await db.collection("student_set_achievements").where({
      student_uid: student.auth_uid,
    }).limit(500).get();
    const achievements = starResult.data || [];
    const starBuckets = normalizedStarBuckets(achievements);
    const claimedAssignmentIds = new Set(starBuckets.assignmentStars
      .map((item) => item.assignment_id)
      .filter(Boolean));
    let selfStudyStars = starBuckets.selfStudyStars;
    const resourceAttempts = attempts.filter((item) => !item.assignment_id && item.set_id);
    const setIds = [...new Set(
      assignments.map((item) => item.set_id)
        .concat(selfStudyStars.map((item) => item.set_id))
        .concat(resourceAttempts.map((item) => item.set_id))
        .concat(teacherReplyItems.map((item) => item.set_id))
        .filter(Boolean)
    )];

    for (const setId of setIds) {
      const setResult = await db.collection("sets").where({
        set_id: setId,
        visible: true,
      }).limit(1).get();
      if (setResult.data && setResult.data[0]) setMap.set(setId, setResult.data[0]);
    }

    const assignmentStarSetIds = new Set(starBuckets.assignmentStars
      .map((item) => item.set_id)
      .filter(Boolean));
    const selfStudySetIds = new Set(selfStudyStars.map((item) => item.set_id).filter(Boolean));
    const bestResourceAttemptsBySet = new Map();
    resourceAttempts.forEach((attempt) => {
      const set = setMap.get(attempt.set_id);
      const masteryPercentage = set ? masteryPercentageForSet(set) : 90;
      const percentage = effectivePercentage(attempt);
      if (percentage < masteryPercentage) return;
      const existing = bestResourceAttemptsBySet.get(attempt.set_id);
      if (!existing || percentage > effectivePercentage(existing)) {
        bestResourceAttemptsBySet.set(attempt.set_id, attempt);
      }
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

    const attemptsByAssignment = new Map();
    attempts.forEach((attempt) => {
      if (!attempt.assignment_id) return;
      const items = attemptsByAssignment.get(attempt.assignment_id) || [];
      items.push(attempt);
      attemptsByAssignment.set(attempt.assignment_id, items);
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
      assignmentViews.push({
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
        teacher_replies: teacherReplies,
        teacher_reply_count: teacherReplies.length,
        set: set || {
          set_id: assignment.set_id,
          title: assignment.set_id,
          link: "#",
        },
      });
    }
    const selfStudyViews = selfStudyStars.map((achievement) => {
      const set = setMap.get(achievement.set_id);
      const attempt = attempts.find((item) => item.attempt_id === achievement.best_attempt_id) || null;
      const percentage = achievement.best_percentage == null
        ? (attempt ? effectivePercentage(attempt) : null)
        : Number(achievement.best_percentage);
      const teacherReplies = (teacherRepliesBySelfStudySet.get(String(achievement.set_id)) || [])
        .map((item) => disputeReplyView(item, set));
      return {
        assignment_id: null,
        achievement_id: achievement.achievement_id || achievement._id,
        source: "self_study",
        status: "mastered",
        assigned_at: achievement.first_earned_at || achievement.created_at || null,
        due_at: null,
        completed_at: achievement.first_earned_at || achievement.created_at || null,
        mastered_at: achievement.first_earned_at || achievement.created_at || null,
        updated_at: achievement.updated_at || achievement.created_at || null,
        attempt_count: 1,
        latest_percentage: percentage,
        best_percentage: percentage,
        best_correct_count: attempt ? attemptCorrectCount(attempt) : null,
        best_question_count: attempt ? attemptQuestionCount(attempt) : null,
        review_attempt_id: achievement.best_attempt_id || null,
        history_attempt_id: achievement.best_attempt_id || null,
        prefill_attempt_id: achievement.best_attempt_id || null,
        answer_revealed: false,
        mastery_locked: false,
        star_claimed: true,
        passing_percentage: set ? passingPercentageForSet(set) : 50,
        mastery_percentage: set ? masteryPercentageForSet(set) : 90,
        teacher_replies: teacherReplies,
        teacher_reply_count: teacherReplies.length,
        set: set || {
          set_id: achievement.set_id,
          title: achievement.set_id,
          link: "#",
        },
      };
    });

    return {
      success: true,
      assignments: assignmentViews.concat(selfStudyViews),
      teacher_replies: teacherReplyItems.slice(0, 50).map((item) => disputeReplyView(item, setMap.get(item.set_id))),
      ...splitStarCounts(achievements),
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
