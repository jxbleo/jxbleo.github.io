"use strict";

// One bounded model call per durable chunk; no audio or identity is sent here.
const VERSION = "dse-individual-response-v5";
const LEGACY_PIPELINE = "ir-feedback-chunks-v1";
const BATCH_PIPELINE = "ir-feedback-batch-v2";
const PIPELINE = "ir-feedback-single-v3";
const { SYSTEM: SINGLE_PROMPT, COMMON, CORE_SUFFIX, EXEMPLAR_SUFFIX, COMPACT_COMMON, COMPACT_EXEMPLAR_SUFFIX, GROUNDING_SUFFIX } = require("./speaking-ir-prompts");
function invalid(reason = "IR_STRUCTURE_INVALID") { const e = new Error("SPEAKING_AI_SCHEMA_INVALID"); e.code = e.message; e.validation_reason = reason; throw e; }
function object(v) { if (!v || typeof v !== "object" || Array.isArray(v)) invalid(); return v; }
function text(v, max = 800, optional = false) {
  if (typeof v !== "string" || v.length > max || (!optional && !v.trim())) invalid();
  if (/\bseg_\d+\b|\b(?:student_uid|response_session_id)\b|\d{2}:\d{2}:\d{2}/i.test(v)) invalid();
  return v.trim().replace(/[<>]/g, "");
}
function array(v, min, max) { if (!Array.isArray(v) || v.length < min || v.length > max) invalid(); return v; }
function words(value) { return [...String(value).matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)].map(m => ({ word: m[0].toLowerCase().replace(/’/g, "'"), start: m.index, end: m.index + m[0].length })); }
function evidenceQuote(value, segments, suppliedIds) {
  const quote = text(value, 500), target = words(quote).map(t => t.word);
  if (!target.length) invalid();
  let manuscript = ""; const ranges = [];
  for (const s of segments) { const start = manuscript.length; manuscript += String(s.text || "") + " "; ranges.push({ id: s.segment_id, start, end: manuscript.length - 1 }); }
  const tokens = words(manuscript);
  for (let i = 0; i <= tokens.length - target.length; i++) {
    if (!target.every((word, j) => tokens[i + j].word === word)) continue;
    const start = tokens[i].start, end = tokens[i + target.length - 1].end;
    const ids = ranges.filter(r => r.end > start && r.start < end).map(r => r.id);
    if (suppliedIds !== undefined && (!Array.isArray(suppliedIds) || new Set(suppliedIds).size !== suppliedIds.length || ids.length !== suppliedIds.length || ids.some(id => !suppliedIds.includes(id)))) continue;
    // Restore the exact original words and punctuation. No filler or uncited
    // word can be skipped; only ASR punctuation/case is ignored for matching.
    return { quote_en: manuscript.slice(start, end), evidence_segment_ids: ids };
  }
  invalid();
}
function canonicalCore(raw, segments) {
  object(raw);
  if (!["grounded", "insufficient"].includes(raw.basis_status)) invalid();
  const analysis = array(raw.analysis, 0, 4).map((p, i) => {
    object(p); if (p.id !== `p${i + 1}`) invalid();
    const evidence = evidenceQuote(p.quote_en, segments, p.evidence_segment_ids);
    return { id: p.id, title_zh: text(p.title_zh, 100), ...evidence, issue_zh: text(p.issue_zh, 500), action_zh: text(p.action_zh, 600), sample_context_zh: text(p.sample_context_zh, 400, true), sample_en: text(p.sample_en, 900) };
  });
  return { basis_status: raw.basis_status, keep_zh: text(raw.keep_zh, 600), student_viewpoint_zh: text(raw.student_viewpoint_zh, 800), analysis };
}
function canonicalExemplar(raw, core, index) {
  object(raw); if (raw.id !== `e${index + 1}`) invalid();
  const steps = array(raw.thinking_template, 3, 4).map((s, i) => {
    object(s); if (s.id !== `s${i + 1}`) invalid();
    const label = text(s.label_zh, 60), content = text(s.content_zh, 300);
    if (/[?？]/.test(label + content)) invalid();
    return { id: s.id, label_zh: label, content_zh: content };
  });
  const pointIds = new Set(core.analysis.map(p => p.id)), covered = new Set();
  const paragraphs = array(raw.paragraphs, steps.length, steps.length).map((p, i) => {
    object(p); if (p.step_id !== steps[i].id) invalid();
    const addresses = array(p.addresses, 0, 4);
    if (new Set(addresses).size !== addresses.length || addresses.some(id => !pointIds.has(id))) invalid();
    addresses.forEach(id => covered.add(id));
    return { step_id: p.step_id, text_en: text(p.text_en, 1600), addresses: addresses.slice() };
  });
  if (covered.size !== pointIds.size) invalid();
  const response = paragraphs.map(p => p.text_en).join("\n\n");
  const words = response.split(/\s+/).filter(Boolean).length;
  if (words < 90 || words > 170) invalid("IR_EXEMPLAR_WORD_COUNT");
  if (/\b(?:as I (?:suggested|mentioned)|my (?:initial|original) (?:thought|point|answer))\b/i.test(response)) invalid();
  const note = text(raw.assumption_note_zh, 500, true);
  if (core.basis_status === "insufficient" && !note) invalid();
  return { id: raw.id, assumption_note_zh: note, thinking_template: steps, paragraphs, response_en: response };
}
function distinctExemplar(sample, previous) {
  const outline = s => s.thinking_template.map(t => t.content_zh).join("").replace(/\s+/g, "");
  const shingles = s => { const tokens = words(s.response_en).map(t => t.word); return new Set(tokens.slice(0, -3).map((_, i) => tokens.slice(i, i + 4).join(" "))); };
  const a = shingles(sample);
  if (previous.some(p => { const b = shingles(p); const overlap = [...a].filter(v => b.has(v)).length;
    return outline(p) === outline(sample) || overlap / Math.max(1, Math.min(a.size, b.size)) > 0.65;
  })) invalid("IR_EXEMPLAR_TOO_SIMILAR");
  return sample;
}
function canonicalReport(raw, segments = []) {
  const core = canonicalCore(raw, segments);
  const samples = array(raw.sample_responses, 3, 3).map((s, i) => canonicalExemplar(s, core, i));
  samples.forEach((s, i) => distinctExemplar(s, samples.slice(0, i)));
  return { report_version: VERSION, ...core, summary_zh: core.keep_zh, sample_responses: samples,
    transcript: segments.map(s => ({ segment_id: String(s.segment_id || ""), start_ms: Number(s.start_ms || 0), end_ms: Number(s.end_ms || 0), text: String(s.text || "").slice(0, 2000) })) };
}
function corePrompt() { return COMMON + CORE_SUFFIX; }
function exemplarPrompt() { return COMMON + EXEMPLAR_SUFFIX; }
function sourceInput({ questionText, context, segments } = {}) {
  const data = { question_text_untrusted: String(questionText || "").slice(0, 2000), context_untrusted: context || null,
    manuscript_untrusted: words((segments || []).map(s => String(s.text || "").slice(0, 2000)).join(" ")).map(t => t.word).join(" "),
    transcript_note: "Existing speech-recognition words, with punctuation and segmentation removed mechanically. Isolated odd tokens may be recognition errors. Do not infer pronunciation, pauses, fluency or grammar from recognizer formatting." };
  if (JSON.stringify(data).length > 120000) throw new Error("SPEAKING_AI_INPUT_TOO_LARGE");
  return data;
}
function legacyNextRequest(state, source) {
  const valid = state && state.pipeline_version === LEGACY_PIPELINE;
  const core = valid && state.core ? canonicalCore(state.core, source.segments) : null;
  const samples = core ? array(state.sample_responses, 0, 2).map((s,i) => canonicalExemplar(s,core,i)) : [];
  const input = sourceInput(source);
  const scope = core ? `exemplar-${samples.length + 1}` : "core";
  return { scope, core, samples, system_prompt: core ? exemplarPrompt() : corePrompt(), user_prompt: JSON.stringify({ ...input, ...(core ? { requested_id: `e${samples.length + 1}`, development_route: ["Direct position, explain the causal links, then a practical conclusion.", "Keep the position but develop it through one explicitly hypothetical everyday scenario; end with its lesson. Do not reuse the earlier answer organisation.", "Keep the position with a useful qualification or boundary, explain why the main reasoning still holds, then give a practical response. Do not reuse an earlier scenario or sequence; adapt the qualification to the facts rather than inventing personal facts."][samples.length], accepted_feedback: { ...core, analysis: core.analysis.map(({ sample_en, ...point }) => point) }, length_instruction: "Exactly 3 short paragraphs, each 33–40 English words. Total target 100–120 words, not 100 words per paragraph.", ...(state.pending_exemplar ? { repair_instruction: state.repair_reason === "IR_EXEMPLAR_TOO_SIMILAR" ? "Your previous draft copies too much of an earlier exemplar. Rewrite using the requested DIFFERENT development route, reasoning sequence and example. Swapping synonyms is insufficient. Keep the same supported stance and implement all feedback points." : state.repair_reason === "IR_EXEMPLAR_WORD_COUNT" ? "The previous answer failed the 90–170 total English word bound. REWRITE IT TO 100–120 TOTAL WORDS. Shorten it substantially, including 3 concise matching thinking steps. Keep all feedback repairs and do not add facts." : "Repair the previous rejected object to the exact requested schema. Include every required field, correct IDs and aligned paragraphs, with every feedback point covered.", previous_rejected_exemplar: state.pending_exemplar } : {}), previous_routes_to_avoid: samples.map(s => ({ thinking_template: s.thinking_template })) } : {}) }) };
}
function legacyRepairState(request, output, error) {
  if (!request.core || !output || typeof output !== "object" || JSON.stringify(output).length > 30000) return null;
  return { pipeline_version: LEGACY_PIPELINE, core: request.core, sample_responses: request.samples,
    pending_exemplar: output, repair_reason: error.validation_reason || "IR_STRUCTURE_INVALID" };
}
function legacyAccept(request, output, segments) {
  const core = request.core || canonicalCore(output, segments);
  const samples = request.core ? [...request.samples, distinctExemplar(canonicalExemplar(output, core, request.samples.length), request.samples)] : [];
  if (samples.length === 3) return { complete: true, report: canonicalReport({ ...core, sample_responses: samples }, segments) };
  return { complete: false, state: { pipeline_version: LEGACY_PIPELINE, core, sample_responses: samples } };
}

// Older batch jobs continue to use two calls; new jobs use a single full report. Compact provider output is expanded into the
// unchanged V5 report; partial batch failures retain every accepted exemplar.
const ROUTES = [
  "Direct position → causal explanation → practical conclusion.",
  "Same position developed through one explicitly hypothetical everyday scenario → its lesson; different reasoning sequence.",
  "Same position with a relevant qualification/boundary → why the main reasoning still holds → practical response; different scenario and sequence."
];
function compactExemplarPrompt(batch) {
  return COMPACT_COMMON + `\n${batch ? 'Generate all THREE distinct exemplars under fixed keys e1,e2,e3.' : 'Repair ONLY requested_id; return its exemplar object directly.'}${COMPACT_EXEMPLAR_SUFFIX}${batch ? 'Top-level shape: {"e1":{...},"e2":{...},"e3":{...}}.' : ''} Do not output duplicate full answers, IDs or other fields.`;
}
function compactSample(raw, core, index) {
  object(raw);
  const steps = array(raw.steps, 3, 3);
  steps.forEach(object);
  const sample = canonicalExemplar({ id: `e${index + 1}`, assumption_note_zh: raw.note,
    thinking_template: steps.map((s, i) => ({ id: `s${i + 1}`, label_zh: s.label, content_zh: s.plan })),
    paragraphs: steps.map((s, i) => ({ step_id: `s${i + 1}`, text_en: s.text, addresses: s.fixes })) }, core, index);
  if (/\p{Script=Han}/u.test(sample.response_en)) invalid("IR_ENGLISH_CONTAINS_CJK");
  return sample;
}
function batchState(state, source) {
  if (!state) return { pipeline_version: PIPELINE, core: null, sample_responses: [], batch_attempted: false };
  if (![PIPELINE, BATCH_PIPELINE].includes(state.pipeline_version)) invalid();
  const core = state.core ? canonicalCore(state.core, source.segments) : null;
  const samples = array(state.sample_responses, 0, 3).map(s => {
    if (!core || !/^e[123]$/.test(s && s.id)) invalid();
    return canonicalExemplar(s, core, Number(s.id.slice(1)) - 1);
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(samples.map(s => s.id)).size !== samples.length) invalid();
  samples.forEach((s, i) => distinctExemplar(s, samples.slice(0, i)));
  if (samples.length && !state.batch_attempted) invalid();
  return { pipeline_version: state.pipeline_version, core, sample_responses: samples, batch_attempted: state.batch_attempted === true,
    repair_reasons: state.repair_reasons || {}, pending_exemplars: state.pending_exemplars || {} };
}
function nextRequest(state, source) {
  if (state && state.pipeline_version === LEGACY_PIPELINE) return { ...legacyNextRequest(state, source), legacy: true };
  const current = batchState(state, source), input = sourceInput(source);
  delete input.transcript_note; // The shared system rule already describes ASR limitations.
  const core = current.core;
  if (!core && current.pipeline_version === PIPELINE) return { scope: "report", single: true, state: current, system_prompt: SINGLE_PROMPT, user_prompt: JSON.stringify(input) };
  if (!core) return { scope: "core", state: current, system_prompt: corePrompt() + GROUNDING_SUFFIX, user_prompt: JSON.stringify(input) };
  const batch = !current.batch_attempted;
  const index = [0, 1, 2].find(i => !current.sample_responses.some(s => s.id === `e${i + 1}`));
  if (index === undefined) invalid();
  const id = `e${index + 1}`;
  const accepted = { basis_status: core.basis_status, stance: core.student_viewpoint_zh,
    repairs: core.analysis.map(p => ({ id: p.id, issue: p.issue_zh, action: p.action_zh, condition: p.sample_context_zh })) };
  return { scope: batch ? "exemplars" : `exemplar-${index + 1}`, state: current, core, batch, index,
    system_prompt: compactExemplarPrompt(batch), user_prompt: JSON.stringify({ ...input, accepted,
      ...(batch ? { routes: Object.fromEntries(ROUTES.map((r, i) => [`e${i + 1}`, r])) } : {
        requested_id: id, route: ROUTES[index], repair_reason: current.repair_reasons[id] || "IR_STRUCTURE_INVALID",
        instruction: "Rewrite to 110–135 total English words in THREE paragraphs of 35–45 words; expand short drafts with relevant reasoning, shorten long drafts. Keep accepted exemplars unchanged.",
        ...(current.pending_exemplars[id] ? { rejected_word_count: draftWordCount(current.pending_exemplars[id]) } : {}),
        ...(current.pending_exemplars[id] ? { rejected: current.pending_exemplars[id] } : {}),
        avoid: current.sample_responses.map(s => ({ id: s.id, plans: s.thinking_template.map(t => t.content_zh) }))
      }) }) };
}
function draftWordCount(raw) {
  return (Array.isArray(raw && raw.steps) ? raw.steps : []).map(s => String(s && s.text || "")).join(" ").split(/\s+/).filter(Boolean).length;
}
function boundedDraft(output) {
  return output && typeof output === "object" && JSON.stringify(output).length <= 12000 ? output : null;
}
function finishBatchState(state, segments) {
  state.sample_responses.sort((a, b) => a.id.localeCompare(b.id));
  if (state.sample_responses.length === 3) return { complete: true, report: canonicalReport({ ...state.core, sample_responses: state.sample_responses }, segments) };
  return { complete: false, state };
}
function batchFailure(request, reason = "IR_STRUCTURE_INVALID") {
  if (!request || !request.batch) return null;
  return { ...request.state, batch_attempted: true, repair_reasons: { e1: reason, e2: reason, e3: reason }, pending_exemplars: {} };
}
function accept(request, output, segments) {
  if (request.legacy) return legacyAccept(request, output, segments);
  if (request.single) {
    // Validate the core first, then retain each usable exemplar independently.
    const core = canonicalCore(output, segments);
    if (core.analysis.some(p => /\p{Script=Han}/u.test(p.sample_en))) invalid("IR_ENGLISH_CONTAINS_CJK");
    return accept({ ...request, single: false, core, batch: true, state: { ...request.state, core } }, output, segments);
  }
  if (!request.core) return { complete: false, state: { ...request.state, core: canonicalCore(output, segments) } };
  const state = { ...request.state, sample_responses: request.state.sample_responses.slice(),
    repair_reasons: { ...request.state.repair_reasons }, pending_exemplars: { ...request.state.pending_exemplars }, batch_attempted: true };
  if (request.batch) {
    for (let i = 0; i < 3; i++) {
      const id = `e${i + 1}`, raw = output && output[id];
      try { state.sample_responses.push(distinctExemplar(compactSample(raw, request.core, i), state.sample_responses)); }
      catch (error) {
        if (error.code !== "SPEAKING_AI_SCHEMA_INVALID") throw error;
        state.repair_reasons[id] = error.validation_reason || "IR_STRUCTURE_INVALID";
        const draft = boundedDraft(raw); if (draft) state.pending_exemplars[id] = draft;
      }
    }
  } else {
    state.sample_responses.push(distinctExemplar(compactSample(output, request.core, request.index), state.sample_responses));
    delete state.repair_reasons[`e${request.index + 1}`]; delete state.pending_exemplars[`e${request.index + 1}`];
  }
  return finishBatchState(state, segments);
}
function repairState(request, output, error) {
  if (request.legacy) return legacyRepairState(request, output, error);
  if (!request.core || request.batch) return null;
  const id = `e${request.index + 1}`, draft = boundedDraft(output);
  return { ...request.state, repair_reasons: { ...request.state.repair_reasons, [id]: error.validation_reason || "IR_STRUCTURE_INVALID" },
    pending_exemplars: { ...request.state.pending_exemplars, ...(draft ? { [id]: draft } : {}) } };
}
module.exports = { VERSION, PIPELINE, BATCH_PIPELINE, LEGACY_PIPELINE, canonicalCore, canonicalExemplar, canonicalReport,
  corePrompt, sourceInput, nextRequest, accept, repairState, batchFailure };
