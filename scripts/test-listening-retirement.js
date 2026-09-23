#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");
const service = require("../cloudfunctions/intensiveListening/service");
const root = path.resolve(__dirname, "..");
const gatewayPath = path.join(root, "cloudfunctions/intensiveListening/index.js");
const localRequire = createRequire(gatewayPath);
const material = {
  set_id: "IL-RETIREMENT", material_id: "IL-RETIREMENT", visible: true,
  title: "Offline retirement fixture", content_version: "1", audio_src: "test.mp3",
  units: [{ unit_id: "unit-1", text: "Fixture words.", start_seconds: 0, end_seconds: 2,
    practice_mode: "dictation", slots: [{ slot_id: "word-1", answer: "Fixture" }, { slot_id: "word-2", answer: "words" }] }],
  tracks: { shadowing: { enabled: true, segments: [{ segment_id: "old-recording" }] } },
};
let role = "student";
let authenticated = true;
const touched = [];
const writes = [];
const rows = {
  students: [{ _id: "profile-1", auth_uid: "test-uid", student_id: "fixture-student", active: true, role: "student", listening_mode_preference: "shadowing" }],
  sets: [{ set_id: material.set_id, visible: true, type: "intensive-listening" }],
  intensive_listening_materials: [material],
  intensive_listening_progress: [{ progress_id: "unused", student_uid: "test-uid", material_id: material.material_id, set_id: material.set_id, content_version: "1", unit_states: {} }],
};
function query(collection, where = {}) {
  return {
    where: (value) => query(collection, value), limit() { return this; }, orderBy() { return this; },
    async get() {
      const source = collection === "students" ? rows.students.map((row) => ({ ...row, role })) : rows[collection] || [];
      return { data: source.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)) };
    },
    doc() { return this; },
    async create(value) { writes.push({ collection, value }); },
    async update(value) { writes.push({ collection, value }); },
    async add(value) { writes.push({ collection, value }); },
  };
}
const cloudbase = { SYMBOL_CURRENT_ENV: "fixture", init: () => ({
  auth: () => ({ getUserInfo: async () => authenticated ? { uid: "test-uid" } : {} }),
  database: () => ({ collection(name) {
    touched.push(name);
    assert.doesNotMatch(name, /shadowing|listening_assignment_tracks/, "retired collections must never be queried");
    return query(name);
  } }),
}) };
const gateway = { exports: {} };
vm.runInNewContext(fs.readFileSync(gatewayPath, "utf8"), {
  exports: gateway.exports,
  require: (name) => name === "@cloudbase/node-sdk" ? cloudbase : localRequire(name),
  console: { error() {} }, Date, Buffer, process: { env: {} },
}, { filename: gatewayPath });

async function run() {
  const call = (action, extra = {}) => gateway.exports.main({ action, set_id: material.set_id, ...extra });
  const catalog = await call("listCatalog");
  assert.equal(catalog.success, true);
  assert.equal(catalog.materials.length, 1);
  assert.deepEqual(Object.keys(catalog.materials[0].modes), ["dictation"]);
  assert.doesNotMatch(JSON.stringify(catalog), /shadowing|Fixture words|answer|slots/);
  const student = await call("bootstrap", { mode: "shadowing" });
  assert.equal(student.success, true);
  assert.deepEqual(Object.keys(student.tracks), ["dictation"]);
  assert.equal(student.material.units[0].unit_id, "unit-1");
  assert.equal(student.material.content_revision, "1");
  assert.equal(student.progress.percentage, 0);
  assert.doesNotMatch(JSON.stringify(student), /shadowing|Fixture words|"answer"/);
  assert.equal(service.progressScope(material), material.material_id, "retiring a mode must not reset Dictation progress identity");
  assert.deepEqual(Object.keys(service.sourceMaterial(material).modes), ["dictation"]);
  role = "teacher";
  const teacher = await call("bootstrap");
  assert.equal(teacher.teacher_mode, true);
  assert.deepEqual(Object.keys(teacher.tracks), ["dictation"]);
  role = "student";
  for (const action of ["getTrack", "track", "setModePreference", "setRevealThreshold", "revealShadowingTranscript", "startListen", "startCompleteListen", "completeListen", "reserveShadowingTake", "reserve_take", "finishShadowingTake", "finish_take", "registerShadowingUpload", "register_upload", "cancelShadowingTake", "cancel_take", "getShadowingTake", "take", "continueShadowingSegment", "continue_segment"]) {
    const result = await call(action, { mode: "shadowing" });
    assert.equal(result.success, false, action);
    assert.equal(result.code, "ACTION_NOT_SUPPORTED", action);
  }
  const activity = await call("startLearningActivity", { mode: "shadowing" });
  assert.equal(activity.code, "LISTENING_MODE_INVALID");
  const assignment = await call("bootstrap", { assignment_id: "forged" });
  assert.equal(assignment.code, "LISTENING_NOT_ASSIGNABLE");
  authenticated = false;
  assert.equal((await call("listCatalog")).code, "AUTH_REQUIRED");
  assert.equal(writes.length, 0, "catalog/bootstrap/retired actions must not write profiles, take history or progress");
  console.log("Listening retirement tests passed: legacy links/materials, answer privacy, active profiles, rejected routes and no retired collection access.");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
