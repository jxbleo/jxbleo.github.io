const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  achievementWindow,
  buildAchievementCalendar,
} = require("../cloudfunctions/getDashboard/achievement-calendar");

function dashboardFunctionSource(name) {
  const source = fs.readFileSync(path.join(__dirname, "../assets/js/dashboard.js"), "utf8");
  const start = source.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `${name} should exist in dashboard.js`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} source is incomplete`);
}

function monthLabels(startDate) {
  const buildLabels = vm.runInNewContext(`(${dashboardFunctionSource("achievementMonthLabels")})`, {
    Date,
    Intl,
    escapeHtml: (value) => String(value),
  });
  return Array.from(buildLabels(startDate).matchAll(/<span>([^<]*)<\/span>/g), (match) => match[1]);
}

const oneWeekEdgeLabels = monthLabels(new Date(Date.UTC(2025, 7, 25)));
assert.strictEqual(oneWeekEdgeLabels[0], "", "a one-week leading month should not collide with the next label");
assert.strictEqual(oneWeekEdgeLabels[1], "Sep");

const twoWeekEdgeLabels = monthLabels(new Date(Date.UTC(2025, 7, 18)));
assert.strictEqual(twoWeekEdgeLabels[0], "Aug", "a two-week leading month has enough room for its label");
assert.strictEqual(twoWeekEdgeLabels[2], "Sep");

const now = new Date("2026-08-30T04:00:00.000Z");
const window = achievementWindow(now);
assert.deepStrictEqual(
  { start: window.start_date, today: window.today_date, end: window.end_date },
  { start: "2025-08-25", today: "2026-08-30", end: "2026-08-30" }
);

const calendar = buildAchievementCalendar({
  now,
  sets: [
    { set_id: "BBC-260101", section_id: "bbc", title: "A New Year" },
    { set_id: "VOCAB-01", section_id: "vocabulary", title: "Academic Words" },
    { set_id: "IELTS-01", section_id: "ielts-reading", title: "Reading" },
  ],
  attempts: [
    { attempt_id: "a1", assignment_id: "work-1", set_id: "BBC-260101", percentage: 70, passing_percentage: 80, submitted_at: "2026-08-24T12:00:00Z" },
    { attempt_id: "a2", assignment_id: "work-1", set_id: "BBC-260101", percentage: 80, passing_percentage: 80, submitted_at: "2026-08-25T12:00:00Z" },
    { attempt_id: "a3", assignment_id: "work-1", set_id: "BBC-260101", percentage: 95, passing_percentage: 80, submitted_at: "2026-08-26T12:00:00Z" },
    { attempt_id: "v1", assignment_id: null, set_id: "VOCAB-01", percentage: 90, passing_percentage: 90, submitted_at: "2026-08-26T13:00:00Z" },
    { attempt_id: "v2", assignment_id: null, set_id: "VOCAB-01", percentage: 100, passing_percentage: 90, submitted_at: "2026-08-27T13:00:00Z" },
    { attempt_id: "vp", assignment_id: "practice", set_id: "VOCAB-01", percentage: 100, passed: true, mode: "vocabulary_practice_timed", submitted_at: "2026-08-28T13:00:00Z" },
    { attempt_id: "i1", assignment_id: "ielts", set_id: "IELTS-01", percentage: 100, passed: true, submitted_at: "2026-08-29T13:00:00Z" },
  ],
  compositions: [
    { composition_id: "draft", status: "sentence_training", title: "Draft", completed_at: null },
    { composition_id: "essay", status: "completed", title: "My Community", completed_at: "2026-08-26T15:00:00Z" },
  ],
});

assert.strictEqual(calendar.total_achievements, 3, "one BBC assignment, one self-study vocabulary set, and one corrected writing should count");
assert.strictEqual(calendar.active_days, 2);
assert.deepStrictEqual(calendar.days.map((day) => [day.date, day.count]), [
  ["2026-08-25", 1],
  ["2026-08-26", 2],
]);
assert.strictEqual(calendar.days[0].items[0].result, "80% PASS", "the first qualifying attempt should define the day");
assert.deepStrictEqual(calendar.days[1].items.map((item) => item.type), ["vocabulary", "writing"]);

console.log("Dashboard achievement calendar tests passed.");
