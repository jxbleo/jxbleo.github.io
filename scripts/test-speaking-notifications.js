#!/usr/bin/env node
"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");
const notifications = require("../cloudfunctions/_shared/speaking-notifications");
const clone = value => structuredClone(value);
const now = new Date();
// Serial, rollback-capable transactions let the tests exercise duplicate calls
// and failures between the grading transaction and its historical projections.
function database(seed = {}) {
  let tables = clone(seed);
  let sequence = 0;
  let queue = Promise.resolve();
  const matches = (row, query) => Object.entries(query || {}).every(([key, value]) =>
    value && typeof value === "object" && "$gt" in value ? new Date(row[key]) > value.$gt
      : value && typeof value === "object" && "$lte" in value ? new Date(row[key]) <= value.$lte
      : value && typeof value === "object" && "$lt" in value ? new Date(row[key]) < value.$lt
        : value && typeof value === "object" && "$neq" in value ? row[key] !== value.$neq : row[key] === value);
  const db = {
    command: { gt: (value) => ({ $gt: value }), lte: (value) => ({ $lte: value }), lt: (value) => ({ $lt: value }), neq: (value) => ({ $neq: value }) },
    failEvents: false,
    collection(name) {
      const rows = () => tables[name] || (tables[name] = []);
      const query = (where = {}, offset = 0, limit = 500, ordering) => ({
        where: (next) => query(next, offset, limit, ordering),
        skip: (next) => query(where, next, limit, ordering),
        limit: (next) => query(where, offset, next, ordering),
        orderBy: (key, direction) => query(where, offset, limit, [key, direction]),
        field: () => query(where, offset, limit, ordering),
        async get() {
          let found = rows().filter((row) => matches(row, where));
          if (ordering) found = found.slice().sort((a, b) => (a[ordering[0]] > b[ordering[0]] ? 1 : -1) * (ordering[1] === "desc" ? -1 : 1));
          return { data: clone(found.slice(offset, offset + limit)) };
        },
      });
      return {
        ...query(),
        doc(id) { return {
          async create(value) {
            if (name === "teacher_attempt_email_events" && db.failEvents) throw new Error("outbox unavailable");
            if (rows().some((row) => row._id === id)) throw new Error("document already exists");
            rows().push({ ...clone(value), _id: id });
            return { id };
          },
          async update(value) {
            const row = rows().find((item) => item._id === id);
            if (!row) throw new Error("missing document " + name);
            Object.assign(row, clone(value));
          },
        }; },
        async add(value) { const id = "new-" + ++sequence; rows().push({ ...clone(value), _id: id }); return { id }; },
      };
    },
    runTransaction(fn) {
      const run = queue.then(async () => {
        const previous = clone(tables);
        try { return await fn(db); } catch (error) { tables = previous; throw error; }
      });
      queue = run.catch(() => {});
      return run;
    },
    rows(name) { return clone(tables[name] || []); },
  };
  return db;
}

function loadFunction(name, db, authUid, mail = []) {
  const filename = path.resolve(__dirname, "../cloudfunctions", name, "index.js");
  const originalRequire = createRequire(filename);
  const module = { exports: {} };
  const environment = {
    TEACHER_ATTEMPT_EMAIL_CRON_TOKEN: "test-only-timer-token",
    TEACHER_ATTEMPT_SMTP_HOST: "smtp.example.test", TEACHER_ATTEMPT_SMTP_USER: "test@example.test",
    TEACHER_ATTEMPT_SMTP_PASS: "synthetic-test-value", TEACHER_ATTEMPT_EMAIL_TEACHER_URL: "https://example.test/teacher.html",
  };
  const context = vm.createContext({ module, exports: module.exports, console: { error() {}, log() {} }, Buffer, URL, Date, Intl,
    process: { env: environment }, setTimeout, clearTimeout,
    require(id) {
      if (id === "@cloudbase/node-sdk") return { init: () => ({ getTempFileURL: async () => ({ fileList: [{ tempFileURL: "https://audio.example.test/private" }] }), database: () => db, auth: () => ({ getUserInfo: async () => ({ uid: authUid }) }) }) };
      if (id === "../_shared/cloudbase-user-manager") return { init: () => ({}) };
      if (id === "nodemailer") return { createTransport: () => ({ sendMail: async (message) => { if (mail.fail) throw new Error("SMTP_TEST_FAILURE"); mail.push(message); return { messageId: message.messageId }; }, close() {} }) };
      return originalRequire(id);
    },
  });
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return module.exports;
}

const teacher = { _id: "teacher", auth_uid: "teacher", role: "teacher", active: true,
  attempt_email_recipients: [{ email_id: "mail-1", email: "teacher@example.test", enabled: true }] };
function seed() {
  const individual = ["individual", "p2", "p3"].map((id, i) => ({ _id: id, response_session_id: id, student_uid: "student", student_name_snapshot: "Test Student", title: "Synthetic topic <script>", set_id: "test-set", exam_family: i ? "ielts" : "dse", question_snapshot: { part: i === 2 ? 3 : 2, text: "Test question" }, active_report_version: "r1", deleted_at: null }));
  const reports = ["group", ...individual.map(s => s.response_session_id)].map((id, i) => ({
    _id: "report-" + id, report_id: "report-" + id, report_version: "r1", status: "ready", job_id: "job-" + id,
    ...(i ? { response_session_id: id } : { discussion_id: id }),
    teacher_notification_status: "pending", updated_at: now, finished_at: now,
    transcript: { duration_ms: 65000, segments: [{ segment_id: "s1", speaker_key: "spk_01", start_ms: 0, end_ms: 1000, text: "PRIVATE TRANSCRIPT" }] },
    ...(i > 1 ? { ielts_analysis: { summary_zh: "PRIVATE ANALYSIS", domains: {}, transcript: [] } } : { dse_analysis: { summary_zh: "PRIVATE ANALYSIS", group_summary_zh: "PRIVATE GROUP", candidates: [{ speaker_key: "spk_01", summary_zh: "PRIVATE STUDENT" }], domains: {}, transcript: [] } }),
  }));
  return { students: [teacher, { _id: "student", auth_uid: "student", student_id: "test", name: "Test Student", role: "student", active: true }],
    speaking_individual_responses: individual, speaking_reports: reports,
    speaking_discussions: [{ _id: "group", discussion_id: "group", title: "Synthetic group", active_report_version: "r1", deleted_at: null }],
    speaking_participants: [{ _id: "pending", discussion_id: "group", student_uid: "student", matched_speaker_key: "spk_01", display_name_snapshot: "DO NOT NAME UNCONFIRMED", identity_status: "unconfirmed" }],
    speaking_ai_jobs: reports.map(row => ({ _id: row.job_id, job_id: row.job_id, formal_audio_asset_id: "asset-" + row.report_id })),
    speaking_audio_assets: reports.map(row => ({ _id: "asset-" + row.report_id, asset_id: "asset-" + row.report_id, discussion_id: row.discussion_id, response_session_id: row.response_session_id, status: "uploaded", file_id: "cloud://private-audio" })),
  };
}
async function main() {
  const db = database(seed());
  const pendingReport = db.rows("speaking_reports")[0];
  assert.equal(notifications.eventForReport({ ...pendingReport, status: "processing" }, {}), null);
  db.failEvents = true;
  await notifications.enqueueSafely(db, pendingReport);
  assert.equal(db.rows("speaking_reports")[0].status, "ready", "outbox failure leaves report ready");
  assert.equal(db.rows("speaking_reports")[0].teacher_notification_status, "pending");
  db.failEvents = false;
  await Promise.all([notifications.repairPendingEvents(db), notifications.repairPendingEvents(db)]);
  assert.equal(db.rows("teacher_attempt_email_events").length, 4, "concurrent repairs queue once per report");
  assert(db.rows("speaking_reports").every(row => row.teacher_notification_status === "queued"));
  const events = db.rows("teacher_attempt_email_events");
  assert.equal(new Set(events.map(e => e.thread_key)).size, 4);
  assert(events.some(e => e.notification_label === "IELTS Speaking · Part 3"));
  assert(!JSON.stringify(events).includes("PRIVATE"), "outbox has no transcript, analysis or audio");
  await notifications.enqueueSafely(db, pendingReport);
  assert.equal(db.rows("teacher_attempt_email_events").length, 4);

  const gateway = loadFunction("speakingLab", db, "teacher");
  for (const event of events) {
    const result = await gateway.main({ action: "getTeacherSpeakingReport", report_id: event.report_id });
    assert.equal(result.success, true, result.code);
    assert.equal(result.report.report_id, event.report_id);
    assert(!JSON.stringify(result).includes("cloud://"));
    const audio = await gateway.main({ action: "getTeacherSpeakingAudio", report_id: event.report_id });
    assert.equal(audio.success, true, audio.code);
    assert.equal(audio.audio_url, "https://audio.example.test/private");
    const context = await notifications.loadContext(db, event.report_id);
    const email = notifications.renderEmail({ ...context, teacherUrl: "https://example.test/teacher.html?old=x#bell" });
    assert(email.text.includes("speaking-review.html?report=" + event.report_id));
    assert(!email.html.includes("<script>"));
    assert(!email.text.includes("PRIVATE"));
    assert(!email.text.includes("DO NOT NAME UNCONFIRMED"));
  }
  const studentGateway = loadFunction("speakingLab", db, "student");
  for (const action of ["getTeacherSpeakingReport", "getTeacherSpeakingAudio"]) {
    assert.equal((await studentGateway.main({ action, report_id: "report-individual", role: "teacher", auth_uid: "teacher" })).code, "TEACHER_REQUIRED");
    assert.equal((await loadFunction("speakingLab", db, "").main({ action, report_id: "report-group" })).code, "AUTH_REQUIRED");
  }
  await db.collection("students").doc("teacher").update({ active: false });
  assert.equal((await gateway.main({ action: "getTeacherSpeakingReport", report_id: "report-group" })).success, false);
  await db.collection("students").doc("teacher").update({ active: true });

  const admin = loadFunction("teacherAdmin", db, "teacher");
  let activity = await admin.main({ action: "getActivityState" });
  assert.equal(activity.success, true, activity.code);
  assert.equal(activity.unread_thread_count, 4);
  const feed = await admin.main({ action: "listAttemptNotifications" });
  assert.equal(feed.success, true, feed.code);
  assert.equal(feed.speaking_events.length, 4);
  assert.equal(feed.intensive_events.length, 0);
  assert(!JSON.stringify(feed).includes("PRIVATE"));

  const mail = [];
  const dispatcher = loadFunction("sendTeacherAttemptEmails", db, "", mail);
  await Promise.all([dispatcher._test.dispatch(now), dispatcher._test.dispatch(now)]);
  assert.equal(mail.length, 4, "parallel timers claim each event once");
  assert(mail.every(item => item.bcc.length === 1 && item.bcc[0] === "teacher@example.test"));
  assert.equal((await admin.main({ action: "getActivityState" })).unread_thread_count, 4, "sending mail does not read bell");
  await admin.main({ action: "markActivityAttemptsReviewed", attempt_ids: [events[0].event_id] });
  assert.equal((await admin.main({ action: "getActivityState" })).unread_thread_count, 3);
  await admin.main({ action: "markActivityAttemptsReadAll" });
  assert.equal((await admin.main({ action: "getActivityState" })).unread_thread_count, 0);

  const unavailable = database(seed());
  await notifications.repairPendingEvents(unavailable);
  await unavailable.collection("speaking_discussions").doc("group").update({ deleted_at: now });
  const hiddenGateway = loadFunction("speakingLab", unavailable, "teacher");
  assert.equal((await hiddenGateway.main({ action: "getTeacherSpeakingReport", report_id: "report-group" })).code, "SPEAKING_REPORT_NOT_AVAILABLE");
  const remainingMail = [];
  await loadFunction("sendTeacherAttemptEmails", unavailable, "", remainingMail)._test.dispatch(now);
  assert.equal(remainingMail.length, 3, "deleted Discussion skipped at delivery");
  assert.equal(unavailable.rows("teacher_attempt_email_events").find(e => e.report_id === "report-group").status, "skipped");

  const muted = database(seed());
  await notifications.repairPendingEvents(muted);
  await muted.collection("students").doc("teacher").update({ attempt_email_recipients: [] });
  const mutedMail = [];
  await loadFunction("sendTeacherAttemptEmails", muted, "", mutedMail)._test.dispatch(now);
  assert.equal(mutedMail.length, 0);
  assert(muted.rows("teacher_attempt_email_events").every(row => row.status === "skipped"));
  await muted.collection("students").doc("teacher").update({ attempt_email_recipients: teacher.attempt_email_recipients });
  await loadFunction("sendTeacherAttemptEmails", muted, "", mutedMail)._test.dispatch(now);
  assert.equal(mutedMail.length, 0, "enabling inboxes does not backfill skipped mail");
  // Only newly published reports carry a durable notification intent.
  const legacy = database(seed());
  for (const row of legacy.rows("speaking_reports")) await legacy.collection("speaking_reports").doc(row._id).update({ teacher_notification_status: undefined });
  assert.equal(await notifications.repairPendingEvents(legacy), 0);
  assert.equal(legacy.rows("teacher_attempt_email_events").length, 0);

  const retries = database(seed());
  await notifications.repairPendingEvents(retries);
  const retryMail = []; retryMail.fail = true;
  const retryDispatcher = loadFunction("sendTeacherAttemptEmails", retries, "", retryMail);
  await retryDispatcher._test.dispatch(now);
  assert(retries.rows("teacher_attempt_email_events").every(e => e.status === "pending" && e.retry_count === 1));
  retryMail.fail = false;
  await retryDispatcher._test.dispatch(new Date(now.getTime() + 3600000));
  assert.equal(retryMail.length, 4);
  assert(retries.rows("teacher_attempt_email_events").every(e => e.status === "sent"));

  // Mixed feed preserves the existing ten-thread page size and raw cursors.
  const pages = database(seed());
  for (let i = 0; i < 15; i++) {
    const e = { ...events[1], event_id: "page-" + i, report_id: "page-report-" + i, thread_key: "speaking::page-" + i, occurred_at: new Date(now.getTime() - i * 1000) };
    await pages.collection("teacher_attempt_email_events").doc(e.event_id).create(e);
  }
  await pages.collection("attempts").doc("attempt-1").create({ attempt_id: "attempt-1", student_uid: "student", set_id: "BBC-test", mode: "bbc", submitted_at: now });
  await pages.collection("teacher_attempt_email_events").doc("listening").create({ event_id: "listening", event_kind: "intensive_listening_session", student_uid: "student", set_id: "IL-test", thread_key: "listening-test", occurred_at: now });
  const pageAdmin = loadFunction("teacherAdmin", pages, "teacher");
  let cursor = null, keys = [], pageCount = 0;
  do {
    const page = await pageAdmin.main({ action: "listAttemptNotifications", cursor, exclude_thread_keys: keys });
    assert.equal(page.success, true, page.code);
    assert(page.thread_keys.length <= 10);
    keys.push(...page.thread_keys); cursor = page.next_cursor;
    assert(++pageCount < 10, "pagination must advance");
  } while (cursor);
  assert.equal(keys.length, 17); assert.equal(new Set(keys).size, 17);
  assert(keys.includes("listening-test"));
  console.log("Speaking notifications: four modes, recovery, concurrency, private report/audio authorization, mail routing, read state and deletion passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
