#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { canonicalRevisionScanResult } = require("../cloudfunctions/writingTutor")._test;
const { words, similarity } = require("../cloudfunctions/writingTutor/revision-matching");
const sentences = [
  { sentence_id: "s001", original: "Yesterday she go to the library with her sister.", reference_revision: "Yesterday she went to the library with her sister.", rewrite_required: true },
  { sentence_id: "s002", original: "Check our social media constantly!", reference_revision: "Keep an eye on our social media for updates!", rewrite_required: true },
  { sentence_id: "s003", original: "We enjoy reading books together after school.", reference_revision: "We enjoy reading books together after school.", rewrite_required: false },
  { sentence_id: "s004", original: "The concert begins at seven on Friday evening.", reference_revision: "The concert begins at seven on Friday evening.", rewrite_required: true },
];
const composition = { composition_id: "test", revision: 1, language_review: { sentences }, rewrite_results: { results: [{ sentence_id: "s004", accepted: true }] } };
const item = (recognized_text, extra = {}) => ({ written_number: null, recognized_text, confidence: "high", warnings: [], ...extra });
const scan = (items, source = composition) => canonicalRevisionScanResult({ items }, source, "test-student", "test-operation", null);
let result = scan([item("Yesterday she went to the library with her sister."), item("Keep an eye on our social media for updates!")]);
assert.deepStrictEqual(result.items.map(row => [row.sentence_id, row.status, row.match_method]), [["s001", "mapped", "text"], ["s002", "mapped", "text"]]);
assert(result.items.every(row => !row.warnings.includes("MISSING_SENTENCE_NUMBER")));
assert.strictEqual(result.unresolved_items.length, 0);
assert.deepStrictEqual(result.missing_sentence_ids, []);
assert(!JSON.stringify(result).includes("reference_revision"), "reference answers must not enter scan candidates");
assert.strictEqual(similarity(words("STUDENT’S book!"), words("student's book")), 1);

for (const extra of [{ confidence: "medium" }, { confidence: "low" }, { warnings: ["unclear handwriting"] }, { written_number: 99 }]) {
  assert.strictEqual(scan([item(sentences[0].reference_revision, extra)]).items[0].sentence_id, null);
}
assert.strictEqual(scan([item("Keep an eye")]).items[0].sentence_id, null, "short fragments must abstain");
assert.strictEqual(scan([item("")]).items[0].sentence_id, null);
assert.strictEqual(scan([item(sentences[2].original), item(sentences[3].original)]).items.filter(row => row.sentence_id).length, 0, "effective and accepted sentences are ineligible");

result = scan([item(sentences[1].reference_revision, { written_number: 1 })]);
assert.strictEqual(result.items[0].sentence_id, null);
assert(result.items[0].warnings.includes("NUMBER_CONTENT_CONFLICT"));
assert.strictEqual(result.items[0].suggested_sentence_ids[0], "s002");

for (const items of [
  [item(sentences[0].reference_revision), item(sentences[0].original)],
  [item(sentences[0].reference_revision), item(sentences[0].original, { written_number: 1 })],
  [item(sentences[0].original, { written_number: 1 }), item(sentences[0].reference_revision, { written_number: 1 }), item(sentences[0].original)],
]) {
  const forward = scan(items).items;
  const backward = scan(items.slice().reverse()).items.slice().reverse();
  assert.deepStrictEqual(forward.map(row => row.sentence_id), backward.map(row => row.sentence_id), "collisions must be order independent");
  assert(forward.filter(row => row.sentence_id).length <= 1);
  assert(forward.some(row => row.warnings.includes("TEXT_MATCH_CONFLICT")));
}
const ambiguous = { ...composition, language_review: { sentences: [
  { sentence_id: "s001", original: "She visited the library with her sister yesterday.", rewrite_required: true },
  { sentence_id: "s002", original: "She visited the library with her brother yesterday.", rewrite_required: true },
] } };
assert.strictEqual(scan([item(ambiguous.language_review.sentences[0].original)], ambiguous).items[0].sentence_id, null, "near ties must abstain even with an exact best match");
result = scan([item("Illegible fragment.", { written_number: 1, confidence: "medium" })]);
assert.strictEqual(result.items[0].status, "check");
assert.strictEqual(result.items[0].sentence_id, "s001", "number mapping still provides a reviewable target");
console.log("Writing revision matching: references, eligibility, OCR uncertainty, fragments, ambiguity, and order-independent conflicts passed.");
