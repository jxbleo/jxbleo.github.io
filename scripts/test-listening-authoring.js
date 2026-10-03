#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const intensiveListeningService = require("../cloudfunctions/intensiveListening/service");

const root = path.resolve(__dirname, "..");
const importer = fs.readFileSync(path.join(root, "scripts", "import-intensive-listening.js"), "utf8");
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
const teacherListening = fs.readFileSync(path.join(root, "assets", "js", "teacher-listening.js"), "utf8");
const sortStart = teacherListening.indexOf("function sortListeningMaterials(");
const sortEnd = teacherListening.indexOf("\n  function renderList()", sortStart);
const sortListeningMaterials = vm.runInNewContext(`(${teacherListening.slice(sortStart, sortEnd)})`);
const materialOrder = [
  { material_id: "older-upload", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-24T00:00:00Z" },
  { material_id: "newer-upload", created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" },
];
assert.equal(sortListeningMaterials(materialOrder, "updated").map((item) => item.material_id).join(), "older-upload,newer-upload");
assert.equal(sortListeningMaterials(materialOrder, "uploaded").map((item) => item.material_id).join(), "newer-upload,older-upload");
assert.equal(materialOrder[0].material_id, "older-upload", "sorting must not mutate the server list");
assert.match(teacherHtml, /data-listening-sort="updated"[^>]*aria-pressed="true"/);
assert.match(teacherHtml, /data-listening-sort="uploaded"/);
assert.match(teacherAdmin, /created_at: current && current\.created_at \|\| draft && draft\.created_at \|\| now/);
const listStart = teacherAdmin.indexOf("async function listListeningMaterials(");
const listEnd = teacherAdmin.indexOf("\nasync function getListeningMaterial", listStart);
const listListeningMaterials = vm.runInNewContext(`(${teacherAdmin.slice(listStart, listEnd)})`, {
  LISTENING_MATERIAL_COLLECTION: "published",
  LISTENING_DRAFT_COLLECTION: "drafts",
  getAll: async (collection) => collection === "published"
    ? [{ material_id: "same", created_at: new Date("2026-09-10T00:00:00Z"), updated_at: new Date("2026-09-20T00:00:00Z") }]
    : [{ material_id: "same", created_at: new Date("2026-09-01T00:00:00Z"), updated_at: new Date("2026-09-24T00:00:00Z") }],
  listeningTeacherView: (item) => ({ material_id: item.material_id }),
  text: String,
});
listListeningMaterials().then((result) => {
  assert.equal(new Date(result.materials[0].created_at).toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(new Date(result.materials[0].updated_at).toISOString(), "2026-09-24T00:00:00.000Z");
  console.log("Listening authoring and UI contract tests passed.");
}).catch((error) => { process.nextTick(() => { throw error; }); });
assert.match(teacherAdmin, /listening_material_drafts/);
assert.match(teacherAdmin, /LISTENING_DRAFT_CONFLICT/);
assert.match(teacherAdmin, /listening_material_history/);
assert.doesNotMatch(html, /Shadowing|mode-switch|practice-listening-mode|listening-shadowing/);
assert.doesNotMatch(teacherHtml, /data-listening-editor-tab="shadowing"|teacher-listening-shadowing/);
assert.doesNotMatch(gateway, /SHADOW_|shadowing-service|tencent-soe-n|reserveShadowingTake|setRevealThreshold|setModePreference/);
assert.ok(!fs.existsSync(path.join(root, "cloudfunctions/listeningMaintenance/index.js")));
assert.ok(!fs.existsSync(path.join(root, "assets/js/listening-shadowing.js")));
assert.equal((teacherHtml.match(/id="teacher-listening-title"/g) || []).length, 1, "the title input must not share its ID with a heading");
const publicationStart = teacherAdmin.indexOf("function publishedListeningMaterial(");
const publicationEnd = teacherAdmin.indexOf("\nasync function upsertListeningSet", publicationStart);
const publish = vm.runInNewContext(`(${teacherAdmin.slice(publicationStart, publicationEnd)})`, {
  intensiveListeningService, nextListeningRevision: () => "new-revision",
});
const legacy = {
  material_id: "IL-AUTHORING", content_version: "1", audio_src: "test.mp3",
  units: [{ unit_id: "u1", text: "Fixture.", start_seconds: 0, end_seconds: 2, practice_mode: "dictation", slots: [{ slot_id: "w1", answer: "Fixture" }] }],
  tracks: { shadowing: { enabled: true, segments: [] } },
};
const republished = publish(legacy, legacy);
assert.deepEqual(Object.keys(republished.tracks), ["dictation"], "publishing an old live material must not restore the retired track");
assert.equal(republished.content_revision, "1", "mode retirement alone must preserve Dictation progress scope");
assert.deepEqual(Object.keys(publish(legacy, null).tracks), ["dictation"], "old drafts are normalized on first publication too");
assert.equal(publish({ ...legacy, audio_src: "changed.mp3" }, legacy).content_revision, "new-revision");
