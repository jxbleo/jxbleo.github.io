#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const { retryPlan, recoveredRetryAt } = require("../cloudfunctions/_shared/speaking-ir-retry");
const provider = require("../cloudfunctions/speakingLab/model-provider");
const now = 1000000;
const job = { job_type: "individual_response_analysis", stage: "analysis", lease_until: new Date(now + 360000), model_request_deadline_at: new Date(now + 300000) };
const config = { apiKey: "fixture", url: "https://dashscope.example.test/v1/chat/completions", model: "qwen3.8-max", qwenCompatible: true, maxOutputTokens: 16000, timeoutMs: 300000, quotaFallbackModels: [] };
const response = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: key => headers[key] || null }, text: async () => typeof body === "string" ? body : JSON.stringify(body) });
const complete = { choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } };
(async () => {
  assert.equal(retryPlan(job, {code:"SPEAKING_AI_SCHEMA_INVALID"},1,now).at,now);
  assert.equal(retryPlan(job, {code:"SPEAKING_AI_TIMEOUT"},1,now).at,now+420000);
  assert.equal(retryPlan(job, {code:"SPEAKING_AI_TRANSPORT_ERROR"},1,now).kind,"outcome_unknown");
  assert.equal(retryPlan(job, {code:"SPEAKING_AI_TIMEOUT",responseCompletedAt:new Date(now)},1,now).at,now+15000);
  assert.equal(retryPlan(job, {code:"SPEAKING_AI_RATE_LIMITED",retryAfterMs:180000},1,now).at,now+180000);
  assert.equal(retryPlan(job, {code:"SPEAKING_AI_RATE_LIMITED"},2,now).at,now+120000);
  assert.equal(recoveredRetryAt(job,now+360000),now+420000);
  assert.equal(recoveredRetryAt({...job,ir_model_result:{scope:"report"}},now+360000),now+360000);
  assert.equal(recoveredRetryAt({...job,exam_family:"ielts"},now+360000),now+360000);
  assert.equal(recoveredRetryAt({...job,stage:"transcription"},now+360000),now+360000);
  let calls=0,signal;
  const rows=[];
  // A slow but live completion is awaited once, even across several short UI
  // polling intervals. Only the provider deadline may terminate the call.
  const ok=await provider.callStructuredModel({}, {config,fetch:async (_url,opts)=>{
    calls++;signal=opts.signal; await new Promise(resolve=>setTimeout(resolve,60)); return response(200,complete);
  },afterAttempt:async row=>rows.push(row)});
  assert.equal(ok.output.ok,true);assert.equal(calls,1);assert.equal(signal.aborted,false);
  assert.equal(rows[0].usage.total_tokens,20);
  // Even if a mocked remote ignores cancellation and returns late, no hidden
  // fallback/retry request is dispatched by the provider wrapper.
  calls=0;
  await assert.rejects(provider.callStructuredModel({}, {config,deadlineAt:Date.now()+15,fetch:async (_url,opts)=>{
    calls++;signal=opts.signal;await new Promise(resolve=>setTimeout(resolve,45));return response(200,complete);
  }}),error=>error.code === "SPEAKING_AI_TIMEOUT" && !error.responseCompletedAt);
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(calls,1);assert.equal(signal.aborted,true);
  const malformed=structuredClone(complete);malformed.choices[0].message.content='{"broken":';
  const failed=[];
  await assert.rejects(provider.callStructuredModel({}, {config,fetch:async()=>response(200,malformed),afterAttempt:async row=>failed.push(row)}),error=>error.code === "SPEAKING_AI_SCHEMA_INVALID" && Boolean(error.responseCompletedAt));
  assert.equal(failed[0].usage.total_tokens,20,"invalid JSON still records billed usage");
  await assert.rejects(provider.callStructuredModel({}, {config,fetch:async()=>response(429,{error:{code:"rate_limit"}},{"retry-after":"180"})}),error=>error.retryAfterMs === 180000 && Boolean(error.responseCompletedAt));
  await assert.rejects(provider.callStructuredModel({}, {config,fetch:async()=>response(503,"upstream unavailable",{"retry-after":"240"})}),error=>error.retryAfterMs === 240000 && error.code === "SPEAKING_AI_PROVIDER_UNAVAILABLE");
  calls=0;
  await assert.rejects(provider.callStructuredModel({}, {config:{...config,quotaFallbackModels:["qwen3.8-max-0902"]},fetch:async()=>{calls++;return response(401,{error:{code:"bad_key"}});}}),error=>error.code === "SPEAKING_PROVIDER_NOT_CONFIGURED");
  assert.equal(calls,1,"authentication failure must not fall back or automatically repeat");
  console.log("IR retry timing: wait once for slow success, bounded timeout without hidden replay, uncertain-outcome grace, Retry-After, lease recovery, invalid-JSON Token audit and fail-closed auth passed.");
})().catch(error=>{console.error(error);process.exitCode=1;});
