"use strict";
const assert = require("assert/strict");
const provider = require("../cloudfunctions/speakingLab/model-provider");
const env = {
  SPEAKING_AI_TEXT_API_KEY: "test-only-key",
  SPEAKING_AI_TEXT_API_URL: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
  SPEAKING_AI_TEXT_MODEL: "qwen3.7-plus",
  SPEAKING_AI_TEXT_PROTOCOL: "chat_json_object",
  SPEAKING_AI_TEXT_QUOTA_FALLBACK_MODELS: "qwen3.8-max,qwen3.8-max-0902",
};
const quota = { error: { code: "insufficient_quota", message: 'Free quota exhausted. To continue accessing the model on a paid basis, please add funds or disable the "use free tier only" mode in the management console.' } };
const success = { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } };
function harness(responses, overrides = {}) {
  const requests = [], events = [], starts = [];
  const model = provider.createModelProvider({ env, ...overrides,
    beforeAttempt: async (metadata) => { starts.push(metadata); return starts.length; },
    afterAttempt: async (metadata, index) => { events.push({ ...metadata, index }); },
    fetch: async (url, options) => {
      const payload = JSON.parse(options.body); requests.push(payload);
      const response = responses.shift(); assert(response, "Unexpected extra physical request");
      if (response instanceof Error) throw response;
      return { status: response.status, ok: response.status === 200, headers: { get: () => `request-${requests.length}` }, text: async () => JSON.stringify(response.body) };
    },
  });
  return { requests, events, starts, call: () => model.callStructuredModel({ system_prompt: "Return JSON", user_prompt: "private test input" }) };
}
async function main() {
  let h = harness([{ status: 200, body: success }]);
  let result = await h.call();
  assert.equal(result.model, "qwen3.7-plus"); assert.equal(result.quota_fallback_used, false); assert.equal(h.requests.length, 1);
  h = harness([{ status: 403, body: quota }, { status: 200, body: success }]);
  result = await h.call();
  assert.deepEqual(h.requests.map(r => r.model), ["qwen3.7-plus", "qwen3.8-max"]);
  assert.equal(result.model, "qwen3.8-max"); assert.equal(result.primary_model, "qwen3.7-plus"); assert.equal(result.quota_fallback_used, true);
  assert.equal(result.usage.total_tokens, 20);
  assert.equal(h.events[0].safe_error_code, "SPEAKING_AI_FREE_QUOTA_EXHAUSTED");
  assert.deepEqual(h.events.map(e => e.index), [1, 2]);
  assert.deepEqual(h.starts.map(e => e.model), h.requests.map(r => r.model));
  assert(!JSON.stringify(h.events).includes("private test input")); assert(!JSON.stringify(h.events).includes("Free quota exhausted"));
  for (const request of h.requests) { assert.equal(request.max_tokens, 16000); assert.equal(request.enable_thinking, false); assert.deepEqual(request.messages, h.requests[0].messages); }
  const exactStop = { error: { code: "AllocationQuota.FreeTierOnly" } };
  h = harness([{ status: 403, body: exactStop }, { status: 403, body: quota }, { status: 200, body: success }]);
  result = await h.call(); assert.equal(result.model, "qwen3.8-max-0902"); assert.equal(h.requests.length, 3);
  h = harness(Array.from({ length: 3 }, () => ({ status: 403, body: quota })));
  await assert.rejects(h.call, e => e.code === "SPEAKING_AI_FREE_QUOTA_EXHAUSTED"); assert.equal(h.requests.length, 3);
  for (const response of [
    { status: 401, body: quota }, { status: 429, body: quota }, { status: 500, body: quota },
    { status: 403, body: { error: { code: "insufficient_quota", message: "Account balance insufficient" } } },
    { status: 403, body: { error: { code: "insufficient_quota", message: "Free quota exhausted" } } },
    { status: 403, body: { error: { code: "AccessDenied", message: quota.error.message } } },
    { status: 200, body: { choices: [{ message: { content: "not JSON" } }] } },
    new Error("network timeout"),
  ]) { h = harness([response]); await assert.rejects(h.call); assert.equal(h.requests.length, 1); }
  h = harness([{ status: 403, body: quota }], { env: { ...env, SPEAKING_AI_TEXT_QUOTA_FALLBACK_MODELS: "" } });
  await assert.rejects(h.call); assert.equal(h.requests.length, 1);
  h = harness([{ status: 403, body: quota }], { env: { ...env, SPEAKING_AI_TEXT_API_URL: "https://other.example.test/chat" } });
  await assert.rejects(h.call); assert.equal(h.requests.length, 1);
  assert.throws(() => provider.createModelProvider({ env: { ...env, SPEAKING_AI_TEXT_QUOTA_FALLBACK_MODELS: "qwen3.7-plus" } }));
  const times = [0, 1, 2, 180001]; const originalNow = Date.now;
  try { Date.now = () => times.shift() ?? 180001; h = harness([{ status: 403, body: quota }]); await assert.rejects(h.call, e => e.code === "SPEAKING_AI_TIMEOUT"); assert.equal(h.requests.length, 1); } finally { Date.now = originalNow; }
  let sent = 0;
  const superseded = provider.createModelProvider({ env, beforeAttempt: async () => { throw new Error("SPEAKING_JOB_SUPERSEDED"); }, fetch: async () => { sent++; } });
  await assert.rejects(() => superseded.callStructuredModel({}), /SPEAKING_JOB_SUPERSEDED/); assert.equal(sent, 0);
  console.log("Speaking model quota fallback contracts passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
