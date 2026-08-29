"use strict";

/*
 * DSE Speaking Lab's policy boundary.  This module deliberately has no
 * CloudBase, provider, or environment dependencies: callers pass the rows
 * they have already authorised and receive plain JSON values back.
 */

const crypto = require("crypto");

const DEFAULT_DURATION_SECONDS = 120;
const MIN_DURATION_SECONDS = 180;
const MAX_DURATION_SECONDS = 1800;
const MIN_SCORING_PARTICIPANTS = 3;
const MAX_SCORING_PARTICIPANTS = 6;
const SPEAKER_CONFIDENCE_MIN = 0.5;
const AUTOMATIC_VOICE_MATCH_MIN_SCORE = 70;
const VOICEPRINT_EXCERPT_MIN_MS = 8000;
const VOICEPRINT_EXCERPT_MAX_MS = 20000;
const MAX_REPORT_LIST_ITEMS = 12;
const MAX_COMMENTARY_LENGTH = 1200;
const MAX_TURN_REVIEWS_PER_CANDIDATE = 80;
const SPEAKING_TURN_GAP_MS = 2500;
const ASSESSED_DOMAINS = [
  "communication_strategies",
  "vocabulary_language_patterns",
  "ideas_organisation",
];

// Speaking Sets intentionally do not use the general LMS `sets` collection.
// Their content is versioned and snapshotted at Session creation, so keep all
// validation in this dependency-free boundary shared by the gateway and tests.
const SPEAKING_SET_ID_MIN = 12;
const SPEAKING_SET_ID_MAX = 160;
const SPEAKING_SET_TITLE_MAX = 160;
const SPEAKING_SET_SOURCE_NOTE_MAX = 1000;
const SPEAKING_SET_CONTEXT_TITLE_MAX = 300;
const SPEAKING_SET_CONTEXT_MAX_CHARS = 20000;
const SPEAKING_SET_CONTEXT_MAX_PARAGRAPHS = 20;
const SPEAKING_SET_PART_A_MAX = 12;
const SPEAKING_SET_PART_B_MAX = 20;
const INDIVIDUAL_RESPONSE_DURATION_LIMIT_SECONDS = 65;
const INDIVIDUAL_RESPONSE_DURATION_TOLERANCE_SECONDS = 3;
const INDIVIDUAL_RESPONSE_REPORT_SCHEMA_VERSION = "dse-individual-response-v1";

function text(value, limit = 2000) {
  return String(value == null ? "" : value).normalize("NFKC").trim().slice(0, limit);
}

function normalizeWhitespace(value, limit = 2000) {
  return text(value, limit).replace(/\s+/g, " ").trim();
}

function normalizeGuestName(value) {
  return normalizeWhitespace(value, 120).toLocaleLowerCase("en");
}

function displayGuestName(value) {
  return normalizeWhitespace(value, 120);
}

function participantKind(participant) {
  return participant && (participant.participant_kind === "guest" || participant.kind === "guest") ? "guest" : "vip";
}

function isGuestNameAvailable(participants, value, exceptParticipantId = "") {
  const normalized = normalizeGuestName(value);
  if (!normalized) return false;
  return !(Array.isArray(participants) ? participants : []).some((participant) => {
    if (!participant || String(participant.participant_id || participant._id || "") === String(exceptParticipantId || "")) return false;
    const current = participantKind(participant) === "guest"
      ? participant.guest_name_normalized || participant.guest_name
      : participant.display_name_snapshot || participant.display_name || participant.english_name || participant.name;
    return normalizeGuestName(current) === normalized;
  });
}

function normalizeParticipantCount(value) {
  const count = Number(value);
  return Number.isInteger(count) ? count : 0;
}

function participantCountEligibility(value) {
  const count = normalizeParticipantCount(value);
  const eligible = count >= MIN_SCORING_PARTICIPANTS && count <= MAX_SCORING_PARTICIPANTS;
  return { count, eligible, reason: eligible ? null : "DSE_REQUIRES_THREE_TO_SIX" };
}

function durationForParticipantCount(count) {
  const participantCount = Math.max(1, normalizeParticipantCount(count));
  return Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, participantCount * DEFAULT_DURATION_SECONDS));
}

function normalizeDurationSeconds(value, participantCount = 4) {
  const fallback = durationForParticipantCount(participantCount);
  const duration = Number(value);
  if (!Number.isFinite(duration)) return fallback;
  return Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, Math.round(duration)));
}

function durationIsValid(value) {
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= MIN_DURATION_SECONDS && duration <= MAX_DURATION_SECONDS;
}

function actorUid(actor) {
  return String(actor && (actor.auth_uid || actor.uid || actor.authUid) || "").trim();
}

function isTeacher(actor) {
  return Boolean(actor && actor.active !== false && actor.role === "teacher" && actorUid(actor));
}

function isActiveStudent(actor) {
  return Boolean(actor && actor.active !== false && actor.role === "student" && actorUid(actor));
}

function participantUid(participant) {
  return String(participant && participant.student_uid || "").trim();
}

function participantIsAccepted(participant) {
  return Boolean(participant && participantKind(participant) === "vip" && participant.invitation_status === "accepted" && participantUid(participant));
}

function identityIsConfirmed(participant) {
  return Boolean(participant && ["voiceprint_confirmed", "student_confirmed", "teacher_confirmed"].includes(String(participant.identity_status || "")));
}

function participantForUid(participants, uid) {
  const target = String(uid || "");
  return (Array.isArray(participants) ? participants : []).find((participant) => participantUid(participant) === target) || null;
}

function isCreator(actor, discussion) {
  return Boolean(actorUid(actor) && discussion && String(discussion.creator_uid || "") === actorUid(actor));
}

function canReadDiscussion(actor, discussion, participants = []) {
  if (!discussion || discussion.deleted_at != null) return false;
  if (isTeacher(actor)) return true;
  if (!isActiveStudent(actor)) return false;
  return isCreator(actor, discussion) || Boolean(participantForUid(participants, actorUid(actor)) && participantIsAccepted(participantForUid(participants, actorUid(actor))));
}

function canEditDiscussion(actor, discussion, participants = []) {
  if (isTeacher(actor)) return true;
  return isActiveStudent(actor) && isCreator(actor, discussion) && canReadDiscussion(actor, discussion, participants);
}

function canInviteOrFreeze(actor, discussion, participants = []) {
  return canEditDiscussion(actor, discussion, participants);
}

function canAcceptInvitation(actor, participant, discussion) {
  return isActiveStudent(actor) && participant && participantKind(participant) === "vip" && participant.invitation_status === "pending" &&
    participantUid(participant) === actorUid(actor) && Boolean(discussion && discussion.deleted_at == null);
}

function canConfirmVoice(actor, participant, discussion) {
  return isActiveStudent(actor) && participant && participantKind(participant) === "vip" &&
    participantUid(participant) === actorUid(actor) && participant.invitation_status === "accepted" &&
    Boolean(discussion && discussion.deleted_at == null);
}

function canCreateStudentShare(actor, participant, discussion) {
  if (!canReadDiscussion(actor, discussion, [participant])) return false;
  if (!participant || participantUid(participant) !== actorUid(actor)) return false;
  return identityIsConfirmed(participant) && Boolean(participant.matched_speaker_key);
}

function canCreateTeacherShare(actor, discussion) {
  return isTeacher(actor) && Boolean(discussion && discussion.deleted_at == null);
}

function normalizeParticipant(participant, index = 0) {
  const source = participant || {};
  const kind = participantKind(source);
  const id = text(source.participant_id || source._id || `participant_${index + 1}`, 120);
  const guestName = displayGuestName(source.guest_name || source.display_name || "");
  const hasStudent = kind === "vip" && Boolean(participantUid(source));
  const name = kind === "guest"
    ? guestName
    : normalizeWhitespace(source.english_name || source.display_name_snapshot || source.name || source.student_name || "", 160);
  return {
    participant_id: id,
    kind,
    student_uid: hasStudent ? participantUid(source) : null,
    student_id_snapshot: kind === "vip" ? text(source.student_id_snapshot || source.student_id || "", 120) || null : null,
    display_name: name || (kind === "guest" ? "Guest participant" : "VIP participant"),
    guest_name: kind === "guest" ? guestName : null,
    guest_name_normalized: kind === "guest" ? normalizeGuestName(guestName) : null,
    invitation_status: kind === "vip" ? text(source.invitation_status || "pending", 30) : "accepted",
    identity_status: text(source.identity_status || "unconfirmed", 40),
    matched_speaker_key: text(source.matched_speaker_key || "", 40) || null,
    mapping_revision: Number.isInteger(source.mapping_revision) ? source.mapping_revision : 0,
  };
}

function participantName(participant, options = {}) {
  const normalized = normalizeParticipant(participant);
  if (normalized.kind === "guest") return normalized.guest_name || "Guest participant";
  return identityIsConfirmed(normalized) ? normalized.display_name : "";
}

function identityProjection(participant, options = {}) {
  const normalized = normalizeParticipant(participant);
  const speakerKey = normalized.matched_speaker_key || null;
  if (!speakerKey) return { label: options.fallbackLabel || "Unmatched speaker", speaker_key: null, named: false, guest: false };
  if (normalized.kind === "guest") {
    return { label: `${normalized.guest_name || "Guest participant"} · Guest participant · Name not verified`, speaker_key: speakerKey, named: true, guest: true };
  }
  // A teacher may correct or lock a mapping, but merely viewing as a teacher
  // (or viewing one's own row) must never bypass the confirmation state.
  const canName = identityIsConfirmed(normalized);
  return { label: canName ? normalized.display_name : (options.fallbackLabel || "Speaker"), speaker_key: speakerKey, named: canName, guest: false };
}

function canonicalSpeakerKey(value, index = 0) {
  const explicit = text(value, 50).replace(/[^A-Za-z0-9_-]/g, "");
  return explicit || `spk_${String(index + 1).padStart(2, "0")}`;
}

function canonicalizeSpeakerTracks(tracks, segments, options = {}) {
  const sourceTracks = Array.isArray(tracks) ? tracks : [];
  const sourceSegments = Array.isArray(segments) ? segments : [];
  const firstStart = new Map();
  sourceSegments.forEach((segment) => {
    const provider = text(segment && segment.provider_speaker_id, 100);
    const start = Number(segment && segment.start_ms);
    if (!provider || !Number.isFinite(start) || start < 0) return;
    firstStart.set(provider, Math.min(firstStart.has(provider) ? firstStart.get(provider) : start, start));
  });
  const ids = [...new Set(sourceTracks.map((track) => text(track && track.provider_speaker_id, 100)).filter(Boolean))];
  sourceSegments.forEach((segment) => {
    const provider = text(segment && segment.provider_speaker_id, 100);
    if (provider && !ids.includes(provider)) ids.push(provider);
  });
  ids.sort((left, right) => (firstStart.get(left) ?? Number.MAX_SAFE_INTEGER) - (firstStart.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right));
  const minimumConfidence = options.minimumConfidence == null ? SPEAKER_CONFIDENCE_MIN : Number(options.minimumConfidence);
  const keyByProvider = new Map(ids.map((provider, index) => [provider, `spk_${String(index + 1).padStart(2, "0")}`]));
  const canonicalTracks = ids.map((provider) => {
    const source = sourceTracks.find((track) => text(track && track.provider_speaker_id, 100) === provider) || {};
    const confidence = source.confidence == null ? null : Number(source.confidence);
    const speechDuration = source.speech_duration_ms == null ? null : Number(source.speech_duration_ms);
    const turnCount = Number(source.turn_count);
    return {
      speaker_key: keyByProvider.get(provider),
      confidence: confidence != null && Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
      // Tencent recording-file diarization currently supplies SpeakerId but no
      // per-track confidence. Missing confidence is therefore unknown, not an
      // automatic rejection; explicit provider/server rejection still wins.
      reliable: confidence != null && Number.isFinite(confidence) ? confidence >= minimumConfidence : source.candidate_eligible !== false,
      speech_duration_ms: speechDuration != null && Number.isFinite(speechDuration) ? Math.max(0, Math.round(speechDuration)) : null,
      turn_count: Number.isInteger(turnCount) ? Math.max(0, turnCount) : null,
      candidate_eligible: typeof source.candidate_eligible === "boolean" ? source.candidate_eligible : null,
    };
  });
  return { tracks: canonicalTracks, keyByProvider, providerIds: ids };
}

function canonicalizeSegments(segments, speakerInfo, durationMs, options = {}) {
  const maxSegments = Number.isInteger(options.maxSegments) ? options.maxSegments : 2000;
  const duration = Number.isFinite(Number(durationMs)) ? Number(durationMs) : Number.MAX_SAFE_INTEGER;
  const output = [];
  const rejected = [];
  (Array.isArray(segments) ? segments : []).slice(0, maxSegments).forEach((source, index) => {
    const provider = text(source && source.provider_speaker_id, 100);
    const start = Number(source && source.start_ms);
    const end = Number(source && source.end_ms);
    const line = text(source && source.text, 2000);
    const speakerKey = speakerInfo && speakerInfo.keyByProvider && speakerInfo.keyByProvider.get(provider);
    if (!speakerKey || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration || !line) {
      rejected.push({ index, reason: "SEGMENT_INVALID" });
      return;
    }
    output.push({
      segment_id: `seg_${String(output.length + 1).padStart(4, "0")}`,
      speaker_key: speakerKey,
      start_ms: Math.round(start),
      end_ms: Math.round(end),
      text: line,
      confidence: source.confidence != null && Number.isFinite(Number(source.confidence)) ? Math.max(0, Math.min(1, Number(source.confidence))) : null,
    });
  });
  return { segments: output, rejected };
}

function isLikelyFacilitatorCue(segment) {
  const start = Number(segment && segment.start_ms);
  const line = normalizeWhitespace(segment && segment.text, 500).toLowerCase().replace(/[.!?]+$/g, "");
  if (!Number.isFinite(start) || start < 0 || start > 15000 || !line) return false;
  return /^(?:okay[, ]+)?(?:you (?:may|can)|please) (?:now )?start (?:(?:the|your|a) )?(?:group )?discussion(?: now)?$/.test(line);
}

function candidateSpeakerKeys(tracks, participants, options = {}) {
  const allTracks = Array.isArray(tracks) ? tracks : [];
  const listedCount = (Array.isArray(participants) ? participants : []).filter((participant) =>
    participant && ["guest", "vip"].includes(participantKind(participant))).length;
  const candidateLimit = options.independent === true
    ? MAX_SCORING_PARTICIPANTS
    : Math.min(MAX_SCORING_PARTICIPANTS, Math.max(0, listedCount));
  const minimumConfidence = options.minimumConfidence == null ? SPEAKER_CONFIDENCE_MIN : Number(options.minimumConfidence);
  const reliable = allTracks.filter((track) => track && track.candidate_eligible !== false && track.reliable !== false && (track.confidence == null || Number(track.confidence) >= minimumConfidence));
  // A brief outside voice can appear before every Candidate. Select the most
  // sustained reliable tracks first, then restore canonical first-speech order
  // for stable report presentation.
  const originalOrder = new Map(allTracks.map((track, index) => [track.speaker_key, index]));
  const candidate = reliable.slice().sort((left, right) =>
    Number(right.speech_duration_ms || 0) - Number(left.speech_duration_ms || 0)
    || Number(right.turn_count || 0) - Number(left.turn_count || 0)
    || Number(originalOrder.get(left.speaker_key)) - Number(originalOrder.get(right.speaker_key)))
    .slice(0, candidateLimit)
    .sort((left, right) => Number(originalOrder.get(left.speaker_key)) - Number(originalOrder.get(right.speaker_key)))
    .map((track) => track.speaker_key);
  const candidateSet = new Set(candidate);
  return {
    candidate_keys: candidate,
    non_candidate_keys: allTracks.map((track) => track.speaker_key).filter((key) => !candidateSet.has(key)),
    reason_by_key: Object.fromEntries(allTracks.map((track, index) => [track.speaker_key, candidateSet.has(track.speaker_key) ? null : (track.candidate_eligible === false ? "POSSIBLE_NON_CANDIDATE" : (index >= candidateLimit ? "EXTRA_SPEAKER" : "LOW_CONFIDENCE"))]).filter((entry) => entry[1])),
  };
}

function voiceprintExcerptPlans(segments, candidateSpeakerKeys, options = {}) {
  const minimumMs = Math.max(VOICEPRINT_EXCERPT_MIN_MS, Number(options.minimumMs || VOICEPRINT_EXCERPT_MIN_MS));
  const maximumMs = Math.min(30000, Math.max(minimumMs, Number(options.maximumMs || VOICEPRINT_EXCERPT_MAX_MS)));
  const turns = canonicalSpeakingTurns(segments, candidateSpeakerKeys);
  const bestBySpeaker = new Map();
  turns.forEach((turn) => {
    const durationMs = Math.max(0, Number(turn.end_ms || 0) - Number(turn.start_ms || 0));
    if (durationMs < minimumMs) return;
    const plan = {
      speaker_key: turn.speaker_key,
      start_ms: Math.max(0, Math.round(Number(turn.start_ms || 0))),
      duration_ms: Math.min(maximumMs, Math.round(durationMs)),
      source_turn_id: turn.turn_id,
    };
    const current = bestBySpeaker.get(turn.speaker_key);
    if (!current || plan.duration_ms > current.duration_ms || (plan.duration_ms === current.duration_ms && plan.start_ms < current.start_ms)) {
      bestBySpeaker.set(turn.speaker_key, plan);
    }
  });
  return (Array.isArray(candidateSpeakerKeys) ? candidateSpeakerKeys : []).map(String).map((key) => bestBySpeaker.get(key)).filter(Boolean);
}

function automaticVoiceMatches(results, options = {}) {
  const minimumScore = Number.isFinite(Number(options.minimumScore)) ? Number(options.minimumScore) : AUTOMATIC_VOICE_MATCH_MIN_SCORE;
  const proposals = (Array.isArray(results) ? results : []).map((result) => {
    const ranked = (Array.isArray(result && result.matches) ? result.matches : []).map((match) => ({
      student_uid: text(match && match.student_uid, 160),
      voiceprint_profile_id: text(match && match.voiceprint_profile_id, 160) || null,
      score: Number(match && match.score),
    })).filter((match) => match.student_uid && Number.isFinite(match.score)).sort((left, right) => right.score - left.score || left.student_uid.localeCompare(right.student_uid));
    const top = ranked[0] || null;
    const runnerUp = ranked[1] || null;
    const margin = top ? top.score - Number(runnerUp ? runnerUp.score : 0) : null;
    let reason = null;
    if (!top) reason = "NO_REGISTERED_MATCH";
    else if (top.score < minimumScore) reason = "BELOW_SCORE_THRESHOLD";
    return {
      speaker_key: text(result && result.speaker_key, 60),
      top,
      next_best_score: runnerUp ? runnerUp.score : null,
      margin,
      reason,
    };
  }).filter((item) => item.speaker_key);
  const usedStudents = new Set();
  const resolvedBySpeaker = new Map();
  proposals.filter((item) => item.top).sort((left, right) => right.top.score - left.top.score || right.margin - left.margin || left.speaker_key.localeCompare(right.speaker_key)).forEach((item) => {
    if (usedStudents.has(item.top.student_uid)) {
      resolvedBySpeaker.set(item.speaker_key, { ...item, reason: "ONE_TO_ONE_CONFLICT" });
      return;
    }
    usedStudents.add(item.top.student_uid);
    resolvedBySpeaker.set(item.speaker_key, item);
  });
  return proposals.map((item) => {
    const resolved = resolvedBySpeaker.get(item.speaker_key) || item;
    const reviewRequired = resolved.reason === "BELOW_SCORE_THRESHOLD" && Boolean(resolved.top);
    const matched = !resolved.reason && Boolean(resolved.top);
    return {
      speaker_key: resolved.speaker_key,
      status: matched ? "matched" : reviewRequired ? "review_required" : "unmatched",
      student_uid: matched || reviewRequired ? resolved.top.student_uid : null,
      voiceprint_profile_id: matched || reviewRequired ? resolved.top.voiceprint_profile_id : null,
      score: resolved.top ? resolved.top.score : null,
      next_best_score: resolved.next_best_score,
      margin: resolved.margin,
      reason: resolved.reason,
    };
  });
}

function canonicalizeMapping(mapping, speakerKeys, participants, options = {}) {
  const validSpeakers = new Set((Array.isArray(speakerKeys) ? speakerKeys : []).map((key) => String(key)));
  const participantRows = Array.isArray(participants) ? participants : [];
  const candidateSet = new Set((options.candidateSpeakerKeys || speakerKeys || []).map(String));
  const source = Array.isArray(mapping) ? mapping : Object.entries(mapping || {}).map(([participant_id, speaker_key]) => ({ participant_id, speaker_key }));
  const rows = [];
  const seenParticipants = new Set();
  const seenSpeakers = new Set();
  for (const item of source) {
    const participantId = text(item && item.participant_id, 120);
    const speakerKey = text(item && item.speaker_key, 60);
    if (!participantId || !speakerKey) throw new Error("VOICE_MAPPING_INCOMPLETE");
    if (seenParticipants.has(participantId)) throw new Error("VOICE_MAPPING_DUPLICATE_PARTICIPANT");
    if (seenSpeakers.has(speakerKey)) throw new Error("VOICE_MAPPING_DUPLICATE_SPEAKER");
    if (!validSpeakers.has(speakerKey) || !candidateSet.has(speakerKey)) throw new Error("VOICE_MAPPING_SPEAKER_INVALID");
    const participant = participantRows.find((row) => String(row.participant_id || row._id || "") === participantId);
    if (!participant) throw new Error("VOICE_MAPPING_PARTICIPANT_INVALID");
    seenParticipants.add(participantId);
    seenSpeakers.add(speakerKey);
    rows.push({ participant_id: participantId, speaker_key: speakerKey });
  }
  if (options.requireAll === true) {
    const required = participantRows.filter((row) => ["vip", "guest"].includes(participantKind(row)));
    if (rows.length !== required.length || required.some((row) => !seenParticipants.has(String(row.participant_id || row._id || "")))) throw new Error("VOICE_MAPPING_INCOMPLETE");
  }
  rows.sort((left, right) => left.participant_id.localeCompare(right.participant_id));
  return rows;
}

function safeList(value, limit = MAX_REPORT_LIST_ITEMS) {
  return (Array.isArray(value) ? value : []).map((item) => text(item, 240)).filter(Boolean).slice(0, limit);
}

function safeCommentary(value) {
  return text(value, MAX_COMMENTARY_LENGTH).replace(/[<>]/g, "");
}

function turnTextStatus(segments) {
  const rows = Array.isArray(segments) ? segments : [];
  const confidences = rows.filter((segment) => segment && segment.confidence != null && segment.confidence !== "")
    .map((segment) => Number(segment.confidence)).filter(Number.isFinite);
  if (confidences.some((confidence) => confidence < 0.75)) return "low_confidence";
  if (confidences.length === rows.length && rows.length) return "higher_confidence";
  return "confidence_unknown";
}

function canonicalSpeakingTurns(segments, candidateSpeakerKeys, options = {}) {
  const candidates = new Set((Array.isArray(candidateSpeakerKeys) ? candidateSpeakerKeys : []).map(String));
  const gapMs = Math.max(0, Number(options.gap_ms == null ? SPEAKING_TURN_GAP_MS : options.gap_ms) || 0);
  const turns = [];
  let current = null;
  (Array.isArray(segments) ? segments : []).forEach((segment) => {
    const speakerKey = String(segment && segment.speaker_key || "");
    const candidate = candidates.has(speakerKey) && segment && segment.evaluation_role !== "non_candidate_context";
    const startMs = Math.max(0, Number(segment && segment.start_ms) || 0);
    const endMs = Math.max(startMs, Number(segment && segment.end_ms) || startMs);
    const segmentId = String(segment && segment.segment_id || "");
    if (!candidate || !segmentId) {
      current = null;
      return;
    }
    const sameContinuousTurn = current && current.speaker_key === speakerKey && startMs - current.end_ms <= gapMs;
    if (!sameContinuousTurn) {
      current = { speaker_key: speakerKey, segment_ids: [], start_ms: startMs, end_ms: endMs, _segments: [] };
      turns.push(current);
    }
    current.segment_ids.push(segmentId);
    current.end_ms = Math.max(current.end_ms, endMs);
    current._segments.push(segment);
  });
  const counters = new Map();
  return turns.map((turn) => {
    const count = (counters.get(turn.speaker_key) || 0) + 1;
    counters.set(turn.speaker_key, count);
    return {
      turn_id: `${turn.speaker_key}_turn_${String(count).padStart(2, "0")}`,
      speaker_key: turn.speaker_key,
      segment_ids: turn.segment_ids,
      start_ms: turn.start_ms,
      end_ms: turn.end_ms,
      text: normalizeWhitespace(turn._segments.map((segment) => segment.text).filter(Boolean).join(" "), 4000),
      asr_text_status: turnTextStatus(turn._segments),
    };
  });
}

function canonicalTurnCoaching(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SPEAKING_AI_TURN_COACHING_INVALID");
  const commentary = text(value.commentary_zh, 480).replace(/[<>]/g, "");
  const sample = text(value.sample_en, 800).replace(/[<>]/g, "");
  if (!commentary || !sample) throw new Error("SPEAKING_AI_TURN_COACHING_INCOMPLETE");
  return { commentary_zh: commentary, sample_en: sample };
}

function canonicalTurnReviews(candidate, expectedTurns) {
  const reviews = candidate && Array.isArray(candidate.turn_reviews) ? candidate.turn_reviews : null;
  if (!reviews) throw new Error("SPEAKING_AI_TURN_REVIEWS_INVALID");
  if (expectedTurns.length > MAX_TURN_REVIEWS_PER_CANDIDATE || reviews.length !== expectedTurns.length) throw new Error("SPEAKING_AI_TURN_REVIEW_COUNT_INVALID");
  const expectedById = new Map(expectedTurns.map((turn) => [turn.turn_id, turn]));
  const seen = new Set();
  const canonical = reviews.map((review) => {
    if (!review || typeof review !== "object" || Array.isArray(review)) throw new Error("SPEAKING_AI_TURN_REVIEW_INVALID");
    const turnId = text(review.turn_id, 100);
    if (!expectedById.has(turnId) || seen.has(turnId)) throw new Error("SPEAKING_AI_TURN_REVIEW_REFERENCE_INVALID");
    seen.add(turnId);
    return {
      turn_id: turnId,
      communication_strategies: canonicalTurnCoaching(review.communication_strategies),
      ideas_organisation: canonicalTurnCoaching(review.ideas_organisation),
    };
  });
  canonical.sort((left, right) => expectedTurns.findIndex((turn) => turn.turn_id === left.turn_id) - expectedTurns.findIndex((turn) => turn.turn_id === right.turn_id));
  return canonical;
}

function canonicalDomain(domain, evidenceIds, validSegmentIds, candidateSpeakerKey) {
  if (!domain || typeof domain !== "object" || Array.isArray(domain)) throw new Error("SPEAKING_AI_DOMAIN_OBJECT_INVALID");
  const score = Number(domain.score);
  if (!Number.isInteger(score) || score < 0 || score > 7) throw new Error("SPEAKING_AI_SCORE_INVALID");
  const ids = Array.isArray(evidenceIds) ? evidenceIds.map((id) => String(id)) : [];
  const valid = ids.filter((id) => validSegmentIds.has(id));
  if (valid.length !== ids.length || new Set(ids).size !== ids.length) throw new Error("SPEAKING_AI_EVIDENCE_INVALID");
  return { score, commentary_zh: safeCommentary(domain.commentary_zh), evidence_segment_ids: valid };
}

function canonicalizeReport(report, speakerKeys, segments, options = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("SPEAKING_AI_REPORT_OBJECT_INVALID");
  let sourceReport = report;
  if (!Array.isArray(sourceReport.candidates) && (!sourceReport.candidates || typeof sourceReport.candidates !== "object")) {
    const wrappers = Object.values(sourceReport).filter((value) => value && typeof value === "object" && !Array.isArray(value)
      && (Array.isArray(value.candidates) || (value.candidates && typeof value.candidates === "object" && !Array.isArray(value.candidates))));
    if (wrappers.length === 1) sourceReport = wrappers[0];
  }
  const knownSpeakers = new Set((Array.isArray(speakerKeys) ? speakerKeys : []).map(String));
  const validSegments = new Map((Array.isArray(segments) ? segments : []).map((segment) => [String(segment.segment_id), segment]));
  const nonCandidates = new Set((options.nonCandidateKeys || []).map(String));
  const candidates = Array.isArray(sourceReport.candidates) ? sourceReport.candidates
    : sourceReport.candidates && typeof sourceReport.candidates === "object"
      ? Object.entries(sourceReport.candidates).map(([speakerKey, value]) => value && typeof value === "object" && !Array.isArray(value)
        ? { speaker_key: value.speaker_key || speakerKey, ...value }
        : value)
      : null;
  if (!candidates) throw new Error("SPEAKING_AI_CANDIDATES_INVALID");
  const seen = new Set();
  const expected = (Array.isArray(options.candidateSpeakerKeys) ? options.candidateSpeakerKeys : [...knownSpeakers]).filter((key) => !nonCandidates.has(String(key))).map(String);
  const speakingTurns = canonicalSpeakingTurns(segments, expected);
  if (candidates.length !== expected.length) throw new Error("SPEAKING_AI_CANDIDATE_COUNT_INVALID");
  const canonical = candidates.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("SPEAKING_AI_CANDIDATE_OBJECT_INVALID");
    const key = text(candidate && candidate.speaker_key, 60);
    if (!knownSpeakers.has(key) || nonCandidates.has(key)) throw new Error("SPEAKING_AI_SPEAKER_INVALID");
    if (seen.has(key)) throw new Error("SPEAKING_AI_SPEAKER_DUPLICATE");
    seen.add(key);
    const domains = candidate.domains || {};
    if (!domains || typeof domains !== "object" || Array.isArray(domains)) throw new Error("SPEAKING_AI_DOMAINS_INVALID");
    const canonicalDomains = {};
    ASSESSED_DOMAINS.forEach((name) => {
      const domain = domains[name];
      canonicalDomains[name] = canonicalDomain(domain, domain && domain.evidence_segment_ids, validSegments, key);
      canonicalDomains[name].evidence_segment_ids.forEach((id) => {
        const segment = validSegments.get(id);
        if (!segment || String(segment.speaker_key) !== key || segment.evaluation_role === "non_candidate_context") throw new Error("SPEAKING_AI_EVIDENCE_FOREIGN");
      });
    });
    return {
      speaker_key: key,
      summary_zh: safeCommentary(candidate.summary_zh),
      domains: {
        ...canonicalDomains,
        pronunciation_delivery: { status: "not_assessed" },
      },
      strengths: safeList(candidate.strengths),
      priority_actions: safeList(candidate.priority_actions),
      language_suggestions: safeList(candidate.language_suggestions),
      interaction_summary: { turn_count: speakingTurns.filter((turn) => turn.speaker_key === key).length },
      turn_reviews: canonicalTurnReviews(candidate, speakingTurns.filter((turn) => turn.speaker_key === key)),
    };
  });
  canonical.sort((left, right) => expected.indexOf(left.speaker_key) - expected.indexOf(right.speaker_key));
  return {
    report_version: text(options.reportVersion || "dse-speaking-v1", 80),
    group_summary_zh: safeCommentary(sourceReport.group_summary_zh),
    group_strengths: safeList(sourceReport.group_strengths),
    group_priorities: safeList(sourceReport.group_priorities),
    discussion_flow: safeList(sourceReport.discussion_flow),
    candidates: canonical,
  };
}

function evidenceProjection(segments, speakerKey, limit = 12) {
  return (Array.isArray(segments) ? segments : []).filter((segment) => String(segment.speaker_key) === String(speakerKey)).slice(0, limit).map((segment) => ({
    start_ms: segment.start_ms,
    end_ms: segment.end_ms,
    text: text(segment.text, 500),
  }));
}

function reportCandidate(report, speakerKey) {
  return (report && Array.isArray(report.candidates) ? report.candidates : []).find((candidate) => String(candidate.speaker_key) === String(speakerKey)) || null;
}

function shareDomainProjection(domains) {
  const source = domains && typeof domains === "object" ? domains : {};
  const output = {};
  ASSESSED_DOMAINS.forEach((name) => {
    const domain = source[name] || {};
    output[name] = { score: Number.isInteger(domain.score) ? domain.score : null, commentary_zh: safeCommentary(domain.commentary_zh) };
  });
  output.pronunciation_delivery = { status: "not_assessed" };
  return output;
}

function turnReviewProjection(candidate, segments) {
  const key = candidate && candidate.speaker_key;
  const turns = canonicalSpeakingTurns(segments, key ? [key] : []);
  const turnById = new Map(turns.map((turn) => [turn.turn_id, turn]));
  return (candidate && Array.isArray(candidate.turn_reviews) ? candidate.turn_reviews : []).map((review) => {
    const turn = turnById.get(String(review && review.turn_id || ""));
    if (!turn) return null;
    return {
      start_ms: turn.start_ms,
      end_ms: turn.end_ms,
      transcript_text: text(turn.text, 4000),
      asr_text_status: turn.asr_text_status,
      communication_strategies: canonicalTurnCoaching(review.communication_strategies),
      ideas_organisation: canonicalTurnCoaching(review.ideas_organisation),
    };
  }).filter(Boolean);
}

function projectStudentShare({ report, segments, participants, sharerParticipant, aliases = {}, discussion = {} } = {}) {
  const sharerKey = sharerParticipant && sharerParticipant.matched_speaker_key;
  if (!sharerKey || !identityIsConfirmed(sharerParticipant)) throw new Error("VOICE_CONFIRMATION_REQUIRED_FOR_SHARE");
  const rows = Array.isArray(participants) ? participants : [];
  const keyLabel = (key) => String(key) === String(sharerKey) ? participantName(sharerParticipant, { self: true }) : (aliases[key] || `Speaker ${String(key).replace(/^spk_0*/, "")}`);
  const own = reportCandidate(report, sharerKey);
  if (!own) throw new Error("SHARE_NOT_AVAILABLE");
  const snapshot = {
    share_kind: "student",
    // Student snapshots intentionally never disclose the internal Discussion
    // title; the caller receives a generic report heading instead.
    title: "DSE Group Discussion Report",
    generated_at: discussion.report_generated_at || null,
    group_summary_zh: safeCommentary(report.group_summary_zh),
    group_strengths: safeList(report.group_strengths),
    group_priorities: safeList(report.group_priorities),
    discussion_flow: safeList(report.discussion_flow),
    participant_summaries: rows.filter((participant) => participant && participant.matched_speaker_key).map((participant) => {
      const key = String(participant.matched_speaker_key);
      const candidate = reportCandidate(report, key);
      const isSelf = key === String(sharerKey);
      const output = {
        speaker_label: keyLabel(key),
        is_self: isSelf,
        interaction_summary: candidate ? candidate.interaction_summary : { turn_count: 0 },
      };
      // Peers receive only anonymous interaction/group-contribution metadata.
      // Their detailed personal summary remains inside the authenticated report.
      if (isSelf) output.summary_zh = candidate ? safeCommentary(candidate.summary_zh) : "";
      return output;
    }),
    self: {
      speaker_label: keyLabel(sharerKey),
      summary_zh: safeCommentary(own.summary_zh),
      domains: shareDomainProjection(own.domains),
      strengths: safeList(own.strengths),
      priority_actions: safeList(own.priority_actions),
      language_suggestions: safeList(own.language_suggestions),
      evidence: evidenceProjection(segments, sharerKey),
      turn_reviews: turnReviewProjection(own, segments),
    },
  };
  const hiddenNames = rows.filter((participant) => String(participant.participant_id || participant._id || "") !== String(sharerParticipant.participant_id || sharerParticipant._id || ""))
    .flatMap((participant) => [participant.display_name_snapshot, participant.display_name, participant.english_name, participant.chinese_name, participant.student_name, participant.name, participant.guest_name])
    .concat(rows.map((participant) => participant.student_id_snapshot || participant.student_id).filter(Boolean))
    .filter(Boolean);
  return redactExactNames(snapshot, hiddenNames);
}

function redactExactNames(value, names) {
  const forbidden = (Array.isArray(names) ? names : []).map((name) => normalizeWhitespace(name, 160)).filter((name) => name.length >= 2);
  if (!forbidden.length) return value;
  if (typeof value === "string") {
    return forbidden.reduce((result, name) => result.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu"), "Speaker"), value);
  }
  if (Array.isArray(value)) return value.map((item) => redactExactNames(item, forbidden));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactExactNames(item, forbidden)]));
  return value;
}

function createAliasMap(speakerKeys, options = {}) {
  const keys = [...new Set((Array.isArray(speakerKeys) ? speakerKeys : []).map(String))];
  const seed = String(options.seed || crypto.randomBytes(16).toString("hex"));
  const aliases = {};
  const ranked = keys.map((key) => ({
    key,
    order: crypto.createHash("sha256").update(`${seed}\n${key}`).digest("hex"),
  })).sort((left, right) => left.order.localeCompare(right.order) || left.key.localeCompare(right.key));
  ranked.forEach((item, index) => {
    aliases[item.key] = `Speaker ${String(index + 1)}`;
  });
  return aliases;
}

function projectTeacherShare({ report, segments, participants, discussion = {}, selection = {}, aliases, now = new Date() } = {}) {
  const rows = Array.isArray(participants) ? participants : [];
  const speakerKeys = [...new Set(rows.map((participant) => participant && participant.matched_speaker_key).filter(Boolean).concat((report && report.candidates || []).map((candidate) => candidate.speaker_key)))];
  const aliasMap = aliases || createAliasMap(speakerKeys);
  const visibleIds = new Set(Array.isArray(selection.visible_participant_ids)
    ? selection.visible_participant_ids.map(String)
    : rows.map((participant) => String(participant.participant_id || participant._id || "")));
  const content = {
    group_summary: selection.group_summary !== false,
    group_analysis: selection.group_analysis !== false,
    individual_analysis: selection.individual_analysis !== false,
    language_suggestions: selection.language_suggestions !== false,
    turn_reviews: selection.turn_reviews !== false,
    evidence: selection.evidence !== false,
    transcript: selection.transcript === true,
    teacher_comments: selection.teacher_comments === true,
  };
  const nameVisibility = new Map();
  const labels = Object.fromEntries(rows.filter(Boolean).map((participant) => {
    const id = String(participant.participant_id || participant._id || "");
    const key = String(participant.matched_speaker_key || "");
    const selected = visibleIds.has(id);
    const projection = identityProjection(participant, { teacher: true, fallbackLabel: aliasMap[key] || "Speaker" });
    const named = selected && projection.named;
    nameVisibility.set(id, named);
    return [key, named ? projection.label : (aliasMap[key] || "Speaker")];
  }));
  const projectedCandidates = (report && Array.isArray(report.candidates) ? report.candidates : []).map((candidate) => {
    const key = String(candidate.speaker_key);
    const owner = rows.find((participant) => String(participant.matched_speaker_key || "") === key);
    const id = owner && String(owner.participant_id || owner._id || "");
    const output = { speaker_label: labels[key] || aliasMap[key] || "Speaker" };
    // Name visibility and feedback visibility are independent teacher choices.
    // Hiding a name must not silently remove that Speaker's selected analysis.
    if (content.individual_analysis) {
      output.summary_zh = safeCommentary(candidate.summary_zh);
      output.domains = shareDomainProjection(candidate.domains);
      output.strengths = safeList(candidate.strengths);
      output.priority_actions = safeList(candidate.priority_actions);
      if (content.language_suggestions) output.language_suggestions = safeList(candidate.language_suggestions);
      if (content.evidence) output.evidence = evidenceProjection(segments, key);
      if (content.turn_reviews) output.turn_reviews = turnReviewProjection(candidate, segments);
    } else {
      output.summary_zh = content.individual_analysis ? safeCommentary(candidate.interaction_summary && candidate.interaction_summary.summary_zh) : "";
      output.interaction_summary = candidate.interaction_summary || { turn_count: 0 };
    }
    return output;
  });
  const result = {
    share_kind: "teacher",
    title: text(discussion.share_title || "DSE Speaking Discussion", 120),
    generated_at: discussion.report_generated_at || (now instanceof Date ? now.toISOString() : text(now, 80)),
    content,
    group_summary_zh: content.group_summary ? safeCommentary(report && report.group_summary_zh) : "",
    group_strengths: content.group_analysis ? safeList(report && report.group_strengths) : [],
    group_priorities: content.group_analysis ? safeList(report && report.group_priorities) : [],
    discussion_flow: content.group_analysis ? safeList(report && report.discussion_flow) : [],
    candidates: projectedCandidates,
  };
  if (content.transcript) {
    result.transcript = (Array.isArray(segments) ? segments : []).map((segment) => ({
      speaker_label: labels[String(segment.speaker_key)] || aliasMap[String(segment.speaker_key)] || "Speaker",
      start_ms: segment.start_ms, end_ms: segment.end_ms, text: text(segment.text, 500),
    }));
  }
  const forbidden = rows.filter((participant) => !nameVisibility.get(String(participant.participant_id || participant._id || "")))
    .flatMap((participant) => [participant.display_name_snapshot, participant.display_name, participant.english_name, participant.chinese_name, participant.student_name, participant.name, participant.guest_name])
    .concat(rows.map((participant) => participant.student_id_snapshot || participant.student_id).filter(Boolean))
    .filter(Boolean);
  return redactExactNames(result, forbidden);
}

function snapshotInvalidationReason(before = {}, after = {}) {
  if (before.report_version !== after.report_version) return "REPORT_VERSION_CHANGED";
  if (before.mapping_revision !== after.mapping_revision) return "VOICE_MAPPING_CHANGED";
  if (before.title !== after.title && before.share_kind === "teacher") return "TEACHER_SHARE_TITLE_CHANGED";
  if (before.guest_names_hash !== after.guest_names_hash) return "GUEST_NAME_CHANGED";
  return null;
}

function shareMustInvalidate(change = {}) {
  return Boolean(change.mapping_changed || change.report_changed || change.guest_renamed || change.participant_removed || change.discussion_deleted);
}

function stableOperationId(value) {
  return text(value, 120).replace(/[^A-Za-z0-9._:-]/g, "_");
}

function shareTokenHash(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken || "")).digest("hex");
}

function publicShareFailure() {
  return new Error("SHARE_NOT_AVAILABLE");
}

function validateSpeakingSetId(value) {
  const id = normalizeWhitespace(value, SPEAKING_SET_ID_MAX);
  if (id.length < SPEAKING_SET_ID_MIN || id.length > SPEAKING_SET_ID_MAX || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error("SPEAKING_SET_ID_INVALID");
  }
  return id;
}

function validatePaperVersion(value) {
  const version = normalizeWhitespace(value, 20);
  if (!version) return null;
  if (!/^\d{1,2}\.\d{1,2}$/.test(version)) throw new Error("SPEAKING_SET_INVALID");
  return version;
}

function normalizeOrderedRows(value, prefix, max, fieldName) {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) throw new Error("SPEAKING_SET_INVALID");
  const seen = new Set();
  const rows = value.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("SPEAKING_SET_INVALID");
    const id = normalizeWhitespace(row[`${fieldName}_id`] || row.id || `${prefix}_${String(index + 1).padStart(2, "0")}`, 80);
    const textValue = normalizeWhitespace(row.text, fieldName === "question" ? 1200 : 600);
    if (!id || seen.has(id) || !(new RegExp(`^${prefix}_[0-9]{2,}$`)).test(id) || !textValue) throw new Error("SPEAKING_SET_INVALID");
    seen.add(id);
    return { [`${fieldName}_id`]: id, order: Number.isInteger(row.order) ? row.order : index + 1, text: textValue };
  });
  rows.sort((left, right) => left.order - right.order || left[`${fieldName}_id`].localeCompare(right[`${fieldName}_id`]));
  return rows.map((row, index) => ({ ...row, order: index + 1 }));
}

function nextSpeakingChildSequence(rows, key, prefix) {
  const highest = (Array.isArray(rows) ? rows : []).reduce((maximum, row) => {
    const match = String(row && row[key] || "").match(new RegExp(`^${prefix}_([0-9]+)$`));
    return match ? Math.max(maximum, Number(match[1]) || 0) : maximum;
  }, 0);
  return highest + 1;
}

function normalizeSpeakingSetInput(input = {}, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("SPEAKING_SET_INVALID");
  const setId = validateSpeakingSetId(input.set_id);
  const sourceKind = normalizeWhitespace(input.source_kind, 12).toLowerCase();
  if (!["pp", "mock"].includes(sourceKind)) throw new Error("SPEAKING_SET_INVALID");
  const examYear = Number(input.exam_year);
  if (!Number.isInteger(examYear) || examYear < 2000 || examYear > 2100) throw new Error("SPEAKING_SET_INVALID");
  const paperVersion = validatePaperVersion(input.paper_version);
  const title = normalizeWhitespace(input.title, SPEAKING_SET_TITLE_MAX);
  if (!title) throw new Error("SPEAKING_SET_INVALID");
  const sourceNote = normalizeWhitespace(input.source_note, SPEAKING_SET_SOURCE_NOTE_MAX);
  const context = input.context || {};
  const contextTitle = normalizeWhitespace(context.title, SPEAKING_SET_CONTEXT_TITLE_MAX);
  const body = Array.isArray(context.body) ? context.body.map((paragraph) => text(paragraph, 4000)).filter(Boolean) : [];
  const combined = body.join("\n\n");
  if (!contextTitle || body.length < 1 || body.length > SPEAKING_SET_CONTEXT_MAX_PARAGRAPHS || combined.length > SPEAKING_SET_CONTEXT_MAX_CHARS) throw new Error("SPEAKING_SET_INVALID");
  const sourceLine = normalizeWhitespace(context.source_line, 500);
  const partAInput = input.part_a || {};
  const partAInstruction = normalizeWhitespace(partAInput.instruction, 500);
  const partBInput = input.part_b || {};
  const partBInstruction = normalizeWhitespace(partBInput.instruction, 500);
  const discussionPoints = normalizeOrderedRows(partAInput.discussion_points, "pa", SPEAKING_SET_PART_A_MAX, "point");
  const questions = normalizeOrderedRows(partBInput.questions, "ir", SPEAKING_SET_PART_B_MAX, "question");
  const output = {
    set_id: setId,
    source_kind: sourceKind,
    exam_year: examYear,
    paper_version: paperVersion,
    title,
    source_note: sourceNote,
    context: { source_line: sourceLine, title: contextTitle, body },
    part_a: { instruction: partAInstruction, discussion_points: discussionPoints },
    part_b: { instruction: partBInstruction, questions },
    content_revision: Number.isInteger(input.content_revision) && input.content_revision > 0 ? input.content_revision : 1,
    visible_to_students: input.visible_to_students !== false,
    next_point_sequence: Math.max(nextSpeakingChildSequence(discussionPoints, "point_id", "pa"), Number.isInteger(input.next_point_sequence) ? input.next_point_sequence : 1),
    next_question_sequence: Math.max(nextSpeakingChildSequence(questions, "question_id", "ir"), Number.isInteger(input.next_question_sequence) ? input.next_question_sequence : 1),
  };
  if (!options.includeAudit) return output;
  return { ...output, created_at: input.created_at || null, created_by_teacher_uid: input.created_by_teacher_uid || null, updated_at: input.updated_at || null, updated_by_teacher_uid: input.updated_by_teacher_uid || null };
}

function speakingSetDisplayLabel(set = {}) {
  const source = String(set.source_kind || "mock").toUpperCase();
  const year = Number.isInteger(Number(set.exam_year)) ? String(set.exam_year) : "";
  const version = normalizeWhitespace(set.paper_version, 20);
  return [
    `${year} ${source}`.trim(),
    version ? `Set ${version}` : null,
    normalizeWhitespace(set.title, SPEAKING_SET_TITLE_MAX),
  ].filter(Boolean).join(" · ");
}

function publicSpeakingSetProjection(set = {}) {
  const normalized = normalizeSpeakingSetInput(set, { includeAudit: false });
  return {
    set_id: normalized.set_id,
    display_label: speakingSetDisplayLabel(normalized),
    source_kind: normalized.source_kind,
    exam_year: normalized.exam_year,
    paper_version: normalized.paper_version,
    title: normalized.title,
    source_note: normalized.source_note,
    context: normalized.context,
    part_a: normalized.part_a,
    part_b: normalized.part_b,
    content_revision: normalized.content_revision,
    visible_to_students: normalized.visible_to_students,
  };
}

function buildGroupDiscussionSnapshot(set = {}) {
  const safe = publicSpeakingSetProjection(set);
  return {
    display_label: safe.display_label,
    source_kind: safe.source_kind,
    exam_year: safe.exam_year,
    paper_version: safe.paper_version,
    title: safe.title,
    source_note: safe.source_note,
    context: safe.context,
    part_a: safe.part_a,
  };
}

function buildIndividualResponseSnapshot(set = {}, question = {}) {
  const safe = publicSpeakingSetProjection(set);
  const resolved = resolvePartBQuestion(safe, question.question_id || question.id);
  return {
    display_label: safe.display_label,
    source_kind: safe.source_kind,
    exam_year: safe.exam_year,
    paper_version: safe.paper_version,
    title: safe.title,
    source_note: safe.source_note,
    context: safe.context,
    question_snapshot: { question_id: resolved.question_id, order: resolved.order, text: resolved.text },
  };
}

function partACompatibilityPrompt(set = {}) {
  const safe = buildGroupDiscussionSnapshot(set);
  const article = [safe.context.source_line, safe.context.title, ...safe.context.body].filter(Boolean).join("\n\n");
  const points = safe.part_a.discussion_points.map((point) => `• ${point.text}`).join("\n");
  return [article, safe.part_a.instruction, points].filter(Boolean).join("\n\n");
}

function resolvePartBQuestion(set = {}, questionId) {
  const id = normalizeWhitespace(questionId, 80);
  const questions = set.part_b && Array.isArray(set.part_b.questions) ? set.part_b.questions : [];
  const question = questions.find((row) => String(row.question_id || row.id) === id);
  if (!question) throw new Error("SPEAKING_QUESTION_NOT_FOUND");
  return { question_id: normalizeWhitespace(question.question_id || question.id, 80), order: Number(question.order), text: normalizeWhitespace(question.text, 1200) };
}

function individualResponseTimingState(seconds) {
  const elapsed = Math.max(0, Number(seconds) || 0);
  return { elapsed_seconds: elapsed, warning: elapsed >= 60, should_stop: elapsed >= INDIVIDUAL_RESPONSE_DURATION_LIMIT_SECONDS, duration_limit_seconds: INDIVIDUAL_RESPONSE_DURATION_LIMIT_SECONDS };
}

function canonicalizeIndividualResponseReport(report, segments = [], options = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("INDIVIDUAL_RESPONSE_REPORT_INVALID");
  const validIds = new Set((Array.isArray(segments) ? segments : []).map((row) => String(row.segment_id || "")));
  const domains = report.domains && typeof report.domains === "object" ? report.domains : {};
  const canonical = {};
  const domainMap = {
    communication_strategies: "communication_strategies",
    ideas_organisation: "ideas_organisation",
    vocabulary_language_patterns: "vocabulary_language_patterns",
  };
  Object.entries(domainMap).forEach(([key, sourceKey]) => {
    const domain = domains[sourceKey];
    if (!domain || typeof domain !== "object" || Array.isArray(domain)) throw new Error("INDIVIDUAL_RESPONSE_DOMAIN_INVALID");
    const score = Number(domain.score);
    if (!Number.isInteger(score) || score < 0 || score > 7) throw new Error("SPEAKING_AI_SCORE_INVALID");
    const evidence = Array.isArray(domain.evidence_segment_ids) ? domain.evidence_segment_ids.map(String) : [];
    if (new Set(evidence).size !== evidence.length || evidence.some((id) => !validIds.has(id))) throw new Error("SPEAKING_AI_EVIDENCE_INVALID");
    canonical[key] = { score, commentary_zh: safeCommentary(domain.commentary_zh), evidence_segment_ids: evidence };
  });
  const cleanTextList = (value, limit, itemLimit) => (Array.isArray(value) ? value : []).map((item) => text(item, itemLimit).replace(/[<>]/g, "")).filter(Boolean).slice(0, limit);
  const output = {
    report_version: text(options.reportVersion || INDIVIDUAL_RESPONSE_REPORT_SCHEMA_VERSION, 80),
    summary_zh: safeCommentary(report.summary_zh),
    domains: { ...canonical, pronunciation_delivery: { status: "not_assessed" } },
    strengths: cleanTextList(report.strengths, 12, 240),
    priority_actions: cleanTextList(report.priority_actions, 12, 240),
    language_suggestions: cleanTextList(report.language_suggestions, 12, 480),
    sample_response_en: text(report.sample_response_en, 1600).replace(/[<>]/g, ""),
    transcript: (Array.isArray(segments) ? segments : []).map((segment) => ({ segment_id: String(segment.segment_id || ""), start_ms: Number(segment.start_ms || 0), end_ms: Number(segment.end_ms || 0), text: text(segment.text, 2000) })),
  };
  return options.redactNames ? redactExactNames(output, options.redactNames) : output;
}

module.exports = {
  DEFAULT_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  MAX_DURATION_SECONDS,
  ASSESSED_DOMAINS,
  text,
  normalizeWhitespace,
  normalizeGuestName,
  displayGuestName,
  participantKind,
  isGuestNameAvailable,
  participantCountEligibility,
  durationForParticipantCount,
  normalizeDurationSeconds,
  durationIsValid,
  actorUid,
  isTeacher,
  isActiveStudent,
  participantIsAccepted,
  identityIsConfirmed,
  participantForUid,
  isCreator,
  canReadDiscussion,
  canEditDiscussion,
  canInviteOrFreeze,
  canAcceptInvitation,
  canConfirmVoice,
  canCreateStudentShare,
  canCreateTeacherShare,
  normalizeParticipant,
  participantName,
  identityProjection,
  canonicalizeSpeakerTracks,
  canonicalizeSegments,
  isLikelyFacilitatorCue,
  candidateSpeakerKeys,
  voiceprintExcerptPlans,
  automaticVoiceMatches,
  canonicalizeMapping,
  canonicalSpeakingTurns,
  canonicalizeReport,
  evidenceProjection,
  reportCandidate,
  turnReviewProjection,
  projectStudentShare,
  projectTeacherShare,
  redactExactNames,
  createAliasMap,
  snapshotInvalidationReason,
  shareMustInvalidate,
  stableOperationId,
  shareTokenHash,
  publicShareFailure,
  AUTOMATIC_VOICE_MATCH_MIN_SCORE,
  SPEAKING_SET_ID_MIN,
  SPEAKING_SET_ID_MAX,
  SPEAKING_SET_PART_A_MAX,
  SPEAKING_SET_PART_B_MAX,
  INDIVIDUAL_RESPONSE_DURATION_LIMIT_SECONDS,
  INDIVIDUAL_RESPONSE_DURATION_TOLERANCE_SECONDS,
  INDIVIDUAL_RESPONSE_REPORT_SCHEMA_VERSION,
  validateSpeakingSetId,
  validatePaperVersion,
  normalizeSpeakingSetInput,
  speakingSetDisplayLabel,
  publicSpeakingSetProjection,
  buildGroupDiscussionSnapshot,
  buildIndividualResponseSnapshot,
  partACompatibilityPrompt,
  resolvePartBQuestion,
  individualResponseTimingState,
  canonicalizeIndividualResponseReport,
};
