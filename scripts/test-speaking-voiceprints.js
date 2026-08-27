#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const voiceprints = require("../cloudfunctions/_shared/tencent-asr-voiceprint");
const service = require("../cloudfunctions/speakingLab/index.js")._test;

function wavBase64(seconds = 10, sampleRate = 16000, channels = 1) {
  const samples = Math.round(seconds * sampleRate);
  const dataBytes = samples * channels * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 44; index < buffer.length; index += 2) buffer.writeInt16LE(index % 200 < 100 ? 1000 : -1000, index);
  return buffer.toString("base64");
}

async function run() {
  const valid = voiceprints.validateWavBase64(wavBase64());
  assert.equal(valid.sampleRate, 16000);
  assert.equal(valid.channels, 1);
  assert.equal(valid.bitsPerSample, 16);
  assert.equal(valid.durationMs, 10000);
  assert.throws(() => voiceprints.validateWavBase64(wavBase64(10, 48000)), (error) => error.code === "VOICEPRINT_AUDIO_INVALID");
  assert.throws(() => voiceprints.validateWavBase64(wavBase64(4)), (error) => error.code === "VOICEPRINT_AUDIO_DURATION_INVALID");

  const env = {
    TENCENTCLOUD_SECRETID: "test-secret-id",
    TENCENTCLOUD_SECRETKEY: "test-secret-key",
    TENCENTCLOUD_SESSIONTOKEN: "test-session-token",
    SPEAKING_TENCENT_ASR_ENDPOINT: "https://asr.example.test",
    SPEAKING_TENCENT_ASR_REGION: "ap-test",
    SPEAKING_TENCENT_VOICEPRINT_GROUP_ID: "mrcat_test_group",
  };
  const calls = [];
  const fetch = async (url, options) => {
    const action = options.headers["X-TC-Action"];
    const body = JSON.parse(options.body);
    calls.push({ url, action, headers: options.headers, body });
    const data = action === "VoicePrintGroupVerify"
      ? { VerifyTops: [{ VoicePrintId: "vp-two", Score: "78.5" }, { VoicePrintId: "vp-one", Score: "92.5" }] }
      : action === "VoicePrintVerify"
        ? { VoicePrintId: body.VoicePrintId, Score: "81.2", Decision: 1 }
        : { VoicePrintId: body.VoicePrintId || "vp-new", SpeakerNick: body.SpeakerNick || "opaque" };
    return { ok: true, status: 200, text: async () => JSON.stringify({ Response: { Data: data, RequestId: `request-${action}` } }) };
  };
  const options = { env, fetch, timestamp: 1700000000 };
  const enrolled = await voiceprints.enroll({ audioBase64: wavBase64(), subjectKey: "vip:private-auth-uid" }, options);
  assert.equal(enrolled.voiceprintId, "vp-new");
  assert.doesNotMatch(calls[0].body.SpeakerNick, /private-auth-uid/);
  assert.equal(calls[0].body.GroupId, "mrcat_test_group");
  assert.equal(calls[0].headers["X-TC-Version"], "2019-06-14");
  assert.equal(calls[0].headers["X-TC-Region"], "ap-test");
  assert.equal(calls[0].headers["X-TC-Token"], "test-session-token");
  assert.match(calls[0].headers.Authorization, /^TC3-HMAC-SHA256 Credential=test-secret-id\//);
  await voiceprints.update({ audioBase64: wavBase64(), voiceprintId: "vp-new", subjectKey: "vip:private-auth-uid" }, options);
  const verified = await voiceprints.verify({ audioBase64: wavBase64(), voiceprintId: "vp-new" }, options);
  assert.equal(verified.decision, true);
  assert.equal(verified.score, 81.2);
  const identified = await voiceprints.identify({ audioBase64: wavBase64(), topN: 2 }, options);
  assert.deepEqual(identified.matches.map((item) => item.voiceprintId), ["vp-one", "vp-two"]);
  await voiceprints.remove({ voiceprintId: "vp-new" }, options);
  assert.deepEqual(calls.map((call) => call.action), ["VoicePrintEnroll", "VoicePrintUpdate", "VoicePrintVerify", "VoicePrintGroupVerify", "VoicePrintDelete"]);

  assert.equal(service.voiceprintSubjectKey({ participant_kind: "vip", student_uid: "student-uid" }), "vip:student-uid");
  assert.equal(service.voiceprintSubjectKey({ participant_kind: "guest", participant_id: "guest-row" }), "guest:guest-row");
  assert.equal(service.voiceprintStatusView(null).status, "missing");
  assert.equal(service.voiceprintStatusView({ status: "active", enrollment_revision: 2 }).enrollment_revision, 2);
  const target = service.publicVoiceprintTarget({ kind: "guest", participant_id: "g1", discussion_id: "d1", display_name: "Alex" }, { status: "active", enrollment_revision: 1 });
  assert.equal(target.name_not_verified, true);
  assert.equal(Object.prototype.hasOwnProperty.call(target, "provider_voiceprint_id"), false);

  const backend = fs.readFileSync(path.join(__dirname, "../cloudfunctions/speakingLab/index.js"), "utf8");
  const studentUi = fs.readFileSync(path.join(__dirname, "../assets/js/speaking-lab.js"), "utf8");
  const teacherUi = fs.readFileSync(path.join(__dirname, "../assets/js/teacher-speaking.js"), "utf8");
  assert.match(backend, /saveMyVoiceprint[\s\S]*saveVoiceprint\(actor, event, false\)/);
  assert.match(backend, /teacherSaveVoiceprint[\s\S]*saveVoiceprint\(actor, event, true\)/);
  assert.match(backend, /ownVoiceprintSubject\(actor\)/);
  assert.match(backend, /teacherVoiceprintSubject\(actor, event\)/);
  assert.doesNotMatch(studentUi + teacherUi, /TENCENTCLOUD_SECRET|SecretKey|provider_voiceprint_id/);
  assert.match(studentUi, /saveMyVoiceprint/);
  assert.match(teacherUi, /teacherSaveVoiceprint/);
  assert.match(teacherUi, /name_not_verified/);
  console.log("Speaking Lab Tencent voiceprint contracts passed.");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
