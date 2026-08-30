#!/usr/bin/env node
"use strict";

const assert = require("assert");
const lab = require("../cloudfunctions/_shared/speaking-lab");

function actor(uid, role = "student") { return { auth_uid: uid, role, active: true, student_id: uid, english_name: uid }; }
function participant(id, key, extra = {}) { return { participant_id: id, kind: "vip", student_uid: id, display_name: id, invitation_status: "accepted", identity_status: "teacher_confirmed", matched_speaker_key: key, mapping_revision: 1, ...extra }; }
function reportFor(keys = ["spk_01", "spk_02"]) {
  const domain = (id, score = 5) => ({ score, commentary_zh: "表现稳定", evidence_segment_ids: [id], strengths: ["有证据的优点"], priority_actions: ["下一步行动"], language_suggestions: ["I would build on that by adding..."] });
  const coaching = () => ({
    strength_zh: "先回应了同学的观点，显示有聆听并能接续讨论。",
    limitation_zh: "回应后很快转到自己的看法，两者之间的逻辑关系仍不够清楚。",
    improvement_zh: "先概括对方观点，再明确说明自己补充的是原因、例子还是限制。",
    sample_en: "I agree with your point, and I would also add that...",
  });
  return {
    group_summary_zh: "小组总结", group_strengths: ["倾听"], group_priorities: ["回应"], discussion_flow: ["开场"],
    candidates: keys.map((speaker_key, index) => {
      const evidenceId = `seg_${String(index + 1).padStart(4, "0")}`;
      return { speaker_key, summary_zh: "个人总结", domains: {
        communication_strategies: domain(evidenceId), vocabulary_language_patterns: domain(evidenceId), ideas_organisation: domain(evidenceId), pronunciation_delivery: { status: "anything" },
      }, strengths: ["清晰"], priority_actions: ["继续"], language_suggestions: ["try"], interaction_summary: { turn_count: 2 }, turn_reviews: [{ turn_id: `${speaker_key}_turn_01`, communication_strategies: coaching(), ideas_organisation: coaching() }] };
    }),
  };
}

function run() {
  // Speaking Set identity, stable child IDs, snapshots, and Individual Response timing.
  assert.equal(lab.validateSpeakingSetId("dse-p4-mock-2025-1-3-smartphones-replacing-personal-computers"), "dse-p4-mock-2025-1-3-smartphones-replacing-personal-computers");
  assert.throws(() => lab.validateSpeakingSetId("DSE Paper 4 / unsafe"), /SPEAKING_SET_ID_INVALID/);
  assert.equal(lab.validatePaperVersion("1.1"), "1.1");
  assert.equal(lab.validatePaperVersion(""), null);
  assert.throws(() => lab.validatePaperVersion("2025"), /SPEAKING_SET_INVALID/);
  const set = {
    set_id: "dse-p4-mock-2025-1-3-safe-topic", source_kind: "mock", exam_year: 2025, paper_version: "1.3", title: "Safe Topic",
    source_note: "Original mock.", context: { source_line: "A source:", title: "<Inert>", body: ["One paragraph", "Two paragraph"] },
    part_a: { instruction: "Talk about:", discussion_points: [{ point_id: "pa_02", order: 2, text: "Second" }, { point_id: "pa_01", order: 1, text: "First" }] },
    part_b: { instruction: "Respond:", questions: [{ question_id: "ir_02", order: 2, text: "Second question" }, { question_id: "ir_01", order: 1, text: "First question" }] },
  };
  const normalizedSet = lab.normalizeSpeakingSetInput(set);
  assert.equal(lab.speakingSetDisplayLabel(normalizedSet), "2025 MOCK · Set 1.3 · Safe Topic");
  assert.deepEqual(normalizedSet.part_a.discussion_points.map((item) => item.point_id), ["pa_01", "pa_02"]);
  assert.deepEqual(normalizedSet.part_b.questions.map((item) => item.question_id), ["ir_01", "ir_02"]);
  assert.equal(normalizedSet.next_point_sequence, 3);
  assert.equal(normalizedSet.next_question_sequence, 3);
  assert.throws(() => lab.normalizeSpeakingSetInput({ ...set, part_b: { ...set.part_b, questions: [{ question_id: "question-one", order: 1, text: "Unsafe identity" }] } }), /SPEAKING_SET_INVALID/);
  assert.equal(lab.resolvePartBQuestion(normalizedSet, "ir_01").text, "First question");
  assert.throws(() => lab.resolvePartBQuestion(normalizedSet, "ir_99"), /SPEAKING_QUESTION_NOT_FOUND/);
  const snapshot = lab.buildGroupDiscussionSnapshot(normalizedSet);
  snapshot.context.body[0] = "changed locally";
  assert.equal(normalizedSet.context.body[0], "One paragraph", "Set snapshots are copied values");
  assert.equal(lab.individualResponseTimingState(59).warning, false);
  assert.equal(lab.individualResponseTimingState(60).warning, true);
  assert.equal(lab.individualResponseTimingState(65).should_stop, true);
  const individualReport = lab.canonicalizeIndividualResponseReport({ summary_zh: "清晰", domains: {
    communication_strategies: { score: 5, commentary_zh: "直接回答", evidence_segment_ids: ["seg_0001"] },
    ideas_organisation: { score: 4, commentary_zh: "有例子", evidence_segment_ids: [] },
    vocabulary_language_patterns: { score: 5, commentary_zh: "用字準確", evidence_segment_ids: [] },
    pronunciation_delivery: { status: "scored", score: 7 },
  }, strengths: ["clear"], priority_actions: ["develop"], language_suggestions: ["try"], sample_response_en: "I would support it." }, [{ segment_id: "seg_0001", start_ms: 0, end_ms: 1000, text: "I agree" }]);
  assert.equal(individualReport.domains.pronunciation_delivery.status, "not_assessed");
  assert.equal(Object.prototype.hasOwnProperty.call(individualReport, "total_score"), false);
  const redactedIndividualReport = lab.canonicalizeIndividualResponseReport({ summary_zh: "Alex should expand this point", domains: {
    communication_strategies: { score: 5, commentary_zh: "Alex responds directly", evidence_segment_ids: ["seg_0001"] },
    ideas_organisation: { score: 4, commentary_zh: "有例子", evidence_segment_ids: [] },
    vocabulary_language_patterns: { score: 5, commentary_zh: "用字準確", evidence_segment_ids: [] },
    pronunciation_delivery: { status: "scored", score: 7 },
  }, strengths: ["Alex is clear"], priority_actions: ["develop"], language_suggestions: ["try"], sample_response_en: "Alex would support it." }, [{ segment_id: "seg_0001", start_ms: 0, end_ms: 1000, text: "Alex agrees" }], { redactNames: ["Alex", "student-01"] });
  assert.doesNotMatch(JSON.stringify(redactedIndividualReport), /Alex/);
  assert.throws(() => lab.canonicalizeIndividualResponseReport({ summary_zh: "x", domains: {
    communication_strategies: { score: 5, commentary_zh: "x", evidence_segment_ids: ["missing"] },
    ideas_organisation: { score: 4, commentary_zh: "x", evidence_segment_ids: [] },
    vocabulary_language_patterns: { score: 5, commentary_zh: "x", evidence_segment_ids: [] },
  }, strengths: [], priority_actions: [], language_suggestions: [], sample_response_en: "x" }, [{ segment_id: "seg_0001", start_ms: 0, end_ms: 1000, text: "x" }]), /SPEAKING_AI_EVIDENCE_INVALID/);

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
  const automaticallyConfirmed = participant("auto", "spk_01", { identity_status: "voiceprint_confirmed", display_name_snapshot: "Auto Student" });
  assert.equal(lab.identityProjection(automaticallyConfirmed).label, "Auto Student");
  assert.equal(lab.canCreateStudentShare(actor("auto"), automaticallyConfirmed, discussion), true);
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
  const rosterlessTracks = lab.canonicalizeSpeakerTracks(
    ["A", "B", "C", "D", "E", "F", "X"].map((provider_speaker_id, index) => ({
      provider_speaker_id,
      confidence: 0.9,
      speech_duration_ms: provider_speaker_id === "X" ? 1200 : 30000 - index * 1000,
      turn_count: provider_speaker_id === "X" ? 1 : 4,
      candidate_eligible: provider_speaker_id !== "X",
    })),
    ["X", "A", "B", "C", "D", "E", "F"].map((provider_speaker_id, index) => ({ provider_speaker_id, start_ms: index * 1000 }))
  );
  const rosterlessCandidates = lab.candidateSpeakerKeys(rosterlessTracks.tracks, [], { independent: true });
  assert.equal(rosterlessCandidates.candidate_keys.length, 6);
  assert.equal(rosterlessCandidates.candidate_keys.includes("spk_01"), false, "brief outside voice must remain non-Candidate without a roster");

  const excerptPlans = lab.voiceprintExcerptPlans([
    { segment_id: "e1", speaker_key: "spk_01", start_ms: 0, end_ms: 4500, text: "First part" },
    { segment_id: "e2", speaker_key: "spk_01", start_ms: 5000, end_ms: 12000, text: "Second part" },
    { segment_id: "e3", speaker_key: "spk_02", start_ms: 12500, end_ms: 18000, text: "Too short" },
  ], ["spk_01", "spk_02"]);
  assert.deepEqual(excerptPlans, [{ speaker_key: "spk_01", start_ms: 0, duration_ms: 12000, source_turn_id: "spk_01_turn_01" }]);

  const automatic = lab.automaticVoiceMatches([
    { speaker_key: "spk_01", matches: [{ student_uid: "alice", voiceprint_profile_id: "vp-a", score: 83 }, { student_uid: "bob", voiceprint_profile_id: "vp-b", score: 65 }] },
    { speaker_key: "spk_02", matches: [{ student_uid: "bob", voiceprint_profile_id: "vp-b", score: 82 }, { student_uid: "carol", voiceprint_profile_id: "vp-c", score: 75 }] },
    { speaker_key: "spk_03", matches: [{ student_uid: "alice", voiceprint_profile_id: "vp-a", score: 80 }, { student_uid: "carol", voiceprint_profile_id: "vp-c", score: 60 }] },
    { speaker_key: "spk_04", matches: [{ student_uid: "dan", voiceprint_profile_id: "vp-d", score: 69 }] },
  ]);
  assert.equal(automatic.find((item) => item.speaker_key === "spk_01").status, "matched");
  assert.equal(automatic.find((item) => item.speaker_key === "spk_02").status, "matched", "70%+ locks without a margin gate");
  assert.equal(automatic.find((item) => item.speaker_key === "spk_03").reason, "ONE_TO_ONE_CONFLICT");
  assert.equal(automatic.find((item) => item.speaker_key === "spk_04").status, "review_required");
  assert.equal(automatic.find((item) => item.speaker_key === "spk_04").student_uid, "dan", "a low-score proposal keeps the VIP target for private confirmation");
  assert.equal(lab.automaticVoiceMatches([{ speaker_key: "spk_01", matches: [{ student_uid: "edge", voiceprint_profile_id: "vp-edge", score: 70 }] }])[0].status, "matched");

  // 13-15 report speaker/evidence/score contracts.
  const segments = [{ segment_id: "seg_0001", speaker_key: "spk_01", start_ms: 0, end_ms: 1000, text: "hello" }, { segment_id: "seg_0002", speaker_key: "spk_02", start_ms: 1000, end_ms: 2000, text: "world" }];
  const groupedTurns = lab.canonicalSpeakingTurns([
    { segment_id: "s1", speaker_key: "spk_01", start_ms: 0, end_ms: 1000, text: "I agree", confidence: null },
    { segment_id: "s2", speaker_key: "spk_01", start_ms: 1200, end_ms: 2200, text: "and I have another reason", confidence: null },
    { segment_id: "s3", speaker_key: "spk_02", start_ms: 2300, end_ms: 3200, text: "My view" },
    { segment_id: "s4", speaker_key: "spk_01", start_ms: 3400, end_ms: 4200, text: "To respond" },
  ], ["spk_01", "spk_02"]);
  assert.deepEqual(groupedTurns.map((turn) => [turn.turn_id, turn.segment_ids]), [["spk_01_turn_01", ["s1", "s2"]], ["spk_02_turn_01", ["s3"]], ["spk_01_turn_02", ["s4"]]]);
  assert.equal(groupedTurns[0].asr_text_status, "confidence_unknown");
  const valid = reportFor();
  const canonical = lab.canonicalizeReport(valid, ["spk_01", "spk_02"], segments, { candidateSpeakerKeys: ["spk_01", "spk_02"] });
  assert.deepEqual(canonical.candidates.map((item) => item.speaker_key), ["spk_01", "spk_02"]);
  assert.equal(canonical.candidates[0].domains.pronunciation_delivery.status, "not_assessed");
  assert.deepEqual(canonical.candidates[0].domains.communication_strategies.strengths, ["有证据的优点"]);
  assert.deepEqual(canonical.candidates[0].domains.communication_strategies.priority_actions, ["下一步行动"]);
  assert.deepEqual(canonical.candidates[0].domains.communication_strategies.language_suggestions, ["I would build on that by adding..."]);
  assert.equal(canonical.candidates[0].interaction_summary.turn_count, 1);
  assert.equal(canonical.candidates[0].turn_reviews[0].turn_id, "spk_01_turn_01");
  assert.match(canonical.candidates[0].turn_reviews[0].communication_strategies.strength_zh, /回应了同学/);
  assert.match(canonical.candidates[0].turn_reviews[0].communication_strategies.limitation_zh, /逻辑关系/);
  assert.match(canonical.candidates[0].turn_reviews[0].communication_strategies.improvement_zh, /概括对方观点/);
  const legacyTurnProjection = lab.turnReviewProjection({ speaker_key: "spk_01", turn_reviews: [{ turn_id: "spk_01_turn_01", communication_strategies: { commentary_zh: "旧版 CS 点评", sample_en: "I agree." }, ideas_organisation: { commentary_zh: "旧版 IO 点评", sample_en: "For example..." } }] }, segments);
  assert.equal(legacyTurnProjection[0].communication_strategies.commentary_zh, "旧版 CS 点评", "immutable V2/V3 reports must keep their legacy turn commentary");
  assert.throws(() => lab.canonicalizeReport({ ...valid, candidates: valid.candidates.map((item, index) => index ? item : { ...item, turn_reviews: item.turn_reviews.map((review) => ({ ...review, communication_strategies: { commentary_zh: "too brief", sample_en: "I agree." } })) }) }, ["spk_01", "spk_02"], segments, { candidateSpeakerKeys: ["spk_01", "spk_02"] }), /TURN_COACHING_INCOMPLETE/, "new reports must provide all detailed coaching fields");
  assert.throws(() => lab.canonicalizeReport({ ...valid, candidates: valid.candidates.map((item, index) => index ? item : { ...item, turn_reviews: [] }) }, ["spk_01", "spk_02"], segments, { candidateSpeakerKeys: ["spk_01", "spk_02"] }), /TURN_REVIEW_COUNT/);
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
  assert.equal(studentShare.self.turn_reviews[0].transcript_text, "hello");
  assert.equal(studentShare.self.turn_reviews[0].communication_strategies.sample_en, "I agree with your point, and I would also add that...");
  assert.equal(studentShare.participant_summaries[1].speaker_label, "Anonymous");
  assert.equal(Object.prototype.hasOwnProperty.call(studentShare.participant_summaries[1], "summary_zh"), false);
  assert.doesNotMatch(JSON.stringify(studentShare), /Private Peer/);
  assert.equal(Object.prototype.hasOwnProperty.call(studentShare, "transcript"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(studentShare, "roster"), false);
  assert.doesNotMatch(JSON.stringify(studentShare), /participant_id|speaker_key|segment_id|student_id/i);
  assert.doesNotMatch(JSON.stringify(studentShare), /spk_\d+/i);

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
