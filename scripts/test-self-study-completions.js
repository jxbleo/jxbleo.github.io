#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { summarizeSelfStudyAttempts } = require("../cloudfunctions/getDashboard/self-study-completions");

function attempt(id, percentage, submittedAt, extra = {}) {
  return {
    attempt_id: id,
    set_id: "SET-A",
    percentage,
    display_percentage: percentage,
    passed: percentage >= 80,
    submitted_at: new Date(submittedAt),
    ...extra,
  };
}

function testFirstPassAndBestAttempt() {
  const summary = summarizeSelfStudyAttempts([
    attempt("failed", 60, "2026-08-01T00:00:00.000Z"),
    attempt("first-pass", 82, "2026-08-02T00:00:00.000Z"),
    attempt("best", 96, "2026-08-03T00:00:00.000Z"),
    attempt("latest-low", 75, "2026-08-04T00:00:00.000Z"),
  ], 80);

  assert(summary, "a passed self-study set must create a completion summary");
  assert.equal(summary.attempt_count, 4);
  assert.equal(summary.first_passing.attempt_id, "first-pass");
  assert.equal(summary.completed_at.toISOString(), "2026-08-02T00:00:00.000Z");
  assert.equal(summary.best.attempt_id, "best");
  assert.equal(summary.best_percentage, 96);
  assert.equal(summary.latest.attempt_id, "latest-low");
  assert.equal(summary.latest_percentage, 75);
}

function testPracticeAndAssignmentExclusions() {
  const summary = summarizeSelfStudyAttempts([
    attempt("teacher-notification-practice", 100, "2026-08-01T00:00:00.000Z", {
      mode: "vocabulary_practice_timed",
      passed: true,
    }),
    attempt("assigned", 100, "2026-08-02T00:00:00.000Z", {
      assignment_id: "assignment-1",
      passed: true,
    }),
  ], 80);
  assert.equal(summary, null, "Practice activity and assignment attempts must not become self-study completion");
}

function testAdjustedPassAndThresholdFallback() {
  const adjusted = summarizeSelfStudyAttempts([
    attempt("argue-pass", 70, "2026-08-01T00:00:00.000Z", {
      passed: false,
      adjusted_percentage: 85,
      adjusted_passed: true,
    }),
  ], 80);
  assert(adjusted);
  assert.equal(adjusted.best_percentage, 85);

  const legacy = summarizeSelfStudyAttempts([
    attempt("legacy-pass", 81, "2026-08-01T00:00:00.000Z", { passed: false }),
  ], 80);
  assert(legacy, "legacy rows may fall back to the effective set threshold");
}

function testDashboardIntegrationContract() {
  const backend = fs.readFileSync(path.resolve(__dirname, "../cloudfunctions/getDashboard/index.js"), "utf8");
  const frontend = fs.readFileSync(path.resolve(__dirname, "../assets/js/dashboard.js"), "utf8");
  assert(backend.includes("visibleAssignmentViews.concat(selfStudyViews)"), "self-study completions must use the deduplicated assignment projection");
  assert(backend.includes("representedFinishedAssignmentSetIds"), "a finished assignment must deduplicate the same completed set");
  assert(frontend.includes("function finishedAssignments()"));
  assert(frontend.includes("function studentCalendarAchievementDays()"));
  assert(frontend.includes("action: 'getAchievementCalendar'"), "achievement dates must come from the server-derived calendar rather than browser inference");
  assert(backend.includes("achievement_calendar: buildAchievementCalendar({ attempts, sets, compositions, now })"));
  assert(frontend.includes("var finishedCount = (state.assignments || []).filter"));
}

testFirstPassAndBestAttempt();
testPracticeAndAssignmentExclusions();
testAdjustedPassAndThresholdFallback();
testDashboardIntegrationContract();
console.log("Self-study completion tests passed.");
