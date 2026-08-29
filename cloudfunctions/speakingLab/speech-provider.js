"use strict";

const lab = require("../_shared/speaking-lab");
const tencent = require("../_shared/tencent-asr-voiceprint");

const DEFAULT_PROVIDER = "tencent";
const DEFAULT_ENGINE = "16k_en";
const MAX_AUDIO_BYTES = 120 * 1024 * 1024;
const SUPPORTED_MIME = /^audio\/(webm|mp4|mpeg|wav|x-m4a|aac)$/;

class SpeakingProviderError extends Error {
  constructor(code = "SPEAKING_PROVIDER_NOT_CONFIGURED", options = {}) {
    super(code);
    this.code = code;
    this.name = "SpeakingProviderError";
    this.providerCode = options.providerCode || null;
    this.requestId = options.requestId || null;
  }
}

function text(value, limit = 500) {
  return String(value == null ? "" : value).trim().slice(0, limit);
}

function providerConfigStatus(env = process.env) {
  const provider = text(env && env.SPEAKING_ASR_PROVIDER || DEFAULT_PROVIDER, 40).toLowerCase();
  const missing = [];
  if (provider !== "tencent") return { configured: false, provider, missing: ["SPEAKING_ASR_PROVIDER"] };
  if (!text(env && env.TENCENTCLOUD_SECRETID, 300)) missing.push("TENCENTCLOUD_SECRETID");
  if (!text(env && env.TENCENTCLOUD_SECRETKEY, 300)) missing.push("TENCENTCLOUD_SECRETKEY");
  return { configured: missing.length === 0, provider, missing };
}

function safeAsrError(error) {
  const providerCode = text(error && error.providerCode || error && error.code || error && error.message, 200);
  if (/AuthFailure|UnauthorizedOperation|NOT_CONFIGURED/i.test(providerCode)) return "SPEAKING_PROVIDER_NOT_CONFIGURED";
  if (/FailedOperation|Download|Audio|Decode|InvalidParameter|Parameter/i.test(providerCode)) return "SPEAKING_AUDIO_NOT_RELIABLY_SCORABLE";
  if (/RequestLimit|LimitExceeded|ResourceUnavailable|InternalError|Unavailable|Timeout|Network/i.test(providerCode)) return "SPEAKING_ASR_UNAVAILABLE";
  return "SPEAKING_ASR_FAILED";
}

function endpoint(env = process.env) {
  return text(env && (env.SPEAKING_ASR_ENDPOINT || env.SPEAKING_TENCENT_ASR_ENDPOINT), 500) || undefined;
}

function engine(env = process.env) {
  const value = text(env && env.SPEAKING_ASR_ENGINE_MODEL_TYPE || DEFAULT_ENGINE, 80);
  if (!/^[A-Za-z0-9_.-]{2,80}$/.test(value)) throw new SpeakingProviderError("SPEAKING_PROVIDER_NOT_CONFIGURED");
  return value;
}

function requestOptions(options = {}) {
  const selectedEndpoint = endpoint(options.env || process.env);
  return {
    env: options.env || process.env,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.timestamp != null ? { timestamp: options.timestamp } : {}),
    ...(options.timeoutMs != null ? { timeoutMs: options.timeoutMs } : {}),
    ...(selectedEndpoint ? { endpoint: selectedEndpoint } : {}),
  };
}

function createSpeechProvider(options = {}) {
  const env = options.env || process.env;
  const status = providerConfigStatus(env);
  if (!status.configured) throw new SpeakingProviderError("SPEAKING_PROVIDER_NOT_CONFIGURED");
  return {
    name: status.provider,
    inspectAudio: (input) => inspectAudio(input),
    transcribeAndDiarize: (input) => transcribeAndDiarize(input, { ...options, env }),
    matchVoiceReferences: (input) => matchVoiceReferences(input, { ...options, env }),
  };
}

function normalizedProviderOutput(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    language: lab.text(source.language || "en", 20) || "en",
    duration_ms: Number.isFinite(Number(source.duration_ms)) ? Math.max(0, Math.round(Number(source.duration_ms))) : 0,
    speaker_tracks: Array.isArray(source.speaker_tracks) ? source.speaker_tracks.map((track) => ({
      provider_speaker_id: lab.text(track && track.provider_speaker_id, 100),
      confidence: track && track.confidence != null && Number.isFinite(Number(track.confidence)) ? Math.max(0, Math.min(1, Number(track.confidence))) : null,
      speech_duration_ms: track && track.speech_duration_ms != null && Number.isFinite(Number(track.speech_duration_ms)) ? Math.max(0, Math.round(Number(track.speech_duration_ms))) : null,
      turn_count: Number.isInteger(track && track.turn_count) ? Math.max(0, track.turn_count) : null,
      candidate_eligible: typeof (track && track.candidate_eligible) === "boolean" ? track.candidate_eligible : null,
    })).filter((track) => track.provider_speaker_id) : [],
    segments: Array.isArray(source.segments) ? source.segments.map((segment) => ({
      provider_speaker_id: lab.text(segment && segment.provider_speaker_id, 100),
      start_ms: Number(segment && segment.start_ms),
      end_ms: Number(segment && segment.end_ms),
      text: lab.text(segment && segment.text, 2000),
      confidence: segment && segment.confidence != null && Number.isFinite(Number(segment.confidence)) ? Math.max(0, Math.min(1, Number(segment.confidence))) : null,
    })).filter((segment) => segment.provider_speaker_id) : [],
    usage: source.usage && typeof source.usage === "object" ? {
      input_tokens: Number.isInteger(source.usage.input_tokens) ? source.usage.input_tokens : null,
      output_tokens: Number.isInteger(source.usage.output_tokens) ? source.usage.output_tokens : null,
      total_tokens: Number.isInteger(source.usage.total_tokens) ? source.usage.total_tokens : null,
      audio_seconds: source.usage.audio_seconds != null && Number.isFinite(Number(source.usage.audio_seconds)) ? Math.max(0, Number(source.usage.audio_seconds)) : null,
    } : {},
  };
}

function normalizeVoiceMatch(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    participant_asset_id: lab.text(source.participant_asset_id || source.asset_id, 120),
    provider_speaker_id: lab.text(source.provider_speaker_id, 100),
    score: source.score != null && Number.isFinite(Number(source.score)) ? Math.max(0, Math.min(1, Number(source.score))) : null,
    next_best_score: source.next_best_score != null && Number.isFinite(Number(source.next_best_score)) ? Math.max(0, Math.min(1, Number(source.next_best_score))) : null,
  };
}

async function inspectAudio(input = {}) {
  const mime = text(input.mime_type, 80).toLowerCase();
  const size = Number(input.size_bytes);
  const duration = Number(input.duration_seconds);
  if (!SUPPORTED_MIME.test(mime) || !Number.isFinite(size) || size < 1 || size > MAX_AUDIO_BYTES) {
    throw new SpeakingProviderError("SPEAKING_AUDIO_NOT_RELIABLY_SCORABLE");
  }
  if (Number.isFinite(duration) && duration > 68) throw new SpeakingProviderError("SPEAKING_AUDIO_TOO_LONG");
  return { status: "scorable", warning_codes: [], mime_type: mime, size_bytes: Math.round(size), duration_seconds: Number.isFinite(duration) ? Math.max(0, duration) : null };
}

function taskIdFrom(result) {
  const id = Number(result && result.Data && result.Data.TaskId);
  if (!Number.isSafeInteger(id) || id < 1) throw new SpeakingProviderError("SPEAKING_ASR_INVALID_RESPONSE", { requestId: result && result.RequestId });
  return id;
}

function normalizeTencentResult(data, requestId) {
  const details = Array.isArray(data && data.ResultDetail) ? data.ResultDetail : [];
  const segments = details.map((sentence) => ({
    provider_speaker_id: `tencent_${Number.isInteger(Number(sentence && sentence.SpeakerId)) ? Number(sentence.SpeakerId) : 0}`,
    start_ms: Number(sentence && sentence.StartMs),
    end_ms: Number(sentence && sentence.EndMs),
    text: text(sentence && (sentence.FinalSentence || sentence.SliceSentence), 2000),
    confidence: null,
  })).filter((item) => item.text);
  const aggregate = new Map();
  segments.forEach((segment) => {
    const current = aggregate.get(segment.provider_speaker_id) || { speech_duration_ms: 0, turn_count: 0 };
    current.speech_duration_ms += Math.max(0, Number(segment.end_ms) - Number(segment.start_ms));
    current.turn_count += 1;
    aggregate.set(segment.provider_speaker_id, current);
  });
  const output = normalizedProviderOutput({
    language: "en",
    duration_ms: Math.round(Math.max(0, Number(data && data.AudioDuration) || 0) * 1000),
    speaker_tracks: [...aggregate.entries()].map(([provider_speaker_id, stats]) => ({ provider_speaker_id, ...stats })),
    segments,
    usage: { audio_seconds: Math.max(0, Number(data && data.AudioDuration) || 0) },
  });
  if (!output.duration_ms || !output.segments.length || !output.speaker_tracks.length) {
    throw new SpeakingProviderError("SPEAKING_ASR_INVALID_RESPONSE", { requestId });
  }
  return output;
}

async function transcribeAndDiarize(input = {}, options = {}) {
  const env = options.env || process.env;
  const apiOptions = requestOptions(options);
  try {
    if (input.task_id != null) {
      const taskId = Number(input.task_id);
      if (!Number.isSafeInteger(taskId) || taskId < 1) throw new SpeakingProviderError("SPEAKING_ASR_TASK_INVALID");
      const result = await tencent.request("DescribeTaskStatus", { TaskId: taskId }, apiOptions);
      const data = result && result.Data || {};
      const status = Number(data.Status);
      if (status === 0 || status === 1) return { status: "pending", task_id: taskId, request_id: text(result.RequestId, 200) };
      if (status === 3) throw new SpeakingProviderError("SPEAKING_ASR_FAILED", { providerCode: text(data.ErrorMsg, 200), requestId: result.RequestId });
      if (status !== 2) throw new SpeakingProviderError("SPEAKING_ASR_INVALID_RESPONSE", { requestId: result.RequestId });
      return { status: "completed", task_id: taskId, request_id: text(result.RequestId, 200), output: normalizeTencentResult(data, result.RequestId) };
    }
    const audioUrl = text(input.audio_url, 2000);
    let parsed;
    try { parsed = new URL(audioUrl); } catch (_error) { throw new SpeakingProviderError("SPEAKING_ASR_AUDIO_URL_INVALID"); }
    if (parsed.protocol !== "https:" && !/\.example\.test$/i.test(parsed.hostname)) throw new SpeakingProviderError("SPEAKING_ASR_AUDIO_URL_INVALID");
    const result = await tencent.request("CreateRecTask", {
      EngineModelType: engine(env),
      ChannelNum: 1,
      ResTextFormat: 1,
      SourceType: 0,
      Url: audioUrl,
      SpeakerDiarization: 1,
      SpeakerNumber: 0,
      FilterDirty: 0,
      FilterModal: 0,
      FilterPunc: 0,
      ConvertNumMode: 1,
    }, apiOptions);
    return { status: "pending", task_id: taskIdFrom(result), request_id: text(result.RequestId, 200) };
  } catch (error) {
    if (error instanceof SpeakingProviderError) throw error;
    throw new SpeakingProviderError(safeAsrError(error), { providerCode: error && error.providerCode, requestId: error && error.requestId });
  }
}

async function matchVoiceReferences() {
  return { status: "not_available", matches: [] };
}

module.exports = {
  SpeakingProviderError,
  createSpeechProvider,
  providerConfigStatus,
  inspectAudio,
  transcribeAndDiarize,
  matchVoiceReferences,
  normalizedProviderOutput,
  normalizeVoiceMatch,
  _test: { engine, endpoint, safeAsrError, normalizeTencentResult, taskIdFrom },
};
