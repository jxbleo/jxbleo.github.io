#!/usr/bin/env node
"use strict";
const assert = require("assert/strict");
const { configure, policy, desiredPatch, variables } = require("./configure-text-models");
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture(options = {}) {
  const rows = Object.fromEntries(["writingTutor", "speakingLab"].map((name) => {
    const prefix = name === "writingTutor" ? "WRITING_AI_TEXT" : "SPEAKING_AI_TEXT";
    const values = { [`${prefix}_MODEL`]: "qwen3.7-plus", [`${prefix}_QUOTA_FALLBACK_MODELS`]: "qwen3.8-max,qwen3.8-max-0902", [`${prefix}_API_KEY`]: "keep-private-key", WRITING_AI_MODEL: "qwen3.7-plus", WRITING_AI_VISION_MODEL: "qwen3.7-flash", OTHER_SECRET: "keep-other-secret" };
    return [name, { Status: "Active", Runtime: "Nodejs18.15", Timeout: 300, Triggers: [{name:"preserved"}], Environment: { Variables: Object.entries(values).map(([Key,Value])=>({Key,Value})) } }];
  }));
  const requests = [], logs = [];
  return { rows, requests, logs, client: { async call(request) {
    requests.push(clone(request));
    const name = request.Param.FunctionName;
    if (request.Action === "GetFunction") {
      if (options.failSpeakingRead && name === "speakingLab") throw Error("READ_FAILED");
      const readCount = requests.filter(r=>r.Action === "GetFunction" && r.Param.FunctionName === name).length;
      if (options.concurrentEdit && name === "writingTutor" && readCount === 2) rows[name].Timeout = 123;
      return clone(rows[name]);
    }
    assert.equal(request.Action, "UpdateFunctionConfiguration");
    assert.deepEqual(Object.keys(request.Param).sort(), ["Environment", "FunctionName", "Namespace"]);
    rows[name].Environment = clone(request.Param.Environment);
    return {};
  } } };
}
async function main() {
  const dry = fixture();
  await configure(dry.client, {emit: s=>dry.logs.push(s)});
  assert.equal(dry.requests.filter(r=>r.Action.startsWith("Update")).length,0);
  await assert.rejects(configure(dry.client, {check:true,emit:()=>{}}), /TEXT_MODEL_CONFIGURATION_DRIFT/);
  const applied = fixture();
  const original = clone(applied.rows);
  await configure(applied.client, {apply:true,emit:s=>applied.logs.push(s),sleep:async()=>{}});
  assert.deepEqual(applied.requests.filter(r=>r.Action.startsWith("Update")).map(r=>r.Param.FunctionName),["writingTutor","speakingLab"]);
  for (const name of Object.keys(original)) {
    const prefix=name === "writingTutor" ? "WRITING_AI_TEXT" : "SPEAKING_AI_TEXT";
    const before=variables(original[name]),after=variables(applied.rows[name]);
    assert.equal(after[`${prefix}_MODEL`],policy.primary_model);
    assert.equal(after[`${prefix}_QUOTA_FALLBACK_MODELS`],policy.quota_fallback_models.join(","));
    for(const key of Object.keys(before).filter(k=>!Object.hasOwn(desiredPatch(prefix),k)))assert.equal(after[key],before[key]);
  }
  assert.doesNotMatch(applied.logs.join("\n"),/keep-private-key|keep-other-secret/);
  const updateCount=applied.requests.filter(r=>r.Action.startsWith("Update")).length;
  await configure(applied.client,{apply:true,emit:()=>{}});
  assert.equal(applied.requests.filter(r=>r.Action.startsWith("Update")).length,updateCount,"apply is idempotent");
  await configure(applied.client,{check:true,emit:()=>{}});
  for (const option of [{failSpeakingRead:true},{concurrentEdit:true}]) {
    const failed=fixture(option);
    await assert.rejects(configure(failed.client,{apply:true,emit:()=>{}}));
    assert.equal(failed.requests.filter(r=>r.Action.startsWith("Update")).length,0);
  }
  assert.throws(()=>desiredPatch("TEXT",{primary_model:"x",quota_fallback_models:["x"]}),/INVALID_TEXT_MODEL_POLICY/);
  // Both real provider adapters must select the exact same policy, with independent OCR.
  const writingEnv = {...variables(applied.rows.writingTutor),WRITING_AI_API_KEY:"test",WRITING_AI_API_URL:"https://dashscope.aliyuncs.com/test",WRITING_AI_PROTOCOL:"chat_json_object"};
  Object.assign(process.env,writingEnv);
  const writing=require("../cloudfunctions/writingTutor/model-provider")._test.providerConfig(false);
  const speaking=require("../cloudfunctions/speakingLab/model-provider")._test.configuration({...variables(applied.rows.speakingLab),SPEAKING_AI_TEXT_API_URL:"https://dashscope.aliyuncs.com/test",SPEAKING_AI_TEXT_PROTOCOL:"chat_json_object"});
  assert.equal(writing.model,speaking.model);
  assert.deepEqual(writing.quotaFallbackModels,speaking.quotaFallbackModels);
  assert.equal(require("../cloudfunctions/writingTutor/model-provider")._test.providerConfig(true).model,"qwen3.7-flash");
  console.log("Paired text model policy passed: dry-run, drift detection, both adapters, idempotence, secret/config preservation, read failure and concurrent-edit guards.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
