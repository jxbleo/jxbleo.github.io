"use strict";

const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");
const nodemailer = require("nodemailer");
const teacherEmailSettings = require("../_shared/teacher-email-settings");
const writingReportEmail = require("../_shared/writing-report-email");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const EVENTS = "writing_teacher_email_events";
const DISPATCH_LIMIT = 50;
const COMPLETION_SCAN_LIMIT = 40;
const COMPLETION_CURSOR_ID = "writing-report-completion-cursor";

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
  const alerts = events.filter((event) => event.event_type === "model_usage_alert");
  const reviews = events.filter((event) => event.event_type !== "model_usage_alert");
  const alertRows = alerts.map((event) => `<tr><td>${escapeHtml(event.job_type || "unknown")}</td><td>${escapeHtml((event.alert_reasons || []).join(", "))}</td><td>${escapeHtml((event.models || []).join(", ") || "—")}</td><td>${escapeHtml((event.stages || []).join(", ") || "—")}</td><td>${Number(event.job_attempt_count || 0)}</td></tr>`).join("");
  const reviewRows = reviews.map((event) => `<tr><td>${escapeHtml(event.student_name || event.student_id || "Student")}</td><td>${escapeHtml(event.mode === "standardized_content" ? "标化考试内容批改" : "通用语言批改")}</td><td>${escapeHtml(event.rubric_id || "—")}</td><td>${Number(event.word_count || 0)}</td><td>${escapeHtml(event.day_key || "")}</td></tr>`).join("");
  return `${alerts.length ? `<p><strong>Token telemetry needs attention for ${alerts.length} AI writing job${alerts.length === 1 ? "" : "s"}.</strong> The model request may have completed without a usable Token record. Inspect writing_ai_jobs and writing_model_usage_events using the job ID from the event.</p><table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Job type</th><th>Reason</th><th>Model</th><th>Stage</th><th>Attempts</th></tr></thead><tbody>${alertRows}</tbody></table>` : ""}${reviews.length ? `<p>AI Tutor has completed ${reviews.length} writing review${reviews.length === 1 ? "" : "s"}.</p><table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Student</th><th>Mode</th><th>Framework</th><th>Words</th><th>Shanghai day</th></tr></thead><tbody>${reviewRows}</tbody></table>` : ""}<p>This notice contains operational metadata only; student writing is not included.</p>`;
}

async function repairCompletedReports() {
  const cursorResult = await db.collection(EVENTS).where({ event_id: COMPLETION_CURSOR_ID }).limit(1).get();
  const cursorRow = cursorResult.data && cursorResult.data[0];
  const after = text(cursorRow && cursorRow.after_id);
  let query = db.collection(EVENTS);
  if (after) query = query.where({ _id: db.command.gt(after) });
  const page = await query.orderBy("_id", "asc").limit(COMPLETION_SCAN_LIMIT).get();
  const rows = page.data || [];
  for (const first of rows) {
    if (first.event_type !== "writing_report" || first.report_phase !== "first"
      || first.completion_watch !== true) continue;
    const found = await db.collection("writing_compositions")
      .where({ composition_id: first.composition_id, student_uid: first.student_uid }).limit(1).get();
    const composition = found.data && found.data[0];
    if (!composition || composition.status !== "completed") continue;
    const finalId = writingReportEmail.eventId(first.composition_id, "complete");
    await writingReportEmail.enqueue(db, first, composition, "complete", {}, "general_language");
    const finalResult = await db.collection(EVENTS).where({ event_id: finalId }).limit(1).get();
    if (finalResult.data && finalResult.data.length) {
      await db.collection(EVENTS).doc(first._id).update({ completion_watch: false, updated_at: new Date() });
    }
  }
  const next = rows.length === COMPLETION_SCAN_LIMIT ? rows[rows.length - 1]._id : "";
  if (cursorRow) await db.collection(EVENTS).doc(COMPLETION_CURSOR_ID).update({ after_id: next, updated_at: new Date() });
  else await db.collection(EVENTS).doc(COMPLETION_CURSOR_ID).create({
    event_id: COMPLETION_CURSOR_ID, status: "cursor", after_id: next, created_at: new Date(), updated_at: new Date(),
  });
}

exports.main = async (event = {}) => {
  try {
    authorize(event);
    try { await repairCompletedReports(); }
    catch (error) { console.error("Writing completion report repair deferred", error && error.message); }
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
      const alerts = claimed.filter((item) => item.event_type === "model_usage_alert");
      const reviews = claimed.filter((item) => item.event_type !== "model_usage_alert");
      await Promise.all(alerts.map((item) => db.collection(EVENTS).doc(item._id).update({ status: "pending", last_error: "NO_ENABLED_TEACHER_RECIPIENTS", updated_at: new Date() })));
      await Promise.all(reviews.map((item) => db.collection(EVENTS).doc(item._id).update({ status: "skipped", skip_reason: "NO_ENABLED_TEACHER_RECIPIENTS", updated_at: new Date() })));
      return { success: true, processed: claimed.length, sent: 0, skipped: reviews.length, alerts_pending: alerts.length };
    }
    const config = smtpConfig();
    const transport = nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    });
    try {
      let sent = 0;
      let failed = 0;
      for (const item of claimed) {
        try {
          if (item.event_type !== "writing_report" && item.event_type !== "model_usage_alert") {
            await db.collection(EVENTS).doc(item._id).update({
              status: "skipped", skip_reason: "SUPERSEDED_BY_WRITING_REPORT_POLICY", updated_at: new Date(),
            });
            continue;
          }
          const message = item.event_type === "writing_report"
            ? writingReportEmail.render(item)
            : { subject: "Mr. Cat AI Tutor · Token telemetry alert",
                text: "AI writing Token telemetry needs attention. Inspect the metadata-only alert event in CloudBase.",
                html: summaryHtml([item]) };
          await transport.sendMail({ from: config.from, to: config.from, bcc, ...message });
          await db.collection(EVENTS).doc(item._id).update({
            status: "sent", sent_at: new Date(), recipient_count: bcc.length, updated_at: new Date(),
          });
          sent += 1;
        } catch (error) {
          failed += 1;
          await db.collection(EVENTS).doc(item._id).update({
            status: "pending", last_error: text(error && error.message).slice(0, 500), updated_at: new Date(),
          });
        }
      }
      return { success: failed === 0, processed: claimed.length, sent, failed };
    } finally {
      if (typeof transport.close === "function") transport.close();
    }
  } catch (error) {
    console.error("sendWritingTutorEmails failed", error);
    return { success: false, code: error.message || "WRITING_EMAIL_ERROR" };
  }
};
