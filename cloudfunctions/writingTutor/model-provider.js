"use strict";

const DEFAULT_TIMEOUT_MS = 90000;
const MAX_VALIDATION_ERRORS = 12;

function text(value, limit = 30000) {
  return String(value == null ? "" : value).trim().slice(0, limit);
}

function providerConfig(vision) {
  const prefix = vision ? "WRITING_AI_VISION" : "WRITING_AI_TEXT";
  const fallbackPrefix = "WRITING_AI";
  const protocol = text(process.env[`${prefix}_PROTOCOL`] || process.env[`${fallbackPrefix}_PROTOCOL`], 80)
    || "chat_json_object";
  const apiKey = text(process.env[`${prefix}_API_KEY`] || process.env[`${fallbackPrefix}_API_KEY`], 4000);
  const apiUrl = text(process.env[`${prefix}_API_URL`] || process.env[`${fallbackPrefix}_API_URL`], 1000);
  const model = text(process.env[`${prefix}_MODEL`] || process.env[`${fallbackPrefix}_MODEL`], 200);
  const qwenCompatible = /(?:dashscope|\.maas\.)[^/]*aliyuncs\.com/i.test(apiUrl)
    || /dashscope/i.test(apiUrl);
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
  const controller = new AbortController();
  const timeoutMs = Number(process.env.WRITING_AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(config.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(await requestBody(config, options, correction)),
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("WRITING_AI_TIMEOUT");
    throw new Error("WRITING_AI_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    // Do not log the provider response body: some vendors may echo request data.
    console.error("writingTutor AI HTTP", response.status);
    throw new Error(`WRITING_AI_HTTP_${response.status}`);
  }
  const payload = await response.json();
  const output = responseOutputText(payload, config.protocol);
  if (!output) throw new Error("WRITING_AI_EMPTY_RESPONSE");
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (_error) {
    const error = new Error("WRITING_AI_SCHEMA_RESPONSE_INVALID");
    error.validationMessage = "response is not valid JSON";
    throw error;
  }
  const schemaErrors = validateAgainstSchema(parsed, options.schema);
  if (schemaErrors.length) {
    const error = new Error("WRITING_AI_SCHEMA_RESPONSE_INVALID");
    error.validationMessage = schemaErrors.join("; ");
    throw error;
  }
  return parsed;
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
  try {
    return { data: await callOnce(config, normalized, ""), metadata: providerMetadata(false) };
  } catch (error) {
    if (config.protocol !== "chat_json_object" || error.message !== "WRITING_AI_SCHEMA_RESPONSE_INVALID") throw error;
    return {
      data: await callOnce(config, normalized, text(error.validationMessage, 1200)),
      metadata: providerMetadata(true),
    };
  }
}

module.exports = {
  callStructuredModel,
  _test: { validateAgainstSchema, responseOutputText, providerConfig },
};
