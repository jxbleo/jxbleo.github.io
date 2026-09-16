"use strict";

const crypto = require("crypto");
const lab = require("./speaking-lab");
const EVENT_KIND = "speaking_report_ready";
const EVENT_COLLECTION = "teacher_attempt_email_events";
const text = (value) => String(value == null ? "" : value).trim();
const escapeHtml = (value) => text(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const eventId = (reportId) => "speaking-" + crypto.createHash("sha256").update(text(reportId)).digest("hex").slice(0, 40);
async function one(db, collection, where) {
  const result = await db.collection(collection).where(where).limit(1).get();
  return result.data && result.data[0] || null;
}
function label(session) {
  return session.exam_family === "ielts" ? `IELTS Speaking · Part ${Number(session.part) === 3 || Number(session.question_snapshot && session.question_snapshot.part) === 3 ? 3 : 2}`
    : session.response_session_id ? "HKDSE · Individual Response" : "HKDSE · Group Discussion";
}
function participantLabels(report, participants) {
  const candidates = report.dse_analysis && report.dse_analysis.candidates || [];
  return candidates.map(candidate => {
    const key = candidate.speaker_key;
    const fallbackLabel = `Speaker ${String(key).replace(/^spk_0*/, "")}`;
    const participant = (participants || []).find(row => row.matched_speaker_key === key);
    return participant ? lab.identityProjection(participant, { teacher: true, fallbackLabel }).label : fallbackLabel;
  });
}
function eventForReport(report, session, participants = []) {
  if (!report || report.status !== "ready" || !report.report_id) return null;
  const occurred = report.finished_at || report.updated_at || report.created_at;
  return {
    event_id: eventId(report.report_id), event_kind: EVENT_KIND,
    report_id: report.report_id, report_version: report.report_version,
    discussion_id: session.discussion_id || null, response_session_id: session.response_session_id || null,
    student_uid: session.student_uid || null,
    student_name_snapshot: session.response_session_id ? text(session.student_name_snapshot) : participantLabels(report, participants).join(" · ").slice(0, 1200), student_id_snapshot: text(session.student_id_snapshot),
    set_id: text(session.set_id), set_title: text(session.title).slice(0, 300),
    notification_label: label(session), exam_family: session.exam_family === "ielts" ? "ielts" : "dse",
    thread_key: `speaking::${report.report_id}`, delivery_policy: "speaking_immediate",
    occurred_at: occurred, submitted_at: occurred, due_at: occurred,
    status: "pending", retry_count: 0, created_at: occurred, updated_at: occurred,
  };
}
async function loadContext(db, reportId) {
  const report = await one(db, "speaking_reports", { report_id: text(reportId), status: "ready" });
  if (!report) throw new Error("SPEAKING_REPORT_NOT_AVAILABLE");
  const individual = Boolean(report.response_session_id);
  const session = await one(db, individual ? "speaking_individual_responses" : "speaking_discussions",
    individual ? { response_session_id: report.response_session_id } : { discussion_id: report.discussion_id });
  if (!session || session.deleted_at) throw new Error("SPEAKING_REPORT_NOT_AVAILABLE");
  let student = null, participants = [];
  if (individual) {
    student = await one(db, "students", { auth_uid: session.student_uid });
    if (!student || student.deleted || student.deleted_at) throw new Error("SPEAKING_REPORT_NOT_AVAILABLE");
  } else if (session.active_report_version === report.report_version) {
    const result = await db.collection("speaking_participants").where({ discussion_id: session.discussion_id }).limit(50).get();
    participants = (result.data || []).filter((row) => !row.removed_at);
  }
  return { report, session, student, participants };
}
async function enqueue(db, report) {
  let context;
  try { context = await loadContext(db, report.report_id); }
  catch (error) {
    if (error.message !== "SPEAKING_REPORT_NOT_AVAILABLE") throw error;
    await db.collection("speaking_reports").doc(report._id || report.report_id).update({ teacher_notification_status: "skipped" });
    return;
  }
  const event = eventForReport(context.report, context.session, context.participants);
  try { await db.collection(EVENT_COLLECTION).doc(event.event_id).create(event); }
  catch (error) { if (!await one(db, EVENT_COLLECTION, { event_id: event.event_id })) throw error; }
  await db.collection("speaking_reports").doc(report._id || report.report_id).update({ teacher_notification_status: "queued" });
}
async function enqueueSafely(db, report) {
  try { await enqueue(db, report); }
  catch (_) { console.error("Speaking report notification enqueue deferred", { report_id: report.report_id }); }
}
async function repairPendingEvents(db) {
  const result = await db.collection("speaking_reports").where({ teacher_notification_status: "pending", status: "ready" }).limit(20).get();
  let repaired = 0;
  for (const report of result.data || []) {
    try { await enqueue(db, report); repaired += 1; }
    catch (_) { console.error("Speaking report notification repair deferred", { report_id: report.report_id }); }
  }
  return repaired;
}
function normalizeBellItem(event, student = {}) {
  return {
    activity_id: text(event.event_id), activity_type: EVENT_KIND, thread_key: text(event.thread_key),
    report_id: text(event.report_id), notification_label: text(event.notification_label),
    student_name: text(student.name || event.student_name_snapshot), student_id: text(student.student_id || event.student_id_snapshot),
    set_title: text(event.set_title), occurred_at: event.occurred_at,
    href: `speaking-review.html?report=${encodeURIComponent(event.report_id)}`,
  };
}
function renderEmail({ report, session, student, participants, teacherUrl }) {
  let base;
  try { base = new URL(text(teacherUrl)); } catch (_) { throw new Error("SPEAKING_EMAIL_URL_NOT_CONFIGURED"); }
  if (base.protocol !== "https:") throw new Error("SPEAKING_EMAIL_URL_INVALID");
  const url = new URL("speaking-review.html", base);
  url.searchParams.set("report", report.report_id);
  const names = student ? text(student.name || student.student_id) : participantLabels(report, participants).join(" · ");
  const mode = label(session);
  const title = text(session.title || session.set_id);
  const date = new Date(report.finished_at || report.updated_at || report.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  const heading = [names, mode, title].filter(Boolean).join(" · ");
  return {
    subject: heading.replace(/[\r\n]+/g, " ").slice(0, 240) + " · Report ready",
    text: `${heading}\nReport ready · ${date} (Shanghai)\nOpen student report: ${url.href}\nTeacher sign-in required.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;line-height:1.6"><p>${escapeHtml(mode)}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(names)}</p><p>Report ready · ${escapeHtml(date)} (Shanghai)</p><p><a href="${escapeHtml(url.href)}" style="display:inline-block;padding:12px 20px;background:#305c48;color:white;border-radius:12px;text-decoration:none">View student report</a></p><p>Teacher sign-in required. Recording, transcript and detailed feedback are available in the report.</p></div>`,
  };
}
module.exports = { EVENT_KIND, eventId, eventForReport, enqueueSafely, repairPendingEvents, loadContext, normalizeBellItem, renderEmail };
