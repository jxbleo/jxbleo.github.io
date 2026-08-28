#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const lab = require("../cloudfunctions/_shared/speaking-lab");
const speech = require("../cloudfunctions/speakingLab/speech-provider");
const model = require("../cloudfunctions/speakingLab/model-provider");

async function run() {
  const source = fs.readFileSync(path.join(__dirname, "../cloudfunctions/speakingLab/index.js"), "utf8");
  assert.match(source, /action === "processQueuedJob"/);
  assert.match(source, /dispatch_token/);
  assert.match(source, /SPEAKING_PROVIDER_NOT_CONFIGURED/);
  assert.doesNotMatch(source, /demo\s*=|fixture\s*=|provider_url\s*:/i);
  assert.doesNotMatch(source, /upload_metadata\s*:/, "temporary upload credentials must not be persisted");
  assert.doesNotMatch(source, /event\.speaker_keys|event\.candidate_speaker_keys/, "teacher mapping candidates must come from the server report");
  assert.doesNotMatch(source, /event\.asset_id[\s\S]{0,500}event\.start_ms/, "playback must not trust a browser-selected asset and range");

  assert.throws(() => speech.createSpeechProvider({ env: {} }), (error) => error.code === "SPEAKING_PROVIDER_NOT_CONFIGURED");
  assert.equal(model.providerConfigStatus({}).configured, false);
  assert.throws(() => model.createModelProvider({ env: {} }), (error) => error.code === "SPEAKING_PROVIDER_NOT_CONFIGURED");

  const normalized = speech.normalizedProviderOutput({ language: "en", duration_ms: 1234, speaker_tracks: [{ provider_speaker_id: "A", confidence: 2 }], segments: [{ provider_speaker_id: "A", start_ms: 0, end_ms: 1000, text: "hello" }] });
  assert.equal(normalized.speaker_tracks[0].confidence, 1);
  assert.equal(normalized.segments[0].text, "hello");
  const unknownConfidenceOutput = speech.normalizedProviderOutput({ speaker_tracks: [{ provider_speaker_id: "A", confidence: null }], segments: [{ provider_speaker_id: "A", start_ms: 0, end_ms: 1000, text: "hello", confidence: null }] });
  assert.equal(unknownConfidenceOutput.speaker_tracks[0].confidence, null);
  assert.equal(unknownConfidenceOutput.segments[0].confidence, null);
  assert.equal(model._test.normalizedUsage({}).total_tokens, null);

  const speechCalls = [];
  const speechEnv = {
    TENCENTCLOUD_SECRETID: "test-id",
    TENCENTCLOUD_SECRETKEY: "test-key",
    SPEAKING_ASR_PROVIDER: "tencent",
    SPEAKING_ASR_ENDPOINT: "https://asr.example.test",
    SPEAKING_ASR_ENGINE_MODEL_TYPE: "16k_en",
  };
  const speechFetch = async (_url, options) => {
    const action = options.headers["X-TC-Action"];
    const body = JSON.parse(options.body);
    speechCalls.push({ action, body });
    const data = action === "CreateRecTask"
      ? { TaskId: 12345 }
      : { TaskId: 12345, Status: 2, AudioDuration: 12.5, ResultDetail: [
        { SpeakerId: 0, StartMs: 0, EndMs: 4000, FinalSentence: "First speaker." },
        { SpeakerId: 1, StartMs: 4200, EndMs: 9000, FinalSentence: "Second speaker." },
      ] };
    return { ok: true, status: 200, text: async () => JSON.stringify({ Response: { Data: data, RequestId: `req-${action}` } }) };
  };
  const speechProvider = speech.createSpeechProvider({ env: speechEnv, fetch: speechFetch, timestamp: 1700000000 });
  const submitted = await speechProvider.transcribeAndDiarize({ audio_url: "https://audio.example.test/discussion.mp3" });
  assert.equal(submitted.status, "pending");
  assert.equal(submitted.task_id, 12345);
  const completed = await speechProvider.transcribeAndDiarize({ task_id: submitted.task_id });
  assert.equal(completed.status, "completed");
  assert.equal(completed.output.duration_ms, 12500);
  assert.equal(completed.output.speaker_tracks[0].confidence, null);
  assert.deepEqual(completed.output.speaker_tracks.map((item) => item.provider_speaker_id), ["tencent_0", "tencent_1"]);
  assert.deepEqual(speechCalls.map((item) => item.action), ["CreateRecTask", "DescribeTaskStatus"]);
  assert.equal(speechCalls[0].body.SpeakerDiarization, 1);
  assert.equal(speechCalls[0].body.SpeakerNumber, 0);
  assert.equal(speechCalls[0].body.ChannelNum, 1);
  assert.equal(speechCalls[0].body.ResTextFormat, 1);
  const canonicalTranscript = require("../cloudfunctions/speakingLab/index.js")._test.canonicalTranscript({
    language: "en", duration_ms: 12500,
    speaker_tracks: [{ provider_speaker_id: "tencent_0", confidence: null, speech_duration_ms: 8000, turn_count: 2 }],
    segments: [
      { provider_speaker_id: "tencent_0", start_ms: 560, end_ms: 3000, text: "You may start a discussion now.", confidence: null },
      { provider_speaker_id: "tencent_0", start_ms: 3200, end_ms: 12000, text: "I think this trend is popular.", confidence: null },
    ],
  }, [{ participant_id: "p1", participant_kind: "vip" }]);
  assert.equal(canonicalTranscript.segments[0].evaluation_role, "non_candidate_context");
  assert.equal(canonicalTranscript.segments[1].evaluation_role, "candidate");
  assert.equal(canonicalTranscript.external_cue_count, 1);

  const modelCalls = [];
  const modelEnv = {
    SPEAKING_AI_TEXT_API_KEY: "private-test-key",
    SPEAKING_AI_TEXT_API_URL: "https://bailian.example.test/chat/completions",
    SPEAKING_AI_TEXT_MODEL: "qwen-test",
    SPEAKING_AI_TEXT_PROTOCOL: "chat_json_object",
  };
  const modelFetch = async (url, options) => {
    modelCalls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name === "x-request-id" ? "model-request" : null },
      text: async () => JSON.stringify({ choices: [{ message: { content: "```json\n{\"group_summary_zh\":\"測試\"}\n```" } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    };
  };
  const modelProvider = model.createModelProvider({ env: modelEnv, fetch: modelFetch });
  const modelResult = await modelProvider.callStructuredModel({ system_prompt: "Return JSON", user_prompt: "JSON input" });
  assert.equal(modelResult.output.group_summary_zh, "測試");
  assert.equal(modelResult.usage.total_tokens, 15);
  assert.equal(modelCalls[0].body.response_format.type, "json_object");
  assert.equal(modelCalls[0].body.max_completion_tokens, 8000);
  assert.equal(modelCalls[0].headers.Authorization, "Bearer private-test-key");

  const job = { job_id: "job", status: "queued", stage: "transcription", attempt_count: 0, safe_error_code: null, created_at: null, updated_at: null, finished_at: null };
  const view = require("../cloudfunctions/speakingLab/index.js")._test.publicJob(job);
  assert.deepEqual(view, { job_id: "job", status: "queued", stage: "transcription", attempt_count: 0, error_code: null, created_at: null, updated_at: null, finished_at: null });
  assert.equal(Object.prototype.hasOwnProperty.call(view, "dispatch_token"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(view, "prompt_text"), false);
  const usageEvent = require("../cloudfunctions/speakingLab/index.js")._test.providerUsageEvent({ job_id: "j", discussion_id: "d", operation_id: "o", attempt_count: 1 }, "transcription", 1, "tencent", { usage: {} });
  assert.equal(usageEvent.audio_seconds, null);
  assert.equal(usageEvent.usage_status, "missing");
  assert.equal(usageEvent.http_status, null);

  const participantView = require("../cloudfunctions/speakingLab/index.js")._test.participantView({ participant_id: "p1", participant_kind: "vip", student_uid: "u1", display_name_snapshot: "Roster Name", invitation_status: "accepted", identity_status: "ai_matched", matched_speaker_key: "spk_02" }, { auth_uid: "u1", role: "student", active: true }, {}, 0);
  assert.equal(participantView.roster_display_name, "Roster Name");
  assert.equal(participantView.display_name, "Speaker 2");

  const fixture = { report_version: "dse-speaking-v1", mapping_revision: 1 };
  assert.equal(lab.snapshotInvalidationReason(fixture, { ...fixture }), null);
  assert.equal(lab.shareMustInvalidate({ report_changed: true }), true);

  const worker = require("../cloudfunctions/speakingAiWorker/index.js")._test;
  assert.equal(worker.isTimerEvent({ Type: "Timer", TriggerName: "speaking-ai-worker-minute", Time: "2026-08-28T00:00:00Z", Message: "" }), true);
  assert.equal(worker.isTimerEvent({ Type: "Timer", TriggerName: "another-trigger", Time: "2026-08-28T00:00:00Z" }), false);
  assert.equal(worker.isTimerEvent({ Type: "Timer", TriggerName: "speaking-ai-worker-minute", Time: "not-a-time" }), false);
  assert.equal(worker.isTimerEvent({ action: "run" }), false);
  console.log("Speaking Lab service contracts passed.");
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
