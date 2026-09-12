#!/usr/bin/env node
"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");
const { database, seed, teacher, loadFunction } = require("./test-argue-email-review");
const writing = require("../cloudfunctions/_shared/writing-disputes");
const notifications = require("../cloudfunctions/_shared/argue-notifications");
const now = new Date();
const composition = { _id: "composition-1", composition_id: "composition-1", student_uid: "student-1",
  title: "Synthetic writing", revision: 1, status: "sentence_training",
  language_review: { sentences: [
    { sentence_id: "s001", original: "A synthetic first sentence.", rewrite_required: true, coaching_summary: "Synthetic feedback", reference_revision: "Synthetic reference" },
    { sentence_id: "s002", original: "A synthetic second sentence.", rewrite_required: true },
  ] },
  rewrite_results: { results: [{ sentence_id: "s001", student_rewrite: "A synthetic revision.", accepted: false, feedback: "Synthetic rejection" }],
    feedback_history: [{ operation_id: "old", results: [{ sentence_id: "s001", accepted: false }] }] },
};
const student = { auth_uid: "student-1" };
const current = (db) => db.rows("writing_compositions")[0];
function setup() { return database({ ...seed(null), writing_compositions: [composition] }); }
function event(c, operation = "first", id = "s001") {
  return { composition_id: c.composition_id, sentence_id: id, operation_id: operation, review_scope: writing.scope(c),
    submitted_answer: c.rewrite_results?.results?.find((r) => r.sentence_id === id)?.student_rewrite || c.language_review.sentences.find((s) => s.sentence_id === id).original };
}
async function request(db, operation = "first", id = "s001") {
  return writing.submit({ db, student, event: event(current(db), operation, id), now });
}
async function decide(db, id, decision) {
  return loadFunction("teacherAdmin", db, teacher.auth_uid).main({ action: "resolveDispute", dispute_id: id, decision, teacher_note: "Synthetic teacher note" });
}

// Run the real rewrite publication function while a teacher approves during the
// awaited model call. Only provider/telemetry dependencies are replaced.
async function lateModelPublication(db, approve) {
  db.command.set = (value) => value;
  const filename = path.resolve(__dirname, "../cloudfunctions/writingTutor/index.js");
  const originalRequire = createRequire(filename);
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, console, Buffer, Date, Intl, URL, setTimeout, clearTimeout, process,
    require(id) {
      if (id === "@cloudbase/node-sdk") return { init: () => ({ database: () => db }) };
      if (id.startsWith("@cloudbase/node-sdk/")) return {};
      return originalRequire(id);
    },
    model: async () => {
      await approve();
      return { data: { results: [{ sentence_id: "s001", accepted: false, feedback: "Late model rejection" }], overall_feedback: "Synthetic" }, metadata: {} };
    },
  });
  vm.runInContext(fs.readFileSync(filename, "utf8") + "\ncallModelForJob = model; module.exports.performRewriteJob = performRewriteJob; module.exports.hash = rewritePayloadHash;", context);
  const items = [{ sentence_id: "s001", text: "A synthetic revision." }];
  const hash = module.exports.hash(current(db), items);
  const job = { _id: "job", job_id: "job", student_uid: student.auth_uid, composition_id: composition.composition_id,
    composition_revision: 1, job_type: "rewrite", status: "processing", operation_id: "check", payload_hash: hash, lease_token: "synthetic-lease" };
  await db.collection("writing_ai_jobs").doc("job").create(job);
  await db.collection("writing_compositions").doc(composition._id).update({ active_job_id: "job", pending_rewrite_check: { operation_id: "check", payload_hash: hash, items } });
  return module.exports.performRewriteJob(student, job);
}

async function main() {
  const db = setup();
  await assert.rejects(writing.submit({ db, student: { auth_uid: "other" }, event: event(composition) }), /COMPOSITION_NOT_FOUND/);
  await assert.rejects(writing.submit({ db, student, event: { ...event(composition), submitted_answer: "Browser fabricated text" } }), /REVIEW_CHANGED/);
  const [first, duplicate] = await Promise.all([request(db), request(db, "duplicate-click")]);
  assert.equal(first.dispute_id, duplicate.dispute_id, "one unresolved request per current sentence");
  assert.equal(db.rows("answer_disputes").length, 1);
  assert.equal(db.rows("teacher_attempt_email_events").length, 1);
  assert.equal(db.rows("teacher_attempt_email_events")[0].submitted_answer, undefined, "outbox is metadata-only");
  const mail = [];
  await loadFunction("sendTeacherAttemptEmails", db, null, mail).main({ internal_token: "test-only-timer-token" });
  assert.equal(mail.length, 1);
  assert.match(mail[0].html, /decision=approve/);
  assert.match(mail[0].html, /decision=reject/);
  assert.match(mail[0].html, /Synthetic writing/);
  const review = await loadFunction("teacherAdmin", db, teacher.auth_uid).main({ action: "getDispute", dispute_id: first.dispute_id });
  assert.equal(review.success, true);
  assert.equal(review.dispute.dispute_type, "writing_sentence");
  for (const uid of ["", student.auth_uid]) {
    for (const action of ["getDispute", "resolveDispute"]) {
      const result = await loadFunction("teacherAdmin", db, uid).main({ action, dispute_id: first.dispute_id, decision: "approve", teacher_uid: teacher.auth_uid });
      assert.equal(result.success, false, "browser identity cannot grant teacher authority");
    }
  }
  assert.equal((await decide(db, first.dispute_id, "reject")).success, true);
  assert.equal(current(db).rewrite_results.results[0].accepted, false);
  assert.equal(current(db).status, "sentence_training");
  for (let i = 0; i < 3; i++) {
    const repeat = await request(db, `repeat-${i}`);
    assert.notEqual(repeat.dispute_id, first.dispute_id);
    assert.equal((await decide(db, repeat.dispute_id, "reject")).success, true);
  }
  const retry = await request(db, "approve-first");
  assert.equal((await decide(db, retry.dispute_id, "approve")).success, true);
  assert.equal(current(db).rewrite_results.results[0].teacher_approved, true);
  assert.equal(current(db).status, "sentence_training", "other incorrect sentences still block completion");
  const last = await request(db, "approve-last", "s002");
  const outcomes = await Promise.all([decide(db, last.dispute_id, "approve"), decide(db, last.dispute_id, "reject")]);
  assert.equal(outcomes.filter((r) => r.success).length, 1);
  assert.equal(current(db).status, "completed");
  assert.equal(current(db).rewrite_results.passed, true);
  assert.deepEqual(current(db).rewrite_results.feedback_history, composition.rewrite_results.feedback_history);
  assert.equal(db.rows("grading_key_history").length, 0);
  assert.equal(db.rows("attempts").length, 0);
  assert.equal(db.rows("answer_disputes").length, 6);
  const dashboardSource = fs.readFileSync(path.resolve(__dirname, "../cloudfunctions/getDashboard/index.js"), "utf8");
  const replySource = dashboardSource.slice(dashboardSource.indexOf("function disputeReplyView("), dashboardSource.indexOf("\nfunction ", dashboardSource.indexOf("function disputeReplyView(") + 1));
  const replyContext = vm.createContext({ disputeStatusLabel: () => "Approved", disputeSeen: () => false });
  vm.runInContext(replySource, replyContext);
  const studentReply = replyContext.disputeReplyView(db.rows("answer_disputes")[0], null);
  assert.equal(studentReply.answer_snapshot, null, "student reply history must not reveal AI reference revisions");
  assert.equal(studentReply.composition_id, composition.composition_id);
  assert.equal(studentReply.set_title, composition.title);
  await assert.rejects(request(db, "after-pass"), /NOT_INCORRECT/);

  const interrupted = setup();
  interrupted.failEvents = true;
  const saved = await request(interrupted);
  assert.equal(interrupted.rows("answer_disputes")[0].email_notification_status, "pending");
  interrupted.failEvents = false;
  await notifications.repairPendingEvents(interrupted);
  assert.equal(interrupted.rows("teacher_attempt_email_events").length, 1);
  await interrupted.collection("writing_compositions").doc(composition._id).update({ revision: 2 });
  assert.equal((await decide(interrupted, saved.dispute_id, "approve")).code, "DISPUTE_REVIEW_CHANGED");
  assert.equal((await decide(interrupted, saved.dispute_id, "reject")).success, true);

  const concurrent = setup();
  const pending = await request(concurrent);
  const published = await lateModelPublication(concurrent, async () => {
    assert.equal((await decide(concurrent, pending.dispute_id, "approve")).success, true);
  });
  assert.equal(published.status, "succeeded");
  assert.equal(current(concurrent).status, "sentence_training");
  assert.equal(current(concurrent).rewrite_results.results.find((r) => r.sentence_id === "s001").accepted, true);
  const second = await request(concurrent, "second", "s002");
  assert.equal((await decide(concurrent, second.dispute_id, "approve")).success, true);
  assert.equal(current(concurrent).rewrite_results.results.find((r) => r.sentence_id === "s002").accepted, true);
  assert.equal(writing.applyApprovals({ ...current(concurrent), revision: 2 }, {}).results.length, 0);
  const completing = setup();
  const beforeLast = await request(completing, "second", "s002");
  await decide(completing, beforeLast.dispute_id, "approve");
  const completingRequest = await request(completing);
  assert.equal((await lateModelPublication(completing, async () => {
    assert.equal((await decide(completing, completingRequest.dispute_id, "approve")).success, true);
  })).status, "superseded");
  assert.equal(current(completing).status, "completed");
  assert.equal(current(completing).active_job_id, null, "late failures and worker retries cannot reopen completed writing");
  console.log("Writing Argue tests passed: ownership, repeat requests, private mail, teacher authorization, stale scope, concurrency, preserved AI history and completion.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
