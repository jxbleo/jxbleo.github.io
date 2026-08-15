#!/usr/bin/env node

"use strict";

const assert = require("assert");
const Module = require("module");
const path = require("path");
const rules = require("../cloudfunctions/_shared/parent-mode");

const now = new Date();
const period = rules.weekPeriod(now);
const dueAt = new Date(Math.min(period.end_at.getTime(), now.getTime() + 3600000));
const startedAt = new Date(period.start_at.getTime() - 86400000);

const rows = {
  parent_view_sessions: [],
  students: [
    { _id: "student-a", auth_uid: "uid-a", role: "student", active: true, chinese_name: "王小美", english_name: "Alice", name: "王小美Alice" },
    { _id: "student-b", auth_uid: "uid-b", role: "student", active: true, chinese_name: "李大卫", english_name: "David", name: "李大卫David" },
  ],
  classes: [{ _id: "class-doc", class_id: "class-a", name: "Class A", active: true }],
  class_memberships: [
    { _id: "member-a", class_id: "class-a", student_uid: "uid-a", active: true, started_at: startedAt, ended_at: null },
    { _id: "member-b", class_id: "class-a", student_uid: "uid-b", active: true, started_at: startedAt, ended_at: null },
  ],
  sets: [{ _id: "set-doc", set_id: "BBC-test", title: "BBC Test", visible: true, passing_percentage: 80, mastery_percentage: 95 }],
  assignments: [
    {
      _id: "assignment-a-doc", assignment_id: "assignment-a", student_uid: "uid-a", set_id: "BBC-test",
      assignment_scope: "class", class_id: "class-a", class_task_id: "class-task-1", due_at: dueAt,
      passing_percentage: 80, mastery_percentage: 95, mastery_enabled: true, status: "passed", answer_revealed: false,
    },
    {
      _id: "assignment-b-doc", assignment_id: "assignment-b", student_uid: "uid-b", set_id: "BBC-test",
      assignment_scope: "class", class_id: "class-a", class_task_id: "class-task-1", due_at: dueAt,
      passing_percentage: 80, mastery_percentage: 95, mastery_enabled: true, status: "passed", answer_revealed: false,
    },
  ],
  attempts: [
    {
      _id: "attempt-a1-doc", attempt_id: "attempt-a1", attempt_number: 1, student_uid: "uid-a", set_id: "BBC-test",
      assignment_id: "assignment-a", percentage: 60, passed: false, submitted_at: new Date(period.start_at.getTime() + 3600000), duration_seconds: 120,
      question_results: [{ question_id: "1", submitted_answer: "wrong", correct: false, correct_answer: "right", explanation: "Because." }],
    },
    {
      _id: "attempt-a2-doc", attempt_id: "attempt-a2", attempt_number: 2, student_uid: "uid-a", set_id: "BBC-test",
      assignment_id: "assignment-a", percentage: 85, passed: true, submitted_at: new Date(period.start_at.getTime() + 7200000), duration_seconds: 110,
      question_results: [{ question_id: "1", submitted_answer: "still wrong", correct: false, correct_answer: "right", explanation: "Because." }],
    },
    {
      _id: "attempt-b1-doc", attempt_id: "attempt-b1", attempt_number: 1, student_uid: "uid-b", set_id: "BBC-test",
      assignment_id: "assignment-b", percentage: 90, passed: true, submitted_at: new Date(period.start_at.getTime() + 3600000), duration_seconds: 90,
      question_results: [],
    },
  ],
};

function matches(record, where) {
  return Object.entries(where || {}).every(([key, expected]) => {
    if (expected && Array.isArray(expected.__in)) return expected.__in.includes(record[key]);
    return record[key] === expected;
  });
}

function collection(name) {
  if (!rows[name]) throw new Error(`Unexpected collection ${name}`);
  const state = { where: null, offset: 0, limit: null };
  const query = {
    where(where) { state.where = where; return query; },
    orderBy() { return query; },
    skip(offset) { state.offset = offset; return query; },
    limit(limit) { state.limit = limit; return query; },
    async get() {
      const filtered = rows[name].filter((record) => matches(record, state.where));
      const end = state.limit == null ? undefined : state.offset + state.limit;
      return { data: filtered.slice(state.offset, end) };
    },
    doc(id) {
      return {
        async update(update) {
          const record = rows[name].find((item) => item._id === id);
          if (!record) throw new Error(`Missing ${name} ${id}`);
          Object.assign(record, update);
          return { updated: 1 };
        },
      };
    },
    async add(record) {
      const stored = { ...record, _id: `${name}-${rows[name].length + 1}` };
      rows[name].push(stored);
      return { id: stored._id };
    },
  };
  return query;
}

const db = {
  command: { in(values) { return { __in: values }; } },
  collection,
};

const cloudbaseMock = {
  SYMBOL_CURRENT_ENV: "test",
  getCloudbaseContext() { return { TCB_SOURCE_IP: "127.0.0.1" }; },
  init() { return { database() { return db; } }; },
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "@cloudbase/node-sdk") return cloudbaseMock;
  return originalLoad.call(this, request, parent, isMain);
};
const servicePath = path.resolve(__dirname, "../cloudfunctions/parentMode/index.js");
delete require.cache[servicePath];
const service = require(servicePath);
Module._load = originalLoad;

async function main() {
  const originalError = console.error;
  console.error = () => {};
  const device = "device-test";
  const failed = await service.main({ action: "login", chinese_name: "王小美", english_name: "Wrong", _client_device_id: device });
  assert.equal(failed.code, "PARENT_STUDENT_MISMATCH");

  const login = await service.main({ action: "login", chinese_name: "王小美", english_name: "  ALICE ", _client_device_id: device });
  assert.equal(login.success, true);
  assert(login.session_token.length >= 32);
  assert.equal(rows.parent_view_sessions.filter((item) => item.record_type === "parent_session").length, 1);

  const auth = { session_token: login.session_token, _client_device_id: device };
  const overview = await service.main({ action: "overview", ...auth });
  assert.equal(overview.success, true);
  assert.equal(overview.tasks.length, 1);
  assert.equal(overview.tasks[0].best_percentage, 85);
  assert.equal(overview.tasks[0].status, "qualified");

  const matrix = await service.main({ action: "classMatrix", scope: "week", ...auth });
  assert.equal(matrix.success, true);
  assert.equal(matrix.tasks.length, 1);
  assert.equal(matrix.students[0].own_student, true, "own child is fixed in first column");
  assert.equal(matrix.students[1].best_percentage, undefined, "student aggregate does not expose an extra score field");
  assert.equal(matrix.students[1].cells[0].best_percentage, 90, "peer task best score is visible");
  assert.equal(matrix.students[1].cells[0].assignment_id, null, "peer assignment locators are not exposed");

  const detail = await service.main({ action: "taskDetail", assignment_id: "assignment-a", ...auth });
  assert.equal(detail.success, true);
  assert.equal(detail.attempts.length, 2, "all attempt bars are returned");
  assert.equal(Object.hasOwn(detail.attempts[0], "question_results"), false);

  const hidden = await service.main({ action: "attemptReview", attempt_id: "attempt-a1", assignment_id: "assignment-a", ...auth });
  assert.equal(hidden.success, true);
  assert.equal(hidden.attempt.feedback_available, false);
  assert.equal(hidden.attempt.wrong_answers[0].correct_answer, null);

  const revealedByPass = await service.main({ action: "attemptReview", attempt_id: "attempt-a2", assignment_id: "assignment-a", ...auth });
  assert.equal(revealedByPass.attempt.feedback_available, true);
  assert.equal(revealedByPass.attempt.wrong_answers[0].correct_answer, "right");

  const foreign = await service.main({ action: "taskDetail", assignment_id: "assignment-b", ...auth });
  assert.equal(foreign.code, "PARENT_TASK_NOT_FOUND", "session cannot open a peer task detail");

  const logout = await service.main({ action: "logout", ...auth });
  assert.equal(logout.success, true);
  const expired = await service.main({ action: "overview", ...auth });
  assert.equal(expired.code, "PARENT_SESSION_INVALID");
  console.error = originalError;
  console.log("Parent Mode service contract tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
