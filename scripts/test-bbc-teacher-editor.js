#!/usr/bin/env node
"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");
const editor = require("../cloudfunctions/_shared/bbc-editor");
const resolution = require("../cloudfunctions/_shared/argue-resolution");
const clone = value => structuredClone(value);
function database(seed = {}) {
  let tables = clone(seed);
  let sequence = 0;
  let queue = Promise.resolve();
  const matches = (row, query) => Object.entries(query || {}).every(([key, value]) =>
    value && typeof value === "object" && "$lte" in value ? new Date(row[key]) <= value.$lte
      : value && typeof value === "object" && "$lt" in value ? new Date(row[key]) < value.$lt
        : value && typeof value === "object" && "$neq" in value ? row[key] !== value.$neq : row[key] === value);
  const db = {
    command: { lte: (value) => ({ $lte: value }), lt: (value) => ({ $lt: value }), neq: (value) => ({ $neq: value }) },
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
  const teacher = { _id: "teacher", auth_uid: "teacher", role: "teacher", active: true };
  const db = database({ students: [teacher, { _id: "student", auth_uid: "student", role: "student", active: true }],
    sets: [{ _id: "set", set_id: "BBC-QA", type: "bbc-six-minute-english", visible: true }],
    grading_keys: [{ _id: "key", set_id: "BBC-QA", grading_version: "1", answers: { q1: "original", q2: "B" }, explanations: { q1: "Original explanation" } }] });
  const event = { action: "saveBbcContent", set_id: "BBC-QA", expected_revision: "1", request_id: "save-synthetic-0001",
    changes: [{ question_id: "q1", sentence: "An edited _____ question.", explanation: "Edited private explanation" }] };
  for (const uid of [null, "student"]) {
    const denied = await loadFunction("teacherAdmin", db, uid).main(event);
    assert.equal(denied.success, false, "a query flag never grants teacher access");
    assert.equal((await loadFunction("teacherAdmin", db, uid).main({ action: "getBbcEditor", set_id: "BBC-QA" })).success, false);
    assert.equal((await loadFunction("teacherAdmin", db, uid).main({ action: "acceptBbcAnswer", set_id: "BBC-QA" })).success, false);
  }
  const api = loadFunction("teacherAdmin", db, "teacher");
  await db.collection("students").doc("teacher").update({ active: false });
  assert.equal((await api.main(event)).success, false, "disabled teachers cannot save");
  await db.collection("students").doc("teacher").update({ active: true });
  assert.equal((await api.main({ action: "getBbcEditor", set_id: "BBC-QA" })).grading_version, "1");
  const saved = await api.main(event);
  assert.equal(saved.success, true); assert.equal(saved.grading_version, "2");
  assert.equal((await api.main(event)).success, true, "transport retry is idempotent");
  assert.equal(db.rows("grading_key_history").length, 1);
  assert.deepEqual(db.rows("grading_keys")[0].answers, { q1: "original", q2: "B" });
  assert.equal(db.rows("attempts").length, 0);
  const publicRead = await loadFunction("getResources", db, null).main({ action: "getBbcContent", set_id: "BBC-QA" });
  assert.deepEqual(JSON.parse(JSON.stringify(publicRead)), { success: true, overrides: { q1: { sentence: "An edited _____ question." } } });
  assert.equal((await api.main({ ...event, request_id: "save-synthetic-0002" })).code, "BBC_EDIT_CONFLICT");
  const bad = async (changes, code) => assert.equal((await api.main({ ...event, expected_revision: "2", request_id: "save-synthetic-0003", changes })).code, code);
  await bad([{ ...event.changes[0], sentence: "No blank" }], "BBC_BLANK_REQUIRED");
  await bad([{ ...event.changes[0], sentence: "An invalid ______ blank" }], "BBC_BLANK_REQUIRED");
  await bad([{ ...event.changes[0], question_id: "missing" }], "BBC_QUESTION_NOT_FOUND");
  await bad([{ ...event.changes[0], answers: "injected" }], "BBC_FIELD_NOT_EDITABLE");
  assert.equal(db.rows("grading_key_history").length, 1, "rejected transactions have no partial effects");
  const racing = await Promise.all(["a", "b"].map(id => api.main({ ...event, request_id: "concurrent-save-000" + id, expected_revision: "2" })));
  assert.equal(racing.filter(result => result.success).length, 1, "only one simultaneous editor can save");
  const accept = { action: "acceptBbcAnswer", set_id: "BBC-QA", question_id: "q1", submitted_answer: "alternate", expected_revision: "3", request_id: "accept-synthetic-0001" };
  assert.equal((await api.main(accept)).success, true);
  assert.equal((await api.main(accept)).success, true);
  assert.equal(db.rows("answer_disputes").length, 1);
  assert.equal(db.rows("answer_disputes")[0].status, "approved");
  assert.deepEqual(db.rows("grading_keys")[0].answers.q1, ["original", "alternate"]);
  assert.equal(db.rows("grading_keys")[0].grading_version, "4");
  assert.equal(db.rows("teacher_attempt_email_events").length, 0, "teacher acceptance never mails a student dispute");
  let calls = 0;
  const resolve = event => resolution.resolve({ db, event, teacher, nextVersion: value => String(Number(value) + 1),
    regrade: async () => { calls++; if (calls === 1) throw new Error("synthetic interrupted projection"); return { scanned_attempt_count: 2, adjusted_attempt_count: 1 }; } });
  const retry = { ...accept, submitted_answer: "second alternate", expected_revision: "4", request_id: "accept-synthetic-0002" };
  await assert.rejects(editor.accept(db, retry, teacher, resolve), /interrupted/);
  assert.equal(db.rows("grading_keys")[0].grading_version, "5");
  await editor.accept(db, retry, teacher, resolve);
  assert.equal(db.rows("grading_keys")[0].grading_version, "5", "projection recovery never increments grading twice");
  assert.equal(db.rows("answer_disputes")[1].status, "approved");
  assert.equal(db.rows("answer_disputes")[1].auto_regrade_adjusted_attempt_count, 1);
  assert.equal((await api.main({ ...accept, submitted_answer: "", request_id: "empty-answer-test-1" })).success, false);
  await db.collection("sets").doc("set").update({ visible: false });
  assert.equal((await loadFunction("getResources", db, null).main({ action: "getBbcContent", set_id: "BBC-QA" })).success, false);
  const html = fs.readFileSync(path.resolve(__dirname, "../bbc.html"), "utf8");
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  const client = fs.readFileSync(path.resolve(__dirname, "../assets/js/bbc-teacher-editor.js"), "utf8");
  const context = { window: {} }; vm.runInNewContext(client, context);
  const data = { blanks: [{ id: "q1", sentence: "Old _____" }], multipleChoice: [{ id: "q2", question: "Old?", options: ["A", "B"] }] };
  context.window.MrCatBbcEditor.apply(data, { q1: { sentence: "New _____", explanation: "must not enter lesson data" }, q2: { question: "<img src=x>", options: ["New A", "New B"] } });
  assert.equal(data.blanks[0].sentence, "New _____"); assert(!("explanation" in data.blanks[0]));
  assert.equal(data.multipleChoice[0]._bbcEditedFields.question, true, "edited text is marked for escaped rendering");
  console.log("BBC teacher editor: authorization, atomic save, conflict, private projection, direct accept, retry recovery and runtime checks passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
