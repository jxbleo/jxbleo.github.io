#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const lab = require("../cloudfunctions/_shared/speaking-lab");
const speech = require("../cloudfunctions/speakingLab/speech-provider");
const model = require("../cloudfunctions/speakingLab/model-provider");

function run() {
  const source = fs.readFileSync(path.join(__dirname, "../cloudfunctions/speakingLab/index.js"), "utf8");
  assert.match(source, /action === "processQueuedJob"/);
  assert.match(source, /dispatch_token/);
  assert.match(source, /SPEAKING_PROVIDER_NOT_CONFIGURED/);
  assert.doesNotMatch(source, /demo\s*=|fixture\s*=|provider_url\s*:/i);
  assert.doesNotMatch(source, /upload_metadata\s*:/, "temporary upload credentials must not be persisted");
  assert.doesNotMatch(source, /event\.speaker_keys|event\.candidate_speaker_keys/, "teacher mapping candidates must come from the server report");
  assert.doesNotMatch(source, /event\.asset_id[\s\S]{0,500}event\.start_ms/, "playback must not trust a browser-selected asset and range");

  assert.throws(() => speech.createSpeechProvider(), (error) => error.code === "SPEAKING_PROVIDER_NOT_CONFIGURED");
  assert.equal(model.providerConfigStatus({}).configured, false);
  assert.throws(() => model.createModelProvider(), (error) => error.code === "SPEAKING_PROVIDER_NOT_CONFIGURED");

  const normalized = speech.normalizedProviderOutput({ language: "en", duration_ms: 1234, speaker_tracks: [{ provider_speaker_id: "A", confidence: 2 }], segments: [{ provider_speaker_id: "A", start_ms: 0, end_ms: 1000, text: "hello" }] });
  assert.equal(normalized.speaker_tracks[0].confidence, 1);
  assert.equal(normalized.segments[0].text, "hello");

  const job = { job_id: "job", status: "queued", stage: "transcription", attempt_count: 0, safe_error_code: null, created_at: null, updated_at: null, finished_at: null };
  const view = require("../cloudfunctions/speakingLab/index.js")._test.publicJob(job);
  assert.deepEqual(view, { job_id: "job", status: "queued", stage: "transcription", attempt_count: 0, error_code: null, created_at: null, updated_at: null, finished_at: null });
  assert.equal(Object.prototype.hasOwnProperty.call(view, "dispatch_token"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(view, "prompt_text"), false);

  const participantView = require("../cloudfunctions/speakingLab/index.js")._test.participantView({ participant_id: "p1", participant_kind: "vip", student_uid: "u1", display_name_snapshot: "Roster Name", invitation_status: "accepted", identity_status: "ai_matched", matched_speaker_key: "spk_02" }, { auth_uid: "u1", role: "student", active: true }, {}, 0);
  assert.equal(participantView.roster_display_name, "Roster Name");
  assert.equal(participantView.display_name, "Speaker 2");

  const fixture = { report_version: "dse-speaking-v1", mapping_revision: 1 };
  assert.equal(lab.snapshotInvalidationReason(fixture, { ...fixture }), null);
  assert.equal(lab.shareMustInvalidate({ report_changed: true }), true);
  console.log("Speaking Lab service contracts passed.");
}

run();
