#!/usr/bin/env node

"use strict";

const assert = require("assert");
const path = require("path");

const providerPath = path.resolve(__dirname, "../cloudfunctions/writingTutor/model-provider.js");
const ENV_KEYS = [
  "WRITING_AI_API_KEY",
  "WRITING_AI_API_URL",
  "WRITING_AI_MODEL",
  "WRITING_AI_PROTOCOL",
  "WRITING_AI_TEXT_API_KEY",
  "WRITING_AI_TEXT_API_URL",
  "WRITING_AI_TEXT_MODEL",
  "WRITING_AI_TEXT_PROTOCOL",
  "WRITING_AI_TEXT_QUOTA_FALLBACK_MODELS",
  "WRITING_AI_TEXT_QUOTA_FALLBACK_MODEL",
  "WRITING_AI_VISION_MODEL",
];

function response(status, payload, requestId) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === "x-request-id" ? requestId : null },
    json: async () => payload,
  };
}

function successPayload(value, requestId) {
  return {
    id: requestId,
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  };
}

function configure() {
  ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.WRITING_AI_API_KEY = "private-test-key";
  process.env.WRITING_AI_API_URL = "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions";
  process.env.WRITING_AI_MODEL = "qwen3.7-plus";
  process.env.WRITING_AI_PROTOCOL = "chat_json_schema";
  process.env.WRITING_AI_TEXT_QUOTA_FALLBACK_MODELS = "qwen3.8-max,qwen3.8-max-0902";
}

const options = {
  system: "Return JSON.",
  userText: "Return a short answer.",
  schemaName: "quota_fallback_test",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["answer"],
    properties: { answer: { type: "string" } },
  },
  images: [],
};

async function main() {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const previousFetch = global.fetch;
  try {
    configure();
    delete require.cache[providerPath];
    const provider = require(providerPath);

    assert.deepStrictEqual(provider._test.providerConfig(false).quotaFallbackModels,
      ["qwen3.8-max", "qwen3.8-max-0902"]);
    assert.strictEqual(provider._test.providerConfig(true).model, "qwen3.7-flash");
    assert.deepStrictEqual(provider._test.providerConfig(true).quotaFallbackModels, [],
      "text quota fallback must never affect OCR");

    const bodies = [];
    const replies = [
      response(403, { code: "AllocationQuota.FreeTierOnly", message: "free quota exhausted" }, "primary-quota"),
      response(403, { code: "AllocationQuota.FreeTierOnly", message: "free quota exhausted" }, "first-fallback-quota"),
      response(200, successPayload({ answer: "second fallback" }, "second-fallback-success"), "second-fallback-success"),
    ];
    global.fetch = async (_url, request) => {
      bodies.push(JSON.parse(request.body));
      return replies.shift();
    };

    const result = await provider.callStructuredModel(options);
    assert.deepStrictEqual(bodies.map((body) => body.model),
      ["qwen3.7-plus", "qwen3.8-max", "qwen3.8-max-0902"]);
    assert.deepStrictEqual(result.data, { answer: "second fallback" });
    assert.strictEqual(result.metadata.model, "qwen3.8-max-0902");
    assert.strictEqual(result.metadata.primary_model, "qwen3.7-plus");
    assert.strictEqual(result.metadata.quota_fallback_model, "qwen3.8-max-0902");
    assert.deepStrictEqual(result.metadata.quota_fallback_models,
      ["qwen3.8-max", "qwen3.8-max-0902"]);
    assert.strictEqual(result.metadata.quota_fallback_index, 1);
    assert.strictEqual(result.metadata.quota_fallback_used, true);
    assert.deepStrictEqual(result.telemetry.attempts.map((attempt) => [attempt.model, attempt.outcome]), [
      ["qwen3.7-plus", "quota_exhausted"],
      ["qwen3.8-max", "quota_exhausted"],
      ["qwen3.8-max-0902", "structured_success"],
    ]);

    let genericCalls = 0;
    global.fetch = async () => {
      genericCalls += 1;
      return response(403, { code: "AccessDenied", message: "not quota related" }, "denied");
    };
    await assert.rejects(
      provider.callStructuredModel(options),
      (error) => error.message === "WRITING_AI_HTTP_403"
        && error.providerCode === "AccessDenied"
        && error.providerTelemetry.attempts.length === 1,
    );
    assert.strictEqual(genericCalls, 1, "generic provider failures must not trigger the quota fallback");

    const exhaustedModels = [];
    global.fetch = async (_url, request) => {
      exhaustedModels.push(JSON.parse(request.body).model);
      return response(403, { code: "AllocationQuota.FreeTierOnly" }, `quota-${exhaustedModels.length}`);
    };
    await assert.rejects(
      provider.callStructuredModel(options),
      (error) => error.message === "WRITING_AI_HTTP_403"
        && error.providerCode === "AllocationQuota.FreeTierOnly"
        && error.providerTelemetry.attempts.length === 3,
    );
    assert.deepStrictEqual(exhaustedModels,
      ["qwen3.7-plus", "qwen3.8-max", "qwen3.8-max-0902"],
      "the chain must stop after the final free quota instead of selecting a paid model");

    console.log("Writing model quota fallback contracts passed.");
  } finally {
    global.fetch = previousFetch;
    ENV_KEYS.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
