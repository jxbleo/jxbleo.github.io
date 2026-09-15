#!/usr/bin/env node
"use strict";
const assert = require("assert/strict");
const Module = require("module");
const fs = require("fs");
const path = require("path");
const rules = require("../cloudfunctions/_shared/ielts-speaking");
const { prepare } = require("./prepare-ielts-speaking");
const clone = value => structuredClone(value);
// Original, synthetic test questions; never included in the topic bank or dist.
const topic = { set_id: "ielts-c20-t1", book: 20, test: 1, source_kind: "cambridge", title: "Synthetic garden fixture", source_reference: "test-only original fixture, not Cambridge wording", source_verified: true, visible_to_students: true, content_revision: 1, part_2: { text: "Talk about an imaginary garden you designed.", bullets: ["Its shape", "The plants"], closing: "Explain your choices." }, part_3: [{ question_id: "p3_01", text: "How could imaginary gardens change cities?" }, { question_id: "p3_02", text: "Who should design a shared garden?" }] };
const segments = [{ segment_id: "seg_0001", start_ms: 0, end_ms: 20000, text: "I designed a garden for my neighbours because our street needed a quiet meeting place." }];
function modelReport() {
  return { schema_version: rules.VERSION, domains: Object.fromEntries(rules.DOMAINS.map(key => [key, { status: "estimated", score: 7, commentary_zh: "观点清楚，可以增加具体例子。", evidence: [{ segment_id: "seg_0001", quote: "a quiet meeting place" }] }])), summary_zh: "保留清楚的思路。", thinking_prompt_zh: "想想花园如何帮助邻居交流。", thinking_keywords_en: ["shared space"], sample_answer_en: "My imaginary garden would offer neighbours a shared place to relax.", overall_band: 9, pronunciation: { score: 9 } };
}
const tables = { students: [{ _id: "a", auth_uid: "a", student_id: "Alice", name: "Alice", role: "student", active: true }, { _id: "b", auth_uid: "b", student_id: "Bob", name: "Bob", role: "student", active: true }, { _id: "t", auth_uid: "t", student_id: "Teacher", name: "Teacher", role: "teacher", active: true }], ielts_speaking_sets: [{ ...rules.normalizeSet(topic), _id: topic.set_id }] };
let transactionQueue = Promise.resolve();
function query(name, where = {}, sorts = [], offset = 0, count = Infinity) {
  const rows = () => (tables[name] || (tables[name] = [])).filter(row => Object.entries(where).every(([key, value]) => value && value.op === "neq" ? row[key] !== value.value : row[key] === value || value === null && row[key] == null)).sort((a, b) => {
    for (const [key, order] of sorts) { if (a[key] === b[key]) continue; return (a[key] < b[key] ? -1 : 1) * (order === "asc" ? 1 : -1); } return 0;
  }).slice(offset, offset + count);
  return {
    where: value => query(name, value, sorts, offset, count), orderBy: (key, order) => query(name, where, [...sorts, [key, order]], offset, count), skip: value => query(name, where, sorts, value, count), limit: value => query(name, where, sorts, offset, value),
    get: async () => ({ data: clone(rows()) }),
    doc: id => ({
      create: async value => { tables[name] ||= []; if (tables[name].some(row => row._id === id)) throw new Error("DUPLICATE"); tables[name].push({ ...clone(value), _id: id }); },
      update: async values => { const row = (tables[name] || []).find(row => row._id === id); if (!row) throw new Error("MISSING_ROW"); for (const [key, value] of Object.entries(values)) row[key] = clone(value && value.op === "set" ? value.value : value); },
    }),
  };
}
const db = { collection: name => query(name), command: { set: value => ({ op: "set", value }), neq: value => ({ op: "neq", value }) }, runTransaction: callback => {
  const task = transactionQueue.then(async () => { const snapshot = clone(tables); try { return await callback(db); } catch (error) { Object.keys(tables).forEach(key => delete tables[key]); Object.assign(tables, snapshot); throw error; } });
  transactionQueue = task.catch(() => {}); return task;
} };
let uid = "a", transcriptionDuration = 120000, modelCalls = 0, transcriptionCalls = 0;
const app = { database: () => db, auth: () => ({ getUserInfo: async () => ({ uid }) }), config: {}, getFileInfo: async () => ({ fileList: [{ size: 100 }] }), getTempFileURL: async () => ({ fileList: [{ tempFileURL: "https://audio.example.test/private" }] }) };
const originalLoad = Module._load;
Module._load = function (request, parent, main) {
  if (request === "@cloudbase/node-sdk") return { init: () => app, SYMBOL_CURRENT_ENV: "test" };
  if (request === "@cloudbase/node-sdk/dist/cloudbase") return { CloudBase: { getCloudbaseContext: () => ({}) } };
  if (request === "@cloudbase/node-sdk/dist/utils/tcbapirequester") return { request: async () => ({}) };
  if (parent && parent.filename.endsWith("speakingLab/index.js") && request === "./speech-provider") return { createSpeechProvider: () => ({ name: "synthetic", inspectAudio: async () => ({}), transcribeAndDiarize: async () => { transcriptionCalls++; return { status: "completed", output: { duration_ms: transcriptionDuration, segments: segments.map(s => ({ ...s, provider_speaker_id: "one" })), speaker_tracks: [{ provider_speaker_id: "one", speech_duration_ms: 20000 }] } }; } }) };
  if (parent && parent.filename.endsWith("speakingLab/index.js") && request === "./model-provider") return { createModelProvider: () => ({ name: "synthetic", model: "test-only", callStructuredModel: async input => { assert.match(input.system_prompt, /IELTS/); assert.equal(JSON.parse(input.user_prompt).part, transcriptionDuration === 120000 ? 2 : 3); modelCalls++; return { output: modelReport() }; } }) };
  return originalLoad.call(this, request, parent, main);
};
const gateway = require("../cloudfunctions/speakingLab/index");
Module._load = originalLoad;
async function call(action, data = {}) { return gateway.main({ action, ...data }); }
async function ok(action, data) { const result = await call(action, data); assert.equal(result.success, true, `${action}: ${result.code}`); return result; }
async function create(part, op = Math.random().toString(36)) { return (await ok("createIeltsResponse", { set_id: topic.set_id, question_id: part, operation_id: op, student_uid: "b", duration_limit_seconds: 999 })).response; }
async function upload(response, seconds) {
  const started = await ok("startIndividualResponseAudioUpload", { response_session_id: response.response_session_id, operation_id: "upload-test", mime_type: "audio/webm", size_bytes: 100, duration_seconds: seconds });
  const payload = { response_session_id: response.response_session_id, asset_id: started.asset_id, uploaded_file_id: `cloud://test/${started.upload.cloud_path}`, duration_seconds: seconds };
  await ok("finishIndividualResponseAudioUpload", payload); await ok("finishIndividualResponseAudioUpload", payload);
  return started;
}
async function processResponse(response) {
  await ok("startIndividualResponseAnalysis", { response_session_id: response.response_session_id });
  const job = tables.speaking_ai_jobs.find(row => row.response_session_id === response.response_session_id);
  await ok("processQueuedJob", { job_id: job.job_id, dispatch_token: job.dispatch_token });
  return call("processQueuedJob", { job_id: job.job_id, dispatch_token: job.dispatch_token });
}
async function main() {
  assert.equal(prepare([topic])[0].part_3[0].part, 3);
  assert.throws(() => prepare([topic, topic]), /Duplicate/);
  assert.throws(() => prepare([{ ...topic, source_verified: false }]), /INVALID/);
  assert.throws(() => prepare([{ ...topic, part_3: [] }]), /INVALID/);
  assert.throws(() => prepare([{ ...topic, set_id: "ielts-c19-t1" }]), /INVALID/);
  assert.equal(rules.durationLimit({}), 65);
  assert.equal(rules.durationLimit({ exam_family: "ielts", question_snapshot: { part: 3 } }), 90);
  assert.throws(() => rules.durationLimit({ exam_family: "ielts", question_snapshot: { part: 1 } }));
  const report = rules.canonicalReport(modelReport(), segments);
  assert.equal(report.overall_band, undefined); assert.equal(report.pronunciation.score, undefined);
  assert.deepEqual(Object.keys(report.domains), rules.DOMAINS);
  const bad = modelReport(); bad.domains.fluency_coherence.evidence[0].quote = "invented"; assert.throws(() => rules.canonicalReport(bad, segments));
  bad.domains.fluency_coherence.evidence = []; assert.throws(() => rules.canonicalReport(bad, segments));
  bad.domains.fluency_coherence.status = "insufficient_evidence"; bad.domains.fluency_coherence.score = null; assert.equal(rules.canonicalReport(bad, segments).domains.fluency_coherence.score, null);
  const invalidScore = modelReport(); invalidScore.domains.lexical_resource.score = 10; assert.throws(() => rules.canonicalReport(invalidScore, segments));
  uid = null; assert.equal((await call("listIeltsSpeakingSets", { role: "teacher", auth_uid: "t" })).success, false); uid = "a";
  const listed = await ok("listIeltsSpeakingSets"); assert.equal(listed.sets.length, 1); assert.equal(listed.sets[0].part_2, undefined);
  const [response, duplicate] = await Promise.all([create("p2", "same-operation"), create("p2", "same-operation")]);
  assert.equal(response.response_session_id, duplicate.response_session_id); assert.equal(tables.speaking_individual_responses.length, 1); assert.equal(response.duration_limit_seconds, 120);
  assert.equal(tables.speaking_individual_responses[0].student_uid, "a");
  uid = "b"; assert.equal((await call("getIeltsResponse", { response_session_id: response.response_session_id })).success, false); assert.equal((await call("getIeltsResponseAudio", { response_session_id: response.response_session_id })).success, false); uid = "a";
  await upload(response, 120);
  assert.equal((await call("startIndividualResponseAudioUpload", { response_session_id: response.response_session_id, operation_id: "replace", mime_type: "audio/webm", size_bytes: 100, duration_seconds: 120 })).code, "IELTS_RESPONSE_LOCKED");
  assert.equal((await call("deleteIndividualResponse", { response_session_id: response.response_session_id })).code, "IELTS_RESPONSE_LOCKED");
  await processResponse(response);
  const ready = (await ok("getIeltsResponse", { response_session_id: response.response_session_id })).response;
  assert.equal(ready.analysis_status, "ready"); assert.equal(ready.report.schema_version, rules.VERSION);
  assert.equal(modelCalls, 1); assert.equal(transcriptionCalls, 1); assert.equal(tables.speaking_reports.length, 1);
  await ok("startIndividualResponseAnalysis", { response_session_id: response.response_session_id, operation_id: "force-another" }); assert.equal(tables.speaking_ai_jobs.length, 1);
  assert.equal((await ok("getIeltsResponseAudio", { response_session_id: response.response_session_id })).audio_url, "https://audio.example.test/private");
  assert.equal((await ok("listIndividualResponses")).responses.length, 0, "DSE history excludes IELTS");
  const summaries = await ok("listIeltsResponses", { student_id: "Bob" }); assert.equal(summaries.responses.length, 1); assert.equal(summaries.responses[0].report, undefined); assert.equal(summaries.responses[0].question_snapshot, undefined);
  const p3 = await create("p3_01"); assert.equal(p3.duration_limit_seconds, 90);
  assert.equal((await call("startIndividualResponseAudioUpload", { response_session_id: p3.response_session_id, operation_id: "long", mime_type: "audio/webm", size_bytes: 100, duration_seconds: 120 })).code, "INDIVIDUAL_RESPONSE_AUDIO_TOO_LONG");
  await upload(p3, 90); transcriptionDuration = 90000; await processResponse(p3); assert.equal(tables.speaking_reports.length, 2, "independent responses never collide");
  const forgedDuration = await create("p3_02"); await upload(forgedDuration, 90); transcriptionDuration = 150000; const longResult = await processResponse(forgedDuration); assert.notEqual(longResult.status, "succeeded"); assert.equal(modelCalls, 2, "provider measured overlength is rejected before scoring");
  tables.ielts_speaking_sets[0].part_2.text = "Changed source"; assert.equal((await ok("getIeltsResponse", { response_session_id: response.response_session_id })).response.question_snapshot.text, topic.part_2.text);
  uid = "t"; assert.equal((await ok("getIeltsResponse", { response_session_id: response.response_session_id })).response.student_id_snapshot, "Alice");
  assert.equal((await call("createIeltsResponse", { set_id: topic.set_id, question_id: "p2", operation_id: "teacher" })).code, "STUDENT_REQUIRED");
  assert.equal((await call("startIndividualResponseAnalysis", { response_session_id: response.response_session_id })).success, false);
  assert.equal((await ok("listIeltsResponses", { student_id: "Bob" })).responses.length, 0);
  for (let i = 0; i < 61; i++) tables.speaking_individual_responses.push({ ...clone(tables.speaking_individual_responses[0]), _id: `history-${i}`, response_session_id: `history-${i}`, created_at: new Date(2026, 0, 1, 0, 0, i) });
  let offset = 0, ids = [];
  do { const page = await ok("listIeltsResponses", { offset }); ids.push(...page.responses.map(r => r.response_session_id)); offset = page.next_offset; } while (offset !== null);
  assert.equal(ids.length, 64); assert.equal(new Set(ids).size, ids.length, "all history remains reachable beyond one page");
  uid = "b"; assert.equal((await ok("listIeltsResponses", { auth_uid: "a", role: "teacher" })).responses.length, 0);
  tables.students.find(row => row.auth_uid === "b").active = false; assert.equal((await call("listIeltsSpeakingSets")).success, false);
  const html = fs.readFileSync(path.join(__dirname, "../ielts-speaking-lab.html"), "utf8");
  assert.match(html, /One minute preparation/); assert.match(html, /ielts-speaking-lab\.js/);
  const js = fs.readFileSync(path.join(__dirname, "../assets/js/ielts-speaking-lab.js"), "utf8");
  assert.doesNotMatch(js, /localStorage|indexedDB/);
  assert.match(js, /<details><summary>Sample Answer/);
  const sourceIndex = JSON.parse(fs.readFileSync(path.join(__dirname, "../content/speaking/ielts-source-index.json")));
  assert.equal(sourceIndex.prepared_topic_count, sourceIndex.books.reduce((total, book) => total + book.reviewed_topic_count, 0), "source index prepared count matches reviewed books");
  assert.ok(["prepared_local_pending_cloud_import", "cloud_import_verified"].includes(sourceIndex.status));
  if (sourceIndex.status === "cloud_import_verified") assert.equal(sourceIndex.cloud_import_verified_count, sourceIndex.prepared_topic_count, "verified live count matches prepared corpus");
}
const logError = console.error; console.error = () => {};
main().then(() => { console.error = logError; console.log("IELTS Speaking: content, authentication, ownership, immutable uploads, durable reports, duration, scoring and history contracts passed (synthetic fixtures only)."); }).catch(error => { console.error = logError; console.error(error); process.exitCode = 1; });
