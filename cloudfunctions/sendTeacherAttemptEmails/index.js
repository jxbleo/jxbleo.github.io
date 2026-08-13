"use strict";

const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");
const nodemailer = require("nodemailer");
const notifications = require("../_shared/attempt-email-notifications");
const teacherEmailSettings = require("../_shared/teacher-email-settings");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const _ = db.command;
const EVENT_COLLECTION = notifications.EVENT_COLLECTION;
const READ_PAGE_LIMIT = 500;
const DISPATCH_LIMIT = 20;
const MAX_RETRIES = 5;
const CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function compact(value, limit = 500) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, limit);
}

function dateValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function recordData(record) {
  return record && record.data && typeof record.data === "object" ? record.data : record;
}

async function getOne(collection, where) {
  const result = await db.collection(collection).where(where).limit(1).get();
  return result.data && result.data[0] ? recordData(result.data[0]) : null;
}

async function getAll(collection, where) {
  let offset = 0;
  const output = [];
  while (true) {
    let query = db.collection(collection);
    if (where) query = query.where(where);
    const result = await query.skip(offset).limit(READ_PAGE_LIMIT).get();
    const rows = (result.data || []).map(recordData);
    output.push(...rows);
    if (rows.length < READ_PAGE_LIMIT) break;
    offset += READ_PAGE_LIMIT;
  }
  return output;
}

function timerToken(event) {
  const direct = text(event && event.internal_token);
  if (direct) return direct;
  const message = text(event && event.Message);
  if (!message) return "";
  try {
    const parsed = JSON.parse(message);
    if (typeof parsed === "string") return text(parsed);
    if (parsed && typeof parsed === "object" && parsed.internal_token != null) return text(parsed.internal_token);
    return message;
  } catch (_) {
    return message;
  }
}

function authorizedTimerEvent(event) {
  const expected = text(process.env.TEACHER_ATTEMPT_EMAIL_CRON_TOKEN);
  if (!expected) throw new Error("ATTEMPT_EMAIL_CRON_NOT_CONFIGURED");
  if (timerToken(event) !== expected) throw new Error("ATTEMPT_EMAIL_CRON_UNAUTHORIZED");
}

function smtpConfiguration() {
  const host = text(process.env.TEACHER_ATTEMPT_SMTP_HOST);
  const port = Number(process.env.TEACHER_ATTEMPT_SMTP_PORT || 465);
  const user = text(process.env.TEACHER_ATTEMPT_SMTP_USER);
  const pass = text(process.env.TEACHER_ATTEMPT_SMTP_PASS);
  const from = text(process.env.TEACHER_ATTEMPT_EMAIL_FROM) || user;
  if (!host || !Number.isInteger(port) || port <= 0 || !user || !pass || !from) {
    throw new Error("ATTEMPT_EMAIL_SMTP_NOT_CONFIGURED");
  }
  const secureSetting = text(process.env.TEACHER_ATTEMPT_SMTP_SECURE).toLowerCase();
  const secure = secureSetting ? secureSetting === "true" : port === 465;
  return { host, port, user, pass, from, secure };
}

async function enabledRecipients() {
  const teachers = await getAll("students", { role: "teacher", active: true });
  return teacherEmailSettings.enabledTeacherEmailAddresses(teachers);
}

function createTransport(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

async function dueEvents(now) {
  const result = await db.collection(EVENT_COLLECTION).where({
    status: "pending",
    due_at: _.lte(now),
  }).orderBy("due_at", "asc").limit(DISPATCH_LIMIT).get();
  return (result.data || []).map(recordData);
}

async function recoverStaleClaims(now) {
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);
  const result = await db.collection(EVENT_COLLECTION).where({
    status: "processing",
    processing_started_at: _.lte(staleBefore),
  }).limit(DISPATCH_LIMIT).get();
  const staleJobs = (result.data || []).map(recordData);
  let recovered = 0;
  for (const staleJob of staleJobs) {
    await db.runTransaction(async (transaction) => {
      const currentResult = await transaction.collection(EVENT_COLLECTION).where({
        event_id: text(staleJob.event_id || staleJob.attempt_id || staleJob._id),
      }).limit(1).get();
      const current = currentResult.data && currentResult.data[0] ? recordData(currentResult.data[0]) : null;
      if (!current || current.status !== "processing" || dateValue(current.processing_started_at) > staleBefore.getTime()) return;
      await transaction.collection(EVENT_COLLECTION).doc(current._id).update({
        status: "pending",
        due_at: now,
        processing_token: null,
        processing_started_at: null,
        last_error: "STALE_PROCESSING_CLAIM_RECOVERED",
        updated_at: now,
      });
      recovered += 1;
    });
  }
  return recovered;
}

async function claimEventBatch(anchor, now) {
  const claimToken = crypto.randomUUID();
  let claimed = null;
  await db.runTransaction(async (transaction) => {
    const currentResult = await transaction.collection(EVENT_COLLECTION).where({
      event_id: text(anchor.event_id || anchor.attempt_id || anchor._id),
    }).limit(1).get();
    const current = currentResult.data && currentResult.data[0] ? recordData(currentResult.data[0]) : null;
    if (!current || current.status !== "pending" || dateValue(current.due_at) > now.getTime()) return;

    let jobs = [current];
    if (current.delivery_policy === notifications.EMAIL_POLICIES.BBC_BATCH) {
      const windowEnd = new Date(current.window_ends_at || current.due_at);
      const batchResult = await transaction.collection(EVENT_COLLECTION).where({
        thread_key: current.thread_key,
        status: "pending",
        submitted_at: _.lte(windowEnd),
      }).limit(100).get();
      jobs = (batchResult.data || []).map(recordData)
        .filter((job) => dateValue(job.submitted_at) >= dateValue(current.window_started_at))
        .sort((left, right) => dateValue(left.submitted_at) - dateValue(right.submitted_at));
      if (!jobs.some((job) => job.event_id === current.event_id)) jobs.unshift(current);
    }

    for (const job of jobs) {
      await transaction.collection(EVENT_COLLECTION).doc(job._id).update({
        status: "processing",
        processing_token: claimToken,
        processing_started_at: now,
        updated_at: now,
      });
    }
    claimed = { jobs, claimToken };
  });
  return claimed;
}

async function assignmentForJob(job) {
  if (!job.assignment_id) return null;
  return await getOne("assignments", { assignment_id: job.assignment_id })
    || await getOne("assignments", { _id: job.assignment_id });
}

async function attemptThreadForJob(job, cutoffAt) {
  const where = job.assignment_id
    ? { student_uid: job.student_uid, assignment_id: job.assignment_id }
    : { student_uid: job.student_uid, set_id: job.set_id };
  return (await getAll("attempts", where))
    .filter((attempt) => job.assignment_id || !attempt.assignment_id)
    .filter((attempt) => dateValue(attempt.submitted_at) <= cutoffAt.getTime())
    .sort((left, right) => dateValue(left.submitted_at) - dateValue(right.submitted_at));
}

async function emailContext(claimed) {
  const jobs = claimed.jobs;
  const anchor = jobs[0];
  const cutoffAt = anchor.delivery_policy === notifications.EMAIL_POLICIES.BBC_BATCH
    ? new Date(anchor.window_ends_at || anchor.due_at)
    : new Date(Math.max(...jobs.map((job) => dateValue(job.submitted_at))));
  const [student, set, assignment, gradingKey, rawAttempts, threadEvents] = await Promise.all([
    getOne("students", { auth_uid: anchor.student_uid }),
    getOne("sets", { set_id: anchor.set_id }),
    assignmentForJob(anchor),
    getOne("grading_keys", { set_id: anchor.set_id }),
    attemptThreadForJob(anchor, cutoffAt),
    anchor.delivery_policy === notifications.EMAIL_POLICIES.BBC_BATCH
      ? getAll(EVENT_COLLECTION, { thread_key: anchor.thread_key })
      : Promise.resolve([]),
  ]);
  if (!student || student.deleted === true || student.deleted_at) throw new Error("ATTEMPT_EMAIL_STUDENT_NOT_AVAILABLE");
  if (!set) throw new Error("ATTEMPT_EMAIL_SET_NOT_FOUND");
  if (!rawAttempts.length) throw new Error("ATTEMPT_EMAIL_THREAD_EMPTY");
  // Only BBC's seven-minute batches continue an SMTP conversation. Every
  // Vocabulary Quiz/Practice submission must appear as a separate mailbox
  // message, while its body still projects the cumulative attempt history.
  const previousMessage = threadEvents
    .filter((item) => item.status === "sent" && text(item.provider_message_id))
    .sort((left, right) => dateValue(right.sent_at) - dateValue(left.sent_at))[0];
  return {
    policy: anchor.delivery_policy,
    student,
    set,
    assignment,
    attempts: rawAttempts.map((attempt) => notifications.attemptDetail(attempt, gradingKey)),
    newAttemptIds: jobs.map((job) => text(job.attempt_id)).filter(Boolean),
    teacherUrl: text(process.env.TEACHER_ATTEMPT_EMAIL_TEACHER_URL),
    previousMessageId: previousMessage && text(previousMessage.provider_message_id),
  };
}

async function finishJobs(claimed, messageId, now) {
  for (const job of claimed.jobs) {
    await db.collection(EVENT_COLLECTION).doc(job._id).update({
      status: "sent",
      sent_at: now,
      provider_message_id: compact(messageId, 300),
      processing_token: null,
      last_error: "",
      updated_at: now,
    });
  }
}

async function skipJobsWithoutRecipients(claimed, now) {
  for (const job of claimed.jobs) {
    await db.collection(EVENT_COLLECTION).doc(job._id).update({
      status: "skipped",
      skipped_at: now,
      skip_reason: "NO_ENABLED_TEACHER_EMAIL",
      processing_token: null,
      last_error: "",
      updated_at: now,
    });
  }
}

async function failJobs(claimed, error, now) {
  const errorText = compact(error && (error.code || error.message) || "ATTEMPT_EMAIL_SEND_ERROR");
  for (const job of claimed.jobs) {
    const retries = Number(job.retry_count || 0) + 1;
    const terminal = retries >= MAX_RETRIES;
    const retryDelayMs = Math.min(30 * 60 * 1000, Math.pow(2, retries - 1) * 60 * 1000);
    await db.collection(EVENT_COLLECTION).doc(job._id).update({
      status: terminal ? "failed" : "pending",
      retry_count: retries,
      due_at: terminal ? job.due_at : new Date(now.getTime() + retryDelayMs),
      processing_token: null,
      last_error: errorText,
      last_failed_at: now,
      updated_at: now,
    });
  }
}

function deterministicMessageId(claimed, config) {
  const eventIds = claimed.jobs
    .map((job) => text(job.event_id || job.attempt_id || job._id))
    .filter(Boolean)
    .sort()
    .join("|");
  const digest = crypto.createHash("sha256").update(eventIds).digest("hex").slice(0, 32);
  const configuredDomain = text(config.user).split("@").at(-1);
  const domain = configuredDomain && configuredDomain !== config.user
    ? configuredDomain.replace(/[^a-zA-Z0-9.-]/g, "")
    : "mrcat-academy.invalid";
  return `<mrcat-${digest}@${domain || "mrcat-academy.invalid"}>`;
}

async function sendClaimedBatch(claimed, transporter, config, recipients, now) {
  try {
    const context = await emailContext(claimed);
    const rendered = notifications.renderAttemptEmail(context);
    const mail = {
      from: config.from,
      // Keep allowlisted inboxes private from one another while retaining one
      // SMTP envelope and one bounded retry state for this event batch.
      to: "undisclosed-recipients:;",
      bcc: recipients,
      replyTo: text(process.env.TEACHER_ATTEMPT_EMAIL_REPLY_TO) || config.from,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      messageId: deterministicMessageId(claimed, config),
      headers: {
        "X-Mr-Cat-Thread": text(claimed.jobs[0].thread_key),
      },
    };
    if (context.policy === notifications.EMAIL_POLICIES.BBC_BATCH && context.previousMessageId) {
      mail.inReplyTo = context.previousMessageId;
      mail.references = context.previousMessageId;
    }
    const result = await transporter.sendMail(mail);
    await finishJobs(claimed, result && result.messageId || mail.messageId, now);
    return { success: true, event_count: claimed.jobs.length };
  } catch (error) {
    await failJobs(claimed, error, now);
    console.error("Teacher attempt email batch failed", {
      event_count: claimed.jobs.length,
      code: error && (error.code || error.message) || "ATTEMPT_EMAIL_SEND_ERROR",
    });
    return { success: false, event_count: claimed.jobs.length };
  }
}

async function dispatch(now) {
  const recovered = await recoverStaleClaims(now);
  const anchors = await dueEvents(now);
  const recipients = await enabledRecipients();
  const summary = {
    recovered,
    scanned: anchors.length,
    enabled_recipients: recipients.length,
    sent_batches: 0,
    sent_events: 0,
    skipped_batches: 0,
    skipped_events: 0,
    failed_batches: 0,
  };
  if (!recipients.length) {
    for (const anchor of anchors) {
      const claimed = await claimEventBatch(anchor, now);
      if (!claimed || !claimed.jobs.length) continue;
      await skipJobsWithoutRecipients(claimed, now);
      summary.skipped_batches += 1;
      summary.skipped_events += claimed.jobs.length;
    }
    return summary;
  }
  const config = smtpConfiguration();
  const transporter = createTransport(config);
  try {
    for (const anchor of anchors) {
      const claimed = await claimEventBatch(anchor, now);
      if (!claimed || !claimed.jobs.length) continue;
      const result = await sendClaimedBatch(claimed, transporter, config, recipients, now);
      if (result.success) {
        summary.sent_batches += 1;
        summary.sent_events += result.event_count;
      } else {
        summary.failed_batches += 1;
      }
    }
  } finally {
    if (typeof transporter.close === "function") transporter.close();
  }
  return summary;
}

exports.main = async (event = {}) => {
  try {
    authorizedTimerEvent(event);
    const summary = await dispatch(new Date());
    return { success: true, ...summary };
  } catch (error) {
    const code = error && error.message || "ATTEMPT_EMAIL_DISPATCH_ERROR";
    console.error("sendTeacherAttemptEmails failed", { code });
    return {
      success: false,
      code,
      message: code === "ATTEMPT_EMAIL_SMTP_NOT_CONFIGURED"
        ? "Teacher attempt SMTP delivery is not configured."
        : code === "ATTEMPT_EMAIL_CRON_NOT_CONFIGURED" || code === "ATTEMPT_EMAIL_CRON_UNAUTHORIZED"
          ? "Teacher attempt email timer is not authorized."
          : "Unable to dispatch teacher attempt emails.",
    };
  }
};

module.exports._test = {
  authorizedTimerEvent,
  deterministicMessageId,
  smtpConfiguration,
};
