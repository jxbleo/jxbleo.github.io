"use strict";

// Matching never edits OCR text or checks whether the student's answer is correct.
// References stay on the server; only existing sentence IDs leave this module.
const MIN_SCORE = 0.8;
const MIN_MARGIN = 0.15;
const MAX_WORDS = 400;

function words(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/’/g, "'")
    .match(/[a-z0-9]+(?:'[a-z]+)?/g) || [];
}

function similarity(a, b) {
  if (!a.length || !b.length || a.length > MAX_WORDS || b.length > MAX_WORDS) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    const row = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      row.push(Math.min(row[j] + 1, previous[j + 1] + 1, previous[j] + (a[i] !== b[j] ? 1 : 0)));
    }
    previous = row;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function matchRevisionCandidates(items, units) {
  const targets = units.map(unit => ({ id: unit.sentence_id,
    original: words(unit.original), reference: words(unit.reference_revision) }));
  const proposals = new Map();
  const blockedIds = new Set();
  for (const item of items) {
    const text = words(item.recognized_text);
    const ranked = targets.map(target => ({ id: target.id,
      score: Math.max(similarity(text, target.original), similarity(text, target.reference)) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const best = ranked[0];
    item.match_method = item.sentence_id ? "number" : null;
    item.suggested_sentence_ids = ranked.filter(row => row.score > 0).slice(0, 3).map(row => row.id);
    const confident = best && best.score >= MIN_SCORE
      && best.score - (ranked[1] ? ranked[1].score : 0) >= MIN_MARGIN;
    if (item.warnings.includes("DUPLICATE_SENTENCE_NUMBER")) {
      if (item.sentence_id) blockedIds.add(item.sentence_id);
      item.sentence_id = null;
      item.match_method = null;
    } else if (item.sentence_id && confident && best.id !== item.sentence_id) {
      item.sentence_id = null;
      item.match_method = null;
      item.status = "check";
      item.warnings.push("NUMBER_CONTENT_CONFLICT");
    } else if (item.written_number === null && text.length >= 4 && confident
        && item.confidence === "high"
        && item.warnings.every(warning => warning === "MISSING_SENTENCE_NUMBER")) {
      proposals.set(item, best.id);
    }
  }
  // Resolve the whole batch, never let reading order silently win a collision.
  const claims = new Map();
  for (const item of items) {
    const id = item.sentence_id || proposals.get(item);
    if (id) claims.set(id, (claims.get(id) || 0) + 1);
  }
  for (const [item, id] of proposals) {
    if (claims.get(id) !== 1 || blockedIds.has(id)) {
      item.warnings.push("TEXT_MATCH_CONFLICT");
      continue;
    }
    item.sentence_id = id;
    item.status = "mapped";
    item.match_method = "text";
    item.warnings = item.warnings.filter(warning => warning !== "MISSING_SENTENCE_NUMBER");
  }
  return items;
}

module.exports = { matchRevisionCandidates, words, similarity, MIN_SCORE, MIN_MARGIN };
