"use strict";

// Convert the timestamped JSON used by the waveform corrector into private
// canonical units. This runs only after teacher authentication in teacherAdmin.
function seconds(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parts = String(value || "").trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => part === "" || !Number.isFinite(Number(part)))) throw new Error("LISTENING_CORRECTION_TIME_INVALID");
  const numbers = parts.map(Number);
  return numbers.reduce((total, number) => total * 60 + number, 0);
}

function range(row) {
  if (typeof row.timestamp === "string") {
    const parts = row.timestamp.split(/\s*(?:-->|[–—-])\s*/);
    if (parts.length !== 2) throw new Error("LISTENING_CORRECTION_TIME_INVALID");
    return { start: seconds(parts[0]), end: seconds(parts[1]) };
  }
  return {
    start: seconds(row.startSeconds ?? row.start_seconds ?? row.start),
    end: seconds(row.endSeconds ?? row.end_seconds ?? row.end),
  };
}

const LEADING = new Set(Array.from('"“‘([{'));
const TRAILING = new Set(Array.from('"”’.,!?;:…)]}—–'));

function slotsForText(value, unitId, oldSlots = [], providedPositions = [], preserveOldProvided = true) {
  const words = String(value).trim().split(/\s+/);
  const slots = [];
  let pending = "";
  words.forEach((word) => {
    let left = 0;
    let right = word.length;
    while (left < right && LEADING.has(word[left])) left += 1;
    while (right > left && TRAILING.has(word[right - 1])) right -= 1;
    const answer = word.slice(left, right);
    if (!answer) {
      if (slots.length) slots[slots.length - 1].suffix += word;
      else pending += word;
      return;
    }
    const index = slots.length;
    const previous = oldSlots[index];
    const same = previous && String(previous.answer || "").toLowerCase() === answer.toLowerCase();
    slots.push({
      slot_id: same && previous.slot_id || `${unitId}_w${String(index + 1).padStart(3, "0")}`,
      prefix: pending + word.slice(0, left),
      suffix: word.slice(right),
      answer,
      accepted_answers: same && Array.isArray(previous.accepted_answers) && previous.accepted_answers.length ? previous.accepted_answers : [answer.toLowerCase().replace(/[’‘]/g, "'")],
      spelling_requirement: providedPositions.includes(index + 1) || preserveOldProvided && same && previous.spelling_requirement === "provided" ? "provided" : "required",
    });
    pending = "";
  });
  if (pending && slots.length) slots[slots.length - 1].suffix += pending;
  return slots;
}

function normalizeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "listen_only") return "context_only";
  if (["dictation", "context_only", "skip"].includes(mode)) return mode;
  throw new Error("LISTENING_CORRECTION_MODE_INVALID");
}

function correctedUnits(payload, existingUnits) {
  const rows = Array.isArray(payload) ? payload : payload && payload.segments;
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new Error("LISTENING_CORRECTION_SEGMENTS_INVALID");
  const old = Array.isArray(existingUnits) ? existingUnits : [];
  const byId = new Map(old.map((unit) => [String(unit.unit_id || unit.segment_id), unit]));
  const used = new Set();
  let previousStart = -1;
  const units = rows.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("LISTENING_CORRECTION_SEGMENT_INVALID");
    const timing = range(row);
    const text = String(row.text || row.transcript || "").trim();
    if (!text || text.length > 3000 || !Number.isFinite(timing.start) || !Number.isFinite(timing.end) || timing.start < 0 || timing.end - timing.start < 0.05 || timing.start < previousStart) throw new Error(`LISTENING_CORRECTION_SEGMENT_INVALID:${index + 1}`);
    previousStart = timing.start;
    const explicitId = String(row.unitId || row.unit_id || row.segment_id || "");
    let matched = byId.get(explicitId);
    if (!matched) matched = old.reduce((best, unit) => {
      const overlap = Math.min(timing.end, Number(unit.end_seconds)) - Math.max(timing.start, Number(unit.start_seconds));
      return overlap > best.overlap ? { unit, overlap } : best;
    }, { unit: null, overlap: 0 }).unit;
    if (!matched && old.length === rows.length) matched = old[index];
    let id = matched && String(matched.unit_id || matched.segment_id) || "";
    if (!id || used.has(id)) id = `unit-correction-${String(index + 1).padStart(4, "0")}`;
    while (used.has(id) || byId.has(id) && (!matched || id !== String(matched.unit_id || matched.segment_id))) id += "-new";
    used.add(id);
    const mode = normalizeMode(row.practiceMode || row.practice_mode || matched && matched.practice_mode || "dictation");
    const hasExplicitPositions = Object.prototype.hasOwnProperty.call(row, "providedWordPositions") || Object.prototype.hasOwnProperty.call(row, "provided_word_positions");
    const slotPositions = Array.isArray(row.slots) ? row.slots.map((slot, slotIndex) =>
      String(slot && (slot.spellingRequirement || slot.spelling_requirement) || "") === "provided" ? slotIndex + 1 : 0).filter(Boolean) : [];
    const positions = hasExplicitPositions ? (row.providedWordPositions ?? row.provided_word_positions) : Array.isArray(row.slots) ? slotPositions : [];
    const explicit = hasExplicitPositions || Array.isArray(row.slots);
    if (!Array.isArray(positions) || positions.some((position) => !Number.isInteger(Number(position)) || Number(position) < 1)) throw new Error("LISTENING_CORRECTION_PROVIDED_INVALID");
    const slots = mode === "dictation" ? slotsForText(text, id, matched && matched.slots || [], positions.map(Number), !explicit) : [];
    if (mode === "dictation" && positions.some((position) => Number(position) > slots.length)) throw new Error("LISTENING_CORRECTION_PROVIDED_INVALID");
    if (mode === "dictation" && (!slots.length || slots.length > 120)) throw new Error(`LISTENING_CORRECTION_SLOTS_INVALID:${index + 1}`);
    return {
      unit_id: id, segment_id: id,
      speaker: String(row.speaker || "").trim().slice(0, 120),
      text,
      start_seconds: timing.start,
      end_seconds: timing.end,
      practice_mode: mode,
      slots,
    };
  });
  if (!units.some((unit) => unit.practice_mode === "dictation")) throw new Error("LISTENING_CORRECTION_NO_DICTATION");
  return units;
}

module.exports = { correctedUnits, slotsForText };
