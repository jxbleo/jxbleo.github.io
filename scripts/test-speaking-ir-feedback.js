#!/usr/bin/env node
// Offline regression checks: synthetic fixtures, real implementation, no provider/cloud calls.
"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const { createRequire } = require("node:module");
function load(relative, expose, rows, onInvoke = () => {}, overrides = {}, beforeUpdate = () => {}) {
  const file = path.resolve(__dirname, "..", relative), realRequire = createRequire(file), tables = structuredClone(rows);
  let invocations = 0;
  let tail = Promise.resolve();
  const db = { command: { set: (value) => value }, runTransaction: (fn) => {
    const p = tail.then(async () => {
      const snapshot=structuredClone(tables);
      try { return await fn(db); }
      catch(error) { for(const key of Object.keys(tables)) delete tables[key]; Object.assign(tables,snapshot); throw error; }
    });
    tail = p.catch(() => {
    });
    return p;
  } };
  db.collection = (table) => {
    let where = {}, id;
    const api = {
      where: (value) => {
        where = value;
        return api;
      },
      limit: () => api,
      doc: (value) => {
        id = value;
        return api;
      },
      get: async () => ({ data: structuredClone((tables[table] || []).filter((row) => id ? row._id === id : Object.entries(where).every(([key, value]) => row[key] === value))) }),
      update: async (values) => {
        beforeUpdate(table, values);
        for (const row of tables[table] || []) if (id ? row._id === id : Object.entries(where).every(([key, value]) => row[key] === value)) Object.assign(row, structuredClone(values));
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
  const exports = {}, app = { config: {}, database: () => db };
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
const feedback = require("../cloudfunctions/_shared/speaking-ir-feedback");
const refresh = require("../cloudfunctions/_shared/speaking-ir-refresh");
const segments = [{ segment_id: "seg_0001", start_ms: 0, end_ms: 1000, text: "I prefer walking because it is relaxing." }];
const core = { basis_status: "grounded", keep_zh: "你表明喜歡步行。", student_viewpoint_zh: "你喜歡步行。", analysis: [{ id: "p1", title_zh: "補充原因", quote_en: "it is relaxing", evidence_segment_ids: ["seg_0001"], issue_zh: "未解釋原因。", action_zh: "用假設情境說明。", sample_context_zh: "假設情境：", sample_en: "A short walk could help me relax." }] };
function exemplar(index) { return { id: `e${index + 1}`, assumption_note_zh: "以下是假設情境。", thinking_template: [1,2,3].map(i => ({ id: `s${i}`, label_zh: "具體步驟", content_zh: `說明步行的作用，路線${index + 1}。` })), paragraphs: [1,2,3].map((i) => ({ step_id: `s${i}`, addresses: i === 2 ? ["p1"] : [], text_en: `Route ${index + 1}. ` + ["A short walk could help me relax after a busy day and give me an opportunity to enjoy my surroundings, think clearly and spend some peaceful time outside with friends.", "If I had a stressful afternoon, getting outside could offer a welcome change of scenery and let me consider my priorities without the usual distractions that make relaxation more difficult.", "Although walking may take longer than travelling by bus, I would choose a nearby route where I could enjoy fresh air and organise my thoughts before returning to my daily responsibilities."][index] })) }; }
(async () => {
  const source = { questionText: "Do you enjoy walking?", segments };
  let state = { pipeline_version: feedback.LEGACY_PIPELINE }, accepted;
  for (const output of [core, exemplar(0), exemplar(1), exemplar(2)]) {
    const request = feedback.nextRequest(state, source);
    accepted = feedback.accept(request, output, segments);
    if (!accepted.complete) state = JSON.parse(JSON.stringify(accepted.state));
  }
  assert(accepted.complete); assert.equal(accepted.report.sample_responses.length, 3); assert(!accepted.report.domains);
  const compact = sample => ({ note: sample.assumption_note_zh, steps: sample.thinking_template.map((t, i) => ({ label: t.label_zh, plan: t.content_zh, text: sample.paragraphs[i].text_en, fixes: sample.paragraphs[i].addresses })) });
  const batch = () => Object.fromEntries([0,1,2].map(i => [`e${i+1}`, compact(exemplar(i))]));
  const coreRequest = feedback.nextRequest({ pipeline_version: feedback.BATCH_PIPELINE, core: null, sample_responses: [], batch_attempted: false }, source);
  const batchRequest = feedback.nextRequest(feedback.accept(coreRequest, core, segments).state, source);
  assert.equal(batchRequest.scope, "exemplars");
  const all = feedback.accept(batchRequest, batch(), segments);
  assert(all.complete); assert.deepEqual(all.report, accepted.report);
  assert(!JSON.parse(batchRequest.user_prompt).accepted.repairs[0].quote_en);
  assert(!batchRequest.user_prompt.includes(core.sample_en || "UNUSED_MARKER"));
  const partial = batch(); partial.e2.steps[0].text = "Short."; partial.e2.steps[1].text = "Short.";
  const saved = feedback.accept(batchRequest, partial, segments);
  assert(!saved.complete); assert.deepEqual(saved.state.sample_responses.map(s => s.id), ["e1", "e3"]);
  const repairReq = feedback.nextRequest(JSON.parse(JSON.stringify(saved.state)), source);
  assert.equal(repairReq.scope, "exemplar-2"); assert.equal(JSON.parse(repairReq.user_prompt).repair_reason, "IR_EXEMPLAR_WORD_COUNT");
  const repaired = feedback.accept(repairReq, compact(exemplar(1)), segments);
  assert(repaired.complete); assert.deepEqual(repaired.report.sample_responses[0], saved.state.sample_responses[0]);
  assert.deepEqual(repaired.report.sample_responses[2], saved.state.sample_responses[1]);
  const absent = feedback.accept(batchRequest, { e1: batch().e1, e3: batch().e3 }, segments);
  assert.equal(feedback.nextRequest(absent.state, source).scope, "exemplar-2");
  const duplicate = batch(); duplicate.e2 = structuredClone(duplicate.e1);
  const dedup = feedback.accept(batchRequest, duplicate, segments);
  assert.equal(dedup.state.repair_reasons.e2, "IR_EXEMPLAR_TOO_SIMILAR");
  assert.equal(feedback.nextRequest(feedback.batchFailure(batchRequest), source).scope, "exemplar-1");
  assert.throws(() => feedback.nextRequest({pipeline_version:"unknown"}, source), /SCHEMA_INVALID/);
  const copied = exemplar(0); copied.id = "e2"; copied.thinking_template.forEach(t => { t.content_zh += "換個說法"; });
  assert.throws(() => feedback.canonicalReport({ ...core, sample_responses: [exemplar(0), copied, exemplar(2)] }, segments), /SCHEMA_INVALID/);
  const broken = structuredClone(core); broken.analysis[0].quote_en = "invented quote";
  assert.throws(() => feedback.canonicalCore(broken, segments), /SCHEMA_INVALID/);
  const spanning = structuredClone(core); spanning.analysis[0].quote_en = "because it is relaxing."; spanning.analysis[0].evidence_segment_ids = ["a", "b"];
  feedback.canonicalCore(spanning, [{ segment_id: "a", text: "I walk because" }, { segment_id: "b", text: "it is relaxing." }]);
  assert.throws(() => feedback.canonicalCore(spanning, [{ segment_id: "a", text: "I walk because" }, { segment_id: "gap", text: "I am not sure" }, { segment_id: "b", text: "it is relaxing." }]), /SCHEMA_INVALID/);
  const noIds = structuredClone(core); delete noIds.analysis[0].evidence_segment_ids;
  noIds.analysis[0].quote_en = "it is relaxing";
  assert.deepEqual(feedback.canonicalCore(noIds, segments).analysis[0].evidence_segment_ids, ["seg_0001"]);
  const badWords = structuredClone(noIds); badWords.analysis[0].quote_en = "it is not relaxing";
  assert.throws(() => feedback.canonicalCore(badWords, segments), /SCHEMA_INVALID/);
  const unknown = structuredClone(core); unknown.analysis[0].evidence_segment_ids = ["missing"];
  assert.throws(() => feedback.canonicalCore(unknown, segments), /SCHEMA_INVALID/);
  const uncovered = exemplar(0); uncovered.paragraphs[1].addresses = [];
  assert.throws(() => feedback.canonicalExemplar(uncovered, core, 0), /SCHEMA_INVALID/);
  const questions = exemplar(0); questions.thinking_template[0].content_zh = "為甚麼？";
  assert.throws(() => feedback.canonicalExemplar(questions, core, 0), /SCHEMA_INVALID/);
  const short = exemplar(0); short.paragraphs[0].text_en = "Short."; short.paragraphs[1].text_en = "Short.";
  assert.throws(() => feedback.canonicalExemplar(short, core, 0), /SCHEMA_INVALID/);
  assert.throws(() => feedback.canonicalReport({ ...core, sample_responses: [exemplar(0), "id", exemplar(2)] }, segments), /SCHEMA_INVALID/);
  const now = new Date(), job = { ir_feedback_state: { pipeline_version: feedback.LEGACY_PIPELINE }, _id: "j", job_id: "j", dispatch_token: "dispatch", job_type: "individual_response_analysis", status: "queued", stage: "analysis", response_session_id: "s", response_revision: 1, formal_audio_asset_id: "a", refresh_kind: refresh.UNIFIED_KIND, source_report_id: "old", source_report_version: "r1", attempt_count: 0, next_retry_at: new Date(0) };
  const oldReport = { _id: "old", report_id: "old", report_version: "r1", status: "ready", session_type: "individual_response", response_session_id: "s", transcript: { segments, duration_ms: 1000 }, dse_analysis: { original: true } };
  const overlong = exemplar(0); overlong.paragraphs.forEach(p => { p.text_en = "word ".repeat(70); });
  const outputs = [core, overlong, exemplar(0), exemplar(1), exemplar(2)]; let calls = 0, transcriptions = 0;
  const h = load("cloudfunctions/speakingLab/index.js", "processQueuedJob", {
    speaking_ai_jobs: [job], speaking_reports: [oldReport],
    speaking_individual_responses: [{ _id: "s", response_session_id: "s", deleted_at: null, active_audio_revision: 1, active_analysis_job_id: "j", report_id: "old", active_report_version: "r1", analysis_status: "ready", formal_audio_asset_id: "a", question_snapshot: { text: source.questionText }, report: oldReport.dse_analysis }],
    speaking_audio_assets: [{ _id: "a", asset_id: "a", response_session_id: "s", asset_kind: "individual_response", status: "uploaded" }],
  }, () => {}, {
    "./speech-provider": { createSpeechProvider() { transcriptions++; throw Error("ASR_NOT_ALLOWED"); } },
    "../_shared/speaking-notifications": { enqueueSafely: async () => {} },
    "./model-provider": { createModelProvider(hooks) { return { name: "fixture", protocol: "fixture", hostname: "fixture", async callStructuredModel() { const n = await hooks.beforeAttempt({}); calls++; await hooks.afterAttempt({ model: "fixture", usage: {} }, n); return { output: outputs.shift(), model: "fixture" }; } }; } },
  });
  for (let i = 0; i < 5; i++) {
    const result = await h.fn.processQueuedJob({ job_id: "j", dispatch_token: "dispatch" });
    if (i === 1) {
      assert.equal(result.retrying, true); assert.equal(result.success, false);
      assert.equal(h.tables.speaking_ai_jobs[0].ir_feedback_state.repair_reason, "IR_EXEMPLAR_WORD_COUNT");
      const repairRequest = feedback.nextRequest(h.tables.speaking_ai_jobs[0].ir_feedback_state, source);
      assert(repairRequest.user_prompt.includes("REWRITE IT TO 100–120 TOTAL WORDS"));
      h.tables.speaking_ai_jobs[0].next_retry_at = new Date(0);
    } else assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(h.tables.speaking_ai_jobs[0].status, i < 4 ? "queued" : "succeeded");
    if (i < 4) { assert.equal(h.tables.speaking_individual_responses[0].report_id, "old"); assert.equal(h.tables.speaking_ai_jobs[0].attempt_count, 0); }
  }
  assert.equal(calls, 5); assert.equal(transcriptions, 0);
  assert.deepEqual(h.tables.speaking_reports.find(r => r.report_id === "old"), oldReport);
  assert.equal(h.tables.speaking_reports.length, 2);
  assert.equal(h.tables.speaking_individual_responses[0].report.report_version, feedback.VERSION);
  assert.equal(h.tables.speaking_model_usage_events.length, 5);
  for (const scenario of ["batch-success", "partial-middle", "parse-failure", "bounded-failure"]) {
    const batchOutput = batch();
    if (scenario !== "batch-success") batchOutput.e2.steps = [];
    const stages = [];
    const script = scenario === "parse-failure" ? [core, new Error("SPEAKING_AI_SCHEMA_INVALID"), compact(exemplar(0)), compact(exemplar(1)), compact(exemplar(2))]
      : scenario === "bounded-failure" ? [core, batchOutput, { steps: [] }, { steps: [] }]
      : scenario === "partial-middle" ? [core, batchOutput, compact(exemplar(1))] : [core, batchOutput];
    const freshJob = { ...job, ir_feedback_state: { pipeline_version: feedback.BATCH_PIPELINE, core: null, sample_responses: [], batch_attempted: false } };
    const t = load("cloudfunctions/speakingLab/index.js", "processQueuedJob", {
      speaking_ai_jobs: [freshJob], speaking_reports: [oldReport],
      speaking_individual_responses: [{ _id:"s", response_session_id:"s", deleted_at:null, active_audio_revision:1, active_analysis_job_id:"j", report_id:"old", active_report_version:"r1", analysis_status:"ready", formal_audio_asset_id:"a", question_snapshot:{text:source.questionText}, report:oldReport.dse_analysis }],
      speaking_audio_assets: [{_id:"a",asset_id:"a",response_session_id:"s",asset_kind:"individual_response",status:"uploaded"}]
    }, () => {}, {
      "./speech-provider": { createSpeechProvider(){throw Error("ASR_NOT_ALLOWED");} },
      "../_shared/speaking-notifications": { enqueueSafely: async () => {} },
      "./model-provider": { createModelProvider(hooks){return { name:"fixture", protocol:"fixture", hostname:"fixture", async callStructuredModel(input){
        stages.push(JSON.parse(input.user_prompt).requested_id || (stages.length ? "batch" : "core"));
        const n=await hooks.beforeAttempt({}); const output=script.shift();
        await hooks.afterAttempt({model:"fixture",usage:{input_tokens:100,output_tokens:50,total_tokens:150}},n);
        if(output instanceof Error){output.code=output.message;throw output;}
        return {output,model:"fixture",call_index:n};
      }};} }
    });
    const count = script.length;
    for(let i=0;i<count;i++){
      const result=await t.fn.processQueuedJob({job_id:"j",dispatch_token:"dispatch"});
      if(i<count-1) assert.equal(t.tables.speaking_ai_jobs[0].status,"queued",JSON.stringify(result));
      t.tables.speaking_ai_jobs[0].next_retry_at=new Date(0);
      if(i<count-1)assert.equal(t.tables.speaking_individual_responses[0].report_id,"old");
    }
    assert.equal(t.tables.speaking_ai_jobs[0].status,scenario==="bounded-failure"?"failed":"succeeded",scenario);
    assert.equal(t.tables.speaking_model_usage_events.length,count);
    assert.deepEqual(t.tables.speaking_reports.find(r=>r.report_id==="old"),oldReport);
    if(scenario==="partial-middle")assert.deepEqual(stages,["core","batch","e2"]);
    if(scenario==="bounded-failure")assert.equal(t.tables.speaking_reports.length,1);
  }
  // Production single-call path, including partial completion and persistence loss.
  const initial = feedback.nextRequest(null, source);
  assert.equal(initial.scope, "report");
  assert(initial.single);
  const full = () => ({ ...structuredClone(core), ...batch() });
  assert(feedback.accept(initial, full(), segments).complete);
  const partialSingle = full(); partialSingle.e2.steps = [];
  const singleState = feedback.accept(initial, partialSingle, segments).state;
  assert.deepEqual(singleState.sample_responses.map(s => s.id), ["e1", "e3"]);
  assert.equal(feedback.nextRequest(singleState, source).scope, "exemplar-2");
  assert.equal(feedback.batchFailure(initial), null, "unparseable full report must retry once, not invent a core");
  const cjk = full(); cjk.e2.steps[0].text += " 中文";
  assert.equal(feedback.accept(initial, cjk, segments).state.repair_reasons.e2, "IR_ENGLISH_CONTAINS_CJK");
  for (const scenario of ["single-success", "single-partial", "single-parse", "single-invalid-core", "single-exhausted", "single-publication", "single-slow"]) {
    const error = () => Object.assign(Error("SPEAKING_AI_SCHEMA_INVALID"), {code:"SPEAKING_AI_SCHEMA_INVALID",responseCompletedAt:new Date().toISOString()});
    const invalid = full(); invalid.analysis[0].quote_en = "fabricated quotation";
    const script = scenario === "single-partial" ? [partialSingle, compact(exemplar(1))]
      : scenario === "single-parse" ? [error(), full()]
      : scenario === "single-invalid-core" ? [invalid, full()]
      : scenario === "single-exhausted" ? [error(), error()] : [full()];
    let calls = 0, storageFailures = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    const t = load("cloudfunctions/speakingLab/index.js", "processQueuedJob,startIndividualResponseAnalysis", {
      speaking_ai_jobs: [{ ...job, ir_feedback_state: null }], speaking_reports: [oldReport],
      speaking_individual_responses: [{_id:"s",response_session_id:"s",student_uid:"student",deleted_at:null,active_audio_revision:1,active_analysis_job_id:"j",report_id:"old",active_report_version:"r1",analysis_status:"ready",formal_audio_asset_id:"a",recording_status:"uploaded",question_snapshot:{text:source.questionText},report:oldReport.dse_analysis}],
      speaking_audio_assets: [{_id:"a",asset_id:"a",response_session_id:"s",asset_kind:"individual_response",status:"uploaded"}]
    }, () => {}, {
      "./speech-provider": { createSpeechProvider(){throw Error("ASR_NOT_ALLOWED");} },
      "../_shared/speaking-notifications": { enqueueSafely: async () => {} },
      "./model-provider": { createModelProvider(hooks){return {name:"fixture",protocol:"fixture",hostname:"fixture",async callStructuredModel(){
        const n=await hooks.beforeAttempt({deadlineAt:Date.now()+300000});calls++;
        if(scenario === "single-slow") await gate;
        const output=script.shift();
        await hooks.afterAttempt({model:"qwen3.8-max",usage:{input_tokens:100,output_tokens:50,total_tokens:150}},n);
        if(output instanceof Error) throw output;
        return {output,model:"qwen3.8-max",call_index:n};
      }};} }
    }, (table, values) => {
      if(scenario === "single-publication" && table === "speaking_individual_responses" && values.analysis_status === "ready" && storageFailures++ === 0) throw Error("synthetic storage failure");
    });
    if(scenario === "single-slow") {
      const running=t.fn.processQueuedJob({job_id:"j",dispatch_token:"dispatch"});
      while(calls === 0) await new Promise(resolve => setTimeout(resolve,0));
      const duplicate=await t.fn.processQueuedJob({job_id:"j",dispatch_token:"dispatch"});
      assert.equal(duplicate.status,"stale_or_already_claimed");
      const clicks=await Promise.all(["click-a","click-b"].map(operation_id=>t.fn.startIndividualResponseAnalysis({auth_uid:"student"},{response_session_id:"s",operation_id})));
      assert(clicks.every(r=>r.job.job_id === "j" && r.idempotent_replay));
      assert.equal(calls,1); assert.equal(t.tables.speaking_ai_jobs.length,1);
      release(); await running;
    } else {
      const turns=scenario === "single-success" ? 1 : 2;
      for(let i=0;i<turns;i++){
        const result=await t.fn.processQueuedJob({job_id:"j",dispatch_token:"dispatch"});
        if(i<turns-1) {
          assert.equal(t.tables.speaking_ai_jobs[0].status,"queued",JSON.stringify(result));
          if(scenario === "single-publication") assert(t.tables.speaking_ai_jobs[0].ir_model_result);
          t.tables.speaking_ai_jobs[0].next_retry_at=new Date(0);
        }
      }
    }
    assert.equal(t.tables.speaking_ai_jobs[0].status,scenario === "single-exhausted" ? "failed" : "succeeded",scenario);
    assert.equal(calls,["single-success","single-slow","single-publication"].includes(scenario)?1:2,scenario);
    assert.equal(t.tables.speaking_model_usage_events.length,calls);
    assert.deepEqual(t.tables.speaking_reports.find(r=>r.report_id === "old"),oldReport);
    if(scenario !== "single-exhausted") assert.equal(t.tables.speaking_ai_jobs[0].ir_model_result,null);
    if(["single-parse","single-invalid-core"].includes(scenario)) assert.equal(t.invocations(),1,"invalid completed response retries immediately once");
  }
  // A failed job remains immutable; two retry clicks create one same-audio resume.
  const failed={ ...job, refresh_kind:undefined, source_report_id:undefined, source_report_version:undefined,
    status:"failed",ir_feedback_state:singleState, provider_task_id:"existing-asr-task",model_retry_not_before:new Date(Date.now()+60000) };
  // Match the normal report identity without importing CloudBase into this test.
  const t=load("cloudfunctions/speakingLab/index.js","startIndividualResponseAnalysis,individualResponseReportIdentity",{
    speaking_ai_jobs:[failed],speaking_reports:[],speaking_individual_responses:[{_id:"s",response_session_id:"s",student_uid:"student",deleted_at:null,active_audio_revision:1,active_analysis_job_id:"j",formal_audio_asset_id:"a",recording_status:"uploaded"}]
  });
  t.tables.speaking_reports.push({_id:"cp",...t.fn.individualResponseReportIdentity(failed),response_session_id:"s",job_id:"j",status:"processing",transcript:{segments,duration_ms:1000}});
  const retries=await Promise.all(["retry-a","retry-b"].map(operation_id=>t.fn.startIndividualResponseAnalysis({auth_uid:"student"},{response_session_id:"s",operation_id})));
  assert.equal(retries[0].job.job_id,retries[1].job.job_id);
  assert.equal(t.tables.speaking_ai_jobs.length,2);
  assert.deepEqual(t.tables.speaking_ai_jobs[0],failed);
  const resumed=t.tables.speaking_ai_jobs[1];
  assert.equal(resumed.stage,"analysis"); assert.deepEqual(resumed.transcript.segments,segments);
  assert.deepEqual(resumed.ir_feedback_state,singleState); assert.equal(resumed.provider_task_id,"existing-asr-task");
  assert.equal(t.invocations(),0,"manual retry cannot skip uncertainty cooldown");
  assert.equal(resumed.resumed_from_job_id,"j");
  await assert.rejects(t.fn.startIndividualResponseAnalysis({auth_uid:"other-student"},{response_session_id:"s",operation_id:"denied"}),/ACCESS_DENIED/);
  Object.assign(t.tables.speaking_individual_responses[0],{active_audio_revision:2,formal_audio_asset_id:"replacement-audio",active_analysis_job_id:null});
  await t.fn.startIndividualResponseAnalysis({auth_uid:"student"},{response_session_id:"s",operation_id:"replacement"});
  const fresh=t.tables.speaking_ai_jobs[2];
  assert.equal(fresh.stage,"audio_quality");assert.equal(fresh.formal_audio_asset_id,"replacement-audio");
  assert.equal(fresh.transcript,undefined);assert.equal(fresh.ir_feedback_state,undefined);assert.equal(fresh.provider_task_id,undefined);
  console.log("IR single-call: normal one-call report, partial-only repair, invalid JSON/core bounded retry, storage resume without AI, active slow request/click dedupe, manual checkpoint resume and preserved failed audit passed.");
  console.log("IR V5: two-call batch, partial retention, isolated repair, parse fallback, bounded failure, legacy resume, exact grounding, no ASR, old report preservation and call audit passed.");
})().catch(e => { console.error(e); process.exitCode = 1; });
