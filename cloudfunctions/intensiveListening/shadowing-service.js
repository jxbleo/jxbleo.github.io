"use strict";

/*
 * The Shadowing domain is deliberately independent from the CloudBase gateway.
 * Keeping these functions pure makes the safety boundary (reference text and
 * scoring policy stay on the server) easy to exercise without a provider call.
 */

const crypto = require("crypto");

const PASS_LINE = 80;
const TRACKS = ["dictation", "shadowing"];
const MODES = ["dictation", "context_only", "shadowing", "skip"];

function text(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeMode(value) {
  const mode = text(value).toLowerCase().replace(/[-\s]+/g, "_");
  if (mode === "listen_only") return "context_only";
  return MODES.includes(mode) ? mode : "dictation";
}

function normalizeToken(value) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/^['\"([{]+|['\".,!?;:)\]}…—–]+$/g, "");
}

function tokenizeReference(value) {
  const source = text(value);
  const words = [];
  const matcher = /[^\s]+/g;
  let match;
  while ((match = matcher.exec(source))) {
    const token = match[0];
    const normalized = normalizeToken(token);
    if (!normalized) continue;
    words.push({
      word_id: `rw_${String(words.length + 1).padStart(3, "0")}`,
      text: token,
      normalized,
      start_offset: match.index,
      end_offset: match.index + token.length,
      unscored: false,
    });
  }
  return words;
}

function stableWordId(value, index) {
  const digest = crypto.createHash("sha256").update(`${index}\n${text(value)}`).digest("hex").slice(0, 12);
  return `rw_${String(index + 1).padStart(3, "0")}_${digest}`;
}

function referenceWords(segment) {
  if (!segment) return [];
  if (Array.isArray(segment.reference_words) && segment.reference_words.length) {
    return segment.reference_words.map((word, index) => {
      const raw = typeof word === "string" ? { text: word } : (word || {});
      const display = text(raw.text || raw.word || raw.reference_word);
      return {
        word_id: text(raw.word_id) || stableWordId(display, index),
        text: display,
        normalized: normalizeToken(display),
        unscored: raw.unscored === true,
      };
    });
  }
  return tokenizeReference(segment.text || segment.transcript || "").map((word) => ({
    ...word,
    word_id: text(word.word_id) || stableWordId(word.text, word.start_offset || 0),
  }));
}

function normalizeSegment(segment, index, track) {
  const raw = segment || {};
  const segmentId = text(raw.segment_id || raw.unit_id) || `${track}_${String(index + 1).padStart(3, "0")}`;
  const sourceMode = normalizeMode(raw.practice_mode || raw.mode);
  const mode = track === "shadowing"
    ? (["shadowing", "context_only", "skip"].includes(sourceMode) ? sourceMode : "shadowing")
    : sourceMode;
  const start = Number(raw.start_seconds == null ? raw.start : raw.start_seconds);
  const end = Number(raw.end_seconds == null ? raw.end : raw.end_seconds);
  const output = {
    segment_id: segmentId,
    start_seconds: Number.isFinite(start) && start >= 0 ? start : 0,
    end_seconds: Number.isFinite(end) && end >= 0 ? end : 0,
    speaker: text(raw.speaker || raw.speaker_name),
    practice_mode: mode,
    text: text(raw.text || raw.transcript),
  };
  if (track === "dictation") {
    output.slots = Array.isArray(raw.slots) ? raw.slots.map((slot, slotIndex) => ({
      slot_id: text(slot && slot.slot_id) || `${segmentId}_w${String(slotIndex + 1).padStart(3, "0")}`,
      prefix: text(slot && slot.prefix),
      suffix: text(slot && slot.suffix),
      answer: text(slot && (slot.answer || slot.text)),
      accepted_answers: Array.isArray(slot && slot.accepted_answers)
        ? slot.accepted_answers.map(text).filter(Boolean)
        : undefined,
      spelling_requirement: text(slot && slot.spelling_requirement) === "provided" ? "provided" : "required",
    })) : [];
  } else {
    output.reference_words = referenceWords(raw);
  }
  return output;
}

function trackFromLegacy(material, track) {
  const units = Array.isArray(material && material.units) ? material.units : [];
  if (track === "dictation") {
    return {
      enabled: units.some((unit) => normalizeMode(unit && unit.practice_mode) === "dictation"),
      revision: text(material && (material.dictation_revision || material.content_version)) || "1",
      segments: units.map((unit, index) => normalizeSegment(unit, index, "dictation")),
    };
  }
  const segments = units
    .filter((unit) => normalizeMode(unit && unit.practice_mode) !== "skip")
    .map((unit, index) => normalizeSegment(unit, index, "shadowing"));
  return {
    enabled: segments.length > 0,
    revision: text(material && material.shadowing_revision) || "shadowing-derived-v1",
    segments,
  };
}

function normalizeTrack(raw, track, material) {
  if (!raw || typeof raw !== "object") return trackFromLegacy(material, track);
  const sourceSegments = Array.isArray(raw.segments) ? raw.segments : [];
  return {
    enabled: raw.enabled !== false && sourceSegments.length > 0,
    revision: text(raw.revision) || (track === "dictation" ? "1" : "shadowing-v1"),
    segments: sourceSegments.map((segment, index) => normalizeSegment(segment, index, track)),
  };
}

function normalizeMaterial(material) {
  const raw = material && typeof material === "object" ? material : {};
  const explicitTracks = raw.tracks && typeof raw.tracks === "object";
  const media = raw.media && typeof raw.media === "object"
    ? {
      kind: text(raw.media.kind).toLowerCase() === "video" ? "video" : "audio",
      src: text(raw.media.src || raw.media.url || raw.media.audio_src || raw.media.audioSrc || raw.audio_src),
      mime_type: text(raw.media.mime_type || raw.media.mimeType),
    }
    : {
      kind: text(raw.media_kind || raw.mediaKind).toLowerCase() === "video" ? "video" : "audio",
      src: text(raw.audio_src || raw.audioSrc || raw.media_src),
      mime_type: text(raw.mime_type || raw.mimeType),
    };
  const tracks = {
    dictation: normalizeTrack(explicitTracks ? raw.tracks.dictation : null, "dictation", raw),
    shadowing: normalizeTrack(explicitTracks ? raw.tracks.shadowing : null, "shadowing", raw),
  };
  if (!explicitTracks && raw.shadowing_enabled === false) tracks.shadowing.enabled = false;
  return {
    schema_version: Number(raw.schema_version || raw.schemaVersion) >= 2 || explicitTracks ? 2 : 1,
    material_id: text(raw.material_id || raw.materialId || raw.set_id),
    set_id: text(raw.set_id || raw.material_id || raw.materialId),
    title: text(raw.title) || "Listening",
    source_family: text(raw.source_family || raw.sourceFamily),
    source_label: text(raw.source_label || raw.sourceLabel),
    series_label: text(raw.series_label || raw.seriesLabel),
    published_on: text(raw.published_on || raw.publishedOn),
    media,
    transcript_revision: text(raw.transcript_revision || raw.transcriptRevision || raw.content_version) || "1",
    linked_practice_set_id: text(raw.linked_practice_set_id || raw.linkedPracticeSetId) || null,
    publication_status: text(raw.publication_status || raw.publicationStatus) || (raw.visible === false ? "hidden" : "published"),
    published_at: raw.published_at || raw.publishedAt || null,
    dictation_revision: tracks.dictation.revision,
    shadowing_revision: tracks.shadowing.revision,
    tracks,
  };
}

function enabledTracks(material) {
  const normalized = material && material.tracks ? material : normalizeMaterial(material);
  return TRACKS.filter((track) => normalized.tracks[track] && normalized.tracks[track].enabled);
}

function trackSegments(material, track) {
  const normalized = material && material.tracks ? material : normalizeMaterial(material);
  if (!TRACKS.includes(track)) return [];
  return normalized.tracks[track] && Array.isArray(normalized.tracks[track].segments)
    ? normalized.tracks[track].segments
    : [];
}

function trainingSegments(material, track) {
  return trackSegments(material, track).filter((segment) => (
    track === "dictation"
      ? normalizeMode(segment.practice_mode) === "dictation"
      : normalizeMode(segment.practice_mode) === "shadowing"
  ));
}

function safeTrackMaterial(material) {
  const normalized = normalizeMaterial(material);
  const safe = {
    material_id: normalized.material_id,
    set_id: normalized.set_id,
    title: normalized.title,
    source_label: normalized.source_label,
    series_label: normalized.series_label,
    published_on: normalized.published_on,
    media: { ...normalized.media },
    transcript_revision: normalized.transcript_revision,
    linked_practice_set_id: normalized.linked_practice_set_id,
    schema_version: normalized.schema_version,
    tracks: {},
  };
  TRACKS.forEach((track) => {
    const source = normalized.tracks[track];
    safe.tracks[track] = {
      enabled: Boolean(source && source.enabled),
      revision: source && source.revision || "1",
      segment_count: trainingSegments(normalized, track).length,
      segments: trackSegments(normalized, track).map((segment) => ({
        segment_id: segment.segment_id,
        start_seconds: segment.start_seconds,
        end_seconds: segment.end_seconds,
        speaker: segment.speaker,
        practice_mode: normalizeMode(segment.practice_mode),
        slots: track === "dictation" ? (segment.slots || []).map((slot) => ({
          slot_id: slot.slot_id,
          prefix: slot.prefix || "",
          suffix: slot.suffix || "",
          spelling_requirement: slot.spelling_requirement === "provided" ? "provided" : "required",
          provided_text: slot.spelling_requirement === "provided" ? slot.answer || "" : "",
        })) : undefined,
      })),
    };
  });
  return safe;
}

function stableReferenceHash(segment, policy = {}) {
  const words = referenceWords(segment).map((word) => ({ id: word.word_id, text: word.text, unscored: word.unscored }));
  return crypto.createHash("sha256").update(JSON.stringify({
    segment_id: text(segment && segment.segment_id),
    text: text(segment && segment.text),
    words,
    policy: policy.unscored_word_policy_revision || policy.unscoredWordPolicyRevision || "1",
  })).digest("hex");
}

function matchTag(value) {
  const raw = text(value).toLowerCase();
  if (raw === "" && value == null) return "unknown";
  if (["0", "matched", "match", "correct", "normal"].includes(raw)) return "matched";
  if (["1", "inserted", "extra"].includes(raw)) return "inserted";
  if (["2", "missing", "omitted"].includes(raw)) return "missing";
  if (["3", "misread", "wrong"].includes(raw)) return "misread";
  if (["4", "not_in_recording", "unrecorded", "not_found"].includes(raw)) return "unrecorded";
  const number = Number(value);
  // SOE-N MatchTag values have changed names in SDK examples; keep the
  // documented missing/misread/unrecorded semantics conservative.
  if (Number.isFinite(number)) {
    if (number === 0) return "matched";
    if (number === 1) return "inserted";
    if (number === 2) return "missing";
    if (number === 3) return "misread";
    if (number === 4) return "unrecorded";
  }
  return "unknown";
}

function alignProviderWords(providerWords, reference) {
  const source = Array.isArray(providerWords) ? providerWords : [];
  const refs = Array.isArray(reference) ? reference : [];
  const unused = refs.map((_, index) => index);
  const result = refs.map((word) => ({
    word_id: word.word_id,
    reference_word: word.text,
    state: word.unscored ? "unscored" : "normal",
    match_tag: "matched",
    pron_accuracy: null,
    begin_ms: null,
    end_ms: null,
  }));
  source.forEach((provider, providerIndex) => {
    const current = normalizeToken(provider && (provider.reference_word || provider.word || provider.text));
    let refIndex = -1;
    if (current) refIndex = unused.find((index) => refs[index].normalized === current);
    if (refIndex == null || refIndex < 0) {
      const hinted = Number(provider && (provider.reference_index || provider.referenceIndex));
      if (Number.isInteger(hinted) && hinted >= 0 && hinted < refs.length && unused.includes(hinted)) refIndex = hinted;
    }
    if (refIndex == null || refIndex < 0) {
      // Provider insertions do not create learner-visible words. Keep them in
      // private evidence only; the stable transcript remains reference-led.
      return;
    }
    const at = unused.indexOf(refIndex);
    if (at >= 0) unused.splice(at, 1);
    const tag = matchTag(provider && (provider.match_tag == null ? provider.matchTag : provider.match_tag));
    const accuracy = Number(provider && (provider.pron_accuracy == null ? provider.pronAccuracy : provider.pron_accuracy));
    result[refIndex] = {
      ...result[refIndex],
      match_tag: tag,
      pron_accuracy: Number.isFinite(accuracy) ? accuracy : null,
      begin_ms: Number.isFinite(Number(provider && (provider.begin_ms == null ? provider.beginMs : provider.begin_ms))) ? Number(provider.begin_ms == null ? provider.beginMs : provider.begin_ms) : null,
      end_ms: Number.isFinite(Number(provider && (provider.end_ms == null ? provider.endMs : provider.end_ms))) ? Number(provider.end_ms == null ? provider.endMs : provider.end_ms) : null,
      provider_index: providerIndex,
    };
  });
  unused.forEach((index) => {
    if (refs[index].unscored) {
      result[index].state = "unscored";
      return;
    }
    result[index].match_tag = "unrecorded";
    result[index].state = "red";
  });
  return result;
}

function wordStatesFromEvidence(providerWords, segment, policy = {}) {
  const refs = referenceWords(segment);
  const yellow = Number(policy.yellow_word_accuracy == null ? policy.yellowWordAccuracy : policy.yellow_word_accuracy);
  const red = Number(policy.red_word_accuracy == null ? policy.redWordAccuracy : policy.red_word_accuracy);
  const yellowThreshold = Number.isFinite(yellow) ? yellow : 75;
  const redThreshold = Number.isFinite(red) ? red : 45;
  const aligned = alignProviderWords(providerWords, refs);
  return aligned.map((word) => {
    if (word.state === "unscored" || refs.find((ref) => ref.word_id === word.word_id)?.unscored) {
      return { word_id: word.word_id, state: "unscored" };
    }
    if (["missing", "misread", "unrecorded"].includes(word.match_tag)) {
      return { word_id: word.word_id, state: "red" };
    }
    if (Number.isFinite(word.pron_accuracy) && word.pron_accuracy < redThreshold) {
      return { word_id: word.word_id, state: "red" };
    }
    if (Number.isFinite(word.pron_accuracy) && word.pron_accuracy < yellowThreshold) {
      return { word_id: word.word_id, state: "yellow" };
    }
    if (word.match_tag === "unknown") return { word_id: word.word_id, state: "yellow" };
    return { word_id: word.word_id, state: "normal" };
  });
}

function scoreFromEvidence(evidence = {}, policy = {}) {
  if (!policy || policy.status !== "approved") throw new Error("SCORING_POLICY_NOT_APPROVED");
  // Tencent documents SuggestedScore as the sentence-level total.  Do not
  // invent a second weighting formula from metrics whose ranges can differ by
  // mode; calibration may replace this source only through a reviewed policy.
  const rawValue = evidence.suggested_score == null ? evidence.suggestedScore : evidence.suggested_score;
  if (rawValue == null || rawValue === "") throw new Error("SHADOWING_SCORE_MISSING");
  let raw = Number(rawValue);
  if (!Number.isFinite(raw)) throw new Error("SHADOWING_SCORE_MISSING");
  const offset = Number(policy.score_offset == null ? policy.scoreOffset : policy.score_offset);
  if (Number.isFinite(offset)) raw += offset;
  let score = Math.max(0, Math.min(100, Math.round(raw)));
  const red = Array.isArray(evidence.word_states)
    ? evidence.word_states.some((word) => word && word.state === "red")
    : false;
  if (red) score = Math.min(PASS_LINE - 1, score);
  return score;
}

function createProgress(material, options = {}) {
  const normalized = normalizeMaterial(material);
  const segments = trainingSegments(normalized, "shadowing");
  const segmentStates = {};
  segments.forEach((segment) => {
    segmentStates[segment.segment_id] = {
      complete_listen_count: 0,
      transcript_revealed: false,
      best_score: null,
      best_take_id: null,
      best_word_states: [],
      qualified: false,
      assisted: false,
      independent: false,
      in_to_improve: false,
      updated_at: null,
    };
  });
  const threshold = options.reveal_threshold == null ? 3 : options.reveal_threshold;
  return {
    progress_id: options.progress_id || null,
    student_uid: options.student_uid || null,
    material_id: normalized.material_id,
    set_id: normalized.set_id,
    shadowing_revision: normalized.tracks.shadowing.revision,
    reveal_threshold: [1, 2, 3, 5, "off"].includes(threshold) ? threshold : 3,
    segment_states: segmentStates,
    qualified_segment_count: 0,
    segment_count: segments.length,
    percentage: 0,
    completed: segments.length === 0,
    completed_at: segments.length === 0 ? new Date() : null,
  };
}

function progressSummary(progress) {
  const states = progress && progress.segment_states && typeof progress.segment_states === "object" ? progress.segment_states : {};
  const values = Object.values(states);
  const qualified = values.filter((state) => state && state.qualified === true).length;
  const count = Number(progress && progress.segment_count) || values.length;
  return {
    segment_count: count,
    qualified_segment_count: qualified,
    percentage: count ? Math.round(qualified / count * 100) : 0,
    completed: count === 0 || qualified >= count,
  };
}

function applyTake(progress, segmentId, result, now = new Date()) {
  if (!progress || !progress.segment_states || !progress.segment_states[segmentId]) throw new Error("SHADOWING_SEGMENT_NOT_FOUND");
  const current = progress.segment_states[segmentId];
  const score = Math.max(0, Math.min(100, Math.round(Number(result && result.score) || 0)));
  const next = { ...current };
  const wasRevealed = current.transcript_revealed === true;
  next.transcript_revealed = wasRevealed || result && result.transcript_revealed === true;
  if (current.best_score == null || score > Number(current.best_score)) {
    next.best_score = score;
    next.best_take_id = result && result.take_id || null;
    next.best_word_states = Array.isArray(result && result.word_states) ? result.word_states.map((word) => ({ ...word })) : [];
  }
  next.qualified = next.qualified === true || score >= PASS_LINE;
  next.assisted = next.assisted === true || (score >= PASS_LINE && next.transcript_revealed);
  next.independent = next.independent === true || (score >= PASS_LINE && !next.transcript_revealed);
  if (next.qualified) next.in_to_improve = false;
  next.updated_at = now;
  const states = { ...progress.segment_states, [segmentId]: next };
  const summary = progressSummary({ ...progress, segment_states: states });
  return {
    ...progress,
    segment_states: states,
    qualified_segment_count: summary.qualified_segment_count,
    percentage: summary.percentage,
    completed: summary.completed,
    completed_at: summary.completed ? (progress.completed_at || now) : null,
    updated_at: now,
  };
}

function continueSegment(progress, segmentId, now = new Date()) {
  if (!progress || !progress.segment_states || !progress.segment_states[segmentId]) throw new Error("SHADOWING_SEGMENT_NOT_FOUND");
  const state = progress.segment_states[segmentId];
  if (state.qualified) return progress;
  if (state.best_score == null) throw new Error("SHADOWING_TAKE_REQUIRED");
  const next = { ...state, in_to_improve: true, updated_at: now };
  return { ...progress, segment_states: { ...progress.segment_states, [segmentId]: next }, updated_at: now };
}

function toImproveQueue(progress, segments) {
  const order = Array.isArray(segments) ? segments : [];
  return order.filter((segment) => {
    const state = progress && progress.segment_states && progress.segment_states[segment.segment_id];
    return state && state.in_to_improve && !state.qualified;
  }).map((segment) => segment.segment_id);
}

function duplicateKey({ audio_hash, reference_hash, material_id, shadowing_revision, policy_revision, provider_revision }) {
  return crypto.createHash("sha256").update([
    text(audio_hash), text(reference_hash), text(material_id), text(shadowing_revision),
    text(policy_revision), text(provider_revision),
  ].join("\n")).digest("hex");
}

function validateWav(buffer, options = {}) {
  const value = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const fail = (code) => ({ valid: false, code });
  if (value.length < 44) return fail("AUDIO_WAV_INVALID");
  if (value.toString("ascii", 0, 4) !== "RIFF" || value.toString("ascii", 8, 12) !== "WAVE") return fail("AUDIO_WAV_INVALID");
  let offset = 12;
  let format = null;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= value.length) {
    const chunk = value.toString("ascii", offset, offset + 4);
    const size = value.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > value.length) return fail("AUDIO_WAV_INVALID");
    if (chunk === "fmt " && size >= 16) {
      format = {
        audio_format: value.readUInt16LE(body),
        channels: value.readUInt16LE(body + 2),
        sample_rate: value.readUInt32LE(body + 4),
        bits_per_sample: value.readUInt16LE(body + 14),
      };
    }
    if (chunk === "data") { dataStart = body; dataLength = size; break; }
    offset = body + size + (size % 2);
  }
  if (!format || dataStart < 0 || format.audio_format !== 1 || format.channels !== 1 || format.sample_rate !== 16000 || format.bits_per_sample !== 16) return fail("AUDIO_FORMAT_INVALID");
  const durationSeconds = dataLength / (format.sample_rate * format.channels * format.bits_per_sample / 8);
  const max = Number(options.max_duration_seconds);
  const min = Number(options.min_duration_seconds);
  if (Number.isFinite(max) && durationSeconds > max + 0.001) return fail("AUDIO_TOO_LONG");
  if (Number.isFinite(min) && durationSeconds < min) return fail("AUDIO_TOO_SHORT");
  let sum = 0;
  let peak = 0;
  let clips = 0;
  const samples = Math.floor(dataLength / 2);
  for (let index = 0; index < samples; index += 1) {
    const sample = value.readInt16LE(dataStart + index * 2);
    const normalized = sample / 32768;
    sum += normalized * normalized;
    peak = Math.max(peak, Math.abs(normalized));
    if (Math.abs(sample) >= 32760) clips += 1;
  }
  const rms = samples ? Math.sqrt(sum / samples) : 0;
  if (samples < 1 || rms < Number(options.min_rms == null ? 0.008 : options.min_rms)) return fail("AUDIO_SILENT");
  const clippingRatio = samples ? clips / samples : 0;
  if (clippingRatio > Number(options.max_clipping_ratio == null ? 0.25 : options.max_clipping_ratio)) return fail("AUDIO_CLIPPED");
  if (Number.isFinite(Number(options.max_bytes)) && value.length > Number(options.max_bytes)) return fail("AUDIO_TOO_LARGE");
  return { valid: true, duration_seconds: durationSeconds, rms, clipping_ratio: clippingRatio, bytes: value.length };
}

module.exports = {
  PASS_LINE,
  TRACKS,
  MODES,
  normalizeMode,
  normalizeToken,
  tokenizeReference,
  referenceWords,
  normalizeSegment,
  normalizeMaterial,
  enabledTracks,
  trackSegments,
  trainingSegments,
  safeTrackMaterial,
  stableReferenceHash,
  matchTag,
  alignProviderWords,
  wordStatesFromEvidence,
  scoreFromEvidence,
  createProgress,
  progressSummary,
  applyTake,
  continueSegment,
  toImproveQueue,
  duplicateKey,
  validateWav,
};
