"use strict";

const SPEAKING_REPORT_SCHEMA_VERSION = "dse-speaking-report-v5";
const INDIVIDUAL_RESPONSE_REPORT_SCHEMA_VERSION = "dse-individual-response-v5";

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

const SPEAKING_OVERVIEW_SCHEMA = {
  ...SPEAKING_REPORT_SCHEMA,
  properties: {
    ...SPEAKING_REPORT_SCHEMA.properties,
    candidates: {
      ...SPEAKING_REPORT_SCHEMA.properties.candidates,
      items: {
        ...SPEAKING_REPORT_SCHEMA.properties.candidates.items,
        required: ["speaker_key", "summary_zh", "domains", "interaction_summary"],
        properties: Object.fromEntries(Object.entries(SPEAKING_REPORT_SCHEMA.properties.candidates.items.properties).filter(([key]) => key !== "turn_reviews" && !["strengths", "priority_actions", "language_suggestions"].includes(key))),
      },
    },
  },
};

const TURN_REVIEW_CHUNK_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object", additionalProperties: false,
  required: ["speaker_key", "turn_reviews"],
  properties: {
    speaker_key: { type: "string" },
    turn_reviews: { type: "array", minItems: 1, maxItems: 8, items: TURN_REVIEW_SCHEMA },
  },
};

const IR_STRENGTH_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["point_zh", "explanation_zh", "evidence_segment_ids"],
  properties: { point_zh: { type: "string", minLength: 1, maxLength: 240 }, explanation_zh: { type: "string", minLength: 1, maxLength: 1000 }, evidence_segment_ids: { type: "array", minItems: 1, maxItems: 12, uniqueItems: true, items: { type: "string" } } },
};
const IR_WEAKNESS_SCHEMA = {
  ...IR_STRENGTH_SCHEMA,
  required: [...IR_STRENGTH_SCHEMA.required, "improvement_zh", "example_en"],
  properties: { ...IR_STRENGTH_SCHEMA.properties, improvement_zh: { type: "string", minLength: 1, maxLength: 1000 }, example_en: { type: "string", minLength: 1, maxLength: 1000 } },
};
const IR_DOMAIN_SCHEMA = {
  ...DOMAIN_SCHEMA,
  required: [...DOMAIN_SCHEMA.required, "strengths", "weaknesses"],
  properties: { ...DOMAIN_SCHEMA.properties, commentary_zh: { type: "string", minLength: 1, maxLength: 1200 }, strengths: { type: "array", maxItems: 4, items: IR_STRENGTH_SCHEMA }, weaknesses: { type: "array", maxItems: 4, items: IR_WEAKNESS_SCHEMA } },
};

// Generation runs as a feedback chunk followed by three exemplar chunks.
// Runtime canonical validation additionally enforces verbatim evidence, paragraph
// alignment, point coverage, distinct answers and the 90–170 word bounds.
const irText = (maxLength, minLength = 1) => ({ type: "string", minLength, maxLength });
const irObject = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const IR_FEEDBACK_SCHEMA = irObject({
  id: { type: "string", pattern: "^p[1-4]$" }, title_zh: irText(100), quote_en: irText(500),
  evidence_segment_ids: { type: "array", minItems: 1, maxItems: 12, uniqueItems: true, items: { type: "string" } },
  issue_zh: irText(500), action_zh: irText(600), sample_context_zh: irText(400, 0), sample_en: irText(900),
});
const IR_EXEMPLAR_SCHEMA = irObject({
  id: { type: "string", pattern: "^e[1-3]$" }, assumption_note_zh: irText(500, 0),
  thinking_template: { type: "array", minItems: 3, maxItems: 4, items: irObject({ id: irText(2), label_zh: irText(60), content_zh: irText(300) }) },
  paragraphs: { type: "array", minItems: 3, maxItems: 4, items: irObject({ step_id: irText(2), text_en: irText(1600), addresses: { type: "array", maxItems: 4, uniqueItems: true, items: { type: "string", pattern: "^p[1-4]$" } } }) },
});
const INDIVIDUAL_RESPONSE_REPORT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  ...irObject({ basis_status: { enum: ["grounded", "insufficient"] }, keep_zh: irText(600), student_viewpoint_zh: irText(800),
    analysis: { type: "array", maxItems: 4, items: IR_FEEDBACK_SCHEMA },
    sample_responses: { type: "array", minItems: 3, maxItems: 3, items: IR_EXEMPLAR_SCHEMA },
  }),
};

module.exports = { SPEAKING_REPORT_SCHEMA_VERSION, INDIVIDUAL_RESPONSE_REPORT_SCHEMA_VERSION, SPEAKING_REPORT_SCHEMA, SPEAKING_OVERVIEW_SCHEMA, TURN_REVIEW_CHUNK_SCHEMA, INDIVIDUAL_RESPONSE_REPORT_SCHEMA, DOMAIN_SCHEMA, GROUP_DOMAIN_SCHEMA, TURN_REVIEW_SCHEMA, TURN_COACHING_SCHEMA };
