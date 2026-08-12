#!/usr/bin/env node

"use strict";

const assert = require("assert");
const Module = require("module");
const path = require("path");

process.env.TENCENTCLOUD_TCB_ENVID = "test-environment";

const groupIds = ["group-1", "group-2", "group-3", "group-4", "group-5"];
const questionIds = groupIds.map((groupId) => `${groupId}:1`);
const answers = Object.fromEntries(questionIds.map((questionId) => [questionId, "answer"]));
const collections = {
  students: [{
    _id: "student-profile",
    auth_uid: "student-uid",
    student_id: "student-login",
    role: "student",
    active: true,
  }],
  sets: [{
    _id: "set-record",
    set_id: "VOCAB-SESSION-TEST",
    section_id: "vocabulary",
    visible: true,
    passing_percentage: 90,
    mastery_percentage: 100,
  }],
  grading_keys: [{
    _id: "grading-record",
    set_id: "VOCAB-SESSION-TEST",
    grading_version: "1",
    answers,
    explanations: {},
  }],
  assignments: [],
  vocabulary_test_sessions: [],
  attempts: [],
  student_set_achievements: [],
  teacher_attempt_email_events: [],
};

let nextId = 1;

function matches(record, where) {
  return Object.entries(where || {}).every(([key, value]) => record[key] === value);
}

function collection(name) {
  const rows = collections[name] || (collections[name] = []);
  const state = { where: null, offset: 0, limit: null, order: null };
  const query = {
    where(where) {
      state.where = where;
      return query;
    },
    orderBy(field, direction) {
      state.order = { field, direction };
      return query;
    },
    skip(offset) {
      state.offset = offset;
      return query;
    },
    limit(limit) {
      state.limit = limit;
      return query;
    },
    async get() {
      let result = rows.filter((record) => matches(record, state.where));
      if (state.order) {
        const multiplier = state.order.direction === "desc" ? -1 : 1;
        result = result.slice().sort((left, right) => {
          const a = new Date(left[state.order.field] || 0).getTime();
          const b = new Date(right[state.order.field] || 0).getTime();
          return (a - b) * multiplier;
        });
      }
      const end = state.limit == null ? undefined : state.offset + state.limit;
      return { data: result.slice(state.offset, end) };
    },
    async count() {
      return { total: rows.filter((record) => matches(record, state.where)).length };
    },
    async add(record) {
      const stored = { ...record, _id: `${name}-${nextId++}` };
      rows.push(stored);
      return { id: stored._id };
    },
    doc(id) {
      return {
        async get() {
          const record = rows.find((item) => item._id === id);
          return { data: record ? [record] : [] };
        },
        async update(update) {
          const record = rows.find((item) => item._id === id);
          if (!record) throw new Error(`Missing ${name} record ${id}`);
          Object.assign(record, update);
          return { updated: 1 };
        },
        async set(record) {
          const existing = rows.find((item) => item._id === id);
          if (existing) Object.assign(existing, record);
          else rows.push({ ...record, _id: id });
          return { updated: existing ? 1 : 0, upserted: existing ? 0 : 1 };
        },
      };
    },
  };
  return query;
}

const db = { collection };
const app = {
  database() { return db; },
  auth() {
    return { async getUserInfo() { return { uid: "student-uid" }; } };
  },
};

const originalLoad = Module._load;
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === "@cloudbase/node-sdk") {
    return { SYMBOL_CURRENT_ENV: Symbol("current-env"), init: () => app };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const submitPath = path.resolve(__dirname, "../cloudfunctions/submitAttempt/index.js");
delete require.cache[submitPath];
const submitAttempt = require(submitPath);
Module._load = originalLoad;

function assignment(id, dueAt, status = "to_do") {
  return {
    _id: `doc-${id}`,
    assignment_id: id,
    student_uid: "student-uid",
    set_id: "VOCAB-SESSION-TEST",
    status,
    due_at: new Date(dueAt),
    created_at: new Date("2026-08-01T00:00:00.000Z"),
    passing_percentage: 90,
    mastery_percentage: 100,
    mastery_enabled: true,
  };
}

function sessionPayload(extra = {}) {
  return {
    set_id: "VOCAB-SESSION-TEST",
    content_version: "1",
    selected_group_count: groupIds.length,
    selected_group_ids: groupIds,
    question_ids: questionIds,
    _client_device_id: "device-1",
    _client_instance_id: "instance-1",
    ...extra,
  };
}

async function start(extra = {}) {
  return submitAttempt.main(sessionPayload({ action: "startVocabularyTestSession", ...extra }));
}

async function submit(session, extra = {}) {
  return submitAttempt.main(sessionPayload({
    mode: "vocabulary_test",
    test_session_id: session.test_session.test_session_id,
    answers,
    ...extra,
  }));
}

(async () => {
  const tiedDueAt = "2026-08-16T15:59:59.000Z";
  collections.assignments.push(
    assignment("assignment-a", tiedDueAt),
    assignment("assignment-b", tiedDueAt)
  );
  const tiedStart = await start();
  assert.equal(tiedStart.success, true);
  assert.equal(
    tiedStart.test_session.assignment_id,
    "assignment-b",
    "equal due dates must use a stable assignment ID tie-breaker"
  );

  collections.assignments.push(assignment("assignment-newer", "2026-08-23T15:59:59.000Z"));
  const tiedSubmit = await submit(tiedStart);
  assert.equal(tiedSubmit.success, true);
  assert.equal(
    tiedSubmit.assignment_id,
    "assignment-b",
    "submission must keep the assignment locked when the Quiz started"
  );

  collections.assignments.splice(0, collections.assignments.length);
  const selfStudyStart = await start();
  assert.equal(selfStudyStart.test_session.assignment_id, null);
  collections.assignments.push(assignment("assignment-created-during-quiz", "2026-08-30T15:59:59.000Z"));
  const selfStudySubmit = await submit(selfStudyStart);
  assert.equal(selfStudySubmit.success, true);
  assert.equal(
    selfStudySubmit.assignment_id,
    null,
    "a self-study Quiz must not attach to an assignment created after it started"
  );

  collections.assignments.splice(0, collections.assignments.length);
  const cancelled = assignment("assignment-cancelled-during-quiz", tiedDueAt);
  collections.assignments.push(cancelled);
  const cancelledStart = await start({ assignment_id: cancelled.assignment_id });
  cancelled.status = "cancelled";
  const originalConsoleError = console.error;
  console.error = () => {};
  const cancelledSubmit = await submit(cancelledStart, { assignment_id: cancelled.assignment_id });
  console.error = originalConsoleError;
  assert.equal(cancelledSubmit.success, false);
  assert.equal(cancelledSubmit.code, "VOCABULARY_TEST_ASSIGNMENT_CANCELLED");
  const cancelledSession = collections.vocabulary_test_sessions.find(
    (item) => item.test_session_id === cancelledStart.test_session.test_session_id
  );
  assert.equal(cancelledSession.status, "abandoned");
  assert.equal(cancelledSession.abandoned_reason, "assignment_cancelled");

  console.log("Vocabulary session assignment-lock tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
