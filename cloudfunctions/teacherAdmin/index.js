const cloudbase = require("@cloudbase/node-sdk");
const CloudBaseManager = require("@cloudbase/manager-node");
const starRewards = require("../_shared/star-rewards");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const envId = process.env.TENCENTCLOUD_TCB_ENVID || "mrcat-dev-d9gwy2v1icdfdf597";
const manager = CloudBaseManager.init({ envId });
const READ_PAGE_LIMIT = 500;
const VOCAB_ITEM_COLLECTION = "student_vocabulary_items";
const LEXICON_COLLECTION = "vocabulary_lexicon";
const LEXICON_HISTORY_COLLECTION = "vocabulary_lexicon_history";
const DICTIONARY_REPORT_COLLECTION = "vocabulary_dictionary_reports";
const AI_LOOKUP_TIMEOUT_MS = 15000;
const STAR_LEDGER_COLLECTION = "star_reward_ledger";
const STAR_REQUEST_COLLECTION = "star_redemption_requests";
const STAR_EVIDENCE_COLLECTION = "star_redemption_evidence";
const CLASS_COLLECTION = "classes";
const CLASS_MEMBERSHIP_COLLECTION = "class_memberships";

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

function compact(value, limit) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, limit);
}

function lexiconPublicView(item) {
  if (!item) return null;
  return {
    lexicon_id: item.lexicon_id || "",
    normalized_word: item.normalized_word || "",
    word: item.word || "",
    phonetic: item.phonetic || "",
    part_of_speech: item.part_of_speech || "",
    english_definition: item.english_definition || "",
    chinese_meaning: item.chinese_meaning || "",
    word_forms: item.word_forms || "",
    senses: Array.isArray(item.senses) ? item.senses.slice(0, 8) : [],
    source_type: item.source_type || "",
    source_name: item.source_name || "",
    verified: item.verified === true,
    review_status: item.review_status || (item.verified === true ? "reviewed" : "external"),
    created_at: item.created_at || null,
    updated_at: item.updated_at || null,
  };
}

function vocabularyItemTeacherView(item, lexicon) {
  return {
    vocab_id: item.vocab_id || "",
    text: item.text || "",
    normalized_text: item.normalized_text || "",
    status: item.status || "active",
    personal_note: item.personal_note || "",
    source_set_id: item.source_set_id || null,
    source_title: item.source_title || "",
    source_path: item.source_path || "",
    context: item.context || "",
    saved_examples: Array.isArray(item.saved_examples) ? item.saved_examples.slice(0, 40) : [],
    times_added: Number(item.times_added || 1),
    activity_updated_at: item.activity_updated_at || item.last_added_at || item.created_at || null,
    created_at: item.created_at || null,
    dictionary: lexiconPublicView(lexicon),
  };
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
  return Boolean(assignment && assignment.mastery_enabled === true);
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
  return starRewards.isBlueAchievement(item);
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
  if (!student || !assignment) return null;
  const set = await getOne("sets", { set_id: assignment.set_id });
  return starRewards.protectYellowStar({
    db,
    student,
    assignment,
    attempt,
    now,
    masteryEnabled: assignmentMasteryEnabled(assignment),
    passingPercentage: passingPercentageForAssignment(assignment, set),
    starRate: masteryPercentageForAssignment(assignment, set),
  });
}

async function protectSelfStudyStar(student, attempt, now) {
  if (!student || !attempt || !attempt.set_id) return null;
  const set = await getOne("sets", { set_id: attempt.set_id });
  return starRewards.protectBlueStar({
    db,
    student,
    attempt,
    now,
    passingPercentage: passingPercentageForSet(set),
    masteryPercentage: masteryPercentageForSet(set),
  });
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
    chinese_name: source.chinese_name || "",
    english_name: source.english_name || "",
    class_id: source.class_id || "",
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

function hasOwnProperty(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizedClassName(value) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function classNameHash(value) {
  let hash = 2166136261;
  for (const character of normalizedClassName(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function generatedClassId(name) {
  const normalized = normalizedClassName(name);
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "class";
  return `class-${slug}-${classNameHash(normalized)}`;
}

function membershipIsActive(membership) {
  return Boolean(membership) && membership.active !== false && !membership.ended_at;
}

async function activeClassMembershipsForStudent(studentUid) {
  const memberships = await getAll(CLASS_MEMBERSHIP_COLLECTION, { where: { student_uid: studentUid } });
  return memberships.map(recordData).filter(membershipIsActive);
}

async function endActiveClassMemberships(studentUid, now, teacherUid) {
  const student = await getOne("students", { auth_uid: studentUid });
  if (!student) return null;
  return await syncStudentClassMembership({ ...student, active: false }, null, now, teacherUid);
}

async function resolveClassReference(classIdInput, classNameInput, now, teacherUid) {
  const requestedClassId = text(classIdInput);
  const requestedName = text(classNameInput);
  if (requestedClassId) {
    const existing = await getOne(CLASS_COLLECTION, { class_id: requestedClassId });
    if (!existing || existing.active === false) throw new Error("CLASS_NOT_FOUND");
    return recordData(existing);
  }
  if (!requestedName) return null;

  const normalizedName = normalizedClassName(requestedName);
  let existing = await getOne(CLASS_COLLECTION, { normalized_name: normalizedName });
  if (!existing) existing = await getOne(CLASS_COLLECTION, { class_id: generatedClassId(requestedName) });
  if (existing && existing.active === false) throw new Error("CLASS_NOT_FOUND");
  if (existing) return recordData(existing);

  const classRecord = {
    class_id: generatedClassId(requestedName),
    name: requestedName,
    normalized_name: normalizedName,
    active: true,
    created_at: now,
    updated_at: now,
    created_by_teacher_uid: text(teacherUid) || null,
  };
  const added = await db.collection(CLASS_COLLECTION).add(classRecord);
  return { ...classRecord, _id: added && added.id };
}

async function syncStudentClassMembership(student, classRecord, now, teacherUid) {
  const source = recordData(student);
  const studentUid = text(source.auth_uid);
  if (!studentUid) throw new Error("AUTH_UID_REQUIRED");
  const requestedClassId = source.active === true ? text(classRecord && classRecord.class_id) : "";
  let outcome = null;
  await db.runTransaction(async (transaction) => {
    const profileResult = await transaction.collection("students").where({ auth_uid: studentUid }).limit(1).get();
    const currentProfile = profileResult.data && profileResult.data[0] ? recordData(profileResult.data[0]) : null;
    if (!currentProfile) throw new Error("STUDENT_NOT_FOUND");
    const targetClassId = currentProfile.active === true ? text(currentProfile.class_id) : "";
    if (targetClassId !== requestedClassId) throw new Error("CLASS_MEMBERSHIP_TARGET_STALE");

    // Every membership synchronization writes the profile lock row. CloudBase
    // transaction conflict detection then serializes concurrent class changes
    // for one student, preventing two active membership rows from being added.
    await transaction.collection("students").doc(currentProfile._id).update({
      membership_synced_at: now,
    });
    const membershipResult = await transaction.collection(CLASS_MEMBERSHIP_COLLECTION)
      .where({ student_uid: studentUid }).limit(500).get();
    const activeMemberships = (membershipResult.data || []).map(recordData).filter(membershipIsActive);
    const matching = targetClassId
      ? activeMemberships.find((membership) => text(membership.class_id) === targetClassId)
      : null;
    for (const membership of activeMemberships) {
      if (matching && membership._id === matching._id) continue;
      await transaction.collection(CLASS_MEMBERSHIP_COLLECTION).doc(membership._id).update({
        active: false,
        ended_at: now,
        updated_at: now,
        ended_by_teacher_uid: text(teacherUid) || null,
      });
    }
    if (!targetClassId) {
      outcome = null;
      return;
    }
    const snapshot = {
      student_id_snapshot: text(currentProfile.student_id),
      student_name_snapshot: text(currentProfile.name),
      chinese_name_snapshot: text(currentProfile.chinese_name),
      english_name_snapshot: text(currentProfile.english_name),
      class_name_snapshot: text(classRecord && classRecord.name) || text(currentProfile.class_group),
      updated_at: now,
    };
    if (matching) {
      await transaction.collection(CLASS_MEMBERSHIP_COLLECTION).doc(matching._id).update({
        ...snapshot,
        active: true,
      });
      outcome = { ...matching, ...snapshot };
      return;
    }
    const membership = {
      membership_id: `${studentUid}-${targetClassId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      student_uid: studentUid,
      class_id: targetClassId,
      active: true,
      started_at: now,
      ended_at: null,
      created_by_teacher_uid: text(teacherUid) || null,
      created_at: now,
      ...snapshot,
    };
    const added = await transaction.collection(CLASS_MEMBERSHIP_COLLECTION).add(membership);
    outcome = { ...membership, _id: added && added.id };
  });
  return outcome;
}

async function targetClassForStudentUpdate(event, student, now, teacherUid) {
  const classWasProvided = hasOwnProperty(event, "class_id") || hasOwnProperty(event, "class_group");
  if (!classWasProvided) {
    const currentClassId = text(student.class_id);
    if (currentClassId) return await resolveClassReference(currentClassId, "", now, teacherUid);
    if (text(student.class_group)) return await resolveClassReference("", student.class_group, now, teacherUid);
    return null;
  }
  const requestedClassId = hasOwnProperty(event, "class_id") ? text(event.class_id) : "";
  const requestedClassName = hasOwnProperty(event, "class_group") ? text(event.class_group) : "";
  if (requestedClassId) return await resolveClassReference(requestedClassId, requestedClassName, now, teacherUid);
  if (requestedClassName) return await resolveClassReference("", requestedClassName, now, teacherUid);
  return null;
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

async function listClasses() {
  const classes = (await getAll(CLASS_COLLECTION))
    .map(recordData)
    .filter((classRecord) => text(classRecord.class_id) && classRecord.active !== false)
    .map((classRecord) => ({
      class_id: text(classRecord.class_id),
      name: text(classRecord.name),
    }))
    .filter((classRecord) => classRecord.name)
    .sort((left, right) => left.name.localeCompare(right.name));
  return { success: true, classes };
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

async function createStudent(event, teacher) {
  const studentId = text(event.student_id);
  const name = text(event.name);
  const classGroup = text(event.class_group);
  const curriculumTrack = text(event.curriculum_track);
  const chineseName = text(event.chinese_name);
  const englishName = text(event.english_name);

  if (!studentId || !name) throw new Error("STUDENT_FIELDS_REQUIRED");
  const matchingProfiles = (await getAll("students", { where: { student_id: studentId } })).map(recordData);
  if (matchingProfiles.some((student) => !isDeletedStudent(student))) throw new Error("STUDENT_ID_EXISTS");
  if (await findEndUserByUsername(studentId)) throw new Error("STUDENT_ID_EXISTS");

  for (const deletedStudent of matchingProfiles) {
    await releaseDeletedStudentId(deletedStudent);
  }

  const now = new Date();
  const classRecord = await resolveClassReference(event.class_id, classGroup, now, teacher && teacher.auth_uid);
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

  const student = {
    auth_uid: authUid,
    student_id: studentId,
    name,
    chinese_name: chineseName,
    english_name: englishName,
    class_id: classRecord ? classRecord.class_id : "",
    class_group: classRecord ? classRecord.name : "",
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
    await syncStudentClassMembership(
      verified || { ...student, _id: addResult && addResult.id },
      classRecord,
      now,
      teacher && teacher.auth_uid
    );
  } catch (error) {
    let profileRollbackFailed = false;
    const profileId = verified && verified._id || addResult && addResult.id;
    if (profileId) {
      try {
        await db.collection("students").doc(profileId).remove();
      } catch (rollbackError) {
        profileRollbackFailed = true;
        console.error("Unable to roll back student profile", rollbackError);
      }
    }
    try {
      await manager.user.deleteEndUsers({ userList: [authUid] });
    } catch (rollbackError) {
      console.error("Unable to roll back auth user", rollbackError);
      throw new Error("PROFILE_CREATE_FAILED_ROLLBACK_REQUIRED");
    }
    if (profileRollbackFailed) throw new Error("PROFILE_CREATE_FAILED_ROLLBACK_REQUIRED");
    throw new Error("PROFILE_CREATE_FAILED_AUTH_ROLLED_BACK");
  }
  return {
    success: true,
    student: studentView(verified || { ...student, _id: addResult && addResult.id }),
    initial_password: password,
  };
}

async function updateStudent(event, teacher) {
  const authUid = text(event.auth_uid);
  if (!authUid) throw new Error("AUTH_UID_REQUIRED");
  const student = await getOne("students", { auth_uid: authUid });
  if (!student || student.role === "teacher" || isDeletedStudent(student)) throw new Error("STUDENT_NOT_FOUND");

  const now = new Date();
  const classRecord = await targetClassForStudentUpdate(event, student, now, teacher && teacher.auth_uid);
  const update = { updated_at: now };
  if (Object.prototype.hasOwnProperty.call(event, "name")) {
    update.name = text(event.name);
    if (!update.name) throw new Error("STUDENT_NAME_REQUIRED");
  }
  if (Object.prototype.hasOwnProperty.call(event, "chinese_name")) update.chinese_name = text(event.chinese_name);
  if (Object.prototype.hasOwnProperty.call(event, "english_name")) update.english_name = text(event.english_name);
  if (classRecord) {
    update.class_id = classRecord.class_id;
    update.class_group = classRecord.name;
  } else if (hasOwnProperty(event, "class_id") || hasOwnProperty(event, "class_group")) {
    update.class_id = "";
    update.class_group = "";
  }
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
  try {
    if (update.active === false) {
      await endActiveClassMemberships(authUid, now, teacher && teacher.auth_uid);
    } else {
      await syncStudentClassMembership(
        { ...student, ...update },
        classRecord,
        now,
        teacher && teacher.auth_uid
      );
    }
  } catch (syncError) {
    if (syncError && syncError.message === "CLASS_MEMBERSHIP_TARGET_STALE") {
      throw new Error("CLASS_UPDATE_CONFLICT");
    }
    let rollbackFailed = false;
    try {
      const profileRollback = { updated_at: student.updated_at || now };
      Object.keys(update).forEach((key) => {
        if (key === "updated_at") return;
        profileRollback[key] = Object.prototype.hasOwnProperty.call(student, key) ? student[key] : null;
      });
      await db.collection("students").doc(student._id).update(profileRollback);
      if (Object.prototype.hasOwnProperty.call(update, "active")) {
        await manager.user.setEndUserStatus({
          uuid: authUid,
          status: student.active === true ? "ENABLE" : "DISABLE",
        });
      }
      const previousClass = await targetClassForStudentUpdate({}, student, now, teacher && teacher.auth_uid);
      await syncStudentClassMembership(student, previousClass, now, teacher && teacher.auth_uid);
    } catch (rollbackError) {
      rollbackFailed = true;
      console.error("Unable to compensate class membership sync", rollbackError);
    }
    if (rollbackFailed) throw new Error("CLASS_MEMBERSHIP_SYNC_FAILED_ROLLBACK_REQUIRED");
    throw new Error("CLASS_MEMBERSHIP_SYNC_FAILED_AUTH_ROLLED_BACK");
  }
  return {
    success: true,
    class_id: classRecord ? classRecord.class_id : "",
    class_group: classRecord ? classRecord.name : "",
  };
}

function sameStringSet(left, right) {
  const a = [...new Set((left || []).map(text).filter(Boolean))].sort();
  const b = [...new Set((right || []).map(text).filter(Boolean))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function classPlanForStudent(student, classesById, classesByName) {
  const currentClassId = text(student.class_id);
  const currentClass = currentClassId && classesById.get(currentClassId);
  if (currentClass && currentClass.active !== false) return currentClass;
  const legacyName = text(student.class_group);
  if (!legacyName) return null;
  const existingByName = classesByName.get(normalizedClassName(legacyName));
  if (existingByName && existingByName.active !== false) return existingByName;
  return {
    class_id: generatedClassId(legacyName),
    name: legacyName,
    normalized_name: normalizedClassName(legacyName),
    active: true,
  };
}

function activeMembershipMap(rows) {
  const map = new Map();
  (rows || []).map(recordData).filter(membershipIsActive).forEach((membership) => {
    const studentUid = text(membership.student_uid);
    const entries = map.get(studentUid) || [];
    entries.push(membership);
    map.set(studentUid, entries);
  });
  return map;
}

function legacyAssignmentScopePlan(assignments, membersByClassId) {
  const batches = new Map();
  (assignments || []).map(recordData).forEach((assignment) => {
    const batchId = text(assignment.assignment_batch_id);
    if (!batchId) return;
    const rows = batches.get(batchId) || [];
    rows.push(assignment);
    batches.set(batchId, rows);
  });
  const outcomes = [];
  batches.forEach((rows, batchId) => {
    const setIds = [...new Set(rows.map((row) => text(row.set_id)).filter(Boolean))];
    const recipients = rows.map((row) => text(row.student_uid)).filter(Boolean);
    const recipientSet = [...new Set(recipients)];
    if (setIds.length !== 1 || recipients.length !== recipientSet.length) {
      outcomes.push({ assignment_batch_id: batchId, reason: "ambiguous_batch", status: "skipped" });
      return;
    }
    const matchingClasses = [...membersByClassId.entries()]
      .filter(([, members]) => sameStringSet(recipientSet, [...members]));
    if (matchingClasses.length !== 1) {
      outcomes.push({
        assignment_batch_id: batchId,
        reason: matchingClasses.length ? "ambiguous_class_coverage" : "partial_or_mixed_recipients",
        status: "skipped",
      });
      return;
    }
    const [classId] = matchingClasses[0];
    const classTaskId = `class-task-${classId}-${batchId}`;
    const alreadyScoped = rows.every((row) =>
      row.assignment_scope === "class"
      && text(row.class_id) === classId
      && text(row.class_task_id) === classTaskId
    );
    if (!alreadyScoped && rows.some((row) => row.assignment_scope || row.class_task_id)) {
      outcomes.push({ assignment_batch_id: batchId, reason: "existing_scope_not_legacy", status: "skipped" });
      return;
    }
    outcomes.push({
      assignment_batch_id: batchId,
      class_id: classId,
      class_task_id: classTaskId,
      assignment_ids: rows.map((row) => row._id),
      assignment_count: rows.length,
      already_scoped: alreadyScoped,
      status: "planned",
    });
  });
  outcomes.sort((left, right) => left.assignment_batch_id.localeCompare(right.assignment_batch_id));
  return {
    outcomes,
    planned: outcomes.filter((item) => item.status === "planned"),
    skipped: outcomes.filter((item) => item.status === "skipped"),
  };
}

async function backfillLearningReportModel(event, teacher) {
  const apply = event.apply === true;
  const limit = Math.min(Math.max(Number(event.limit || 100), 1), 200);
  const offset = Math.max(Number(event.offset || 0), 0);
  const assignmentLimit = Math.min(Math.max(Number(event.assignment_limit || 25), 1), 100);
  const assignmentOffset = Math.max(Number(event.assignment_offset || 0), 0);
  const [studentRows, classRows, membershipRows, assignmentRows] = await Promise.all([
    getAll("students", { where: { active: true } }),
    getAll(CLASS_COLLECTION),
    getAll(CLASS_MEMBERSHIP_COLLECTION),
    getAll("assignments"),
  ]);
  const students = visibleStudentRecords(studentRows).filter((student) =>
    student.active === true && student.role !== "teacher" && text(student.auth_uid)
  ).sort((left, right) => text(left.student_id).localeCompare(text(right.student_id)));
  const classesById = new Map(classRows.map(recordData)
    .filter((classRecord) => text(classRecord.class_id))
    .map((classRecord) => [text(classRecord.class_id), classRecord]));
  const classesByName = new Map(classRows.map(recordData)
    .filter((classRecord) => text(classRecord.normalized_name || classRecord.name))
    .map((classRecord) => [normalizedClassName(classRecord.normalized_name || classRecord.name), classRecord]));
  const allPlans = students.map((student) => ({
    student,
    classRecord: classPlanForStudent(student, classesById, classesByName),
  }));
  const targetPlans = allPlans.slice(offset, offset + limit);
  const plannedClasses = new Map();
  allPlans.forEach((plan) => {
    if (!plan.classRecord || classesById.has(plan.classRecord.class_id)) return;
    plannedClasses.set(plan.classRecord.class_id, plan.classRecord);
  });
  const membershipsByStudent = activeMembershipMap(membershipRows);
  const membershipChanges = targetPlans.filter((plan) => {
    const activeMemberships = membershipsByStudent.get(text(plan.student.auth_uid)) || [];
    const targetClassId = text(plan.classRecord && plan.classRecord.class_id);
    return activeMemberships.length !== (targetClassId ? 1 : 0)
      || Boolean(targetClassId) !== activeMemberships.some((membership) => text(membership.class_id) === targetClassId);
  });
  const profileChanges = targetPlans.filter((plan) => {
    const classRecord = plan.classRecord;
    return text(plan.student.class_id) !== text(classRecord && classRecord.class_id)
      || text(plan.student.class_group) !== text(classRecord && classRecord.name);
  });
  const membersByClassId = new Map();
  allPlans.forEach((plan) => {
    if (!plan.classRecord) return;
    const classId = text(plan.classRecord.class_id);
    const members = membersByClassId.get(classId) || new Set();
    members.add(text(plan.student.auth_uid));
    membersByClassId.set(classId, members);
  });
  const assignmentScope = legacyAssignmentScopePlan(assignmentRows, membersByClassId);
  const assignmentPage = assignmentScope.outcomes.slice(assignmentOffset, assignmentOffset + assignmentLimit);
  const assignmentPlannedPage = assignmentPage.filter((item) => item.status === "planned");
  const assignmentSkippedPage = assignmentPage.filter((item) => item.status === "skipped");
  const proposalSummaries = targetPlans.map((plan) => {
    const currentMemberships = membershipsByStudent.get(text(plan.student.auth_uid)) || [];
    const targetClassId = text(plan.classRecord && plan.classRecord.class_id);
    const membershipChange = currentMemberships.length !== (targetClassId ? 1 : 0)
      || Boolean(targetClassId) !== currentMemberships.some((membership) => text(membership.class_id) === targetClassId);
    const profileChange = text(plan.student.class_id) !== targetClassId
      || text(plan.student.class_group) !== text(plan.classRecord && plan.classRecord.name);
    return {
      student_id: text(plan.student.student_id),
      current_class_id: text(plan.student.class_id),
      current_class_name: text(plan.student.class_group),
      target_class_id: targetClassId,
      target_class_name: text(plan.classRecord && plan.classRecord.name),
      profile_change: profileChange,
      membership_change: membershipChange,
    };
  });
  const now = new Date();
  const assignmentApplyFailures = [];
  if (apply) {
    for (const classRecord of plannedClasses.values()) {
      const existing = await getOne(CLASS_COLLECTION, { class_id: classRecord.class_id });
      if (!existing) {
        await db.collection(CLASS_COLLECTION).add({
          ...classRecord,
          created_at: now,
          updated_at: now,
          created_by_teacher_uid: teacher.auth_uid,
        });
      }
    }
    for (const plan of targetPlans) {
      const classRecord = plan.classRecord;
      const update = {
        class_id: classRecord ? classRecord.class_id : "",
        class_group: classRecord ? classRecord.name : "",
        updated_at: now,
      };
      if (text(plan.student.class_id) !== update.class_id || text(plan.student.class_group) !== update.class_group) {
        await db.collection("students").doc(plan.student._id).update(update);
      }
      await syncStudentClassMembership({ ...plan.student, ...update }, classRecord, now, teacher.auth_uid);
    }
    for (const scope of assignmentPlannedPage) {
      try {
        await promoteClassAssignmentBatch(
          scope.assignment_batch_id,
          scope.class_id,
          now,
          teacher.auth_uid
        );
      } catch (error) {
        assignmentApplyFailures.push({
          assignment_batch_id: scope.assignment_batch_id,
          class_id: scope.class_id,
          code: error.message || "ASSIGNMENT_SCOPE_ERROR",
        });
      }
    }
  }
  const nextOffset = offset + targetPlans.length;
  const nextAssignmentOffset = assignmentOffset + assignmentPage.length;
  return {
    success: true,
    dry_run: !apply,
    limit,
    offset,
    next_offset: nextOffset < allPlans.length ? nextOffset : null,
    students: {
      total_active: allPlans.length,
      inspected: targetPlans.length,
      profile_updates: profileChanges.length,
      membership_updates: membershipChanges.length,
      proposals: proposalSummaries,
    },
    classes: {
      create_count: plannedClasses.size,
      classes_to_create: [...plannedClasses.values()].slice(0, 200).map((classRecord) => ({
        class_id: classRecord.class_id,
        name: classRecord.name,
      })),
    },
    assignment_scope: {
      assignment_limit: assignmentLimit,
      assignment_offset: assignmentOffset,
      assignment_next_offset: nextAssignmentOffset < assignmentScope.outcomes.length ? nextAssignmentOffset : null,
      total_batches: assignmentScope.outcomes.length,
      class_batches: assignmentPlannedPage.map((item) => ({
        assignment_batch_id: item.assignment_batch_id,
        class_id: item.class_id,
        assignment_count: item.assignment_count,
        already_scoped: item.already_scoped === true,
      })),
      skipped_batches: assignmentSkippedPage,
      apply_failures: assignmentApplyFailures,
    },
  };
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
  await endActiveClassMemberships(authUid, now, teacher && teacher.auth_uid);
  return { success: true };
}

async function resetStudentPassword(event, teacher) {
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
  const now = new Date();
  const classRecord = await targetClassForStudentUpdate({}, student, now, teacher && teacher.auth_uid);
  await db.collection("students").doc(student._id).update({
    active: true,
    must_change_password: true,
    updated_at: now,
  });
  await syncStudentClassMembership(
    { ...student, active: true, must_change_password: true, updated_at: now },
    classRecord,
    now,
    teacher && teacher.auth_uid
  );
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
      edition_family: set.edition_family || "",
      edition_number: set.edition_number == null ? null : Number(set.edition_number),
      edition_label: set.edition_label || "",
      is_latest_edition: set.is_latest_edition === true,
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

async function classAssignmentScopesForRecipients(studentUids) {
  const requested = new Set((studentUids || []).map(text).filter(Boolean));
  if (!requested.size) return new Map();
  const [studentRows, classRows, membershipRows] = await Promise.all([
    getAll("students", { where: { active: true } }),
    getAll(CLASS_COLLECTION),
    getAll(CLASS_MEMBERSHIP_COLLECTION),
  ]);
  const activeStudentUids = new Set(visibleStudentRecords(studentRows)
    .filter((student) => student.role !== "teacher" && student.active === true)
    .map((student) => text(student.auth_uid))
    .filter(Boolean));
  const activeClassIds = new Set(classRows.map(recordData)
    .filter((classRecord) => classRecord.active !== false)
    .map((classRecord) => text(classRecord.class_id))
    .filter(Boolean));
  const membersByClassId = new Map();
  membershipRows.map(recordData).forEach((membership) => {
    const classId = text(membership.class_id);
    const studentUid = text(membership.student_uid);
    if (!membershipIsActive(membership) || !activeClassIds.has(classId) || !activeStudentUids.has(studentUid)) return;
    const members = membersByClassId.get(classId) || new Set();
    members.add(studentUid);
    membersByClassId.set(classId, members);
  });

  const scopes = new Map();
  membersByClassId.forEach((members, classId) => {
    if (!members.size || ![...members].every((studentUid) => requested.has(studentUid))) return;
    members.forEach((studentUid) => scopes.set(studentUid, { assignment_scope: "class", class_id: classId }));
  });
  return scopes;
}

async function promoteClassAssignmentBatch(assignmentBatchId, classId, now, teacherUid) {
  let promotedStudentUids = null;
  await db.runTransaction(async (transaction) => {
    // CloudBase transactions allow only one in-flight operation per transaction.
    // Keep these reads sequential or concurrent requests can fail with
    // ResourceUnavailable.TransactionBusy before any assignment is updated.
    const classResult = await transaction.collection(CLASS_COLLECTION)
      .where({ class_id: classId, active: true }).limit(1).get();
    const membershipResult = await transaction.collection(CLASS_MEMBERSHIP_COLLECTION)
      .where({ class_id: classId }).limit(500).get();
    const profileResult = await transaction.collection("students")
      .where({ class_id: classId, active: true }).limit(500).get();
    const assignmentResult = await transaction.collection("assignments")
      .where({ assignment_batch_id: assignmentBatchId }).limit(500).get();
    if (!classResult.data || !classResult.data[0]) throw new Error("CLASS_NOT_FOUND");
    const activeProfiles = new Set(visibleStudentRecords(profileResult.data || [])
      .filter((student) => student.role !== "teacher")
      .map((student) => text(student.auth_uid))
      .filter(Boolean));
    const roster = [...new Set((membershipResult.data || []).map(recordData)
      .filter(membershipIsActive)
      .map((membership) => text(membership.student_uid))
      .filter((studentUid) => studentUid && activeProfiles.has(studentUid)))].sort();
    if (!roster.length) throw new Error("CLASS_ROSTER_EMPTY");
    const assignments = (assignmentResult.data || []).map(recordData);
    const targetAssignments = assignments.filter((assignment) => roster.includes(text(assignment.student_uid)));
    const targetStudentUids = targetAssignments.map((assignment) => text(assignment.student_uid)).sort();
    if (targetAssignments.length !== roster.length || !sameStringSet(targetStudentUids, roster)) {
      throw new Error("CLASS_ROSTER_CHANGED");
    }
    const classTaskId = `class-task-${classId}-${assignmentBatchId}`;
    if (targetAssignments.some((assignment) =>
      assignment.assignment_scope === "class"
        ? text(assignment.class_id) !== classId || text(assignment.class_task_id) !== classTaskId
        : assignment.assignment_scope && assignment.assignment_scope !== "individual"
    )) {
      throw new Error("ASSIGNMENT_SCOPE_CONFLICT");
    }
    for (const assignment of targetAssignments) {
      if (assignment.assignment_scope === "class" && assignment.class_task_id === classTaskId) continue;
      await transaction.collection("assignments").doc(assignment._id).update({
        assignment_scope: "class",
        class_id: classId,
        class_task_id: classTaskId,
        scope_derived_at: now,
        scope_derived_by_teacher_uid: text(teacherUid) || null,
        updated_at: now,
      });
    }
    promotedStudentUids = roster;
  });
  if (!promotedStudentUids) throw new Error("ASSIGNMENT_SCOPE_TRANSACTION_EMPTY");
  return promotedStudentUids;
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
  const conversionAttempt = bestSelfStudyAttempt || selfStudyAttempt || (selfStudyStar ? {
    attempt_id: selfStudyStar.best_attempt_id || null,
    set_id: setId,
    percentage: selfStudyPercentage,
    submitted_at: selfStudyStar.first_earned_at || selfStudyStar.created_at || now,
  } : null);
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
    assignment_scope: "individual",
    class_id: null,
    class_task_id: null,
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

async function createAssignments(event, teacher) {
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
    const recipients = [];
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
      recipients.push({ student, assignmentState });
    }
    // Scope is derived from the effective recipients after open assignments and
    // inactive profiles are removed. A browser-supplied class ID can never turn
    // a partial batch into a Class Task.
    const scopes = await classAssignmentScopesForRecipients(recipients.map((item) => item.student.auth_uid));
    const createdForBatch = [];
    for (const recipient of recipients) {
      const { student, assignmentState } = recipient;
      const assignmentResult = await createAssignmentForStudent(
        student,
        setId,
        dueAt,
        passingPercentage,
        masteryPercentage,
        masteryEnabled,
        assignmentBatchId
      );
      const createdItem = {
        student_uid: student.auth_uid,
        student_id: student.student_id,
        set_id: setId,
        assignment_id: assignmentResult.assignmentId,
        assignment_scope: "individual",
        class_id: null,
        reassigned_after_completion: assignmentState.availability === "completed",
        converted_from_self_study: assignmentResult.convertedFromSelfStudy,
      };
      created.push(createdItem);
      createdForBatch.push(createdItem);
    }
    const candidateClassIds = [...new Set([...scopes.values()].map((scope) => text(scope.class_id)).filter(Boolean))];
    for (const classId of candidateClassIds) {
      try {
        const promotedUids = new Set(await promoteClassAssignmentBatch(
          assignmentBatchId,
          classId,
          new Date(),
          teacher && teacher.auth_uid
        ));
        createdForBatch.forEach((item) => {
          if (!promotedUids.has(text(item.student_uid))) return;
          item.assignment_scope = "class";
          item.class_id = classId;
        });
      } catch (error) {
        console.error("Unable to promote assignment batch to class scope", assignmentBatchId, classId, error);
        skipped.push({
          set_id: setId,
          assignment_batch_id: assignmentBatchId,
          class_id: classId,
          reason: "class_scope_promotion_failed",
          code: error.message || "ASSIGNMENT_SCOPE_ERROR",
        });
      }
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

async function applyClassTaskMutationPlans(plans, now, teacherUid) {
  const groups = new Map();
  (plans || []).forEach((plan) => {
    const taskId = text(plan.assignment && plan.assignment.class_task_id);
    if (!taskId || plan.assignment.assignment_scope !== "class") return;
    const entries = groups.get(taskId) || [];
    entries.push(plan);
    groups.set(taskId, entries);
  });
  const applied = new Set();
  for (const [classTaskId, taskPlans] of groups.entries()) {
    await db.runTransaction(async (transaction) => {
      const result = await transaction.collection("assignments")
        .where({ class_task_id: classTaskId }).limit(500).get();
      const taskAssignments = (result.data || []).map(recordData);
      if (!taskAssignments.length || taskAssignments.length >= 500) {
        throw new Error("CLASS_TASK_SCOPE_INVALID");
      }
      const selectedIds = taskPlans.map((plan) => text(plan.assignment._id));
      const allIds = taskAssignments.map((assignment) => text(assignment._id));
      if (sameStringSet(selectedIds, allIds)) {
        for (const plan of taskPlans) {
          await transaction.collection("assignments").doc(plan.assignment._id).update(plan.update);
          applied.add(plan.assignment._id);
        }
        return;
      }
      // A partial edit/cancellation means the original batch is no longer one
      // uniform full-roster Class Task. Downgrade every row atomically before
      // applying the selected personal mutations outside this transaction.
      for (const assignment of taskAssignments) {
        await transaction.collection("assignments").doc(assignment._id).update({
          assignment_scope: "individual",
          class_id: null,
          class_task_id: null,
          scope_downgraded_at: now,
          scope_downgraded_by_teacher_uid: text(teacherUid) || null,
          updated_at: now,
        });
      }
    });
  }
  return applied;
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
  const plans = [];
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

    plans.push({ assignment, update, masteryEnabled, mastery });
  }

  const transactionallyApplied = await applyClassTaskMutationPlans(plans, now, teacher.auth_uid);
  const updated = [];
  for (const plan of plans) {
    const { assignment, update, masteryEnabled, mastery } = plan;
    if (!transactionallyApplied.has(assignment._id)) {
      await db.collection("assignments").doc(assignment._id).update(update);
    }
    const revisedAssignment = { ...assignment, ...update };
    if (masteryEnabled) {
      const achievementRows = await db.collection("student_set_achievements").where({
        student_uid: assignment.student_uid,
        set_id: assignment.set_id,
      }).limit(100).get();
      const activeBlue = (achievementRows.data || []).find(starRewards.isActiveBlueAchievement);
      const bluePercentage = Number(activeBlue && activeBlue.best_percentage);
      if (activeBlue && Number.isFinite(bluePercentage) && bluePercentage >= mastery) {
        const student = await getOne("students", { auth_uid: assignment.student_uid, active: true });
        const sourceAttempt = activeBlue.best_attempt_id
          ? await getOne("attempts", { attempt_id: activeBlue.best_attempt_id, student_uid: assignment.student_uid })
          : null;
        const attempt = sourceAttempt || {
          attempt_id: activeBlue.best_attempt_id || null,
          set_id: assignment.set_id,
          percentage: bluePercentage,
          submitted_at: activeBlue.first_earned_at || activeBlue.created_at || now,
        };
        const earnedAt = attempt.submitted_at || now;
        const masteryUpdate = {
          status: "mastered",
          completed_at: revisedAssignment.completed_at || earnedAt,
          mastered_at: revisedAssignment.mastered_at || earnedAt,
          best_percentage: Math.max(Number(revisedAssignment.best_percentage || 0), bluePercentage),
          raw_best_percentage: Math.max(Number(revisedAssignment.raw_best_percentage || 0), bluePercentage),
          best_attempt_id: revisedAssignment.best_attempt_id || attempt.attempt_id || null,
          converted_from_self_study: true,
          converted_self_study_achievement_id: activeBlue.achievement_id || activeBlue._id,
          converted_self_study_attempt_id: attempt.attempt_id || null,
          updated_at: now,
        };
        await db.collection("assignments").doc(assignment._id).update(masteryUpdate);
        if (student) await protectAssignmentStar(student, { ...revisedAssignment, ...masteryUpdate }, attempt, earnedAt);
      }
    }
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
  const plans = [];
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
    plans.push({ assignment, update });
  }

  const transactionallyApplied = await applyClassTaskMutationPlans(plans, now, teacher.auth_uid);
  const cancelled = [];
  for (const plan of plans) {
    const { assignment, update } = plan;
    const assignmentId = assignment.assignment_id || assignment._id;
    if (!transactionallyApplied.has(assignment._id)) {
      await db.collection("assignments").doc(assignment._id).update(update);
    }
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

function attemptSummaryView(record) {
  const attempt = recordData(record);
  return {
    attempt_id: attempt.attempt_id || attempt._id,
    student_uid: attempt.student_uid,
    student_id: attempt.student_id_snapshot || "",
    set_id: attempt.set_id,
    assignment_id: attempt.assignment_id || null,
    mode: attempt.mode || "",
    grading_version: attempt.grading_version || "1",
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
    selected_group_ids: Array.isArray(attempt.selected_group_ids) ? attempt.selected_group_ids : [],
    submitted_at: attempt.submitted_at || null,
    practice_context: attempt.practice_context || "",
    duration_seconds: attempt.duration_seconds == null ? null : Number(attempt.duration_seconds),
    audio_started_at: attempt.audio_started_at || null,
    audio_to_submit_seconds: attempt.audio_to_submit_seconds == null ? null : Number(attempt.audio_to_submit_seconds),
    detail_loaded: false,
  };
}

function attemptView(record, gradingKey) {
  const attempt = recordData(record);
  const gradingAnswers = gradingKey && gradingKey.answers && typeof gradingKey.answers === "object"
    ? gradingKey.answers
    : {};
  const gradingExplanations = gradingKey && gradingKey.explanations && typeof gradingKey.explanations === "object"
    ? gradingKey.explanations
    : {};
  const questionResults = effectiveQuestionResults(attempt).map((item) => {
    const questionId = item.question_id || item.id || "";
    let correctAnswer = item.correct_answer;
    let explanation = item.explanation;
    if (correctAnswer == null && questionId && Object.prototype.hasOwnProperty.call(gradingAnswers, questionId)) {
      correctAnswer = gradingAnswers[questionId];
    }
    if (explanation == null && questionId && Object.prototype.hasOwnProperty.call(gradingExplanations, questionId)) {
      explanation = gradingExplanations[questionId];
    }
    return {
      question_id: questionId,
      question_text_snapshot: item.question_text_snapshot || "",
      submitted_answer: item.submitted_answer == null ? "" : item.submitted_answer,
      correct: item.correct === true,
      correct_answer: correctAnswer == null ? null : correctAnswer,
      explanation: explanation == null ? "" : explanation,
    };
  });
  return {
    ...attemptSummaryView(attempt),
    group_results: Array.isArray(attempt.group_results) ? attempt.group_results : [],
    question_results: questionResults,
    detail_loaded: true,
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
    passing_percentage: passingPercentageForSet(set),
    mastery_percentage: masteryPercentageForSet(set),
    mastery_enabled: true,
    assigned_at: null,
    due_at: null,
    completed_at: completedAt,
    updated_at: latestSubmitted,
    latest_submitted_at: latestSubmitted,
  };
}

async function listProgress() {
  const [assignmentRows, attemptRows, studentRows, setRows] = await Promise.all([
    getAll("assignments"),
    getAll("attempts"),
    getAll("students"),
    getAll("sets"),
  ]);
  const studentMap = new Map(visibleStudentRecords(studentRows).map((student) => [student.auth_uid, student]));
  const assignments = assignmentRows.map(recordData).filter((assignment) =>
    normalizedAssignmentStatus(assignment.status) !== "cancelled"
    && studentMap.has(assignment.student_uid)
  );
  const attempts = attemptRows.map(attemptSummaryView);
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
  const [attemptRows, studentRows] = await Promise.all([
    getAll("attempts"),
    getAll("students"),
  ]);
  const visibleStudentUids = new Set(visibleStudentRecords(studentRows).map((student) => student.auth_uid));
  const attempts = attemptRows.filter((record) => visibleStudentUids.has(recordData(record).student_uid));
  return {
    success: true,
    attempts: attempts.map(attemptSummaryView)
      .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0)),
  };
}

async function getAttemptDetail(event) {
  const attemptId = text(event.attempt_id);
  if (!attemptId) throw new Error("ATTEMPT_ID_REQUIRED");
  const attempt = await getOne("attempts", { attempt_id: attemptId })
    || await getOne("attempts", { _id: attemptId });
  if (!attempt) throw new Error("ATTEMPT_NOT_FOUND");
  const student = await getOne("students", { auth_uid: attempt.student_uid });
  if (!student || !visibleStudentRecords([student]).length) throw new Error("ATTEMPT_NOT_FOUND");
  const gradingKey = await getOne("grading_keys", { set_id: attempt.set_id });
  return {
    success: true,
    attempt: attemptView(attempt, gradingKey),
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

function randomStarRecordId(prefix) {
  const crypto = require("crypto");
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

async function appendStarLedgerEntry(collection, entry) {
  const existing = await collection.where({ ledger_id: entry.ledger_id }).limit(1).get();
  if (existing.data && existing.data[0]) return existing.data[0];
  await collection.add(entry);
  return entry;
}

function teacherRedemptionView(request) {
  return {
    request_id: request.request_id || request._id,
    student_uid: request.student_uid,
    student_id: request.student_id_snapshot || "",
    student_name: request.student_name_snapshot || request.student_id_snapshot || "Student",
    reward_type: request.reward_type || "cash",
    star_count: Number(request.star_count || 0),
    status: request.status || "awaiting_proof",
    evidence_count: Number(request.evidence_count || 0),
    decision_reason: request.decision_reason || "",
    created_at: request.created_at || null,
    updated_at: request.updated_at || null,
    expires_at: request.expires_at || null,
    completed_at: request.completed_at || null,
    rejected_at: request.rejected_at || null,
    cancelled_at: request.cancelled_at || null,
    expired_at: request.expired_at || null,
    refunded_at: request.refunded_at || null,
    processed_by_teacher_uid: request.processed_by_teacher_uid || null,
  };
}

async function transitionStarRequest(requestId, targetStatus, teacher, reason) {
  const decisionReason = text(reason).slice(0, 500);
  if (["rejected", "refunded"].includes(targetStatus) && !decisionReason) {
    throw new Error("STAR_DECISION_REASON_REQUIRED");
  }
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(STAR_REQUEST_COLLECTION).where({ request_id: requestId }).limit(1).get();
    const request = result.data && result.data[0];
    if (!request) throw new Error("CASH_REQUEST_NOT_FOUND");
    const now = new Date();
    if (targetStatus === "completed") {
      if (request.status === "completed") return;
      if (!starRewards.isOpenRequest(request)) throw new Error("CASH_REQUEST_NOT_CONFIRMABLE");
      const evidenceResult = await transaction.collection(STAR_EVIDENCE_COLLECTION).where({
        request_id: requestId,
        status: "active",
      }).limit(1).get();
      if (!evidenceResult.data || !evidenceResult.data[0]) throw new Error("CASH_EVIDENCE_REQUIRED");
      await appendStarLedgerEntry(transaction.collection(STAR_LEDGER_COLLECTION), starRewards.ledgerEntry({
        ledgerId: `redeem::${requestId}`,
        studentUid: request.student_uid,
        requestId,
        achievementIds: request.achievement_ids || [],
        entryType: "redeem",
        actorUid: teacher.auth_uid,
        reason: "Cash given",
        createdAt: now,
      }));
      await transaction.collection(STAR_REQUEST_COLLECTION).doc(request._id).update({
        status: "completed",
        completed_at: now,
        processed_by_teacher_uid: teacher.auth_uid,
        updated_at: now,
        student_seen: false,
        student_seen_at: null,
      });
      return;
    }
    if (targetStatus === "rejected") {
      if (request.status === "rejected") return;
      if (!starRewards.isOpenRequest(request)) throw new Error("CASH_REQUEST_NOT_REJECTABLE");
      await appendStarLedgerEntry(transaction.collection(STAR_LEDGER_COLLECTION), starRewards.ledgerEntry({
        ledgerId: `release::${requestId}::rejected`,
        studentUid: request.student_uid,
        requestId,
        achievementIds: request.achievement_ids || [],
        entryType: "release",
        actorUid: teacher.auth_uid,
        reason: decisionReason,
        createdAt: now,
      }));
      await transaction.collection(STAR_REQUEST_COLLECTION).doc(request._id).update({
        status: "rejected",
        decision_reason: decisionReason,
        rejected_at: now,
        processed_by_teacher_uid: teacher.auth_uid,
        updated_at: now,
        student_seen: false,
        student_seen_at: null,
      });
      return;
    }
    if (targetStatus === "refunded") {
      if (request.status === "refunded") return;
      if (request.status !== "completed") throw new Error("CASH_REQUEST_NOT_REFUNDABLE");
      await appendStarLedgerEntry(transaction.collection(STAR_LEDGER_COLLECTION), starRewards.ledgerEntry({
        ledgerId: `refund::${requestId}`,
        studentUid: request.student_uid,
        requestId,
        achievementIds: request.achievement_ids || [],
        entryType: "refund",
        actorUid: teacher.auth_uid,
        reason: decisionReason,
        createdAt: now,
      }));
      await transaction.collection(STAR_REQUEST_COLLECTION).doc(request._id).update({
        status: "refunded",
        decision_reason: decisionReason,
        refunded_at: now,
        processed_by_teacher_uid: teacher.auth_uid,
        updated_at: now,
        student_seen: false,
        student_seen_at: null,
      });
      return;
    }
    throw new Error("CASH_REQUEST_TRANSITION_INVALID");
  });
  return { success: true };
}

async function expireStarRequests(teacher) {
  const requests = await getAll(STAR_REQUEST_COLLECTION);
  for (const request of requests) {
    if (!starRewards.isRequestExpired(request, new Date())) continue;
    await db.runTransaction(async (transaction) => {
      const result = await transaction.collection(STAR_REQUEST_COLLECTION).where({
        request_id: request.request_id || request._id,
      }).limit(1).get();
      const current = result.data && result.data[0];
      if (!current || !starRewards.isRequestExpired(current, new Date())) return;
      const now = new Date();
      await appendStarLedgerEntry(transaction.collection(STAR_LEDGER_COLLECTION), starRewards.ledgerEntry({
        ledgerId: `release::${current.request_id}::expired`,
        studentUid: current.student_uid,
        requestId: current.request_id,
        achievementIds: current.achievement_ids || [],
        entryType: "release",
        actorUid: teacher && teacher.auth_uid || "system",
        reason: "Cash Request expired",
        createdAt: now,
      }));
      await transaction.collection(STAR_REQUEST_COLLECTION).doc(current._id).update({
        status: "expired",
        expired_at: now,
        updated_at: now,
        student_seen: false,
        student_seen_at: null,
      });
    });
  }
}

async function listStarRedemptions(teacher) {
  await expireStarRequests(teacher);
  const rows = await getAll(STAR_REQUEST_COLLECTION);
  const pending = rows.filter(starRewards.isOpenRequest)
    .sort((left, right) => attemptDateValue(left) - attemptDateValue(right));
  const history = rows.filter((item) => !starRewards.isOpenRequest(item))
    .sort((left, right) => attemptDateValue(right) - attemptDateValue(left));
  return {
    success: true,
    pending_count: pending.length,
    pending: pending.map(teacherRedemptionView),
    history: history.map(teacherRedemptionView),
  };
}

function starEvidenceExtension(mimeType) {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mimeType] || "";
}

function starUploadMetadataView(metadata, cloudPath) {
  const data = metadata && metadata.data || {};
  return { url: data.url, token: data.token, authorization: data.authorization, file_id: data.fileId, cos_file_id: data.cosFileId, cloud_path: cloudPath };
}

async function beginTeacherStarEvidenceUpload(event, teacher) {
  const requestId = text(event.request_id);
  const mimeType = text(event.mime_type).toLowerCase();
  const sizeBytes = Number(event.size_bytes || 0);
  const extension = starEvidenceExtension(mimeType);
  if (!requestId) throw new Error("CASH_REQUEST_REQUIRED");
  if (!extension || !Number.isFinite(sizeBytes) || sizeBytes < 1 || sizeBytes > starRewards.MAX_EVIDENCE_BYTES) {
    throw new Error("EVIDENCE_FILE_INVALID");
  }
  const request = await getOne(STAR_REQUEST_COLLECTION, { request_id: requestId });
  if (!request) throw new Error("CASH_REQUEST_NOT_FOUND");
  if (!starRewards.isOpenRequest(request) && !["completed", "refunded"].includes(request.status)) {
    throw new Error("CASH_REQUEST_EVIDENCE_CLOSED");
  }
  const evidenceRows = await getAll(STAR_EVIDENCE_COLLECTION, { where: { request_id: requestId } });
  if (evidenceRows.filter((item) => ["uploading", "active"].includes(item.status)).length >= starRewards.EVIDENCE_LIMIT) {
    throw new Error("EVIDENCE_LIMIT_REACHED");
  }
  const evidenceId = randomStarRecordId("evidence");
  const root = `star-redemptions/${request.student_uid}/${requestId}/${evidenceId}`;
  const originalCloudPath = `${root}/original.${extension}`;
  const displayCloudPath = `${root}/display.jpg`;
  const [originalMetadata, displayMetadata] = await Promise.all([
    app.getUploadMetadata({ cloudPath: originalCloudPath }),
    app.getUploadMetadata({ cloudPath: displayCloudPath }),
  ]);
  const now = new Date();
  await db.collection(STAR_EVIDENCE_COLLECTION).add({
    evidence_id: evidenceId,
    request_id: requestId,
    student_uid: request.student_uid,
    uploader_uid: teacher.auth_uid,
    uploader_role: "teacher",
    status: "uploading",
    original_file_id: originalMetadata.data.fileId,
    display_file_id: displayMetadata.data.fileId,
    original_name: text(event.file_name || "image").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120),
    mime_type: mimeType,
    expected_size_bytes: sizeBytes,
    upload_expires_at: new Date(now.getTime() + starRewards.UPLOAD_TTL_MS),
    created_at: now,
    updated_at: now,
  });
  return { success: true, evidence_id: evidenceId, original_upload: starUploadMetadataView(originalMetadata, originalCloudPath), display_upload: starUploadMetadataView(displayMetadata, displayCloudPath) };
}

function starFileInfoFor(result, fileId) {
  return (result && result.fileList || []).find((item) => item.fileID === fileId) || null;
}

async function finishTeacherStarEvidenceUpload(event, teacher) {
  const evidenceId = text(event.evidence_id);
  const evidence = await getOne(STAR_EVIDENCE_COLLECTION, { evidence_id: evidenceId, uploader_uid: teacher.auth_uid });
  if (!evidence) throw new Error("EVIDENCE_NOT_FOUND");
  if (evidence.status === "active") return { success: true };
  if (evidence.status !== "uploading" || new Date(evidence.upload_expires_at || 0).getTime() < Date.now()) throw new Error("EVIDENCE_UPLOAD_EXPIRED");
  const info = await app.getFileInfo({ fileList: [evidence.original_file_id, evidence.display_file_id] });
  const original = starFileInfoFor(info, evidence.original_file_id);
  const display = starFileInfoFor(info, evidence.display_file_id);
  if (!original || !display || Number(original.size || 0) < 1 || Number(original.size || 0) > starRewards.MAX_EVIDENCE_BYTES
    || Number(display.size || 0) < 1 || Number(display.size || 0) > starRewards.DISPLAY_EVIDENCE_BYTES) throw new Error("EVIDENCE_UPLOAD_INVALID");
  const now = new Date();
  await db.collection(STAR_EVIDENCE_COLLECTION).doc(evidence._id).update({ status: "active", size_bytes: Number(original.size || 0), display_size_bytes: Number(display.size || 0), uploaded_at: now, updated_at: now });
  const request = await getOne(STAR_REQUEST_COLLECTION, { request_id: evidence.request_id });
  const rows = await getAll(STAR_EVIDENCE_COLLECTION, { where: { request_id: evidence.request_id } });
  const count = rows.filter((item) => item.status === "active" || item.evidence_id === evidenceId).length;
  const update = { evidence_count: count, updated_at: now };
  if (request && starRewards.isOpenRequest(request)) update.status = "awaiting_teacher";
  if (request) await db.collection(STAR_REQUEST_COLLECTION).doc(request._id).update(update);
  return { success: true };
}

async function getTeacherStarEvidence(event) {
  const requestId = text(event.request_id);
  if (!await getOne(STAR_REQUEST_COLLECTION, { request_id: requestId })) throw new Error("CASH_REQUEST_NOT_FOUND");
  const evidence = (await getAll(STAR_EVIDENCE_COLLECTION, { where: { request_id: requestId } }))
    .filter((item) => item.status === "active" || item.status === "superseded")
    .sort((left, right) => attemptDateValue(left) - attemptDateValue(right));
  if (!evidence.length) return { success: true, evidence: [] };
  const urls = await app.getTempFileURL({ fileList: evidence.map((item) => ({ fileID: item.display_file_id || item.original_file_id, maxAge: 600 })) });
  const urlMap = new Map((urls.fileList || []).map((item) => [item.fileID, item.tempFileURL]));
  return { success: true, evidence: evidence.map((item) => ({
    evidence_id: item.evidence_id || item._id,
    uploader_role: item.uploader_role,
    status: item.status,
    original_name: item.original_name,
    uploaded_at: item.uploaded_at || item.created_at || null,
    url: urlMap.get(item.display_file_id || item.original_file_id) || "",
  })) };
}

async function supersedeStarEvidence(event, teacher) {
  const evidence = await getOne(STAR_EVIDENCE_COLLECTION, { evidence_id: text(event.evidence_id) });
  if (!evidence) throw new Error("EVIDENCE_NOT_FOUND");
  if (evidence.status === "superseded") return { success: true };
  if (evidence.status !== "active") throw new Error("EVIDENCE_NOT_ACTIVE");
  const now = new Date();
  await db.collection(STAR_EVIDENCE_COLLECTION).doc(evidence._id).update({ status: "superseded", superseded_at: now, superseded_by_teacher_uid: teacher.auth_uid, updated_at: now });
  const request = await getOne(STAR_REQUEST_COLLECTION, { request_id: evidence.request_id });
  const rows = await getAll(STAR_EVIDENCE_COLLECTION, { where: { request_id: evidence.request_id } });
  const count = rows.filter((item) => item.status === "active" && item.evidence_id !== evidence.evidence_id).length;
  if (request) {
    const update = { evidence_count: count, updated_at: now };
    if (starRewards.isOpenRequest(request) && count === 0) update.status = "awaiting_proof";
    await db.collection(STAR_REQUEST_COLLECTION).doc(request._id).update(update);
  }
  return { success: true };
}

async function migrateStarRewards(event, teacher) {
  const apply = event.apply === true;
  const rows = await getAll("student_set_achievements");
  const blueKeys = new Set(rows.filter(starRewards.isBlueAchievement).map((item) => `${item.student_uid}::${item.set_id}`));
  const report = { total: rows.length, yellow: 0, blue: 0, converted_blue_created: 0, credits_created: 0, apply };
  for (const achievement of rows) {
    if (starRewards.isYellowAchievement(achievement)) {
      report.yellow += 1;
      const yellowId = starRewards.achievementId(achievement);
      const existingCredit = await getOne(STAR_LEDGER_COLLECTION, { ledger_id: `credit::${yellowId}` });
      if (!existingCredit) {
        report.credits_created += 1;
        if (apply) await db.collection(STAR_LEDGER_COLLECTION).add(starRewards.ledgerEntry({ ledgerId: `credit::${yellowId}`, studentUid: achievement.student_uid, achievementIds: [yellowId], entryType: "credit", actorUid: teacher.auth_uid, reason: "Legacy Yellow STAR migration", createdAt: achievement.first_earned_at || achievement.created_at || new Date() }));
      }
      if (apply && achievement._id) await db.collection("student_set_achievements").doc(achievement._id).update({ star_type: "yellow", protected: true, reward_eligible: true, status: "star", updated_at: new Date() });
      if (achievement.converted_from_self_study) {
        const blueKey = `${achievement.student_uid}::${achievement.set_id}`;
        if (!blueKeys.has(blueKey)) {
          report.converted_blue_created += 1;
          const blueId = starRewards.blueAchievementId(achievement.student_uid, achievement.set_id);
          if (apply) {
            await db.collection("student_set_achievements").add({ achievement_id: blueId, student_uid: achievement.student_uid, student_id_snapshot: achievement.student_id_snapshot || "", set_id: achievement.set_id, assignment_id: null, star_type: "blue", status: "converted", protected: false, reward_eligible: false, source: "self_study", first_earned_at: achievement.first_earned_at || achievement.created_at || new Date(), best_attempt_id: achievement.best_attempt_id || null, best_percentage: Number(achievement.best_percentage || 0), converted_to_achievement_id: yellowId, converted_at: achievement.converted_at || achievement.claimed_at || achievement.updated_at || new Date(), created_at: new Date(), updated_at: new Date() });
            await db.collection("student_set_achievements").doc(achievement._id).update({ converted_from_achievement_id: blueId, updated_at: new Date() });
          }
          blueKeys.add(blueKey);
        }
      }
    } else if (starRewards.isBlueAchievement(achievement)) {
      report.blue += 1;
      if (apply && achievement._id) await db.collection("student_set_achievements").doc(achievement._id).update({ star_type: "blue", status: achievement.status === "converted" ? "converted" : "active", protected: false, reward_eligible: false, updated_at: new Date() });
    }
  }
  return { success: true, report };
}

async function lexiconByNormalizedWords(words) {
  const values = Array.from(new Set((words || []).filter(Boolean)));
  const output = {};
  const command = db.command;
  for (let index = 0; index < values.length; index += 10) {
    const result = await db.collection(LEXICON_COLLECTION).where({
      normalized_word: command.in(values.slice(index, index + 10)),
    }).limit(100).get();
    (result.data || []).forEach((item) => { output[item.normalized_word] = item; });
  }
  return output;
}

async function getStudentVocabulary(event) {
  const authUid = text(event.auth_uid);
  const student = await getOne("students", { auth_uid: authUid });
  if (!student || isDeletedStudent(student) || student.role === "teacher") throw new Error("STUDENT_NOT_FOUND");
  const items = await getAll(VOCAB_ITEM_COLLECTION, { where: { student_uid: authUid }, orderBy: { field: "updated_at", direction: "desc" } });
  const lexicon = await lexiconByNormalizedWords(items.map((item) => item.normalized_text));
  return {
    success: true,
    student: studentView(student),
    words: items.map((item) => vocabularyItemTeacherView(item, lexicon[item.normalized_text])),
  };
}

async function getStudentStarSources(event) {
  const authUid = text(event.auth_uid);
  const student = await getOne("students", { auth_uid: authUid });
  if (!student || isDeletedStudent(student) || student.role === "teacher") throw new Error("STUDENT_NOT_FOUND");
  const achievementRows = await getAll("student_set_achievements", { where: { student_uid: authUid } });
  const buckets = starRewards.normalizedStarBuckets(achievementRows.map(recordData));
  const achievements = buckets.yellowStars.concat(buckets.blueStars);
  const setIds = Array.from(new Set(achievements.map((item) => text(item.set_id)).filter(Boolean)));
  const setMap = new Map();
  const command = db.command;
  for (let index = 0; index < setIds.length; index += 10) {
    const result = await db.collection("sets").where({
      set_id: command.in(setIds.slice(index, index + 10)),
    }).limit(100).get();
    (result.data || []).map(recordData).forEach((set) => setMap.set(set.set_id, set));
  }
  const stars = achievements.map((achievement) => {
    const assignmentId = achievement.assignment_id || null;
    const set = setMap.get(achievement.set_id) || {};
    return {
      achievement_id: achievement.achievement_id || achievement._id,
      star_type: starRewards.isYellowAchievement(achievement) ? "yellow" : "blue",
      source: achievement.source || (assignmentId ? "assignment_claim" : "self_study"),
      status: achievement.status || (assignmentId ? "star" : "active"),
      set_id: achievement.set_id,
      set_title: set.title || achievement.set_id,
      assignment_id: assignmentId,
      earned_at: achievement.first_earned_at || achievement.claimed_at || achievement.created_at || null,
      best_percentage: achievement.best_percentage == null ? null : Number(achievement.best_percentage),
      converted_at: achievement.converted_at || null,
      converted_to_achievement_id: achievement.converted_to_achievement_id || null,
    };
  }).sort((left, right) => new Date(right.earned_at || 0) - new Date(left.earned_at || 0));
  return { success: true, student: studentView(student), stars };
}

async function listDictionaryWorkspace() {
  const [items, lexiconRows, reports] = await Promise.all([
    getAll(VOCAB_ITEM_COLLECTION, { where: { status: "active" } }),
    getAll(LEXICON_COLLECTION, { orderBy: { field: "updated_at", direction: "desc" } }),
    getAll(DICTIONARY_REPORT_COLLECTION, { where: { status: "open" }, orderBy: { field: "updated_at", direction: "desc" } }).catch(() => []),
  ]);
  const lexicon = {};
  lexiconRows.forEach((item) => { lexicon[item.normalized_word] = item; });
  const aggregates = {};
  items.forEach((item) => {
    const key = item.normalized_text;
    if (!key) return;
    if (!aggregates[key]) aggregates[key] = { student_uids: new Set(), first_seen_at: item.created_at, last_seen_at: item.activity_updated_at || item.last_added_at || item.updated_at };
    aggregates[key].student_uids.add(item.student_uid);
    const first = new Date(aggregates[key].first_seen_at || 0).getTime();
    const created = new Date(item.created_at || 0).getTime();
    if (!first || (created && created < first)) aggregates[key].first_seen_at = item.created_at;
    const last = new Date(aggregates[key].last_seen_at || 0).getTime();
    const nextLast = item.activity_updated_at || item.last_added_at || item.updated_at;
    if (new Date(nextLast || 0).getTime() > last) aggregates[key].last_seen_at = nextLast;
  });
  const reportsByWord = reports.reduce((map, report) => {
    const key = report.normalized_word || "";
    if (!map[key]) map[key] = [];
    map[key].push({ report_id: report._id, reason: report.reason || "", student_id_snapshot: report.student_id_snapshot || "", created_at: report.created_at || null });
    return map;
  }, {});
  const words = Array.from(new Set([...Object.keys(aggregates), ...Object.keys(lexicon)])).map((key) => {
    const shared = lexicon[key];
    const aggregate = aggregates[key] || { student_uids: new Set() };
    const reportItems = reportsByWord[key] || [];
    let category = "reviewed";
    if (!shared) category = "missing";
    else if (reportItems.length) category = "reported";
    else if (shared.review_status === "ai_draft" || shared.source_type === "ai_draft") category = "ai_drafts";
    return {
      normalized_word: key,
      word: shared && shared.word || key,
      category,
      student_count: aggregate.student_uids.size,
      first_seen_at: aggregate.first_seen_at || null,
      last_seen_at: aggregate.last_seen_at || null,
      reports: reportItems,
      dictionary: lexiconPublicView(shared),
    };
  }).sort((a, b) => String(a.word).localeCompare(String(b.word)));
  return { success: true, words };
}

function dictionaryPayload(event, normalizedWord) {
  const senses = (Array.isArray(event.senses) ? event.senses : []).slice(0, 8).map((sense) => ({
    part_of_speech: compact(sense.part_of_speech, 80),
    english_definition: compact(sense.english_definition, 500),
    chinese_meaning: compact(sense.chinese_meaning, 300),
  })).filter((sense) => sense.english_definition || sense.chinese_meaning);
  const englishDefinition = compact(event.english_definition || (senses[0] && senses[0].english_definition), 500);
  const chineseMeaning = compact(event.chinese_meaning || (senses[0] && senses[0].chinese_meaning), 300);
  if (!englishDefinition || !chineseMeaning) throw new Error("DICTIONARY_FIELDS_REQUIRED");
  return {
    word: compact(event.word || normalizedWord, 120),
    normalized_word: normalizedWord,
    phonetic: compact(event.phonetic, 120),
    part_of_speech: compact(event.part_of_speech || (senses[0] && senses[0].part_of_speech), 120),
    english_definition: englishDefinition,
    chinese_meaning: chineseMeaning,
    word_forms: compact(event.word_forms, 300),
    senses,
  };
}

async function saveDictionaryEntry(event, teacher) {
  const normalizedWord = normalized(event.normalized_word || event.word).slice(0, 160);
  if (!normalizedWord) throw new Error("DICTIONARY_WORD_REQUIRED");
  const payload = dictionaryPayload(event, normalizedWord);
  const existing = await getOne(LEXICON_COLLECTION, { normalized_word: normalizedWord });
  const now = new Date();
  if (existing) {
    await db.collection(LEXICON_HISTORY_COLLECTION).add({
      lexicon_id: existing.lexicon_id || existing._id,
      normalized_word: normalizedWord,
      before: lexiconPublicView(existing),
      changed_by_teacher_uid: teacher.auth_uid,
      changed_at: now,
    });
    await db.collection(LEXICON_COLLECTION).doc(existing._id).update({
      ...payload,
      source_type: "teacher",
      source_name: "Mr. Cat Academy teacher",
      sources: ["Mr. Cat Academy teacher"],
      verified: true,
      review_status: "reviewed",
      reviewed_by_teacher_uid: teacher.auth_uid,
      reviewed_at: now,
      updated_at: now,
    });
  } else {
    const crypto = require("crypto");
    await db.collection(LEXICON_COLLECTION).add({
      ...payload,
      lexicon_id: `lex_${crypto.createHash("sha256").update(normalizedWord).digest("hex").slice(0, 32)}`,
      source_type: "teacher",
      source_name: "Mr. Cat Academy teacher",
      sources: ["Mr. Cat Academy teacher"],
      verified: true,
      review_status: "reviewed",
      reviewed_by_teacher_uid: teacher.auth_uid,
      reviewed_at: now,
      created_at: now,
      updated_at: now,
    });
  }
  const openReports = await getAll(DICTIONARY_REPORT_COLLECTION, { where: { normalized_word: normalizedWord, status: "open" } }).catch(() => []);
  for (const report of openReports) {
    await db.collection(DICTIONARY_REPORT_COLLECTION).doc(report._id).update({ status: "resolved", resolved_at: now, resolved_by_teacher_uid: teacher.auth_uid, updated_at: now });
  }
  return { success: true, dictionary: lexiconPublicView(await getOne(LEXICON_COLLECTION, { normalized_word: normalizedWord })) };
}

function jsonFromTeacherAi(value) {
  const source = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI_RESPONSE_INVALID");
  return JSON.parse(source.slice(start, end + 1));
}

async function draftDictionaryWithAi(event) {
  const word = compact(event.word || event.normalized_word, 120);
  if (!word) throw new Error("DICTIONARY_WORD_REQUIRED");
  const url = text(process.env.VOCAB_AI_API_URL);
  const key = text(process.env.VOCAB_AI_API_KEY);
  const model = text(process.env.VOCAB_AI_MODEL);
  if (!url || !key || !model || !/^https:\/\//i.test(url)) throw new Error("AI_NOT_CONFIGURED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_LOOKUP_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: "Create a concise learner dictionary entry. Return JSON only with word, phonetic, part_of_speech, english_definition, chinese_meaning, word_forms, and senses (up to 3 objects). No markdown." },
          { role: "user", content: `Word or phrase: ${word}` },
        ],
      }),
    });
  } catch (_error) {
    throw new Error("AI_LOOKUP_FAILED");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`AI_HTTP_${response.status}`);
  const payload = await response.json();
  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
  const draft = jsonFromTeacherAi(content);
  return { success: true, draft: dictionaryPayload(draft, normalized(word)) };
}

exports.main = async (event) => {
  try {
    const teacher = await getAuthenticatedTeacher();
    const action = text(event.action);
    if (action === "listStudents") return await listStudents();
    if (action === "listClasses") return await listClasses();
    if (action === "createStudent") return await createStudent(event, teacher);
    if (action === "updateStudent") return await updateStudent(event, teacher);
    if (action === "backfillLearningReportModel") return await backfillLearningReportModel(event, teacher);
    if (action === "deleteStudentAccount") return await deleteStudentAccount(event, teacher);
    if (action === "resetStudentPassword") return await resetStudentPassword(event, teacher);
    if (action === "listSets") return await listSets();
    if (action === "getAssignmentCandidates") return await getAssignmentCandidates(event);
    if (action === "createAssignments") return await createAssignments(event, teacher);
    if (action === "updateAssignments") return await updateAssignments(event, teacher);
    if (action === "cancelAssignments") return await cancelAssignments(event, teacher);
    if (action === "getAnswerKeyForSet") return await getAnswerKeyForSet(event);
    if (action === "listAssignments") return await listAssignments();
    if (action === "listProgress") return await listProgress();
    if (action === "listAttempts") return await listAttempts();
    if (action === "getAttemptDetail") return await getAttemptDetail(event);
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
    if (action === "listStarRedemptions") return await listStarRedemptions(teacher);
    if (action === "confirmStarRedemption") return await transitionStarRequest(text(event.request_id), "completed", teacher, event.reason);
    if (action === "rejectStarRedemption") return await transitionStarRequest(text(event.request_id), "rejected", teacher, event.reason);
    if (action === "refundStarRedemption") return await transitionStarRequest(text(event.request_id), "refunded", teacher, event.reason);
    if (action === "beginStarEvidenceUpload") return await beginTeacherStarEvidenceUpload(event, teacher);
    if (action === "finishStarEvidenceUpload") return await finishTeacherStarEvidenceUpload(event, teacher);
    if (action === "getStarEvidence") return await getTeacherStarEvidence(event);
    if (action === "supersedeStarEvidence") return await supersedeStarEvidence(event, teacher);
    if (action === "migrateStarRewards") return await migrateStarRewards(event, teacher);
    if (action === "getStudentStarSources") return await getStudentStarSources(event);
    if (action === "getStudentVocabulary") return await getStudentVocabulary(event);
    if (action === "listDictionaryWorkspace") return await listDictionaryWorkspace();
    if (action === "saveDictionaryEntry") return await saveDictionaryEntry(event, teacher);
    if (action === "draftDictionaryWithAi") return await draftDictionaryWithAi(event);
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
          : error.message === "STUDENT_NOT_FOUND"
            ? "This student profile was not found."
          : error.message === "DICTIONARY_FIELDS_REQUIRED"
            ? "Chinese meaning and English definition are required."
          : error.message === "DICTIONARY_WORD_REQUIRED"
            ? "A word or phrase is required."
          : error.message === "AI_NOT_CONFIGURED"
            ? "AI dictionary help is not configured yet."
          : error.message === "AI_LOOKUP_FAILED" || error.message === "AI_RESPONSE_INVALID" || /^AI_HTTP_/.test(error.message || "")
            ? "AI dictionary help is unavailable right now."
          : error.message === "CASH_EVIDENCE_REQUIRED"
            ? "At least one active proof photo is required before confirmation."
          : error.message === "STAR_DECISION_REASON_REQUIRED"
            ? "Enter a reason for this decision."
          : error.message === "EVIDENCE_LIMIT_REACHED"
            ? "A Cash request can keep up to three active photos."
          : error.message === "EVIDENCE_FILE_INVALID"
            ? "Choose a JPG, PNG, or WebP photo up to 10 MB."
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
