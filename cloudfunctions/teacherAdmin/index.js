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

function safeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
    sets: (result.data || []).map((set) => ({
      set_id: set.set_id,
      title: set.title || set.set_id,
      course: set.course || set.type || "",
      type: set.type || "",
      passing_percentage: set.passing_percentage == null ? 50 : set.passing_percentage,
    })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

function getAssignmentState(assignments) {
  const open = assignments.find((assignment) =>
    assignment.status === "not_done" || assignment.status === "failed"
  );
  if (open) {
    return {
      availability: "in_progress",
      assignment_id: open.assignment_id || open._id,
      status: open.status || "not_done",
    };
  }
  const completed = assignments.filter((assignment) => assignment.status === "done");
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

async function createAssignmentForStudent(student, setId, dueAt) {
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
    status: "not_done",
    assigned_at: now,
    due_at: dueAt,
    completed_at: null,
    latest_attempt_id: null,
    attempt_count: 0,
    latest_percentage: null,
    best_percentage: null,
    created_at: now,
    updated_at: now,
  };

  await db.collection("assignments").add(assignment);
  return assignmentId;
}

async function createAssignments(event) {
  const setId = text(event.set_id);
  const studentUids = Array.isArray(event.student_uids)
    ? [...new Set(event.student_uids.map(text).filter(Boolean))]
    : [];
  if (!setId || !studentUids.length) throw new Error("ASSIGNMENT_FIELDS_REQUIRED");
  if (studentUids.length > 200) throw new Error("TOO_MANY_STUDENTS");
  if (!await getOne("sets", { set_id: setId, visible: true })) throw new Error("SET_NOT_FOUND");

  const dueAt = safeDate(event.due_at);
  const assignmentsByStudent = await getAssignmentsByStudent(setId);
  const created = [];
  const skipped = [];
  for (const studentUid of studentUids) {
    const student = await getOne("students", {
      auth_uid: studentUid,
      active: true,
    });
    if (!student || student.role === "teacher") {
      skipped.push({ student_uid: studentUid, reason: "inactive_or_missing" });
      continue;
    }
    const assignmentState = getAssignmentState(assignmentsByStudent.get(studentUid) || []);
    if (assignmentState.availability === "in_progress") {
      skipped.push({
        student_uid: studentUid,
        student_id: student.student_id,
        reason: "in_progress",
      });
      continue;
    }
    const assignmentId = await createAssignmentForStudent(student, setId, dueAt);
    created.push({
      student_uid: studentUid,
      student_id: student.student_id,
      assignment_id: assignmentId,
      reassigned_after_completion: assignmentState.availability === "completed",
    });
  }
  return { success: true, created, skipped };
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
        status: assignment.status || "not_done",
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
      percentage: Number(attempt.percentage || 0),
      passing_percentage: Number(attempt.passing_percentage || 50),
      passed: attempt.passed === true,
      selected_group_count: attempt.selected_group_count || null,
      submitted_at: attempt.submitted_at || null,
      practice_context: attempt.practice_context || "",
      };
    }).sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0)),
  };
}

exports.main = async (event) => {
  try {
    await getAuthenticatedTeacher();
    const action = text(event.action);
    if (action === "listStudents") return await listStudents();
    if (action === "createStudent") return await createStudent(event);
    if (action === "updateStudent") return await updateStudent(event);
    if (action === "resetStudentPassword") return await resetStudentPassword(event);
    if (action === "listSets") return await listSets();
    if (action === "getAssignmentCandidates") return await getAssignmentCandidates(event);
    if (action === "createAssignments") return await createAssignments(event);
    if (action === "listAssignments") return await listAssignments();
    if (action === "listAttempts") return await listAttempts();
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
