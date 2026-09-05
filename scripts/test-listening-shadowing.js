#!/usr/bin/env node

const assert = require("assert");
const Module = require("module");
const shadowing = require("../cloudfunctions/intensiveListening/shadowing-service");
const service = require("../cloudfunctions/intensiveListening/service");

function material() {
  return {
    material_id: "IL-V2-TEST",
    set_id: "IL-V2-TEST",
    schema_version: 2,
    transcript_revision: "2026-09-05",
    media: { audio_src: "assets/audio/test.mp3" },
    tracks: {
      dictation: { enabled: true, revision: "d1", segments: [{ segment_id: "d-1", text: "A small test.", start_seconds: 0, end_seconds: 2, practice_mode: "dictation", slots: [{ slot_id: "w1", answer: "A" }] }] },
      shadowing: { enabled: true, revision: "s1", segments: [{ segment_id: "s-1", text: "A small test.", start_seconds: 0, end_seconds: 2, practice_mode: "dictation" }] },
    },
    units: [{ unit_id: "d-1", text: "A small test.", start_seconds: 0, end_seconds: 2, practice_mode: "dictation", slots: [{ slot_id: "w1", answer: "A" }] }],
  };
}

function wav(seconds = 1, value = 5000) {
  const samples = 16000 * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(value, 44 + index * 2);
  return buffer;
}

const normalized = shadowing.normalizeMaterial(material());
assert.strictEqual(normalized.schema_version, 2);
assert.strictEqual(shadowing.normalizeMode("listen_only"), "context_only");
assert.deepStrictEqual(shadowing.trainingSegments(normalized, "shadowing").map((item) => item.segment_id), ["s-1"]);
const safe = shadowing.safeTrackMaterial(material());
assert.strictEqual(safe.tracks.shadowing.segments[0].text, undefined, "pre-reveal Shadowing must not carry transcript text");
assert.strictEqual(safe.tracks.dictation.segments[0].slots[0].provided_text, "", "required Dictation answers stay private");

const policy = { status: "approved", revision: "policy-1", score_coeff: 1 };
const evidence = { status: "approved", suggested_score: 80, pron_accuracy: 80, pron_fluency: 80, pron_completion: 80 };
assert.strictEqual(shadowing.scoreFromEvidence(evidence, policy), 80);
assert.strictEqual(shadowing.scoreFromEvidence({ ...evidence, suggested_score: 100, word_states: [{ state: "red" }] }, policy), 79, "a red word caps the product score below pass");
assert.strictEqual(shadowing.scoreFromEvidence({ ...evidence, suggested_score: 80, word_states: [{ state: "yellow" }] }, policy), 80);
assert.throws(() => shadowing.scoreFromEvidence({ ...evidence, suggested_score: 100 }, { ...policy, status: "draft" }), /SCORING_POLICY_NOT_APPROVED/);
assert.throws(() => shadowing.scoreFromEvidence({ pron_accuracy: 80 }, policy), /SHADOWING_SCORE_MISSING/);

let progress = shadowing.createProgress(normalized, { student_uid: "student-1" });
progress = shadowing.applyTake(progress, "s-1", { take_id: "take-1", score: 92, word_states: [{ word_id: "w1", state: "normal" }] });
progress = shadowing.applyTake(progress, "s-1", { take_id: "take-2", score: 60, word_states: [{ word_id: "w1", state: "red" }] });
assert.strictEqual(progress.segment_states["s-1"].best_score, 92, "best score is monotonic");
assert.strictEqual(progress.segment_states["s-1"].qualified, true);
assert.strictEqual(shadowing.progressSummary(progress).completed, true);
assert.strictEqual(shadowing.toImproveQueue(progress, shadowing.trainingSegments(normalized, "shadowing")).length, 0);

const valid = shadowing.validateWav(wav(), { min_duration_seconds: .15, max_duration_seconds: 2, max_bytes: 2 * 1024 * 1024 });
assert.strictEqual(valid.valid, true);
assert.strictEqual(shadowing.validateWav(Buffer.from("not audio")).valid, false);
assert.strictEqual(shadowing.duplicateKey({ audio_hash: "a", reference_hash: "b", material_id: "m", shadowing_revision: "s", policy_revision: "p", provider_revision: "v" }), shadowing.duplicateKey({ audio_hash: "a", reference_hash: "b", material_id: "m", shadowing_revision: "s", policy_revision: "p", provider_revision: "v" }));
assert.strictEqual(service.normalizedPracticeMode({ practice_mode: "listen_only" }), "context_only");

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "@cloudbase/node-sdk") return { SYMBOL_CURRENT_ENV: "test", init: function() { return { database: function() { return { command: {} }; } }; } };
  return originalLoad.call(this, request, parent, isMain);
};
delete require.cache[require.resolve("../cloudfunctions/intensiveListening/index")];
const gateway = require("../cloudfunctions/intensiveListening/index").__test;
Module._load = originalLoad;
const hiddenProgress = gateway.safeShadowingProgress({ segment_count: 1, segment_states: { "s-1": { transcript_revealed: false, best_score: 81, best_word_states: [{ word_id: "rw_001", state: "red" }] } } });
assert.deepStrictEqual(hiddenProgress.segment_states["s-1"].best_word_states, [], "pre-reveal progress must not leak word states");
assert.deepStrictEqual(gateway.safeShadowingResult({ take_id: "take", product_score: 81, word_states: [{ word_id: "rw_001", state: "red" }] }, false).word_states, [], "pre-reveal take result must not leak word states");
assert.strictEqual(gateway.safeShadowingProgress({ segment_count: 1, segment_states: { "s-1": { transcript_revealed: true, best_word_states: [{ word_id: "rw_001", state: "yellow" }] } } }).segment_states["s-1"].best_word_states[0].state, "yellow");
console.log("Listening Shadowing tests passed.");
