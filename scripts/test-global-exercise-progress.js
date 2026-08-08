#!/usr/bin/env node

"use strict";

const assert = require("assert");
const { summarizeExerciseProgress } = require("../cloudfunctions/_shared/exercise-progress");

function attempt(id, percentage, submittedAt, extra = {}) {
  return {
    attempt_id: id,
    student_uid: "student-1",
    set_id: "VOCAB-A",
    mode: "vocabulary_test",
    percentage,
    raw_percentage: percentage,
    submitted_at: new Date(submittedAt),
    ...extra,
  };
}

const first = attempt("assigned-96", 96, "2026-08-07T13:38:07.000Z", {
  assignment_id: "assignment-1",
});
const improved = attempt("resource-100", 100, "2026-08-08T01:04:47.000Z", {
  assignment_id: null,
});
const laterLower = attempt("later-92", 92, "2026-08-09T01:04:47.000Z", {
  assignment_id: null,
});
const timedPractice = attempt("practice-100", 100, "2026-08-10T01:04:47.000Z", {
  mode: "vocabulary_practice_timed",
});

const vocabulary = summarizeExerciseProgress(
  [first, improved, laterLower, timedPractice],
  { passingPercentage: 90, masteryPercentage: 100, masteryEnabled: true }
);
assert.equal(vocabulary.best_percentage, 100);
assert.equal(vocabulary.best_attempt_id, "resource-100");
assert.equal(vocabulary.best_improved_at.toISOString(), improved.submitted_at.toISOString());
assert.equal(vocabulary.latest_attempt_id, "later-92");
assert.equal(vocabulary.latest_percentage, 92);
assert.equal(vocabulary.attempt_count, 3);
assert.equal(vocabulary.status, "mastered");

const tiedLater = attempt("later-100", 100, "2026-08-11T01:04:47.000Z");
const tied = summarizeExerciseProgress(
  [first, improved, tiedLater],
  { passingPercentage: 90, masteryPercentage: 100, masteryEnabled: true }
);
assert.equal(tied.best_attempt_id, "resource-100", "a tied score must not move Finished forward");
assert.equal(tied.best_improved_at.toISOString(), improved.submitted_at.toISOString());

const raisedPassing = summarizeExerciseProgress(
  [first],
  { passingPercentage: 97, masteryPercentage: 100, masteryEnabled: true }
);
assert.equal(raisedPassing.status, "to_do", "Assign uses its selected Passing Rate");
assert.equal(raisedPassing.best_percentage, 96, "existing progress is retained below the new threshold");

const bbcBeforeLock = attempt("bbc-91", 91, "2026-08-01T01:00:00.000Z", {
  set_id: "BBC-260801",
  mode: "bbc",
});
const bbcAfterLock = attempt("bbc-100", 100, "2026-08-03T01:00:00.000Z", {
  set_id: "BBC-260801",
  mode: "bbc",
});
const bbc = summarizeExerciseProgress(
  [bbcBeforeLock, bbcAfterLock],
  {
    passingPercentage: 80,
    masteryPercentage: 95,
    masteryEnabled: true,
    scoreLockedAt: new Date("2026-08-02T01:00:00.000Z"),
  }
);
assert.equal(bbc.best_percentage, 91);
assert.equal(bbc.best_attempt_id, "bbc-91");
assert.equal(bbc.latest_attempt_id, "bbc-100", "post-lock attempts remain immutable history");
assert.equal(bbc.status, "passed");

console.log("Global exercise progress tests passed.");
