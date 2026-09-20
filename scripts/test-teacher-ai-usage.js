#!/usr/bin/env node
"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { createRequire } = require("module");
const usage = require("../cloudfunctions/_shared/teacher-ai-usage");
const NOW = new Date("2026-09-16T12:00:00Z");
const teacher = { auth_uid: "teacher", role: "teacher", active: true };

function database(seed) {
  const reads = [], tables = structuredClone(seed);
  const command = { in: values => ({ $in: values }), gt: value => ({ $gt: value }) };
  const getPath = (o, key) => key.split(".").reduce((a, k) => a && a[k], o);
  const project = (row, fields) => {
    if (!fields) return structuredClone(row);
    const out = {};
    for (const key of Object.keys(fields)) {
      const value = getPath(row, key);
      if (value === undefined) continue;
      const parts = key.split("."); let target = out;
      parts.slice(0, -1).forEach(part => { target = target[part] || (target[part] = {}); });
      target[parts.at(-1)] = structuredClone(value);
    }
    return out;
  };
  return { reads, tables, command, collection(table) {
    const query = (where = {}, sort = null, fields = null, limit = 100) => ({
      where: value => query(value, sort, fields, limit), orderBy: (key, order) => query(where, [key, order], fields, limit),
      field: value => query(where, sort, value, limit), limit: value => query(where, sort, fields, value),
      async get() {
        reads.push({ table, where, fields, limit });
        let rows = (tables[table] || []).filter(row => Object.entries(where).every(([key, value]) => value && value.$in ? value.$in.includes(row[key]) : value && "$gt" in Object(value) ? row[key] > value.$gt : row[key] === value));
        if (sort) rows = rows.slice().sort((a, b) => String(a[sort[0]]).localeCompare(String(b[sort[0]])) * (sort[1] === "desc" ? -1 : 1));
        return { data: rows.slice(0, limit).map(row => project(row, fields)) };
      },
    });
    return query();
  } };
}

function loadEndpoint(db, uid) {
  const filename = path.resolve(__dirname, "../cloudfunctions/teacherAdmin/index.js");
  const nativeRequire = createRequire(filename), module = { exports: {} };
  const app = { database: () => db, auth: () => ({ getUserInfo: async () => ({ uid }) }) };
  const context = { module, exports: module.exports, console: { error() {} }, process: { env: {} }, Buffer, URL, Date, Intl, setTimeout, clearTimeout,
    require: name => name === "@cloudbase/node-sdk" ? { init: () => app, SYMBOL_CURRENT_ENV: "test" } : nativeRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return module.exports.main;
}

(async () => {
  const neverRead = { collection() { throw new Error("unauthorized database access"); } };
  await assert.rejects(usage.listPage(neverRead, {}, null, NOW), /TEACHER_REQUIRED/);
  await assert.rejects(usage.listPage(neverRead, {}, { ...teacher, role: "student" }, NOW), /TEACHER_REQUIRED/);
  await assert.rejects(usage.listPage(neverRead, {}, { ...teacher, active: false }, NOW), /TEACHER_REQUIRED/);
  await assert.rejects(usage.listPage(neverRead, { cursor: { as_of: NOW.toISOString(), after: { writing: { $gt: "" } }, done: {} } }, teacher, NOW), /CURSOR_INVALID/);
  await assert.rejects(usage.listPage(neverRead, { cursor: { as_of: "2099-01-01", after: {}, done: {} } }, teacher, NOW), /CURSOR_INVALID/);

  const seed = { students: [{ _id: "t", ...teacher }, { _id: "s", auth_uid: "student", student_id: "s1", chinese_name: "测试", english_name: "Learner", role: "student", active: true, password: "never-project" }], writing_model_usage_events: [], speaking_model_usage_events: [], writing_ai_jobs: [], speaking_ai_jobs: [], vocabulary_scan_jobs: [], speaking_individual_responses: [], speaking_discussions: [] };
  for (let i = 0; i < 205; i++) {
    const id = String(i).padStart(4, "0");
    seed.writing_model_usage_events.push({ _id: "w" + id, job_id: "wj" + id, student_uid: "student", stage: "rewrite_check", model: "qwen3.7-plus", input_tokens: 100, output_tokens: 20, cached_input_tokens: 0, outcome: "structured_success", created_at: "2026-09-15T01:00:00Z", prompt: "never-project" });
    seed.speaking_model_usage_events.push({ _id: "s" + id, job_id: "sj", stage: "individual_analysis", model: "qwen3.8-max", input_tokens: 200, output_tokens: 50, cached_tokens: 100, outcome: "completed", created_at: "2026-09-15T01:00:00Z", provider_request_id: "never-project", transcript: "never-project" });
  }
  seed.speaking_ai_jobs.push({ _id: "sj", job_id: "sj", response_session_id: "response", dispatch_token: "never-project" });
  seed.speaking_individual_responses.push({ _id: "response", response_session_id: "response", student_uid: "student", exam_family: "ielts", question_snapshot: { text: "never-project" } });
  seed.writing_ai_jobs.push({ _id: "legacy", job_id: "legacy", student_uid: "student", job_type: "review", status: "succeeded", attempt_count: 1, created_at: "2026-08-21" });
  seed.writing_ai_jobs.push({ _id: "duplicate", job_id: "wj0001", student_uid: "student", job_type: "review", status: "succeeded", attempt_count: 1, created_at: "2026-09-15" });
  seed.vocabulary_scan_jobs.push({ _id: "scan", job_id: "scan", student_uid: "student", attempt_count: 1, status: "succeeded", model_usage: { call_count: 1, input_tokens: 1000, output_tokens: 100 }, model_metadata: { model: "qwen3.7-flash", private_url: "never-project" }, created_at: "2026-09-15" });
  const db = database(seed), all = []; let cursor, pages = 0;
  do {
    const result = await usage.listPage(db, { cursor }, teacher, NOW);
    all.push(...result.rows); pages++; cursor = result.next_cursor;
    assert.equal(result.complete, !cursor);
    assert.equal(result.as_of, NOW.toISOString());
    if (pages === 1) db.tables.writing_model_usage_events.push({ _id: "zznew", created_at: "2026-09-17", stage: "rewrite_check", input_tokens: 999999, output_tokens: 1 });
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.equal(all.length, 412);
  assert.equal(new Set(all.map(row => row.id)).size, 412);
  assert.equal(all.filter(row => row.kind === "legacy_task").length, 1);
  assert.equal(all.reduce((n, row) => n + (row.total_tokens || 0), 0), 205 * 120 + 205 * 250 + 1100);
  assert.equal(all.find(row => row.module === "speaking").exam_family, "ielts");
  assert.equal(all.find(row => row.module === "speaking").students[0].name, "测试Learner");
  assert(!JSON.stringify(all).includes("never-project"));
  assert(!JSON.stringify(all).includes('"student_uid"'));
  assert(db.reads.every(read => read.fields && read.limit <= 100));
  assert(db.reads.every(read => !Object.keys(read.fields).some(key => /prompt|transcript|question|dispatch|password|secret|provider_request/.test(key))));

  const lost = usage.normalize("speaking", { _id: "timeout", stage: "individual_analysis", outcome: "failed", safe_error_code: "SPEAKING_AI_TIMEOUT" });
  assert.equal(lost.total_tokens, null); assert.equal(lost.estimated_cny, null);
  assert.equal(lost.error_code, "SPEAKING_AI_TIMEOUT");
  const providerFailure = usage.normalize("speaking", { _id: "provider", stage: "dse_analysis_turn_reviews", outcome: "failed", safe_error_code: "SPEAKING_AI_PROVIDER_UNAVAILABLE", http_status: 503, provider_code: "InternalError" });
  assert.equal(providerFailure.http_status, 503); assert.equal(providerFailure.provider_code, "InternalError");
  assert.equal(usage.normalize("speaking", { _id: "unsafe-provider", outcome: "failed", provider_code: "message with private text" }).provider_code, null, "only code-shaped provider diagnostics may be projected");
  const writingFailure = usage.normalize("writing", { _id: "writing-timeout", stage: "language_review", outcome: "transport_error", safe_error_code: "WRITING_AI_TIMEOUT", response_status: 408 });
  assert.equal(writingFailure.error_code, "WRITING_AI_TIMEOUT"); assert.equal(writingFailure.http_status, 408);
  const quota = usage.normalize("speaking", { _id: "quota", stage: "individual_analysis", outcome: "failed", safe_error_code: "SPEAKING_AI_FREE_QUOTA_EXHAUSTED" });
  assert.equal(quota.usage_status, "nonbillable"); assert.equal(quota.estimated_cny, 0); assert.equal(quota.total_tokens, null);
  const speech = usage.normalize("speaking", { _id: "asr", stage: "individual_transcription", provider: "tencent", outcome: "completed" });
  assert.equal(speech.usage_status, "not_applicable"); assert.equal(speech.estimated_cny, null);
  const aggregate = usage.normalize("scan", { _id: "s", model_metadata: { model: "qwen3.7-flash" }, model_usage: { call_count: 2, input_tokens: 40000, output_tokens: 100 } });
  assert.equal(aggregate.call_count, 2); assert.equal(aggregate.estimated_cny, null);
  assert.equal(usage.estimate("unknown-model", 1, 1, 0), null);
  assert.equal(usage.estimate("qwen3.8-max", 1000000, 1000000, 500000), 42.75);
  assert.equal(usage.estimate("qwen3.7-plus", 100000, 100000, 0), 0.8);
  assert(Math.abs(usage.estimate("qwen3.7-plus", 300000, 100000, 0) - 3.36) < 1e-12);
  assert.equal(usage.estimate("qwen3.7-plus-2026-05-26", 100000, 100000, 0), 1);
  assert(Math.abs(usage.estimate("qwen3.7-flash", 32001, 1000, 0) - 0.0216006) < 1e-12);

  const noAuth = await loadEndpoint(db, null)({ action: "listAiUsage", role: "teacher", auth_uid: "teacher" });
  assert.equal(noAuth.code, "AUTH_REQUIRED");
  const studentResult = await loadEndpoint(db, "student")({ action: "listAiUsage", role: "teacher", auth_uid: "teacher" });
  assert.equal(studentResult.code, "TEACHER_REQUIRED");
  const teacherResult = await loadEndpoint(db, "teacher")({ action: "listAiUsage" });
  assert.equal(teacherResult.success, true);

  const html = fs.readFileSync(path.resolve(__dirname, "../teacher.html"), "utf8");
  const js = fs.readFileSync(path.resolve(__dirname, "../assets/js/teacher.js"), "utf8");
  const usageJs = fs.readFileSync(path.resolve(__dirname, "../assets/js/teacher-ai-usage.js"), "utf8");
  assert(html.includes('data-view="ai-usage"') && html.includes('id="view-ai-usage"'));
  assert(js.includes("window.MrCatTeacherAiUsage.load()"));
  assert(usageJs.includes("SPEAKING_AI_PROVIDER_UNAVAILABLE") && usageJs.includes("WRITING_AI_SCHEMA_RESPONSE_INVALID"));
  console.log("Teacher AI Usage: authentication, keyset pagination, concurrent inserts, identities, projection privacy, missing usage, deduplication and pricing passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
