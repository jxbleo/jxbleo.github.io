#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const importer = fs.readFileSync(path.join(root, "scripts", "import-intensive-listening.js"), "utf8");
const prepare = fs.readFileSync(path.join(root, "scripts", "prepare-cloudbase-data.js"), "utf8");
const html = fs.readFileSync(path.join(root, "intensive-listening.html"), "utf8");
const service = fs.readFileSync(path.join(root, "cloudfunctions", "intensiveListening", "service.js"), "utf8");
const gateway = fs.readFileSync(path.join(root, "cloudfunctions", "intensiveListening", "index.js"), "utf8");
const teacherHtml = fs.readFileSync(path.join(root, "teacher.html"), "utf8");

assert.match(importer, /explicit tracks/);
assert.match(importer, /schemaVersion/);
assert.match(importer, /transcript_revision/);
assert.match(service, /provided_text/);
assert.match(teacherHtml, /teacher-listening-segment-list/);
assert.match(teacherHtml, /Canonical transcript &amp; units/);
assert.doesNotMatch(teacherHtml, /Dictation segments JSON/);
const teacherAdmin = fs.readFileSync(path.join(root, "cloudfunctions", "teacherAdmin", "index.js"), "utf8");
assert.match(teacherAdmin, /listening_material_drafts/);
assert.match(teacherAdmin, /LISTENING_DRAFT_CONFLICT/);
assert.match(teacherAdmin, /listening_material_history/);
assert.doesNotMatch(html, /Shadowing|mode-switch|practice-listening-mode|listening-shadowing/);
assert.doesNotMatch(teacherHtml, /data-listening-editor-tab="shadowing"|teacher-listening-shadowing/);
assert.doesNotMatch(gateway, /SHADOW_|shadowing-service|tencent-soe-n|reserveShadowingTake|setRevealThreshold|setModePreference/);
assert.ok(!fs.existsSync(path.join(root, "cloudfunctions/listeningMaintenance/index.js")));
assert.ok(!fs.existsSync(path.join(root, "assets/js/listening-shadowing.js")));
console.log("Listening authoring and UI contract tests passed.");
