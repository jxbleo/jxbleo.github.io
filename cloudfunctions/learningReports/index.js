"use strict";

const cloudbase = require("@cloudbase/node-sdk");
const reportRules = require("../_shared/learning-reports");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const _ = db.command;
const READ_PAGE_LIMIT = 500;
const QUERY_CHUNK_SIZE = 100;
const CLASS_COLLECTION = "classes";
const CLASS_MEMBERSHIP_COLLECTION = "class_memberships";
const REPORT_COLLECTION = "learning_reports";

function text(value) {
  return reportRules.text(value);
}

function recordData(record) {
  return reportRules.recordData(record);
}

function validPeriodType(value) {
  const periodType = text(value);
  if (periodType !== "weekly" && periodType !== "monthly") throw new Error("REPORT_PERIOD_TYPE_INVALID");
  return periodType;
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
    const rows = result.data || [];
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
  const uniqueValues = [...new Set((values || []).map(text).filter(Boolean))];
  if (!uniqueValues.length) return [];
  const chunks = [];
  for (let index = 0; index < uniqueValues.length; index += QUERY_CHUNK_SIZE) {
    chunks.push(uniqueValues.slice(index, index + QUERY_CHUNK_SIZE));
  }
  const pages = await Promise.all(chunks.map((chunk) => getAll(collection, {
    where: { [field]: _.in(chunk) },
    pageSize: QUERY_CHUNK_SIZE,
  })));
  return pages.flat().map(recordData);
}

async function getAuthenticatedProfile() {
  const userInfo = await app.auth().getUserInfo();
  const uid = userInfo && (userInfo.uid || userInfo.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");
  const profile = await getOne("students", { auth_uid: String(uid), active: true });
  if (!profile) throw new Error("STUDENT_NOT_LINKED");
  const role = profile.role || "student";
  if (role !== "student" && role !== "teacher") throw new Error("PROFILE_ROLE_INVALID");
  return { ...profile, role };
}

function reportMetadata(report) {
  const source = recordData(report);
  return {
    report_id: source.report_id || "",
    status: source.status || "preview",
    class_id: source.class_id || "",
    class_name: source.class_name || "",
    period_type: source.period_type || "",
    period_key: source.period_key || "",
    period_start: source.period_start || null,
    period_end: source.period_end || null,
    snapshot_cutoff_at: source.snapshot_cutoff_at || null,
    report_url: source.report_url || reportRules.reportUrlFor(source.report_id),
    student_count: Array.isArray(source.student_details) ? source.student_details.length : 0,
    ranked_student_count: Array.isArray(source.leaderboard) ? source.leaderboard.length : 0,
    generated_at: source.generated_at || null,
    updated_at: source.updated_at || null,
    published_at: source.published_at || null,
  };
}

function reportContainsStudent(report, studentUid) {
  return (report && report.membership_snapshot || []).some((member) => text(member && member.student_uid) === text(studentUid));
}

function teacherReportResponse(report, extra = {}) {
  return {
    success: true,
    role: "teacher",
    report: {
      ...reportMetadata(report),
      leaderboard: reportRules.publicLeaderboard(report.leaderboard),
    },
    student_details: Array.isArray(report.student_details) ? report.student_details : [],
    ...extra,
  };
}

function studentReportResponse(report, studentUid) {
  const detail = (report.student_details || []).find((item) => text(item && item.student_uid) === text(studentUid));
  if (!detail) throw new Error("REPORT_NOT_FOUND");
  return {
    success: true,
    role: "student",
    report: {
      ...reportMetadata(report),
      leaderboard: reportRules.publicLeaderboard(report.leaderboard),
    },
    student_detail: reportRules.studentDetailView(detail),
  };
}

async function activeClass(classId) {
  const classRecord = await getOne(CLASS_COLLECTION, { class_id: text(classId) });
  if (!classRecord || classRecord.active === false) throw new Error("CLASS_NOT_FOUND");
  return classRecord;
}

async function reportInputs(classRecord) {
  const memberships = (await getAll(CLASS_MEMBERSHIP_COLLECTION, {
    where: { class_id: classRecord.class_id },
  })).map(recordData);
  const studentUids = memberships.map((membership) => membership.student_uid);
  const [students, assignments, attempts] = await Promise.all([
    getByFieldIn("students", "auth_uid", studentUids),
    getByFieldIn("assignments", "student_uid", studentUids),
    getByFieldIn("attempts", "student_uid", studentUids),
  ]);
  const setIds = [...new Set(assignments.concat(attempts).map((item) => text(item.set_id)).filter(Boolean))];
  const sets = await getByFieldIn("sets", "set_id", setIds);
  return { memberships, students, assignments, attempts, sets };
}

async function previousPublishedReport(classId, period) {
  const previous = reportRules.previousPeriod(period);
  const reportId = reportRules.reportIdFor(classId, previous);
  const report = await getOne(REPORT_COLLECTION, { report_id: reportId });
  return report && report.status === "published" ? report : null;
}

function cutoffForPreview(period, now) {
  const latest = Math.min(reportRules.dateValue(now), reportRules.dateValue(period.end_at));
  return new Date(latest);
}

function mergeCurrentTeacherNotes(document, current) {
  if (!current || !Array.isArray(current.student_details)) return document;
  const notes = new Map(current.student_details.map((detail) => [text(detail && detail.student_uid), detail]));
  return {
    ...document,
    student_details: (document.student_details || []).map((detail) => {
      const currentDetail = notes.get(text(detail && detail.student_uid));
      if (!currentDetail) return detail;
      return {
        ...detail,
        teacher_comment: reportRules.sanitizeComment(currentDetail.teacher_comment),
        teacher_goals: reportRules.sanitizeGoals(currentDetail.teacher_goals),
        comment_updated_at: currentDetail.comment_updated_at || null,
      };
    }),
  };
}

async function commitMaterializedReport(reportId, document, now, attempt = 0) {
  let outcome = null;
  try {
    await db.runTransaction(async (transaction) => {
      const result = await transaction.collection(REPORT_COLLECTION).where({ report_id: reportId }).limit(1).get();
      const current = result.data && result.data[0] ? recordData(result.data[0]) : null;
      if (current && current.status === "published") {
        outcome = { report: current, already_published: true };
        return;
      }
      const committed = mergeCurrentTeacherNotes(document, current);
      if (current && current._id) {
        await transaction.collection(REPORT_COLLECTION).doc(current._id).update(committed);
        outcome = { report: { ...current, ...committed }, already_published: false };
        return;
      }
      const created = { ...committed, created_at: now };
      const added = await transaction.collection(REPORT_COLLECTION).add(created);
      outcome = { report: { ...created, _id: added && added.id }, already_published: false };
    });
    if (!outcome) throw new Error("REPORT_TRANSACTION_EMPTY");
    return outcome;
  } catch (error) {
    // A unique report_id index plus transaction conflict detection makes the
    // first writer authoritative. Retry once so a concurrent first insert is
    // re-read and handled through the normal preview/published state checks.
    if (attempt < 1) return await commitMaterializedReport(reportId, document, now, attempt + 1);
    throw error;
  }
}

async function materializeReport(options) {
  const classRecord = options.classRecord;
  const period = options.period;
  const status = options.status;
  const now = options.now || new Date();
  const reportId = reportRules.reportIdFor(classRecord.class_id, period);
  const existing = options.existing || await getOne(REPORT_COLLECTION, { report_id: reportId });
  if (existing && existing.status === "published") {
    return { report: existing, already_published: true };
  }
  if (status !== "preview" && status !== "published") throw new Error("REPORT_STATUS_INVALID");
  const cutoffAt = status === "published" ? new Date(period.end_at) : cutoffForPreview(period, now);
  const [inputs, previousReport] = await Promise.all([
    reportInputs(classRecord),
    previousPublishedReport(classRecord.class_id, period),
  ]);
  const snapshot = reportRules.buildReportSnapshot({
    class_id: classRecord.class_id,
    period,
    cutoff_at: cutoffAt,
    existing_report: existing,
    previous_report: previousReport,
    ...inputs,
  });
  const document = {
    report_id: reportId,
    status,
    class_id: classRecord.class_id,
    class_name: classRecord.name || classRecord.class_id,
    period_type: period.period_type,
    period_key: period.period_key,
    period_start: period.start_at,
    period_end: period.end_at,
    snapshot_cutoff_at: cutoffAt,
    report_url: reportRules.reportUrlFor(reportId),
    snapshot_version: 1,
    membership_snapshot: snapshot.membership_snapshot,
    leaderboard: snapshot.leaderboard,
    student_details: snapshot.student_details,
    generated_at: now,
    updated_at: now,
    published_at: status === "published" ? now : null,
  };
  return await commitMaterializedReport(reportId, document, now);
}

async function listReports(profile, event) {
  const requestedClassId = text(event.class_id);
  const requestedPeriodType = text(event.period_type);
  if (requestedPeriodType) validPeriodType(requestedPeriodType);
  const reports = (await getAll(REPORT_COLLECTION)).map(recordData).filter((report) => {
    if (requestedClassId && text(report.class_id) !== requestedClassId) return false;
    if (requestedPeriodType && report.period_type !== requestedPeriodType) return false;
    if (profile.role === "teacher") return report.status === "preview" || report.status === "published";
    return report.status === "published" && reportContainsStudent(report, profile.auth_uid);
  }).sort((left, right) => reportRules.dateValue(right.published_at || right.updated_at) - reportRules.dateValue(left.published_at || left.updated_at));
  const response = {
    success: true,
    role: profile.role,
    reports: reports.map(reportMetadata),
  };
  if (profile.role === "teacher") {
    const classes = (await getAll(CLASS_COLLECTION)).map(recordData)
      .filter((classRecord) => classRecord.active !== false)
      .map((classRecord) => ({ class_id: classRecord.class_id, name: classRecord.name || classRecord.class_id }))
      .sort((left, right) => left.name.localeCompare(right.name));
    response.classes = classes;
  }
  return response;
}

async function getReport(profile, event) {
  const reportId = text(event.report_id);
  if (!reportId) throw new Error("REPORT_ID_REQUIRED");
  const report = await getOne(REPORT_COLLECTION, { report_id: reportId });
  if (!report) throw new Error("REPORT_NOT_FOUND");
  if (profile.role === "teacher") return teacherReportResponse(report);
  if (report.status !== "published" || !reportContainsStudent(report, profile.auth_uid)) throw new Error("REPORT_NOT_FOUND");
  return studentReportResponse(report, profile.auth_uid);
}

async function generatePreview(profile, event) {
  if (profile.role !== "teacher") throw new Error("TEACHER_REQUIRED");
  const classId = text(event.class_id);
  if (!classId) throw new Error("CLASS_ID_REQUIRED");
  const periodType = validPeriodType(event.period_type);
  // The period comes only from server time. Do not accept a client period key,
  // date, cutoff, or published status here.
  const now = new Date();
  const classRecord = await activeClass(classId);
  const period = reportRules.periodForDate(periodType, now);
  const result = await materializeReport({ classRecord, period, status: "preview", now });
  return teacherReportResponse(result.report, { already_published: result.already_published === true });
}

async function saveComment(profile, event) {
  if (profile.role !== "teacher") throw new Error("TEACHER_REQUIRED");
  const reportId = text(event.report_id);
  const studentUid = text(event.student_uid);
  if (!reportId || !studentUid) throw new Error("REPORT_COMMENT_FIELDS_REQUIRED");
  const comment = reportRules.sanitizeComment(event.comment == null ? event.teacher_comment : event.comment);
  const goals = reportRules.sanitizeGoals(event.goals == null ? event.teacher_goals : event.goals);
  const now = new Date();
  let savedDetail = null;
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(REPORT_COLLECTION).where({ report_id: reportId }).limit(1).get();
    const report = result.data && result.data[0] ? recordData(result.data[0]) : null;
    if (!report) throw new Error("REPORT_NOT_FOUND");
    if (report.status !== "preview") throw new Error("REPORT_IMMUTABLE");
    let found = false;
    const details = (report.student_details || []).map((detail) => {
      if (text(detail && detail.student_uid) !== studentUid) return detail;
      found = true;
      return {
        ...detail,
        teacher_comment: comment,
        teacher_goals: goals,
        comment_updated_at: now,
      };
    });
    if (!found) throw new Error("REPORT_STUDENT_NOT_FOUND");
    await transaction.collection(REPORT_COLLECTION).doc(report._id).update({
      student_details: details,
      updated_at: now,
    });
    savedDetail = details.find((detail) => text(detail.student_uid) === studentUid);
  });
  if (!savedDetail) throw new Error("REPORT_TRANSACTION_EMPTY");
  return {
    success: true,
    role: "teacher",
    report_id: reportId,
    student_detail: savedDetail,
  };
}

async function publishReport(profile, event) {
  if (profile.role !== "teacher") throw new Error("TEACHER_REQUIRED");
  const reportId = text(event.report_id);
  if (!reportId) throw new Error("REPORT_ID_REQUIRED");
  const existing = await getOne(REPORT_COLLECTION, { report_id: reportId });
  if (!existing) throw new Error("REPORT_NOT_FOUND");
  if (existing.status === "published") return teacherReportResponse(existing, { already_published: true });
  const now = new Date();
  const periodType = validPeriodType(existing.period_type);
  const allowedPeriod = reportRules.latestClosedPeriod(periodType, now);
  if (existing.period_key !== allowedPeriod.period_key || !reportRules.isPeriodClosed(allowedPeriod, now)) {
    throw new Error("REPORT_PERIOD_OPEN");
  }
  const classRecord = await activeClass(existing.class_id);
  const result = await materializeReport({
    classRecord,
    period: allowedPeriod,
    status: "published",
    now,
    existing,
  });
  return teacherReportResponse(result.report, { already_published: result.already_published === true });
}

function automaticOperations(now = new Date()) {
  const local = reportRules.shanghaiParts(now);
  const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const monthDays = new Date(Date.UTC(local.year, local.month, 0)).getUTCDate();
  const operations = [];
  // The timer can run more than once; materialization is idempotent. These
  // checks prevent a timer caller from asking for arbitrary historic periods.
  if (weekday === 6) operations.push({ status: "preview", period: reportRules.periodForDate("weekly", now) });
  if (local.day === monthDays - 1) operations.push({ status: "preview", period: reportRules.periodForDate("monthly", now) });
  if (weekday === 1) operations.push({ status: "published", period: reportRules.latestClosedPeriod("weekly", now) });
  if (local.day === 1) operations.push({ status: "published", period: reportRules.latestClosedPeriod("monthly", now) });
  return operations;
}

async function runScheduledGeneration(now = new Date()) {
  const operations = automaticOperations(now);
  const classes = (await getAll(CLASS_COLLECTION)).map(recordData).filter((classRecord) => classRecord.active !== false);
  const generated = [];
  const failures = [];
  for (const operation of operations) {
    for (const classRecord of classes) {
      try {
        const result = await materializeReport({
          classRecord,
          period: operation.period,
          status: operation.status,
          now,
        });
        generated.push({
          report_id: result.report.report_id,
          class_id: classRecord.class_id,
          status: result.report.status,
          already_published: result.already_published === true,
        });
      } catch (error) {
        console.error("learning report scheduled generation failed", classRecord.class_id, operation.period.period_key, error);
        failures.push({
          class_id: classRecord.class_id,
          period_type: operation.period.period_type,
          period_key: operation.period.period_key,
          code: error.message || "REPORT_GENERATION_FAILED",
        });
      }
    }
  }
  return {
    success: true,
    run_at: now,
    generated,
    failures,
  };
}

function publicErrorMessage(code) {
  const messages = {
    AUTH_REQUIRED: "Please log in.",
    TEACHER_REQUIRED: "Teacher access is required.",
    STUDENT_NOT_LINKED: "Your account profile is unavailable.",
    CLASS_NOT_FOUND: "This class was not found.",
    REPORT_NOT_FOUND: "This report is not available.",
    REPORT_IMMUTABLE: "Published reports cannot be edited.",
    REPORT_PERIOD_OPEN: "This reporting period has not closed yet.",
  };
  return messages[code] || "Unable to load the learning report.";
}

exports.main = async (event = {}) => {
  try {
    const profile = await getAuthenticatedProfile();
    const action = text(event.action || "listReports");
    if (action === "listReports") return await listReports(profile, event);
    if (action === "getReport") return await getReport(profile, event);
    if (action === "generatePreview") return await generatePreview(profile, event);
    if (action === "saveComment") return await saveComment(profile, event);
    if (action === "publishReport") return await publishReport(profile, event);
    throw new Error("UNKNOWN_ACTION");
  } catch (error) {
    const code = error && error.message || "LEARNING_REPORTS_ERROR";
    console.error("learningReports failed", error);
    return { success: false, code, message: publicErrorMessage(code) };
  }
};

// `generateLearningReports` imports this server-only entry point. It is not
// exposed through the browser-facing action dispatcher above.
exports.runScheduledGeneration = runScheduledGeneration;
exports.automaticOperations = automaticOperations;
