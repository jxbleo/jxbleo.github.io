#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
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

const root = path.resolve(__dirname, "..");
const vocabularyPage = fs.readFileSync(path.join(root, "vocabulary.html"), "utf8");
assert.match(
  vocabularyPage,
  /VOCABULARY_HEARTBEAT_RECOVERY_WINDOW_MS\s*=\s*60\s*\*\s*1000/,
  "the browser must allow a 60-second heartbeat recovery window"
);
assert.match(
  vocabularyPage,
  /VOCABULARY_HEARTBEAT_RETRY_DELAYS_MS\s*=\s*\[2\s*\*\s*1000,\s*5\s*\*\s*1000,\s*10\s*\*\s*1000\]/,
  "transient heartbeat failures must use bounded retries"
);
assert.match(
  vocabularyPage,
  /isTerminalHeartbeatError\(error\)/,
  "explicit session errors must remain terminal"
);
assert.match(
  vocabularyPage,
  /Network unstable — reconnecting…/,
  "students must see a reconnecting state during transient failures"
);
assert.doesNotMatch(
  vocabularyPage,
  /callVocabularyTestSession\('heartbeatVocabularyTestSession'[\s\S]{0,240}\.catch\(function\(error\)[\s\S]{0,180}endTestForIntegrity\('heartbeat_failed'/,
  "one raw heartbeat rejection must not immediately interrupt the test"
);

for (const functionName of ["submitAttempt", "getDashboard", "getCurrentStudent", "studentVocabulary"]) {
  const source = fs.readFileSync(path.join(root, "cloudfunctions", functionName, "index.js"), "utf8");
  assert.match(
    source,
    /VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS\s*=\s*60\s*\*\s*1000/,
    `${functionName} must use the shared 60-second heartbeat timeout`
  );
}

console.log("Vocabulary versioning and heartbeat tests passed.");
