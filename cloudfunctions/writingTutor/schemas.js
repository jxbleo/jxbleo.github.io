"use strict";

const SCHEMA_VERSION = "writing-ai-schemas-2026-08-20.1";

const stringArray = { type: "array", items: { type: "string" } };

const OCR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["full_text", "paragraphs", "uncertain_spans"],
  properties: {
    full_text: { type: "string" },
    paragraphs: stringArray,
    uncertain_spans: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "reason"],
        properties: { text: { type: "string" }, reason: { type: "string" } },
      },
    },
  },
};

const STANDARDIZED_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overall_score", "score_scale", "summary", "criteria", "strengths", "priorities"],
  properties: {
    overall_score: { type: "string" },
    score_scale: { type: "string" },
    summary: { type: "string" },
    criteria: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion_id", "name", "score", "max_score", "rationale"],
        properties: {
          criterion_id: { type: "string" }, name: { type: "string" },
          score: { type: "string" }, max_score: { type: "string" }, rationale: { type: "string" },
        },
      },
    },
    strengths: stringArray,
    priorities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "evidence", "action"],
        properties: { title: { type: "string" }, evidence: { type: "string" }, action: { type: "string" } },
      },
    },
  },
};

const LANGUAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "sentences", "profile_observations"],
  properties: {
    overview: { type: "string" },
    sentences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sentence_id", "original", "status", "rewrite_required", "issues", "coaching_summary", "reference_revision"],
        properties: {
          sentence_id: { type: "string" }, original: { type: "string" },
          status: { type: "string", enum: ["effective", "improvable", "needs_revision"] },
          rewrite_required: { type: "boolean" },
          issues: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["category", "span", "explanation", "suggestion"],
              properties: {
                category: { type: "string" }, span: { type: "string" },
                explanation: { type: "string" }, suggestion: { type: "string" },
              },
            },
          },
          coaching_summary: { type: "string" }, reference_revision: { type: "string" },
        },
      },
    },
    profile_observations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "observation", "evidence_sentence_ids"],
        properties: { category: { type: "string" }, observation: { type: "string" }, evidence_sentence_ids: stringArray },
      },
    },
  },
};

const REWRITE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results", "overall_feedback"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sentence_id", "accepted", "meaning_preserved", "target_resolved", "new_errors", "feedback", "next_step"],
        properties: {
          sentence_id: { type: "string" }, accepted: { type: "boolean" },
          meaning_preserved: { type: "boolean" }, target_resolved: { type: "boolean" },
          new_errors: stringArray, feedback: { type: "string" },
          next_step: { type: "string", enum: ["complete", "revise_again"] },
        },
      },
    },
    overall_feedback: { type: "string" },
  },
};

module.exports = { SCHEMA_VERSION, OCR_SCHEMA, STANDARDIZED_SCHEMA, LANGUAGE_SCHEMA, REWRITE_SCHEMA };
