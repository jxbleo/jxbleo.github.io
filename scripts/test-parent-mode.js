#!/usr/bin/env node

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const rules = require("../cloudfunctions/_shared/parent-mode");

assert.equal(rules.normalizeChineseName("  王小美 "), "王小美");
assert.equal(rules.normalizeEnglishName("  Alice   SMITH "), "alice smith");

const shanghaiSunday = new Date("2026-08-16T15:59:59.999Z");
const week = rules.weekPeriod(new Date("2026-08-15T06:00:00Z"));
assert.equal(week.start_at.toISOString(), "2026-08-09T16:00:00.000Z");
assert.equal(week.end_at.toISOString(), shanghaiSunday.toISOString());

const month = rules.monthPeriod(new Date(), "2026-08");
assert.equal(month.start_at.toISOString(), "2026-07-31T16:00:00.000Z");
assert.equal(month.end_at.toISOString(), "2026-08-31T15:59:59.999Z");

const attempts = [
  { attempt_id: "a1", set_id: "set-a", percentage: 40, submitted_at: "2026-08-10T00:00:00Z" },
  { attempt_id: "a2", set_id: "set-a", percentage: 85, submitted_at: "2026-08-11T00:00:00Z" },
  { attempt_id: "a3", set_id: "set-a", percentage: 70, submitted_at: "2026-08-12T00:00:00Z" },
  { attempt_id: "practice", set_id: "set-a", percentage: 100, mode: "vocabulary_practice_timed", submitted_at: "2026-08-13T00:00:00Z" },
];
const summary = rules.attemptSummary(attempts, {
  passing_percentage: 80,
  mastery_percentage: 95,
  mastery_enabled: true,
  cutoff_at: "2026-08-15T00:00:00Z",
});
assert.equal(summary.attempt_count, 3);
assert.equal(summary.best_percentage, 85);
assert.equal(summary.latest_percentage, 70);
assert.equal(summary.status, "qualified");
assert.equal(summary.mastered, false);

const locked = rules.attemptSummary(attempts, {
  passing_percentage: 80,
  mastery_percentage: 95,
  mastery_enabled: true,
  score_locked_at: "2026-08-10T12:00:00Z",
});
assert.equal(locked.best_percentage, 40);
assert.equal(locked.status, "not_qualified");

const categories = rules.assignmentCategories({
  parent_status: "not_qualified",
  due_at: "2026-08-10T00:00:00Z",
}, new Date("2026-08-15T06:00:00Z"));
assert.deepEqual(categories, ["overdue", "this_week"]);
assert.deepEqual(rules.assignmentCategories({
  parent_status: "qualified",
  due_at: "2026-08-20T00:00:00Z",
}, new Date("2026-08-15T06:00:00Z")), ["completed", "upcoming"]);

const ranked = rules.rankMatrixStudents([
  { student_uid: "own", display_name: "Own", ranking_eligible: true, cells: [
    { status: "qualified", best_percentage: 80 },
    { status: "not_qualified", best_percentage: 70 },
  ] },
  { student_uid: "peer-a", display_name: "A", ranking_eligible: true, cells: [
    { status: "qualified", best_percentage: 90 },
    { status: "not_qualified", best_percentage: 60 },
  ] },
  { student_uid: "peer-b", display_name: "B", ranking_eligible: true, cells: [
    { status: "qualified", best_percentage: 80 },
    { status: "not_qualified", best_percentage: 60 },
  ] },
  { student_uid: "partial", display_name: "Partial", ranking_eligible: false, cells: [
    { status: "qualified", best_percentage: 100 },
    { status: "qualified", best_percentage: 100 },
  ] },
], "own");
assert.equal(ranked[0].student_uid, "own", "own child stays fixed even when not first by score");
assert.equal(ranked[1].student_uid, "peer-a", "peer tie is broken by average best score");
assert.equal(ranked[1].rank, 1);
assert.equal(ranked[2].student_uid, "peer-b");
assert.equal(ranked[3].student_uid, "partial", "partial-period members sort after ranked peers");
assert.equal(ranked[3].rank, null);

const root = path.resolve(__dirname, "..");
const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
const page = fs.readFileSync(path.join(root, "parent-mode.html"), "utf8");
const client = fs.readFileSync(path.join(root, "assets/js/parent-mode.js"), "utf8");
assert(home.includes('id="parent-mode-button"'), "homepage exposes Parent Mode entry");
assert(page.includes('id="parent-login-form"') && page.includes('id="parent-matrix-shell"'));
assert(client.includes("data-parent-task") && client.includes("attemptReview"));
assert(!page.includes("Student ID"), "Parent Mode login does not reuse student credentials");

console.log("Parent Mode rule tests passed.");
