#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");
const notifications = require("../cloudfunctions/_shared/argue-notifications");
const resolution = require("../cloudfunctions/_shared/argue-resolution");
const now = new Date("2026-09-06T06:00:00Z");
const clone = (value) => structuredClone(value);

// Serial, rollback-capable transactions let the tests exercise duplicate calls
// and failures between the grading transaction and its historical projections.
function database(seed = {}) {
  let tables = clone(seed);
  let sequence = 0;
  let queue = Promise.resolve();
  const matches = (row, query) => Object.entries(query || {}).every(([key, value]) =>
    value && typeof value === "object" && "$lte" in value ? new Date(row[key]) <= value.$lte : row[key] === value);
  const db = {
    command: { lte: (value) => ({ $lte: value }) },
    failEvents: false,
    collection(name) {
      const rows = () => tables[name] || (tables[name] = []);
      const query = (where = {}, offset = 0, limit = 500, ordering) => ({
        where: (next) => query(next, offset, limit, ordering),
        skip: (next) => query(where, next, limit, ordering),
        limit: (next) => query(where, offset, next, ordering),
        orderBy: (key, direction) => query(where, offset, limit, [key, direction]),
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

function fixture(overrides = {}) {
  return { _id: "dispute-1", dispute_id: "attempt-1::q1", student_uid: "student-1", requester_role: "student",
    set_id: "test-set", question_id: "q1", question_text_snapshot: "A synthetic question?",
    submitted_answer: "test alternate", answer_snapshot: "test original", student_reason: "Synthetic reason",
    status: "pending", created_at: now, updated_at: now, ...overrides };
}
const teacher = { _id: "teacher-1", auth_uid: "teacher-1", role: "teacher", active: true,
  attempt_email_recipients: [{ email_id: "mail-1", email: "teacher@example.test", enabled: true }] };
function seed(dispute = fixture()) {
  return { students: [teacher, { _id: "student-1", auth_uid: "student-1", role: "student", active: true, name: "Test Learner" }],
    sets: [{ _id: "set-1", set_id: "test-set", title: "Test Lesson" }],
    grading_keys: [{ _id: "key-1", set_id: "test-set", grading_version: "1", answers: { q1: "test original", q2: "unchanged" } }],
    answer_disputes: dispute ? [dispute] : [] };
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
      if (id === "@cloudbase/node-sdk") return { init: () => ({ database: () => db, auth: () => ({ getUserInfo: async () => ({ uid: authUid }) }) }) };
      if (id === "../_shared/cloudbase-user-manager") return { init: () => ({}) };
      if (id === "nodemailer") return { createTransport: () => ({ sendMail: async (message) => { mail.push(message); return { messageId: message.messageId }; }, close() {} }) };
      return originalRequire(id);
    },
  });
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return module.exports;
}

async function main() {
  const event = notifications.eventForDispute(fixture());
  assert.equal(event.event_kind, "student_argue");
  assert.equal(event.due_at.getTime(), now.getTime());
  assert(!("submitted_answer" in event));
  assert.equal(notifications.eventForDispute(fixture({ requester_role: "teacher" })), null);
  assert.equal(notifications.reviewUrl("https://example.test/teacher.html?old=1#notifications", "a::b&x=1"),
    "https://example.test/argue-review.html?dispute=a%3A%3Ab%26x%3D1");
  assert.throws(() => notifications.reviewUrl("javascript:alert(1)", "x"), /URL_NOT_CONFIGURED/);

  const db = database(seed(null));
  db.failEvents = true;
  await notifications.saveStudentDispute(db, fixture());
  assert.equal(db.rows("answer_disputes")[0].email_notification_status, "pending");
  db.failEvents = false;
  await notifications.repairPendingEvents(db);
  assert.equal(db.rows("teacher_attempt_email_events").length, 1);
  await notifications.saveStudentDispute(db, fixture());
  await notifications.repairPendingEvents(db);
  assert.equal(db.rows("teacher_attempt_email_events").length, 1, "duplicate submission never creates a second event");

  const rendered = notifications.renderEmail({ ...await notifications.loadContext(db, fixture().dispute_id),
    dispute: fixture({ student_reason: '<img src=x onerror="alert(1)">' }), teacherUrl: "https://example.test/teacher.html" });
  assert(rendered.html.includes("&lt;img"));
  assert(!rendered.html.includes("<img"));
  assert(rendered.html.includes("argue-review.html?dispute="));
  assert(rendered.text.includes("Teachers’ Note"));

  const messages = [];
  const sender = loadFunction("sendTeacherAttemptEmails", db, null, messages);
  const denied = await sender.main({});
  assert.equal(denied.success, false);
  assert.equal(messages.length, 0);
  const sent = await sender.main({ internal_token: "test-only-timer-token" });
  assert.equal(sent.sent_events, 1);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].bcc, ["teacher@example.test"]);
  assert.equal(messages[0].to, "undisclosed-recipients:;");
  await sender.main({ internal_token: "test-only-timer-token" });
  assert.equal(messages.length, 1);

  const admin = loadFunction("teacherAdmin", db, "teacher-1");
  const read = await admin.main({ action: "getDispute", dispute_id: fixture().dispute_id });
  assert.equal(read.success, true);
  assert.equal(read.dispute.review_revision, "1");
  assert.equal(read.dispute.current_answer, "test original");
  const studentRead = await loadFunction("teacherAdmin", db, "student-1").main({ action: "getDispute", dispute_id: fixture().dispute_id, teacher_uid: "teacher-1" });
  assert.equal(studentRead.success, false);
  const anonymousRead = await loadFunction("teacherAdmin", db, "").main({ action: "getDispute", dispute_id: fixture().dispute_id });
  assert.equal(anonymousRead.success, false);
  const disabled = database(seed());
  await disabled.collection("students").doc("teacher-1").update({ active: false });
  assert.equal((await loadFunction("teacherAdmin", disabled, "teacher-1").main({ action: "getDispute", dispute_id: fixture().dispute_id })).success, false);

  // Exercise the real student producer, teacher reader and ordinary regrade,
  // including the original immutable result and the student-facing reply.
  const endToEnd = database({ ...seed(null), attempts: [{
    _id: "attempt-doc", attempt_id: "attempt-1", student_uid: "student-1", set_id: "test-set",
    mode: "bbc", percentage: 0, question_count: 2, passing_percentage: 80, mastery_percentage: 95,
    question_results: [
      { question_id: "q1", submitted_answer: "test alternate", correct_answer: "test original", correct: false },
      { question_id: "q2", submitted_answer: "test wrong", correct: false },
    ],
  }] });
  const dashboard = loadFunction("getDashboard", endToEnd, "student-1");
  const submitted = await dashboard.main({ action: "submitDispute", attempt_id: "attempt-1", question_id: "q1", reason: "Test request", question_text: "Test prompt" });
  assert.equal(submitted.success, true);
  assert.equal(endToEnd.rows("teacher_attempt_email_events").length, 1);
  const endAdmin = loadFunction("teacherAdmin", endToEnd, "teacher-1");
  const accepted = await endAdmin.main({ action: "resolveDispute", dispute_id: submitted.dispute_id, decision: "add", teacher_note: "Accepted", expected_revision: "1" });
  assert.equal(accepted.success, true);
  assert.equal(endToEnd.rows("attempts")[0].percentage, 0, "original attempt stays unchanged");
  assert.equal(endToEnd.rows("attempts")[0].adjusted_percentage, 50);
  assert.equal(endToEnd.rows("answer_disputes")[0].student_seen, false);
  assert.equal(endToEnd.rows("answer_disputes")[0].teacher_note, "Accepted");
  const resolvedMail = [];
  await loadFunction("sendTeacherAttemptEmails", endToEnd, null, resolvedMail).main({ internal_token: "test-only-timer-token" });
  assert.equal(resolvedMail.length, 0, "requests resolved before dispatch are skipped");
  assert.equal(endToEnd.rows("teacher_attempt_email_events")[0].skip_reason, "DISPUTE_ALREADY_RESOLVED");

  for (const decision of ["keep", "provide"]) {
    const intensive = database({ ...seed(fixture({ dispute_type: "intensive_spelling_exemption", content_version: "1", unit_id: "unit-1", slot_id: "slot-1" })),
      intensive_listening_materials: [{ _id: "material-1", set_id: "test-set", content_version: "1", policy_revision: 1,
        units: [{ unit_id: "unit-1", slots: [{ slot_id: "slot-1", answer: "test word" }] }] }] });
    const intensiveAdmin = loadFunction("teacherAdmin", intensive, "teacher-1");
    assert.equal((await intensiveAdmin.main({ action: "getDispute", dispute_id: fixture().dispute_id })).dispute.review_revision, "1:1");
    const result = await intensiveAdmin.main({ action: "resolveDispute", dispute_id: fixture().dispute_id, decision, expected_revision: "1:1", teacher_note: "" });
    assert.equal(result.success, true);
    assert.equal(intensive.rows("answer_disputes")[0].status, decision === "keep" ? "rejected" : "approved");
    assert.equal(intensive.rows("intensive_listening_materials")[0].policy_revision, decision === "keep" ? 1 : 2);
  }

  for (const decision of ["keep", "add", "replace"]) {
    const store = database(seed());
    let regrades = 0;
    const args = { db: store, teacher, event: { dispute_id: fixture().dispute_id, decision, teacher_note: "Optional test note", expected_revision: "1" },
      nextVersion: (v) => String(Number(v) + 1), regrade: async () => { regrades++; return { scanned_attempt_count: 4, adjusted_attempt_count: 2 }; } };
    const outcomes = await Promise.allSettled([resolution.resolve(args), resolution.resolve(args)]);
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(store.rows("answer_disputes")[0].teacher_note, "Optional test note");
    assert.equal(store.rows("answer_disputes")[0].student_seen, false);
    assert.equal(regrades, decision === "keep" ? 0 : 1);
    assert.equal(store.rows("grading_key_history").length, decision === "keep" ? 0 : 1);
    const key = store.rows("grading_keys")[0];
    assert.equal(key.answers.q2, "unchanged");
    assert.deepEqual(key.answers.q1, decision === "keep" ? "test original" : decision === "add" ? ["test original", "test alternate"] : "test alternate");
  }

  const resumable = database(seed());
  let fail = true;
  const args = { db: resumable, teacher, event: { dispute_id: fixture().dispute_id, decision: "add", teacher_note: "", expected_revision: "1" },
    nextVersion: (v) => String(Number(v) + 1), regrade: async () => { if (fail) throw new Error("interrupted"); return { scanned_attempt_count: 2, adjusted_attempt_count: 1 }; } };
  await assert.rejects(resolution.resolve(args), /interrupted/);
  assert.equal(resumable.rows("grading_keys")[0].grading_version, "2");
  await assert.rejects(resolution.resolve({ ...args, event: { ...args.event, decision: "keep" } }), /DECISION_COMMITTED/);
  fail = false;
  await resolution.resolve(args);
  assert.equal(resumable.rows("grading_key_history").length, 1);
  assert.equal(resumable.rows("grading_keys")[0].grading_version, "2");
  assert.equal(resumable.rows("answer_disputes")[0].status, "approved");

  const stale = database(seed());
  await assert.rejects(resolution.resolve({ ...args, db: stale, event: { ...args.event, expected_revision: "0" } }), /REVIEW_CHANGED/);
  assert.equal(stale.rows("grading_key_history").length, 0);
  await assert.rejects(resolution.resolve({ ...args, db: stale, event: { ...args.event, decision: "provide" } }), /DECISION_REQUIRED/);
  const cancelled = database({ ...seed(fixture({ assignment_id: "cancelled" })), assignments: [{ _id: "cancelled", assignment_id: "cancelled", status: "cancelled" }] });
  await assert.rejects(notifications.loadContext(cancelled, fixture().dispute_id), /NOT_AVAILABLE/);
  await assert.rejects(resolution.resolve({ ...args, db: cancelled }), /NOT_AVAILABLE/);

  const muted = database(seed(null));
  await muted.collection("students").doc("teacher-1").update({ attempt_email_recipients: [] });
  await notifications.saveStudentDispute(muted, fixture());
  const mutedMail = [];
  await loadFunction("sendTeacherAttemptEmails", muted, null, mutedMail).main({ internal_token: "test-only-timer-token" });
  assert.equal(mutedMail.length, 0);
  assert.equal(muted.rows("teacher_attempt_email_events")[0].skip_reason, "NO_ENABLED_TEACHER_EMAIL");
  await muted.collection("students").doc("teacher-1").update({ attempt_email_recipients: teacher.attempt_email_recipients });
  await loadFunction("sendTeacherAttemptEmails", muted, null, mutedMail).main({ internal_token: "test-only-timer-token" });
  assert.equal(mutedMail.length, 0, "re-enabling an inbox never backfills skipped mail");

  console.log("Argue email/review tests passed: outbox recovery, SMTP routing, authentication, decisions, concurrency, retries and stale reviews.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
