#!/usr/bin/env node
// Synthetic offline lifecycle tests. No student data or external model calls.
"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const { createRequire } = require("node:module");
function load(relative, expose, rows, onInvoke = () => {}, overrides = {}) {
  const file = path.resolve(__dirname, "..", relative), realRequire = createRequire(file), tables = structuredClone(rows);
  let invocations = 0;
  let tail = Promise.resolve();
  const db = { command: { set: (value) => value, exists: (value) => ({ exists: value }) }, runTransaction: (fn) => {
    const p = tail.then(() => fn(db));
    tail = p.catch(() => {
    });
    return p;
  } };
  db.collection = (table) => {
    let where = {}, id, max = Infinity;
    const api = {
      where: (value) => {
        where = value;
        return api;
      },
      limit: (value) => { max = value; return api; },
      doc: (value) => {
        id = value;
        return api;
      },
      get: async () => ({ data: structuredClone((tables[table] || []).filter((row) => id ? row._id === id : Object.entries(where).every(([key, value]) => (value && typeof value === "object" && "exists" in value ? (row[key] !== undefined) === value.exists : row[key] === value)))).slice(0, max) }),
      update: async (values) => {
        for (const row of tables[table] || []) if (id ? row._id === id : Object.entries(where).every(([key, value]) => (value && typeof value === "object" && "exists" in value ? (row[key] !== undefined) === value.exists : row[key] === value))) Object.assign(row, structuredClone(values));
        return {};
      },
      create: async (value) => {
        tables[table] ||= [];
        if (tables[table].some((row) => row._id === id)) throw new Error("duplicate");
        tables[table].push({ ...structuredClone(value), _id: id });
        return {};
      }
    };
    return api;
  };
  const exports = {}, app = { config: {}, database: () => db, auth: () => ({ getUserInfo: async () => ({ uid: overrides.authUid === undefined ? "student-a" : overrides.authUid }) }) };
  vm.runInNewContext(fs.readFileSync(file, "utf8") + "\nexports._review={" + expose + "};", { exports, console: { error: () => {
  } }, Buffer, Date, process, setTimeout, clearTimeout, AbortController, require: (name) => {
    if (Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name];
    if (name === "@cloudbase/node-sdk") return { init: () => app, SYMBOL_CURRENT_ENV: "fixture" };
    if (name === "@cloudbase/node-sdk/dist/cloudbase") return { CloudBase: { getCloudbaseContext: () => ({}) } };
    if (name === "@cloudbase/node-sdk/dist/utils/tcbapirequester") return { request: async (data) => {
      invocations++;
      return onInvoke(tables, data);
    } };
    return realRequire(name);
  } }, { filename: file });
  return { fn: exports._review, tables, invocations: () => invocations };
}

const student = { auth_uid: "student-a", active: true, role: "student" };
const composition = { _id: "c1", composition_id: "report-a", student_uid: student.auth_uid,
  title: "Practice Report", confirmed_text: "Synthetic manuscript.", status: "completed", completed_at: new Date("2026-09-29"),
  language_review: { sentences: [{ sentence_id: "s1", rewrite_required: true }, { sentence_id: "s2", rewrite_required: true }, { sentence_id: "s3", rewrite_required: false }] },
  rewrite_results: { results: [{ sentence_id: "s1", accepted: true }, { sentence_id: "s1", accepted: true }, { sentence_id: "s3", accepted: true }, { sentence_id: "s2", accepted: false }] } };
function harness(rows = [composition], overrides = {}, jobs = []) {
  return load("cloudfunctions/writingTutor/index.js", "deleteComposition,ownedComposition,listCompositions,revisionProgress,publishProcessingJob,performRewriteJob,confirmRevisionScanImport,main:exports.main", {
    writing_compositions: rows, students: [student], writing_ai_jobs: jobs,
  }, () => { throw new Error("Unexpected external invocation"); }, overrides);
}
(async () => {
  const h = harness();
  const anonymous = harness([composition], { authUid: null });
  assert.equal((await anonymous.fn.main({ action: "deleteComposition", composition_id: "report-a", student_uid: student.auth_uid })).code, "AUTH_REQUIRED");
  const otherUser = harness([{ ...composition, student_uid: "other" }]);
  assert.equal((await otherUser.fn.main({ action: "deleteComposition", composition_id: "report-a", student_uid: "other" })).code, "COMPOSITION_NOT_FOUND");
  const teacher = harness();
  teacher.tables.students[0].role = "teacher";
  assert.equal((await teacher.fn.main({ action: "deleteComposition", composition_id: "report-a" })).code, "STUDENT_REQUIRED");
  assert.equal(h.fn.revisionProgress(composition).total, 2);
  assert.equal(h.fn.revisionProgress(composition).completed, 1);
  assert.equal(h.fn.revisionProgress({}), null);
  await assert.rejects(h.fn.deleteComposition({ auth_uid: "other" }, { composition_id: "report-a" }), /COMPOSITION_NOT_FOUND/);
  assert.equal(h.tables.writing_compositions[0].deleted_at, undefined);
  await h.fn.deleteComposition(student, { composition_id: "report-a" });
  const saved = h.tables.writing_compositions[0];
  assert(saved.deleted_at);
  assert.equal(saved.deleted_by_student_uid, student.auth_uid);
  assert.equal(saved.confirmed_text, composition.confirmed_text);
  assert.equal(saved.completed_at.getTime(), composition.completed_at.getTime());
  assert.equal(saved.status, "completed");
  await h.fn.deleteComposition(student, { composition_id: "report-a", student_uid: "other" });
  assert.equal(h.tables.writing_compositions[0].deleted_at.getTime(), saved.deleted_at.getTime());
  await assert.rejects(h.fn.ownedComposition(student, "report-a"), /COMPOSITION_NOT_FOUND/);
  assert.equal((await h.fn.listCompositions(student)).compositions.length, 0);
  const job = { _id: "j1", job_id: "job-a", composition_id: "report-a", student_uid: student.auth_uid,
    status: "processing", lease_token: "synthetic-lease", job_type: "rewrite" };
  const running = harness([{ ...composition, status: "rewrite_processing", active_job_id: job.job_id }], {}, [job]);
  await running.fn.deleteComposition(student, { composition_id: "report-a" });
  assert.equal(await running.fn.publishProcessingJob(job), false);
  assert.equal(running.tables.writing_ai_jobs[0].status, "superseded");
  // Even a stale nontransactional uploader reattaching an ID cannot bypass the tombstone.
  running.tables.writing_compositions[0].active_job_id = job.job_id;
  running.tables.writing_ai_jobs[0] = { ...job };
  assert.equal(await running.fn.publishProcessingJob(job), false);
  await assert.rejects(running.fn.performRewriteJob(student, job), /COMPOSITION_NOT_FOUND/);
  // Deleted records do not consume the 200-row visible-list window.
  const many = harness([...Array.from({ length: 205 }, (_, i) => ({ ...composition, _id: "gone-" + i, composition_id: "gone-" + i, deleted_at: new Date() })), { ...composition, _id: "visible", composition_id: "visible" }]);
  const listed = await many.fn.listCompositions(student);
  assert.equal(listed.compositions.length, 1);
  assert.equal(listed.compositions[0].composition_id, "visible");
  assert.equal(listed.compositions[0].revision_progress.completed, 1);
  console.log("Writing report deletion: ownership, retry, retention, tombstones, worker suppression, list visibility and real progress passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
