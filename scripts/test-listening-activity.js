#!/usr/bin/env node
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "assets/js/learning-activity.js"), "utf8");
const listeners = {};
const context = {
  window: {
    performance: { now: () => context.now },
    setInterval: () => 1,
    clearInterval: () => {},
    addEventListener: (name, fn) => { listeners[name] = fn; },
    crypto: { randomUUID: () => "test-id" },
  },
  document: {
    visibilityState: "visible",
    hasFocus: () => true,
    addEventListener: (name, fn) => { listeners[name] = fn; },
  },
  now: 0,
  Promise,
  Math,
  String,
  Number,
};
vm.runInNewContext(source, context);
const tracker = context.window.MrCatLearningActivity;
let requests = [];
tracker.configure({ activityType: "listening", materialId: "IL-TEST", mode: "dictation", contentRevision: "r1", send: (request) => {
  requests.push(request);
  return Promise.resolve({ accepted_seconds: Array.isArray(request.spans) ? request.spans.reduce((sum, span) => sum + span.effective_seconds, 0) : 15 });
} });
tracker.markInteraction("typing", "unit-1");
context.now = 5000;
context.window.__MRCAT_LEARNING_ACTIVITY_TEST__.tick();
assert.strictEqual(tracker.summary().local_seconds, 5);
context.now = 26000;
context.window.__MRCAT_LEARNING_ACTIVITY_TEST__.tick();
assert.strictEqual(tracker.summary().local_seconds, 5, "idle time beyond 20 seconds is not counted");
context.now = 50000;
context.window.__MRCAT_LEARNING_ACTIVITY_TEST__.tick();
assert.strictEqual(tracker.summary().local_seconds, 5, "long idle periods are not counted");
tracker.setContinuous("recording", true, "unit-1");
context.now = 60000;
context.window.__MRCAT_LEARNING_ACTIVITY_TEST__.tick();
assert.strictEqual(tracker.summary().local_seconds, 15, "continuous recording keeps the timer alive");
tracker.setContinuous("recording", false);
const beforeFlush = tracker.summary().pending_span_count;
assert.ok(beforeFlush > 0);
tracker.flush("test").then(() => {
  const starts = requests.filter((request) => request.action === "startLearningActivity");
  const records = requests.filter((request) => request.action === "recordLearningActivity");
  assert.strictEqual(starts.length, 1, "the first real interaction starts the server-observed window");
  assert.strictEqual(records.length, 1);
  assert.ok(requests.indexOf(starts[0]) < requests.indexOf(records[0]), "the server handshake precedes the first time claim");
  assert.strictEqual(records[0].mode, "dictation");
  assert.ok(records[0].spans.every((span) => span.effective_seconds <= 60));
  context.document.visibilityState = "hidden";
  listeners.visibilitychange();
  assert.strictEqual(tracker.summary().active, false);
  context.document.visibilityState = "visible";
  listeners.visibilitychange();
  tracker.markInteraction("review", "unit-1");
  assert.strictEqual(tracker.summary().active, true, "returning to a visible page permits activity again");
  return Promise.resolve();
}).then(() => {
  assert.ok(requests.some((request) => request.action === "pauseLearningActivity"), "visibility pause releases the server-side activity lease");
  console.log("Listening effective-time tracker tests passed.");
}).catch((error) => { console.error(error); process.exitCode = 1; });
