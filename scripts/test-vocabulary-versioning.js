#!/usr/bin/env node

const assert = require("assert");
const {
  assertVocabularyContentVersion,
  buildVocabularyGradingSnapshot,
  gradingKeyFromSessionSnapshot,
} = require("../cloudfunctions/submitAttempt/vocabulary-versioning");

const versionOne = {
  grading_version: "1",
  answers: { "group:1": "old answer" },
  explanations: { "group:1": "old explanation" },
};
const versionTwo = {
  grading_version: "2",
  answers: { "group:1": "new answer" },
  explanations: { "group:1": "new explanation" },
};

assert.throws(
  () => assertVocabularyContentVersion("1", versionTwo),
  /VOCABULARY_CONTENT_OUTDATED/,
  "stale public content must be rejected before grading"
);
assert.strictEqual(assertVocabularyContentVersion("2", versionTwo), "2");

const snapshot = buildVocabularyGradingSnapshot(versionOne, ["group:1"]);
const sessionKey = gradingKeyFromSessionSnapshot({
  grading_version: snapshot.grading_version,
  grading_answers_snapshot: snapshot.answers,
  grading_explanations_snapshot: snapshot.explanations,
});
assert.deepStrictEqual(sessionKey.answers, versionOne.answers);
assert.deepStrictEqual(sessionKey.explanations, versionOne.explanations);
assert.notDeepStrictEqual(sessionKey.answers, versionTwo.answers);

assert.throws(
  () => buildVocabularyGradingSnapshot(versionOne, ["group:2"]),
  /VOCABULARY_TEST_QUESTION_MISMATCH/,
  "unknown question IDs must not enter a grading snapshot"
);
assert.throws(
  () => gradingKeyFromSessionSnapshot({ grading_version: "1" }),
  /VOCABULARY_CONTENT_OUTDATED/,
  "legacy sessions without an answer snapshot must not grade against a newer key"
);

console.log("Vocabulary versioning tests passed.");
