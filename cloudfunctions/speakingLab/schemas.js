"use strict";

const SPEAKING_REPORT_SCHEMA_VERSION = "dse-speaking-report-v4";
const INDIVIDUAL_RESPONSE_REPORT_SCHEMA_VERSION = "dse-individual-response-v2";

const DOMAIN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "commentary_zh", "evidence_segment_ids"],
  properties: {
    score: { type: "integer", minimum: 0, maximum: 7 },
    commentary_zh: { type: "string", maxLength: 1200 },
    evidence_segment_ids: { type: "array", items: { type: "string" }, maxItems: 12 },
  },
};

const GROUP_DOMAIN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "commentary_zh", "evidence_segment_ids", "strengths", "priority_actions", "language_suggestions"],
  properties: {
    ...DOMAIN_SCHEMA.properties,
    strengths: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 6 },
    priority_actions: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 6 },
    language_suggestions: { type: "array", items: { type: "string", maxLength: 480 }, maxItems: 6 },
  },
};

const TURN_COACHING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["strength_zh", "limitation_zh", "improvement_zh", "sample_en"],
  properties: {
    strength_zh: { type: "string", minLength: 1, maxLength: 900 },
    limitation_zh: { type: "string", minLength: 1, maxLength: 900 },
    improvement_zh: { type: "string", minLength: 1, maxLength: 900 },
    sample_en: { type: "string", minLength: 1, maxLength: 1200 },
  },
};

const TURN_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["turn_id", "communication_strategies", "ideas_organisation"],
  properties: {
    turn_id: { type: "string" },
    communication_strategies: TURN_COACHING_SCHEMA,
    ideas_organisation: TURN_COACHING_SCHEMA,
  },
};

const SPEAKING_REPORT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["group_summary_zh", "group_strengths", "group_priorities", "discussion_flow", "candidates"],
  properties: {
    group_summary_zh: { type: "string", maxLength: 1200 },
    group_strengths: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 12 },
    group_priorities: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 12 },
    discussion_flow: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 12 },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["speaker_key", "summary_zh", "domains", "interaction_summary", "turn_reviews"],
        properties: {
          speaker_key: { type: "string" },
          summary_zh: { type: "string", maxLength: 1200 },
          domains: {
            type: "object", additionalProperties: false,
            required: ["communication_strategies", "vocabulary_language_patterns", "ideas_organisation", "pronunciation_delivery"],
            properties: {
              communication_strategies: GROUP_DOMAIN_SCHEMA,
              vocabulary_language_patterns: GROUP_DOMAIN_SCHEMA,
              ideas_organisation: GROUP_DOMAIN_SCHEMA,
              pronunciation_delivery: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { const: "not_assessed" } } },
            },
          },
          strengths: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 12 },
          priority_actions: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 12 },
          language_suggestions: { type: "array", items: { type: "string", maxLength: 480 }, maxItems: 12 },
          interaction_summary: { type: "object", additionalProperties: false, properties: { turn_count: { type: "integer", minimum: 0 } } },
          turn_reviews: { type: "array", items: TURN_REVIEW_SCHEMA, maxItems: 80 },
        },
      },
    },
  },
};

const INDIVIDUAL_RESPONSE_REPORT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object", additionalProperties: false,
  required: ["summary_zh", "domains", "strengths", "priority_actions", "language_suggestions", "basis_status", "student_viewpoint_zh", "socratic_questions", "sample_responses"],
  properties: {
    summary_zh: { type: "string", maxLength: 1200 },
    domains: {
      type: "object", additionalProperties: false,
      required: ["communication_strategies", "ideas_organisation", "vocabulary_language_patterns", "pronunciation_delivery"],
      properties: {
        communication_strategies: DOMAIN_SCHEMA,
        ideas_organisation: DOMAIN_SCHEMA,
        vocabulary_language_patterns: DOMAIN_SCHEMA,
        pronunciation_delivery: { type: "object", additionalProperties: false, required: ["status"], properties: { status: { const: "not_assessed" } } },
      },
    },
    strengths: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 12 },
    priority_actions: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 12 },
    language_suggestions: { type: "array", items: { type: "string", maxLength: 480 }, maxItems: 12 },
    basis_status: { enum: ["grounded", "insufficient"] },
    student_viewpoint_zh: { type: "string", minLength: 1, maxLength: 800 },
    socratic_questions: {
      type: "array", minItems: 4, maxItems: 4,
      items: {
        type: "object", additionalProperties: false,
        required: ["focus", "student_idea_zh", "evidence_segment_ids", "question_zh", "hint_zh"],
        properties: {
          focus: { enum: ["reason", "example", "qualification", "implication"] },
          student_idea_zh: { type: "string", minLength: 1, maxLength: 600 },
          evidence_segment_ids: { type: "array", uniqueItems: true, items: { type: "string" } },
          question_zh: { type: "string", minLength: 1, maxLength: 600 },
          hint_zh: { type: "string", minLength: 1, maxLength: 600 },
        },
      },
    },
    sample_responses: {
      type: "array", minItems: 3, maxItems: 3,
      items: {
        type: "object", additionalProperties: false,
        required: ["title_zh", "student_idea_zh", "evidence_segment_ids", "response_en", "explanation_zh"],
        properties: {
          title_zh: { type: "string", minLength: 1, maxLength: 160 },
          student_idea_zh: { type: "string", minLength: 1, maxLength: 600 },
          evidence_segment_ids: { type: "array", uniqueItems: true, items: { type: "string" } },
          response_en: { type: "string", minLength: 1, maxLength: 3000 },
          explanation_zh: { type: "string", minLength: 1, maxLength: 1400 },
        },
      },
    },
  },
};

module.exports = { SPEAKING_REPORT_SCHEMA_VERSION, INDIVIDUAL_RESPONSE_REPORT_SCHEMA_VERSION, SPEAKING_REPORT_SCHEMA, INDIVIDUAL_RESPONSE_REPORT_SCHEMA, DOMAIN_SCHEMA, GROUP_DOMAIN_SCHEMA, TURN_REVIEW_SCHEMA, TURN_COACHING_SCHEMA };
