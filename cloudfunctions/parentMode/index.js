"use strict";

const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");
const parentRules = require("../_shared/parent-mode");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const _ = db.command;
const SESSION_COLLECTION = "parent_view_sessions";
const READ_PAGE_LIMIT = 500;
const QUERY_CHUNK_SIZE = 100;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 8;

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function recordData(record) {
  return record && record.data && typeof record.data === "object" ? record.data : record || {};
}

function isCancelled(assignment) {
  return ["cancelled", "canceled"].includes(parentRules.text(assignment && assignment.status).toLowerCase());
}

function isBbcSet(set) {
  if (/^BBC-/i.test(parentRules.text(set && set.set_id))) return true;
  return [set && set.section_id, set && set.section, set && set.type, set && set.course, set && set.category]
    .some((value) => ["bbc", "bbc-six-minute-english"].includes(parentRules.text(value).toLowerCase()));
}

function isVocabularySet(set) {
  return [set && set.section_id, set && set.section, set && set.type, set && set.course, set && set.category]
    .some((value) => parentRules.text(value).toLowerCase() === "vocabulary");
}

function passingForSet(set) {
  if (set && set.passing_percentage != null) return Number(set.passing_percentage);
  if (isVocabularySet(set)) return 90;
  if (isBbcSet(set)) return 80;
  return 50;
}

function masteryForSet(set) {
  if (set && set.mastery_percentage != null) return Number(set.mastery_percentage);
  if (isVocabularySet(set)) return 100;
  if (isBbcSet(set)) return 95;
  return 90;
}

function passingForAssignment(assignment, set) {
  return Number(assignment && assignment.passing_percentage != null
    ? assignment.passing_percentage
    : passingForSet(set));
}

function masteryForAssignment(assignment, set) {
  return Number(assignment && assignment.mastery_percentage != null
    ? assignment.mastery_percentage
    : masteryForSet(set));
}

function scoreLockForAssignment(assignment) {
  return assignment && (assignment.mastery_locked_at || assignment.answer_revealed_at) || null;
}

function displayNames(student, membership) {
  const source = recordData(student);
  const member = recordData(membership);
  const chinese = parentRules.text(source.chinese_name || member.chinese_name_snapshot);
  const english = parentRules.text(source.english_name || member.english_name_snapshot);
  const fallback = parentRules.text(source.name || member.student_name_snapshot);
  return {
    chinese_name: chinese,
    english_name: english,
    display_name: [chinese, english].filter(Boolean).join(" ") || fallback || "Student",
  };
}

async function getAll(collection, options = {}) {
  const pageSize = Math.min(Math.max(Number(options.pageSize || READ_PAGE_LIMIT), 1), READ_PAGE_LIMIT);
  let offset = 0;
  const output = [];
  while (true) {
    let query = db.collection(collection);
    if (options.where) query = query.where(options.where);
    if (options.orderBy) query = query.orderBy(options.orderBy.field, options.orderBy.direction || "asc");
    const result = await query.skip(offset).limit(pageSize).get();
    const rows = (result.data || []).map(recordData);
    output.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return output;
}

async function getOne(collection, where) {
  const result = await db.collection(collection).where(where).limit(1).get();
  return result.data && result.data[0] ? recordData(result.data[0]) : null;
}

async function getByFieldIn(collection, field, values) {
  const unique = [...new Set((values || []).map(parentRules.text).filter(Boolean))];
  if (!unique.length) return [];
  const pages = [];
  for (let index = 0; index < unique.length; index += QUERY_CHUNK_SIZE) {
    pages.push(getAll(collection, {
      where: { [field]: _.in(unique.slice(index, index + QUERY_CHUNK_SIZE)) },
      pageSize: QUERY_CHUNK_SIZE,
    }));
  }
  return (await Promise.all(pages)).flat();
}

function clientDeviceId(event) {
  return parentRules.text(event && event._client_device_id).slice(0, 160);
}

function sourceIp() {
  try {
    const context = typeof cloudbase.getCloudbaseContext === "function"
      ? cloudbase.getCloudbaseContext()
      : {};
    return parentRules.text(context && (context.TCB_SOURCE_IP || context.WX_CLIENTIP || context.WX_CLIENTIPV6));
  } catch (_error) {
    return "";
  }
}

function deviceHash(event) {
  return hash(clientDeviceId(event));
}

function guardKey(event) {
  return hash(`${sourceIp()}::${clientDeviceId(event)}`);
}

async function loginGuard(event) {
  const key = guardKey(event);
  const guard = await getOne(SESSION_COLLECTION, { record_type: "login_guard", guard_key: key });
  const now = Date.now();
  if (guard && parentRules.dateValue(guard.blocked_until) > now) throw new Error("PARENT_LOGIN_COOLDOWN");
  return { key, guard };
}

async function recordFailedLogin(key, current) {
  const now = new Date();
  const inWindow = current && now.getTime() - parentRules.dateValue(current.window_started_at) < LOGIN_WINDOW_MS;
  const failures = inWindow ? Number(current.failure_count || 0) + 1 : 1;
  const update = {
    record_type: "login_guard",
    guard_key: key,
    failure_count: failures,
    window_started_at: inWindow ? current.window_started_at : now,
    blocked_until: failures >= LOGIN_FAILURE_LIMIT ? new Date(now.getTime() + LOGIN_BLOCK_MS) : null,
    updated_at: now,
  };
  if (current && current._id) await db.collection(SESSION_COLLECTION).doc(current._id).update(update);
  else await db.collection(SESSION_COLLECTION).add({ ...update, created_at: now });
}

async function clearLoginGuard(key, current) {
  if (!current || !current._id) return;
  await db.collection(SESSION_COLLECTION).doc(current._id).update({
    failure_count: 0,
    blocked_until: null,
    window_started_at: new Date(),
    updated_at: new Date(),
  });
}

async function findStudentByNames(chineseName, englishName) {
  const chinese = parentRules.normalizeChineseName(chineseName);
  const english = parentRules.normalizeEnglishName(englishName);
  if (!chinese || !english || chinese.length > 120 || english.length > 160) return null;
  const matches = await getAll("students", {
    where: { chinese_name: chinese, active: true, role: "student" },
    pageSize: 20,
  });
  const exact = matches.filter((student) =>
    parentRules.normalizeChineseName(student.chinese_name) === chinese
    && parentRules.normalizeEnglishName(student.english_name) === english
    && student.deleted_at == null
  );
  return exact.length === 1 ? exact[0] : null;
}

async function createSession(student, event) {
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + parentRules.SESSION_TTL_MS);
  await db.collection(SESSION_COLLECTION).add({
    record_type: "parent_session",
    session_id: `parent-session-${crypto.randomUUID()}`,
    token_hash: hash(token),
    student_uid: student.auth_uid,
    device_hash: deviceHash(event),
    status: "active",
    expires_at: expiresAt,
    created_at: now,
    last_used_at: now,
    updated_at: now,
  });
  return { token, expiresAt };
}

async function login(event) {
  const guard = await loginGuard(event);
  const student = await findStudentByNames(event.chinese_name, event.english_name);
  if (!student) {
    await recordFailedLogin(guard.key, guard.guard);
    throw new Error("PARENT_STUDENT_MISMATCH");
  }
  await clearLoginGuard(guard.key, guard.guard);
  const session = await createSession(student, event);
  return {
    success: true,
    session_token: session.token,
    expires_at: session.expiresAt,
    student: displayNames(student),
  };
}

async function requireSession(event) {
  const token = parentRules.text(event && event.session_token);
  if (token.length < 32 || token.length > 256) throw new Error("PARENT_SESSION_REQUIRED");
  const session = await getOne(SESSION_COLLECTION, {
    record_type: "parent_session",
    token_hash: hash(token),
    status: "active",
  });
  if (!session || session.device_hash !== deviceHash(event)) throw new Error("PARENT_SESSION_INVALID");
  if (parentRules.dateValue(session.expires_at) <= Date.now()) {
    if (session._id) await db.collection(SESSION_COLLECTION).doc(session._id).update({
      status: "expired",
      updated_at: new Date(),
    });
    throw new Error("PARENT_SESSION_EXPIRED");
  }
  const student = await getOne("students", {
    auth_uid: session.student_uid,
    active: true,
    role: "student",
  });
  if (!student || student.deleted_at != null) throw new Error("PARENT_STUDENT_UNAVAILABLE");
  if (session._id) await db.collection(SESSION_COLLECTION).doc(session._id).update({
    last_used_at: new Date(),
    updated_at: new Date(),
  });
  return { session, student };
}

function groupAttemptsBySet(attempts) {
  const output = new Map();
  (attempts || []).forEach((attempt) => {
    const setId = parentRules.text(attempt && attempt.set_id);
    if (!setId || !parentRules.countableAttempt(attempt)) return;
    const rows = output.get(setId) || [];
    rows.push(attempt);
    output.set(setId, rows);
  });
  return output;
}

function storedAssignmentFallback(assignment, summary, passing, mastery) {
  if (summary.has_attempt || assignment.best_percentage == null && assignment.latest_percentage == null) return summary;
  const best = Number(assignment.best_percentage == null ? assignment.latest_percentage : assignment.best_percentage);
  const qualified = best >= passing || ["passed", "mastered", "done"].includes(parentRules.text(assignment.status));
  const mastered = assignment.mastery_enabled === true
    && (best >= mastery || parentRules.text(assignment.status) === "mastered");
  return {
    ...summary,
    has_attempt: true,
    attempt_count: Number(assignment.attempt_count || 0),
    best_percentage: best,
    latest_percentage: assignment.latest_percentage == null ? best : Number(assignment.latest_percentage),
    best_attempt_id: assignment.best_attempt_id || null,
    latest_attempt_id: assignment.latest_attempt_id || null,
    status: qualified ? "qualified" : "not_qualified",
    qualified,
    mastered,
    completed_at: assignment.completed_at || null,
  };
}

function assignmentView(assignment, set, attempts, now) {
  const passing = passingForAssignment(assignment, set);
  const mastery = masteryForAssignment(assignment, set);
  let summary = parentRules.attemptSummary(attempts, {
    passing_percentage: passing,
    mastery_percentage: mastery,
    mastery_enabled: assignment.mastery_enabled === true,
    score_locked_at: scoreLockForAssignment(assignment),
  });
  summary = storedAssignmentFallback(assignment, summary, passing, mastery);
  const dueAt = assignment.due_at || assignment.assigned_at || assignment.created_at || null;
  const parentStatus = summary.has_attempt ? summary.status : "unsubmitted";
  const categories = parentRules.assignmentCategories({ parent_status: parentStatus, due_at: dueAt }, now);
  return {
    assignment_id: assignment.assignment_id || assignment._id,
    set_id: assignment.set_id,
    source: "assigned",
    title: parentRules.text(set && set.title) || parentRules.text(assignment.set_id),
    due_at: dueAt,
    created_at: assignment.created_at || null,
    completed_at: summary.completed_at || assignment.completed_at || null,
    status: parentStatus,
    categories,
    best_percentage: summary.best_percentage,
    latest_percentage: summary.latest_percentage,
    attempt_count: summary.attempt_count,
    passing_percentage: passing,
    mastery_percentage: mastery,
    mastery_enabled: assignment.mastery_enabled === true,
    mastered: summary.mastered,
    answer_revealed: assignment.answer_revealed === true,
    score_locked: Boolean(scoreLockForAssignment(assignment)),
    assignment_scope: assignment.assignment_scope || "individual",
  };
}

function selfStudyView(set, attempts) {
  const passing = passingForSet(set);
  const mastery = masteryForSet(set);
  const summary = parentRules.attemptSummary(attempts, {
    passing_percentage: passing,
    mastery_percentage: mastery,
    mastery_enabled: true,
  });
  if (!summary.qualified) return null;
  return {
    assignment_id: null,
    set_id: set.set_id,
    source: "self_study",
    title: parentRules.text(set.title) || set.set_id,
    due_at: null,
    completed_at: summary.completed_at,
    status: "qualified",
    categories: ["completed"],
    best_percentage: summary.best_percentage,
    latest_percentage: summary.latest_percentage,
    attempt_count: summary.attempt_count,
    passing_percentage: passing,
    mastery_percentage: mastery,
    mastery_enabled: true,
    mastered: summary.mastered,
    answer_revealed: false,
    score_locked: false,
  };
}

async function overview(student) {
  const [assignmentRows, attempts] = await Promise.all([
    getAll("assignments", { where: { student_uid: student.auth_uid } }),
    getAll("attempts", { where: { student_uid: student.auth_uid } }),
  ]);
  const assignments = assignmentRows.filter((assignment) => !isCancelled(assignment));
  const setIds = [...new Set(assignments.map((item) => item.set_id)
    .concat(attempts.map((item) => item.set_id)).filter(Boolean))];
  const sets = await getByFieldIn("sets", "set_id", setIds);
  const setById = new Map(sets.filter((set) => set.visible !== false).map((set) => [set.set_id, set]));
  const attemptsBySet = groupAttemptsBySet(attempts);
  const now = new Date();
  const taskViews = assignments.filter((assignment) => setById.has(assignment.set_id)).map((assignment) =>
    assignmentView(assignment, setById.get(assignment.set_id), attemptsBySet.get(assignment.set_id) || [], now)
  );
  const assignedSetIds = new Set(assignments.map((assignment) => parentRules.text(assignment.set_id)));
  const selfStudy = [];
  attemptsBySet.forEach((setAttempts, setId) => {
    if (assignedSetIds.has(setId) || !setById.has(setId)) return;
    const unassigned = setAttempts.filter((attempt) => !attempt.assignment_id);
    const view = selfStudyView(setById.get(setId), unassigned);
    if (view) selfStudy.push(view);
  });
  taskViews.sort((left, right) => parentRules.dateValue(left.due_at) - parentRules.dateValue(right.due_at));
  selfStudy.sort((left, right) => parentRules.dateValue(right.completed_at) - parentRules.dateValue(left.completed_at));
  return {
    success: true,
    student: displayNames(student),
    tasks: taskViews,
    self_study: selfStudy,
    generated_at: now,
  };
}

async function membershipsForStudent(studentUid) {
  return getAll("class_memberships", { where: { student_uid: studentUid } });
}

function membershipForPeriod(memberships, period, cutoffAt) {
  return (memberships || []).filter((membership) =>
    parentRules.membershipOverlaps(membership, period, cutoffAt)
  ).sort((left, right) =>
    parentRules.dateValue(right.started_at || right.created_at) - parentRules.dateValue(left.started_at || left.created_at)
  )[0] || null;
}

function dueInPeriod(assignment, period) {
  const due = parentRules.dateValue(assignment && assignment.due_at);
  return due >= parentRules.dateValue(period.start_at) && due <= parentRules.dateValue(period.end_at);
}

async function classMatrix(student, event) {
  const now = new Date();
  const period = parentRules.periodForScope(event.scope, now, event.month_key);
  const cutoffAt = new Date(Math.min(now.getTime(), parentRules.dateValue(period.end_at)));
  const ownMemberships = await membershipsForStudent(student.auth_uid);
  const ownMembership = membershipForPeriod(ownMemberships, period, cutoffAt);
  if (!ownMembership) return { success: true, class: null, period, tasks: [], students: [], history_months: [] };
  const classId = parentRules.text(ownMembership.class_id);
  const [classRecord, memberships, assignmentRows] = await Promise.all([
    getOne("classes", { class_id: classId }),
    getAll("class_memberships", { where: { class_id: classId } }),
    getAll("assignments", { where: { class_id: classId } }),
  ]);
  const periodMemberships = memberships.filter((membership) =>
    parentRules.membershipOverlaps(membership, period, cutoffAt)
  );
  const studentUids = [...new Set(periodMemberships.map((membership) => parentRules.text(membership.student_uid)).filter(Boolean))];
  const students = await getByFieldIn("students", "auth_uid", studentUids);
  const studentByUid = new Map(students.map((profile) => [parentRules.text(profile.auth_uid), profile]));
  const currentPeriod = parentRules.dateValue(period.end_at) >= now.getTime();
  const visibleMemberships = periodMemberships.filter((membership) => {
    const profile = studentByUid.get(parentRules.text(membership.student_uid));
    return !currentPeriod || profile && profile.active !== false && profile.deleted_at == null;
  });
  const visibleUids = new Set(visibleMemberships.map((membership) => parentRules.text(membership.student_uid)));
  const classAssignments = assignmentRows.filter((assignment) =>
    assignment.assignment_scope === "class"
    && parentRules.text(assignment.class_task_id)
    && !isCancelled(assignment)
    && dueInPeriod(assignment, period)
  );
  const historyMonths = [...new Set(assignmentRows.filter((assignment) =>
    assignment.assignment_scope === "class" && !isCancelled(assignment)
    && parentRules.dateValue(assignment.due_at)
    && parentRules.dateValue(assignment.due_at) <= now.getTime()
  ).map((assignment) => {
    const parts = parentRules.shanghaiDate(assignment.due_at);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
  }))].sort().reverse().slice(0, 36);
  const taskGroups = new Map();
  classAssignments.forEach((assignment) => {
    const taskId = parentRules.text(assignment.class_task_id);
    const rows = taskGroups.get(taskId) || [];
    rows.push(assignment);
    taskGroups.set(taskId, rows);
  });
  const representativeRows = [...taskGroups.entries()].map(([taskId, rows]) => ({
    taskId,
    rows,
    representative: rows.slice().sort((left, right) =>
      parentRules.dateValue(left.created_at) - parentRules.dateValue(right.created_at)
    )[0],
  }));
  const setIds = representativeRows.map((item) => item.representative.set_id);
  const sets = await getByFieldIn("sets", "set_id", setIds);
  const setById = new Map(sets.map((set) => [set.set_id, set]));
  const attempts = await getByFieldIn("attempts", "student_uid", [...visibleUids]);
  const attemptsByStudentSet = new Map();
  attempts.filter(parentRules.countableAttempt).forEach((attempt) => {
    const key = `${parentRules.text(attempt.student_uid)}::${parentRules.text(attempt.set_id)}`;
    const rows = attemptsByStudentSet.get(key) || [];
    rows.push(attempt);
    attemptsByStudentSet.set(key, rows);
  });
  representativeRows.sort((left, right) =>
    parentRules.dateValue(left.representative.due_at) - parentRules.dateValue(right.representative.due_at)
  );
  const tasks = representativeRows.map((group, index) => {
    const assignment = group.representative;
    const set = setById.get(assignment.set_id) || {};
    return {
      task_key: `task-${index + 1}`,
      set_id: assignment.set_id,
      title: parentRules.text(set.title) || parentRules.text(assignment.set_id),
      due_at: assignment.due_at || null,
      passing_percentage: passingForAssignment(assignment, set),
      mastery_percentage: masteryForAssignment(assignment, set),
      mastery_enabled: assignment.mastery_enabled === true,
      group,
    };
  });
  const matrixStudents = visibleMemberships.map((membership) => {
    const studentUid = parentRules.text(membership.student_uid);
    const profile = studentByUid.get(studentUid) || {};
    const cells = tasks.map((task) => {
      const assignment = task.group.rows.find((row) => parentRules.text(row.student_uid) === studentUid) || null;
      if (!assignment) return { status: "unsubmitted", best_percentage: null, mastered: false, assignment_id: null };
      const set = setById.get(assignment.set_id) || {};
      const key = `${studentUid}::${parentRules.text(assignment.set_id)}`;
      let summary = parentRules.attemptSummary(attemptsByStudentSet.get(key) || [], {
        passing_percentage: passingForAssignment(assignment, set),
        mastery_percentage: masteryForAssignment(assignment, set),
        mastery_enabled: assignment.mastery_enabled === true,
        score_locked_at: scoreLockForAssignment(assignment),
        cutoff_at: cutoffAt,
      });
      return {
        status: summary.has_attempt ? summary.status : "unsubmitted",
        best_percentage: summary.best_percentage,
        mastered: summary.mastered,
        assignment_id: studentUid === student.auth_uid ? assignment.assignment_id || assignment._id : null,
      };
    });
    return {
      student_uid: studentUid,
      ...displayNames(profile, membership),
      own_student: studentUid === student.auth_uid,
      ranking_eligible: parentRules.membershipCovers(membership, period, cutoffAt),
      cells,
    };
  });
  const ranked = parentRules.rankMatrixStudents(matrixStudents, student.auth_uid).map(({ student_uid, ...row }) => row);
  return {
    success: true,
    class: {
      class_name: parentRules.text(classRecord && (classRecord.name || classRecord.class_name)) || classId,
    },
    period: {
      type: period.type,
      key: period.key || null,
      start_at: period.start_at,
      end_at: period.end_at,
      cutoff_at: cutoffAt,
    },
    tasks: tasks.map(({ group: _group, ...task }) => task),
    students: ranked,
    history_months: historyMonths,
    generated_at: now,
  };
}

function attemptCounts(attempt) {
  const results = attempt.adjusted_question_results || attempt.question_results || [];
  const correct = results.filter((item) => item && item.correct === true).length;
  return { correct_count: correct, question_count: results.length, wrong_count: Math.max(0, results.length - correct) };
}

async function taskContext(student, event) {
  const assignmentId = parentRules.text(event.assignment_id);
  const setId = parentRules.text(event.set_id);
  if (assignmentId) {
    const assignment = await getOne("assignments", { assignment_id: assignmentId, student_uid: student.auth_uid });
    if (!assignment || isCancelled(assignment)) throw new Error("PARENT_TASK_NOT_FOUND");
    const set = await getOne("sets", { set_id: assignment.set_id });
    if (!set || set.visible === false) throw new Error("PARENT_TASK_NOT_FOUND");
    return { assignment, set, source: "assigned" };
  }
  if (!setId) throw new Error("PARENT_TASK_REQUIRED");
  const set = await getOne("sets", { set_id: setId, visible: true });
  if (!set) throw new Error("PARENT_TASK_NOT_FOUND");
  const attempts = await getAll("attempts", { where: { student_uid: student.auth_uid, set_id: setId } });
  const summary = parentRules.attemptSummary(attempts.filter((attempt) => !attempt.assignment_id), {
    passing_percentage: passingForSet(set),
    mastery_percentage: masteryForSet(set),
    mastery_enabled: true,
  });
  if (!summary.qualified) throw new Error("PARENT_TASK_NOT_FOUND");
  return { assignment: null, set, source: "self_study" };
}

async function taskDetail(student, event) {
  const context = await taskContext(student, event);
  const attempts = (await getAll("attempts", {
    where: { student_uid: student.auth_uid, set_id: context.set.set_id },
  })).filter(parentRules.countableAttempt).sort((left, right) =>
    parentRules.dateValue(left.submitted_at) - parentRules.dateValue(right.submitted_at)
  );
  const passing = context.assignment ? passingForAssignment(context.assignment, context.set) : passingForSet(context.set);
  const mastery = context.assignment ? masteryForAssignment(context.assignment, context.set) : masteryForSet(context.set);
  const summary = parentRules.attemptSummary(attempts, {
    passing_percentage: passing,
    mastery_percentage: mastery,
    mastery_enabled: context.assignment ? context.assignment.mastery_enabled === true : true,
    score_locked_at: scoreLockForAssignment(context.assignment),
  });
  return {
    success: true,
    task: {
      assignment_id: context.assignment && (context.assignment.assignment_id || context.assignment._id) || null,
      set_id: context.set.set_id,
      source: context.source,
      title: parentRules.text(context.set.title) || context.set.set_id,
      due_at: context.assignment && context.assignment.due_at || null,
      status: summary.has_attempt ? summary.status : "unsubmitted",
      best_percentage: summary.best_percentage,
      passing_percentage: passing,
      mastery_percentage: mastery,
      mastery_enabled: context.assignment ? context.assignment.mastery_enabled === true : true,
      mastered: summary.mastered,
      score_locked: Boolean(scoreLockForAssignment(context.assignment)),
    },
    attempts: attempts.map((attempt, index) => ({
      attempt_id: attempt.attempt_id || attempt._id,
      attempt_number: attempt.attempt_number || index + 1,
      percentage: parentRules.effectivePercentage(attempt),
      submitted_at: attempt.submitted_at || null,
      duration_seconds: attempt.duration_seconds == null ? null : Number(attempt.duration_seconds),
      corrected: attempt.adjusted_percentage != null,
      ...attemptCounts(attempt),
    })),
  };
}

async function attemptReview(student, event) {
  const attemptId = parentRules.text(event.attempt_id);
  if (!attemptId) throw new Error("PARENT_ATTEMPT_REQUIRED");
  const attempt = await getOne("attempts", { attempt_id: attemptId, student_uid: student.auth_uid });
  if (!attempt || !parentRules.countableAttempt(attempt)) throw new Error("PARENT_ATTEMPT_NOT_FOUND");
  const assignmentId = parentRules.text(event.assignment_id || attempt.assignment_id);
  const assignment = assignmentId
    ? await getOne("assignments", { assignment_id: assignmentId, student_uid: student.auth_uid })
    : null;
  const feedbackAvailable = Boolean(
    assignment && assignment.answer_revealed === true
    || attempt.adjusted_passed === true
    || attempt.adjusted_passed == null && attempt.passed === true
    || attempt.mastered === true
  );
  const results = attempt.adjusted_question_results || attempt.question_results || [];
  return {
    success: true,
    attempt: {
      attempt_id: attempt.attempt_id || attempt._id,
      attempt_number: attempt.attempt_number || null,
      percentage: parentRules.effectivePercentage(attempt),
      submitted_at: attempt.submitted_at || null,
      duration_seconds: attempt.duration_seconds == null ? null : Number(attempt.duration_seconds),
      feedback_available: feedbackAvailable,
      wrong_answers: results.filter((item) => item && item.correct !== true).map((item) => ({
        question_id: item.question_id,
        question_text: item.question_text_snapshot || "",
        submitted_answer: item.submitted_answer == null ? "" : item.submitted_answer,
        correct_answer: feedbackAvailable && item.correct_answer != null ? item.correct_answer : null,
        explanation: feedbackAvailable ? item.explanation || "" : "",
      })),
    },
  };
}

async function logout(context) {
  if (context.session._id) await db.collection(SESSION_COLLECTION).doc(context.session._id).update({
    status: "logged_out",
    logged_out_at: new Date(),
    updated_at: new Date(),
  });
  return { success: true };
}

function errorResponse(error) {
  const code = parentRules.text(error && error.message) || "PARENT_MODE_UNAVAILABLE";
  const messages = {
    PARENT_LOGIN_COOLDOWN: "尝试次数过多，请稍后再试。",
    PARENT_STUDENT_MISMATCH: "学生信息不匹配。",
    PARENT_SESSION_REQUIRED: "请重新进入 Parent Mode。",
    PARENT_SESSION_INVALID: "Parent Mode 会话无效，请重新输入学生姓名。",
    PARENT_SESSION_EXPIRED: "Parent Mode 会话已过期，请重新输入学生姓名。",
    PARENT_STUDENT_UNAVAILABLE: "该学生目前无法查看。",
    PARENT_TASK_NOT_FOUND: "无法查看这份任务。",
    PARENT_TASK_REQUIRED: "请选择一份任务。",
    PARENT_ATTEMPT_REQUIRED: "请选择一次提交。",
    PARENT_ATTEMPT_NOT_FOUND: "无法查看这次提交。",
  };
  return { success: false, code, message: messages[code] || "Parent Mode 暂时无法加载，请稍后再试。" };
}

exports.main = async (event = {}) => {
  try {
    const action = parentRules.text(event.action || "overview");
    if (action === "login") return await login(event);
    const context = await requireSession(event);
    if (action === "logout") return await logout(context);
    if (action === "classMatrix") return await classMatrix(context.student, event);
    if (action === "taskDetail") return await taskDetail(context.student, event);
    if (action === "attemptReview") return await attemptReview(context.student, event);
    return await overview(context.student);
  } catch (error) {
    console.error("Parent Mode request failed", error);
    return errorResponse(error);
  }
};

exports._test = {
  hash,
  passingForSet,
  masteryForSet,
  displayNames,
  assignmentView,
  selfStudyView,
  errorResponse,
};
