"use strict";

const DEFAULT_TIMEOUT_MS = 90000;
const MAX_PROVIDER_TIMEOUT_MS = 300000;
const MAX_VALIDATION_ERRORS = 12;

function text(value, limit = 30000) {
  return String(value == null ? "" : value).trim().slice(0, limit);
}

function normalizeTimeoutMs(explicitTimeoutMs) {
  const requested = explicitTimeoutMs == null
    ? Number(process.env.WRITING_AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
    : Number(explicitTimeoutMs);
  return Number.isFinite(requested)
    ? Math.min(MAX_PROVIDER_TIMEOUT_MS, Math.max(1000, requested))
    : DEFAULT_TIMEOUT_MS;
}

function providerConfig(vision) {
  const prefix = vision ? "WRITING_AI_VISION" : "WRITING_AI_TEXT";
  const fallbackPrefix = "WRITING_AI";
  const protocol = text(process.env[`${prefix}_PROTOCOL`] || process.env[`${fallbackPrefix}_PROTOCOL`], 80)
    || "chat_json_object";
  const apiKey = text(process.env[`${prefix}_API_KEY`] || process.env[`${fallbackPrefix}_API_KEY`], 4000);
  const apiUrl = text(process.env[`${prefix}_API_URL`] || process.env[`${fallbackPrefix}_API_URL`], 1000);
  const providerModel = text(process.env[`${prefix}_MODEL`], 200);
  let model = providerModel || text(process.env[`${fallbackPrefix}_MODEL`], 200);
  const qwenCompatible = /(?:dashscope|\.maas\.)[^/]*aliyuncs\.com/i.test(apiUrl)
    || /dashscope/i.test(apiUrl);
  if (vision && !providerModel && qwenCompatible && model === "qwen3.7-plus") {
    model = "qwen3.7-flash";
  }
  const imageTransport = text(process.env.WRITING_AI_VISION_IMAGE_TRANSPORT, 40) || "url";
  const configuredMaxTokens = Number(process.env[`${prefix}_MAX_OUTPUT_TOKENS`] || process.env.WRITING_AI_MAX_OUTPUT_TOKENS || 8000);
  const maxOutputTokens = Number.isInteger(configuredMaxTokens) && configuredMaxTokens >= 1000
    ? configuredMaxTokens
    : 8000;
  if (!apiKey || !apiUrl || !model) throw new Error("WRITING_AI_NOT_CONFIGURED");
  if (!["chat_json_schema", "chat_json_object", "responses_json_schema"].includes(protocol)) {
    throw new Error("WRITING_AI_PROTOCOL_INVALID");
  }
  if (!['url', 'base64'].includes(imageTransport)) throw new Error("WRITING_AI_IMAGE_TRANSPORT_INVALID");
  return { protocol, apiKey, apiUrl, model, imageTransport, maxOutputTokens, qwenCompatible };
}

function validateAgainstSchema(value, schema, path = "$") {
  const errors = [];
  function add(message) {
    if (errors.length < MAX_VALIDATION_ERRORS) errors.push(message);
  }
  function visit(current, rule, location) {
    if (!rule || errors.length >= MAX_VALIDATION_ERRORS) return;
    if (Array.isArray(rule.type)) {
      const actualType = current === null ? "null"
        : Array.isArray(current) ? "array" : typeof current;
      const normalizedType = actualType === "number" && Number.isInteger(current) ? "integer" : actualType;
      if (!rule.type.includes(normalizedType)
        && !(normalizedType === "integer" && rule.type.includes("number"))) {
        add(`${location} must be one of ${rule.type.join(", ")}`);
      }
      if (Array.isArray(rule.enum) && !rule.enum.includes(current)) {
        add(`${location} must be one of ${rule.enum.join(", ")}`);
      }
      return;
    }
    if (rule.type === "object") {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        add(`${location} must be an object`);
        return;
      }
      const properties = rule.properties || {};
      for (const required of rule.required || []) {
        if (!Object.prototype.hasOwnProperty.call(current, required)) add(`${location}.${required} is required`);
      }
      if (rule.additionalProperties === false) {
        for (const key of Object.keys(current)) {
          if (!Object.prototype.hasOwnProperty.call(properties, key)) add(`${location}.${key} is not allowed`);
        }
      }
      for (const [key, childRule] of Object.entries(properties)) {
        if (Object.prototype.hasOwnProperty.call(current, key)) visit(current[key], childRule, `${location}.${key}`);
      }
      return;
    }
    if (rule.type === "array") {
      if (!Array.isArray(current)) {
        add(`${location} must be an array`);
        return;
      }
      current.forEach((item, index) => visit(item, rule.items, `${location}[${index}]`));
      return;
    }
    if (rule.type === "string" && typeof current !== "string") add(`${location} must be a string`);
    if (rule.type === "boolean" && typeof current !== "boolean") add(`${location} must be a boolean`);
    if (rule.type === "number" && (typeof current !== "number" || !Number.isFinite(current))) add(`${location} must be a number`);
    if (rule.type === "integer" && (!Number.isInteger(current))) add(`${location} must be an integer`);
    if (Array.isArray(rule.enum) && !rule.enum.includes(current)) add(`${location} must be one of ${rule.enum.join(", ")}`);
  }
  visit(value, schema, path);
  return errors;
}

function responseOutputText(payload, protocol) {
  if (protocol === "responses_json_schema") {
    if (typeof payload.output_text === "string") return payload.output_text;
    const fragments = [];
    for (const output of payload.output || []) {
      for (const content of output.content || []) {
        if (typeof content.text === "string") fragments.push(content.text);
      }
    }
    return fragments.join("");
  }
  const choice = payload && payload.choices && payload.choices[0];
  if (choice && choice.finish_reason === "length") throw new Error("WRITING_AI_OUTPUT_TRUNCATED");
  const content = choice && choice.message && choice.message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : part && part.text || "").join("");
  }
  return "";
}

function isOcrSchema(schema) {
  const properties = schema && schema.type === "object" && schema.properties;
  return Boolean(properties && properties.full_text && properties.paragraphs && properties.uncertain_spans);
}

function normalizeOcrPages(value) {
  if (!Array.isArray(value) || !value.length) return value;
  const paragraphs = [];
  const fullTextPages = [];
  const uncertainSpans = [];
  for (const page of value) {
    if (typeof page === "string") {
      const pageText = text(page, 50000);
      if (pageText) {
        fullTextPages.push(pageText);
        paragraphs.push(pageText);
      }
      continue;
    }
    if (!page || typeof page !== "object" || Array.isArray(page)) return value;
    const pageParagraphs = Array.isArray(page.paragraphs)
      ? page.paragraphs.map((item) => text(item, 50000)).filter(Boolean)
      : [];
    const pageText = text(page.full_text || page.text || page.content, 50000)
      || pageParagraphs.join("\n\n");
    if (pageText) fullTextPages.push(pageText);
    if (pageParagraphs.length) paragraphs.push(...pageParagraphs);
    else if (pageText) paragraphs.push(pageText);
    if (Array.isArray(page.uncertain_spans)) {
      for (const span of page.uncertain_spans) {
        if (!span || typeof span !== "object" || Array.isArray(span)) continue;
        uncertainSpans.push({
          text: text(span.text, 1000),
          reason: text(span.reason, 1000) || "Handwriting may be unclear",
        });
      }
    }
  }
  if (!fullTextPages.length && !paragraphs.length) return value;
  return {
    full_text: fullTextPages.join("\n\n"),
    paragraphs,
    uncertain_spans: uncertainSpans,
  };
}

function parseStructuredOutput(output, schema) {
  let parsed;
  let candidate = text(output, 200000);
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof candidate !== "string") break;
    const trimmed = candidate.trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    try {
      parsed = JSON.parse(trimmed);
    } catch (_error) {
      const error = new Error("WRITING_AI_SCHEMA_RESPONSE_INVALID");
      error.validationMessage = "response is not valid JSON";
      throw error;
    }
    candidate = parsed;
    if (typeof parsed !== "string") break;
  }
  if (schema && schema.type === "object" && Array.isArray(parsed)
    && parsed.length === 1 && parsed[0] && typeof parsed[0] === "object" && !Array.isArray(parsed[0])) {
    parsed = parsed[0];
  }
  if (isOcrSchema(schema) && Array.isArray(parsed)) parsed = normalizeOcrPages(parsed);
  return parsed;
}

function safeResultShape(value) {
  if (Array.isArray(value)) {
    return {
      root_type: "array",
      array_length: value.length,
      item_shapes: value.slice(0, 5).map((item) => Array.isArray(item)
        ? { type: "array", length: item.length }
        : item && typeof item === "object"
          ? { type: "object", keys: Object.keys(item).slice(0, 12) }
          : { type: item === null ? "null" : typeof item }),
    };
  }
  if (value && typeof value === "object") return { root_type: "object", keys: Object.keys(value).slice(0, 20) };
  return { root_type: value === null ? "null" : typeof value };
}

function tokenCount(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : null;
}

function normalizeProviderUsage(payload) {
  const usage = payload && payload.usage && typeof payload.usage === "object"
    ? payload.usage : null;
  if (!usage) {
    return {
      usage_status: "missing", input_tokens: null, output_tokens: null,
      total_tokens: null, cached_input_tokens: null, reasoning_output_tokens: null,
    };
  }
  const inputTokens = tokenCount(usage.prompt_tokens != null ? usage.prompt_tokens : usage.input_tokens);
  const outputTokens = tokenCount(usage.completion_tokens != null ? usage.completion_tokens : usage.output_tokens);
  const explicitTotal = tokenCount(usage.total_tokens);
  const inputDetails = usage.prompt_tokens_details || usage.input_tokens_details || {};
  const outputDetails = usage.completion_tokens_details || usage.output_tokens_details || {};
  const cachedInputTokens = tokenCount(inputDetails.cached_tokens != null
    ? inputDetails.cached_tokens : inputDetails.cached_input_tokens);
  const reasoningOutputTokens = tokenCount(outputDetails.reasoning_tokens != null
    ? outputDetails.reasoning_tokens : outputDetails.reasoning_output_tokens);
  const derivedTotal = inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null;
  const totalTokens = explicitTotal != null ? explicitTotal : derivedTotal;
  const recorded = inputTokens != null && outputTokens != null && totalTokens != null;
  return {
    usage_status: recorded ? "recorded" : "missing",
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cached_input_tokens: cachedInputTokens,
    reasoning_output_tokens: reasoningOutputTokens,
  };
}

function providerAttempt(config, payload, responseStatus, outcome, requestId) {
  return {
    model: config.model,
    protocol: config.protocol,
    provider_request_id: text(requestId || payload && payload.id, 200) || null,
    response_status: Number.isInteger(responseStatus) ? responseStatus : null,
    outcome: text(outcome, 80) || "unknown",
    ...normalizeProviderUsage(payload),
  };
}

function attachProviderTelemetry(error, attempts) {
  if (error && typeof error === "object") error.providerTelemetry = { attempts };
  return error;
}

async function imageContent(url, transport) {
  if (transport === "url") return { type: "image_url", image_url: { url } };
  const response = await fetch(url);
  if (!response.ok) throw new Error("PHOTO_URL_FAILED");
  const mimeType = text(response.headers.get("content-type"), 100) || "image/jpeg";
  const bytes = Buffer.from(await response.arrayBuffer());
  return { type: "image_url", image_url: { url: `data:${mimeType};base64,${bytes.toString("base64")}` } };
}

async function requestBody(config, options, correction) {
  const { system, userText, schemaName, schema, images } = options;
  const repair = correction
    ? `\nThe previous JSON response failed validation: ${correction}. Return a corrected JSON object only.`
    : "";
  if (config.protocol === "responses_json_schema") {
    const content = [{ type: "input_text", text: userText + repair }];
    images.forEach((url) => content.push({ type: "input_image", image_url: url, detail: "high" }));
    return {
      model: config.model,
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content },
      ],
      text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
      max_output_tokens: config.maxOutputTokens,
    };
  }
  const userContent = images.length
    ? [...await Promise.all(images.map((url) => imageContent(url, config.imageTransport))), { type: "text", text: userText + repair }]
    : userText + repair;
  const schemaInstruction = config.protocol === "chat_json_object"
    ? `\nReturn JSON only. It must match this JSON Schema exactly: ${JSON.stringify(schema)}`
    : "";
  const body = {
    model: config.model,
    messages: [
      { role: "system", content: system + schemaInstruction },
      { role: "user", content: userContent },
    ],
    max_tokens: config.maxOutputTokens,
    response_format: config.protocol === "chat_json_schema"
      ? { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } }
      : { type: "json_object" },
  };
  // Qwen multimodal structured output is most deterministic in non-thinking mode.
  // Keep this vendor field away from other OpenAI-compatible providers.
  if (config.qwenCompatible) body.enable_thinking = false;
  return body;
}

async function callOnce(config, options, correction) {
  const body = JSON.stringify(await requestBody(config, options, correction));
  if (typeof options.onRequestStart === "function") await options.onRequestStart();
  const controller = new AbortController();
  const timeoutMs = Math.min(MAX_PROVIDER_TIMEOUT_MS, Math.max(1000, normalizeTimeoutMs(options.timeoutMs)));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(config.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    const code = error && error.name === "AbortError" ? "WRITING_AI_TIMEOUT" : "WRITING_AI_UNAVAILABLE";
    throw attachProviderTelemetry(new Error(code), [providerAttempt(config, null, null, "transport_error", null)]);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    // Do not log the provider response body: some vendors may echo request data.
    console.error("writingTutor AI HTTP", response.status);
    throw attachProviderTelemetry(new Error(`WRITING_AI_HTTP_${response.status}`), [
      providerAttempt(config, null, response.status, "http_error", response.headers.get("x-request-id")),
    ]);
  }
  let payload;
  try {
    payload = await response.json();
    const attempt = providerAttempt(
      config, payload, response.status, "response_received", response.headers.get("x-request-id"),
    );
    const output = responseOutputText(payload, config.protocol);
    if (!output) throw attachProviderTelemetry(new Error("WRITING_AI_EMPTY_RESPONSE"), [attempt]);
    const parsed = parseStructuredOutput(output, options.schema);
    const schemaErrors = validateAgainstSchema(parsed, options.schema);
    if (schemaErrors.length) {
      // Shape-only diagnostics keep student writing out of logs while making provider drift debuggable.
      console.error("writingTutor AI schema shape", config.model, safeResultShape(parsed));
      const error = new Error("WRITING_AI_SCHEMA_RESPONSE_INVALID");
      error.validationMessage = schemaErrors.join("; ");
      throw attachProviderTelemetry(error, [attempt]);
    }
    attempt.outcome = "structured_success";
    return { data: parsed, telemetry: { attempts: [attempt] } };
  } catch (error) {
    if (error && error.providerTelemetry) throw error;
    const attempt = providerAttempt(
      config, payload, response.status, "invalid_response", response.headers.get("x-request-id"),
    );
    const safeError = error instanceof SyntaxError
      ? new Error("WRITING_AI_SCHEMA_RESPONSE_INVALID") : error;
    throw attachProviderTelemetry(safeError, [attempt]);
  }
}

async function callStructuredModel(options) {
  const normalized = { ...options, images: Array.isArray(options.images) ? options.images : [] };
  const config = providerConfig(Boolean(options.vision));
  const providerMetadata = (structuralRepairUsed) => {
    let providerHost = "configured-provider";
    try { providerHost = new URL(config.apiUrl).hostname; } catch (_error) {}
    return {
      protocol: config.protocol,
      model: config.model,
      provider_host: providerHost,
      structural_repair_used: structuralRepairUsed,
    };
  };
  const attempts = [];
  try {
    const first = await callOnce(config, normalized, "");
    attempts.push(...first.telemetry.attempts);
    return { data: first.data, metadata: providerMetadata(false), telemetry: { attempts } };
  } catch (error) {
    attempts.push(...(error && error.providerTelemetry && error.providerTelemetry.attempts || []));
    if (config.protocol !== "chat_json_object" || error.message !== "WRITING_AI_SCHEMA_RESPONSE_INVALID") {
      throw attachProviderTelemetry(error, attempts);
    }
    try {
      const repaired = await callOnce(config, normalized, text(error.validationMessage, 1200));
      attempts.push(...repaired.telemetry.attempts);
      return {
        data: repaired.data,
        metadata: providerMetadata(true),
        telemetry: { attempts },
      };
    } catch (repairError) {
      attempts.push(...(repairError && repairError.providerTelemetry && repairError.providerTelemetry.attempts || []));
      throw attachProviderTelemetry(repairError, attempts);
    }
  }
}

module.exports = {
  callStructuredModel,
  _test: {
    validateAgainstSchema, responseOutputText, parseStructuredOutput, providerConfig,
    normalizeOcrPages, normalizeTimeoutMs, normalizeProviderUsage,
  },
};
