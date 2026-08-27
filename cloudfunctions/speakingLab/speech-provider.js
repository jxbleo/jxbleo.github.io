"use strict";

const lab = require("../_shared/speaking-lab");

/*
 * V1 intentionally ships the provider boundary before a production adapter.
 * There is no silent fixture/demo path: the function entry point must call
 * createSpeechProvider(), which fails closed until an approved adapter exists.
 */
class SpeakingProviderError extends Error {
  constructor(code = "SPEAKING_PROVIDER_NOT_CONFIGURED") {
    super(code);
    this.code = code;
    this.name = "SpeakingProviderError";
  }
}

function createSpeechProvider() {
  throw new SpeakingProviderError();
}

function normalizedProviderOutput(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    language: lab.text(source.language || "en", 20) || "en",
    duration_ms: Number.isFinite(Number(source.duration_ms)) ? Math.max(0, Math.round(Number(source.duration_ms))) : 0,
    speaker_tracks: Array.isArray(source.speaker_tracks) ? source.speaker_tracks.map((track) => ({
      provider_speaker_id: lab.text(track && track.provider_speaker_id, 100),
      confidence: Number.isFinite(Number(track && track.confidence)) ? Math.max(0, Math.min(1, Number(track.confidence))) : null,
      speech_duration_ms: Number.isFinite(Number(track && track.speech_duration_ms)) ? Math.max(0, Math.round(Number(track.speech_duration_ms))) : null,
      turn_count: Number.isInteger(track && track.turn_count) ? Math.max(0, track.turn_count) : null,
      candidate_eligible: typeof (track && track.candidate_eligible) === "boolean" ? track.candidate_eligible : null,
    })).filter((track) => track.provider_speaker_id) : [],
    segments: Array.isArray(source.segments) ? source.segments.map((segment) => ({
      provider_speaker_id: lab.text(segment && segment.provider_speaker_id, 100),
      start_ms: Number(segment && segment.start_ms),
      end_ms: Number(segment && segment.end_ms),
      text: lab.text(segment && segment.text, 2000),
      confidence: Number.isFinite(Number(segment && segment.confidence)) ? Math.max(0, Math.min(1, Number(segment.confidence))) : null,
    })).filter((segment) => segment.provider_speaker_id) : [],
    usage: source.usage && typeof source.usage === "object" ? {
      input_tokens: Number.isInteger(source.usage.input_tokens) ? source.usage.input_tokens : null,
      output_tokens: Number.isInteger(source.usage.output_tokens) ? source.usage.output_tokens : null,
      total_tokens: Number.isInteger(source.usage.total_tokens) ? source.usage.total_tokens : null,
    } : {},
  };
}

function normalizeVoiceMatch(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    participant_asset_id: lab.text(source.participant_asset_id || source.asset_id, 120),
    provider_speaker_id: lab.text(source.provider_speaker_id, 100),
    score: Number.isFinite(Number(source.score)) ? Math.max(0, Math.min(1, Number(source.score))) : null,
    next_best_score: Number.isFinite(Number(source.next_best_score)) ? Math.max(0, Math.min(1, Number(source.next_best_score))) : null,
  };
}

async function inspectAudio() { throw new SpeakingProviderError(); }
async function transcribeAndDiarize() { throw new SpeakingProviderError(); }
async function matchVoiceReferences() { throw new SpeakingProviderError(); }

module.exports = {
  SpeakingProviderError,
  createSpeechProvider,
  inspectAudio,
  transcribeAndDiarize,
  matchVoiceReferences,
  normalizedProviderOutput,
  normalizeVoiceMatch,
};
