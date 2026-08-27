"use strict";

const PROMPT_VERSION = "dse-speaking-prompts-2026-08-27.1";

function dseAnalysisPrompt() {
  return [
    `Prompt version: ${PROMPT_VERSION}`,
    "Evaluate only the supplied canonical Candidate Speaker keys using the three DSE Group Interaction domains.",
    "Pronunciation & Delivery is not assessed in this V1 and must be returned with status not_assessed.",
    "A brief unmatched voice may be an outside person: never score it, count it, or attribute it to another Speaker.",
    "Use only supplied evidence segment IDs. Do not output participant names, Student IDs, official grades, or overall totals.",
  ].join("\n");
}

module.exports = { PROMPT_VERSION, dseAnalysisPrompt };
