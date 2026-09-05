#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const notifications = require("../cloudfunctions/_shared/intensive-listening-notifications");

const root = path.resolve(__dirname, "..");
const dashboard = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
const libraryHtml = fs.readFileSync(path.join(root, "intensive-listening-library.html"), "utf8");
const libraryJs = fs.readFileSync(path.join(root, "assets/js/intensive-listening-library.js"), "utf8");
const intensiveCss = fs.readFileSync(path.join(root, "assets/css/intensive-listening.css"), "utf8");
const dashboardJs = fs.readFileSync(path.join(root, "assets/js/dashboard.js"), "utf8");
const teacherJs = fs.readFileSync(path.join(root, "assets/js/teacher.js"), "utf8");
const ielts = fs.readFileSync(path.join(root, "ielts-listening.html"), "utf8");

function testDashboardCapsules() {
  assert.match(dashboard, /student-skill-card writing[^>]*aria-label="Writing Space\./);
  assert.match(dashboard, /student-skill-card intensive-listening[^>]*aria-label="Listening Studio\./);
  assert.match(dashboard, /student-skill-card speaking[^>]*aria-label="Speaking Lab for HKDSE Paper 4\./);
  assert.ok(dashboard.indexOf("student-skill-card writing") < dashboard.indexOf("student-skill-card intensive-listening"));
  assert.ok(dashboard.indexOf("student-skill-card intensive-listening") < dashboard.indexOf("student-skill-card speaking"));
  const capsuleMarkup = dashboard.slice(dashboard.indexOf('<section class="student-skill-entries"'), dashboard.indexOf('<section class="student-workspace-confirm-overlay"'));
  assert.match(capsuleMarkup, /student-skill-title">Writing Space</);
  assert.match(capsuleMarkup, /student-skill-title">Listening Studio</);
  assert.match(capsuleMarkup, /student-skill-title">Speaking Lab</);
  assert.match(capsuleMarkup, /student-skill-badge">HKDSE Paper 4</);
  assert.ok(!/data-glyph=|>写<|>听<|>说</.test(capsuleMarkup));
  assert.strictEqual((capsuleMarkup.match(/class="student-skill-icon"/g) || []).length, 3);
  assert.strictEqual((capsuleMarkup.match(/<svg/g) || []).length, 3);
  assert.match(dashboard, /id="student-workspace-confirm-overlay"/);
  assert.match(dashboardJs, /openWorkspaceConfirm\(workspaceCard\)/);
  assert.match(dashboardJs, /window\.location\.assign\(workspaceConfirmHref\)/);
  assert.match(libraryHtml, /Continue Listening/);
  assert.match(libraryHtml, /All Materials/);
  assert.match(libraryHtml, /ill-search/);
  assert.match(libraryHtml, /Newest/);
  assert.match(libraryHtml, /Oldest/);
  assert.match(
    intensiveCss,
    /@media \(max-width: 680px\)[\s\S]*?\.il-header \{ top: max\(10px, env\(safe-area-inset-top\)\);[\s\S]*?margin-top: max\(14px, env\(safe-area-inset-top\)\);/,
    "The phone practice toolbar should match the Writing/Speaking top spacing while retaining the safe area"
  );
  assert.match(teacherJs, /data-open-intensive-event-id/);
  assert.match(teacherJs, /attempt_offset/);
  assert.match(teacherJs, /return !\/\^IL-/);
  assert.match(fs.readFileSync(path.join(root, "assets/js/intensive-listening.js"), "utf8"), /activity_type/);
  assert.ok(!fs.readFileSync(path.join(root, "assets/js/intensive-listening.js"), "utf8").includes("audio_position_seconds"));
  assert.ok(!fs.readFileSync(path.join(root, "assets/js/intensive-listening.js"), "utf8").includes("activity_kind"));
  assert.match(fs.readFileSync(path.join(root, "cloudfunctions/teacherAdmin/index.js"), "utf8"), /listIntensiveThread/);
  const intensiveRuntime = fs.readFileSync(path.join(root, "assets/js/intensive-listening.js"), "utf8");
  const intensiveFunction = fs.readFileSync(path.join(root, "cloudfunctions/intensiveListening/index.js"), "utf8");
  assert.match(intensiveRuntime, /Provide this word for every student/);
  assert.match(intensiveRuntime, /call\('provideWord'/);
  assert.match(intensiveFunction, /provideTeacherWord/);
  assert.match(intensiveFunction, /intensiveSpelling\.provideWord/);
  assert.ok(!intensiveRuntime.includes("activity('replay')"), "Replay clicks must not start a notification session before the playhead moves");
  assert.match(intensiveFunction, /const canStartSession = activityType === "audio_progress";/);
  assert.match(intensiveFunction, /if \(result\.effective\) \{[\s\S]*refreshNotificationSession/,
    "A completed replay check must be able to close the active session immediately");
}

function testSafeCatalogAndSessions() {
  const material = {
    set_id: "IL-BBC-260813",
    material_id: "IL-BBC-260813",
    title: "A safe lesson",
    source_set_id: "BBC-260813",
    units: [
      { unit_id: "u1", start_seconds: 1, end_seconds: 2, text: "private", slots: [{ answer: "private" }] },
      { unit_id: "u2", practice_mode: "skip", slots: [] },
    ],
  };
  const item = notifications.safeCatalogItem(
    { set_id: material.set_id, title: material.title, visible: true, section_id: "intensive-listening" },
    material,
    { percentage: 20, best_percentage: 20, completed_count: 1, updated_at: new Date() },
    null,
    null,
    { publicProgress: () => ({ percentage: 20, best_percentage: 20, completed_count: 1, independent_count: 1, assisted_count: 0, replay_count: 0 }) }
  );
  assert.strictEqual(item.source_label, "BBC");
  assert.strictEqual(item.dictation_unit_count, 1);
  assert.ok(!("units" in item) && !("answers" in item) && !("audio_src" in item) && !("slots" in item));
  assert.strictEqual(notifications.sessionEventId("ils_abc", "started"), "ils_abc::started");
  assert.strictEqual(notifications.sessionEventId("ils_abc", "paused"), "ils_abc::final");
  assert.strictEqual(notifications.sessionDeadline(new Date("2026-08-27T00:00:00Z")).getTime(), new Date("2026-08-27T00:03:00Z").getTime());
  const event = notifications.buildSessionEvent({
    student: { auth_uid: "uid", student_id: "s1", name: "Student" },
    material,
    record: { notification_session_started_at: new Date("2026-08-27T00:00:00Z") },
    sessionId: "ils_abc",
    phase: "completed",
    occurredAt: new Date("2026-08-27T00:01:00Z"),
    startSummary: { percentage: 0, completed_unit_count: 0 },
    endSummary: { percentage: 100, completed_unit_count: 1, independent_unit_count: 1, assisted_unit_count: 0 },
    practiceContext: "self_study",
  });
  assert.strictEqual(event.target_met, true);
  assert.strictEqual(event.status, "pending");
  assert.strictEqual(event.retry_count, 0);
  assert.strictEqual(event.due_at.getTime(), event.occurred_at.getTime());
  assert.ok(!("typed_words" in event) && !("answers" in event) && !("audio_src" in event));

  const started = notifications.buildSessionEvent({
    student: { auth_uid: "uid", student_id: "s1", name: "Student" },
    material,
    record: { notification_session_started_at: new Date("2026-08-27T00:00:00Z") },
    sessionId: "ils_started",
    phase: "started",
    occurredAt: new Date("2026-08-27T00:00:01Z"),
    startSummary: { percentage: 0, completed_unit_count: 0 },
    endSummary: { percentage: 0, completed_unit_count: 0 },
    practiceContext: "review",
  });
  assert.strictEqual(started.target_met, false);
  assert.strictEqual(started.practice_context, "review");
  assert.strictEqual(started.session_ended_at, null);

  const merged = notifications.mergeNotificationFeed(
    [
      { thread_key: "s::assignment::a", submitted_at: "2026-08-27T00:02:00Z" },
      { thread_key: "s::self-study::bbc", submitted_at: "2026-08-27T00:01:00Z" },
    ],
    [
      { thread_key: "s::self-study::il", occurred_at: "2026-08-27T00:03:00Z" },
      { thread_key: "s::assignment::a", occurred_at: "2026-08-27T00:04:00Z" },
    ],
    { limit: 10 }
  );
  assert.deepStrictEqual(merged.thread_keys, ["s::assignment::a", "s::self-study::il", "s::self-study::bbc"]);
  assert.strictEqual(merged.rows.length, 3, "one mixed-feed row per unique thread");
  assert.strictEqual(merged.rows[0].source, "intensive", "the newest event remains the thread representative");
  assert.strictEqual(merged.consumed_attempts, 2);
  assert.strictEqual(merged.consumed_intensive, 2);
}

function testLibraryHelpers() {
  const elements = {};
  ["intensive-listening-library", "ill-material-list", "ill-continue-list", "ill-continue-section", "ill-state", "ill-count", "ill-source-filters", "ill-search", "ill-sort"].forEach((id) => {
    elements[id] = { hidden: false, value: "", textContent: "", innerHTML: "", className: "", addEventListener() {} };
  });
  const context = {
    window: {
      location: { href: "https://academy.invalid/intensive-listening-library.html" },
      MrCatAuth: { getSession: () => Promise.resolve({ mode: "student" }) },
      MrCatCloud: { callAuthenticatedFunction: () => Promise.resolve({ success: true, materials: [] }) },
      MrCatLoginNavigation: { loginHref: () => "index.html" },
    },
    document: { getElementById: (id) => elements[id], },
    URL,
    URLSearchParams,
    Number,
    Date,
    Intl,
    console,
  };
  vm.runInNewContext(libraryJs, context);
  const helpers = context.window.__MRCAT_INTENSIVE_LIBRARY_TEST__;
  assert.strictEqual(helpers.actionLabel({ progress: { percentage: 0 } }), "Start");
  assert.strictEqual(helpers.actionLabel({ progress: { percentage: 25 } }), "Continue");
  assert.strictEqual(helpers.actionLabel({ progress: { percentage: 100 } }), "Review");
  assert.ok(helpers.matches({ title: "BBC Lists", source_label: "BBC", set_id: "IL-BBC-260813" }, "", "lists"));
  assert.ok(helpers.matches({ title: "IELTS Transport", source_label: "IELTS", set_id: "IL-C7-T1-S1" }, "", "transport"));
  assert.ok(helpers.materialHref({ set_id: "IL-BBC-260813", href: "intensive-listening.html?set=IL-BBC-260813" }).includes("return="));
  assert.doesNotMatch(dashboardJs, /library-intensive-action|library-card-primary|linkedIntensiveHref/);
  assert.match(ielts, /intensiveListeningLinkHtml/);
}

testDashboardCapsules();
testSafeCatalogAndSessions();
testLibraryHelpers();
console.log("Intensive Listening Library tests passed.");
