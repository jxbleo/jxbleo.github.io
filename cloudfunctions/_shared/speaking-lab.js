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
const MAX_REPORT_LIST_ITEMS = 12;
const MAX_COMMENTARY_LENGTH = 1200;
const MAX_TURN_REVIEWS_PER_CANDIDATE = 80;
const SPEAKING_TURN_GAP_MS = 2500;
const ASSESSED_DOMAINS = [
  "communication_strategies",
  "vocabulary_language_patterns",
  "ideas_organisation",
];

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

function normalizeDurationSeconds(value, participantCount = 3) {
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
  return ["student_confirmed", "teacher_confirmed"].includes(String(participant.identity_status || "")) &&
    Boolean(participant.matched_speaker_key);
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
  const confirmed = ["student_confirmed", "teacher_confirmed"].includes(normalized.identity_status);
  return confirmed ? normalized.display_name : "";
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
  const canName = ["student_confirmed", "teacher_confirmed"].includes(normalized.identity_status);
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
    .slice(0, listedCount)
    .sort((left, right) => Number(originalOrder.get(left.speaker_key)) - Number(originalOrder.get(right.speaker_key)))
    .map((track) => track.speaker_key);
  const candidateSet = new Set(candidate);
  return {
    candidate_keys: candidate,
    non_candidate_keys: allTracks.map((track) => track.speaker_key).filter((key) => !candidateSet.has(key)),
    reason_by_key: Object.fromEntries(allTracks.map((track, index) => [track.speaker_key, candidateSet.has(track.speaker_key) ? null : (track.candidate_eligible === false ? "POSSIBLE_NON_CANDIDATE" : (index >= listedCount ? "EXTRA_SPEAKER" : "LOW_CONFIDENCE"))]).filter((entry) => entry[1])),
  };
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
  if (!sharerKey || !["student_confirmed", "teacher_confirmed"].includes(String(sharerParticipant.identity_status || ""))) throw new Error("VOICE_CONFIRMATION_REQUIRED_FOR_SHARE");
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
};
