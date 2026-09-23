"use strict";

const TRACKS = ["dictation"];
const MODES = ["dictation", "context_only", "skip"];

function text(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeMode(value) {
  const mode = text(value).toLowerCase().replace(/[-\s]+/g, "_");
  if (mode === "listen_only") return "context_only";
  return MODES.includes(mode) ? mode : "dictation";
}

function normalizeSegment(segment, index, track) {
  const raw = segment || {};
  const segmentId = text(raw.segment_id || raw.unit_id) || `${track}_${String(index + 1).padStart(3, "0")}`;
  const sourceMode = normalizeMode(raw.practice_mode || raw.mode);
  const mode = sourceMode;
  const start = Number(raw.start_seconds == null ? raw.start : raw.start_seconds);
  const end = Number(raw.end_seconds == null ? raw.end : raw.end_seconds);
  const output = {
    unit_id: segmentId,
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
  }
  return output;
}

function canonicalUnitsFromMaterial(raw) {
  if (Array.isArray(raw && raw.units) && raw.units.length) {
    return raw.units.map((unit, index) => normalizeSegment(unit, index, "dictation"));
  }
  const dictation = raw && raw.tracks && raw.tracks.dictation;
  if (dictation && Array.isArray(dictation.segments) && dictation.segments.length) {
    // Schema 2 sometimes duplicated the same transcript under two different
    // segment IDs. Dictation is the reviewed source of truth for migration.
    return dictation.segments.map((unit, index) => normalizeSegment(unit, index, "dictation"));
  }
  return [];
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
  const canonicalUnits = canonicalUnitsFromMaterial(raw);
  const sourceRevision = text(
    raw.content_revision || raw.contentRevision || raw.transcript_revision ||
      raw.transcriptRevision || raw.content_version || raw.contentVersion ||
      (explicitTracks && raw.tracks.dictation && raw.tracks.dictation.revision)
  ) || "1";
  const canonicalTrack = {
    enabled: canonicalUnits.some((unit) => normalizeMode(unit.practice_mode) === "dictation"),
    revision: sourceRevision,
    segments: canonicalUnits,
  };
  const tracks = { dictation: canonicalTrack };
  return {
    schema_version: 3,
    material_id: text(raw.material_id || raw.materialId || raw.set_id),
    set_id: text(raw.set_id || raw.material_id || raw.materialId),
    title: text(raw.title) || "Listening",
    source_family: text(raw.source_family || raw.sourceFamily),
    source_label: text(raw.source_label || raw.sourceLabel),
    series_label: text(raw.series_label || raw.seriesLabel),
    published_on: text(raw.published_on || raw.publishedOn),
    media,
    content_revision: sourceRevision,
    transcript_revision: sourceRevision,
    linked_practice_set_id: text(raw.linked_practice_set_id || raw.linkedPracticeSetId) || null,
    publication_status: text(raw.publication_status || raw.publicationStatus) || (raw.visible === false ? "hidden" : "published"),
    published_at: raw.published_at || raw.publishedAt || null,
    dictation_revision: sourceRevision,
    units: canonicalUnits,
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
    normalizeMode(segment.practice_mode) === "dictation"
  ));
}

function validateCanonicalMaterial(material) {
  const normalized = normalizeMaterial(material);
  if (!normalized.units.length) throw new Error("MATERIAL_EMPTY");
  let previousStart = -1;
  const scored = normalized.units.filter((unit) => normalizeMode(unit.practice_mode) === "dictation");
  if (!scored.length) throw new Error("MATERIAL_NO_SCORED_UNITS");
  normalized.units.forEach((unit) => {
    if (!unit.unit_id || !unit.text && normalizeMode(unit.practice_mode) !== "skip") throw new Error("UNIT_TEXT_REQUIRED");
    if (!Number.isFinite(unit.start_seconds) || !Number.isFinite(unit.end_seconds) || unit.end_seconds <= unit.start_seconds) throw new Error("UNIT_TIMING_INVALID");
    // Reviewed ASR units may intentionally overlap at a speaker hand-off. The
    // player clips each unit to its own bounds, so only reverse source order is
    // invalid; overlap itself must not disable practice or effective-time logs.
    if (unit.start_seconds < previousStart) throw new Error("UNIT_TIMING_ORDER");
    previousStart = unit.start_seconds;
    if (normalizeMode(unit.practice_mode) === "dictation") {
      if (!Array.isArray(unit.slots) || !unit.slots.length) throw new Error("DICTATION_SLOTS_REQUIRED");
    }
  });
  return normalized;
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
    content_revision: normalized.content_revision,
    transcript_revision: normalized.transcript_revision,
    units: normalized.units.map((unit) => ({
      unit_id: unit.unit_id,
      start_seconds: unit.start_seconds,
      end_seconds: unit.end_seconds,
      speaker: unit.speaker,
      practice_mode: normalizeMode(unit.practice_mode),
      slots: (unit.slots || []).map((slot) => ({
        slot_id: slot.slot_id,
        prefix: slot.prefix || "",
        suffix: slot.suffix || "",
        spelling_requirement: slot.spelling_requirement === "provided" ? "provided" : "required",
        provided_text: slot.spelling_requirement === "provided" ? slot.answer || "" : "",
      })),
    })),
    linked_practice_set_id: normalized.linked_practice_set_id,
    schema_version: normalized.schema_version,
    modes: {
      dictation: { enabled: normalized.tracks.dictation.enabled },
    },
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

module.exports = { normalizeMode, normalizeMaterial, enabledTracks, trackSegments, trainingSegments, validateCanonicalMaterial, safeTrackMaterial };
