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
    const confidence = Number(source.confidence);
    const speechDuration = Number(source.speech_duration_ms);
    const turnCount = Number(source.turn_count);
    return {
      speaker_key: keyByProvider.get(provider),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
      reliable: Number.isFinite(confidence) ? confidence >= minimumConfidence : false,
      speech_duration_ms: Number.isFinite(speechDuration) ? Math.max(0, Math.round(speechDuration)) : null,
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
      confidence: Number.isFinite(Number(source.confidence)) ? Math.max(0, Math.min(1, Number(source.confidence))) : null,
    });
  });
  return { segments: output, rejected };
}

function candidateSpeakerKeys(tracks, participants, options = {}) {
  const allTracks = Array.isArray(tracks) ? tracks : [];
  const listedCount = (Array.isArray(participants) ? participants : []).filter((participant) =>
    participant && ["guest", "vip"].includes(participantKind(participant))).length;
  const minimumConfidence = options.minimumConfidence == null ? SPEAKER_CONFIDENCE_MIN : Number(options.minimumConfidence);
  const reliable = allTracks.filter((track) => track && track.candidate_eligible !== false && track.reliable !== false && (track.confidence == null || Number(track.confidence) >= minimumConfidence));
  const candidate = reliable.slice(0, listedCount).map((track) => track.speaker_key);
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

function canonicalDomain(domain, evidenceIds, validSegmentIds, candidateSpeakerKey) {
  if (!domain || typeof domain !== "object") throw new Error("SPEAKING_AI_SCHEMA_INVALID");
  const score = Number(domain.score);
  if (!Number.isInteger(score) || score < 0 || score > 7) throw new Error("SPEAKING_AI_SCORE_INVALID");
  const ids = Array.isArray(evidenceIds) ? evidenceIds.map((id) => String(id)) : [];
  const valid = ids.filter((id) => validSegmentIds.has(id));
  if (valid.length !== ids.length || new Set(ids).size !== ids.length) throw new Error("SPEAKING_AI_EVIDENCE_INVALID");
  return { score, commentary_zh: safeCommentary(domain.commentary_zh), evidence_segment_ids: valid };
}

function canonicalizeReport(report, speakerKeys, segments, options = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new Error("SPEAKING_AI_SCHEMA_INVALID");
  const allowedRoot = new Set(["group_summary_zh", "group_strengths", "group_priorities", "discussion_flow", "candidates"]);
  if (Object.keys(report).some((key) => !allowedRoot.has(key))) throw new Error("SPEAKING_AI_SCHEMA_INVALID");
  const knownSpeakers = new Set((Array.isArray(speakerKeys) ? speakerKeys : []).map(String));
  const validSegments = new Map((Array.isArray(segments) ? segments : []).map((segment) => [String(segment.segment_id), segment]));
  const nonCandidates = new Set((options.nonCandidateKeys || []).map(String));
  const candidates = Array.isArray(report.candidates) ? report.candidates : null;
  if (!candidates) throw new Error("SPEAKING_AI_SCHEMA_INVALID");
  const seen = new Set();
  const expected = (Array.isArray(options.candidateSpeakerKeys) ? options.candidateSpeakerKeys : [...knownSpeakers]).filter((key) => !nonCandidates.has(String(key))).map(String);
  if (candidates.length !== expected.length) throw new Error("SPEAKING_AI_CANDIDATE_COUNT_INVALID");
  const canonical = candidates.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("SPEAKING_AI_SCHEMA_INVALID");
    const allowedCandidate = new Set(["speaker_key", "summary_zh", "domains", "strengths", "priority_actions", "language_suggestions", "interaction_summary"]);
    if (Object.keys(candidate).some((key) => !allowedCandidate.has(key))) throw new Error("SPEAKING_AI_SCHEMA_INVALID");
    const key = text(candidate && candidate.speaker_key, 60);
    if (!knownSpeakers.has(key) || nonCandidates.has(key)) throw new Error("SPEAKING_AI_SPEAKER_INVALID");
    if (seen.has(key)) throw new Error("SPEAKING_AI_SPEAKER_DUPLICATE");
    seen.add(key);
    const domains = candidate.domains || {};
    if (!domains || typeof domains !== "object" || Array.isArray(domains) || Object.keys(domains).some((name) => !ASSESSED_DOMAINS.concat("pronunciation_delivery").includes(name))) throw new Error("SPEAKING_AI_SCHEMA_INVALID");
    const canonicalDomains = {};
    ASSESSED_DOMAINS.forEach((name) => {
      const domain = domains[name];
      canonicalDomains[name] = canonicalDomain(domain, domain && domain.evidence_segment_ids, validSegments, key);
      canonicalDomains[name].evidence_segment_ids.forEach((id) => {
        const segment = validSegments.get(id);
        if (!segment || String(segment.speaker_key) !== key) throw new Error("SPEAKING_AI_EVIDENCE_FOREIGN");
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
      interaction_summary: candidate.interaction_summary && typeof candidate.interaction_summary === "object"
        ? { turn_count: Number.isInteger(candidate.interaction_summary.turn_count) ? Math.max(0, candidate.interaction_summary.turn_count) : 0 }
        : { turn_count: 0 },
    };
  });
  canonical.sort((left, right) => expected.indexOf(left.speaker_key) - expected.indexOf(right.speaker_key));
  return {
    report_version: text(options.reportVersion || "dse-speaking-v1", 80),
    group_summary_zh: safeCommentary(report.group_summary_zh),
    group_strengths: safeList(report.group_strengths),
    group_priorities: safeList(report.group_priorities),
    discussion_flow: safeList(report.discussion_flow),
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
  candidateSpeakerKeys,
  canonicalizeMapping,
  canonicalizeReport,
  evidenceProjection,
  reportCandidate,
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
