#!/usr/bin/env node
// Offline regression checks: synthetic fixtures, real implementation, no provider/cloud calls.
"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const { createRequire } = require("node:module");
function load(relative, expose, rows, onInvoke = () => {}, overrides = {}) {
  const file = path.resolve(__dirname, "..", relative), realRequire = createRequire(file), tables = structuredClone(rows);
  let invocations = 0;
  let tail = Promise.resolve();
  const db = { command: { set: (value) => value }, runTransaction: (fn) => {
    const p = tail.then(() => fn(db));
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
const cases = [];
async function check(name, fn) {
  try {
    await fn();
    cases.push({ name, passed: true });
  } catch (e) {
    cases.push({ name, passed: false, message: e.message });
  }
}
const live = { _id: "job-a", job_id: "job-a", status: "processing", dispatch_token: "fixture-dispatch", lease_token: "fixture-lease", lease_until: new Date(Date.now() + 36e4), attempt_count: 1 };
const speaking = (rows, onInvoke) => load("cloudfunctions/speakingLab/index.js", "claimJob,requeueAndDispatch,reserveProviderCall,providerUsageEvent", { speaking_ai_jobs: rows }, onInvoke);
(async () => {
  await check("future retry cannot be claimed early", async () => {
    const row = { ...live, status: "queued", next_retry_at: new Date(Date.now() + 6e4) };
    const h = speaking([row]);
    await assert.rejects(h.fn.claimJob(row, row.dispatch_token));
    assert.equal(h.tables.speaking_ai_jobs[0].status, "queued");
  });
  await check("overlapping timer and self dispatch acquire only one lease", async () => {
    const row = { ...live, status: "queued", next_retry_at: /* @__PURE__ */ new Date(0) };
    const h = speaking([row]);
    const result = await Promise.allSettled([h.fn.claimJob(row, row.dispatch_token), h.fn.claimJob(row, row.dispatch_token)]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(h.tables.speaking_ai_jobs[0].attempt_count, 2);
  });
  await check("immediate continuation dispatches only after durable requeue", async () => {
    const h = speaking([live], (tables) => {
      assert.equal(tables.speaking_ai_jobs[0].status, "queued");
      assert.equal(tables.speaking_ai_jobs[0].lease_token, null);
      return {};
    });
    assert.equal(await h.fn.requeueAndDispatch(live, { stage: "transcription", next_retry_at: /* @__PURE__ */ new Date(0) }), true);
    assert.equal(h.invocations(), 1);
    assert.equal(h.tables.speaking_ai_jobs[0].attempt_count, 0);
  });
  await check("pending continuation never self dispatches early", async () => {
    const h = speaking([live]);
    await h.fn.requeueAndDispatch(live, { stage: "transcription", next_retry_at: new Date(Date.now() + 15e3) });
    assert.equal(h.invocations(), 0);
  });
  await check("dispatch error leaves durable queued fallback intact", async () => {
    const h = speaking([live], () => {
      throw new Error("synthetic transport");
    });
    assert.equal(await h.fn.requeueAndDispatch(live, { next_retry_at: /* @__PURE__ */ new Date(0) }), true);
    assert.equal(h.tables.speaking_ai_jobs[0].status, "queued");
  });
  await check("old lease cannot requeue or dispatch new active work", async () => {
    const h = speaking([{ ...live, lease_token: "new-lease" }]);
    assert.equal(await h.fn.requeueAndDispatch(live, { next_retry_at: /* @__PURE__ */ new Date(0) }), false);
    assert.equal(h.invocations(), 0);
    assert.equal(h.tables.speaking_ai_jobs[0].lease_token, "new-lease");
  });
  await check("expired lease cannot reserve a physical provider call", async () => {
    const row = { ...live, lease_until: /* @__PURE__ */ new Date(0) };
    const h = speaking([row]);
    await assert.rejects(h.fn.reserveProviderCall(row, "model_call_count"));
    assert.equal(h.tables.speaking_ai_jobs[0].model_call_count, void 0);
  });
  await check("legacy speaking duration stays unknown", async () => {
    const h = speaking([live]);
    const row = h.fn.providerUsageEvent(live, "fixture", 1, "openai_compatible", {});
    assert.equal(row.duration_ms, null);
  });
  await check("completed individual ASR hands off without using its released lease", async () => {
    const row = { ...live, stage: "transcription", job_type: "individual_response_analysis", response_session_id: "response-a", response_revision: 1, formal_audio_asset_id: "audio-a", provider_task_id: "synthetic-asr" };
    let modelStarts = 0;
    const h = load("cloudfunctions/speakingLab/index.js", "processIndividualResponseQueuedJob", {
      speaking_ai_jobs: [row],
      speaking_individual_responses: [{ _id: "response-a", response_session_id: "response-a", active_analysis_job_id: row.job_id, active_audio_revision: 1, deleted_at: null }],
      speaking_audio_assets: [{ _id: "audio-a", asset_id: "audio-a", response_session_id: "response-a", asset_kind: "individual_response", status: "uploaded" }],
    }, (tables) => {
      assert.equal(tables.speaking_ai_jobs[0].status, "queued");
      return {};
    }, {
      "./speech-provider": { createSpeechProvider: () => ({ name: "synthetic", transcribeAndDiarize: async () => ({ status: "completed", output: { duration_ms: 1000, segments: [{ start_ms: 0, end_ms: 1000, text: "Synthetic answer." }] } }) }) },
      "./model-provider": { createModelProvider: () => { modelStarts += 1; throw new Error("Released lease must not start a model"); } },
    });
    const result = await h.fn.processIndividualResponseQueuedJob(row);
    assert.equal(result.status, "queued");
    assert.equal(result.stage, "analysis");
    assert.equal(modelStarts, 0);
    assert.equal(h.invocations(), 1);
    assert.equal(h.tables.speaking_reports.length, 1);
  });
  await check("speaking validation preserves the provider result and exact failure code", async () => {
    const h = load("cloudfunctions/speakingLab/index.js", "markModelValidationFailure", {
      speaking_ai_jobs: [live],
      speaking_model_usage_events: [{ _id: "usage-a", outcome: "completed", input_tokens: 12 }],
    });
    await h.fn.markModelValidationFailure(live, "individual_analysis", { call_index: 1 }, "INDIVIDUAL_RESPONSE_COACHING_INVALID");
    assert.equal(h.tables.speaking_ai_jobs[0].validation_status, "failed");
    assert.equal(h.tables.speaking_ai_jobs[0].validation_safe_error_code, "INDIVIDUAL_RESPONSE_COACHING_INVALID");
    assert.equal(h.tables.speaking_model_usage_events[0].outcome, "completed");
    assert.equal(h.tables.speaking_model_usage_events[0].input_tokens, 12);
  });
  await check("writing business alignment failure is distinct from provider failure", async () => {
    const row = { ...live, job_type: "review", composition_id: "composition-a", student_uid: "synthetic", validation_status: "pending" };
    const h = load("cloudfunctions/writingTutor/index.js", "finishFailedJobAttempt", { writing_ai_jobs: [row] });
    await h.fn.finishFailedJobAttempt(row, "WRITING_AI_SENTENCE_ALIGNMENT_FAILED");
    assert.equal(h.tables.writing_ai_jobs[0].validation_status, "failed");
    assert.equal(h.tables.writing_ai_jobs[0].validation_safe_error_code, "WRITING_AI_SENTENCE_ALIGNMENT_FAILED");
  });
  const schema = { type: "object", required: ["answer"], properties: { answer: { type: "string" } }, additionalProperties: false };
  const options = { system: "synthetic", userText: "synthetic", schemaName: "fixture", schema, timeoutMs: 1e3 };
  Object.assign(process.env, { WRITING_AI_TEXT_API_KEY: "local-test-only", WRITING_AI_TEXT_API_URL: "https://dashscope.example.test/v1/chat/completions", WRITING_AI_TEXT_MODEL: "fixture-primary", WRITING_AI_TEXT_PROTOCOL: "chat_json_object", WRITING_AI_TEXT_QUOTA_FALLBACK_MODELS: "fixture-backup" });
  await check("writing expired lease sends no model request", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      throw new Error("should not call");
    };
    const row = { ...live, lease_until: /* @__PURE__ */ new Date(0) };
    const h = load("cloudfunctions/writingTutor/index.js", "callModelForJob", { writing_ai_jobs: [row] });
    await assert.rejects(h.fn.callModelForJob(row, "fixture", options));
    assert.equal(calls, 0);
  });
  await check("writing lease replaced after quota refusal prevents fallback", async () => {
    let calls = 0;
    const row = { ...live, student_uid: "fixture-private", composition_id: "fixture-composition" };
    const h = load("cloudfunctions/writingTutor/index.js", "callModelForJob", { writing_ai_jobs: [row] });
    global.fetch = async () => {
      calls++;
      h.tables.writing_ai_jobs[0].lease_token = "new-lease";
      return { ok: false, status: 403, headers: { get: () => null }, json: async () => ({ code: "AllocationQuota.FreeTierOnly" }) };
    };
    await assert.rejects(h.fn.callModelForJob(row, "fixture", options));
    assert.equal(calls, 1);
    assert.equal(h.tables.writing_ai_jobs[0].lease_token, "new-lease");
  });
  console.log(JSON.stringify(cases, null, 2));
  if (cases.some((r) => !r.passed)) process.exitCode = 1;
})();
