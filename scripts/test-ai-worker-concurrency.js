#!/usr/bin/env node
// Offline regression checks: synthetic fixtures, real implementation, no provider/cloud calls.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const workerPath = path.resolve(__dirname, "../cloudfunctions/speakingAiWorker/index.js");
const clone = (v) => structuredClone(v);
function harness({ rows = {}, afterScan = () => {
} } = {}) {
  const tables = clone(rows);
  const writes = [];
  const deletedFiles = [];
  let transactionDepth = 0;
  let active = 0, peak = 0, invocations = 0, scans = 0;
  function matches(row, where) {
    return Object.entries(where).every(([key, value]) => value && value._op === "lte" ? new Date(row[key]).getTime() <= new Date(value.value).getTime() : row[key] === value);
  }
  const db = { command: { lte: (value) => ({ _op: "lte", value }) }, runTransaction: async (fn) => {
    transactionDepth++;
    try {
      return await fn(db);
    } finally {
      transactionDepth--;
    }
  } };
  db.collection = (table) => {
    let where = {}, limit = 100, docId;
    const api = {
      where: (value) => {
        where = value;
        return api;
      },
      limit: (value) => {
        limit = value;
        return api;
      },
      orderBy: () => api,
      doc: (id) => {
        docId = id;
        return api;
      },
      field: () => api,
      get: async () => {
        scans++;
        const selected = (tables[table] || []).filter((row) => docId ? row._id === docId : matches(row, where)).slice(0, limit);
        const data = clone(selected);
        if (!transactionDepth) afterScan({ table, where, tables });
        return { data };
      },
      update: async (update) => {
        const selected = (tables[table] || []).filter((row) => docId ? row._id === docId : matches(row, where));
        for (const row of selected) {
          writes.push({ table, id: row._id, transaction: transactionDepth > 0, update: clone(update) });
          Object.assign(row, clone(update));
        }
        return { updated: selected.length };
      },
      create: async (row) => {
        tables[table] ||= [];
        tables[table].push({ ...clone(row), _id: docId });
        return {};
      }
    };
    return api;
  };
  const app = { config: {}, database: () => db, deleteFile: async ({ fileList }) => { deletedFiles.push(...fileList); return {}; } };
  const exports = {};
  const context = { exports, console: { error: () => {
  }, log: () => {
  } }, Date, Buffer, setTimeout, clearTimeout, Promise, process: { env: {} }, require: (name) => {
    if (name === "@cloudbase/node-sdk") return { init: () => app, SYMBOL_CURRENT_ENV: "test" };
    if (name === "@cloudbase/node-sdk/dist/cloudbase") return { CloudBase: { getCloudbaseContext: () => ({}) } };
    if (name === "@cloudbase/node-sdk/dist/utils/tcbapirequester") return { request: async () => {
      active++;
      peak = Math.max(peak, active);
      invocations++;
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return {};
    } };
    if (name === "../_shared/tencent-asr-voiceprint") return { configured: () => false };
    return name.startsWith(".") ? require(path.resolve(path.dirname(workerPath), name)) : require(name);
  } };
  vm.runInNewContext(fs.readFileSync(workerPath, "utf8") + "\nexports._parentReview={recoverLeases,failExhausted,dispatchQueued,cleanupAssets,cleanupVoiceprints,expireShares};", context, { filename: workerPath });
  return { functions: exports._parentReview, exports, db, tables, writes, deletedFiles, stats: () => ({ peak, invocations, scans }) };
}
const stamp = /* @__PURE__ */ new Date();
const expired = new Date(stamp.getTime() - 1e3);
const future = new Date(stamp.getTime() + 36e4);
const base = { _id: "job-a", job_id: "job-a", dispatch_token: "private-fixture-token", status: "processing", lease_token: "old-lease", lease_until: expired, attempt_count: 2 };
const cases = [];
async function check(name, fn) {
  try {
    await fn();
    cases.push({ name, passed: true });
  } catch (error) {
    cases.push({ name, passed: false, message: error.message });
  }
}
const budget = { deadline: Date.now() + 55e3, deadlineAt: Date.now() + 55e3, deadlineMs: Date.now() + 55e3, remaining: () => 55e3, remainingMs: () => 55e3, canStart: () => true, hasTime: () => true };
(async () => {
  await check("recovery cannot resurrect a job completed after scan", async () => {
    let done = false;
    const h = harness({ rows: { speaking_ai_jobs: [base] }, afterScan: ({ table, tables }) => {
      if (!done && table === "speaking_ai_jobs") {
        done = true;
        Object.assign(tables[table][0], { status: "succeeded", lease_token: null, lease_until: null });
      }
    } });
    await h.functions.recoverLeases(stamp, budget);
    assert.equal(h.tables.speaking_ai_jobs[0].status, "succeeded");
    assert.equal(h.writes.length, 0);
  });
  await check("recovery cannot overwrite a newer active lease", async () => {
    let done = false;
    const h = harness({ rows: { speaking_ai_jobs: [base] }, afterScan: ({ table, tables }) => {
      if (!done && table === "speaking_ai_jobs") {
        done = true;
        Object.assign(tables[table][0], { lease_token: "new-lease", lease_until: future });
      }
    } });
    await h.functions.recoverLeases(stamp, budget);
    assert.equal(h.tables.speaking_ai_jobs[0].lease_token, "new-lease");
    assert.equal(h.writes.length, 0);
  });
  await check("exhausted scan cannot overwrite a new retry lease or its response", async () => {
    let done = false;
    const h = harness({ rows: { speaking_ai_jobs: [{ ...base, attempt_count: 5, job_type: "individual_response_analysis", response_session_id: "response-a" }], speaking_individual_responses: [{ _id: "response-a", response_session_id: "response-a", active_analysis_job_id: "job-a", analysis_status: "processing" }] }, afterScan: ({ table, tables }) => {
      if (!done && table === "speaking_ai_jobs") {
        done = true;
        Object.assign(tables[table][0], { attempt_count: 1, lease_token: "new-lease", lease_until: future });
      }
    } });
    await h.functions.failExhausted(stamp, budget);
    assert.equal(h.tables.speaking_ai_jobs[0].status, "processing");
    assert.equal(h.tables.speaking_individual_responses[0].analysis_status, "processing");
    assert.equal(h.writes.length, 0);
  });
  await check("eligible expired lease recovery is transactional", async () => {
    const h = harness({ rows: { speaking_ai_jobs: [base] } });
    await h.functions.recoverLeases(stamp, budget);
    assert.equal(h.tables.speaking_ai_jobs[0].status, "queued");
    assert(h.writes.length > 0);
    assert(h.writes.every((row) => row.transaction));
  });
  await check("IR abandoned model request gets cooldown before timer redispatch", async () => {
    const row = {...base,job_type:"individual_response_analysis",stage:"analysis",model_request_deadline_at:expired};
    const h=harness({rows:{speaking_ai_jobs:[row]}});
    await h.functions.recoverLeases(stamp,budget);
    assert.equal(h.tables.speaking_ai_jobs[0].status,"queued");
    assert(new Date(h.tables.speaking_ai_jobs[0].next_retry_at).getTime() >= expired.getTime()+60000);
    await h.functions.dispatchQueued(stamp,budget);
    assert.equal(h.stats().invocations,0);
  });
  await check("IR saved completion recovers without an unnecessary cooldown", async () => {
    const h=harness({rows:{speaking_ai_jobs:[{...base,job_type:"individual_response_analysis",stage:"analysis",ir_model_result:{scope:"report"}}]}});
    await h.functions.recoverLeases(stamp,budget);
    await h.functions.dispatchQueued(stamp,budget);
    assert.equal(h.stats().invocations,1);
  });
  await check("dispatch concurrency stays at most three and processes eligible queue", async () => {
    const jobs = Array.from({ length: 12 }, (_, i) => ({ ...base, _id: `job-${i}`, job_id: `job-${i}`, status: "queued", next_retry_at: expired }));
    const h = harness({ rows: { speaking_ai_jobs: jobs } });
    await h.functions.dispatchQueued(stamp, budget);
    assert.equal(h.stats().invocations, 12);
    assert(h.stats().peak <= 3);
  });
  await check("expired worker budget starts no new phase or database scan", async () => {
    const h = harness();
    for (const operation of Object.values(h.functions)) {
      assert.equal(await operation(stamp, { deadlineAt: Date.now() - 1 }), 0);
    }
    assert.equal(h.stats().scans, 0);
    assert.equal(h.stats().invocations, 0);
  });
  await check("slow first maintenance scan prevents follow-up scans and writes", async () => {
    const runtime = { deadlineAt: Date.now() + 52000 };
    const h = harness({ afterScan: () => { runtime.deadlineAt = Date.now() - 1; } });
    assert.equal(await h.functions.cleanupAssets(stamp, runtime), 0);
    assert.equal(h.stats().scans, 1);
    assert.equal(h.writes.length, 0);
  });
  await check("asset stays eligible when participant cleanup exhausts budget", async () => {
    const runtime = { deadlineAt: Date.now() + 52000 };
    const h = harness({ rows: {
      speaking_audio_assets: [{ _id: "asset-a", asset_id: "asset-a", status: "uploaded", delete_after: expired, asset_kind: "voice_reference", participant_id: "participant-a" }],
      speaking_participants: [{ _id: "participant-a", participant_id: "participant-a", voice_reference_asset_id: "asset-a", voice_reference_status: "uploaded" }],
    }, afterScan: ({ table }) => { if (table === "speaking_participants") runtime.deadlineAt = Date.now() - 1; } });
    assert.equal(await h.functions.cleanupAssets(stamp, runtime), 0);
    assert.equal(h.tables.speaking_audio_assets[0].status, "uploaded");
    assert.equal(h.writes.length, 0);
  });
  await check("scheduled cleanup preserves every submitted original including superseded and legacy assets", async () => {
    const h = harness({ rows: { speaking_audio_assets: [
      { _id: "formal", asset_kind: "formal_discussion", status: "uploaded", delete_after: expired, file_id: "original" },
      { _id: "old", asset_kind: "formal_discussion", status: "superseded", delete_after: expired, file_id: "old-original" },
      { _id: "individual", asset_kind: "individual_response", status: "uploaded", delete_after: expired, file_id: "response-original" },
      { _id: "legacy", status: "uploaded", delete_after: expired, file_id: "legacy-original" },
      { _id: "reference", asset_kind: "voice_reference", status: "uploaded", delete_after: expired, file_id: "temporary-reference" },
    ] } });
    assert.equal(await h.functions.cleanupAssets(stamp), 1);
    for (const row of h.tables.speaking_audio_assets.slice(0, 4)) {
      assert.notEqual(row.status, "deleted"); assert.equal(row.delete_after, null); assert(row.file_id);
    }
    assert.equal(h.tables.speaking_audio_assets[4].status, "deleted");
    assert.deepEqual(h.deletedFiles, ["temporary-reference"]);
  });
  console.log(JSON.stringify(cases, null, 2));
  if (cases.some((row) => !row.passed)) process.exitCode = 1;
})();
