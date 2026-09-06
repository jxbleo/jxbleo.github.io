#!/usr/bin/env node
"use strict";
const assert = require("assert/strict");
const { database, fixture, seed, loadFunction, teacher } = require("./test-argue-email-review");
const reminders = require("../cloudfunctions/_shared/argue-reminders");
const day1 = new Date("2026-09-06T23:59:59+08:00");
const before = new Date("2026-09-07T11:29:59+08:00");
const due = new Date("2026-09-07T11:30:00+08:00");
const day3 = new Date("2026-09-08T11:30:00+08:00");
const make = (patch = {}) => database(seed(fixture({ created_at: day1, ...patch })));
const send = (db, messages) => loadFunction("sendTeacherAttemptEmails", db, null, messages)._test.dispatch;
async function main() {
  assert.equal(reminders.reminderWindow(before).ready, false);
  assert.equal(reminders.reminderWindow(due).ready, true);
  assert.equal(reminders.reminderWindow(due).day, "2026-09-07");
  assert.equal(reminders.reminderWindow(new Date("2026-12-31T16:00:00Z")).day, "2027-01-01");
  assert.equal(reminders.reminderWindow(new Date("2028-02-29T03:30:00Z")).day, "2028-02-29");
  const db = make(); const mail = []; const dispatch = send(db, mail);
  await dispatch(day1); await dispatch(before);
  assert.equal(mail.length, 0, "never on creation day or before next-day 11:30 Shanghai");
  await Promise.all([dispatch(due), dispatch(due)]);
  assert.equal(mail.length, 1, "overlapping timers send only one reminder");
  assert(mail[0].subject.startsWith("提醒处理 | "));
  assert(mail[0].html.includes("处理后将停止每日提醒"));
  assert(mail[0].html.includes("argue-review.html?dispute="));
  assert.deepEqual(mail[0].bcc, ["teacher@example.test"]);
  await dispatch(new Date("2026-09-07T23:59:00+08:00"));
  await dispatch(new Date("2026-09-08T11:29:59+08:00"));
  assert.equal(mail.length, 1);
  await dispatch(day3); assert.equal(mail.length, 2);
  const resolved = await loadFunction("teacherAdmin", db, "teacher-1").main({ action: "resolveDispute", dispute_id: fixture().dispute_id, decision: "keep", teacher_note: "Resolved on the shared Teacher API" });
  assert.equal(resolved.success, true);
  await dispatch(new Date("2026-09-09T11:30:00+08:00"));
  assert.equal(mail.length, 2, "Teacher webpage resolution stops reminders too");
  for (const status of ["approved", "rejected"]) {
    const stopped = make({ status }); await send(stopped, [])(due);
    assert.equal(stopped.rows("teacher_attempt_email_events").length, 0);
  }
  for (const patch of [{ requester_role: "teacher" }, { created_at: due }]) {
    const ignored = make(patch); await send(ignored, [])(due);
    assert.equal(ignored.rows("teacher_attempt_email_events").length, 0);
  }
  for (const kind of ["deleted", "cancelled"]) {
    const unavailable = make(kind === "cancelled" ? { assignment_id: "cancelled" } : {});
    if (kind === "deleted") await unavailable.collection("students").doc("student-1").update({ deleted: true });
    else await unavailable.collection("assignments").add({ assignment_id: "cancelled", status: "cancelled" });
    await send(unavailable, [])(due);
    assert.equal(unavailable.rows("teacher_attempt_email_events").length, 0);
    assert.equal(unavailable.rows("answer_disputes")[0].email_reminder_day, "2026-09-07");
  }
  const unfinished = make({ resolution_decision: "add", resolution_note: "Saved before regrade failed", resolution_token: null });
  const unfinishedMail = [];
  await send(unfinished, unfinishedMail)(due);
  assert.equal(unfinishedMail.length, 1, "a failed/incomplete regrade stays pending and must still be reminded");
  const queued = make(); const queuedMail = [];
  await reminders.queueDailyReminders(queued, due);
  await queued.collection("answer_disputes").doc("dispute-1").update({ status: "approved", decision: "add" });
  await send(queued, queuedMail)(due);
  assert.equal(queuedMail.length, 0, "recheck the latest decision just before delivery");
  assert.equal(queued.rows("teacher_attempt_email_events")[0].skip_reason, "DISPUTE_ALREADY_RESOLVED");
  const recovery = make(); recovery.failEvents = true;
  await assert.rejects(reminders.queueDailyReminders(recovery, due), /outbox unavailable/);
  assert.equal(recovery.rows("answer_disputes")[0].email_reminder_day, undefined, "rollback preserves tomorrow's retry");
  recovery.failEvents = false; await reminders.queueDailyReminders(recovery, due);
  assert.equal(recovery.rows("teacher_attempt_email_events").length, 1);
  const many = database({ ...seed(null), answer_disputes: Array.from({ length: 51 }, (_, i) => fixture({ _id: `dispute-${i}`, dispute_id: `attempt-${i}::q1`, created_at: day1 })) });
  assert.equal(await reminders.queueDailyReminders(many, due), 20);
  assert.equal(await reminders.queueDailyReminders(many, due), 20);
  assert.equal(await reminders.queueDailyReminders(many, due), 11);
  assert.equal(await reminders.queueDailyReminders(many, due), 0);
  assert.equal(many.rows("teacher_attempt_email_events").length, 51);
  const stale = make(); const staleMail = [];
  await reminders.queueDailyReminders(stale, due);
  await send(stale, staleMail)(day3);
  assert.equal(staleMail.length, 1, "yesterday's delayed retry expires instead of piling up with today's reminder");
  assert.equal(stale.rows("teacher_attempt_email_events").filter((r) => r.status === "skipped")[0].skip_reason, "ARGUE_REMINDER_EXPIRED");
  const muted = make(); const mutedMail = [];
  await muted.collection("students").doc("teacher-1").update({ attempt_email_recipients: [] });
  await send(muted, mutedMail)(due);
  await muted.collection("students").doc("teacher-1").update({ attempt_email_recipients: teacher.attempt_email_recipients });
  await send(muted, mutedMail)(due); assert.equal(mutedMail.length, 0);
  await send(muted, mutedMail)(day3); assert.equal(mutedMail.length, 1);
  const intensive = make({ dispute_type: "intensive_spelling_exemption" }); const intensiveMail = [];
  await send(intensive, intensiveMail)(due);
  assert.equal(intensiveMail.length, 1);
  assert(intensiveMail[0].text.includes("Requested Provided Word"));
  console.log("Argue reminders passed: Shanghai next-day 11:30, calendar rollover, concurrency, multi-day repeats, paging, resolution checks, recovery, expiry, muted inboxes and Listening.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
