const cloudbase = require("@cloudbase/node-sdk");
const CloudBaseManager = require("@cloudbase/manager-node");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const envId = process.env.TENCENTCLOUD_TCB_ENVID || "mrcat-dev-d9gwy2v1icdfdf597";
const manager = CloudBaseManager.init({ envId });

function text(value) {
  return String(value == null ? "" : value).trim();
}

function initialPassword() {
  const password = text(process.env.INITIAL_STUDENT_PASSWORD);
  if (!password) throw new Error("INITIAL_PASSWORD_NOT_CONFIGURED");
  return password;
}

async function getAuthenticatedTeacher() {
  const userInfo = await app.auth().getUserInfo();
  const uid = userInfo && (userInfo.uid || userInfo.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");

  const result = await db.collection("students").where({
    auth_uid: String(uid),
    active: true,
    role: "teacher",
  }).limit(1).get();

  if (!result.data || !result.data[0]) throw new Error("TEACHER_REQUIRED");
  return result.data[0];
}

async function getOne(collection, query) {
  const result = await db.collection(collection).where(query).limit(1).get();
  return result.data && result.data[0];
}

function normalized(value) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function answerList(value) {
  return (Array.isArray(value) ? value : [value])
    .filter((item) => item != null && text(item));
}

function nextGradingVersion(value) {
  const current = Number.parseInt(String(value || "1"), 10);
  return String(Number.isFinite(current) ? current + 1 : 2);
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

async function protectStar(student, attempt, source, now) {
  const existing = await getOne("student_set_achievements", {
    student_uid: student.auth_uid,
    set_id: attempt.set_id,
  });
  const percentage = effectivePercentage(attempt);
  if (existing) {
    const update = { updated_at: now };
    if (percentage > Number(existing.best_percentage || 0)) {
      update.best_percentage = percentage;
      update.best_attempt_id = attempt.attempt_id;
    }
    await db.collection("student_set_achievements").doc(existing._id).update(update);
    return;
  }
  await db.collection("student_set_achievements").add({
    achievement_id: [student.auth_uid, attempt.set_id].join("::"),
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    set_id: attempt.set_id,
    status: "star",
    protected: true,
    source,
    first_earned_at: now,
    first_qualifying_attempt_id: attempt.attempt_id,
    best_attempt_id: attempt.attempt_id,
    best_percentage: percentage,
    created_at: now,
    updated_at: now,
  });
}

function safeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safePercentage(value, fallback) {
  if (value == null || value === "") return Number(fallback);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error("INVALID_PERCENTAGE");
  return number;
}

function practiceLinkForSet(set) {
  if (set.link || set.href) return set.link || set.href;
  const type = text(set.type || set.course).toLowerCase();
  if (type.indexOf("vocab") !== -1) return `vocabulary.html?set=${encodeURIComponent(set.set_id)}`;
  if (type.indexOf("ielts") !== -1 || type.indexOf("reading") !== -1) return `ielts-reading.html?set=${encodeURIComponent(set.set_id)}`;
  return `bbc.html?set=${encodeURIComponent(set.set_id)}`;
}

function uniqueBySetId(items) {
  const seen = new Set();
  const output = [];
  (items || []).forEach((item) => {
    const key = text(item.set_id || item._id);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    output.push(item);
  });
  return output;
}

function studentView(student) {
  const source = student || {};
  const authUid = text(source.auth_uid);
  const studentId = text(source.student_id);
  return {
    profile_id: source._id || "",
    auth_uid: authUid,
    student_id: studentId,
    name: source.name || "",
    class_group: source.class_group || "",
    curriculum_track: source.curriculum_track || "",
    role: source.role || "student",
    active: source.active === true,
    must_change_password: source.must_change_password === true,
    profile_complete: Boolean(authUid && studentId),
    created_at: source.created_at || null,
    updated_at: source.updated_at || null,
  };
}

async function listStudents() {
  const result = await db.collection("students").limit(200).get();
  return {
    success: true,
    students: (result.data || [])
      .map(studentView)
      .sort((a, b) => String(a.student_id || "").localeCompare(String(b.student_id || ""))),
  };
}

function uidFromEndUser(user) {
  return text(user && (
    user.UUId || user.Uuid || user.UUID || user.uuid || user.Uid || user.uid || user.UserId
  ));
}

async function findEndUserByUsername(username) {
  let offset = 0;
  const limit = 100;
  while (offset < 1000) {
    const result = await manager.user.getEndUserList({ limit, offset });
    const users = result && Array.isArray(result.Users) ? result.Users : [];
    const match = users.find((user) =>
      text(user.UserName || user.Username || user.userName).toLowerCase() === username.toLowerCase()
    );
    if (match) return match;
    if (users.length < limit) break;
    offset += limit;
  }
  return null;
}

async function resolveCreatedEndUser(createResult, username) {
  const responseUser = createResult && (createResult.User || createResult.user);
  if (uidFromEndUser(responseUser)) return responseUser;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const found = await findEndUserByUsername(username);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  return null;
}

async function createStudent(event) {
  const studentId = text(event.student_id);
  const name = text(event.name);
  const classGroup = text(event.class_group);
  const curriculumTrack = text(event.curriculum_track);

  if (!studentId || !name) throw new Error("STUDENT_FIELDS_REQUIRED");
  if (await getOne("students", { student_id: studentId })) throw new Error("STUDENT_ID_EXISTS");
  if (await findEndUserByUsername(studentId)) throw new Error("STUDENT_ID_EXISTS");

  const password = initialPassword();
  let authUid = "";
  try {
    const createResult = await manager.user.createEndUser({
      username: studentId,
      password,
    });
    const authUser = await resolveCreatedEndUser(createResult, studentId);
    authUid = uidFromEndUser(authUser);
    if (!authUid) throw new Error("AUTH_USER_ID_MISSING");
    await manager.user.setEndUserStatus({ uuid: authUid, status: "ENABLE" });
  } catch (error) {
    if (error.message === "AUTH_USER_ID_MISSING") throw error;
    throw new Error(`AUTH_CREATE_FAILED:${error.code || error.message || "UNKNOWN"}`);
  }

  const now = new Date();
  const student = {
    auth_uid: authUid,
    student_id: studentId,
    name,
    class_group: classGroup,
    curriculum_track: curriculumTrack,
    role: "student",
    active: true,
    must_change_password: true,
    created_at: now,
    updated_at: now,
  };
  let addResult = null;
  let verified = null;
  try {
    addResult = await db.collection("students").add(student);
    verified = await getOne("students", {
      auth_uid: authUid,
      student_id: studentId,
    });
    if (!verified) throw new Error("PROFILE_VERIFY_FAILED");
  } catch (error) {
    try {
      await manager.user.deleteEndUsers({ userList: [authUid] });
    } catch (rollbackError) {
      console.error("Unable to roll back auth user", rollbackError);
      throw new Error("PROFILE_CREATE_FAILED_ROLLBACK_REQUIRED");
    }
    throw new Error("PROFILE_CREATE_FAILED_AUTH_ROLLED_BACK");
  }
  return {
    success: true,
    student: studentView(verified || { ...student, _id: addResult && addResult.id }),
    initial_password: password,
  };
}

async function updateStudent(event) {
  const authUid = text(event.auth_uid);
  if (!authUid) throw new Error("AUTH_UID_REQUIRED");
  const student = await getOne("students", { auth_uid: authUid });
  if (!student || student.role === "teacher") throw new Error("STUDENT_NOT_FOUND");

  const update = { updated_at: new Date() };
  if (Object.prototype.hasOwnProperty.call(event, "name")) update.name = text(event.name);
  if (Object.prototype.hasOwnProperty.call(event, "class_group")) update.class_group = text(event.class_group);
  if (Object.prototype.hasOwnProperty.call(event, "curriculum_track")) update.curriculum_track = text(event.curriculum_track);
  if (Object.prototype.hasOwnProperty.call(event, "active")) {
    const active = event.active === true;
    try {
      await manager.user.setEndUserStatus({
        uuid: authUid,
        status: active ? "ENABLE" : "DISABLE",
      });
    } catch (error) {
      throw new Error(`AUTH_STATUS_FAILED:${error.code || error.message || "UNKNOWN"}`);
    }
    update.active = active;
  }
  if (Object.prototype.hasOwnProperty.call(event, "must_change_password")) {
    update.must_change_password = event.must_change_password === true;
  }

  try {
    await db.collection("students").doc(student._id).update(update);
  } catch (error) {
    if (Object.prototype.hasOwnProperty.call(event, "active")) {
      try {
        await manager.user.setEndUserStatus({
          uuid: authUid,
          status: student.active === true ? "ENABLE" : "DISABLE",
        });
      } catch (rollbackError) {
        console.error("Unable to roll back auth status", rollbackError);
        throw new Error("PROFILE_UPDATE_FAILED_ROLLBACK_REQUIRED");
      }
    }
    throw new Error("PROFILE_UPDATE_FAILED");
  }
  return { success: true };
}

async function resetStudentPassword(event) {
  const authUid = text(event.auth_uid);
  if (!authUid) throw new Error("AUTH_UID_REQUIRED");
  const student = await getOne("students", { auth_uid: authUid, role: "student" });
  if (!student) throw new Error("STUDENT_NOT_FOUND");

  const password = initialPassword();
  try {
    await manager.user.modifyEndUser({
      uuid: authUid,
      password,
    });
    await manager.user.setEndUserStatus({ uuid: authUid, status: "ENABLE" });
  } catch (error) {
    throw new Error(`AUTH_RESET_FAILED:${error.code || error.message || "UNKNOWN"}`);
  }
  await db.collection("students").doc(student._id).update({
    active: true,
    must_change_password: true,
    updated_at: new Date(),
  });
  return { success: true, initial_password: password };
}

async function listSets() {
  const result = await db.collection("sets").where({ visible: true }).limit(200).get();
  return {
    success: true,
    sets: uniqueBySetId(result.data || []).map((set) => ({
      set_id: set.set_id,
      title: set.title || set.set_id,
      course: set.course || set.type || "",
      type: set.type || "",
      section: set.section || set.section_id || set.category || set.course || set.type || "",
      link: practiceLinkForSet(set),
      passing_percentage: set.passing_percentage == null ? 50 : set.passing_percentage,
      mastery_percentage: set.mastery_percentage == null ? 90 : set.mastery_percentage,
    })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

function getAssignmentState(assignments) {
  const open = assignments.find((assignment) =>
    ["not_done", "failed", "to_do", "passed"].includes(assignment.status)
  );
  if (open) {
    return {
      availability: "in_progress",
      assignment_id: open.assignment_id || open._id,
      status: open.status || "to_do",
    };
  }
  const completed = assignments.filter((assignment) =>
    assignment.status === "done" || assignment.status === "mastered"
  );
  if (completed.length) {
    return {
      availability: "completed",
      completed_count: completed.length,
      best_percentage: completed.reduce((best, assignment) =>
        Math.max(best, Number(assignment.best_percentage || 0)), 0),
    };
  }
  return { availability: "available" };
}

async function getAssignmentsByStudent(setId) {
  const result = await db.collection("assignments").limit(500).get();
  const map = new Map();
  (result.data || []).forEach((record) => {
    const assignment = record.data && typeof record.data === "object"
      ? { ...record.data, _id: record._id }
      : record;
    if (assignment.set_id !== setId) return;
    const items = map.get(assignment.student_uid) || [];
    items.push(assignment);
    map.set(assignment.student_uid, items);
  });
  return map;
}

async function getAssignmentCandidates(event) {
  const setId = text(event.set_id);
  if (!setId) throw new Error("SET_REQUIRED");
  if (!await getOne("sets", { set_id: setId, visible: true })) throw new Error("SET_NOT_FOUND");

  const studentResult = await db.collection("students").where({
    active: true,
  }).limit(200).get();
  const students = (studentResult.data || []).filter((student) => student.role !== "teacher");
  const assignmentsByStudent = await getAssignmentsByStudent(setId);
  const candidates = [];
  for (const student of students) {
    candidates.push({
      ...studentView(student),
      ...getAssignmentState(assignmentsByStudent.get(student.auth_uid) || []),
    });
  }
  return { success: true, candidates };
}

async function createAssignmentForStudent(student, setId, dueAt, passingPercentage, masteryPercentage) {
  const now = new Date();
  const assignmentId = [
    student.student_id,
    setId,
    Date.now(),
    Math.random().toString(36).slice(2, 7),
  ].join("-");
  const assignment = {
    assignment_id: assignmentId,
    student_uid: student.auth_uid,
    set_id: setId,
    status: "to_do",
    assigned_at: now,
    due_at: dueAt,
    passing_percentage: passingPercentage,
    mastery_percentage: masteryPercentage,
    completed_at: null,
    latest_attempt_id: null,
    attempt_count: 0,
    latest_percentage: null,
    best_percentage: null,
    raw_best_percentage: null,
    best_attempt_id: null,
    best_correct_count: null,
    best_question_count: null,
    answer_revealed: false,
    mastery_locked: false,
    mastered_at: null,
    created_at: now,
    updated_at: now,
  };

  await db.collection("assignments").add(assignment);
  return assignmentId;
}

async function createAssignments(event) {
  const setIds = Array.isArray(event.set_ids)
    ? [...new Set(event.set_ids.map(text).filter(Boolean))]
    : [text(event.set_id)].filter(Boolean);
  const studentUids = Array.isArray(event.student_uids)
    ? [...new Set(event.student_uids.map(text).filter(Boolean))]
    : [];
  if (!setIds.length || !studentUids.length) throw new Error("ASSIGNMENT_FIELDS_REQUIRED");
  if (studentUids.length > 200) throw new Error("TOO_MANY_STUDENTS");
  const dueAt = safeDate(event.due_at);
  const created = [];
  const skipped = [];
  for (const setId of setIds) {
    const set = await getOne("sets", { set_id: setId, visible: true });
    if (!set) {
      skipped.push({ set_id: setId, reason: "set_not_found" });
      continue;
    }
    const passingPercentage = safePercentage(event.passing_percentage, set.passing_percentage == null ? 50 : set.passing_percentage);
    const masteryPercentage = safePercentage(event.mastery_percentage, set.mastery_percentage == null ? 90 : set.mastery_percentage);
    if (passingPercentage > masteryPercentage) throw new Error("PASSING_ABOVE_MASTERY");
    const assignmentsByStudent = await getAssignmentsByStudent(setId);
    for (const studentUid of studentUids) {
      const student = await getOne("students", {
        auth_uid: studentUid,
        active: true,
      });
      if (!student || student.role === "teacher") {
        skipped.push({ student_uid: studentUid, set_id: setId, reason: "inactive_or_missing" });
        continue;
      }
      const assignmentState = getAssignmentState(assignmentsByStudent.get(studentUid) || []);
      if (assignmentState.availability === "completed") {
        skipped.push({
          student_uid: studentUid,
          student_id: student.student_id,
          set_id: setId,
          reason: "already_completed",
        });
        continue;
      }
      if (assignmentState.availability === "in_progress") {
        skipped.push({
          student_uid: studentUid,
          student_id: student.student_id,
          set_id: setId,
          reason: "in_progress",
        });
        continue;
      }
      const assignmentId = await createAssignmentForStudent(student, setId, dueAt, passingPercentage, masteryPercentage);
      created.push({
        student_uid: studentUid,
        student_id: student.student_id,
        set_id: setId,
        assignment_id: assignmentId,
        reassigned_after_completion: assignmentState.availability === "completed",
      });
    }
  }
  return { success: true, created, skipped };
}

async function getAnswerKeyForSet(event) {
  const setId = text(event.set_id);
  if (!setId) throw new Error("SET_REQUIRED");
  const gradingKey = await getOne("grading_keys", { set_id: setId });
  if (!gradingKey) throw new Error("GRADING_KEY_NOT_FOUND");
  return {
    success: true,
    set_id: setId,
    answers: gradingKey.answers || {},
    explanations: gradingKey.explanations || {},
    grading_version: gradingKey.grading_version || "1",
  };
}

async function listAssignments() {
  const [assignmentResult, studentResult, setResult] = await Promise.all([
    db.collection("assignments").limit(500).get(),
    db.collection("students").limit(200).get(),
    db.collection("sets").limit(200).get(),
  ]);
  const rawAssignments = assignmentResult.data || [];
  const studentMap = new Map((studentResult.data || []).map((record) => {
    const student = record.data && typeof record.data === "object" ? record.data : record;
    return [student.auth_uid, student];
  }));
  const setMap = new Map((setResult.data || []).map((set) => [set.set_id, set]));

  return {
    success: true,
    assignments: rawAssignments.map((record) => {
      const assignment = record.data && typeof record.data === "object"
        ? { ...record.data, _id: record._id }
        : record;
      const student = studentMap.get(assignment.student_uid) || {};
      const set = setMap.get(assignment.set_id) || {};
      return {
        assignment_id: assignment.assignment_id || assignment._id,
        student_uid: assignment.student_uid,
        student_id: student.student_id || assignment.student_uid,
        student_name: student.name || "",
        set_id: assignment.set_id,
        set_title: set.title || assignment.set_id,
        status: assignment.status || "to_do",
        attempt_count: Number(assignment.attempt_count || 0),
        latest_percentage: assignment.latest_percentage == null ? null : assignment.latest_percentage,
        best_percentage: assignment.best_percentage == null ? null : assignment.best_percentage,
        assigned_at: assignment.assigned_at || null,
        due_at: assignment.due_at || null,
        completed_at: assignment.completed_at || null,
      };
    }).sort((a, b) => new Date(b.assigned_at || 0) - new Date(a.assigned_at || 0)),
  };
}

async function listAttempts() {
  const result = await db.collection("attempts").limit(500).get();
  const attempts = result.data || [];
  return {
    success: true,
    attempts: attempts.map((record) => {
      const attempt = record.data && typeof record.data === "object"
        ? { ...record.data, _id: record._id }
        : record;
      return {
      attempt_id: attempt.attempt_id || attempt._id,
      student_uid: attempt.student_uid,
      student_id: attempt.student_id_snapshot || "",
      set_id: attempt.set_id,
      assignment_id: attempt.assignment_id || null,
      mode: attempt.mode || "",
      attempt_number: Number(attempt.attempt_number || 0),
      correct_count: Number(attempt.correct_count || 0),
      question_count: Number(attempt.question_count || 0),
      percentage: effectivePercentage(attempt),
      passing_percentage: Number(attempt.passing_percentage || 50),
      passed: effectivePassed(attempt),
      selected_group_count: attempt.selected_group_count || null,
      submitted_at: attempt.submitted_at || null,
      practice_context: attempt.practice_context || "",
      };
    }).sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0)),
  };
}

async function listDisputes() {
  const [disputeResult, studentResult, setResult, gradingKeysResult] = await Promise.all([
    db.collection("answer_disputes").limit(500).get(),
    db.collection("students").limit(200).get(),
    db.collection("sets").limit(200).get(),
    db.collection("grading_keys").limit(200).get(),
  ]);
  const studentMap = new Map((studentResult.data || []).map((item) => [item.auth_uid, item]));
  const setMap = new Map((setResult.data || []).map((item) => [item.set_id, item]));
  const gradingKeysMap = new Map((gradingKeysResult.data || []).map((item) => [item.set_id, item]));
  return {
    success: true,
    disputes: (disputeResult.data || []).map((dispute) => {
      const student = studentMap.get(dispute.student_uid) || {};
      const set = setMap.get(dispute.set_id) || {};
      const gradingKey = gradingKeysMap.get(dispute.set_id) || {};
      const explanations = gradingKey.explanations || {};
      return {
        dispute_id: dispute.dispute_id || dispute._id,
        student_uid: dispute.student_uid,
        student_id: student.student_id || dispute.student_id_snapshot || "",
        student_name: student.name || "",
        set_id: dispute.set_id,
        set_title: set.title || dispute.set_id,
        attempt_id: dispute.attempt_id,
        assignment_id: dispute.assignment_id || null,
        question_id: dispute.question_id,
        question_text_snapshot: dispute.question_text_snapshot || "",
        submitted_answer: dispute.submitted_answer,
        answer_snapshot: dispute.answer_snapshot,
        student_reason: dispute.student_reason || "",
        status: dispute.status || "pending",
        decision: dispute.decision || null,
        teacher_note: dispute.teacher_note || "",
        created_at: dispute.created_at || null,
        updated_at: dispute.updated_at || null,
        resolved_at: dispute.resolved_at || null,
        explanation_snapshot: dispute.explanation_snapshot || "",
        explanation: explanations[dispute.question_id] || "",
      };
    }).sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (a.status !== "pending" && b.status === "pending") return 1;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }),
  };
}

async function improveDisputedAttempt(dispute, teacher, now, gradingVersion) {
  const attempt = await getOne("attempts", {
    attempt_id: dispute.attempt_id,
    student_uid: dispute.student_uid,
  });
  if (!attempt) throw new Error("ATTEMPT_NOT_FOUND");
  const currentResults = effectiveQuestionResults(attempt).map((item) => ({ ...item }));
  const target = currentResults.find((item) => String(item.question_id) === dispute.question_id);
  if (!target) throw new Error("QUESTION_RESULT_NOT_FOUND");
  if (target.correct === true) return attempt;

  target.correct = true;
  target.dispute_adjusted = true;
  target.dispute_id = dispute.dispute_id || dispute._id;
  const correctCount = currentResults.filter((item) => item.correct === true).length;
  const questionCount = Number(attempt.question_count || currentResults.length);
  const recalculated = questionCount
    ? Math.round(correctCount / questionCount * 10000) / 100
    : 0;
  const percentage = Math.max(effectivePercentage(attempt), recalculated);
  const passingPercentage = Number(attempt.passing_percentage || 50);
  const passed = effectivePassed(attempt) || percentage >= passingPercentage;
  const update = {
    original_percentage: attempt.original_percentage == null
      ? Number(attempt.percentage || 0)
      : attempt.original_percentage,
    original_passed: attempt.original_passed == null
      ? attempt.passed === true
      : attempt.original_passed,
    adjusted_question_results: currentResults,
    adjusted_correct_count: correctCount,
    adjusted_percentage: percentage,
    adjusted_passed: passed,
    adjusted_by_dispute_id: dispute.dispute_id || dispute._id,
    adjusted_by_teacher_uid: teacher.auth_uid,
    adjusted_grading_version: gradingVersion,
    adjusted_at: now,
  };
  await db.collection("attempts").doc(attempt._id).update(update);
  const adjustedAttempt = { ...attempt, ...update };

  if (attempt.assignment_id) {
    const assignment = await getOne("assignments", {
      assignment_id: attempt.assignment_id,
      student_uid: attempt.student_uid,
    });
    if (assignment) {
      const set = await getOne("sets", { set_id: attempt.set_id });
      const masteryPercentage = Number(assignment.mastery_percentage != null
        ? assignment.mastery_percentage
        : (!set || set.mastery_percentage == null ? 90 : set.mastery_percentage));
      const cappedPercentage = assignment.mastery_locked === true && assignment.status !== "mastered" && percentage >= masteryPercentage
        ? masteryPercentage - 0.01
        : percentage;
      const adjustedStatus = assignment.status === "mastered"
        ? "mastered"
        : (!assignment.mastery_locked && percentage >= masteryPercentage ? "mastered" : (passed ? "passed" : "to_do"));
      const assignmentUpdate = {
        best_percentage: Math.max(Number(assignment.best_percentage || 0), cappedPercentage),
        raw_best_percentage: Math.max(Number(assignment.raw_best_percentage || 0), percentage),
        updated_at: now,
      };
      if (assignment.latest_attempt_id === attempt.attempt_id) {
        assignmentUpdate.latest_percentage = cappedPercentage;
        assignmentUpdate.latest_raw_percentage = percentage;
      }
      if (passed) {
        assignmentUpdate.status = adjustedStatus;
        if (!assignment.completed_at) assignmentUpdate.completed_at = now;
        if (adjustedStatus === "mastered" && !assignment.mastered_at) assignmentUpdate.mastered_at = now;
      }
      await db.collection("assignments").doc(assignment._id).update(assignmentUpdate);
    }
  }

  return adjustedAttempt;
}

async function resolveDispute(event, teacher) {
  const disputeId = text(event.dispute_id);
  const decision = text(event.decision);
  const teacherNote = text(event.teacher_note).slice(0, 1000);
  if (!disputeId || !["keep", "add", "replace"].includes(decision)) {
    throw new Error("DISPUTE_DECISION_REQUIRED");
  }
  const dispute = await getOne("answer_disputes", { dispute_id: disputeId });
  if (!dispute) throw new Error("DISPUTE_NOT_FOUND");
  if (dispute.status !== "pending") throw new Error("DISPUTE_ALREADY_RESOLVED");

  const now = new Date();
  if (decision !== "keep") {
    if (!text(dispute.submitted_answer)) throw new Error("EMPTY_ANSWER_NOT_ACCEPTABLE");
    const gradingKey = await getOne("grading_keys", { set_id: dispute.set_id });
    if (!gradingKey) throw new Error("GRADING_KEY_NOT_FOUND");
    const answers = { ...(gradingKey.answers || {}) };
    const before = answers[dispute.question_id];
    if (decision === "add") {
      const accepted = answerList(before);
      if (!accepted.some((item) => normalized(item) === normalized(dispute.submitted_answer))) {
        accepted.push(dispute.submitted_answer);
      }
      answers[dispute.question_id] = accepted;
    } else {
      answers[dispute.question_id] = dispute.submitted_answer;
    }
    const newVersion = nextGradingVersion(gradingKey.grading_version);
    const historyRecord = {
      history_id: [dispute.set_id, dispute.question_id, Date.now()].join("::"),
      set_id: dispute.set_id,
      question_id: dispute.question_id,
      dispute_id: disputeId,
      decision,
      answer_before: before == null ? null : before,
      answer_after: answers[dispute.question_id],
      grading_version_before: gradingKey.grading_version || "1",
      grading_version_after: newVersion,
      changed_by_teacher_uid: teacher.auth_uid,
      changed_at: now,
      applied: false,
    };
    const historyAdd = await db.collection("grading_key_history").add(historyRecord);
    await db.collection("grading_keys").doc(gradingKey._id).update({
      answers,
      grading_version: newVersion,
      updated_at: now,
    });
    if (historyAdd && historyAdd.id) {
      await db.collection("grading_key_history").doc(historyAdd.id).update({
        applied: true,
        applied_at: now,
      });
    }
    await improveDisputedAttempt(dispute, teacher, now, newVersion);
    dispute.grading_version_after = newVersion;
  }

  await db.collection("answer_disputes").doc(dispute._id).update({
    status: decision === "keep" ? "rejected" : "approved",
    decision,
    teacher_note: teacherNote,
    resolved_by_teacher_uid: teacher.auth_uid,
    grading_version_after: dispute.grading_version_after || null,
    resolved_at: now,
    updated_at: now,
  });
  return { success: true };
}

exports.main = async (event) => {
  try {
    const teacher = await getAuthenticatedTeacher();
    const action = text(event.action);
    if (action === "listStudents") return await listStudents();
    if (action === "createStudent") return await createStudent(event);
    if (action === "updateStudent") return await updateStudent(event);
    if (action === "resetStudentPassword") return await resetStudentPassword(event);
    if (action === "listSets") return await listSets();
    if (action === "getAssignmentCandidates") return await getAssignmentCandidates(event);
    if (action === "createAssignments") return await createAssignments(event);
    if (action === "getAnswerKeyForSet") return await getAnswerKeyForSet(event);
    if (action === "listAssignments") return await listAssignments();
    if (action === "listAttempts") return await listAttempts();
    if (action === "listDisputes") return await listDisputes();
    if (action === "resolveDispute") return await resolveDispute(event, teacher);
    throw new Error("UNKNOWN_ACTION");
  } catch (error) {
    console.error("teacherAdmin failed", error);
    return {
      success: false,
      code: error.message || "TEACHER_ADMIN_ERROR",
      message: error.message === "TEACHER_REQUIRED"
        ? "Teacher access is required."
        : error.message === "STUDENT_ID_EXISTS"
          ? "This Login ID already exists. Please use a different ID."
          : `Unable to complete this teacher action (${error.message || "TEACHER_ADMIN_ERROR"}).`,
    };
  }
};
