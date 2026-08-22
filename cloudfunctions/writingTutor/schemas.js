"use strict";

const SCHEMA_VERSION = "writing-ai-schemas-2026-08-22.2";

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

const REVISION_SCAN_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["written_number", "recognized_text", "confidence", "warnings"],
  properties: {
    written_number: {
      type: ["integer", "null"],
      description: "The global sentence number written at the start of this rewrite, or null when no reliable number is visible.",
    },
    recognized_text: {
      type: "string",
      description: "The student's handwritten rewrite, transcribed exactly without correction.",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    warnings: stringArray,
  },
};

const REVISION_SCAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "unmapped_items"],
  properties: {
    items: {
      type: "array",
      items: REVISION_SCAN_ITEM_SCHEMA,
      description: "Visible rewrite candidates in page and reading order, including candidates with an uncertain number.",
    },
    unmapped_items: {
      type: "array",
      items: REVISION_SCAN_ITEM_SCHEMA,
      description: "Visible handwriting that cannot be safely associated with a numbered rewrite; never infer a sentence number.",
    },
  },
};

const STANDARDIZED_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggested_title", "overall_score", "score_scale", "summary", "criteria", "strengths", "priorities"],
  properties: {
    suggested_title: { type: "string", minLength: 1, maxLength: 80, description: "A natural 2–6 word English title summarising the manuscript's central topic, without quotation marks or ending punctuation." },
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
  required: ["suggested_title", "cefr_estimate", "overview", "sentences", "profile_observations"],
  properties: {
    suggested_title: { type: "string", minLength: 1, maxLength: 80, description: "A natural 2–6 word English title summarising the manuscript's central topic, without quotation marks or ending punctuation." },
    cefr_estimate: {
      type: "object",
      additionalProperties: false,
      required: ["level", "position", "commentary_zh"],
      properties: {
        level: { type: "string", enum: ["A1", "A2", "B1", "B2", "C1", "C2"], description: "Approximate CEFR writing-performance band demonstrated by this manuscript." },
        position: { type: "string", enum: ["lower", "middle", "upper"], description: "The manuscript's approximate position within the selected CEFR band." },
        commentary_zh: { type: "string", description: "Concise student-friendly Simplified Chinese explanation of the CEFR writing estimate and the most useful next improvement." },
      },
    },
    overview: { type: "string", description: "Concise overall evaluation written in student-friendly Simplified Chinese." },
    sentences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sentence_id", "original", "status", "rewrite_required", "issues", "coaching_summary", "reference_revision"],
        properties: {
          sentence_id: { type: "string" },
          original: { type: "string", description: "The exact English source sentence supplied for this sentence_id; do not translate or paraphrase it." },
          status: { type: "string", enum: ["effective", "improvable", "needs_revision"] },
          rewrite_required: { type: "boolean" },
          issues: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["category", "span", "explanation", "suggestion"],
              properties: {
                category: { type: "string", description: "Short issue category written in Simplified Chinese." },
                span: { type: "string", description: "The exact relevant English span from original; do not translate it." },
                explanation: { type: "string", description: "Concise explanation written in student-friendly Simplified Chinese." },
                suggestion: { type: "string", description: "Actionable suggestion written in student-friendly Simplified Chinese." },
              },
            },
          },
          coaching_summary: { type: "string", description: "The sentence-level coaching summary written in student-friendly Simplified Chinese." },
          reference_revision: { type: "string", description: "One natural English reference revision; keep this field in English." },
        },
      },
    },
    profile_observations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "observation", "evidence_sentence_ids"],
        properties: {
          category: { type: "string", description: "Short observation category written in Simplified Chinese." },
          observation: { type: "string", description: "Concise profile observation written in student-friendly Simplified Chinese." },
          evidence_sentence_ids: stringArray,
        },
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
          new_errors: {
            type: "array",
            description: "Material new errors, each described concisely in Simplified Chinese.",
            items: { type: "string" },
          },
          feedback: { type: "string", description: "Student-friendly feedback written in Simplified Chinese." },
          next_step: { type: "string", enum: ["complete", "revise_again"] },
        },
      },
    },
    overall_feedback: { type: "string", description: "Concise batch feedback written in student-friendly Simplified Chinese." },
  },
};

module.exports = {
  SCHEMA_VERSION, OCR_SCHEMA, REVISION_SCAN_SCHEMA, REVISION_SCAN_ITEM_SCHEMA,
  STANDARDIZED_SCHEMA, LANGUAGE_SCHEMA, REWRITE_SCHEMA,
};
