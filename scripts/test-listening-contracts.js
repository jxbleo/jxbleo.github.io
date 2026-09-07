#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const shadowing = require("../cloudfunctions/intensiveListening/shadowing-service");
const service = require("../cloudfunctions/intensiveListening/service");
const activity = require("../cloudfunctions/_shared/learning-activity");

function unit(id, text, start, end, extra = {}) {
  return { unit_id: id, text, start_seconds: start, end_seconds: end, speaker: "Host", practice_mode: "dictation", slots: [{ slot_id: `${id}-w1`, answer: text.split(/\s+/)[0] }], ...extra };
}

const canonical = {
  material_id: "IL-CONTRACT",
  set_id: "IL-CONTRACT",
  content_revision: "content-r1",
  media: { kind: "audio", src: "audio/test.mp3" },
  units: [unit("u-1", "One reviewed line.", 0, 2), unit("context-1", "A context line.", 2, 4, { practice_mode: "context_only", slots: [] })],
};
const normalized = shadowing.validateCanonicalMaterial(canonical);
assert.strictEqual(normalized.schema_version, 3);
assert.deepStrictEqual(shadowing.trainingSegments(normalized, "dictation").map((item) => item.segment_id), ["u-1"]);
assert.deepStrictEqual(shadowing.trainingSegments(normalized, "shadowing").map((item) => item.segment_id), ["u-1"]);
assert.strictEqual(normalized.tracks.shadowing.segments[0].text, "One reviewed line.");
assert.strictEqual(normalized.tracks.shadowing.revision, normalized.tracks.dictation.revision);
const safe = shadowing.safeTrackMaterial(canonical);
assert.strictEqual(safe.units[0].text, undefined, "safe material must not expose transcript text");
assert.strictEqual(safe.tracks.shadowing.segments[0].text, undefined, "safe Shadowing track must not expose transcript text");
assert.strictEqual(service.publicMaterial(canonical).units[0].text, undefined, "public material must keep transcript private");

const legacyTracks = {
  set_id: "IL-LEGACY",
  schema_version: 2,
  tracks: {
    dictation: { revision: "legacy-r4", segments: [unit("legacy-1", "Legacy source.", 1, 3)] },
    shadowing: { revision: "old-shadow", segments: [{ segment_id: "different-id", text: "Legacy source.", start_seconds: 1, end_seconds: 3, practice_mode: "dictation" }] },
  },
};
const legacyNormalized = shadowing.normalizeMaterial(legacyTracks);
assert.deepStrictEqual(legacyNormalized.units.map((item) => item.unit_id), ["legacy-1"]);
assert.deepStrictEqual(legacyNormalized.tracks.shadowing.segments.map((item) => item.segment_id), ["legacy-1"], "legacy Shadowing IDs derive from Dictation units");
assert.strictEqual(legacyNormalized.content_revision, "legacy-r4");

const longText = Array(121).fill("word").join(" ");
assert.throws(() => shadowing.validateCanonicalMaterial({ ...canonical, units: [unit("too-long", longText, 0, 20)] }), /REFERENCE_WORD_LIMIT/);

const midnight = activity.splitSeconds(new Date("2026-09-07T15:59:59Z"), new Date("2026-09-07T16:00:01Z"));
assert.deepStrictEqual(midnight.map((part) => [part.date, part.seconds]), [["2026-09-07", 1], ["2026-09-08", 1]]);
const rows = activity.aggregateActivities([
  { material_id: "IL-CONTRACT", set_id: "IL-CONTRACT", practice_mode: "dictation", daily_seconds: { "2026-09-07": 40 } },
  { material_id: "IL-CONTRACT", set_id: "IL-CONTRACT", practice_mode: "dictation", daily_seconds: { "2026-09-07": 25 } },
  { material_id: "IL-CONTRACT", set_id: "IL-CONTRACT", practice_mode: "shadowing", daily_seconds: { "2026-09-07": 61 } },
]);
assert.deepStrictEqual(rows.map((row) => [row.mode, row.effective_seconds]), [["dictation", 65], ["shadowing", 61]]);
assert.strictEqual(activity.formatEffectiveTime(0), "0 min");
assert.strictEqual(activity.formatEffectiveTime(59), "<1 min");
assert.strictEqual(activity.formatEffectiveTime(90), "2 min");

const gatewaySource = fs.readFileSync(path.join(__dirname, "..", "cloudfunctions/intensiveListening/index.js"), "utf8");
const shadowingClient = fs.readFileSync(path.join(__dirname, "..", "assets/js/listening-shadowing.js"), "utf8");
const shadowingCss = fs.readFileSync(path.join(__dirname, "..", "assets/css/listening-shadowing.css"), "utf8");
assert.doesNotMatch(gatewaySource, /required_tracks:\s*requiredTracks/, "bootstrap must not reference a removed assignment variable");
assert.match(gatewaySource, /profile\.role === "student" && event\.assignment_id[\s\S]{0,80}LISTENING_NOT_ASSIGNABLE/, "all student Listening actions must reject forged Assignment context before routing");
assert.match(gatewaySource, /runTransaction\(async \(transaction\) => \{[\s\S]*last_sequence/, "effective-time sequence acceptance must be transactional");
assert.match(gatewaySource, /observedElapsed \+ ACTIVITY_TRANSPORT_TOLERANCE_SECONDS/, "the first and later time flushes use server elapsed time");
assert.match(gatewaySource, /active_session_id/, "activity lease IDs must not collide with unique session IDs");
assert.match(gatewaySource, /mode === "shadowing"[\s\S]{0,120}loadShadowingProgress/, "effective-time sessions must reuse the mode-specific notification thread");
assert.match(gatewaySource, /ownsActiveThread[\s\S]{0,120}return;/, "a completed result thread must not receive a later duplicate paused event");
assert.match(gatewaySource, /teacher_mode: true[\s\S]*shadowing_segments: shadowingTrackResponse\(material, previewProgress, true\)/, "teacher preview must receive revealed canonical Shadowing units");
assert.match(shadowingClient, /Student recording only/, "teacher Shadowing preview must disable recording/scoring");
assert.match(shadowingClient, /Stop Replay/);
assert.match(shadowingClient, /pause\('permission'\)/, "microphone permission wait must not accrue learning time");
assert.match(shadowingClient, /pause\('auto-advance'\)/, "auto-advance wait must not accrue learning time");
assert.match(shadowingCss, /\.shadowing-word-state\.normal \{ color: inherit; background: transparent; \}/);
assert.match(shadowingCss, /\.shadowing-word-state\.yellow[^\n]*border-bottom: 2px dotted/);
assert.match(shadowingCss, /\.shadowing-word-state\.red[^\n]*border-bottom: 2px solid/);
console.log("Listening canonical and effective-time contract tests passed.");
