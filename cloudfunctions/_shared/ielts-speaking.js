"use strict";

// IELTS classroom practice uses the Speaking transport, never DSE rubrics.
const FAMILY = "ielts";
const VERSION = "ielts-speaking-v1";
const RUBRIC_URL = "https://ielts.org/cdn/ielts-guides/ielts-speaking-band-descriptors.pdf";
const DOMAINS = ["fluency_coherence", "lexical_resource", "grammatical_range_accuracy"];
const text = (value, max = 2000) => typeof value === "string" ? value.trim().slice(0, max) : "";
function required(value, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("IELTS_CONTENT_INVALID");
  return value.trim();
}
function durationLimit(row) {
  if (row && row.exam_family === FAMILY) {
    if (row.question_snapshot && row.question_snapshot.part === 2) return 120;
    if (row.question_snapshot && row.question_snapshot.part === 3) return 90;
    throw new Error("IELTS_CONTENT_INVALID");
  }
  return 65;
}
function normalizeSet(source) {
  if (!source || !/^ielts-(?:c\d+-t[1-4]|season-[a-z0-9-]+)$/.test(source.set_id || "")) throw new Error("IELTS_CONTENT_INVALID");
  if (!["cambridge", "seasonal"].includes(source.source_kind)) throw new Error("IELTS_CONTENT_INVALID");
  const cambridge = source.source_kind === "cambridge";
  if (cambridge && (!Number.isInteger(source.book) || source.book < 1 || source.book > 99 || ![1, 2, 3, 4].includes(source.test) || source.set_id !== `ielts-c${source.book}-t${source.test}`)) throw new Error("IELTS_CONTENT_INVALID");
  if (!cambridge && (!Number.isInteger(source.year) || source.year < 2000 || !/^ielts-season-/.test(source.set_id))) throw new Error("IELTS_CONTENT_INVALID");
  const p2 = source.part_2 || {};
  const bullets = p2.bullets;
  const questions = source.part_3;
  if (!Array.isArray(bullets) || !bullets.length || bullets.length > 8 || !Array.isArray(questions) || !questions.length || questions.length > 24) throw new Error("IELTS_CONTENT_INVALID");
  const ids = new Set();
  const part3 = questions.map((q, index) => {
    if (!q || !/^p3_\d{2,3}$/.test(q.question_id || "") || ids.has(q.question_id)) throw new Error("IELTS_CONTENT_INVALID");
    ids.add(q.question_id);
    return { question_id: q.question_id, part: 3, order: index + 1, text: required(q.text, 1200), group: text(q.group, 160) };
  });
  if (!Number.isInteger(source.content_revision) || source.content_revision < 1 || source.source_verified !== true) throw new Error("IELTS_CONTENT_INVALID");
  return {
    set_id: source.set_id, exam_family: FAMILY, source_kind: source.source_kind,
    book: cambridge ? source.book : null, test: cambridge ? source.test : null,
    year: cambridge ? null : source.year, season: cambridge ? null : required(source.season, 80),
    title: required(source.title, 160), content_revision: source.content_revision,
    source_verified: true, source_reference: required(source.source_reference, 1000),
    visible_to_students: source.visible_to_students === true,
    part_2: { question_id: "p2", part: 2, order: 1, text: required(p2.text, 1600), bullets: bullets.map(item => required(item, 500)), closing: text(p2.closing, 800) },
    part_3: part3,
  };
}
function summary(set) {
  return Object.fromEntries(["set_id", "source_kind", "book", "test", "year", "season", "title", "content_revision"].map(key => [key, set[key]]));
}
function questionFor(set, questionId) {
  if (questionId === "p2") return { ...set.part_2, bullets: [...set.part_2.bullets] };
  const question = set.part_3.find(q => q.question_id === questionId);
  if (!question) throw new Error("SPEAKING_QUESTION_NOT_FOUND");
  return { ...question };
}
function canonicalReport(raw, segments) {
  const fail = () => { throw new Error("SPEAKING_AI_SCHEMA_INVALID"); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.schema_version !== VERSION || !segments.length) fail();
  const clean = (value, max) => { if (typeof value !== "string" || !value.trim() || value.length > max) fail(); return value.trim(); };
  const domainOutput = {};
  for (const key of DOMAINS) {
    const d = raw.domains && raw.domains[key];
    if (!d || !["estimated", "insufficient_evidence"].includes(d.status)) fail();
    if (d.status === "estimated" ? !Number.isInteger(d.score) || d.score < 1 || d.score > 9 : d.score !== null) fail();
    if (!Array.isArray(d.evidence) || d.evidence.length > 8 || d.status === "estimated" && !d.evidence.length) fail();
    const evidence = d.evidence.map(e => {
      const segment = segments.find(s => s.segment_id === e.segment_id);
      if (!segment || typeof e.quote !== "string" || !e.quote.trim() || !segment.text.includes(e.quote)) fail();
      return { segment_id: segment.segment_id, quote: e.quote, start_ms: segment.start_ms, end_ms: segment.end_ms };
    });
    domainOutput[key] = { status: d.status, score: d.score, commentary_zh: clean(d.commentary_zh, 1800), evidence };
  }
  // A whitelist deliberately excludes any model-generated total/pronunciation score.
  return {
    schema_version: VERSION, rubric_url: RUBRIC_URL, score_scope: "single_question_training_estimate",
    domains: domainOutput, pronunciation: { status: "not_assessed" },
    summary_zh: clean(raw.summary_zh, 2000),
    thinking_prompt_zh: clean(raw.thinking_prompt_zh, 2200),
    thinking_keywords_en: Array.isArray(raw.thinking_keywords_en) ? raw.thinking_keywords_en.slice(0, 12).map(k => clean(k, 100)) : [],
    sample_answer_en: clean(raw.sample_answer_en, 4000), sample_target_band: 8,
    transcript: segments.map(s => ({ segment_id: s.segment_id, start_ms: s.start_ms, end_ms: s.end_ms, text: s.text })),
  };
}
module.exports = { FAMILY, VERSION, DOMAINS, RUBRIC_URL, durationLimit, normalizeSet, summary, questionFor, canonicalReport };
