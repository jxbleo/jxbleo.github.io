#!/usr/bin/env node

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const notifications = require("../cloudfunctions/_shared/attempt-email-notifications");
const teacherEmailSettings = require("../cloudfunctions/_shared/teacher-email-settings");

const root = path.resolve(__dirname, "..");
const baseTime = new Date("2026-08-11T11:30:00.000Z");

function attempt(overrides = {}) {
  return {
    attempt_id: "attempt-1",
    student_uid: "student-1",
    student_id_snapshot: "leo",
    set_id: "BBC-260806",
    assignment_id: "assignment-1",
    mode: "bbc",
    attempt_number: 1,
    percentage: 60,
    passing_percentage: 80,
    mastery_percentage: 95,
    mastery_enabled: true,
    passed: false,
    mastered: false,
    submitted_at: baseTime,
    duration_seconds: 420,
    question_results: [
      { question_id: "Blank_01", submitted_answer: "cat", correct: false },
      { question_id: "Blank_02", submitted_answer: "dog", correct: true },
    ],
    ...overrides,
  };
}

const bbcEvent = notifications.eventForAttempt(attempt(), baseTime);
assert.strictEqual(bbcEvent.delivery_policy, notifications.EMAIL_POLICIES.BBC_BATCH);
assert.strictEqual(new Date(bbcEvent.due_at).getTime() - baseTime.getTime(), 7 * 60 * 1000);
assert.strictEqual(bbcEvent.thread_key, "student-1::assignment::assignment-1");

const vocabularyEvent = notifications.eventForAttempt(attempt({
  attempt_id: "attempt-vocab-1",
  assignment_id: null,
  set_id: "NGSL-A",
  mode: "vocabulary_test",
}), baseTime);
assert.strictEqual(vocabularyEvent.delivery_policy, notifications.EMAIL_POLICIES.VOCABULARY_IMMEDIATE);
assert.strictEqual(new Date(vocabularyEvent.due_at).getTime(), baseTime.getTime());
assert.strictEqual(vocabularyEvent.thread_key, "student-1::self-study::NGSL-A");

assert(notifications.eventForAttempt(attempt({ mode: "vocabulary_practice" }), baseTime) === null);
assert(notifications.eventForAttempt(attempt({ mode: "ielts_reading" }), baseTime) === null);

assert.strictEqual(teacherEmailSettings.normalizeEmail("  Teacher@Example.COM "), "teacher@example.com");
assert.strictEqual(teacherEmailSettings.normalizeEmail("not-an-email"), "");
assert.strictEqual(teacherEmailSettings.normalizeEmail("one@example.com,two@example.com"), "");
assert.deepStrictEqual(teacherEmailSettings.enabledTeacherEmailAddresses([
  { attempt_email_recipients: [
    { email_id: "email-1", email: "one@example.com", enabled: true },
    { email_id: "email-2", email: "two@example.com", enabled: false },
  ] },
  { attempt_email_recipients: [
    { email_id: "email-3", email: "ONE@example.com", enabled: true },
    { email_id: "email-4", email: "three@example.com", enabled: true },
  ] },
]), ["one@example.com", "three@example.com"]);

const gradingKey = {
  answers: { Blank_01: "lion", Blank_02: "dog" },
  explanations: { Blank_01: "The transcript uses lion.", Blank_02: "Already correct." },
};
const first = notifications.attemptDetail(attempt(), gradingKey);
const second = notifications.attemptDetail(attempt({
  attempt_id: "attempt-2",
  attempt_number: 2,
  percentage: 85,
  passed: true,
  submitted_at: new Date(baseTime.getTime() + 4 * 60 * 1000),
  question_results: [
    { question_id: "Blank_01", submitted_answer: "lion", correct: true },
    { question_id: "Question_03", question_text_snapshot: "What changed?", submitted_answer: "A", correct: false },
  ],
}), {
  answers: { Question_03: "B" },
  explanations: { Question_03: "The second option matches the transcript." },
});

const rendered = notifications.renderAttemptEmail({
  policy: notifications.EMAIL_POLICIES.BBC_BATCH,
  student: { student_id: "leo", chinese_name: "李奥", english_name: "Leo" },
  set: { set_id: "BBC-260806", title: "A BBC lesson" },
  assignment: { passing_percentage: 80, mastery_percentage: 95, mastery_enabled: true },
  attempts: [first, second],
  newAttemptIds: ["attempt-1", "attempt-2"],
  teacherUrl: "https://example.test/teacher.html",
});

assert.strictEqual(rendered.subject, "李奥Leo | A BBC lesson | Best 85%");
assert(rendered.html.indexOf(">#2</strong>") < rendered.html.indexOf(">#1</strong>"));
assert(rendered.text.indexOf("Attempt #2") < rendered.text.indexOf("Attempt #1"));
assert(rendered.html.includes(">#1</strong>"));
assert(rendered.html.includes(">#2</strong>"));
assert(rendered.html.includes("60%"));
assert(rendered.html.includes("85%"));
assert(rendered.html.includes("Q1"));
assert(rendered.html.includes("<strong>Submitted</strong><br>cat"));
assert(rendered.html.includes("<strong>Expected</strong><br>lion"));
assert(rendered.html.includes("The transcript uses lion."));
assert(rendered.html.includes("Q3 · What changed?"));
assert(!rendered.html.includes("Q2"));
assert(!rendered.html.includes("Already correct."));
assert(!rendered.html.includes("MR. CAT ACADEMY"));
assert(!rendered.html.includes("Login ID"));
assert(!rendered.html.includes("Open Teacher notifications"));
assert(!rendered.html.includes("<a "));
assert(rendered.html.includes('<meta charset="utf-8">'));
assert(rendered.html.includes("Best 85%"));
assert(rendered.html.includes("PASS 80%"));
assert(rendered.html.includes("STAR 95%"));
assert(rendered.html.includes("background:#fff2f3"));
assert(rendered.html.includes("background:#f6f2ff"));

const vocabularySecondEmail = notifications.renderAttemptEmail({
  policy: notifications.EMAIL_POLICIES.VOCABULARY_IMMEDIATE,
  student: { student_id: "amy", name: "Amy" },
  set: { set_id: "NGSL-A", title: "NGSL A" },
  assignment: null,
  attempts: [
    notifications.attemptDetail(attempt({
      attempt_id: "vocab-1",
      assignment_id: null,
      set_id: "NGSL-A",
      mode: "vocabulary_test",
      percentage: 70,
      selected_group_count: 5,
      selected_group_ids: ["group-1", "group-2", "group-3", "group-4", "group-5"],
    }), {}),
    notifications.attemptDetail(attempt({
      attempt_id: "vocab-2",
      assignment_id: null,
      set_id: "NGSL-A",
      mode: "vocabulary_test",
      attempt_number: 2,
      percentage: 90,
      passed: true,
      submitted_at: new Date(baseTime.getTime() + 12 * 60 * 1000),
      selected_group_count: 5,
      selected_group_ids: ["group-1", "group-2", "group-3", "group-4", "group-5"],
    }), {}),
  ],
  newAttemptIds: ["vocab-2"],
});
assert(vocabularySecondEmail.html.includes(">#1</strong>"));
assert(vocabularySecondEmail.html.includes(">#2</strong>"));
assert(vocabularySecondEmail.html.indexOf(">#2</strong>") < vocabularySecondEmail.html.indexOf(">#1</strong>"));
assert.strictEqual(vocabularySecondEmail.subject, "Amy | NGSL A | Best 90%");
assert(vocabularySecondEmail.html.includes("70%"));
assert(vocabularySecondEmail.html.includes("90%"));
assert(vocabularySecondEmail.html.includes("5 sets"));

const submitSource = fs.readFileSync(path.join(root, "cloudfunctions/submitAttempt/index.js"), "utf8");
const dispatcherSource = fs.readFileSync(path.join(root, "cloudfunctions/sendTeacherAttemptEmails/index.js"), "utf8");
const teacherAdminSource = fs.readFileSync(path.join(root, "cloudfunctions/teacherAdmin/index.js"), "utf8");
const teacherFrontendSource = fs.readFileSync(path.join(root, "assets/js/teacher.js"), "utf8");
assert(submitSource.includes("eventForAttempt(attempt, submittedAt)"));
assert(submitSource.includes("Email delivery is deliberately isolated from grading"));
assert(dispatcherSource.includes("db.runTransaction"));
assert(dispatcherSource.includes("TEACHER_ATTEMPT_EMAIL_CRON_TOKEN"));
assert(dispatcherSource.includes("TEACHER_ATTEMPT_SMTP_PASS"));
assert(dispatcherSource.includes("inReplyTo"));
assert(dispatcherSource.includes("STALE_PROCESSING_CLAIM_RECOVERED"));
assert(dispatcherSource.includes("messageId: deterministicMessageId"));
assert(dispatcherSource.includes('to: "undisclosed-recipients:;"'));
assert(dispatcherSource.includes("bcc: recipients"));
assert(dispatcherSource.includes("NO_ENABLED_TEACHER_EMAIL"));
assert(!dispatcherSource.includes("process.env.TEACHER_ATTEMPT_EMAIL_TO"));
assert(teacherAdminSource.includes('action === "getTeacherEmailSettings"'));
assert(teacherAdminSource.includes('action === "addTeacherEmail"'));
assert(teacherAdminSource.includes("function randomRecordId(prefix)"));
assert(teacherAdminSource.includes('action === "setTeacherEmailEnabled"'));
assert(teacherAdminSource.includes('action === "deleteTeacherEmail"'));
assert(teacherFrontendSource.includes("data-teacher-email-toggle"));
assert(teacherFrontendSource.includes("EMAIL NOTIFICATIONS"));
assert(!teacherFrontendSource.includes("data-teacher-email-delete"));

console.log("Attempt email notification tests passed.");
