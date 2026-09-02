"use strict";

const SCHEMA_VERSION = "vocabulary-scan-ocr-2026-09-02.1";
const MARK_TYPES = ["underline", "circle", "box", "highlighter", "arrow", "star"];
const CONFIDENCES = ["high", "medium", "low"];
const OCR_SCHEMA = {
  type: "object", additionalProperties: false, required: ["blocks"],
  properties: { blocks: { type: "array", maxItems: 80, items: {
    type: "object", additionalProperties: false, required: ["block_type", "sentences"],
    properties: { block_type: { type: "string", enum: ["paragraph", "heading", "question", "option", "table", "other"] }, sentences: { type: "array", maxItems: 80, items: {
      type: "object", additionalProperties: false, required: ["text", "uncertain_tokens", "marked_tokens"], properties: {
        text: { type: "string", minLength: 1, maxLength: 1200 },
        uncertain_tokens: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false, required: ["token_index", "token_text", "reason"], properties: { token_index: { type: "integer" }, token_text: { type: "string" }, reason: { type: "string", maxLength: 160 } } } },
        marked_tokens: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false, required: ["token_index", "token_text", "mark_type", "confidence"], properties: { token_index: { type: "integer" }, token_text: { type: "string" }, mark_type: { type: "string", enum: MARK_TYPES }, confidence: { type: "string", enum: CONFIDENCES } } } },
      }
    } } }
  } } }
};

function validateOutput(value, schema = OCR_SCHEMA, path = "$", errors = []) {
  if (errors.length > 20 || !schema) return errors;
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push(`${path} must be an object`); return errors; }
    for (const required of schema.required || []) if (!Object.prototype.hasOwnProperty.call(value, required)) errors.push(`${path}.${required} is required`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!schema.properties[key]) errors.push(`${path}.${key} is not allowed`);
    for (const [key, rule] of Object.entries(schema.properties || {})) if (Object.prototype.hasOwnProperty.call(value, key)) validateOutput(value[key], rule, `${path}.${key}`, errors);
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return errors; }
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path} has too many items`);
    value.forEach((item, index) => validateOutput(item, schema.items, `${path}[${index}]`, errors));
  } else if (schema.type === "string") {
    if (typeof value !== "string") errors.push(`${path} must be a string`);
    else if (schema.minLength && value.length < schema.minLength) errors.push(`${path} is empty`);
    else if (schema.maxLength && value.length > schema.maxLength) errors.push(`${path} is too long`);
  } else if (schema.type === "integer" && (!Number.isInteger(value))) errors.push(`${path} must be an integer`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} has an invalid value`);
  return errors;
}

module.exports = { SCHEMA_VERSION, OCR_SCHEMA, MARK_TYPES, CONFIDENCES, validateOutput };
