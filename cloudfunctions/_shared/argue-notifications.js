"use strict";

const crypto = require("crypto");
const EVENT_COLLECTION = "teacher_attempt_email_events";
const EVENT_KIND = "student_argue";
const text = (value) => String(value == null ? "" : value).trim();
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 40);
const escapeHtml = (value) => text(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const answerText = (value) => Array.isArray(value) ? value.map(text).join(" / ") : text(value);

function eventForDispute(dispute) {
  if (!dispute || dispute.requester_role === "teacher" || !dispute.dispute_id) return null;
  return {
    event_id: `argue-${digest(text(dispute.dispute_id))}`,
    event_kind: EVENT_KIND,
    dispute_id: dispute.dispute_id,
    student_uid: dispute.student_uid,
    set_id: dispute.set_id,
    assignment_id: dispute.assignment_id || null,
    thread_key: `argue::${dispute.dispute_id}`,
    delivery_policy: "argue_immediate",
    status: "pending",
    retry_count: 0,
    submitted_at: dispute.created_at,
    due_at: dispute.created_at,
    created_at: dispute.created_at,
    updated_at: dispute.created_at,
  };
}

async function one(db, collection, where) {
  const result = await db.collection(collection).where(where).limit(1).get();
  return result.data && result.data[0] || null;
}

async function enqueue(db, dispute) {
  const event = eventForDispute(dispute);
  if (!event) return;
  try {
    await db.collection(EVENT_COLLECTION).doc(event.event_id).create(event);
  } catch (error) {
    // Verify existence instead of treating an arbitrary provider error as a duplicate.
    if (!await one(db, EVENT_COLLECTION, { event_id: event.event_id })) throw error;
  }
  await db.collection("answer_disputes").doc(dispute._id).update({ email_notification_status: "queued" });
}

async function saveStudentDispute(db, dispute) {
  const id = `dispute-${digest(text(dispute.dispute_id))}`;
  const record = { ...dispute, email_notification_status: "pending" };
  try {
    await db.collection("answer_disputes").doc(id).create(record);
  } catch (error) {
    if (await one(db, "answer_disputes", { dispute_id: dispute.dispute_id })) {
      return { already_exists: true };
    }
    throw error;
  }
  try {
    await enqueue(db, { ...record, _id: id });
  } catch (_) {
    // The durable intent remains on the saved dispute. The timer repairs it.
    // Never turn a successfully saved student request into an email error.
    console.error("Argue email enqueue deferred", { dispute_id: dispute.dispute_id });
  }
  return { already_exists: false };
}

async function repairPendingEvents(db) {
  const result = await db.collection("answer_disputes")
    .where({ email_notification_status: "pending" }).limit(20).get();
  let repaired = 0;
  for (const dispute of result.data || []) {
    await enqueue(db, dispute);
    repaired += 1;
  }
  return repaired;
}

async function loadContext(db, disputeId) {
  const dispute = await one(db, "answer_disputes", { dispute_id: text(disputeId) });
  if (!dispute) throw new Error("DISPUTE_NOT_AVAILABLE");
  const [student, set, assignment, gradingKey] = await Promise.all([
    one(db, "students", { auth_uid: dispute.student_uid }),
    one(db, "sets", { set_id: dispute.set_id }),
    dispute.assignment_id ? one(db, "assignments", { assignment_id: dispute.assignment_id }) : null,
    dispute.dispute_type === "intensive_spelling_exemption" ? null
      : one(db, "grading_keys", { set_id: dispute.set_id }),
  ]);
  if (!student || student.deleted || student.deleted_at || student.delete_pending ||
      (assignment && assignment.status === "cancelled")) throw new Error("DISPUTE_NOT_AVAILABLE");
  return { dispute, student, set: set || { title: dispute.set_id }, gradingKey, assignment };
}

function reviewUrl(teacherUrl, disputeId) {
  let url;
  try { url = new URL(text(teacherUrl)); } catch (_) { throw new Error("ARGUE_EMAIL_URL_NOT_CONFIGURED"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("ARGUE_EMAIL_URL_NOT_CONFIGURED");
  const target = new URL("argue-review.html", url);
  target.searchParams.set("dispute", disputeId);
  return target.href;
}

function renderEmail(context) {
  const { dispute, student, set } = context;
  const studentName = text(student.chinese_name) + text(student.english_name) || text(student.name || student.student_id);
  const intensive = dispute.dispute_type === "intensive_spelling_exemption";
  const fields = [
    ["Question", dispute.question_text_snapshot || "Open the request to view this question."],
    [intensive ? "Requested Provided Word" : "Submitted answer", answerText(dispute.submitted_answer)],
    ...(!intensive ? [
      ["Correct answer snapshot", answerText(dispute.answer_snapshot)],
      ["Explanation", dispute.explanation_snapshot || (context.gradingKey && context.gradingKey.explanations || {})[dispute.question_id] || "—"],
    ] : []),
    ["Student’s Argue", dispute.student_reason || "No note provided."],
  ];
  const url = reviewUrl(context.teacherUrl, dispute.dispute_id);
  const submitted = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(dispute.created_at));
  const reminder = Boolean(context.reminderDay);
  const subject = `${reminder ? "提醒处理 | " : ""}${studentName} | Argue | ${text(set.title)} | ${text(dispute.question_id)}`.replace(/[\r\n]/g, " ");
  return {
    subject,
    text: [subject, ...(reminder ? ["这条 Argue 仍未处理，请选择处理方式并提交。处理后将停止每日提醒。"] : []), `${submitted} (Shanghai)`, ...fields.map(([label, value]) => `${label}: ${value}`),
      `处理这条 Argue: ${url}`, "Choose a decision and optionally add Teachers’ Note. Teacher sign-in required.",
      "Please use the button to submit your decision; replying to this email does not process the request."].join("\n\n"),
    html: '<!doctype html><html><body style="margin:0;background:#f4f8f5;color:#18332f;font:16px/1.6 Arial,sans-serif;">' +
      '<div style="max-width:620px;margin:24px auto;padding:24px;background:#fff;border:1px solid #dce8e3;border-radius:18px;">' +
      '<p style="margin:0;color:#13766d;font-size:12px;font-weight:bold;letter-spacing:2px;">ARGUE</p>' +
      `<h2 style="margin:8px 0;">${escapeHtml(studentName)} · ${escapeHtml(set.title)}</h2>` +
      `<p style="color:#647b75;font-size:13px;">${escapeHtml(dispute.question_id)} · ${escapeHtml(submitted)} (Shanghai)</p>` +
      (reminder ? '<p style="color:#13766d;font-weight:bold;">提醒处理：这条 Argue 仍未处理。处理后将停止每日提醒。</p>' : "") +
      fields.map(([label, value]) => `<div style="padding:14px;margin:12px 0;background:#f4f8f5;border-radius:12px;"><strong style="font-size:12px;color:#647b75;">${escapeHtml(label)}</strong><div style="white-space:pre-wrap;overflow-wrap:anywhere;">${escapeHtml(value)}</div></div>`).join("") +
      `<p style="text-align:center;margin-top:24px;"><a href="${escapeHtml(url)}" style="display:inline-block;background:#13766d;color:#fff;text-decoration:none;padding:13px 22px;border-radius:24px;font-weight:bold;">处理这条 Argue</a></p>` +
      '<p style="text-align:center;font-size:12px;color:#647b75;">选择处理方式，可选填 Teachers’ Note。需要教师登录。<br>请通过按钮提交，直接回复此邮件不会处理 Argue。</p></div></body></html>',
  };
}

module.exports = { EVENT_KIND, eventForDispute, saveStudentDispute, repairPendingEvents, loadContext, reviewUrl, renderEmail };
