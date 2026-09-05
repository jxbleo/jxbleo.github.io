const crypto = require("crypto");
const shadowing = require("./shadowing-service");

function normalizeAnswer(value) {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'");
}

function entryHash(value, context) {
  return crypto.createHash("sha256")
    .update(`${context}\n${normalizeAnswer(value)}`)
    .digest("hex");
}

function acceptedAnswers(slot) {
  const values = Array.isArray(slot && slot.accepted_answers) && slot.accepted_answers.length
    ? slot.accepted_answers
    : [slot && slot.answer];
  return values.map(normalizeAnswer).filter(Boolean);
}

function isCorrect(entry, slot) {
  const normalized = normalizeAnswer(entry);
  return acceptedAnswers(slot).includes(normalized);
}

function practiceMode(unit) {
  const mode = String(unit && unit.practice_mode || "dictation");
  return ["dictation", "listen_only", "skip"].includes(mode) ? mode : "dictation";
}

function normalizedPracticeMode(unit) {
  const mode = practiceMode(unit);
  return mode === "listen_only" ? "context_only" : mode;
}

function isProvided(slot) {
  return String(slot && slot.spelling_requirement || "required") === "provided";
}

function dictationUnits(material) {
  return (Array.isArray(material && material.units) ? material.units : [])
    .filter((unit) => practiceMode(unit) === "dictation");
}

function emptyUnitState(slotCount) {
  return {
    checks: 0,
    completed: false,
    assisted: false,
    correct_positions: Array(slotCount).fill(false),
    last_marks: Array(slotCount).fill(false),
    last_wrong_hashes: Array(slotCount).fill(""),
    replays: 0,
  };
}

function hasLegacyAssistedAllCorrect(value, slotCount) {
  if (!value || value.assisted !== true || Number(value.reveal_position_version) >= 2 || slotCount < 1) return false;
  return Array.from({ length: slotCount }, (_, index) => (
    value.correct_positions && value.correct_positions[index] === true
  )).every(Boolean);
}

function normalizedUnitState(value, slotCount) {
  const empty = emptyUnitState(slotCount);
  if (!value || typeof value !== "object") return empty;
  const legacyAssistedAllCorrect = hasLegacyAssistedAllCorrect(value, slotCount);
  return {
    checks: Math.max(0, Math.min(99, Number(value.checks) || 0)),
    completed: value.completed === true,
    assisted: value.assisted === true,
    reveal_position_version: Math.max(0, Number(value.reveal_position_version) || 0),
    correct_positions: empty.correct_positions.map((_, index) => (
      !legacyAssistedAllCorrect && value.correct_positions && value.correct_positions[index] === true
    )),
    last_marks: empty.last_marks.map((_, index) => (
      !legacyAssistedAllCorrect && value.last_marks && value.last_marks[index] === true
    )),
    last_wrong_hashes: empty.last_wrong_hashes.map((_, index) => (
      legacyAssistedAllCorrect ? "" : String(value.last_wrong_hashes && value.last_wrong_hashes[index] || "")
    )),
    replays: Math.max(0, Number(value.replays) || 0),
  };
}

function normalizedStateForUnit(value, unit) {
  const slots = Array.isArray(unit && unit.slots) ? unit.slots : [];
  const state = normalizedUnitState(value, slots.length);
  slots.forEach((slot, index) => {
    if (isProvided(slot)) {
      state.correct_positions[index] = true;
      state.last_marks[index] = true;
      state.last_wrong_hashes[index] = "";
    }
  });
  if (slots.length && state.correct_positions.every(Boolean)) state.completed = true;
  return state;
}

function gradeUnit(unit, entries, previousValue, context, replayDelta = 0) {
  const slots = Array.isArray(unit && unit.slots) ? unit.slots : [];
  if (!slots.length) throw new Error("UNIT_HAS_NO_SLOTS");
  if (!Array.isArray(entries) || entries.length !== slots.length) throw new Error("SLOT_COUNT_MISMATCH");
  const previous = normalizedStateForUnit(previousValue, unit);
  if (previous.completed) {
    return { state: previous, marks: previous.correct_positions, effective: false, alreadyCompleted: true };
  }

  const marks = slots.map((slot, index) => isProvided(slot) || previous.correct_positions[index] || isCorrect(entries[index], slot));
  const hashes = entries.map((entry, index) => isProvided(slots[index]) ? "" : entryHash(entry, `${context}:${index}`));
  const effective = previous.checks === 0 || previous.last_marks.some((mark, index) => (
    mark === false && hashes[index] !== previous.last_wrong_hashes[index]
  ));
  const completed = marks.every(Boolean);
  const next = {
    checks: previous.checks + (effective ? 1 : 0),
    completed,
    assisted: previous.assisted === true,
    correct_positions: marks,
    last_marks: marks,
    last_wrong_hashes: marks.map((mark, index) => mark ? "" : hashes[index]),
    replays: previous.replays + Math.max(0, Math.min(1000, Number(replayDelta) || 0)),
  };
  return { state: next, marks, effective, alreadyCompleted: false };
}

function revealUnit(unit, previousValue, replayDelta = 0) {
  const slots = Array.isArray(unit && unit.slots) ? unit.slots : [];
  const previous = normalizedStateForUnit(previousValue, unit);
  if (previous.checks < 3) {
    return { allowed: false, remaining: 3 - previous.checks, state: previous };
  }
  return {
    allowed: true,
    remaining: 0,
    state: {
      ...previous,
      completed: false,
      assisted: true,
      reveal_position_version: 2,
      replays: previous.replays + Math.max(0, Math.min(1000, Number(replayDelta) || 0)),
    },
    answerText: String(unit.text || ""),
    answers: slots.map((slot) => String(slot.answer || "")),
  };
}

function progressSummary(material, unitStates) {
  const units = dictationUnits(material);
  const states = units.map((unit) => normalizedStateForUnit(unitStates && unitStates[unit.unit_id], unit));
  const completed = states.filter((state) => state.completed).length;
  const assisted = states.filter((state) => state.completed && state.assisted).length;
  const independent = completed - assisted;
  const replays = states.reduce((sum, state) => sum + state.replays, 0);
  return {
    unit_count: units.length,
    completed_count: completed,
    independent_count: independent,
    assisted_count: assisted,
    replay_count: replays,
    percentage: units.length ? Math.round(completed / units.length * 100) : 0,
  };
}

function publicMaterial(material) {
  const units = Array.isArray(material && material.units) ? material.units : [];
  const dictation = dictationUnits(material);
  const output = {
    material_id: String(material.material_id || material.set_id || ""),
    set_id: String(material.set_id || material.material_id || ""),
    title: String(material.title || "Intensive Listening"),
    source_label: String(material.source_label || ""),
    series_label: String(material.series_label || ""),
    published_on: String(material.published_on || ""),
    audio_src: String(material.audio_src || material.audioSrc || material.media && (material.media.src || material.media.audio_src || material.media.audioSrc) || ""),
    content_version: String(material.content_version || "1"),
    policy_revision: Math.max(1, Number(material.policy_revision) || 1),
    unit_count: dictation.length,
    sequence_count: units.length,
    units: units.map((unit) => ({
      unit_id: String(unit.unit_id || ""),
      speaker: String(unit.speaker || ""),
      start_seconds: Number(unit.start_seconds) || 0,
      end_seconds: Number(unit.end_seconds) || 0,
      practice_mode: practiceMode(unit),
      slots: (unit.slots || []).map((slot) => ({
        slot_id: String(slot.slot_id || ""),
        prefix: String(slot.prefix || ""),
        suffix: String(slot.suffix || ""),
        spelling_requirement: isProvided(slot) ? "provided" : "required",
        provided_text: isProvided(slot) ? String(slot.answer || "") : "",
      })),
    })),
  };
  // V2 fields are additive so existing Dictation clients and compatibility
  // URLs keep working while new Listening clients can select a Track. The
  // full reviewed text and Shadowing reference words remain server-only.
  const normalized = shadowing.normalizeMaterial(material);
  output.schema_version = normalized.schema_version;
  output.media = { ...normalized.media };
  output.transcript_revision = normalized.transcript_revision;
  output.linked_practice_set_id = normalized.linked_practice_set_id;
  output.tracks = {};
  ["dictation", "shadowing"].forEach((track) => {
    const source = normalized.tracks[track];
    const training = shadowing.trainingSegments(normalized, track);
    output.tracks[track] = {
      enabled: Boolean(source && source.enabled),
      revision: source && source.revision || "1",
      segment_count: training.length,
      segments: shadowing.trackSegments(normalized, track).map((segment) => {
        const safe = {
          segment_id: segment.segment_id,
          start_seconds: segment.start_seconds,
          end_seconds: segment.end_seconds,
          speaker: segment.speaker,
          practice_mode: normalizedPracticeMode(segment),
        };
        if (track === "dictation") {
          safe.slots = (segment.slots || []).map((slot) => ({
            slot_id: String(slot.slot_id || ""),
            prefix: String(slot.prefix || ""),
            suffix: String(slot.suffix || ""),
            spelling_requirement: isProvided(slot) ? "provided" : "required",
            provided_text: isProvided(slot) ? String(slot.answer || "") : "",
          }));
        }
        return safe;
      }),
    };
  });
  return output;
}

function sourceMaterial(material) {
  const secondsClock = (value) => {
    const milliseconds = Math.max(0, Math.round((Number(value) || 0) * 1000));
    const hours = Math.floor(milliseconds / 3600000);
    const minutes = Math.floor(milliseconds % 3600000 / 60000);
    const seconds = Math.floor(milliseconds % 60000 / 1000);
    const millis = milliseconds % 1000;
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":")
      + "." + String(millis).padStart(3, "0");
  };
  const output = {
    schemaVersion: 1,
    materialId: String(material.material_id || material.set_id || ""),
    sourceSetId: String(material.source_set_id || material.set_id || "").replace(/^IL-/, ""),
    title: String(material.title || ""),
    audioSrc: String(material.audio_src || material.audioSrc || material.media && (material.media.src || material.media.audio_src || material.media.audioSrc) || ""),
    contentVersion: String(material.content_version || "1"),
    policyRevision: Math.max(1, Number(material.policy_revision) || 1),
    segments: (material.units || []).map((unit) => {
      const output = {
        speaker: String(unit.speaker || ""),
        text: String(unit.text || ""),
        timestamp: `${secondsClock(unit.start_seconds)}-${secondsClock(unit.end_seconds)}`,
        practiceMode: normalizedPracticeMode(unit),
      };
      const provided = (unit.slots || []).map((slot, index) => isProvided(slot) ? index + 1 : 0).filter(Boolean);
      if (provided.length) output.providedWordPositions = provided;
      return output;
    }),
  };
  const normalized = shadowing.normalizeMaterial(material);
  if (normalized.schema_version >= 2 || material && material.tracks) {
    output.schemaVersion = 2;
    output.media = { ...normalized.media };
    output.transcriptRevision = normalized.transcript_revision;
    output.linkedPracticeSetId = normalized.linked_practice_set_id;
    output.tracks = {};
    ["dictation", "shadowing"].forEach((track) => {
      const source = normalized.tracks[track];
      output.tracks[track] = {
        enabled: Boolean(source && source.enabled),
        revision: source && source.revision || "1",
        segments: shadowing.trackSegments(normalized, track).map((segment) => {
          const item = {
            segmentId: segment.segment_id,
            timestamp: `${secondsClock(segment.start_seconds)}-${secondsClock(segment.end_seconds)}`,
            speaker: segment.speaker,
            text: segment.text,
            practiceMode: normalizedPracticeMode(segment),
          };
          if (track === "dictation") {
            item.slots = (segment.slots || []).map((slot) => ({
              slotId: slot.slot_id,
              prefix: slot.prefix || "",
              suffix: slot.suffix || "",
              answer: slot.answer || "",
              acceptedAnswers: slot.accepted_answers || [],
              spellingRequirement: isProvided(slot) ? "provided" : "required",
            }));
          } else {
            item.referenceWords = shadowing.referenceWords(segment).map((word) => ({
              wordId: word.word_id,
              text: word.text,
              unscored: word.unscored === true,
            }));
          }
          return item;
        }),
      };
    });
  }
  return output;
}

function progressScope(material) {
  const materialId = String(material && (material.material_id || material.set_id) || "");
  const version = String(material && material.content_version || "1");
  return version === "1" ? materialId : materialId + "\ncontent_version:" + version;
}

function publicProgress(material, record) {
  const states = record && record.unit_states && typeof record.unit_states === "object" ? record.unit_states : {};
  const summary = progressSummary(material, states);
  const unitProgress = {};
  dictationUnits(material).forEach((unit) => {
    const storedState = states[unit.unit_id];
    const state = normalizedStateForUnit(storedState, unit);
    unitProgress[unit.unit_id] = {
      checks: state.checks,
      completed: state.completed,
      assisted: state.assisted,
      correct_positions: state.correct_positions,
      correct_positions_reliable: !hasLegacyAssistedAllCorrect(storedState, (unit.slots || []).length),
      replays: state.replays,
    };
  });
  return {
    ...summary,
    best_percentage: Math.max(summary.percentage, Number(record && record.best_percentage) || 0),
    unit_progress: unitProgress,
  };
}

module.exports = {
  normalizeAnswer,
  entryHash,
  emptyUnitState,
  normalizedUnitState,
  gradeUnit,
  revealUnit,
  practiceMode,
  normalizedPracticeMode,
  isProvided,
  dictationUnits,
  progressSummary,
  publicMaterial,
  sourceMaterial,
  progressScope,
  publicProgress,
  normalizedMaterial: shadowing.normalizeMaterial,
  publicListeningMaterial: shadowing.safeTrackMaterial,
};
