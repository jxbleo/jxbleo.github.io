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
const bbcPage = fs.readFileSync(path.join(root, "bbc.html"), "utf8");

function readResultToneArray(source, name) {
  const match = source.match(new RegExp(`var ${name} = (\\[[\\s\\S]*?\\n\\s*\\]);`));
  assert(match, `${name} must be declared as a result-tone array`);
  return Function(`"use strict"; return (${match[1]});`)();
}

const expectedFailedTones = [
  { freq: 392, start: 0, duration: 0.42, volume: 0.1, type: "triangle", to: 293.66 },
  { freq: 261.63, start: 0.38, duration: 0.58, volume: 0.125, type: "triangle", to: 174.61 },
  { freq: 130.81, start: 0.43, duration: 0.52, volume: 0.04, type: "sine", to: 98 },
];
const expectedPassedTones = [
  { freq: 392, start: 0, duration: 0.13, volume: 0.11 },
  { freq: 523.25, start: 0.11, duration: 0.14, volume: 0.13 },
  { freq: 783.99, start: 0.24, duration: 0.28, volume: 0.16 },
];

for (const [label, page] of [["Vocabulary", vocabularyPage], ["BBC", bbcPage]]) {
  assert.deepStrictEqual(
    readResultToneArray(page, "RESULT_SOUND_FAILED_TONES"),
    expectedFailedTones,
    `${label} must use the selected low sad not-passed sound`
  );
  assert.deepStrictEqual(
    readResultToneArray(page, "RESULT_SOUND_PASSED_TONES"),
    expectedPassedTones,
    `${label} must use the selected current passed sound`
  );
  assert.match(
    page,
    /playResultSequence\(state === 'failed' \? RESULT_SOUND_FAILED_TONES : RESULT_SOUND_PASSED_TONES\)/,
    `${label} must map Passed and Mastered to one shared passed sound`
  );
}
assert.match(
  vocabularyPage,
  /document\.body\.appendChild\(overlay\);\s*playResultSound\(state\);/,
  "Vocabulary must play its result sound when the result dialog appears"
);
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

console.log("Vocabulary versioning, result sound, and heartbeat tests passed.");
