"use strict";

const RUBRIC_VERSION = "writing-rubrics-2026-08-20.3";

// These concise evaluation instructions are maintained independently from the
// model prompt so a Composition keeps the exact rubric version used to review it.
const RUBRICS = Object.freeze({
  ielts_academic_task_1: {
    rubric_id: "ielts_academic_task_1",
    label: "IELTS Task 1",
    score_scale: "IELTS band 0–9 (whole or half bands)",
    overall_max: 9,
    score_step: 0.5,
    criterion_score_step: 1,
    overall_calculation: "weighted_average",
    criteria: [
      { id: "task_achievement", name: "Task Achievement", weight: 0.25, max_score: "9" },
      { id: "coherence_cohesion", name: "Coherence and Cohesion", weight: 0.25, max_score: "9" },
      { id: "lexical_resource", name: "Lexical Resource", weight: 0.25, max_score: "9" },
      { id: "grammar_accuracy", name: "Grammatical Range and Accuracy", weight: 0.25, max_score: "9" },
    ],
    instructions: "Judge task fulfilment, selection and comparison of key features, overview, factual support, organisation, vocabulary, and grammatical control under IELTS Academic Task 1 conventions.",
  },
  ielts_general_task_1: {
    rubric_id: "ielts_general_task_1",
    label: "IELTS General Training Writing Task 1",
    hidden: true,
    score_scale: "IELTS band 0–9 (whole or half bands)",
    overall_max: 9,
    score_step: 0.5,
    criterion_score_step: 1,
    overall_calculation: "weighted_average",
    criteria: [
      { id: "task_achievement", name: "Task Achievement", weight: 0.25, max_score: "9" },
      { id: "coherence_cohesion", name: "Coherence and Cohesion", weight: 0.25, max_score: "9" },
      { id: "lexical_resource", name: "Lexical Resource", weight: 0.25, max_score: "9" },
      { id: "grammar_accuracy", name: "Grammatical Range and Accuracy", weight: 0.25, max_score: "9" },
    ],
    instructions: "Judge coverage of the required bullet points, clarity of purpose, appropriate tone and format, organisation, vocabulary, and grammatical control under IELTS General Training Task 1 conventions.",
  },
  ielts_task_2: {
    rubric_id: "ielts_task_2",
    label: "IELTS Task 2",
    score_scale: "IELTS band 0–9 (whole or half bands)",
    overall_max: 9,
    score_step: 0.5,
    criterion_score_step: 1,
    overall_calculation: "weighted_average",
    criteria: [
      { id: "task_response", name: "Task Response", weight: 0.25, max_score: "9" },
      { id: "coherence_cohesion", name: "Coherence and Cohesion", weight: 0.25, max_score: "9" },
      { id: "lexical_resource", name: "Lexical Resource", weight: 0.25, max_score: "9" },
      { id: "grammar_accuracy", name: "Grammatical Range and Accuracy", weight: 0.25, max_score: "9" },
    ],
    instructions: "Judge whether the response addresses every part of the prompt, presents and develops a clear position with relevant support, progresses coherently, and demonstrates suitable vocabulary and grammatical control.",
  },
  hkdse_paper_2: {
    rubric_id: "hkdse_paper_2",
    label: "DSE Paper 2",
    score_scale: "Formative estimate 0–21 for one Paper 2 task (not a final HKDSE level)",
    overall_max: 21,
    score_step: 1,
    criterion_score_step: 1,
    overall_calculation: "sum",
    criteria: [
      { id: "content", name: "Content", weight: 0.3333, max_score: "7" },
      { id: "language", name: "Language", weight: 0.3333, max_score: "7" },
      { id: "organisation", name: "Organisation", weight: 0.3333, max_score: "7" },
    ],
    instructions: "Use best fit in each of the three domains. Judge relevance and development of ideas for the stated purpose and audience, command and appropriacy of English, and coherent organisation. Estimate a mark out of 7 for each domain and a total out of 21 for this task. Do not convert one task mark into a final HKDSE subject level.",
  },
  cambridge_9093_p2_shorter_writing: {
    rubric_id: "cambridge_9093_p2_shorter_writing",
    label: "A Level 9093 · Shorter Writing",
    score_scale: "Cambridge 9093 Paper 2 Section A Question 1(a): 0–15 whole marks",
    overall_max: 15,
    score_step: 1,
    criterion_score_step: 1,
    overall_calculation: "sum",
    criteria: [
      { id: "ao2_writing", name: "AO2 Writing", weight: 1, max_score: "15" },
    ],
    instructions: "Apply Cambridge 9093 Paper 2 Section A Question 1(a). Use best fit for AO2: effectiveness and creativity of expression; accuracy and range of language; logical organisation and development; achievement and relevance of the brief; and engagement of the specified audience. The response should be no more than 400 words. Do not deduct marks mechanically for length; treat it only within achievement of task and relevance to purpose. Award one whole mark from 0 to 15.",
  },
  cambridge_9093_p2_reflective_commentary: {
    rubric_id: "cambridge_9093_p2_reflective_commentary",
    label: "A Level 9093 · Reflective Commentary",
    score_scale: "Cambridge 9093 Paper 2 Section A Question 1(b): 0–10 whole marks",
    overall_max: 10,
    score_step: 1,
    criterion_score_step: 1,
    overall_calculation: "sum",
    criteria: [
      { id: "ao3_analysis", name: "AO3 Analysis", weight: 1, max_score: "10" },
    ],
    instructions: "Apply Cambridge 9093 Paper 2 Section A Question 1(b). Use best fit for AO3: analysis of form, structure and language, and analysis of how stylistic choices relate to audience and shape meaning. The commentary must explain how the student's linguistic choices fulfil the associated writing brief. Award one whole mark from 0 to 10.",
  },
  cambridge_9093_p2_extended_writing: {
    rubric_id: "cambridge_9093_p2_extended_writing",
    label: "A Level 9093 · Extended Writing",
    score_scale: "Cambridge 9093 Paper 2 Section B: 0–25 whole marks",
    overall_max: 25,
    score_step: 1,
    criterion_score_step: 1,
    overall_calculation: "sum",
    criteria: [
      { id: "ao2_writing", name: "AO2 Writing", weight: 1, max_score: "25" },
    ],
    instructions: "Apply Cambridge 9093 Paper 2 Section B Extended Writing for imaginative/descriptive, discursive/argumentative, or review/critical writing. Use best fit for AO2: effectiveness and creativity of expression; accuracy and range of language; logical organisation and development; achievement and relevance of the task; and engagement of the specified audience. The expected length is 600–900 words. Do not deduct marks mechanically for length; treat it only within achievement of task and relevance to purpose. Award one whole mark from 0 to 25.",
  },
});

function publicRubrics() {
  return Object.values(RUBRICS)
    .filter((rubric) => rubric.hidden !== true)
    .map(({ instructions, hidden, ...rubric }) => rubric);
}

function getRubric(rubricId) {
  const rubric = RUBRICS[String(rubricId || "")];
  if (!rubric) throw new Error("RUBRIC_REQUIRED");
  if (rubric.disabled) throw new Error("RUBRIC_NOT_AVAILABLE");
  return rubric;
}

module.exports = { RUBRIC_VERSION, RUBRICS, getRubric, publicRubrics };
