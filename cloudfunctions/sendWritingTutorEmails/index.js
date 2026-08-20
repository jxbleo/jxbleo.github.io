"use strict";

const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");
const nodemailer = require("nodemailer");
const teacherEmailSettings = require("../_shared/teacher-email-settings");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const EVENTS = "writing_teacher_email_events";
const DISPATCH_LIMIT = 50;

function text(value) { return String(value == null ? "" : value).trim(); }
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

function timerToken(event) {
  const direct = text(event && event.internal_token);
  if (direct) return direct;
  try {
    const parsed = JSON.parse(text(event && event.Message));
    return text(parsed && parsed.internal_token || parsed);
  } catch (_error) {
    return text(event && event.Message);
  }
}

function authorize(event) {
  const expected = text(process.env.WRITING_TUTOR_EMAIL_CRON_TOKEN);
  if (!expected) throw new Error("WRITING_EMAIL_CRON_NOT_CONFIGURED");
  if (timerToken(event) !== expected) throw new Error("WRITING_EMAIL_CRON_UNAUTHORIZED");
}

async function recipients() {
  const result = await db.collection("students").where({ role: "teacher", active: true }).limit(100).get();
  return teacherEmailSettings.enabledTeacherEmailAddresses(result.data || []);
}

function smtpConfig() {
  const host = text(process.env.TEACHER_ATTEMPT_SMTP_HOST);
  const port = Number(process.env.TEACHER_ATTEMPT_SMTP_PORT || 465);
  const user = text(process.env.TEACHER_ATTEMPT_SMTP_USER);
  const pass = text(process.env.TEACHER_ATTEMPT_SMTP_PASS);
  const from = text(process.env.TEACHER_ATTEMPT_EMAIL_FROM) || user;
  if (!host || !Number.isInteger(port) || !user || !pass || !from) throw new Error("WRITING_EMAIL_SMTP_NOT_CONFIGURED");
  const configuredSecure = text(process.env.TEACHER_ATTEMPT_SMTP_SECURE).toLowerCase();
  return { host, port, user, pass, from, secure: configuredSecure ? configuredSecure === "true" : port === 465 };
}

function summaryHtml(events) {
  const rows = events.map((event) => `<tr><td>${escapeHtml(event.student_name || event.student_id || "Student")}</td><td>${escapeHtml(event.mode === "standardized_content" ? "标化考试内容批改" : "通用语言批改")}</td><td>${escapeHtml(event.rubric_id || "—")}</td><td>${Number(event.word_count || 0)}</td><td>${escapeHtml(event.day_key || "")}</td></tr>`).join("");
  return `<p>AI Tutor has completed ${events.length} writing review${events.length === 1 ? "" : "s"}. This notice contains usage metadata only; student writing is not included.</p><table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Student</th><th>Mode</th><th>Framework</th><th>Words</th><th>Shanghai day</th></tr></thead><tbody>${rows}</tbody></table>`;
}

exports.main = async (event = {}) => {
  try {
    authorize(event);
    const pendingResult = await db.collection(EVENTS).where({ status: "pending" }).limit(DISPATCH_LIMIT).get();
    const pending = pendingResult.data || [];
    if (!pending.length) return { success: true, processed: 0, sent: 0 };
    const token = crypto.randomUUID();
    const claimed = [];
    for (const item of pending) {
      let didClaim = false;
      await db.runTransaction(async (transaction) => {
        const result = await transaction.collection(EVENTS).where({ event_id: item.event_id, status: "pending" }).limit(1).get();
        const current = result.data && result.data[0];
        if (!current) return;
        await transaction.collection(EVENTS).doc(current._id).update({ status: "processing", processing_token: token, processing_started_at: new Date(), updated_at: new Date() });
        didClaim = true;
      });
      if (didClaim) claimed.push(item);
    }
    if (!claimed.length) return { success: true, processed: 0, sent: 0 };
    const bcc = await recipients();
    if (!bcc.length) {
      await Promise.all(claimed.map((item) => db.collection(EVENTS).doc(item._id).update({ status: "skipped", skip_reason: "NO_ENABLED_TEACHER_RECIPIENTS", updated_at: new Date() })));
      return { success: true, processed: claimed.length, sent: 0, skipped: claimed.length };
    }
    const config = smtpConfig();
    const transport = nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    });
    try {
      await transport.sendMail({
        from: config.from, to: config.from, bcc,
        subject: `Mr. Cat AI Tutor · ${claimed.length} writing review${claimed.length === 1 ? "" : "s"}`,
        text: `AI Tutor completed ${claimed.length} writing review(s). Open Teacher > Students to inspect each student's daily usage and limit. Student writing is not included in email.`,
        html: summaryHtml(claimed),
      });
      await Promise.all(claimed.map((item) => db.collection(EVENTS).doc(item._id).update({ status: "sent", sent_at: new Date(), recipient_count: bcc.length, updated_at: new Date() })));
      return { success: true, processed: claimed.length, sent: claimed.length };
    } catch (error) {
      await Promise.all(claimed.map((item) => db.collection(EVENTS).doc(item._id).update({ status: "pending", last_error: text(error && error.message).slice(0, 500), updated_at: new Date() })));
      throw error;
    } finally {
      if (typeof transport.close === "function") transport.close();
    }
  } catch (error) {
    console.error("sendWritingTutorEmails failed", error);
    return { success: false, code: error.message || "WRITING_EMAIL_ERROR" };
  }
};
