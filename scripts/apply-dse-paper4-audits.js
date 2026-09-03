#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CANONICAL_PATH = path.join(ROOT, "content", "speaking", "dse-paper4-sets.json");
const AUDIT_DIR = path.join(ROOT, "content", "speaking", "audits", "dse-paper4");
const YEARS = [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2023, 2024, 2025, 2026];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function unwrap(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (!entry.replacement) return entry;
  return {
    set_id: entry.set_id || entry.replacement.set_id,
    source_kind: entry.source_kind || entry.replacement.source_kind,
    exam_year: entry.exam_year || entry.replacement.exam_year,
    paper_version: entry.verified_paper_version || entry.paper_version || entry.replacement.paper_version,
    ...entry.replacement,
    audit: entry.audit || entry.replacement.audit,
  };
}

function recordsForYear(year, document) {
  if (Array.isArray(document)) return document;
  if (year === 2019) return [...document.pp_records, ...document.hidden_mock_records];
  if (Array.isArray(document.records)) return document.records;
  if (Array.isArray(document.replacements)) return document.replacements;
  if (document.replacements && typeof document.replacements === "object") {
    return Object.values(document.replacements);
  }
  throw new Error(`Unsupported audit JSON shape for ${year}`);
}

function sortedByOrder(rows) {
  return [...rows].sort((a, b) => Number(a.order) - Number(b.order));
}

function reverse2014PrintedOrder(record) {
  if (record.exam_year !== 2014 || record.source_kind !== "pp") return record;
  const questions = [...record.part_b.questions]
    .reverse()
    .map((question, index) => ({ ...question, order: index + 1 }));
  return { ...record, part_b: { ...record.part_b, questions } };
}

function stableIdSet(rows, key) {
  return [...new Set(rows.map((row) => row[key]))].sort();
}

function wordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function normalizedSignature(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mergeRecord(current, audited) {
  assert.equal(audited.set_id, current.set_id, `${current.set_id}: stable Set ID changed`);
  assert.deepEqual(
    stableIdSet(audited.part_a.discussion_points, "point_id"),
    stableIdSet(current.part_a.discussion_points, "point_id"),
    `${current.set_id}: Part A stable IDs changed`
  );
  assert.deepEqual(
    stableIdSet(audited.part_b.questions, "question_id"),
    stableIdSet(current.part_b.questions, "question_id"),
    `${current.set_id}: Part B stable IDs changed`
  );

  return {
    ...current,
    title: audited.title,
    source_note: audited.source_note,
    context: audited.context,
    part_a: {
      ...audited.part_a,
      discussion_points: sortedByOrder(audited.part_a.discussion_points),
    },
    part_b: {
      ...audited.part_b,
      questions: sortedByOrder(audited.part_b.questions),
    },
    content_revision: Math.max(Number(current.content_revision || 1), 2),
  };
}

function validate(sets) {
  assert.equal(sets.length, 311, "audited library must retain all 311 records");
  assert.equal(new Set(sets.map((set) => set.set_id)).size, sets.length, "Set IDs must stay unique");

  const pp = sets.filter((set) => set.source_kind === "pp");
  const mocks = sets.filter((set) => set.source_kind === "mock");
  assert.equal(pp.length, 306, "all 306 Past Paper records must remain");
  assert.equal(mocks.length, 5, "all five historical mocks must remain");
  assert.ok(pp.every((set) => set.visible_to_students === true), "Past Paper records stay visible");
  assert.ok(mocks.every((set) => set.visible_to_students === false), "historical mocks stay hidden");

  const paragraphSignatures = new Set();
  for (const set of sets) {
    assert.ok(set.content_revision >= 2, `${set.set_id}: expected audited revision 2 or later`);
    assert.equal(set.part_a.discussion_points.length, 4, `${set.set_id}: expected four Part A points`);
    assert.equal(set.part_b.questions.length, 8, `${set.set_id}: expected eight Part B questions`);
    assert.deepEqual(
      set.part_a.discussion_points.map((row) => row.order),
      [1, 2, 3, 4],
      `${set.set_id}: Part A order must be continuous`
    );
    assert.deepEqual(
      set.part_b.questions.map((row) => row.order),
      [1, 2, 3, 4, 5, 6, 7, 8],
      `${set.set_id}: Part B order must be continuous`
    );
    assert.equal(new Set(set.part_a.discussion_points.map((row) => row.point_id)).size, 4);
    assert.equal(new Set(set.part_b.questions.map((row) => row.question_id)).size, 8);
    assert.ok(set.context && Array.isArray(set.context.body) && set.context.body.length > 0);
    assert.match(set.source_note, /original|adapt|mock|practice/i, `${set.set_id}: source note must disclose adaptation`);
    assert.doesNotMatch(JSON.stringify(set.part_b), /in your (?:view|opinion)/i);
    if (set.source_kind === "pp") {
      const words = wordCount(set.context.body.join(" "));
      assert.ok(words >= 150 && words <= 220, `${set.set_id}: Context has ${words} words`);
      for (const paragraph of set.context.body) {
        const signature = normalizedSignature(paragraph);
        assert.ok(!paragraphSignatures.has(signature), `${set.set_id}: duplicate Context paragraph`);
        paragraphSignatures.add(signature);
      }
    }
  }
}

function main() {
  const write = process.argv.includes("--write");
  const current = readJson(CANONICAL_PATH);
  const replacements = new Map();

  for (const year of YEARS) {
    const auditPath = path.join(AUDIT_DIR, `${year}.json`);
    const document = readJson(auditPath);
    for (const rawEntry of recordsForYear(year, document)) {
      let record = unwrap(rawEntry);
      record = reverse2014PrintedOrder(record);
      assert.ok(record && record.set_id, `${year}: audit record has no set_id`);
      assert.ok(!replacements.has(record.set_id), `${year}: duplicate audited set_id ${record.set_id}`);
      replacements.set(record.set_id, record);
    }
  }

  assert.equal(replacements.size, current.length, "every canonical record needs exactly one audited replacement");
  const currentIds = new Set(current.map((set) => set.set_id));
  for (const setId of replacements.keys()) assert.ok(currentIds.has(setId), `unknown audited set_id ${setId}`);

  const merged = current.map((set) => mergeRecord(set, replacements.get(set.set_id)));
  validate(merged);

  if (write) {
    fs.writeFileSync(CANONICAL_PATH, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`Wrote ${merged.length} audited Speaking Sets to ${path.relative(ROOT, CANONICAL_PATH)}.`);
  } else {
    console.log(`Validated ${merged.length} audited Speaking Sets. Re-run with --write to update the canonical file.`);
  }
}

main();
