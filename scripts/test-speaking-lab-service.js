#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const lab = require("../cloudfunctions/_shared/speaking-lab");
const speech = require("../cloudfunctions/speakingLab/speech-provider");
const model = require("../cloudfunctions/speakingLab/model-provider");
const prompts = require("../cloudfunctions/speakingLab/prompts");

async function run() {
  const source = fs.readFileSync(path.join(__dirname, "../cloudfunctions/speakingLab/index.js"), "utf8");
  const workerSource = fs.readFileSync(path.join(__dirname, "../cloudfunctions/speakingAiWorker/index.js"), "utf8");
  const functionPackage = JSON.parse(fs.readFileSync(path.join(__dirname, "../cloudfunctions/speakingLab/package.json"), "utf8"));
  const packagerSource = fs.readFileSync(path.join(__dirname, "package-cloudfunctions.js"), "utf8");
  const prepareSource = fs.readFileSync(path.join(__dirname, "prepare-cloudbase-data.js"), "utf8");
  const importSource = fs.readFileSync(path.join(__dirname, "cloudbase-import-content.js"), "utf8");
  assert.match(source, /action === "processQueuedJob"/);
  ["listSpeakingSets", "getSpeakingSet", "teacherCreateSpeakingSet", "teacherUpdateSpeakingSet", "teacherDeleteSpeakingSet", "createIndividualResponse", "startIndividualResponseAudioUpload", "finishIndividualResponseAudioUpload", "startIndividualResponseAnalysis", "deleteIndividualResponse"].forEach((action) => assert.match(source, new RegExp(`action === "${action}"`)));
  assert.match(source, /SPEAKING_SET_STALE/);
  assert.match(source, /SPEAKING_SET_IN_USE/);
  assert.match(source, /visible_to_students !== true/);
  assert.match(source, /setSnapshot = lab\.buildGroupDiscussionSnapshot/);
  assert.match(source, /responseSnapshot = lab\.buildIndividualResponseSnapshot/);
  assert.match(source, /job_type: "individual_response_analysis"/);
  assert.match(source, /options\.includeReport \? \{ report: row\.report \|\| null \} : \{\}/, "Individual Response lists must not include full reports");
  assert.match(source, /INDIVIDUAL_RESPONSE_DURATION_LIMIT_SECONDS \+ lab\.INDIVIDUAL_RESPONSE_DURATION_TOLERANCE_SECONDS/, "ASR-measured response duration must be checked server-side");
  assert.match(source, /next_question_sequence/);
  assert.match(source, /response_session_id: claimed\.response_session_id/);
  assert.match(source, /async function studentOwnsSpeakingSetHistory/);
  assert.match(source, /studentOwnsSpeakingSetHistory\(actor, set\.set_id\)/);
  assert.match(source, /speaking_individual_responses/);
  assert.match(source, /getMany\(INDIVIDUAL_RESPONSES, \{ set_id: set\.set_id \}, 1\)/);
  assert.match(source, /individualResponseAnalysisPrompt/);
  assert.match(source, /individualResponseUserPrompt/);
  assert.doesNotMatch(source, /set_snapshot[\s\S]{0,200}part_b:\s*set\.part_b/, "Individual Response snapshots must not include unrelated questions");
  assert.match(workerSource, /job\.job_type === "individual_response_analysis"/);
  assert.match(prepareSource, /dse-paper4-sets\.json/);
  assert.match(prepareSource, /speaking-sets-cloudbase\.json/);
  assert.match(importSource, /speaking_sets/);
  assert.match(source, /action === "startVoiceRematch"/);
  assert.match(source, /action === "updateDiscussionTitle"/);
  assert.match(source, /async function updateDiscussionTitle/);
  assert.match(source, /DISCUSSION_TITLE_CHANGED/);
  assert.match(source, /can_edit_title:\s*lab\.canEditDiscussion/);
  assert.match(source, /job_type: "voice_rematch"/);
  assert.match(source, /active_voice_match_job_id/);
  assert.match(source, /source_report_id: sourceReport\.report_id/);
  assert.match(source, /async function processVoiceRematch/);
  assert.match(workerSource, /job\.job_type === "voice_rematch"/);
  assert.match(source, /invitation_source:\s*"automatic_voice_match"/);
  assert.match(source, /invitation_status:\s*invitationStatus/);
  assert.match(source, /ownPending[\s\S]*invitation_status === "pending"/);
  assert.match(source, /invitation_pending:\s*true/);
  assert.match(source, /dispatch_token/);
  assert.match(source, /SPEAKING_PROVIDER_NOT_CONFIGURED/);
  assert.doesNotMatch(source, /demo\s*=|fixture\s*=|provider_url\s*:/i);
  assert.doesNotMatch(source, /upload_metadata\s*:/, "temporary upload credentials must not be persisted");
  assert.doesNotMatch(source, /event\.speaker_keys|event\.candidate_speaker_keys/, "teacher mapping candidates must come from the server report");
  assert.doesNotMatch(source, /event\.asset_id[\s\S]{0,500}event\.start_ms/, "playback must not trust a browser-selected asset and range");
  assert.deepEqual(functionPackage.dependencies, {});
  assert.match(packagerSource, /new Set\(\["speakingLab", "speakingAiWorker"\]\)/);
  assert.match(packagerSource, /speakingRuntimeMaxBundleBytes = 900000/);
  assert.match(packagerSource, /function speakingRuntimeBundlePlugins\(functionName\)/);
  assert.match(packagerSource, /@cloudbase\\\/wx-cloud-client-sdk/);
  assert.match(packagerSource, /args\.importer\.includes\("\/@cloudbase\/node-sdk\/dist\/cloudbase\.js"\)/);
  assert.match(packagerSource, /plugins:\s*speakingRuntimeBundlePlugins\(functionName\)/);
  assert.match(packagerSource, /bundledBytes > speakingRuntimeMaxBundleBytes/);
  assert.match(packagerSource, /await esbuild\.build\(/);
  assert.doesNotMatch(packagerSource, /installedDependencies|@cloudbase\/node-sdk"\s*:\s*"3\.18\.1"/);

  const speakingTest = require("../cloudfunctions/speakingLab/index.js")._test;
  assert.equal(speakingTest.hasExactlyOneSessionLocator({ discussion_id: "d1" }), true);
  assert.equal(speakingTest.hasExactlyOneSessionLocator({ response_session_id: "r1" }), true);
  assert.equal(speakingTest.hasExactlyOneSessionLocator({ discussion_id: "d1", response_session_id: "r1" }), false);
  assert.equal(speakingTest.hasExactlyOneSessionLocator({}), false);
  assert.doesNotMatch(source, /getUploadMetadata/, "the gateway must not return fragile request-scoped COS credentials");
  assert.match(source, /uploaded_file_id/);
  assert.deepEqual(speakingTest.uploadTargetView("speaking-lab/path.mp3"), {
    upload_mode: "cloudbase_js_sdk",
    cloud_path: "speaking-lab/path.mp3",
  });
  assert.equal(
    speakingTest.verifiedUploadedFileId("cloud://env.bucket/speaking-lab/path.mp3", "speaking-lab/path.mp3"),
    "cloud://env.bucket/speaking-lab/path.mp3"
  );
  assert.throws(
    () => speakingTest.verifiedUploadedFileId("cloud://env.bucket/speaking-lab/other.mp3", "speaking-lab/path.mp3"),
    /AUDIO_UPLOAD_INCOMPLETE/
  );
  assert.throws(
    () => speakingTest.verifiedUploadedFileId("https://example.test/path.mp3", "speaking-lab/path.mp3"),
    /AUDIO_UPLOAD_INCOMPLETE/
  );

  assert.throws(() => speech.createSpeechProvider({ env: {} }), (error) => error.code === "SPEAKING_PROVIDER_NOT_CONFIGURED");
  assert.equal(model.providerConfigStatus({}).configured, false);
  assert.throws(() => model.createModelProvider({ env: {} }), (error) => error.code === "SPEAKING_PROVIDER_NOT_CONFIGURED");

  const normalized = speech.normalizedProviderOutput({ language: "en", duration_ms: 1234, speaker_tracks: [{ provider_speaker_id: "A", confidence: 2 }], segments: [{ provider_speaker_id: "A", start_ms: 0, end_ms: 1000, text: "hello" }] });
  assert.equal(normalized.speaker_tracks[0].confidence, 1);
  assert.equal(normalized.segments[0].text, "hello");
  const unknownConfidenceOutput = speech.normalizedProviderOutput({ speaker_tracks: [{ provider_speaker_id: "A", confidence: null }], segments: [{ provider_speaker_id: "A", start_ms: 0, end_ms: 1000, text: "hello", confidence: null }] });
  assert.equal(unknownConfidenceOutput.speaker_tracks[0].confidence, null);
  assert.equal(unknownConfidenceOutput.segments[0].confidence, null);
  await assert.rejects(() => Promise.resolve().then(() => speech.inspectAudio({ mime_type: "audio/webm", size_bytes: 10, duration_seconds: 69 })), (error) => error.code === "SPEAKING_AUDIO_TOO_LONG");
  assert.equal(model._test.normalizedUsage({}).total_tokens, null);

  assert.match(prompts.PROMPT_VERSION, /^dse-speaking-prompts-2026-08-28\./);
  const systemPrompt = prompts.dseAnalysisPrompt();
  assert.match(systemPrompt, /MANDATORY ASR SAFEGUARD/);
  assert.match(systemPrompt, /Never deduct a score, criticize the Candidate, or propose an exact correction solely because of one odd word/);
  assert.match(systemPrompt, /repeated in at least two distinct segments/);
  assert.match(systemPrompt, /Never infer or criticize pronunciation from transcript spelling/);
  const guardedUserPrompt = prompts.dseAnalysisUserPrompt({
    taskText: "Discuss a trend.",
    candidateSpeakerKeys: ["spk_01"],
    nonCandidateSpeakerKeys: [],
    schemaVersion: "test-schema",
    speakingTurns: [{ turn_id: "spk_01_turn_01", speaker_key: "spk_01", segment_ids: ["seg_0001", "seg_0002"], start_ms: 0, end_ms: 2000, text: "up killing trend a clear point", asr_text_status: "confidence_unknown" }],
    segments: [
      { segment_id: "seg_0001", speaker_key: "spk_01", start_ms: 0, end_ms: 1000, text: "up killing trend", confidence: null },
      { segment_id: "seg_0002", speaker_key: "spk_01", start_ms: 1000, end_ms: 2000, text: "a clear point", confidence: 0.5 },
      { segment_id: "seg_0003", speaker_key: "spk_01", start_ms: 2000, end_ms: 3000, text: "another point", confidence: 0.9 },
    ],
  });
  assert.match(guardedUserPrompt, /Do not turn one suspicious transcription token into a student error/);
  assert.match(guardedUserPrompt, /exactly one item for every speaking_turns item/);
  const guardedInput = JSON.parse(guardedUserPrompt.split("INPUT_JSON_BEGIN\n")[1].split("\nINPUT_JSON_END")[0]);
  assert.deepEqual(guardedInput.segments.map((segment) => [segment.asr_confidence, segment.asr_text_status]), [
    [null, "confidence_unknown"],
    [0.5, "low_confidence"],
    [0.9, "higher_confidence"],
  ]);
  assert.equal(guardedInput.speaking_turns[0].turn_id, "spk_01_turn_01");
  assert.match(systemPrompt, /Communication Strategies \(CS\)/);
  assert.match(systemPrompt, /Ideas & Organisation \(IO\)/);

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
    SPEAKING_AI_TEXT_API_URL: "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
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
  assert.equal(modelCalls[0].body.max_tokens, 12000);
  assert.equal(Object.prototype.hasOwnProperty.call(modelCalls[0].body, "max_completion_tokens"), false);
  assert.equal(modelCalls[0].body.enable_thinking, false);
  assert.equal(modelCalls[0].headers.Authorization, "Bearer private-test-key");

  await assert.rejects(
    () => model.callStructuredModel({ system_prompt: "Return JSON", user_prompt: "JSON input" }, {
      env: modelEnv,
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "diagnostic-request" },
        text: async () => JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{\"candidates\":[" } }] }),
      }),
    }),
    (error) => error.code === "SPEAKING_AI_SCHEMA_INVALID"
      && error.responseDiagnostics.finish_reason === "length"
      && error.responseDiagnostics.content_shape === "json_object"
      && error.responseDiagnostics.content_closed === false
      && error.responseDiagnostics.content_length === 15,
  );

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
  assert.equal(participantView.requires_voice_confirmation, true);
  const privateProposalView = require("../cloudfunctions/speakingLab/index.js")._test.participantView({ participant_id: "p-private", participant_kind: "vip", student_uid: "u-private", display_name_snapshot: "Private Proposal", invitation_status: "pending", invitation_source: "automatic_voice_match", identity_status: "ai_matched", matched_speaker_key: "spk_03", voice_match_score: 64 }, { auth_uid: "viewer", role: "student", active: true }, {}, 0);
  assert.equal(privateProposalView.roster_display_name, "Speaker 3", "a low-score automatic proposal must not expose the proposed VIP name to peers");
  assert.equal(privateProposalView.display_name, "Speaker 3");
  const lockedParticipantView = require("../cloudfunctions/speakingLab/index.js")._test.participantView({ participant_id: "p2", participant_kind: "vip", student_uid: "u2", display_name_snapshot: "Locked Name", invitation_status: "accepted", identity_status: "voiceprint_confirmed", matched_speaker_key: "spk_01", identity_notice_at: new Date("2026-08-29T00:00:00Z"), identity_notice_seen_at: null, voice_match_score: 88 }, { auth_uid: "u2", role: "student", active: true }, {}, 0);
  assert.equal(lockedParticipantView.display_name, "Locked Name");
  assert.equal(lockedParticipantView.identity_notice_unread, true);
  assert.equal(lockedParticipantView.requires_voice_confirmation, false);
  assert.equal(speakingTest.shanghaiDate(new Date("2026-08-27T16:30:00Z")), "2026-08-28");
  assert.equal(speakingTest.automaticMatchOutputPath({ discussion_id: "d1", job_id: "j1" }, "spk/01"), "speaking-lab/d1/voice-match/j1/spk_01.wav");
  const candidateViews = speakingTest.candidateTrackViews({
    transcript: { speaker_tracks: [
      { speaker_key: "spk_01", evaluation_role: "candidate", speech_duration_ms: 12000, turn_count: 2 },
      { speaker_key: "spk_02", evaluation_role: "candidate", speech_duration_ms: 14000, turn_count: 3 },
    ] },
    voice_matching: { status: "completed", results: [
      { speaker_key: "spk_01", status: "matched", score: 84 },
      { speaker_key: "spk_02", status: "review_required", reason: "BELOW_SCORE_THRESHOLD", score: 64 },
    ] },
  }, [
    { participant_id: "p1", participant_kind: "vip", student_uid: "u1", display_name_snapshot: "Private Name", invitation_status: "pending", identity_status: "ai_matched", matched_speaker_key: "spk_01", voice_match_score: 91 },
  ]);
  assert.equal(candidateViews[0].proposed_name, null, "unconfirmed VIP names must not replace Speaker labels");
  assert.equal(candidateViews[0].automatic_match_score, 91, "a rematch score on the participant mapping must supersede the original report score");
  assert.equal(candidateViews[1].automatic_match_reason, "BELOW_SCORE_THRESHOLD");

  const searchableDiscussion = speakingTest.discussionView(
    { auth_uid: "u1", role: "student", active: true },
    { discussion_id: "d1", analysis_status: "ready", active_report_version: "discussion-r1", formal_audio_asset_id: "asset1" },
    [{ participant_id: "p1", participant_kind: "vip", student_uid: "u1", invitation_status: "accepted" }],
  );
  assert.equal(searchableDiscussion.can_search_voice_matches, true);
  assert.equal(searchableDiscussion.voice_match_status, "not_run");
  const safeRematchState = speakingTest.completedVoiceMatchState({
    status: "completed",
    excerpt_jobs: [{ speaker_key: "spk_01", provider_job_id: "private-provider-job", output_file_id: "private-file", status: "ready" }],
    results: [{ speaker_key: "spk_01", status: "matched", score: 88, student_uid: "private-student", voiceprint_profile_id: "private-profile", participant_id: "p1" }],
  });
  assert.equal(safeRematchState.results[0].participant_id, "p1");
  assert.equal(Object.prototype.hasOwnProperty.call(safeRematchState.results[0], "student_uid"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safeRematchState.results[0], "voiceprint_profile_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safeRematchState.excerpt_jobs[0], "provider_job_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(safeRematchState.excerpt_jobs[0], "output_file_id"), false);

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
