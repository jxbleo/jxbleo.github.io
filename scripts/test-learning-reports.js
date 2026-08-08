#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const reports = require("../cloudfunctions/_shared/learning-reports");

const root = path.resolve(__dirname, "..");

function student(uid, name, extra = {}) {
  return {
    auth_uid: uid,
    student_id: `${uid}-login`,
    name,
    role: "student",
    active: true,
    ...extra,
  };
}

function membership(uid, startedAt, extra = {}) {
  return {
    membership_id: `${uid}-membership`,
    student_uid: uid,
    class_id: "class-a",
    active: true,
    started_at: startedAt,
    ended_at: null,
    ...extra,
  };
}

function assignment(uid, id, taskId, setId, dueAt) {
  return {
    _id: id,
    assignment_id: id,
    assignment_scope: "class",
    class_id: "class-a",
    class_task_id: taskId,
    student_uid: uid,
    set_id: setId,
    due_at: dueAt,
    status: "to_do",
  };
}

function attempt(uid, assignmentId, setId, submittedAt, extra = {}) {
  return {
    attempt_id: `${uid}-${assignmentId || setId}-${new Date(submittedAt).getTime()}`,
    student_uid: uid,
    assignment_id: assignmentId,
    set_id: setId,
    submitted_at: submittedAt,
    passed: true,
    mode: "default",
    ...extra,
  };
}

function testShanghaiPeriods() {
  const mondayShanghai = new Date("2026-08-02T16:05:00.000Z"); // Monday 00:05 in Shanghai.
  const weekly = reports.periodForDate("weekly", mondayShanghai);
  assert.equal(weekly.period_key, "2026-W32");
  assert.equal(weekly.start_at.toISOString(), "2026-08-02T16:00:00.000Z");
  assert.equal(weekly.end_at.toISOString(), "2026-08-09T15:59:59.999Z");
  assert.equal(reports.previousPeriod(weekly).period_key, "2026-W31");

  const monthly = reports.periodForDate("monthly", mondayShanghai);
  assert.equal(monthly.period_key, "2026-08");
  assert.equal(monthly.start_at.toISOString(), "2026-07-31T16:00:00.000Z");
  assert.equal(monthly.end_at.toISOString(), "2026-08-31T15:59:59.999Z");
  assert.equal(reports.latestClosedPeriod("weekly", mondayShanghai).period_key, "2026-W31");
  assert.equal(reports.reportIdFor("class-a", weekly), reports.reportIdFor("class-a", weekly));
  assert.match(reports.reportUrlFor("lr-weekly-2026-W32-class-a"), /^reports\.html\?report=/);
}

function snapshotFixture() {
  const period = reports.periodForDate("weekly", new Date("2026-08-01T04:00:00.000Z"));
  const dueAt = period.end_at;
  const startBeforePeriod = new Date("2026-07-01T00:00:00.000Z");
  const students = [
    student("alice", "Alice 王", { chinese_name: "王小美", english_name: "Alice" }),
    student("david", "David 李", { chinese_name: "李大卫", english_name: "David" }),
    student("bob", "Bob 新", { chinese_name: "新同学", english_name: "Bob" }),
    student("carol", "Carol 转", { chinese_name: "转班生", english_name: "Carol" }),
  ];
  const memberships = [
    membership("alice", startBeforePeriod),
    membership("david", startBeforePeriod),
    membership("bob", new Date("2026-07-30T00:00:00.000Z")),
    membership("carol", startBeforePeriod, { ended_at: new Date("2026-07-31T00:00:00.000Z") }),
  ];
  const assignments = [
    assignment("alice", "a-1", "task-1", "BBC-1", dueAt),
    assignment("david", "d-1", "task-1", "BBC-1", dueAt),
    assignment("alice", "a-2", "task-2", "IELTS-R-1", dueAt),
    assignment("alice", "a-3", "task-3", "BBC-1", dueAt),
    assignment("david", "d-2", "task-2", "IELTS-R-1", dueAt),
    assignment("bob", "b-1", "task-1", "BBC-1", dueAt),
    assignment("carol", "c-1", "task-1", "BBC-1", dueAt),
  ];
  const attempts = [
    attempt("alice", "a-1", "BBC-1", new Date("2026-07-28T02:00:00.000Z")),
    attempt("david", "d-1", "BBC-1", new Date("2026-07-28T02:00:00.000Z")),
    attempt("alice", "a-2", "IELTS-R-1", new Date("2026-07-29T02:00:00.000Z")),
    attempt("alice", "a-3", "BBC-1", new Date(period.end_at.getTime() + 1)),
    attempt("david", "d-2", "IELTS-R-1", new Date("2026-07-29T02:00:00.000Z")),
    attempt("alice", null, "SELF-V", new Date("2026-07-30T02:00:00.000Z"), { mode: "vocabulary_test" }),
    attempt("alice", null, "SELF-V", new Date("2026-07-31T02:00:00.000Z"), { mode: "vocabulary_practice_timed" }),
    attempt("bob", "b-1", "BBC-1", new Date(period.end_at.getTime() + 1)),
  ];
  const sets = [
    { set_id: "BBC-1", title: "BBC", section_id: "bbc-six-minute-english" },
    { set_id: "IELTS-R-1", title: "Reading", section_id: "ielts-reading" },
    { set_id: "SELF-V", title: "Words", section_id: "vocabulary" },
  ];
  return { period, students, memberships, assignments, attempts, sets };
}

function testSnapshotRules() {
  const fixture = snapshotFixture();
  const snapshot = reports.buildReportSnapshot({
    class_id: "class-a",
    cutoff_at: fixture.period.end_at,
    existing_report: {
      student_details: [{
        student_uid: "alice",
        teacher_comment: "Keep the momentum.",
        teacher_goals: ["Read one BBC lesson"],
      }],
    },
    previous_report: {
      status: "published",
      student_details: [{
        student_uid: "alice",
        class_task_summary: { completed_class_item_count: 1 },
      }],
    },
    ...fixture,
  });
  const alice = snapshot.student_details.find((detail) => detail.student_uid === "alice");
  const bob = snapshot.student_details.find((detail) => detail.student_uid === "bob");
  const carol = snapshot.student_details.find((detail) => detail.student_uid === "carol");
  assert.equal(alice.class_task_summary.completed_class_item_count, 3, "a prior countable pass for the same set completes later Class Task participation immediately");
  assert.equal(alice.class_task_summary.assigned_class_item_count, 3);
  assert.equal(alice.self_study.completed_self_study_item_count, 1);
  assert.equal(alice.actual_activity.countable_attempt_count, 3, "timed Vocabulary practice is excluded");
  assert.equal(alice.delta_completed_class_item_count, 2, "deltas are integer item counts only");
  assert.equal(alice.teacher_comment, "Keep the momentum.", "preview comments survive refreshes");
  assert.deepEqual(alice.teacher_goals, ["Read one BBC lesson"]);
  assert.equal(bob.ranking_eligible, false, "mid-period entrants are not ranked");
  assert.equal(carol.ranking_eligible, false, "mid-period transfers out are not ranked");
  assert.equal(snapshot.leaderboard.length, 2);
  assert.equal(snapshot.leaderboard[0].rank, 1);
  assert.equal(snapshot.leaderboard[1].rank, 2);
  assert(snapshot.leaderboard.every((row) => row.self_study_completed_count === 0 || row.student_uid === "alice"));
  assert.equal(Object.hasOwn(alice.actual_activity, "average_percentage"), false, "no cross-family score average is produced");
  assert.equal(alice.actual_activity.families.some((family) => family.family === "ielts-reading"), true);

  const publicRows = reports.publicLeaderboard(snapshot.leaderboard);
  assert.equal(Object.hasOwn(publicRows[0], "student_uid"), false, "other students never receive UID values in the leaderboard");
  assert.equal(Object.hasOwn(reports.studentDetailView(alice), "student_uid"), false, "student detail is UID-redacted");
}

function testMonthlyLateCompletionUsesReportCutoff() {
  const monthlyPeriod = reports.periodForDate("monthly", new Date("2026-07-15T04:00:00.000Z"));
  const weeklyPeriod = reports.periodForDate("weekly", new Date("2026-07-08T04:00:00.000Z"));
  const dueAt = new Date("2026-07-12T15:59:59.999Z");
  const passedAt = new Date("2026-07-20T02:00:00.000Z");
  const options = {
    class_id: "class-a",
    students: [student("alice", "Alice 王")],
    memberships: [membership("alice", new Date("2026-06-01T00:00:00.000Z"))],
    assignments: [assignment("alice", "late-1", "late-task", "BBC-1", dueAt)],
    attempts: [attempt("alice", "late-1", "BBC-1", passedAt)],
    sets: [{ set_id: "BBC-1", title: "BBC", section_id: "bbc-six-minute-english" }],
  };
  const weekly = reports.buildReportSnapshot({ ...options, period: weeklyPeriod, cutoff_at: weeklyPeriod.end_at });
  const monthly = reports.buildReportSnapshot({ ...options, period: monthlyPeriod, cutoff_at: monthlyPeriod.end_at });
  assert.equal(weekly.student_details[0].class_task_summary.completed_class_item_count, 0,
    "the frozen due-week report stays incomplete after its cutoff");
  assert.equal(monthly.student_details[0].class_task_summary.completed_class_item_count, 1,
    "the month report counts a due-month task passed later before month end");
}

function testReportCloseUiContract() {
  const html = fs.readFileSync(path.join(root, "reports.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "assets/js/reports.js"), "utf8");
  assert.match(html, /id="reports-close-button"[^>]*hidden/, "report reader includes a hidden-until-open close action");
  assert.match(script, /closeButton\.addEventListener\('click'/, "close action has an interaction handler");
  assert.match(script, /selectReport\('', \{ focus: true \}\)/, "close action clears selection and restores list focus");
  assert.match(script, /renderReportChooser\(\)/, "closing an available report renders the chooser rather than an empty-data state");
}

async function testVisitorStaysOnBlankReportPage() {
  const script = fs.readFileSync(path.join(root, "assets/js/reports.js"), "utf8");
  let redirectTarget = "";
  let reportCalls = 0;
  const makeElement = () => ({
    handlers: {}, innerHTML: "Loading…", textContent: "", hidden: false, disabled: false, href: "",
    classList: { toggle() {} },
    setAttribute() {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
  });
  const elements = Object.fromEntries([
    "reports-list", "reports-content", "reports-feedback", "reports-latest-button",
    "reports-refresh-button", "reports-close-button", "reports-print-button",
    "reports-logout-button", "reports-return-link", "reports-subtitle",
  ].map((id) => [id, makeElement()]));
  const returnLabel = makeElement();
  elements["reports-return-link"].querySelector = (selector) => selector === "span" ? returnLabel : null;
  const location = {
    href: "https://example.test/reports.html?report=private-report",
    pathname: "/reports.html",
    search: "?report=private-report",
    hash: "",
    replace(target) { redirectTarget = target; },
  };
  const windowObject = {
    location,
    history: { pushState() {}, replaceState() {} },
    addEventListener() {},
    setTimeout,
    confirm() { return false; },
    print() {},
    MrCatAuth: {
      getSession() { return Promise.resolve({ mode: "visitor", profile: null }); },
      logout() {},
    },
    MrCatCloud: {
      callFunction() {
        reportCalls += 1;
        return Promise.resolve({ success: true });
      },
    },
  };
  const context = {
    window: windowObject,
    document: {
      title: "",
      getElementById(id) { return elements[id]; },
      createElement() { return makeElement(); },
      body: { appendChild() {} },
    },
    navigator: {}, URL, URLSearchParams, Intl, Date, Promise, Object, Array, String,
    Number, Math, isFinite, setTimeout, clearTimeout, console,
  };
  vm.runInNewContext(script, context, { filename: "assets/js/reports.js" });
  for (let index = 0; index < 6; index += 1) await Promise.resolve();

  assert.equal(redirectTarget, "", "visitor report view must not redirect to login");
  assert.equal(reportCalls, 0, "visitor report view must not request private report data");
  assert.equal(elements["reports-list"].innerHTML, "", "visitor report list stays blank");
  assert.equal(elements["reports-content"].innerHTML, "", "visitor report surface stays blank");
  assert.equal(elements["reports-logout-button"].hidden, true, "blank visitor view does not show a sign-out action");
  assert.equal(elements["reports-return-link"].href, "dashboard.html", "visitor can return to the Dashboard");
}

async function testCloseIgnoresStaleReportRequest() {
  const script = fs.readFileSync(path.join(root, "assets/js/reports.js"), "utf8");
  let resolveReport;
  let firstReportFocused = false;
  const listeners = {};
  const makeElement = () => ({
    handlers: {}, innerHTML: "", textContent: "", hidden: true, disabled: false, href: "",
    classList: { toggle() {} },
    setAttribute() {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
  });
  const elements = Object.fromEntries([
    "reports-list", "reports-content", "reports-feedback", "reports-latest-button",
    "reports-refresh-button", "reports-close-button", "reports-print-button",
    "reports-logout-button", "reports-return-link", "reports-subtitle",
  ].map((id) => [id, makeElement()]));
  const firstReportButton = makeElement();
  firstReportButton.focus = () => { firstReportFocused = true; };
  elements["reports-list"].querySelector = (selector) => selector === "[data-report-id]" ? firstReportButton : null;
  const returnLabel = makeElement();
  elements["reports-return-link"].querySelector = (selector) => selector === "span" ? returnLabel : null;

  const location = {
    href: "https://example.test/reports.html",
    pathname: "/reports.html",
    search: "",
    hash: "",
    replace() {},
  };
  function setLocation(url) {
    const next = new URL(url, location.href);
    location.href = next.href;
    location.pathname = next.pathname;
    location.search = next.search;
    location.hash = next.hash;
  }
  const windowObject = {
    location,
    history: {
      pushState(_state, _title, url) { setLocation(url); },
      replaceState(_state, _title, url) { setLocation(url); },
    },
    addEventListener(type, handler) { listeners[type] = handler; },
    setTimeout,
    confirm() { return false; },
    print() {},
    MrCatAuth: {
      getSession() { return Promise.resolve({ mode: "teacher" }); },
      logout() {},
    },
    MrCatCloud: {
      callFunction(_name, data) {
        if (data.action === "listReports") {
          return Promise.resolve({
            success: true,
            role: "teacher",
            reports: [{ report_id: "report-one", class_name: "Class A", period_type: "weekly" }],
            classes: [],
          });
        }
        if (data.action === "getReport") {
          return new Promise((resolve) => { resolveReport = resolve; });
        }
        return Promise.resolve({ success: true });
      },
    },
  };
  const context = {
    window: windowObject,
    document: {
      title: "",
      getElementById(id) { return elements[id]; },
      createElement() { return makeElement(); },
      body: { appendChild() {} },
    },
    navigator: {}, URL, URLSearchParams, Intl, Date, Promise, Object, Array, String,
    Number, Math, isFinite, setTimeout, clearTimeout, console,
  };
  vm.runInNewContext(script, context, { filename: "assets/js/reports.js" });
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
  assert.equal(typeof resolveReport, "function", "initial report request is waiting");
  assert.equal(elements["reports-close-button"].hidden, false, "close is available during loading");

  elements["reports-close-button"].handlers.click();
  await Promise.resolve();
  resolveReport({
    success: true,
    role: "teacher",
    report: { report_id: "report-one", class_name: "Class A", period_type: "weekly" },
  });
  for (let index = 0; index < 6; index += 1) await Promise.resolve();

  assert.match(elements["reports-content"].innerHTML, /Choose a learning report/, "stale response cannot reopen a closed report");
  assert.equal(new URLSearchParams(location.search).has("report"), false, "close removes the report URL parameter");
  assert.equal(firstReportFocused, true, "close returns keyboard focus to the report list");
  assert.equal(elements["reports-close-button"].hidden, true, "chooser keeps close hidden");
}

async function main() {
  testShanghaiPeriods();
  testSnapshotRules();
  testMonthlyLateCompletionUsesReportCutoff();
  testReportCloseUiContract();
  await testVisitorStaysOnBlankReportPage();
  await testCloseIgnoresStaleReportRequest();
  console.log("Learning report tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
