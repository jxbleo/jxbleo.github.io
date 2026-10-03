"use strict";

const assert = require("node:assert/strict");

const writing = require("../cloudfunctions/writingTutor/model-provider");
const speaking = require("../cloudfunctions/speakingLab/model-provider");
// The worker's real SDK init performs a short CloudBase metadata probe unless
// it sees a function runtime marker. Set a synthetic marker for this offline
// test, then restore the caller's environment immediately after require.
const previousRunEnv = process.env.TENCENTCLOUD_RUNENV;
process.env.TENCENTCLOUD_RUNENV = "SCF";
const worker = require("../cloudfunctions/speakingAiWorker")._test;
if (previousRunEnv == null) delete process.env.TENCENTCLOUD_RUNENV;
else process.env.TENCENTCLOUD_RUNENV = previousRunEnv;

const schema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

function headers(values = {}) {
  return { get(name) { return values[String(name).toLowerCase()] || null; } };
}

function writingEnv(extra = {}) {
  return {
    WRITING_AI_TEXT_API_KEY: "test-key",
    WRITING_AI_TEXT_API_URL: "https://writing.example.test/v1/chat",
    WRITING_AI_TEXT_MODEL: "primary-model",
    WRITING_AI_TEXT_PROTOCOL: "chat_json_object",
    WRITING_AI_TEXT_QUOTA_FALLBACK_MODELS: "fallback-model",
    WRITING_AI_TIMEOUT_MS: "5000",
    ...extra,
  };
}

async function testWritingDeadlineAndPreparation() {
  let modelRequests = 0;
  await assert.rejects(
    writing.callStructuredModel({
      system: "test", userText: "test", schemaName: "test", schema, images: [],
      timeoutMs: 1000,
      fetch: async () => {
        modelRequests += 1;
        return { ok: true, status: 200, headers: headers(), json: () => new Promise(() => {}) };
      },
    }),
    (error) => error && error.message === "WRITING_AI_TIMEOUT",
  );
  assert.equal(modelRequests, 1, "a hanging response body is one physical call and cannot repair/fallback");

  const priorVision = Object.fromEntries(["WRITING_AI_VISION_API_KEY", "WRITING_AI_VISION_API_URL", "WRITING_AI_VISION_MODEL", "WRITING_AI_VISION_PROTOCOL", "WRITING_AI_VISION_IMAGE_TRANSPORT"].map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    WRITING_AI_VISION_API_KEY: "test-key",
    WRITING_AI_VISION_API_URL: "https://vision.example.test/v1/chat",
    WRITING_AI_VISION_MODEL: "vision-model",
    WRITING_AI_VISION_PROTOCOL: "chat_json_object",
    WRITING_AI_VISION_IMAGE_TRANSPORT: "base64",
  });
  let imageFetches = 0;
  let providerFetches = 0;
  try {
    await assert.rejects(
      writing.callStructuredModel({
        system: "test", userText: "test", schemaName: "test", schema, images: ["https://image.example.test/a.jpg"],
        vision: true, timeoutMs: 1000,
        fetch: async (url) => {
          if (String(url).includes("image.example.test")) { imageFetches += 1; return new Promise(() => {}); }
          providerFetches += 1;
          return { ok: true, status: 200, headers: headers(), json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
        },
      }),
      (error) => error && error.message === "WRITING_AI_TIMEOUT",
    );
  } finally {
    for (const [key, value] of Object.entries(priorVision)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(imageFetches, 1);
  assert.equal(providerFetches, 0, "image preparation timeout cannot become a model attempt");
}

async function testWritingProviderClassificationAndTiming() {
  let requests = 0;
  await assert.rejects(
    writing.callStructuredModel({
      system: "test", userText: "test", schemaName: "test", schema, images: [], timeoutMs: 3000,
      fetch: async () => {
        requests += 1;
        return { ok: false, status: 403, headers: headers(), json: async () => ({ error: { code: "ACCESS_DENIED" } }) };
      },
    }),
    (error) => error && error.message === "WRITING_AI_HTTP_403",
  );
  assert.equal(requests, 1, "unknown 403 does not use quota fallback");

  const response = await writing.callStructuredModel({
    system: "test", userText: "test", schemaName: "test", schema, images: [], timeoutMs: 3000,
    fetch: async () => ({ ok: true, status: 200, headers: headers({ "x-request-id": "writing-test" }), json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) }),
  });
  const attempt = response.telemetry.attempts[0];
  assert.equal(attempt.outcome, "structured_success");
  assert.match(attempt.request_started_at, /^20/);
  assert.match(attempt.response_completed_at, /^20/);
  assert.equal(typeof attempt.duration_ms, "number");
  assert.equal(attempt.input_tokens, null, "missing provider usage remains unknown");
}

async function testSpeakingDeadlineAndTiming() {
  await assert.rejects(
    speaking.callStructuredModel({ system_prompt: "test", user_prompt: "test" }, {
      env: {
        SPEAKING_AI_TEXT_API_KEY: "test-key", SPEAKING_AI_TEXT_API_URL: "https://speaking.example.test/v1/chat",
        SPEAKING_AI_TEXT_MODEL: "speaking-model", SPEAKING_AI_TEXT_PROTOCOL: "chat_json_object",
      },
      deadlineAt: Date.now() + 1000,
      fetch: async () => ({ ok: true, status: 200, headers: headers(), text: () => new Promise(() => {}) }),
    }),
    (error) => error && error.code === "SPEAKING_AI_TIMEOUT",
  );

  const result = await speaking.callStructuredModel({ system_prompt: "test", user_prompt: "test" }, {
    env: {
      SPEAKING_AI_TEXT_API_KEY: "test-key", SPEAKING_AI_TEXT_API_URL: "https://speaking.example.test/v1/chat",
      SPEAKING_AI_TEXT_MODEL: "speaking-model", SPEAKING_AI_TEXT_PROTOCOL: "chat_json_object",
    },
    deadlineAt: Date.now() + 3000,
    fetch: async () => ({ ok: true, status: 200, headers: headers({ "x-request-id": "speaking-test" }), text: async () => JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }) }),
  });
  assert.equal(typeof result.duration_ms, "number");
  assert.match(result.request_started_at, /^20/);
  assert.match(result.response_completed_at, /^20/);
}

async function testWorkerBoundedDispatch() {
  let active = 0;
  let peak = 0;
  const count = await worker.runBounded(Array.from({ length: 9 }, (_, index) => index), worker.DISPATCH_CONCURRENCY, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return true;
  }, { deadlineAt: Date.now() + 10000 });
  assert.equal(count, 9);
  assert(peak <= 3, `worker concurrency exceeded 3: ${peak}`);
}

async function main() {
  const previous = { ...process.env };
  Object.assign(process.env, writingEnv());
  try {
    await testWritingDeadlineAndPreparation();
    await testWritingProviderClassificationAndTiming();
    await testSpeakingDeadlineAndTiming();
    await testWorkerBoundedDispatch();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
  console.log("AI feedback latency behavior passed.");
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
