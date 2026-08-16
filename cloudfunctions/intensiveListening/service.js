const crypto = require("crypto");

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

function normalizedUnitState(value, slotCount) {
  const empty = emptyUnitState(slotCount);
  if (!value || typeof value !== "object") return empty;
  return {
    checks: Math.max(0, Math.min(99, Number(value.checks) || 0)),
    completed: value.completed === true,
    assisted: value.assisted === true,
    correct_positions: empty.correct_positions.map((_, index) => value.correct_positions && value.correct_positions[index] === true),
    last_marks: empty.last_marks.map((_, index) => value.last_marks && value.last_marks[index] === true),
    last_wrong_hashes: empty.last_wrong_hashes.map((_, index) => String(value.last_wrong_hashes && value.last_wrong_hashes[index] || "")),
    replays: Math.max(0, Number(value.replays) || 0),
  };
}

function gradeUnit(unit, entries, previousValue, context, replayDelta = 0) {
  const slots = Array.isArray(unit && unit.slots) ? unit.slots : [];
  if (!slots.length) throw new Error("UNIT_HAS_NO_SLOTS");
  if (!Array.isArray(entries) || entries.length !== slots.length) throw new Error("SLOT_COUNT_MISMATCH");
  const previous = normalizedUnitState(previousValue, slots.length);
  if (previous.completed) {
    return { state: previous, marks: previous.correct_positions, effective: false, alreadyCompleted: true };
  }

  const marks = slots.map((slot, index) => previous.correct_positions[index] || isCorrect(entries[index], slot));
  const hashes = entries.map((entry, index) => entryHash(entry, `${context}:${index}`));
  const effective = previous.checks === 0 || previous.last_marks.some((mark, index) => (
    mark === false && hashes[index] !== previous.last_wrong_hashes[index]
  ));
  const completed = marks.every(Boolean);
  const next = {
    checks: previous.checks + (effective ? 1 : 0),
    completed,
    assisted: false,
    correct_positions: marks,
    last_marks: marks,
    last_wrong_hashes: marks.map((mark, index) => mark ? "" : hashes[index]),
    replays: previous.replays + Math.max(0, Math.min(1000, Number(replayDelta) || 0)),
  };
  return { state: next, marks, effective, alreadyCompleted: false };
}

function revealUnit(unit, previousValue, replayDelta = 0) {
  const slots = Array.isArray(unit && unit.slots) ? unit.slots : [];
  const previous = normalizedUnitState(previousValue, slots.length);
  if (previous.checks < 3) {
    return { allowed: false, remaining: 3 - previous.checks, state: previous };
  }
  return {
    allowed: true,
    remaining: 0,
    state: {
      ...previous,
      completed: true,
      assisted: true,
      correct_positions: Array(slots.length).fill(true),
      last_marks: Array(slots.length).fill(true),
      last_wrong_hashes: Array(slots.length).fill(""),
      replays: previous.replays + Math.max(0, Math.min(1000, Number(replayDelta) || 0)),
    },
    answerText: String(unit.text || ""),
    answers: slots.map((slot) => String(slot.answer || "")),
  };
}

function progressSummary(material, unitStates) {
  const units = Array.isArray(material && material.units) ? material.units : [];
  const states = units.map((unit) => normalizedUnitState(unitStates && unitStates[unit.unit_id], (unit.slots || []).length));
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
  return {
    material_id: String(material.material_id || material.set_id || ""),
    set_id: String(material.set_id || material.material_id || ""),
    title: String(material.title || "Intensive Listening"),
    audio_src: String(material.audio_src || ""),
    content_version: String(material.content_version || "1"),
    unit_count: units.length,
    units: units.map((unit) => ({
      unit_id: String(unit.unit_id || ""),
      speaker: String(unit.speaker || ""),
      start_seconds: Number(unit.start_seconds) || 0,
      end_seconds: Number(unit.end_seconds) || 0,
      slots: (unit.slots || []).map((slot) => ({
        slot_id: String(slot.slot_id || ""),
        prefix: String(slot.prefix || ""),
        suffix: String(slot.suffix || ""),
      })),
    })),
  };
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
  (material.units || []).forEach((unit) => {
    const state = normalizedUnitState(states[unit.unit_id], (unit.slots || []).length);
    unitProgress[unit.unit_id] = {
      checks: state.checks,
      completed: state.completed,
      assisted: state.assisted,
      correct_positions: state.correct_positions,
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
  progressSummary,
  publicMaterial,
  progressScope,
  publicProgress,
};
