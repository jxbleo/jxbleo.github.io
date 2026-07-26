const cloudbase = require("@cloudbase/node-sdk");
const CloudBaseManager = require("@cloudbase/manager-node");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const envId = process.env.TENCENTCLOUD_TCB_ENVID || "mrcat-dev-d9gwy2v1icdfdf597";
const manager = CloudBaseManager.init({ envId });
const READ_PAGE_LIMIT = 500;

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

async function getPage(collection, options = {}) {
  const pageSize = Math.min(Math.max(Number(options.limit || READ_PAGE_LIMIT), 1), READ_PAGE_LIMIT);
  const offset = Math.max(Number(options.offset || 0), 0);
  let query = db.collection(collection);
  if (options.where) query = query.where(options.where);
  if (options.orderBy) query = query.orderBy(options.orderBy.field, options.orderBy.direction || "asc");
  const result = await query.skip(offset).limit(pageSize).get();
  return result.data || [];
}

function normalized(value) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function answerList(value) {
  return (Array.isArray(value) ? value : [value])
    .filter((item) => item != null && text(item));
}

function matchingAcceptedAnswer(submitted, expected) {
  const submittedValue = normalized(submitted);
  if (!submittedValue) return null;
  return answerList(expected).find((answer) => normalized(answer) === submittedValue) || null;
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

function recordData(record) {
  return record && record.data && typeof record.data === "object"
    ? { ...record.data, _id: record._id }
    : record;
}

function isDeletedStudent(student) {
  return Boolean(student && (student.deleted_at || student.delete_pending === true || student.deleted === true));
}

function visibleStudentRecords(rows) {
  return (rows || []).map(recordData).filter((student) => !isDeletedStudent(student));
}

function archivedStudentId(student) {
  const source = recordData(student) || {};
  return `__deleted__:${text(source._id || source.auth_uid)}`;
}

async function releaseDeletedStudentId(student, releasedAt = new Date()) {
  const source = recordData(student);
  if (!source || !source._id || !isDeletedStudent(source)) throw new Error("STUDENT_DELETE_ARCHIVE_INVALID");
  const originalStudentId = text(source.deleted_student_id_snapshot || source.student_id);
  await db.collection("students").doc(source._id).update({
    student_id: archivedStudentId(source),
    deleted_student_id_snapshot: originalStudentId,
    deleted_student_id_released_at: releasedAt,
    updated_at: releasedAt,
  });
}

function normalizedAssignmentStatus(status) {
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "mastered") return "mastered";
  if (status === "passed" || status === "done") return "passed";
  return "to_do";
}

function isOpenAssignmentStatus(status) {
  return ["not_done", "failed", "to_do"].includes(status || "to_do");
}

function assignmentMasteryLocked(assignment) {
  return Boolean(assignment && assignment.mastery_locked === true && assignment.status !== "mastered");
}

function assignmentMasteryEnabled(assignment) {
  return !assignment || assignment.mastery_enabled !== false;
}

function statusForPercentage(rawPercentage, passingPercentage, masteryPercentage, assignment) {
  const percentage = Number(rawPercentage);
  if (!Number.isFinite(percentage)) return "to_do";
  if (assignmentMasteryEnabled(assignment) && !assignmentMasteryLocked(assignment) && percentage >= masteryPercentage) return "mastered";
  if (percentage >= passingPercentage) return "passed";
  return "to_do";
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

function attemptDateValue(attempt) {
  const value = attempt && (attempt.submitted_at || attempt.updated_at || attempt.created_at);
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function isSelfStudyAchievement(item) {
  return Boolean(
    item && !item.assignment_id && (item.source === "self_study" || item.source === "explore")
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

function passingPercentageForSet(set) {
  return Number(!set || set.passing_percentage == null ? defaultPassingPercentageForSet(set) : set.passing_percentage);
}

function masteryPercentageForSet(set) {
  return Number(!set || set.mastery_percentage == null ? defaultMasteryPercentageForSet(set) : set.mastery_percentage);
}

async function protectAssignmentStar(student, assignment, attempt, now) {
  const assignmentId = assignment.assignment_id || assignment._id;
  if (!student || !assignmentId) return null;
  const percentage = effectivePercentage(attempt);
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
      update.best_attempt_id = attempt.attempt_id;
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
      claimed_at: selfStudyStar.claimed_at || now,
      first_earned_at: selfStudyStar.first_earned_at || now,
      first_qualifying_attempt_id: selfStudyStar.first_qualifying_attempt_id || attempt.attempt_id,
      best_attempt_id: attempt.attempt_id || selfStudyStar.best_attempt_id || null,
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
    claimed_at: now,
    first_earned_at: now,
    first_qualifying_attempt_id: attempt.attempt_id,
    best_attempt_id: attempt.attempt_id,
    best_percentage: percentage,
    created_at: now,
    updated_at: now,
  };
  await db.collection("student_set_achievements").add(record);
  return record;
}

async function protectSelfStudyStar(student, attempt, now) {
  if (!student || !attempt || !attempt.set_id) return null;
  const result = await db.collection("student_set_achievements").where({
    student_uid: student.auth_uid,
    set_id: attempt.set_id,
  }).limit(100).get();
  const achievements = result.data || [];
  if (achievements.find((item) => item.assignment_id)) return null;
  const existing = achievements.find(isSelfStudyAchievement);
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
    claimed_at: now,
    first_earned_at: now,
    first_qualifying_attempt_id: attempt.attempt_id,
    best_attempt_id: attempt.attempt_id,
    best_percentage: percentage,
    created_at: now,
    updated_at: now,
  };
  await db.collection("student_set_achievements").add(record);
  return record;
}

function safeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shanghaiDateParts(value) {
  const date = safeDate(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const output = {};
  parts.forEach((part) => {
    if (part.type !== "literal") output[part.type] = Number(part.value);
  });
  return output.year && output.month && output.day ? output : null;
}

function dueWeekEnd(value) {
  const parts = shanghaiDateParts(value);
  if (!parts) return null;
  const day = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const mondayIndex = (day.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + (6 - mondayIndex), 15, 59, 59));
}

function effectiveAssignmentDueAt(assignment) {
  return safeDate(assignment && assignment.due_at)
    || dueWeekEnd(assignment && (assignment.assigned_at || assignment.created_at));
}

function safePercentage(value, fallback) {
  if (value == null || value === "") return Number(fallback);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error("INVALID_PERCENTAGE");
  return number;
}

function safeBoolean(value, fallback) {
  if (value == null || value === "") return Boolean(fallback);
  if (value === true || value === false) return value;
  const normalizedValue = normalized(value);
  if (["true", "1", "yes", "on"].includes(normalizedValue)) return true;
  if (["false", "0", "no", "off"].includes(normalizedValue)) return false;
  throw new Error("INVALID_BOOLEAN");
}

async function bestCompletedSelfStudyAttempt(studentUid, setId, passingPercentage, masteryPercentage) {
  const attempts = await getAll("attempts", {
    where: {
      student_uid: studentUid,
      set_id: setId,
    },
  });
  return attempts
    .map(recordData)
    .filter((attempt) => !attempt.assignment_id)
    .filter((attempt) =>
      statusRank(statusForPercentage(effectivePercentage(attempt), passingPercentage, masteryPercentage, null)) >= statusRank("passed")
    )
    .sort((left, right) => {
      const scoreDiff = effectivePercentage(right) - effectivePercentage(left);
      if (scoreDiff) return scoreDiff;
      return attemptDateValue(right) - attemptDateValue(left);
    })[0] || null;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
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
  const students = visibleStudentRecords(await getAll("students"));
  return {
    success: true,
    students: students
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
  const matchingProfiles = (await getAll("students", { where: { student_id: studentId } })).map(recordData);
  if (matchingProfiles.some((student) => !isDeletedStudent(student))) throw new Error("STUDENT_ID_EXISTS");
  if (await findEndUserByUsername(studentId)) throw new Error("STUDENT_ID_EXISTS");

  for (const deletedStudent of matchingProfiles) {
    await releaseDeletedStudentId(deletedStudent);
  }

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
  if (!student || student.role === "teacher" || isDeletedStudent(student)) throw new Error("STUDENT_NOT_FOUND");

  const update = { updated_at: new Date() };
  if (Object.prototype.hasOwnProperty.call(event, "name")) {
    update.name = text(event.name);
    if (!update.name) throw new Error("STUDENT_NAME_REQUIRED");
  }
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

async function deleteStudentAccount(event, teacher) {
  const authUid = text(event.auth_uid);
  if (!authUid) throw new Error("AUTH_UID_REQUIRED");
  const student = await getOne("students", { auth_uid: authUid });
  if (!student || student.role === "teacher" || isDeletedStudent(student)) throw new Error("STUDENT_NOT_FOUND");
  const now = new Date();
  const pendingUpdate = {
    active: false,
    delete_pending: true,
    delete_requested_at: now,
    delete_requested_by_teacher_uid: teacher.auth_uid,
    updated_at: now,
  };

  await db.collection("students").doc(student._id).update(pendingUpdate);
  try {
    await manager.user.deleteEndUsers({ userList: [authUid] });
  } catch (error) {
    try {
      await db.collection("students").doc(student._id).update({
        active: student.active === true,
        delete_pending: false,
        delete_failed_at: new Date(),
        delete_failed_reason: text(error.code || error.message || "UNKNOWN").slice(0, 200),
        updated_at: new Date(),
      });
    } catch (rollbackError) {
      console.error("Unable to roll back student delete marker", rollbackError);
      throw new Error("AUTH_DELETE_FAILED_ROLLBACK_REQUIRED");
    }
    throw new Error(`AUTH_DELETE_FAILED:${error.code || error.message || "UNKNOWN"}`);
  }

  await db.collection("students").doc(student._id).update({
    active: false,
    delete_pending: false,
    deleted: true,
    deleted_at: now,
    deleted_by_teacher_uid: teacher.auth_uid,
    deleted_student_id_snapshot: student.student_id || "",
    deleted_name_snapshot: student.name || "",
    student_id: archivedStudentId(student),
    deleted_student_id_released_at: now,
    updated_at: now,
  });
  return { success: true };
}

async function resetStudentPassword(event) {
  const authUid = text(event.auth_uid);
  if (!authUid) throw new Error("AUTH_UID_REQUIRED");
  const student = await getOne("students", { auth_uid: authUid, role: "student" });
  if (!student || isDeletedStudent(student)) throw new Error("STUDENT_NOT_FOUND");

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
  const sets = await getAll("sets", { where: { visible: true } });
  return {
    success: true,
    sets: uniqueBySetId(sets).map((set) => ({
      set_id: set.set_id,
      title: set.title || set.set_id,
      course: set.course || set.type || "",
      type: set.type || "",
      section: set.section || set.section_id || set.category || set.course || set.type || "",
      link: practiceLinkForSet(set),
      passing_percentage: passingPercentageForSet(set),
      mastery_percentage: masteryPercentageForSet(set),
    })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

function getAssignmentState(assignments) {
  const open = assignments.find((assignment) =>
    isOpenAssignmentStatus(assignment.status)
  );
  if (open) {
    return {
      availability: "in_progress",
      assignment_id: open.assignment_id || open._id,
      status: open.status || "to_do",
    };
  }
  const completed = assignments.filter((assignment) =>
    ["done", "passed", "mastered"].includes(assignment.status)
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
  const assignments = await getAll("assignments", { where: { set_id: setId } });
  const map = new Map();
  assignments.forEach((record) => {
    const assignment = record.data && typeof record.data === "object"
      ? { ...record.data, _id: record._id }
      : record;
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

  const studentRows = await getAll("students", { where: {
    active: true,
  } });
  const students = visibleStudentRecords(studentRows).filter((student) => student.role !== "teacher");
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

async function createAssignmentForStudent(student, setId, dueAt, passingPercentage, masteryPercentage, masteryEnabled, assignmentBatchId) {
  const now = new Date();
  const achievementResult = await db.collection("student_set_achievements").where({
    student_uid: student.auth_uid,
    set_id: setId,
  }).limit(100).get();
  const selfStudyStar = (achievementResult.data || []).find((item) =>
    !item.assignment_id && (item.source === "self_study" || item.source === "explore")
  );
  const selfStudyAttempt = selfStudyStar && selfStudyStar.best_attempt_id
    ? await getOne("attempts", {
        attempt_id: selfStudyStar.best_attempt_id,
        student_uid: student.auth_uid,
      })
    : null;
  const bestSelfStudyAttempt = await bestCompletedSelfStudyAttempt(
    student.auth_uid,
    setId,
    passingPercentage,
    masteryPercentage
  );
  const selfStudyPercentage = Number(
    bestSelfStudyAttempt
      ? effectivePercentage(bestSelfStudyAttempt)
      : selfStudyStar && selfStudyStar.best_percentage != null
        ? selfStudyStar.best_percentage
        : (selfStudyAttempt ? effectivePercentage(selfStudyAttempt) : 0)
  );
  const assignmentRules = { mastery_enabled: masteryEnabled };
  const selfStudyStatus = statusForPercentage(selfStudyPercentage, passingPercentage, masteryPercentage, assignmentRules);
  const convertsSelfStudy = statusRank(selfStudyStatus) >= statusRank("passed");
  const convertsToMastery = selfStudyStatus === "mastered";
  const conversionAttempt = bestSelfStudyAttempt || selfStudyAttempt;
  const convertedAt = conversionAttempt && conversionAttempt.submitted_at
    || selfStudyStar && selfStudyStar.first_earned_at
    || now;
  const assignmentId = [
    student.student_id,
    setId,
    Date.now(),
    Math.random().toString(36).slice(2, 7),
  ].join("-");
  const assignment = {
    assignment_id: assignmentId,
    assignment_batch_id: assignmentBatchId,
    student_uid: student.auth_uid,
    set_id: setId,
    status: convertsSelfStudy ? selfStudyStatus : "to_do",
    // Legacy mirror for older static clients. New scheduling logic reads due_at only.
    assigned_at: dueAt,
    due_at: dueAt,
    passing_percentage: passingPercentage,
    mastery_percentage: masteryPercentage,
    mastery_enabled: masteryEnabled,
    completed_at: convertsSelfStudy ? convertedAt : null,
    latest_attempt_id: convertsSelfStudy && conversionAttempt ? conversionAttempt.attempt_id || null : null,
    attempt_count: convertsSelfStudy ? 1 : 0,
    latest_percentage: convertsSelfStudy ? selfStudyPercentage : null,
    best_percentage: convertsSelfStudy ? selfStudyPercentage : null,
    raw_best_percentage: convertsSelfStudy ? selfStudyPercentage : null,
    best_attempt_id: convertsSelfStudy && conversionAttempt ? conversionAttempt.attempt_id || null : null,
    best_correct_count: convertsSelfStudy && conversionAttempt ? conversionAttempt.correct_count : null,
    best_question_count: convertsSelfStudy && conversionAttempt ? conversionAttempt.question_count : null,
    answer_revealed: false,
    mastery_locked: false,
    mastered_at: convertsToMastery ? convertedAt : null,
    converted_from_self_study: convertsSelfStudy,
    converted_self_study_achievement_id: convertsSelfStudy && selfStudyStar ? selfStudyStar.achievement_id || selfStudyStar._id : null,
    converted_self_study_attempt_id: convertsSelfStudy && conversionAttempt ? conversionAttempt.attempt_id || null : null,
    created_at: now,
    updated_at: now,
  };

  await db.collection("assignments").add(assignment);
  if (convertsToMastery && conversionAttempt) {
    await protectAssignmentStar(student, assignment, conversionAttempt, convertedAt);
  } else if (convertsToMastery && selfStudyStar) {
    await db.collection("student_set_achievements").doc(selfStudyStar._id).update({
      achievement_id: [student.auth_uid, assignmentId].join("::"),
      assignment_id: assignmentId,
      source: "assignment_claim",
      status: "star",
      protected: true,
      converted_from_self_study: true,
      converted_at: now,
      claimed_at: selfStudyStar.claimed_at || now,
      first_earned_at: selfStudyStar.first_earned_at || convertedAt,
      best_percentage: Math.max(selfStudyPercentage, Number(selfStudyStar.best_percentage || 0)),
      updated_at: now,
    });
  }
  return { assignmentId, convertedFromSelfStudy: convertsSelfStudy };
}

function createAssignmentOptionsBySet(event, setIds) {
  const allowed = new Set(setIds);
  const map = new Map();
  if (!Array.isArray(event.set_options)) return map;
  event.set_options.forEach((option) => {
    if (!option || typeof option !== "object") return;
    const setId = text(option.set_id);
    if (!setId || !allowed.has(setId)) return;
    map.set(setId, option);
  });
  return map;
}

function optionOrEventValue(option, event, key) {
  return hasOwn(option, key) ? option[key] : event[key];
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
  const optionsBySet = createAssignmentOptionsBySet(event, setIds);
  const created = [];
  const skipped = [];
  for (const setId of setIds) {
    const set = await getOne("sets", { set_id: setId, visible: true });
    if (!set) {
      skipped.push({ set_id: setId, reason: "set_not_found" });
      continue;
    }
    const setOptions = optionsBySet.get(setId) || {};
    const dueInput = optionOrEventValue(setOptions, event, "due_at")
      || optionOrEventValue(setOptions, event, "assigned_at");
    const dueAt = dueWeekEnd(dueInput);
    if (!dueAt) throw new Error("DUE_WEEK_REQUIRED");
    const passingPercentage = safePercentage(
      optionOrEventValue(setOptions, event, "passing_percentage"),
      passingPercentageForSet(set)
    );
    const masteryEnabled = safeBoolean(
      optionOrEventValue(setOptions, event, "mastery_enabled"),
      false
    );
    const masteryValue = optionOrEventValue(setOptions, event, "mastery_percentage");
    if (masteryEnabled && text(masteryValue) === "") throw new Error("MASTERY_REQUIRED");
    const defaultMastery = masteryEnabled
      ? masteryPercentageForSet(set)
      : Math.max(passingPercentage, masteryPercentageForSet(set));
    const masteryPercentage = safePercentage(masteryValue, defaultMastery);
    const assignmentBatchId = [
      "assign",
      setId,
      Date.now(),
      Math.random().toString(36).slice(2, 8),
    ].join("-");
    if (passingPercentage > masteryPercentage) throw new Error("PASSING_ABOVE_MASTERY");
    const assignmentsByStudent = await getAssignmentsByStudent(setId);
    for (const studentUid of studentUids) {
      const student = await getOne("students", {
        auth_uid: studentUid,
        active: true,
      });
      if (!student || student.role === "teacher" || isDeletedStudent(student)) {
        skipped.push({ student_uid: studentUid, set_id: setId, reason: "inactive_or_missing" });
        continue;
      }
      const assignmentState = getAssignmentState(assignmentsByStudent.get(studentUid) || []);
      if (assignmentState.availability === "in_progress") {
        skipped.push({
          student_uid: studentUid,
          student_id: student.student_id,
          set_id: setId,
          reason: "in_progress",
        });
        continue;
      }
      const assignmentResult = await createAssignmentForStudent(student, setId, dueAt, passingPercentage, masteryPercentage, masteryEnabled, assignmentBatchId);
      created.push({
        student_uid: studentUid,
        student_id: student.student_id,
        set_id: setId,
        assignment_id: assignmentResult.assignmentId,
        reassigned_after_completion: assignmentState.availability === "completed",
        converted_from_self_study: assignmentResult.convertedFromSelfStudy,
      });
    }
  }
  return { success: true, created, skipped };
}

async function getAssignmentByStableId(assignmentId) {
  const stableId = text(assignmentId);
  if (!stableId) return null;
  const assignment = await getOne("assignments", { assignment_id: stableId });
  if (assignment) return assignment;
  return await getOne("assignments", { _id: stableId });
}

async function updateAssignments(event, teacher) {
  const assignmentIds = Array.isArray(event.assignment_ids)
    ? [...new Set(event.assignment_ids.map(text).filter(Boolean))]
    : [text(event.assignment_id)].filter(Boolean);
  if (!assignmentIds.length) throw new Error("ASSIGNMENT_REQUIRED");
  if (assignmentIds.length > 500) throw new Error("TOO_MANY_ASSIGNMENTS");

  const canUpdateDue = hasOwn(event, "due_at") || hasOwn(event, "assigned_at");
  const canUpdatePassing = hasOwn(event, "passing_percentage");
  const canUpdateMastery = hasOwn(event, "mastery_percentage");
  const canUpdateMasteryEnabled = hasOwn(event, "mastery_enabled");
  if (!canUpdateDue && !canUpdatePassing && !canUpdateMastery && !canUpdateMasteryEnabled) {
    throw new Error("NO_ASSIGNMENT_UPDATES");
  }

  const now = new Date();
  const assignments = [];
  for (const assignmentId of assignmentIds) {
    const assignment = await getAssignmentByStableId(assignmentId);
    if (assignment) assignments.push(recordData(assignment));
  }
  const foundIds = new Set(assignments.map((assignment) => String(assignment.assignment_id || assignment._id)));
  const missing = assignmentIds.filter((id) => !foundIds.has(id));
  const updated = [];
  const skipped = [];

  for (const assignment of assignments) {
    if (normalizedAssignmentStatus(assignment.status) === "cancelled") {
      skipped.push({
        assignment_id: assignment.assignment_id || assignment._id,
        reason: "cancelled",
      });
      continue;
    }
    const currentPassing = Number(assignment.passing_percentage == null ? 50 : assignment.passing_percentage);
    const currentMastery = Number(assignment.mastery_percentage == null ? 90 : assignment.mastery_percentage);
    const passing = canUpdatePassing
      ? safePercentage(event.passing_percentage, currentPassing)
      : currentPassing;
    const mastery = canUpdateMastery
      ? safePercentage(event.mastery_percentage, currentMastery)
      : currentMastery;
    const masteryEnabled = canUpdateMasteryEnabled
      ? safeBoolean(event.mastery_enabled, assignmentMasteryEnabled(assignment))
      : assignmentMasteryEnabled(assignment);
    if (masteryEnabled && passing > mastery) throw new Error("PASSING_ABOVE_MASTERY");

    const update = { updated_at: now };
    if (canUpdateDue) {
      const dueInput = hasOwn(event, "due_at") ? event.due_at : event.assigned_at;
      const dueAt = dueWeekEnd(dueInput);
      if (!dueAt) throw new Error("DUE_WEEK_REQUIRED");
      update.due_at = dueAt;
      if (assignment.assignment_batch_id || !assignment.assigned_at) {
        update.assigned_at = dueAt;
      }
      update.schedule_updated_at = now;
      update.schedule_updated_by_teacher_uid = teacher.auth_uid;
    }
    if (canUpdatePassing) update.passing_percentage = passing;
    if (canUpdateMastery) update.mastery_percentage = mastery;
    if (canUpdateMasteryEnabled) update.mastery_enabled = masteryEnabled;
    if (canUpdateDue || canUpdatePassing || canUpdateMastery || canUpdateMasteryEnabled) {
      update.standards_updated_at = now;
      update.standards_updated_by_teacher_uid = teacher.auth_uid;
    }

    await db.collection("assignments").doc(assignment._id).update(update);
    updated.push({
      assignment_id: assignment.assignment_id || assignment._id,
      student_uid: assignment.student_uid,
      set_id: assignment.set_id,
    });
  }

  return { success: true, updated, missing, skipped };
}

async function cancelAssignments(event, teacher) {
  const assignmentIds = Array.isArray(event.assignment_ids)
    ? [...new Set(event.assignment_ids.map(text).filter(Boolean))]
    : [text(event.assignment_id)].filter(Boolean);
  if (!assignmentIds.length) throw new Error("ASSIGNMENT_REQUIRED");
  if (assignmentIds.length > 500) throw new Error("TOO_MANY_ASSIGNMENTS");

  const now = new Date();
  const reason = text(event.reason).slice(0, 500);
  const assignments = [];
  for (const assignmentId of assignmentIds) {
    const assignment = await getAssignmentByStableId(assignmentId);
    if (assignment) assignments.push(recordData(assignment));
  }
  const foundIds = new Set(assignments.map((assignment) => String(assignment.assignment_id || assignment._id)));
  const missing = assignmentIds.filter((id) => !foundIds.has(id));
  const cancelled = [];
  const skipped = [];

  for (const assignment of assignments) {
    const assignmentId = assignment.assignment_id || assignment._id;
    const status = normalizedAssignmentStatus(assignment.status);
    if (status === "cancelled") {
      skipped.push({ assignment_id: assignmentId, reason: "already_cancelled" });
      continue;
    }
    if (!isOpenAssignmentStatus(assignment.status)) {
      skipped.push({ assignment_id: assignmentId, reason: "completed" });
      continue;
    }
    const update = {
      status: "cancelled",
      previous_status: assignment.status || "to_do",
      cancelled_at: assignment.cancelled_at || now,
      cancelled_by_teacher_uid: teacher.auth_uid,
      updated_at: now,
    };
    if (reason) update.cancel_reason = reason;
    await db.collection("assignments").doc(assignment._id).update(update);
    cancelled.push({
      assignment_id: assignmentId,
      student_uid: assignment.student_uid,
      set_id: assignment.set_id,
    });
  }

  return { success: true, cancelled, skipped, missing };
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
  const [assignmentRows, studentRows, setRows] = await Promise.all([
    getAll("assignments"),
    getAll("students"),
    getAll("sets"),
  ]);
  const studentMap = new Map(visibleStudentRecords(studentRows).map((record) => {
    const student = record.data && typeof record.data === "object" ? record.data : record;
    return [student.auth_uid, student];
  }));
  const rawAssignments = assignmentRows.filter((assignment) =>
    normalizedAssignmentStatus(assignment.status) !== "cancelled"
    && studentMap.has(recordData(assignment).student_uid)
  );
  const setMap = new Map(setRows.map((set) => [set.set_id, set]));

  return {
    success: true,
    assignments: rawAssignments.map((record) => {
      const assignment = recordData(record);
      const student = studentMap.get(assignment.student_uid) || {};
      const set = setMap.get(assignment.set_id) || {};
      const dueAt = effectiveAssignmentDueAt(assignment);
      return {
        assignment_id: assignment.assignment_id || assignment._id,
        assignment_batch_id: assignment.assignment_batch_id || null,
        student_uid: assignment.student_uid,
        student_id: student.student_id || assignment.student_uid,
        student_name: student.name || "",
        class_group: student.class_group || "",
        set_id: assignment.set_id,
        set_title: set.title || assignment.set_id,
        status: assignment.status || "to_do",
        attempt_count: Number(assignment.attempt_count || 0),
        latest_attempt_id: assignment.latest_attempt_id || null,
        latest_percentage: assignment.latest_percentage == null ? null : assignment.latest_percentage,
        best_percentage: assignment.best_percentage == null ? null : assignment.best_percentage,
        assigned_at: assignment.assigned_at || null,
        due_at: dueAt,
        created_at: assignment.created_at || null,
        passing_percentage: assignment.passing_percentage == null ? null : assignment.passing_percentage,
        mastery_percentage: assignment.mastery_percentage == null ? null : assignment.mastery_percentage,
        mastery_enabled: assignmentMasteryEnabled(assignment),
        answer_revealed: assignment.answer_revealed === true,
        answer_revealed_at: assignment.answer_revealed_at || null,
        mastery_locked: assignment.mastery_locked === true,
        completed_at: assignment.completed_at || null,
        cancelled_at: assignment.cancelled_at || null,
        cancelled_by_teacher_uid: assignment.cancelled_by_teacher_uid || null,
        cancel_reason: assignment.cancel_reason || "",
        previous_status: assignment.previous_status || null,
        updated_at: assignment.updated_at || null,
      };
    }).sort((a, b) => new Date(b.due_at || 0) - new Date(a.due_at || 0)),
  };
}

function attemptView(record, gradingKey) {
  const attempt = recordData(record);
  const gradingAnswers = gradingKey && gradingKey.answers && typeof gradingKey.answers === "object"
    ? gradingKey.answers
    : {};
  const questionResults = effectiveQuestionResults(attempt).map((item) => {
    const questionId = item.question_id || item.id || "";
    let correctAnswer = item.correct_answer;
    if (questionId && Object.prototype.hasOwnProperty.call(gradingAnswers, questionId)) {
      correctAnswer = gradingAnswers[questionId];
    }
    return {
      question_id: questionId,
      submitted_answer: item.submitted_answer == null ? "" : item.submitted_answer,
      correct: item.correct === true,
      correct_answer: correctAnswer == null ? null : correctAnswer,
    };
  });
  return {
    attempt_id: attempt.attempt_id || attempt._id,
    student_uid: attempt.student_uid,
    student_id: attempt.student_id_snapshot || "",
    set_id: attempt.set_id,
    assignment_id: attempt.assignment_id || null,
    mode: attempt.mode || "",
    attempt_number: Number(attempt.attempt_number || 0),
    correct_count: Number(
      attempt.adjusted_correct_count == null ? attempt.correct_count || 0 : attempt.adjusted_correct_count
    ),
    question_count: Number(attempt.question_count || 0),
    percentage: effectivePercentage(attempt),
    passing_percentage: Number(attempt.passing_percentage || 50),
    mastery_percentage: Number(attempt.mastery_percentage || 90),
    mastery_enabled: attempt.mastery_enabled !== false,
    passed: effectivePassed(attempt),
    mastered: attempt.adjusted_mastered == null ? attempt.mastered === true : attempt.adjusted_mastered === true,
    selected_group_count: attempt.selected_group_count || null,
    submitted_at: attempt.submitted_at || null,
    practice_context: attempt.practice_context || "",
    duration_seconds: attempt.duration_seconds == null ? null : Number(attempt.duration_seconds),
    audio_started_at: attempt.audio_started_at || null,
    audio_to_submit_seconds: attempt.audio_to_submit_seconds == null ? null : Number(attempt.audio_to_submit_seconds),
    question_results: questionResults,
  };
}

function countsTowardTeacherProgress(attempt) {
  return !attempt || attempt.mode !== "vocabulary_practice_timed";
}

function sortAttemptsAscending(attempts) {
  return attempts.slice().sort((a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0));
}

function latestDateValue(items, field) {
  return items.reduce((latest, item) => {
    const date = safeDate(item[field]);
    if (!date) return latest;
    if (!latest || date > latest) return date;
    return latest;
  }, null);
}

function bestAttemptPercentage(attempts) {
  if (!attempts.length) return null;
  return attempts.reduce((best, attempt) => {
    const percentage = Number(attempt.percentage || 0);
    return best == null || percentage > best ? percentage : best;
  }, null);
}

function latestAttempt(attempts) {
  return sortAttemptsAscending(attempts).slice(-1)[0] || null;
}

function progressStatusFromAssignment(assignment, set, bestPercentage) {
  const passing = passingPercentageForAssignment(assignment, set);
  const mastery = masteryPercentageForAssignment(assignment, set);
  const attemptStatus = bestPercentage == null
    ? "to_do"
    : statusForPercentage(bestPercentage, passing, mastery, assignment);
  return monotonicAssignmentStatus(assignment.status, attemptStatus);
}

function buildProgressItemFromAssignment(assignment, student, set, attempts) {
  const orderedAttempts = sortAttemptsAscending(attempts);
  const newestAttempt = latestAttempt(orderedAttempts);
  const attemptBestPercentage = bestAttemptPercentage(orderedAttempts);
  const savedBestPercentage = assignment.best_percentage == null ? null : Number(assignment.best_percentage);
  const bestPercentage = savedBestPercentage == null
    ? attemptBestPercentage
    : attemptBestPercentage == null
      ? savedBestPercentage
      : Math.max(savedBestPercentage, attemptBestPercentage);
  const status = progressStatusFromAssignment(assignment, set, bestPercentage);
  const finishedAttempts = orderedAttempts.filter((attempt) =>
    attempt.mastered === true || attempt.passed === true || normalizedAssignmentStatus(status) !== "to_do"
  );
  const completedAt = assignment.completed_at
    || (normalizedAssignmentStatus(status) !== "to_do" ? latestDateValue(finishedAttempts, "submitted_at") : null);
  return {
    progress_id: `assigned::${assignment.assignment_id || assignment._id}`,
    source: "assigned",
    assignment_id: assignment.assignment_id || assignment._id,
    assignment_batch_id: assignment.assignment_batch_id || null,
    student_uid: assignment.student_uid,
    student_id: student.student_id || assignment.student_uid,
    student_name: student.name || "",
    class_group: student.class_group || "",
    set_id: assignment.set_id,
    set_title: set.title || assignment.set_id,
    status,
    attempt_count: Math.max(Number(assignment.attempt_count || 0), orderedAttempts.length),
    latest_attempt_id: assignment.latest_attempt_id || (newestAttempt && newestAttempt.attempt_id) || null,
    latest_percentage: assignment.latest_percentage == null
      ? (newestAttempt ? newestAttempt.percentage : null)
      : assignment.latest_percentage,
    best_percentage: bestPercentage,
    assigned_at: assignment.assigned_at || null,
    due_at: effectiveAssignmentDueAt(assignment),
    created_at: assignment.created_at || null,
    passing_percentage: passingPercentageForAssignment(assignment, set),
    mastery_percentage: masteryPercentageForAssignment(assignment, set),
    mastery_enabled: assignmentMasteryEnabled(assignment),
    answer_revealed: assignment.answer_revealed === true,
    answer_revealed_at: assignment.answer_revealed_at || null,
    mastery_locked: assignment.mastery_locked === true,
    completed_at: completedAt || null,
    cancelled_at: assignment.cancelled_at || null,
    cancelled_by_teacher_uid: assignment.cancelled_by_teacher_uid || null,
    cancel_reason: assignment.cancel_reason || "",
    previous_status: assignment.previous_status || null,
    updated_at: assignment.updated_at || null,
    latest_submitted_at: latestDateValue(orderedAttempts, "submitted_at"),
    attempts: orderedAttempts,
  };
}

function buildSelfStudyProgressItem(studentUid, setId, attempts, student, set) {
  const orderedAttempts = sortAttemptsAscending(attempts);
  const completedAttempts = orderedAttempts.filter((attempt) => attempt.passed || attempt.mastered);
  if (!completedAttempts.length) return null;
  const bestPercentage = bestAttemptPercentage(orderedAttempts);
  const latestSubmitted = latestDateValue(orderedAttempts, "submitted_at");
  const completedAt = latestDateValue(completedAttempts, "submitted_at");
  const mastered = orderedAttempts.some((attempt) => attempt.mastered);
  return {
    progress_id: `self_study::${studentUid}::${setId}`,
    source: "self_study",
    assignment_id: null,
    student_uid: studentUid,
    student_id: student.student_id || "",
    student_name: student.name || "",
    set_id: setId,
    set_title: set.title || setId,
    status: mastered ? "mastered" : "passed",
    attempt_count: orderedAttempts.length,
    latest_attempt_id: orderedAttempts.length ? orderedAttempts[orderedAttempts.length - 1].attempt_id : null,
    latest_percentage: orderedAttempts.length ? orderedAttempts[orderedAttempts.length - 1].percentage : null,
    best_percentage: bestPercentage,
    assigned_at: null,
    due_at: null,
    completed_at: completedAt,
    updated_at: latestSubmitted,
    latest_submitted_at: latestSubmitted,
    attempts: orderedAttempts,
  };
}

async function listProgress() {
  const [assignmentRows, attemptRows, studentRows, setRows, gradingKeyRows] = await Promise.all([
    getAll("assignments"),
    getAll("attempts"),
    getAll("students"),
    getAll("sets"),
    getAll("grading_keys"),
  ]);
  const studentMap = new Map(visibleStudentRecords(studentRows).map((student) => [student.auth_uid, student]));
  const assignments = assignmentRows.map(recordData).filter((assignment) =>
    normalizedAssignmentStatus(assignment.status) !== "cancelled"
    && studentMap.has(assignment.student_uid)
  );
  const gradingKeyMap = new Map(gradingKeyRows.map((record) => {
    const gradingKey = recordData(record);
    return [gradingKey.set_id, gradingKey];
  }));
  const attempts = attemptRows.map((record) => {
    const attempt = recordData(record);
    return attemptView(attempt, gradingKeyMap.get(attempt.set_id));
  });
  const progressAttempts = attempts.filter(countsTowardTeacherProgress);
  const setMap = new Map(setRows.map((record) => {
    const set = recordData(record);
    return [set.set_id, set];
  }));
  const attemptsByAssignment = new Map();
  const attemptsById = new Map();
  const selfStudyGroups = new Map();

  progressAttempts.forEach((attempt) => {
    if (attempt.attempt_id) attemptsById.set(attempt.attempt_id, attempt);
    if (attempt.assignment_id) {
      if (!attemptsByAssignment.has(attempt.assignment_id)) attemptsByAssignment.set(attempt.assignment_id, []);
      attemptsByAssignment.get(attempt.assignment_id).push(attempt);
      return;
    }
    if (!attempt.student_uid || !attempt.set_id || !studentMap.has(attempt.student_uid)) return;
    const key = `${attempt.student_uid}::${attempt.set_id}`;
    if (!selfStudyGroups.has(key)) selfStudyGroups.set(key, []);
    selfStudyGroups.get(key).push(attempt);
  });

  const progress = assignments.map((assignment) => {
    const assignmentId = assignment.assignment_id || assignment._id;
    const linkedAttempts = (attemptsByAssignment.get(assignmentId) || []).slice();
    if (assignment.latest_attempt_id && attemptsById.has(assignment.latest_attempt_id)) {
      const latestAttempt = attemptsById.get(assignment.latest_attempt_id);
      if (!linkedAttempts.some((attempt) => attempt.attempt_id === latestAttempt.attempt_id)) {
        linkedAttempts.push(latestAttempt);
      }
    }
    return buildProgressItemFromAssignment(
      assignment,
      studentMap.get(assignment.student_uid) || {},
      setMap.get(assignment.set_id) || {},
      linkedAttempts
    );
  });

  selfStudyGroups.forEach((groupAttempts, key) => {
    const [studentUid, setId] = key.split("::");
    const item = buildSelfStudyProgressItem(
      studentUid,
      setId,
      groupAttempts,
      studentMap.get(studentUid) || {},
      setMap.get(setId) || {}
    );
    if (item) progress.push(item);
  });

  return {
    success: true,
    progress: progress.sort((a, b) => {
      const dateA = a.completed_at || a.latest_submitted_at || a.updated_at || a.due_at || a.assigned_at || 0;
      const dateB = b.completed_at || b.latest_submitted_at || b.updated_at || b.due_at || b.assigned_at || 0;
      return new Date(dateB || 0) - new Date(dateA || 0);
    }),
  };
}

async function listAttempts() {
  const [attemptRows, gradingKeyRows, studentRows] = await Promise.all([
    getAll("attempts"),
    getAll("grading_keys"),
    getAll("students"),
  ]);
  const visibleStudentUids = new Set(visibleStudentRecords(studentRows).map((student) => student.auth_uid));
  const gradingKeyMap = new Map(gradingKeyRows.map((record) => {
    const gradingKey = recordData(record);
    return [gradingKey.set_id, gradingKey];
  }));
  const attempts = attemptRows.filter((record) => visibleStudentUids.has(recordData(record).student_uid));
  return {
    success: true,
    attempts: attempts.map((record) => {
      const attempt = recordData(record);
      return attemptView(attempt, gradingKeyMap.get(attempt.set_id));
    }).sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0)),
  };
}

async function getActivityState(teacher) {
  return {
    success: true,
    attempts_seen_at: teacher.teacher_activity_attempts_seen_at || null,
    read_all_at: teacher.teacher_activity_attempts_read_all_at || null,
    reviewed_attempt_ids: Array.isArray(teacher.teacher_activity_attempt_reviewed_ids)
      ? teacher.teacher_activity_attempt_reviewed_ids.map(text).filter(Boolean)
      : [],
  };
}

async function markActivityAttemptsReadAll(teacher) {
  const now = new Date();
  if (!teacher._id) throw new Error("TEACHER_PROFILE_ID_MISSING");
  await db.collection("students").doc(teacher._id).update({
    teacher_activity_attempts_read_all_at: now,
    teacher_activity_attempt_reviewed_ids: [],
    teacher_activity_attempt_reviewed_at: now,
    updated_at: now,
  });
  return {
    success: true,
    read_all_at: now,
    reviewed_attempt_ids: [],
  };
}

async function markAttemptsRead(teacher) {
  const now = new Date();
  if (!teacher._id) throw new Error("TEACHER_PROFILE_ID_MISSING");
  await db.collection("students").doc(teacher._id).update({
    teacher_activity_attempts_seen_at: now,
    updated_at: now,
  });
  return {
    success: true,
    attempts_seen_at: now,
  };
}

async function markActivityAttemptsReviewed(event, teacher) {
  if (!teacher._id) throw new Error("TEACHER_PROFILE_ID_MISSING");
  const incomingIds = Array.isArray(event.attempt_ids)
    ? event.attempt_ids.map(text).filter(Boolean).slice(0, 100)
    : [];
  const currentIds = Array.isArray(teacher.teacher_activity_attempt_reviewed_ids)
    ? teacher.teacher_activity_attempt_reviewed_ids.map(text).filter(Boolean)
    : [];
  const merged = [...new Set([...currentIds, ...incomingIds])].slice(-3000);
  const now = new Date();
  await db.collection("students").doc(teacher._id).update({
    teacher_activity_attempt_reviewed_ids: merged,
    teacher_activity_attempt_reviewed_at: now,
    updated_at: now,
  });
  return {
    success: true,
    reviewed_attempt_ids: merged,
  };
}

async function submitTeacherDispute(event, teacher) {
  const setId = text(event.set_id);
  const questionId = text(event.question_id);
  const submittedAnswer = text(event.submitted_answer).slice(0, 1000);
  const reason = text(event.reason).slice(0, 1000);
  const questionText = text(event.question_text).slice(0, 2000);
  if (!setId || !questionId) throw new Error("DISPUTE_FIELDS_REQUIRED");

  const [set, gradingKey] = await Promise.all([
    getOne("sets", { set_id: setId }),
    getOne("grading_keys", { set_id: setId }),
  ]);
  if (!set) throw new Error("SET_NOT_FOUND");
  if (!gradingKey) throw new Error("GRADING_KEY_NOT_FOUND");

  const disputeId = [
    "teacher",
    teacher.auth_uid,
    setId,
    questionId,
    Date.now(),
  ].join("::");
  const answers = gradingKey.answers || {};
  const explanations = gradingKey.explanations || {};
  const now = new Date();
  await db.collection("answer_disputes").add({
    dispute_id: disputeId,
    requester_role: "teacher",
    student_uid: teacher.auth_uid,
    student_id_snapshot: teacher.student_id,
    student_name_snapshot: teacher.name || teacher.student_id,
    set_id: setId,
    attempt_id: null,
    assignment_id: null,
    question_id: questionId,
    question_text_snapshot: questionText,
    submitted_answer: submittedAnswer,
    answer_snapshot: answers[questionId] == null ? null : answers[questionId],
    explanation_snapshot: explanations[questionId] || "",
    student_reason: reason,
    status: "pending",
    created_at: now,
    updated_at: now,
  });
  return { success: true, dispute_id: disputeId };
}

async function listDisputes() {
  const [disputeRows, studentRows, setRows, gradingKeyRows, assignmentRows] = await Promise.all([
    getAll("answer_disputes"),
    getAll("students"),
    getAll("sets"),
    getAll("grading_keys"),
    getAll("assignments"),
  ]);
  const studentMap = new Map(visibleStudentRecords(studentRows).map((item) => [item.auth_uid, item]));
  const setMap = new Map(setRows.map((item) => [item.set_id, item]));
  const gradingKeysMap = new Map(gradingKeyRows.map((item) => [item.set_id, item]));
  const assignmentMap = new Map(assignmentRows.map((item) => [item.assignment_id || item._id, item]));
  return {
    success: true,
    disputes: disputeRows.filter((dispute) => {
      if (dispute.requester_role !== "teacher" && !studentMap.has(dispute.student_uid)) return false;
      if (!dispute.assignment_id) return true;
      const assignment = assignmentMap.get(dispute.assignment_id);
      return !assignment || normalizedAssignmentStatus(assignment.status) !== "cancelled";
    }).map((dispute) => {
      const student = studentMap.get(dispute.student_uid) || {};
      const set = setMap.get(dispute.set_id) || {};
      const gradingKey = gradingKeysMap.get(dispute.set_id) || {};
      const explanations = gradingKey.explanations || {};
      return {
        dispute_id: dispute.dispute_id || dispute._id,
        requester_role: dispute.requester_role || "student",
        student_uid: dispute.student_uid,
        student_id: student.student_id || dispute.student_id_snapshot || "",
        student_name: student.name || dispute.student_name_snapshot || "",
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
        auto_regrade_scanned_attempt_count: Number(dispute.auto_regrade_scanned_attempt_count || 0),
        auto_regrade_adjusted_attempt_count: Number(dispute.auto_regrade_adjusted_attempt_count || 0),
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

function buildAttemptAdjustmentUpdate(attempt, currentResults, teacher, now, gradingVersion, options = {}) {
  const correctCount = currentResults.filter((item) => item.correct === true).length;
  const questionCount = Number(attempt.question_count || currentResults.length);
  const recalculated = questionCount
    ? Math.round(correctCount / questionCount * 10000) / 100
    : 0;
  const percentage = Math.max(effectivePercentage(attempt), recalculated);
  const passingPercentage = Number(attempt.passing_percentage || 50);
  const masteryPercentage = Number(attempt.mastery_percentage || 90);
  const masteryEnabled = attempt.mastery_enabled !== false;
  const passed = effectivePassed(attempt) || percentage >= passingPercentage;
  const mastered = attempt.adjusted_mastered == null
    ? (attempt.mastered === true || (masteryEnabled && percentage >= masteryPercentage))
    : (attempt.adjusted_mastered === true || (masteryEnabled && percentage >= masteryPercentage));
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
    adjusted_mastered: mastered,
    adjusted_by_teacher_uid: teacher.auth_uid,
    adjusted_grading_version: gradingVersion,
    adjusted_by_grading_history_id: options.gradingHistoryId || attempt.adjusted_by_grading_history_id || null,
    bulk_regrade_source: options.source || "grading_rule_change",
    adjusted_at: now,
  };
  if (options.disputeId) update.adjusted_by_dispute_id = options.disputeId;
  return { update, correctCount, questionCount, percentage, passed, mastered };
}

async function applyAdjustedAttemptEffects(attempt, adjustedAttempt, correctCount, questionCount, percentage, passed, mastered, now) {
  if (attempt.assignment_id) {
    const assignment = await getOne("assignments", {
      assignment_id: attempt.assignment_id,
      student_uid: attempt.student_uid,
    });
    if (assignment) {
      if (normalizedAssignmentStatus(assignment.status) === "cancelled") return;
      const set = await getOne("sets", { set_id: attempt.set_id });
      const effectivePassingPercentage = Number(assignment.passing_percentage != null
        ? assignment.passing_percentage
        : passingPercentageForSet(set));
      const effectiveMasteryPercentage = Number(assignment.mastery_percentage != null
        ? assignment.mastery_percentage
        : masteryPercentageForSet(set));
      const attemptStatus = statusForPercentage(
        percentage,
        effectivePassingPercentage,
        effectiveMasteryPercentage,
        assignment
      );
      const adjustedStatus = monotonicAssignmentStatus(assignment.status, attemptStatus);
      const currentBest = Number(assignment.best_percentage || 0);
      const improvesBest = percentage >= currentBest;
      const assignmentUpdate = {
        best_percentage: Math.max(currentBest, percentage),
        raw_best_percentage: Math.max(Number(assignment.raw_best_percentage || 0), percentage),
        updated_at: now,
      };
      if (improvesBest) {
        assignmentUpdate.best_attempt_id = attempt.attempt_id;
        assignmentUpdate.best_correct_count = correctCount;
        assignmentUpdate.best_question_count = questionCount;
      }
      if (assignment.latest_attempt_id === attempt.attempt_id) {
        assignmentUpdate.latest_percentage = percentage;
        assignmentUpdate.latest_raw_percentage = percentage;
      }
      if (attemptStatus === "passed" || attemptStatus === "mastered") {
        assignmentUpdate.status = adjustedStatus;
        if (!assignment.completed_at) assignmentUpdate.completed_at = now;
        if (adjustedStatus === "mastered" && !assignment.mastered_at) assignmentUpdate.mastered_at = now;
      }
      await db.collection("assignments").doc(assignment._id).update(assignmentUpdate);
      if (attemptStatus === "mastered") {
        const student = await getOne("students", {
          auth_uid: attempt.student_uid,
          role: "student",
        });
        await protectAssignmentStar(
          student,
          { ...assignment, ...assignmentUpdate },
          adjustedAttempt,
          now
        );
      }
    }
  } else if (mastered) {
    const student = await getOne("students", {
      auth_uid: attempt.student_uid,
      role: "student",
    });
    await protectSelfStudyStar(student, adjustedAttempt, now);
  }
}

async function improveDisputedAttempt(dispute, teacher, now, gradingVersion) {
  const attempt = await getOne("attempts", {
    attempt_id: dispute.attempt_id,
    student_uid: dispute.student_uid,
  });
  if (!attempt) throw new Error("ATTEMPT_NOT_FOUND");
  return await improveAttemptForAcceptedAnswer(attempt, dispute, teacher, now, gradingVersion, {
    source: "dispute",
    gradingHistoryId: dispute.grading_history_id || null,
  });
}

async function improveAttemptForAcceptedAnswer(attempt, dispute, teacher, now, gradingVersion, options = {}) {
  const currentResults = effectiveQuestionResults(attempt).map((item) => ({ ...item }));
  const target = currentResults.find((item) => String(item.question_id) === dispute.question_id);
  if (!target) return null;
  if (target.correct === true) return attempt;
  if (normalized(target.submitted_answer) !== normalized(dispute.submitted_answer)) return null;

  target.correct = true;
  target.correct_answer = dispute.submitted_answer;
  target.dispute_adjusted = true;
  target.dispute_id = dispute.dispute_id || dispute._id;
  target.bulk_regrade_source = options.source || "grading_rule_change";
  target.grading_history_id = options.gradingHistoryId || null;
  const adjustment = buildAttemptAdjustmentUpdate(attempt, currentResults, teacher, now, gradingVersion, {
    disputeId: dispute.dispute_id || dispute._id,
    gradingHistoryId: options.gradingHistoryId || null,
    source: options.source || "grading_rule_change",
  });
  const { update, correctCount, questionCount, percentage, passed, mastered } = adjustment;
  await db.collection("attempts").doc(attempt._id).update(update);
  const adjustedAttempt = { ...attempt, ...update };
  await applyAdjustedAttemptEffects(
    attempt,
    adjustedAttempt,
    correctCount,
    questionCount,
    percentage,
    passed,
    mastered,
    now
  );

  return adjustedAttempt;
}

async function applyAcceptedAnswerToHistoricalAttempts(dispute, teacher, now, gradingVersion, gradingHistoryId) {
  const attempts = await getAll("attempts", {
    where: { set_id: dispute.set_id },
  });
  let adjusted = 0;
  for (const attempt of attempts) {
    const result = await improveAttemptForAcceptedAnswer(
      attempt,
      dispute,
      teacher,
      now,
      gradingVersion,
      {
        source: dispute.requester_role === "teacher" ? "teacher_rule_change" : "student_argue_rule_change",
        gradingHistoryId,
      }
    );
    if (result && result !== attempt) adjusted += 1;
  }
  return {
    scanned_attempt_count: attempts.length,
    adjusted_attempt_count: adjusted,
  };
}

async function improveAttemptForCurrentGradingKey(attempt, gradingKey, teacher, now, options = {}) {
  const answers = gradingKey && gradingKey.answers && typeof gradingKey.answers === "object"
    ? gradingKey.answers
    : null;
  if (!answers) return { matched: false, adjusted: false, adjusted_question_count: 0 };

  const currentResults = effectiveQuestionResults(attempt).map((item) => ({ ...item }));
  let adjustedQuestionCount = 0;
  for (const item of currentResults) {
    const questionId = String(item.question_id || item.id || "");
    if (!questionId || item.correct === true) continue;
    if (!Object.prototype.hasOwnProperty.call(answers, questionId)) continue;
    const acceptedAnswer = matchingAcceptedAnswer(item.submitted_answer, answers[questionId]);
    if (acceptedAnswer == null) continue;
    item.correct = true;
    item.correct_answer = acceptedAnswer;
    item.backfill_adjusted = true;
    item.bulk_regrade_source = "grading_key_backfill";
    item.grading_version = gradingKey.grading_version || null;
    adjustedQuestionCount += 1;
  }

  if (!adjustedQuestionCount) {
    return { matched: false, adjusted: false, adjusted_question_count: 0 };
  }

  const adjustment = buildAttemptAdjustmentUpdate(
    attempt,
    currentResults,
    teacher,
    now,
    gradingKey.grading_version || attempt.grading_version || null,
    { source: "grading_key_backfill" }
  );
  const { update, correctCount, questionCount, percentage, passed, mastered } = adjustment;
  if (options.dryRun) {
    return {
      matched: true,
      adjusted: false,
      adjusted_question_count: adjustedQuestionCount,
      adjusted_percentage: percentage,
    };
  }

  await db.collection("attempts").doc(attempt._id).update(update);
  const adjustedAttempt = { ...attempt, ...update };
  await applyAdjustedAttemptEffects(
    attempt,
    adjustedAttempt,
    correctCount,
    questionCount,
    percentage,
    passed,
    mastered,
    now
  );
  return {
    matched: true,
    adjusted: true,
    adjusted_question_count: adjustedQuestionCount,
    adjusted_percentage: percentage,
  };
}

async function backfillAcceptedAnswerRegrades(event, teacher) {
  const apply = event.apply === true || ["1", "true", "yes"].includes(text(event.apply).toLowerCase());
  const cursor = Math.max(Number.parseInt(text(event.cursor) || "0", 10) || 0, 0);
  const requestedLimit = Number.parseInt(text(event.limit) || "100", 10) || 100;
  const limit = Math.min(Math.max(requestedLimit, 1), 200);
  const setId = text(event.set_id);
  const now = new Date();
  const [attempts, gradingKeys] = await Promise.all([
    getPage("attempts", {
      where: setId ? { set_id: setId } : null,
      orderBy: { field: "submitted_at", direction: "asc" },
      offset: cursor,
      limit,
    }),
    getAll("grading_keys"),
  ]);
  const gradingKeyMap = new Map(gradingKeys.map((item) => [item.set_id, item]));
  let scannedQuestionCount = 0;
  let missingGradingKeyAttemptCount = 0;
  let matchingAttemptCount = 0;
  let matchingQuestionCount = 0;
  const sampleAdjustedAttemptIds = [];

  for (const attempt of attempts) {
    scannedQuestionCount += effectiveQuestionResults(attempt).length;
    const gradingKey = gradingKeyMap.get(attempt.set_id);
    if (!gradingKey) {
      missingGradingKeyAttemptCount += 1;
      continue;
    }
    const result = await improveAttemptForCurrentGradingKey(attempt, gradingKey, teacher, now, {
      dryRun: !apply,
    });
    if (!result.matched) continue;
    matchingAttemptCount += 1;
    matchingQuestionCount += result.adjusted_question_count;
    if (sampleAdjustedAttemptIds.length < 20) {
      sampleAdjustedAttemptIds.push(attempt.attempt_id || attempt._id);
    }
  }

  const nextCursor = attempts.length === limit ? cursor + attempts.length : null;
  return {
    success: true,
    action: "backfillAcceptedAnswerRegrades",
    dry_run: !apply,
    apply,
    set_id: setId || null,
    cursor,
    limit,
    next_cursor: nextCursor,
    done: nextCursor == null,
    scanned_attempt_count: attempts.length,
    scanned_question_count: scannedQuestionCount,
    missing_grading_key_attempt_count: missingGradingKeyAttemptCount,
    matching_attempt_count: matchingAttemptCount,
    matching_question_count: matchingQuestionCount,
    adjusted_attempt_count: apply ? matchingAttemptCount : 0,
    adjusted_question_count: apply ? matchingQuestionCount : 0,
    sample_adjusted_attempt_ids: sampleAdjustedAttemptIds,
  };
}

function legacyVocabularyAnswerMap(attempts, legacyVersion) {
  const votes = new Map();
  attempts
    .filter((attempt) => String(attempt.grading_version || "1") === legacyVersion)
    .forEach((attempt) => {
      (attempt.question_results || []).forEach((item) => {
        const questionId = String(item.question_id || "");
        const answer = item.correct_answer;
        if (!questionId || answer == null || Array.isArray(answer)) return;
        const normalizedAnswer = normalized(answer);
        if (!normalizedAnswer) return;
        if (!votes.has(questionId)) votes.set(questionId, new Map());
        const questionVotes = votes.get(questionId);
        const current = questionVotes.get(normalizedAnswer) || { answer, count: 0 };
        current.count += 1;
        questionVotes.set(normalizedAnswer, current);
      });
    });

  const answers = new Map();
  for (const [questionId, questionVotes] of votes.entries()) {
    const ranked = [...questionVotes.values()].sort((left, right) => right.count - left.count);
    if (ranked.length) answers.set(questionId, ranked[0].answer);
  }
  return answers;
}

function vocabularyVersionMismatchAdjustment(attempt, legacyAnswers, currentVersion, minimumMatches, legacyVersion) {
  if (String(attempt.grading_version || "1") !== currentVersion) return null;
  const currentResults = effectiveQuestionResults(attempt).map((item) => ({ ...item }));
  let signatureMatchCount = 0;
  const adjustable = [];

  currentResults.forEach((item) => {
    if (item.correct === true) return;
    const questionId = String(item.question_id || "");
    const legacyAnswer = legacyAnswers.get(questionId);
    if (legacyAnswer == null) return;
    if (normalized(item.submitted_answer) !== normalized(legacyAnswer)) return;
    if (normalized(item.correct_answer) === normalized(legacyAnswer)) return;
    signatureMatchCount += 1;
    adjustable.push({ item, legacyAnswer });
  });

  if (signatureMatchCount < minimumMatches) return null;
  adjustable.forEach(({ item, legacyAnswer }) => {
    item.correct = true;
    item.correct_answer = legacyAnswer;
    item.backfill_adjusted = true;
    item.bulk_regrade_source = "vocabulary_content_version_mismatch";
    item.legacy_grading_version = legacyVersion;
  });
  return { currentResults, signatureMatchCount, adjustedQuestionCount: adjustable.length };
}

async function backfillVocabularyContentVersionMismatch(event, teacher) {
  const apply = event.apply === true || ["1", "true", "yes"].includes(text(event.apply).toLowerCase());
  const setId = text(event.set_id);
  const legacyVersion = text(event.legacy_grading_version) || "1";
  const currentVersion = text(event.current_grading_version) || "2";
  const minimumMatches = Math.min(Math.max(Number.parseInt(text(event.minimum_matches) || "3", 10) || 3, 2), 20);
  if (!setId) throw new Error("SET_REQUIRED");
  if (legacyVersion === currentVersion) throw new Error("GRADING_VERSION_RANGE_REQUIRED");

  const attempts = await getAll("attempts", { where: { set_id: setId } });
  const legacyAnswers = legacyVocabularyAnswerMap(attempts, legacyVersion);
  if (!legacyAnswers.size) throw new Error("LEGACY_GRADING_SNAPSHOT_NOT_FOUND");

  const now = new Date();
  let matchingAttemptCount = 0;
  let matchingQuestionCount = 0;
  const candidates = [];
  for (const attempt of attempts) {
    const candidate = vocabularyVersionMismatchAdjustment(
      attempt,
      legacyAnswers,
      currentVersion,
      minimumMatches,
      legacyVersion
    );
    if (!candidate) continue;
    matchingAttemptCount += 1;
    matchingQuestionCount += candidate.adjustedQuestionCount;
    const adjustment = buildAttemptAdjustmentUpdate(
      attempt,
      candidate.currentResults,
      teacher,
      now,
      legacyVersion,
      { source: "vocabulary_content_version_mismatch" }
    );
    candidates.push({
      attempt_id: attempt.attempt_id || attempt._id,
      signature_match_count: candidate.signatureMatchCount,
      adjusted_question_count: candidate.adjustedQuestionCount,
      original_percentage: Number(attempt.adjusted_percentage == null ? attempt.percentage || 0 : attempt.adjusted_percentage),
      adjusted_percentage: adjustment.percentage,
    });
    if (!apply) continue;

    await db.collection("attempts").doc(attempt._id).update(adjustment.update);
    const adjustedAttempt = { ...attempt, ...adjustment.update };
    await applyAdjustedAttemptEffects(
      attempt,
      adjustedAttempt,
      adjustment.correctCount,
      adjustment.questionCount,
      adjustment.percentage,
      adjustment.passed,
      adjustment.mastered,
      now
    );
  }

  return {
    success: true,
    action: "backfillVocabularyContentVersionMismatch",
    dry_run: !apply,
    apply,
    set_id: setId,
    legacy_grading_version: legacyVersion,
    current_grading_version: currentVersion,
    minimum_signature_matches: minimumMatches,
    legacy_question_count: legacyAnswers.size,
    scanned_attempt_count: attempts.length,
    matching_attempt_count: matchingAttemptCount,
    matching_question_count: matchingQuestionCount,
    adjusted_attempt_count: apply ? matchingAttemptCount : 0,
    adjusted_question_count: apply ? matchingQuestionCount : 0,
    candidates,
  };
}

async function backfillAssignmentDueWeeks(event, teacher) {
  const apply = event.apply === true;
  const limit = Math.min(Math.max(Number(event.limit || 100), 1), 500);
  const cursor = text(event.cursor);
  const rows = (await getAll("assignments"))
    .map(recordData)
    .sort((left, right) => text(left.assignment_id || left._id).localeCompare(text(right.assignment_id || right._id)));
  const missingSource = rows.filter((assignment) =>
    !effectiveAssignmentDueAt(assignment)
  ).length;
  const pending = rows.filter((assignment) => {
    const assignmentId = text(assignment.assignment_id || assignment._id);
    if (cursor && assignmentId <= cursor) return false;
    const source = assignment.due_at || assignment.assigned_at || assignment.created_at;
    const normalizedDueAt = dueWeekEnd(source);
    if (!normalizedDueAt) return false;
    const currentDueAt = safeDate(assignment.due_at);
    return !currentDueAt || currentDueAt.getTime() !== normalizedDueAt.getTime();
  });
  const batch = pending.slice(0, limit);
  const now = new Date();
  const candidates = [];
  for (const assignment of batch) {
    const assignmentId = text(assignment.assignment_id || assignment._id);
    const sourceField = assignment.due_at
      ? "due_at"
      : assignment.assigned_at
        ? "assigned_at"
        : "created_at";
    const normalizedDueAt = dueWeekEnd(assignment[sourceField]);
    candidates.push({
      assignment_id: assignmentId,
      student_uid: assignment.student_uid || null,
      set_id: assignment.set_id || null,
      source_field: sourceField,
      previous_due_at: assignment.due_at || null,
      normalized_due_at: normalizedDueAt,
    });
    if (!apply) continue;
    await db.collection("assignments").doc(assignment._id).update({
      due_at: normalizedDueAt,
      due_week_migrated_at: now,
      due_week_migrated_by_teacher_uid: teacher.auth_uid,
      updated_at: now,
    });
  }
  const nextCursor = pending.length > batch.length && batch.length
    ? text(batch[batch.length - 1].assignment_id || batch[batch.length - 1]._id)
    : null;
  return {
    success: true,
    action: "backfillAssignmentDueWeeks",
    dry_run: !apply,
    apply,
    scanned_assignment_count: rows.length,
    candidate_count: batch.length,
    updated_count: apply ? batch.length : 0,
    missing_source_count: missingSource,
    cursor: cursor || null,
    next_cursor: nextCursor,
    done: nextCursor == null,
    candidates,
  };
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
      auto_regrade_scope: "matching_historical_attempts",
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
    const regradeResult = await applyAcceptedAnswerToHistoricalAttempts(
      dispute,
      teacher,
      now,
      newVersion,
      historyRecord.history_id
    );
    if (historyAdd && historyAdd.id) {
      await db.collection("grading_key_history").doc(historyAdd.id).update({
        auto_regrade_applied: true,
        auto_regrade_applied_at: now,
        auto_regrade_scanned_attempt_count: regradeResult.scanned_attempt_count,
        auto_regrade_adjusted_attempt_count: regradeResult.adjusted_attempt_count,
      });
    }
    dispute.grading_version_after = newVersion;
    dispute.auto_regrade_scanned_attempt_count = regradeResult.scanned_attempt_count;
    dispute.auto_regrade_adjusted_attempt_count = regradeResult.adjusted_attempt_count;
  }

  await db.collection("answer_disputes").doc(dispute._id).update({
    status: decision === "keep" ? "rejected" : "approved",
    decision,
    teacher_note: teacherNote,
    resolved_by_teacher_uid: teacher.auth_uid,
    grading_version_after: dispute.grading_version_after || null,
    auto_regrade_scanned_attempt_count: dispute.auto_regrade_scanned_attempt_count || 0,
    auto_regrade_adjusted_attempt_count: dispute.auto_regrade_adjusted_attempt_count || 0,
    student_seen: false,
    student_seen_at: null,
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
    if (action === "deleteStudentAccount") return await deleteStudentAccount(event, teacher);
    if (action === "resetStudentPassword") return await resetStudentPassword(event);
    if (action === "listSets") return await listSets();
    if (action === "getAssignmentCandidates") return await getAssignmentCandidates(event);
    if (action === "createAssignments") return await createAssignments(event);
    if (action === "updateAssignments") return await updateAssignments(event, teacher);
    if (action === "cancelAssignments") return await cancelAssignments(event, teacher);
    if (action === "getAnswerKeyForSet") return await getAnswerKeyForSet(event);
    if (action === "listAssignments") return await listAssignments();
    if (action === "listProgress") return await listProgress();
    if (action === "listAttempts") return await listAttempts();
    if (action === "getActivityState") return await getActivityState(teacher);
    if (action === "markAttemptsRead") return await markAttemptsRead(teacher);
    if (action === "markActivityAttemptsReviewed") return await markActivityAttemptsReviewed(event, teacher);
    if (action === "markActivityAttemptsReadAll") return await markActivityAttemptsReadAll(teacher);
    if (action === "listDisputes") return await listDisputes();
    if (action === "submitTeacherDispute") return await submitTeacherDispute(event, teacher);
    if (action === "resolveDispute") return await resolveDispute(event, teacher);
    if (action === "backfillAcceptedAnswerRegrades") return await backfillAcceptedAnswerRegrades(event, teacher);
    if (action === "backfillVocabularyContentVersionMismatch") {
      return await backfillVocabularyContentVersionMismatch(event, teacher);
    }
    if (action === "backfillAssignmentDueWeeks") {
      return await backfillAssignmentDueWeeks(event, teacher);
    }
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
          : error.message === "STUDENT_NAME_REQUIRED"
            ? "Student name is required."
          : error.message === "MASTERY_REQUIRED"
            ? "Mastery percentage is required when Earn STAR is enabled."
            : error.message === "DUE_WEEK_REQUIRED"
              ? "Choose a due week before assigning or updating work."
            : error.message === "PASSING_ABOVE_MASTERY"
              ? "Passing percentage cannot be higher than mastery percentage."
              : `Unable to complete this teacher action (${error.message || "TEACHER_ADMIN_ERROR"}).`,
    };
  }
};
