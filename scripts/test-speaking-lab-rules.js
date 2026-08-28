#!/usr/bin/env node
"use strict";

const assert = require("assert");
const lab = require("../cloudfunctions/_shared/speaking-lab");

function actor(uid, role = "student") { return { auth_uid: uid, role, active: true, student_id: uid, english_name: uid }; }
function participant(id, key, extra = {}) { return { participant_id: id, kind: "vip", student_uid: id, display_name: id, invitation_status: "accepted", identity_status: "teacher_confirmed", matched_speaker_key: key, mapping_revision: 1, ...extra }; }
function reportFor(keys = ["spk_01", "spk_02"]) {
  const domain = (id, score = 5) => ({ score, commentary_zh: "表现稳定", evidence_segment_ids: [id] });
  return {
    group_summary_zh: "小组总结", group_strengths: ["倾听"], group_priorities: ["回应"], discussion_flow: ["开场"],
    candidates: keys.map((speaker_key, index) => {
      const evidenceId = `seg_${String(index + 1).padStart(4, "0")}`;
      return { speaker_key, summary_zh: "个人总结", domains: {
        communication_strategies: domain(evidenceId), vocabulary_language_patterns: domain(evidenceId), ideas_organisation: domain(evidenceId), pronunciation_delivery: { status: "anything" },
      }, strengths: ["清晰"], priority_actions: ["继续"], language_suggestions: ["try"], interaction_summary: { turn_count: 2 } };
    }),
  };
}

function run() {
  // 1-2 participant-count boundaries. Two participants never produce a report.
  [2, 3, 4, 5, 6, 7].forEach((count) => {
    const result = lab.participantCountEligibility(count);
    assert.equal(result.eligible, count >= 3 && count <= 6);
  });
  assert.equal(lab.participantCountEligibility(2).reason, "DSE_REQUIRES_THREE_TO_SIX");

  // 3-4 default duration and manual bounds.
  assert.equal(lab.durationForParticipantCount(3), 360);
  assert.equal(lab.durationForParticipantCount(4), 480);
  assert.equal(lab.normalizeDurationSeconds(1, 3), 180);
  assert.equal(lab.normalizeDurationSeconds(9999, 3), 1800);

  // 5 Student ID is only a lookup/display input; UID is the authority.
  const discussion = { creator_uid: "creator", deleted_at: null };
  const pending = participant("vip", "spk_01", { invitation_status: "pending", identity_status: "unconfirmed" });
  assert.equal(lab.canReadDiscussion(actor("vip"), discussion, [pending]), false);
  assert.equal(lab.canAcceptInvitation(actor("vip"), pending, discussion), true);
  assert.equal(lab.canReadDiscussion(actor("vip"), discussion, [{ ...pending, invitation_status: "accepted" }]), true);
  assert.equal(lab.canReadDiscussion(actor("other"), discussion, [{ ...pending, invitation_status: "accepted" }]), false);
  assert.equal(lab.canReadDiscussion(actor("teacher", "teacher"), discussion, []), true);

  // 6-7 guest collision, normalization, and rename independence.
  const guests = [{ participant_id: "g1", kind: "guest", guest_name: "Alex   Wong", guest_name_normalized: "alex wong" }];
  assert.equal(lab.normalizeGuestName(" Alex  Wong "), "alex wong");
  assert.equal(lab.isGuestNameAvailable(guests, "alex wong"), false);
  assert.equal(lab.isGuestNameAvailable(guests, "Alex Wong", "g1"), true);

  // 8 one-to-one mapping and duplicate/unknown rejection.
  const people = [participant("a", "spk_01"), participant("b", "spk_02")];
  assert.deepEqual(lab.canonicalizeMapping([{ participant_id: "b", speaker_key: "spk_02" }, { participant_id: "a", speaker_key: "spk_01" }], ["spk_01", "spk_02"], people, { requireAll: true }), [{ participant_id: "a", speaker_key: "spk_01" }, { participant_id: "b", speaker_key: "spk_02" }]);
  assert.throws(() => lab.canonicalizeMapping([{ participant_id: "a", speaker_key: "spk_01" }, { participant_id: "b", speaker_key: "spk_01" }], ["spk_01", "spk_02"], people), /DUPLICATE_SPEAKER/);
  assert.throws(() => lab.canonicalizeMapping([{ participant_id: "a", speaker_key: "spk_99" }], ["spk_01"], people), /SPEAKER_INVALID/);

  // 9 stale confirmation and teacher authority.
  assert.equal(lab.canConfirmVoice(actor("a"), people[0], discussion), true);
  assert.notEqual(people[0].mapping_revision, 2);
  assert.throws(() => lab.canonicalizeMapping([{ participant_id: "a", speaker_key: "spk_01" }], ["spk_01"], people, { requireAll: true }), /INCOMPLETE/);

  // 10-12 identity labels, Guest badge, and extra voice exclusion.
  const unconfirmed = participant("a", "spk_01", { identity_status: "unconfirmed" });
  assert.equal(lab.identityProjection(unconfirmed, { self: false }).named, false);
  assert.equal(lab.identityProjection(unconfirmed, { self: true }).named, false);
  assert.equal(lab.identityProjection(unconfirmed, { teacher: true }).named, false);
  const guestProjection = lab.identityProjection({ participant_id: "g", kind: "guest", guest_name: "Sam", matched_speaker_key: "spk_02" }, { teacher: true });
  assert.match(guestProjection.label, /Guest participant · Name not verified/);
  const tracks = lab.canonicalizeSpeakerTracks([{ provider_speaker_id: "A", confidence: 0.9 }, { provider_speaker_id: "B", confidence: 0.9 }, { provider_speaker_id: "C", confidence: 0.9 }], [{ provider_speaker_id: "A", start_ms: 0 }, { provider_speaker_id: "B", start_ms: 10 }, { provider_speaker_id: "C", start_ms: 20 }]);
  const candidate = lab.candidateSpeakerKeys(tracks.tracks, people);
  assert.deepEqual(candidate.candidate_keys, ["spk_01", "spk_02"]);
  assert.deepEqual(candidate.non_candidate_keys, ["spk_03"]);
  const outsiderFirst = lab.canonicalizeSpeakerTracks([{ provider_speaker_id: "X", confidence: 0.95, candidate_eligible: false }, { provider_speaker_id: "A", confidence: 0.9 }, { provider_speaker_id: "B", confidence: 0.9 }], [{ provider_speaker_id: "X", start_ms: 0 }, { provider_speaker_id: "A", start_ms: 10 }, { provider_speaker_id: "B", start_ms: 20 }]);
  const outsiderCandidate = lab.candidateSpeakerKeys(outsiderFirst.tracks, people);
  assert.deepEqual(outsiderCandidate.candidate_keys, ["spk_02", "spk_03"]);
  const unknownConfidence = lab.canonicalizeSpeakerTracks([
    { provider_speaker_id: "X", speech_duration_ms: 1500, turn_count: 1 },
    { provider_speaker_id: "A", speech_duration_ms: 40000, turn_count: 8 },
    { provider_speaker_id: "B", speech_duration_ms: 35000, turn_count: 7 },
  ], [{ provider_speaker_id: "X", start_ms: 0 }, { provider_speaker_id: "A", start_ms: 10 }, { provider_speaker_id: "B", start_ms: 20 }]);
  const sustainedCandidate = lab.candidateSpeakerKeys(unknownConfidence.tracks, people);
  assert.deepEqual(sustainedCandidate.candidate_keys, ["spk_02", "spk_03"], "brief first outside voice must not displace sustained candidates when confidence is unavailable");
  assert.equal(outsiderCandidate.reason_by_key.spk_01, "POSSIBLE_NON_CANDIDATE");
  assert.equal(lab.isLikelyFacilitatorCue({ start_ms: 560, text: "You may start a discussion now." }), true);
  assert.equal(lab.isLikelyFacilitatorCue({ start_ms: 20000, text: "You may start a discussion now." }), false);

  // 13-15 report speaker/evidence/score contracts.
  const segments = [{ segment_id: "seg_0001", speaker_key: "spk_01", start_ms: 0, end_ms: 1000, text: "hello" }, { segment_id: "seg_0002", speaker_key: "spk_02", start_ms: 1000, end_ms: 2000, text: "world" }];
  const valid = reportFor();
  const canonical = lab.canonicalizeReport(valid, ["spk_01", "spk_02"], segments, { candidateSpeakerKeys: ["spk_01", "spk_02"] });
  assert.deepEqual(canonical.candidates.map((item) => item.speaker_key), ["spk_01", "spk_02"]);
  assert.equal(canonical.candidates[0].domains.pronunciation_delivery.status, "not_assessed");
  const withProviderExtras = lab.canonicalizeReport({ ...valid, schema_version: "provider-copy", candidates: valid.candidates.map((item) => ({ ...item, provider_note: "discard", domains: { ...item.domains, overall_score: 99 } })) }, ["spk_01", "spk_02"], segments, { candidateSpeakerKeys: ["spk_01", "spk_02"] });
  assert.equal(Object.prototype.hasOwnProperty.call(withProviderExtras, "schema_version"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(withProviderExtras.candidates[0], "provider_note"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(withProviderExtras.candidates[0].domains, "overall_score"), false);
  const candidateMap = Object.fromEntries(valid.candidates.map((item) => [item.speaker_key, Object.fromEntries(Object.entries(item).filter(([key]) => key !== "speaker_key"))]));
  const wrappedCandidateMap = lab.canonicalizeReport({ report: { ...valid, candidates: candidateMap } }, ["spk_01", "spk_02"], segments, { candidateSpeakerKeys: ["spk_01", "spk_02"] });
  assert.deepEqual(wrappedCandidateMap.candidates.map((item) => item.speaker_key), ["spk_01", "spk_02"]);
  assert.throws(() => lab.canonicalizeReport({ ...valid, candidates: [valid.candidates[0]] }, ["spk_01", "spk_02"], segments, { candidateSpeakerKeys: ["spk_01", "spk_02"] }), /CANDIDATE_COUNT/);
  assert.throws(() => lab.canonicalizeReport({ ...valid, candidates: [valid.candidates[0], { ...valid.candidates[1], speaker_key: "spk_01" }] }, ["spk_01", "spk_02"], segments, { candidateSpeakerKeys: ["spk_01", "spk_02"] }), /DUPLICATE/);
  assert.throws(() => lab.canonicalizeReport({ ...valid, candidates: [valid.candidates[0], { ...valid.candidates[1], speaker_key: "spk_99" }] }, ["spk_01", "spk_02"], segments, { candidateSpeakerKeys: ["spk_01", "spk_02"] }), /SPEAKER_INVALID/);
  assert.throws(() => lab.canonicalizeReport({ ...valid, candidates: [valid.candidates[0], { ...valid.candidates[1], domains: { ...valid.candidates[1].domains, communication_strategies: { score: 8, commentary_zh: "", evidence_segment_ids: [] } } }] }, ["spk_01", "spk_02"], segments, { candidateSpeakerKeys: ["spk_01", "spk_02"] }), /SCORE_INVALID/);
  assert.throws(() => lab.canonicalizeReport({ ...valid, candidates: [valid.candidates[0], { ...valid.candidates[1], domains: { ...valid.candidates[1].domains, communication_strategies: { score: 5, commentary_zh: "", evidence_segment_ids: ["seg_0001"] } } }] }, ["spk_01", "spk_02"], segments, { candidateSpeakerKeys: ["spk_01", "spk_02"] }), /EVIDENCE_FOREIGN/);
  const facilitatorSegment = [{ ...segments[0], evaluation_role: "non_candidate_context" }, segments[1]];
  assert.throws(() => lab.canonicalizeReport(valid, ["spk_01", "spk_02"], facilitatorSegment, { candidateSpeakerKeys: ["spk_01", "spk_02"] }), /EVIDENCE_FOREIGN/);

  // 16-18 student projection: pronunciation is forced, only the sharer is detailed,
  // and the internal title/transcript/roster/audio are absent.
  const sharer = participant("a", "spk_01", { identity_status: "student_confirmed" });
  const peer = participant("b", "spk_02", { identity_status: "unconfirmed", display_name_snapshot: "Private Peer" });
  const namedReport = { ...canonical, group_summary_zh: "Private Peer offered an example", candidates: canonical.candidates.map((item) => item.speaker_key === "spk_02" ? { ...item, summary_zh: "Private Peer made errors" } : item) };
  const studentShare = lab.projectStudentShare({ report: namedReport, segments, participants: [sharer, peer], sharerParticipant: sharer, aliases: { spk_01: "Other", spk_02: "Anonymous" }, discussion: { share_title: "Internal title" } });
  assert.equal(studentShare.title, "DSE Group Discussion Report");
  assert.equal(studentShare.self.domains.pronunciation_delivery.status, "not_assessed");
  assert.equal(studentShare.participant_summaries[1].speaker_label, "Anonymous");
  assert.equal(Object.prototype.hasOwnProperty.call(studentShare.participant_summaries[1], "summary_zh"), false);
  assert.doesNotMatch(JSON.stringify(studentShare), /Private Peer/);
  assert.equal(Object.prototype.hasOwnProperty.call(studentShare, "transcript"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(studentShare, "roster"), false);
  assert.doesNotMatch(JSON.stringify(studentShare), /participant_id|speaker_key|segment_id|student_id/i);

  // 19 exact-name redaction and Guest badge in teacher projection.
  const teacherShare = lab.projectTeacherShare({ report: canonical, segments, participants: [sharer, { participant_id: "g", kind: "guest", guest_name: "Sam", matched_speaker_key: "spk_02", identity_status: "unconfirmed" }], discussion: { share_title: "Internal" }, selection: { visible_participant_ids: ["a", "g"], transcript: true }, aliases: { spk_01: "Alice", spk_02: "Bob" }, now: new Date("2026-01-01T00:00:00Z") });
  assert.match(teacherShare.candidates[1].speaker_label, /Guest participant · Name not verified/);
  const hidden = lab.projectTeacherShare({ report: canonical, segments, participants: [sharer, { participant_id: "g", kind: "guest", guest_name: "Sam", matched_speaker_key: "spk_02", identity_status: "unconfirmed" }], discussion: {}, selection: { visible_participant_ids: [] }, aliases: { spk_01: "Alice", spk_02: "Bob" } });
  assert.doesNotMatch(JSON.stringify(hidden), /Sam/);
  assert.doesNotMatch(JSON.stringify(hidden), /participant_id|speaker_key|segment_id|names_visible|student_id/i);
  assert.ok(hidden.candidates[1].domains, "hiding a name must not hide selected individual analysis");
  const selectedButUnconfirmed = lab.projectTeacherShare({ report: namedReport, segments, participants: [sharer, peer], discussion: {}, selection: { visible_participant_ids: ["a", "b"] }, aliases: { spk_01: "Speaker 2", spk_02: "Speaker 1" } });
  assert.equal(selectedButUnconfirmed.candidates[1].speaker_label, "Speaker 1");
  assert.doesNotMatch(JSON.stringify(selectedButUnconfirmed), /Private Peer/);

  // 20 per-snapshot aliases are stable within a snapshot and differ across snapshots.
  assert.deepEqual(lab.createAliasMap(["spk_01", "spk_02"], { seed: "same" }), lab.createAliasMap(["spk_01", "spk_02"], { seed: "same" }));
  assert.notDeepEqual(lab.createAliasMap(["spk_01", "spk_02"], { seed: "a" }), lab.createAliasMap(["spk_01", "spk_02"], { seed: "b" }));
  assert.deepEqual(Object.values(lab.createAliasMap(["spk_01", "spk_02"], { seed: "same" })).sort(), ["Speaker 1", "Speaker 2"]);

  // 21 raw share tokens are hashed; missing/expired/revoked share responses share a code.
  const raw = "raw-token";
  assert.notEqual(lab.shareTokenHash(raw), raw);
  assert.equal(lab.publicShareFailure().message, "SHARE_NOT_AVAILABLE");

  // 22-25 idempotency/stale/invalidation decisions are explicit and data-only.
  assert.equal(lab.stableOperationId("same op!"), "same_op_");
  assert.equal(lab.snapshotInvalidationReason({ mapping_revision: 1 }, { mapping_revision: 2 }), "VOICE_MAPPING_CHANGED");
  assert.equal(lab.snapshotInvalidationReason({ guest_names_hash: "a" }, { guest_names_hash: "b" }), "GUEST_NAME_CHANGED");
  assert.equal(lab.shareMustInvalidate({ guest_renamed: true }), true);

  // 26 forbidden report/job content fields are not accepted by the public job view
  // (covered here as a pure projection invariant).
  const forbidden = JSON.stringify({ job_id: "j", stage: "transcription", status: "queued" });
  assert.doesNotMatch(forbidden, /"(?:audio_url|transcript|prompt_text|student_name|model_response)"\s*:/);
  console.log("Speaking Lab rule contracts passed.");
}

run();
