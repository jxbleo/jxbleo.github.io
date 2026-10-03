#!/usr/bin/env node
// Offline regression checks: synthetic fixtures, real implementation, no provider/cloud calls.
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const provider = require(path.resolve(__dirname, "../cloudfunctions/writingTutor/model-provider"));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const schema = { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string" } } };
const payload = (data) => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(data) } }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } });
const response = (status, reader) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: reader });
const base = { system: "local synthetic fixture", userText: "synthetic", schemaName: "independent_fixture", schema, timeoutMs: 1e3 };
function configure() {
  for (const key of Object.keys(process.env)) if (key.startsWith("WRITING_AI")) delete process.env[key];
  Object.assign(process.env, { WRITING_AI_TEXT_API_KEY: "local-test-only", WRITING_AI_TEXT_API_URL: "https://dashscope.example.test/v1/chat/completions", WRITING_AI_TEXT_MODEL: "fixture-primary", WRITING_AI_TEXT_PROTOCOL: "chat_json_object", WRITING_AI_TEXT_QUOTA_FALLBACK_MODELS: "fixture-backup", WRITING_AI_VISION_API_KEY: "local-test-only", WRITING_AI_VISION_API_URL: "https://dashscope.example.test/v1/chat/completions", WRITING_AI_VISION_MODEL: "fixture-vision", WRITING_AI_VISION_PROTOCOL: "chat_json_object" });
}
const cases = [];
async function check(name, fn) {
  configure();
  const started = Date.now();
  try {
    await fn();
    cases.push({ name, passed: true, duration_ms: Date.now() - started });
  } catch (error) {
    cases.push({ name, passed: false, message: error.message, duration_ms: Date.now() - started });
  }
}
async function timeout(options = base) {
  const start = Date.now();
  await assert.rejects(provider.callStructuredModel(options), (error) => error.message === "WRITING_AI_TIMEOUT");
  assert(Date.now() - start < 1250, "Deadline must return before the delayed body/hook completes");
}
(async () => {
  await check("ignored AbortSignal and late invalid JSON cannot trigger repair", async () => {
    let calls = 0, signal;
    global.fetch = async (_url, request) => {
      calls++;
      signal = request.signal;
      return response(200, async () => {
        await wait(1450);
        return payload({ wrong: "shape" });
      });
    };
    await timeout();
    assert.equal(signal.aborted, true);
    await wait(520);
    assert.equal(calls, 1);
  });
  await check("slow 403 body cannot bypass deadline or start fallback", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return response(403, async () => {
        await wait(1450);
        return { code: "AllocationQuota.FreeTierOnly" };
      });
    };
    await timeout();
    await wait(520);
    assert.equal(calls, 1);
  });
  await check("shared repair deadline does not reset per call", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return response(200, async () => {
        await wait(650);
        return payload(calls === 1 ? { wrong: "shape" } : { answer: "ok" });
      });
    };
    await timeout();
    assert.equal(calls, 2);
  });
  await check("shared fallback deadline does not reset per model", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      const index = calls;
      return response(index === 1 ? 403 : 200, async () => {
        await wait(650);
        return index === 1 ? { code: "AllocationQuota.FreeTierOnly" } : payload({ answer: "ok" });
      });
    };
    await timeout();
    assert.equal(calls, 2);
  });
  await check("late request-start hook cannot dispatch after deadline", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return response(200, async () => payload({ answer: "ok" }));
    };
    await timeout({ ...base, onRequestStart: async () => wait(1450) });
    await wait(520);
    assert.equal(calls, 0);
  });
  await check("base64 image preparation uses same deadline", async () => {
    process.env.WRITING_AI_VISION_IMAGE_TRANSPORT = "base64";
    let modelCalls = 0;
    global.fetch = async (url) => {
      if (String(url).includes("/image-fixture")) return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => {
        await wait(1450);
        return new ArrayBuffer(1);
      } };
      modelCalls++;
      return response(200, async () => payload({ answer: "ok" }));
    };
    await timeout({ ...base, vision: true, images: ["https://private.example.test/image-fixture"] });
    await wait(520);
    assert.equal(modelCalls, 0);
  });
  await check("unknown 403 never invokes fallback", async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return response(403, async () => ({ error: { code: "unknown", message: "private echo must not enter telemetry" } }));
    };
    await assert.rejects(provider.callStructuredModel(base));
    assert.equal(calls, 1);
  });
  await check("no model HTTP attempt is counted when image preparation times out", async () => {
    process.env.WRITING_AI_VISION_IMAGE_TRANSPORT = "base64";
    global.fetch = async () => ({ ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => {
      await wait(1450);
      return new ArrayBuffer(1);
    } });
    await assert.rejects(provider.callStructuredModel({ ...base, vision: true, images: ["https://private.example.test/image-fixture"] }), (error) => error.message === "WRITING_AI_TIMEOUT" && (!error.providerTelemetry || error.providerTelemetry.attempts.length === 0));
  });
  await check("transport error clears all request timers", async () => {
    const previousSet = global.setTimeout, previousClear = global.clearTimeout;
    const pending = /* @__PURE__ */ new Set();
    global.setTimeout = (fn, ms, ...args) => {
      let id;
      id = previousSet(() => {
        pending.delete(id);
        fn(...args);
      }, ms);
      pending.add(id);
      return id;
    };
    global.clearTimeout = (id) => {
      pending.delete(id);
      return previousClear(id);
    };
    try {
      global.fetch = async () => {
        throw new Error("synthetic transport failure");
      };
      await assert.rejects(provider.callStructuredModel(base));
      assert.equal(pending.size, 0);
    } finally {
      for (const id of pending) previousClear(id);
      global.setTimeout = previousSet;
      global.clearTimeout = previousClear;
    }
  });
  await check("non-JSON HTTP failure preserves status", async () => {
    global.fetch = async () => response(503, async () => {
      throw new SyntaxError("synthetic non-JSON error body");
    });
    await assert.rejects(provider.callStructuredModel(base), (error) => error.message === "WRITING_AI_HTTP_503" && error.providerTelemetry.attempts[0].response_status === 503);
  });
  await check("AbortError from real response reader remains timeout", async () => {
    global.fetch = async (_url, request) => response(200, () => new Promise((resolve, reject) => request.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true })));
    await timeout();
  });
  await check("already expired deadline starts neither image nor model fetch", async () => {
    process.env.WRITING_AI_VISION_IMAGE_TRANSPORT = "base64";
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return { ok: true, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => new ArrayBuffer(1) };
    };
    await assert.rejects(provider.callStructuredModel({ ...base, vision: true, deadlineAt: Date.now() - 1, images: ["https://private.example.test/image-fixture"] }), (error) => error.message === "WRITING_AI_TIMEOUT");
    assert.equal(calls, 0);
  });
  await check("synchronous late response cannot escape expired deadline", async () => {
    global.fetch = async () => response(200, async () => {
      const until = Date.now() + 45;
      while (Date.now() < until) {
      }
      return payload({ answer: "late" });
    });
    await assert.rejects(provider.callStructuredModel({ ...base, deadlineAt: Date.now() + 15 }), (error) => error.message === "WRITING_AI_TIMEOUT");
  });
  await check("successful physical call has real timing and known usage", async () => {
    global.fetch = async () => response(200, async () => {
      await wait(20);
      return payload({ answer: "ok" });
    });
    const result = await provider.callStructuredModel(base);
    assert.deepEqual(result.data, { answer: "ok" });
    const row = result.telemetry.attempts[0];
    assert.equal(row.input_tokens, 5);
    assert.equal(row.output_tokens, 2);
    assert(Number.isFinite(row.duration_ms) && row.duration_ms >= 15);
    assert(Number.isFinite(Date.parse(row.request_started_at)));
    assert(Number.isFinite(Date.parse(row.response_completed_at)));
  });
  console.log(JSON.stringify(cases, null, 2));
  if (cases.some((row) => !row.passed)) process.exitCode = 1;
})();
