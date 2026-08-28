"use strict";

class SpeakingModelError extends Error {
  constructor(code = "SPEAKING_PROVIDER_NOT_CONFIGURED", options = {}) {
    super(code);
    this.code = code;
    this.name = "SpeakingModelError";
    this.httpStatus = options.httpStatus || null;
    this.providerCode = options.providerCode || null;
    this.requestId = options.requestId || null;
    this.responseDiagnostics = options.responseDiagnostics || null;
  }
}

function text(value, limit = 2000) {
  return String(value == null ? "" : value).trim().slice(0, limit);
}

function providerConfigStatus(env = process.env) {
  const required = ["SPEAKING_AI_TEXT_API_KEY", "SPEAKING_AI_TEXT_API_URL", "SPEAKING_AI_TEXT_MODEL", "SPEAKING_AI_TEXT_PROTOCOL"];
  const missing = required.filter((name) => !text(env && env[name], 4000));
  return { configured: missing.length === 0, missing };
}

function configuration(env = process.env) {
  const status = providerConfigStatus(env);
  if (!status.configured) throw new SpeakingModelError();
  let url;
  try { url = new URL(text(env.SPEAKING_AI_TEXT_API_URL, 2000)); } catch (_error) { throw new SpeakingModelError(); }
  if (url.protocol !== "https:" && !/\.example\.test$/i.test(url.hostname)) throw new SpeakingModelError();
  const protocol = text(env.SPEAKING_AI_TEXT_PROTOCOL, 80);
  if (protocol !== "chat_json_object") throw new SpeakingModelError();
  const qwenCompatible = /(?:dashscope|\.maas\.)[^/]*aliyuncs\.com/i.test(url.toString())
    || /dashscope/i.test(url.toString());
  const maxOutputTokens = Math.min(16000, Math.max(1000, Number(env.SPEAKING_AI_TEXT_MAX_OUTPUT_TOKENS) || 8000));
  const timeoutMs = Math.min(300000, Math.max(5000, Number(env.SPEAKING_AI_TIMEOUT_MS) || 180000));
  return {
    apiKey: text(env.SPEAKING_AI_TEXT_API_KEY, 4000),
    url: url.toString(),
    hostname: url.hostname,
    model: text(env.SPEAKING_AI_TEXT_MODEL, 200),
    protocol,
    qwenCompatible,
    maxOutputTokens,
    timeoutMs,
  };
}

function createModelProvider(options = {}) {
  const config = configuration(options.env || process.env);
  return {
    name: "openai_compatible",
    model: config.model,
    protocol: config.protocol,
    hostname: config.hostname,
    callStructuredModel: (input) => callStructuredModel(input, { ...options, config }),
  };
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => typeof item === "string" ? item : text(item && item.text, 200000)).join("");
  return "";
}

function parseJsonContent(value) {
  let source = text(value, 400000).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!source) throw new SpeakingModelError("SPEAKING_AI_SCHEMA_INVALID");
  let parsed;
  try { parsed = JSON.parse(source); } catch (_error) { throw new SpeakingModelError("SPEAKING_AI_SCHEMA_INVALID"); }
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch (_error) { throw new SpeakingModelError("SPEAKING_AI_SCHEMA_INVALID"); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SpeakingModelError("SPEAKING_AI_SCHEMA_INVALID");
  return parsed;
}

function normalizedUsage(value) {
  const usage = value && typeof value === "object" ? value : {};
  const integer = (item) => item != null && item !== "" && Number.isInteger(Number(item)) ? Math.max(0, Number(item)) : null;
  return {
    input_tokens: integer(usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens),
    output_tokens: integer(usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens),
    total_tokens: integer(usage.total_tokens),
    cached_tokens: integer(usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens),
    reasoning_tokens: integer(usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens),
  };
}

async function callStructuredModel(input = {}, options = {}) {
  const config = options.config || configuration(options.env || process.env);
  const payload = {
    model: config.model,
    messages: [
      { role: "system", content: text(input.system_prompt, 100000) },
      { role: "user", content: text(input.user_prompt, 300000) },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: config.maxOutputTokens,
    temperature: 0.1,
  };
  // Qwen structured output is most deterministic in non-thinking mode. A
  // thinking response may leave the DSE JSON outside message.content.
  if (config.qwenCompatible) {
    payload.enable_thinking = false;
    payload.max_tokens = config.maxOutputTokens;
    delete payload.max_completion_tokens;
  }
  let response;
  let raw;
  try {
    response = await (options.fetch || fetch)(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(config.timeoutMs) : undefined,
    });
    raw = await response.text();
  } catch (_error) {
    throw new SpeakingModelError("SPEAKING_AI_TIMEOUT");
  }
  let body;
  try { body = JSON.parse(String(raw || "").replace(/^\uFEFF/, "")); } catch (_error) { throw new SpeakingModelError("SPEAKING_AI_INVALID_RESPONSE", { httpStatus: response.status }); }
  const requestId = text(response.headers && response.headers.get && (response.headers.get("x-request-id") || response.headers.get("request-id")), 200) || text(body && body.id, 200);
  if (!response.ok || body && body.error) {
    const providerCode = text(body && body.error && (body.error.code || body.error.type), 200);
    const code = response.status === 401 || response.status === 403 ? "SPEAKING_PROVIDER_NOT_CONFIGURED" : (response.status === 408 || response.status === 429 || response.status >= 500 ? "SPEAKING_AI_TIMEOUT" : "SPEAKING_AI_FAILED");
    throw new SpeakingModelError(code, { httpStatus: response.status, providerCode, requestId });
  }
  const choice = body && Array.isArray(body.choices) && body.choices[0];
  const rawContent = contentText(choice && choice.message && choice.message.content);
  const trimmedContent = String(rawContent || "").trim();
  const responseDiagnostics = {
    finish_reason: text(choice && choice.finish_reason, 80) || null,
    content_length: trimmedContent.length,
    content_shape: !trimmedContent ? "empty"
      : /^```(?:json)?\s*\{/i.test(trimmedContent) ? "fenced_json"
        : trimmedContent.startsWith("{") ? "json_object" : "other",
    content_closed: /}\s*(?:```)?$/.test(trimmedContent),
    has_reasoning_content: Boolean(text(choice && choice.message && choice.message.reasoning_content, 10)),
  };
  let output;
  try { output = parseJsonContent(rawContent); } catch (_error) {
    throw new SpeakingModelError("SPEAKING_AI_SCHEMA_INVALID", { httpStatus: response.status, requestId, responseDiagnostics });
  }
  return {
    output,
    usage: normalizedUsage(body && body.usage),
    request_id: requestId,
  };
}

module.exports = {
  SpeakingModelError,
  createModelProvider,
  providerConfigStatus,
  callStructuredModel,
  _test: { configuration, contentText, parseJsonContent, normalizedUsage },
};
