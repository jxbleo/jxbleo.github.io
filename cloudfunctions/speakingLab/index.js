"use strict";

const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");
const { CloudBase } = require("@cloudbase/node-sdk/dist/cloudbase");
const tcbApiCaller = require("@cloudbase/node-sdk/dist/utils/tcbapirequester");
const lab = require("../_shared/speaking-lab");
const voiceprintProvider = require("../_shared/tencent-asr-voiceprint");
const { createSpeechProvider } = require("./speech-provider");
const { createModelProvider } = require("./model-provider");
const { SPEAKING_REPORT_SCHEMA_VERSION } = require("./schemas");
const { PROMPT_VERSION, dseAnalysisPrompt, dseAnalysisUserPrompt } = require("./prompts");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const DISCUSSIONS = "speaking_discussions";
const PARTICIPANTS = "speaking_participants";
const ASSETS = "speaking_audio_assets";
const JOBS = "speaking_ai_jobs";
const REPORTS = "speaking_reports";
const EVENTS = "speaking_identity_events";
const SHARES = "speaking_share_links";
const USAGE = "speaking_model_usage_events";
const VOICEPRINTS = "speaking_voiceprints";
const VOICEPRINT_EVENTS = "speaking_voiceprint_events";
const MAX_TITLE = 120;
const MAX_PROMPT = 10000;
const MAX_FILE_BYTES = 120 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
const VOICE_PASSAGE_VERSION = "dse-voice-reference-v1";
const VOICEPRINT_PASSAGE_VERSION = "dse-reusable-voiceprint-v1";
const VOICEPRINT_PASSAGE = "Many people have different ideas. I will listen carefully, explain my view, and respond clearly to the group before we reach a conclusion.";

function now() { return new Date(); }
function id(prefix) { return `${prefix}_${crypto.randomBytes(16).toString("hex")}`; }
function stable(prefix, ...parts) { return `${prefix}_${crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 40)}`; }
function secretMatches(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function replaceFields(values, fields) {
  const command = db.command;
  const update = { ...values };
  fields.forEach((field) => { if (command && command.set) update[field] = command.set(values[field]); });
  return update;
}
async function getOne(collection, where) {
  const result = await db.collection(collection).where(where).limit(1).get();
  return result.data && result.data[0] ? result.data[0] : null;
}
async function getMany(collection, where, limit = 500) {
  const result = await db.collection(collection).where(where || {}).limit(limit).get();
  return result.data || [];
}
function sortParticipants(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0) || String(left.participant_id || "").localeCompare(String(right.participant_id || "")));
}
function voiceprintSubjectKey(participant) {
  if (!participant) return "";
  return lab.participantKind(participant) === "guest"
    ? `guest:${lab.text(participant.participant_id || participant._id, 120)}`
    : `vip:${lab.text(participant.student_uid, 160)}`;
}
function voiceprintStatusView(row) {
  return {
    status: row && row.status === "active" ? "active" : "missing",
    enrollment_revision: row && Number.isInteger(row.enrollment_revision) ? row.enrollment_revision : 0,
    passage_version: row && row.passage_version || VOICEPRINT_PASSAGE_VERSION,
    updated_at: row && row.updated_at || null,
    subject_kind: row && row.subject_kind || null,
  };
}
async function voiceprintForSubject(subjectKey) {
  if (!subjectKey) return null;
  return getOne(VOICEPRINTS, { subject_key: subjectKey, status: "active" });
}
async function participantsWithVoiceprintStatus(participants) {
  return Promise.all((Array.isArray(participants) ? participants : []).map(async (participant) => {
    const profile = await voiceprintForSubject(voiceprintSubjectKey(participant));
    return { ...participant, reusable_voiceprint_status: profile ? "active" : "missing", reusable_voiceprint_updated_at: profile && profile.updated_at || null };
  }));
}
async function profileForAuth() {
  const user = await app.auth().getUserInfo();
  const uid = user && (user.uid || user.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");
  const profile = await getOne("students", { auth_uid: String(uid), active: true });
  if (!profile) throw new Error("STUDENT_NOT_LINKED");
  if (!['student', 'teacher'].includes(String(profile.role || "student"))) throw new Error("PROFILE_ROLE_INVALID");
  return { ...profile, auth_uid: String(uid), role: profile.role || "student" };
}
async function discussionRows(discussionId) {
  const discussion = await getOne(DISCUSSIONS, { discussion_id: lab.text(discussionId, 120) });
  if (!discussion || discussion.deleted_at) throw new Error("DISCUSSION_NOT_FOUND");
  const participants = sortParticipants((await getMany(PARTICIPANTS, { discussion_id: discussion.discussion_id }, 20)).filter((participant) => !participant.removed_at));
  return { discussion, participants };
}
async function authorizedDiscussion(actor, discussionId, write = false) {
  const rows = await discussionRows(discussionId);
  const allowed = write ? lab.canEditDiscussion(actor, rows.discussion, rows.participants) : lab.canReadDiscussion(actor, rows.discussion, rows.participants);
  if (!allowed) throw new Error("DISCUSSION_ACCESS_DENIED");
  return rows;
}
function participantView(row, actor, discussion, index = 0) {
  const item = lab.normalizeParticipant(row);
  const self = Boolean(item.student_uid && lab.actorUid(actor) === item.student_uid);
  const matchedNumber = String(item.matched_speaker_key || "").replace(/^spk_0*/, "");
  const projection = lab.identityProjection(row, { fallbackLabel: matchedNumber ? `Speaker ${matchedNumber}` : `Speaker ${index + 1}` });
  return {
    participant_id: item.participant_id,
    kind: item.kind,
    is_self: Boolean(self),
    is_creator: Boolean(item.student_uid && String(item.student_uid) === String(discussion && discussion.creator_uid || "")),
    roster_display_name: item.kind === "guest" ? item.guest_name : item.display_name,
    display_name: item.kind === "guest" ? item.guest_name : projection.label,
    guest_name_not_verified: item.kind === "guest",
    invitation_status: item.invitation_status,
    identity_status: item.identity_status,
    matched_speaker_key: item.matched_speaker_key,
    mapping_revision: item.mapping_revision,
    voice_reference_status: row.voice_reference_status || "missing",
    voice_reference_passage_version: row.voice_reference_passage_version || VOICE_PASSAGE_VERSION,
    reusable_voiceprint_status: row.reusable_voiceprint_status || "missing",
    reusable_voiceprint_updated_at: row.reusable_voiceprint_updated_at || null,
  };
}
function discussionView(actor, discussion, participants) {
  return {
    discussion_id: discussion.discussion_id,
    title: lab.text(discussion.title, MAX_TITLE),
    discussion_date: discussion.discussion_date || null,
    prompt_text: lab.text(discussion.prompt_text, MAX_PROMPT),
    prompt_source: "typed",
    duration_seconds: lab.normalizeDurationSeconds(discussion.duration_seconds, discussion.participant_count || participants.length),
    participant_count: participants.length,
    roster_status: discussion.roster_status || "draft",
    recording_status: discussion.recording_status || "missing",
    analysis_status: discussion.analysis_status || "not_ready",
    mapping_revision: Number(discussion.mapping_revision || 0),
    active_report_version: discussion.active_report_version || null,
    created_at: discussion.created_at || null,
    updated_at: discussion.updated_at || null,
    can_edit_roster: lab.canEditDiscussion(actor, discussion, participants),
    participants: participants.map((row, index) => participantView(row, actor, discussion, index)),
  };
}
function uploadMetadataView(metadata, cloudPath) {
  const data = metadata && metadata.data || metadata || {};
  return {
    file_id: data.fileID || data.fileId || data.file_id || null,
    cos_file_id: data.cosFileId || data.cos_file_id || null,
    url: data.url || data.uploadUrl || data.upload_url || null,
    upload_url: data.uploadUrl || data.upload_url || data.url || null,
    authorization: data.authorization || null,
    token: data.token || null,
    cloud_path: cloudPath,
  };
}
function reportAnalysis(report) {
  return report && report.dse_analysis && typeof report.dse_analysis === "object" ? report.dse_analysis : {};
}
function reportTranscript(report) {
  return report && report.transcript && typeof report.transcript === "object" ? report.transcript : { speaker_tracks: [], segments: [] };
}
async function invokeWorker(job) {
  const context = CloudBase.getCloudbaseContext();
  const routeKey = context && context.TCB_ROUTE_KEY;
  const result = await tcbApiCaller.request({
    config: app.config,
    params: { action: "functions.invokeFunction", function_name: "speakingLab", async: true, request_data: JSON.stringify({ action: "processQueuedJob", job_id: job.job_id, dispatch_token: job.dispatch_token }) },
    method: "post", headers: { "content-type": "application/json", ...(routeKey ? { "X-TCB-Route-Key": routeKey } : {}) },
  });
  if (result && result.code) throw new Error("SPEAKING_JOB_DISPATCH_FAILED");
}

async function listDiscussions(actor, event) {
  const pageSize = Math.min(Math.max(Number(event.page_size || 20), 1), 50);
  const all = await getMany(DISCUSSIONS, {}, 500);
  const visible = [];
  for (const discussion of all.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))) {
    if (discussion.deleted_at) continue;
    const participants = sortParticipants(await getMany(PARTICIPANTS, { discussion_id: discussion.discussion_id }, 20));
    const ownPending = participants.some((participant) => String(participant.student_uid || "") === String(actor.auth_uid || "") && participant.invitation_status === "pending");
    if (lab.canReadDiscussion(actor, discussion, participants)) visible.push(discussionView(actor, discussion, participants));
    else if (ownPending && lab.isActiveStudent(actor)) visible.push({
      discussion_id: discussion.discussion_id, title: lab.text(discussion.title, MAX_TITLE), discussion_date: discussion.discussion_date || null,
      participant_count: participants.length, analysis_status: "invitation", roster_status: discussion.roster_status || "draft",
      invitation_pending: true, participants: participants.filter((participant) => !participant.removed_at).map((participant) => ({ participant_id: participant.participant_id, kind: lab.participantKind(participant), display_name: lab.participantKind(participant) === "guest" ? participant.guest_name : participant.display_name_snapshot, invitation_status: participant.invitation_status })),
    });
  }
  const offset = Math.max(0, Number(event.offset || 0));
  return { success: true, discussions: visible.slice(offset, offset + pageSize), next_offset: offset + pageSize < visible.length ? offset + pageSize : null };
}
async function getDiscussion(actor, event) {
  let rows;
  try { rows = await authorizedDiscussion(actor, event.discussion_id); } catch (error) {
    const candidate = await discussionRows(event.discussion_id);
    const pending = candidate.participants.find((participant) => String(participant.student_uid || "") === String(actor.auth_uid || "") && participant.invitation_status === "pending");
    if (!pending) throw error;
    const inviter = await getOne("students", { auth_uid: candidate.discussion.creator_uid, active: true });
    return { success: true, invitation: { discussion_id: candidate.discussion.discussion_id, title: lab.text(candidate.discussion.title, MAX_TITLE), discussion_date: candidate.discussion.discussion_date || null, inviter_name: lab.normalizeWhitespace(inviter && (inviter.english_name || inviter.name) || "Discussion creator", 160), participants: candidate.participants.map((participant) => ({ participant_id: participant.participant_id, kind: lab.participantKind(participant), display_name: lab.participantKind(participant) === "guest" ? participant.guest_name : participant.display_name_snapshot, invitation_status: participant.invitation_status, is_self: String(participant.student_uid || "") === String(actor.auth_uid || "") })) } };
  }
  rows.participants = await participantsWithVoiceprintStatus(rows.participants);
  const discussion = discussionView(actor, rows.discussion, rows.participants);
  if (rows.discussion.active_report_version) {
    const report = await getOne(REPORTS, { discussion_id: rows.discussion.discussion_id, report_version: rows.discussion.active_report_version, status: "ready" });
    if (report && report.dse_analysis) discussion.report = internalReportView(actor, report, rows.participants);
  }
  if (lab.isTeacher(actor)) {
    const events = await getMany(EVENTS, { discussion_id: rows.discussion.discussion_id }, 200);
    discussion.identity_disputes = events.filter((item) => item.event_type === "student_disputed").sort((left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0)).map((item) => ({ event_id: item.event_id, participant_id: item.participant_id, speaker_key: item.speaker_key || null, mapping_revision: Number(item.mapping_revision || 0), created_at: item.created_at || null }));
  }
  return { success: true, discussion };
}
function internalReportView(actor, report, participants) {
  const payload = reportAnalysis(report);
  const transcript = reportTranscript(report);
  const rows = Array.isArray(participants) ? participants : [];
  const labelFor = (key) => {
    const participant = rows.find((item) => String(item.matched_speaker_key || "") === String(key));
    if (!participant) return `Speaker ${String(key).replace(/^spk_0*/, "")}`;
    return lab.identityProjection(participant, { teacher: lab.isTeacher(actor), self: String(participant.student_uid) === String(actor.auth_uid), fallbackLabel: `Speaker ${String(key).replace(/^spk_0*/, "")}` }).label;
  };
  return {
    report_version: report.report_version,
    audio_quality: report.audio_quality || null,
    group_summary_zh: lab.text(payload.group_summary_zh, 1200),
    group_strengths: Array.isArray(payload.group_strengths) ? payload.group_strengths.slice(0, 12) : [],
    group_priorities: Array.isArray(payload.group_priorities) ? payload.group_priorities.slice(0, 12) : [],
    discussion_flow: Array.isArray(payload.discussion_flow) ? payload.discussion_flow.slice(0, 12) : [],
    candidates: (Array.isArray(payload.candidates) ? payload.candidates : []).map((candidate) => {
      const participant = rows.find((item) => String(item.matched_speaker_key || "") === String(candidate.speaker_key));
      return {
        ...candidate,
        speaker_label: labelFor(candidate.speaker_key),
        is_self: Boolean(participant && String(participant.student_uid || "") === String(actor.auth_uid || "")),
        turn_reviews: lab.turnReviewProjection(candidate, transcript.segments),
      };
    }),
    transcript: (Array.isArray(transcript.segments) ? transcript.segments : []).map((segment) => ({ segment_id: segment.segment_id, speaker_key: segment.speaker_key, speaker_label: labelFor(segment.speaker_key), start_ms: segment.start_ms, end_ms: segment.end_ms, text: lab.text(segment.text, 500) })),
  };
}
async function createDiscussion(actor, event) {
  if (!lab.isActiveStudent(actor)) throw new Error("STUDENT_REQUIRED");
  const title = lab.normalizeWhitespace(event.title, MAX_TITLE);
  const prompt = lab.text(event.prompt_text, MAX_PROMPT);
  if (!title) throw new Error("DISCUSSION_TITLE_REQUIRED");
  if (!prompt) throw new Error("DISCUSSION_PROMPT_REQUIRED");
  if (event.duration_seconds != null && event.duration_seconds !== "" && !lab.durationIsValid(event.duration_seconds)) throw new Error("DURATION_INVALID");
  const operationId = lab.stableOperationId(event.operation_id || "");
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  const discussionId = stable("speaking_discussion", actor.auth_uid, operationId);
  const replay = await getOne(DISCUSSIONS, { discussion_id: discussionId, creator_uid: actor.auth_uid });
  if (replay) {
    const replayParticipants = sortParticipants(await getMany(PARTICIPANTS, { discussion_id: discussionId }, 20));
    return { success: true, idempotent_replay: true, discussion: discussionView(actor, replay, replayParticipants) };
  }
  const created = now();
  const discussion = {
    discussion_id: discussionId, creator_uid: actor.auth_uid, title, discussion_date: lab.text(event.discussion_date, 30) || null,
    prompt_text: prompt, prompt_source: "typed", prompt_version: "dse-speaking-prompt-v1",
    participant_count: 1, duration_seconds: lab.normalizeDurationSeconds(event.duration_seconds, 3), roster_status: "draft",
    recording_status: "missing", analysis_status: "not_ready", active_analysis_job_id: null, active_report_version: null,
    formal_audio_asset_id: null, created_at: created, updated_at: created, deleted_at: null,
    duration_source: Number.isFinite(Number(event.duration_seconds)) ? "manual" : "default",
    discussion_revision: 1, mapping_revision: 0, report_projection_revision: 0,
    operation_id: operationId,
  };
  const participant = {
    participant_id: id("participant"), discussion_id: discussionId, participant_kind: "vip", student_uid: actor.auth_uid,
    student_id_snapshot: lab.text(actor.student_id, 120), display_name_snapshot: lab.normalizeWhitespace(actor.english_name || actor.name || "", 160),
    invitation_status: "accepted", invited_at: created, responded_at: created, added_by_uid: actor.auth_uid, identity_status: "unmatched", mapping_revision: 0,
    voice_reference_status: "missing", created_at: created, updated_at: created,
  };
  try {
    await db.runTransaction(async (transaction) => {
      const collision = await transaction.collection(DISCUSSIONS).where({ discussion_id: discussionId }).limit(1).get();
      if (collision.data && collision.data[0]) throw new Error("DISCUSSION_ALREADY_EXISTS");
      await transaction.collection(DISCUSSIONS).doc(discussionId).create(discussion);
      await transaction.collection(PARTICIPANTS).doc(participant.participant_id).create(participant);
    });
  } catch (error) {
    const concurrent = await getOne(DISCUSSIONS, { discussion_id: discussionId, creator_uid: actor.auth_uid });
    if (!concurrent) throw error;
    const concurrentParticipants = sortParticipants(await getMany(PARTICIPANTS, { discussion_id: discussionId }, 20));
    return { success: true, idempotent_replay: true, discussion: discussionView(actor, concurrent, concurrentParticipants) };
  }
  return { success: true, discussion: discussionView(actor, discussion, [participant]) };
}
async function addParticipant(actor, event, kind) {
  const rows = await authorizedDiscussion(actor, event.discussion_id, true);
  const created = now();
  let participant;
  if (kind === "guest") {
    const guestName = lab.displayGuestName(event.guest_name);
    if (!guestName) throw new Error("GUEST_NAME_REQUIRED");
    participant = { participant_id: id("participant"), discussion_id: rows.discussion.discussion_id, participant_kind: "guest", student_uid: null, student_id_snapshot: null, guest_name: guestName, display_name_snapshot: guestName, guest_name_normalized: lab.normalizeGuestName(guestName), invitation_status: "not_applicable", invited_at: null, responded_at: null, identity_status: "unmatched", mapping_revision: 0, voice_reference_status: "missing", added_by_uid: actor.auth_uid, created_at: created, updated_at: created };
  } else {
    const studentId = lab.normalizeWhitespace(event.student_id, 120);
    if (!studentId) throw new Error("STUDENT_ID_REQUIRED");
    const profile = await getOne("students", { student_id: studentId, active: true });
    if (!profile || profile.role !== "student") throw new Error("STUDENT_NOT_FOUND");
    if (String(profile.auth_uid) === String(rows.discussion.creator_uid)) throw new Error("PARTICIPANT_SELF_ADD");
    participant = { participant_id: id("participant"), discussion_id: rows.discussion.discussion_id, participant_kind: "vip", student_uid: profile.auth_uid, student_id_snapshot: profile.student_id, display_name_snapshot: lab.normalizeWhitespace(profile.english_name || profile.name || "", 160), invitation_status: "pending", invited_at: created, responded_at: null, identity_status: "unmatched", mapping_revision: 0, voice_reference_status: "missing", added_by_uid: actor.auth_uid, created_at: created, updated_at: created };
  }
  let participantCount = 0;
  await db.runTransaction(async (transaction) => {
    const discussionResult = await transaction.collection(DISCUSSIONS).where({ discussion_id: rows.discussion.discussion_id }).limit(1).get();
    const currentDiscussion = discussionResult.data && discussionResult.data[0];
    const participantResult = await transaction.collection(PARTICIPANTS).where({ discussion_id: rows.discussion.discussion_id }).limit(20).get();
    const current = (participantResult.data || []).filter((item) => !item.removed_at);
    if (!currentDiscussion || currentDiscussion.deleted_at || !lab.canEditDiscussion(actor, currentDiscussion, current)) throw new Error("DISCUSSION_ACCESS_DENIED");
    if (currentDiscussion.roster_status !== "draft") throw new Error("ROSTER_FROZEN");
    if (current.length >= 6) throw new Error("PARTICIPANT_LIMIT_REACHED");
    if (kind === "guest" && !lab.isGuestNameAvailable(current, participant.guest_name)) throw new Error("GUEST_NAME_DUPLICATE");
    if (kind === "vip" && current.some((item) => lab.participantKind(item) === "vip" && String(item.student_uid) === String(participant.student_uid))) throw new Error("PARTICIPANT_ALREADY_ADDED");
    if (kind === "vip" && current.some((item) => lab.participantKind(item) === "guest" && lab.normalizeGuestName(item.guest_name) === lab.normalizeGuestName(participant.display_name_snapshot))) throw new Error("GUEST_NAME_DUPLICATE");
    participantCount = current.length + 1;
    await transaction.collection(PARTICIPANTS).doc(participant.participant_id).create(participant);
    await transaction.collection(DISCUSSIONS).doc(currentDiscussion._id || currentDiscussion.discussion_id).update({ participant_count: participantCount, ...(currentDiscussion.duration_source === "default" ? { duration_seconds: lab.durationForParticipantCount(participantCount) } : {}), updated_at: created });
  });
  return { success: true, participant: participantView(participant, actor, rows.discussion, participantCount - 1), participant_count: participantCount };
}
async function respondInvitation(actor, event) {
  const participant = await getOne(PARTICIPANTS, { participant_id: lab.text(event.participant_id, 120) });
  if (!participant || lab.participantKind(participant) !== "vip" || String(participant.student_uid) !== String(actor.auth_uid)) throw new Error("INVITATION_NOT_FOUND");
  const response = String(event.response || "").toLowerCase();
  if (!["accept", "accepted", "decline", "declined"].includes(response)) throw new Error("INVITATION_RESPONSE_INVALID");
  const status = response.startsWith("accept") ? "accepted" : "declined";
  let replay = false;
  await db.runTransaction(async (transaction) => {
    const participantResult = await transaction.collection(PARTICIPANTS).where({ participant_id: participant.participant_id }).limit(1).get();
    const current = participantResult.data && participantResult.data[0];
    const discussionResult = await transaction.collection(DISCUSSIONS).where({ discussion_id: participant.discussion_id }).limit(1).get();
    const discussion = discussionResult.data && discussionResult.data[0];
    if (!current || !discussion || discussion.deleted_at || String(current.student_uid || "") !== String(actor.auth_uid)) throw new Error("INVITATION_NOT_AVAILABLE");
    if (current.invitation_status === status) { replay = true; return; }
    if (!lab.canAcceptInvitation(actor, current, discussion)) throw new Error("INVITATION_NOT_AVAILABLE");
    const respondedAt = now();
    await transaction.collection(PARTICIPANTS).doc(current._id || current.participant_id).update({ invitation_status: status, responded_at: respondedAt, updated_at: respondedAt });
  });
  return { success: true, ...(replay ? { idempotent_replay: true } : {}), invitation_status: status };
}
async function renameGuest(actor, event) {
  const rows = await authorizedDiscussion(actor, event.discussion_id, true);
  const participant = rows.participants.find((item) => String(item.participant_id) === String(event.participant_id) && lab.participantKind(item) === "guest");
  if (!participant) throw new Error("PARTICIPANT_NOT_FOUND");
  const guestName = lab.displayGuestName(event.guest_name);
  if (!guestName) throw new Error("GUEST_NAME_REQUIRED");
  const changedAt = now();
  await db.runTransaction(async (transaction) => {
    const discussionResult = await transaction.collection(DISCUSSIONS).where({ discussion_id: rows.discussion.discussion_id }).limit(1).get();
    const currentDiscussion = discussionResult.data && discussionResult.data[0];
    const participantResult = await transaction.collection(PARTICIPANTS).where({ discussion_id: rows.discussion.discussion_id }).limit(20).get();
    const current = (participantResult.data || []).filter((item) => !item.removed_at);
    const currentParticipant = current.find((item) => String(item.participant_id) === String(participant.participant_id) && lab.participantKind(item) === "guest");
    if (!currentDiscussion || !currentParticipant || !lab.canEditDiscussion(actor, currentDiscussion, current)) throw new Error("DISCUSSION_ACCESS_DENIED");
    if (!lab.isGuestNameAvailable(current, guestName, currentParticipant.participant_id)) throw new Error("GUEST_NAME_DUPLICATE");
    await transaction.collection(PARTICIPANTS).doc(currentParticipant._id || currentParticipant.participant_id).update({ guest_name: guestName, display_name_snapshot: guestName, guest_name_normalized: lab.normalizeGuestName(guestName), updated_at: changedAt });
    await transaction.collection(DISCUSSIONS).doc(currentDiscussion._id || currentDiscussion.discussion_id).update({ report_projection_revision: Number(currentDiscussion.report_projection_revision || 0) + 1, updated_at: changedAt });
  });
  await invalidateShares(rows.discussion.discussion_id, {
    reason: "GUEST_NAME_CHANGED",
    predicate: (share) => share.share_kind === "teacher" && Array.isArray(share.name_visible_participant_ids) && share.name_visible_participant_ids.includes(participant.participant_id),
  });
  return { success: true, participant_id: participant.participant_id, guest_name: guestName };
}
async function updateDiscussionDuration(actor, event) {
  const rows = await authorizedDiscussion(actor, event.discussion_id, true);
  if (rows.discussion.roster_status !== "draft" || rows.discussion.recording_status === "uploaded" || rows.discussion.analysis_status !== "not_ready") throw new Error("RECORDING_SETUP_LOCKED");
  if (!lab.durationIsValid(event.duration_seconds)) throw new Error("DURATION_INVALID");
  const changedAt = now();
  const duration = Number(event.duration_seconds);
  await db.collection(DISCUSSIONS).doc(rows.discussion._id || rows.discussion.discussion_id).update({ duration_seconds: duration, duration_source: "manual", updated_at: changedAt });
  return { success: true, duration_seconds: duration, duration_source: "manual" };
}

async function startAudioUpload(actor, event, kind = "formal") {
  const rows = await authorizedDiscussion(actor, event.discussion_id, false);
  const acceptedCaller = rows.participants.some((item) => lab.participantKind(item) === "vip" && String(item.student_uid) === String(actor.auth_uid) && item.invitation_status === "accepted");
  if (!lab.isTeacher(actor) && !acceptedCaller) throw new Error("DISCUSSION_ACCESS_DENIED");
  let targetParticipant = null;
  if (kind === "voice_reference") {
    targetParticipant = rows.participants.find((item) => String(item.participant_id) === String(event.participant_id));
    if (!targetParticipant) throw new Error("PARTICIPANT_NOT_FOUND");
  }
  const operationId = lab.stableOperationId(event.operation_id);
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  const mime = lab.text(event.mime_type, 80).toLowerCase();
  const size = Number(event.size_bytes);
  const max = kind === "voice_reference" ? MAX_REFERENCE_BYTES : MAX_FILE_BYTES;
  const assetKind = kind === "voice_reference" ? "voice_reference" : "formal_discussion";
  if (!/^audio\/(webm|mp4|mpeg|wav|x-m4a|aac)$/.test(mime) || !Number.isFinite(size) || size < 1 || size > max) throw new Error("AUDIO_FILE_INVALID");
  const assetId = stable(`speaking_${kind}_asset`, actor.auth_uid, rows.discussion.discussion_id, operationId, String(event.participant_id || ""));
  const existing = await getOne(ASSETS, { asset_id: assetId, discussion_id: rows.discussion.discussion_id });
  if (existing) {
    if (existing.asset_kind !== assetKind || String(existing.participant_id || "") !== String(kind === "voice_reference" ? targetParticipant.participant_id : "") || existing.mime_type !== mime || Number(existing.expected_size_bytes) !== Math.round(size)) throw new Error("IDEMPOTENCY_KEY_REUSED");
    if (existing.status === "uploaded") return { success: true, idempotent_replay: true, asset_id: existing.asset_id, status: "uploaded" };
    if (existing.status !== "uploading") throw new Error("AUDIO_UPLOAD_INCOMPLETE");
    if (kind === "voice_reference" && !["missing", "uploading", "uploaded", "quality_failed"].includes(String(targetParticipant.voice_reference_status || "missing"))) throw new Error("VOICE_REFERENCE_LOCKED");
    if (kind === "formal" && rows.discussion.roster_status !== "draft" && !lab.isTeacher(actor)) throw new Error("ROSTER_FROZEN");
    if (kind === "formal" && rows.discussion.analysis_status !== "not_ready" && !lab.isTeacher(actor)) throw new Error("ANALYSIS_ALREADY_STARTED");
    const replayMetadata = await app.getUploadMetadata({ cloudPath: existing.cloud_path });
    const replayUpload = uploadMetadataView(replayMetadata, existing.cloud_path);
    await db.collection(ASSETS).doc(existing._id || existing.asset_id).update({ file_id: replayUpload.file_id, expires_at: new Date(Date.now() + 30 * 60 * 1000), updated_at: now() });
    return { success: true, idempotent_replay: true, asset_id: existing.asset_id, upload: replayUpload };
  }
  if (kind === "voice_reference" && !["missing", "uploading", "uploaded", "quality_failed"].includes(String(targetParticipant.voice_reference_status || "missing"))) throw new Error("VOICE_REFERENCE_LOCKED");
  if (kind === "formal" && rows.discussion.roster_status !== "draft" && !lab.isTeacher(actor)) throw new Error("ROSTER_FROZEN");
  if (kind === "formal" && rows.discussion.analysis_status !== "not_ready" && !lab.isTeacher(actor)) throw new Error("ANALYSIS_ALREADY_STARTED");
  const extension = mime.split("/")[1].replace("x-", "");
  const cloudPath = `speaking-lab/${rows.discussion.discussion_id}/${assetId}.${extension}`;
  const metadata = await app.getUploadMetadata({ cloudPath });
  const upload = uploadMetadataView(metadata, cloudPath);
  const created = now();
  const asset = { asset_id: assetId, discussion_id: rows.discussion.discussion_id, participant_id: kind === "voice_reference" ? targetParticipant.participant_id : null, asset_kind: assetKind, upload_operation_id: operationId, status: "uploading", file_id: upload.file_id, cloud_path: cloudPath, mime_type: mime, expected_size_bytes: Math.round(size), actual_size_bytes: null, duration_ms: null, quality_status: "pending", quality_codes: [], created_at: created, updated_at: created, expires_at: new Date(created.getTime() + 30 * 60 * 1000), delete_after: null };
  await db.collection(ASSETS).doc(assetId).create(asset);
  return { success: true, asset_id: assetId, upload };
}
async function finishAudioUpload(actor, event, kind = "formal") {
  const rows = await authorizedDiscussion(actor, event.discussion_id, false);
  const acceptedCaller = rows.participants.some((item) => lab.participantKind(item) === "vip" && String(item.student_uid) === String(actor.auth_uid) && item.invitation_status === "accepted");
  if (!lab.isTeacher(actor) && !acceptedCaller) throw new Error("DISCUSSION_ACCESS_DENIED");
  const operationId = lab.stableOperationId(event.operation_id);
  const assetKind = kind === "voice_reference" ? "voice_reference" : "formal_discussion";
  const asset = await getOne(ASSETS, { asset_id: lab.text(event.asset_id, 120), discussion_id: rows.discussion.discussion_id, upload_operation_id: operationId });
  if (!asset) throw new Error("AUDIO_UPLOAD_INCOMPLETE");
  if (asset.asset_kind !== assetKind) throw new Error("AUDIO_UPLOAD_INCOMPLETE");
  if (asset.status === "uploaded") return { success: true, idempotent_replay: true, asset_id: asset.asset_id };
  const info = await app.getFileInfo({ fileList: [asset.file_id] });
  const file = info && info.fileList && info.fileList[0];
  if (!file || Number(file.size || 0) < 1 || Number(file.size || 0) > (kind === "voice_reference" ? MAX_REFERENCE_BYTES : MAX_FILE_BYTES) || Number(file.size || 0) !== Number(asset.expected_size_bytes || 0)) throw new Error("AUDIO_UPLOAD_INCOMPLETE");
  const uploadedAt = now();
  await db.collection(ASSETS).doc(asset._id || asset.asset_id).update({ status: "uploaded", actual_size_bytes: Number(file.size), uploaded_at: uploadedAt, updated_at: uploadedAt, expires_at: null });
  if (kind === "formal") {
    const replacing = Boolean(rows.discussion.formal_audio_asset_id && rows.discussion.formal_audio_asset_id !== asset.asset_id);
    if (rows.discussion.formal_audio_asset_id && rows.discussion.formal_audio_asset_id !== asset.asset_id) {
      const previous = await getOne(ASSETS, { asset_id: rows.discussion.formal_audio_asset_id, discussion_id: rows.discussion.discussion_id });
      if (previous) await db.collection(ASSETS).doc(previous._id || previous.asset_id).update({ status: "superseded", superseded_by_asset_id: asset.asset_id, updated_at: uploadedAt });
    }
    await db.collection(DISCUSSIONS).doc(rows.discussion._id || rows.discussion.discussion_id).update({ formal_audio_asset_id: asset.asset_id, recording_status: "uploaded", analysis_status: "not_ready", active_analysis_job_id: null, active_report_version: null, discussion_revision: Number(rows.discussion.discussion_revision || 1) + (replacing ? 1 : 0), updated_at: uploadedAt });
    if (replacing) await invalidateShares(rows.discussion.discussion_id, { reason: "FORMAL_AUDIO_REPLACED" });
  }
  else {
    const participant = rows.participants.find((item) => String(item.participant_id) === String(asset.participant_id));
    if (!participant) throw new Error("PARTICIPANT_NOT_FOUND");
    if (!["missing", "uploading", "uploaded", "quality_failed"].includes(String(participant.voice_reference_status || "missing"))) throw new Error("VOICE_REFERENCE_LOCKED");
    if (participant.voice_reference_asset_id && participant.voice_reference_asset_id !== asset.asset_id) {
      const previous = await getOne(ASSETS, { asset_id: participant.voice_reference_asset_id, discussion_id: rows.discussion.discussion_id, asset_kind: "voice_reference" });
      if (previous && !previous.deleted_at) await db.collection(ASSETS).doc(previous._id || previous.asset_id).update({ status: "superseded", superseded_by_asset_id: asset.asset_id, delete_after: uploadedAt, updated_at: uploadedAt });
    }
    await db.collection(PARTICIPANTS).doc(participant._id || participant.participant_id).update({ voice_reference_asset_id: asset.asset_id, voice_reference_status: "uploaded", voice_reference_passage_version: VOICE_PASSAGE_VERSION, updated_at: uploadedAt });
  }
  return { success: true, asset_id: asset.asset_id, status: "uploaded" };
}
async function startVoiceReferenceUpload(actor, event) { return startAudioUpload(actor, event, "voice_reference"); }
async function finishVoiceReferenceUpload(actor, event) { return finishAudioUpload(actor, event, "voice_reference"); }
async function getVoiceConfirmationPlayback(actor, event) {
  const rows = await authorizedDiscussion(actor, event.discussion_id);
  const participant = rows.participants.find((item) => String(item.participant_id) === String(event.participant_id));
  if (!participant || (!lab.isTeacher(actor) && String(participant.student_uid || "") !== String(actor.auth_uid || ""))) throw new Error("VOICE_CONFIRMATION_DENIED");
  const playbackKind = event.playback_kind === "reference" ? "reference" : "formal_excerpt";
  let asset;
  let start;
  let end;
  if (playbackKind === "reference") {
    asset = await getOne(ASSETS, { asset_id: participant.voice_reference_asset_id, discussion_id: rows.discussion.discussion_id, participant_id: participant.participant_id, asset_kind: "voice_reference", status: "uploaded" });
    start = 0;
    end = Number(asset && asset.duration_ms);
  } else {
    if (!participant.matched_speaker_key) throw new Error("VOICE_MATCH_UNCERTAIN");
    asset = await getOne(ASSETS, { asset_id: rows.discussion.formal_audio_asset_id, discussion_id: rows.discussion.discussion_id, asset_kind: "formal_discussion", status: "uploaded" });
    const report = await getOne(REPORTS, { discussion_id: rows.discussion.discussion_id, report_version: rows.discussion.active_report_version, status: "ready" });
    const excerpt = (reportTranscript(report).segments || []).filter((segment) => String(segment.speaker_key) === String(participant.matched_speaker_key)).sort((left, right) => Number(left.start_ms) - Number(right.start_ms))[0];
    if (!excerpt) throw new Error("AUDIO_NOT_FOUND");
    start = Number(excerpt.start_ms);
    end = Math.min(Number(excerpt.end_ms), start + 12000);
  }
  const duration = Number(asset && asset.duration_ms);
  if (!asset || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || !Number.isFinite(duration) || end > duration) throw new Error("AUDIO_PLAYBACK_BOUNDS_INVALID");
  const result = await app.getTempFileURL({ fileList: [{ fileID: asset.file_id, maxAge: 300 }] });
  const row = result && result.fileList && result.fileList[0];
  if (!row || !(row.tempFileURL || row.tempFileUrl || row.url)) throw new Error("AUDIO_NOT_FOUND");
  return { success: true, url: row.tempFileURL || row.tempFileUrl || row.url, start_ms: start, end_ms: end, expires_at: new Date(Date.now() + 5 * 60 * 1000) };
}
async function teacherReopenVoiceReference(actor, event) {
  if (!lab.isTeacher(actor)) throw new Error("TEACHER_REQUIRED");
  const rows = await authorizedDiscussion(actor, event.discussion_id);
  const participant = rows.participants.find((item) => String(item.participant_id) === String(event.participant_id) && lab.participantKind(item) === "vip");
  if (!participant) throw new Error("PARTICIPANT_NOT_FOUND");
  const eventId = id("identity_event");
  const changedAt = now();
  const nextRevision = Number(rows.discussion.mapping_revision || 0) + 1;
  await db.runTransaction(async (transaction) => {
    const discussionResult = await transaction.collection(DISCUSSIONS).where({ discussion_id: rows.discussion.discussion_id }).limit(1).get();
    const currentDiscussion = discussionResult.data && discussionResult.data[0];
    const participantResult = await transaction.collection(PARTICIPANTS).where({ participant_id: participant.participant_id }).limit(1).get();
    const currentParticipant = participantResult.data && participantResult.data[0];
    if (!currentDiscussion || !currentParticipant || Number(currentDiscussion.mapping_revision || 0) !== Number(rows.discussion.mapping_revision || 0)) throw new Error("VOICE_MATCH_STALE");
    await transaction.collection(PARTICIPANTS).doc(currentParticipant._id || currentParticipant.participant_id).update({ voice_reference_asset_id: null, voice_reference_status: "missing", identity_status: "unmatched", matched_speaker_key: null, mapping_revision: nextRevision, identity_confirmed_at: null, identity_confirmed_by_uid: null, identity_confirmation_source: null, updated_at: changedAt });
    await transaction.collection(DISCUSSIONS).doc(currentDiscussion._id || currentDiscussion.discussion_id).update({ mapping_revision: nextRevision, report_projection_revision: Number(currentDiscussion.report_projection_revision || 0) + 1, updated_at: changedAt });
    await transaction.collection(EVENTS).doc(eventId).create({ event_id: eventId, discussion_id: rows.discussion.discussion_id, participant_id: participant.participant_id, event_type: "teacher_reopened_voice_reference", mapping_revision: nextRevision, actor_uid: actor.auth_uid, created_at: changedAt });
  });
  await invalidateShares(rows.discussion.discussion_id, { reason: "VOICE_MAPPING_CHANGED" });
  return { success: true, participant_id: participant.participant_id, voice_reference_status: "missing" };
}
async function removeParticipant(actor, event) {
  const rows = await authorizedDiscussion(actor, event.discussion_id, true);
  const participant = rows.participants.find((item) => String(item.participant_id) === String(event.participant_id));
  if (!participant) throw new Error("PARTICIPANT_NOT_FOUND");
  if (String(participant.student_uid || "") === String(rows.discussion.creator_uid || "")) throw new Error("CREATOR_CANNOT_REMOVE_SELF");
  const changedAt = now();
  await db.runTransaction(async (transaction) => {
    const discussionResult = await transaction.collection(DISCUSSIONS).where({ discussion_id: rows.discussion.discussion_id }).limit(1).get();
    const currentDiscussion = discussionResult.data && discussionResult.data[0];
    const participantResult = await transaction.collection(PARTICIPANTS).where({ discussion_id: rows.discussion.discussion_id }).limit(20).get();
    const current = (participantResult.data || []).filter((item) => !item.removed_at);
    const currentParticipant = current.find((item) => String(item.participant_id) === String(participant.participant_id));
    if (!currentDiscussion || !currentParticipant || !lab.canEditDiscussion(actor, currentDiscussion, current)) throw new Error("DISCUSSION_ACCESS_DENIED");
    if (currentDiscussion.roster_status !== "draft") throw new Error("ROSTER_FROZEN");
    if (String(currentParticipant.student_uid || "") === String(currentDiscussion.creator_uid || "")) throw new Error("CREATOR_CANNOT_REMOVE_SELF");
    const participantCount = Math.max(1, current.length - 1);
    await transaction.collection(PARTICIPANTS).doc(currentParticipant._id || currentParticipant.participant_id).update({ removed_at: changedAt, invitation_status: "removed", updated_at: changedAt });
    await transaction.collection(DISCUSSIONS).doc(currentDiscussion._id || currentDiscussion.discussion_id).update({ participant_count: participantCount, ...(currentDiscussion.duration_source === "default" ? { duration_seconds: lab.durationForParticipantCount(participantCount) } : {}), updated_at: changedAt });
  });
  if (lab.participantKind(participant) === "guest") {
    const guestVoiceprint = await voiceprintForSubject(voiceprintSubjectKey(participant));
    if (guestVoiceprint) await db.collection(VOICEPRINTS).doc(guestVoiceprint._id || guestVoiceprint.voiceprint_profile_id).update({ status: "delete_pending", delete_reason: "PARTICIPANT_REMOVED", delete_requested_at: changedAt, delete_requested_by_uid: actor.auth_uid, updated_at: changedAt });
  }
  await invalidateShares(rows.discussion.discussion_id);
  return { success: true, removed: true };
}

async function startAnalysis(actor, event) {
  const rows = await authorizedDiscussion(actor, event.discussion_id);
  if (!lab.canInviteOrFreeze(actor, rows.discussion, rows.participants) && !rows.participants.some((participant) => String(participant.student_uid) === String(actor.auth_uid) && participant.invitation_status === "accepted")) throw new Error("DISCUSSION_ACCESS_DENIED");
  const eligibility = lab.participantCountEligibility(rows.participants.length);
  if (!eligibility.eligible) throw new Error(eligibility.reason);
  if (!rows.discussion.formal_audio_asset_id) throw new Error("AUDIO_REQUIRED");
  const asset = await getOne(ASSETS, { asset_id: rows.discussion.formal_audio_asset_id, status: "uploaded" });
  if (!asset) throw new Error("AUDIO_UPLOAD_INCOMPLETE");
  const operationId = lab.stableOperationId(event.operation_id || `analysis:${rows.discussion.discussion_id}:${rows.discussion.updated_at || "1"}`);
  const discussionRevision = Number(rows.discussion.discussion_revision || 1);
  const jobId = stable("speaking_analysis_job", rows.discussion.discussion_id, String(discussionRevision), operationId);
  const old = await getOne(JOBS, { job_id: jobId });
  if (old && ["queued", "processing", "succeeded"].includes(old.status)) return { success: true, idempotent_replay: true, job: publicJob(old) };
  const reusableVoiceprints = (await Promise.all(rows.participants.map(async (participant) => {
    const profile = await voiceprintForSubject(voiceprintSubjectKey(participant));
    return profile ? { participant_id: participant.participant_id, voiceprint_profile_id: profile.voiceprint_profile_id, enrollment_revision: Number(profile.enrollment_revision || 0) } : null;
  }))).filter(Boolean);
  const created = now();
  const job = { job_id: jobId, operation_id: operationId, job_type: "discussion_analysis", discussion_id: rows.discussion.discussion_id, discussion_revision: discussionRevision, formal_audio_asset_id: asset.asset_id, reference_asset_ids: rows.participants.map((participant) => participant.voice_reference_asset_id).filter(Boolean), reusable_voiceprints: reusableVoiceprints, status: "queued", stage: "audio_quality", attempt_count: 0, max_attempts: 5, lease_token: null, lease_until: null, dispatch_token: crypto.randomBytes(24).toString("hex"), next_retry_at: created, safe_error_code: null, prompt_version: PROMPT_VERSION, schema_version: SPEAKING_REPORT_SCHEMA_VERSION, rubric_version: "dse-group-interaction-v1", provider_config_version: "speaking-provider-v1", created_at: created, updated_at: created, finished_at: null };
  let persistedJob = job;
  let replay = false;
  await db.runTransaction(async (transaction) => {
    const discussionResult = await transaction.collection(DISCUSSIONS).where({ discussion_id: rows.discussion.discussion_id }).limit(1).get();
    const currentDiscussion = discussionResult.data && discussionResult.data[0];
    if (!currentDiscussion || currentDiscussion.deleted_at || String(currentDiscussion.formal_audio_asset_id || "") !== String(asset.asset_id)) throw new Error("AUDIO_UPLOAD_INCOMPLETE");
    const jobResult = await transaction.collection(JOBS).where({ job_id: jobId }).limit(1).get();
    const currentJob = jobResult.data && jobResult.data[0];
    if (currentJob && ["queued", "processing", "succeeded"].includes(currentJob.status)) {
      persistedJob = currentJob;
      replay = true;
      return;
    }
    if (currentDiscussion.active_analysis_job_id && currentDiscussion.active_analysis_job_id !== jobId) {
      const priorResult = await transaction.collection(JOBS).where({ job_id: currentDiscussion.active_analysis_job_id }).limit(1).get();
      const prior = priorResult.data && priorResult.data[0];
      if (prior && ["queued", "processing"].includes(prior.status)) await transaction.collection(JOBS).doc(prior._id || prior.job_id).update({ status: "superseded", superseded_by_job_id: jobId, lease_token: null, lease_until: null, next_retry_at: null, finished_at: created, updated_at: created });
    }
    if (currentJob) await transaction.collection(JOBS).doc(currentJob._id || currentJob.job_id).update(job);
    else await transaction.collection(JOBS).doc(jobId).create(job);
    await transaction.collection(DISCUSSIONS).doc(currentDiscussion._id || currentDiscussion.discussion_id).update({ roster_status: "frozen", analysis_status: "queued", active_analysis_job_id: jobId, analysis_job_revision: job.discussion_revision, updated_at: created });
  });
  if (!replay) {
    try { await invokeWorker(persistedJob); } catch (error) { console.error("speakingLab dispatch failed", persistedJob.job_id, error && error.message); }
  }
  return { success: true, ...(replay ? { idempotent_replay: true } : {}), job: publicJob(persistedJob) };
}
function publicJob(job) { return { job_id: job.job_id, status: job.status, stage: job.stage, attempt_count: Number(job.attempt_count || 0), error_code: job.safe_error_code || null, created_at: job.created_at || null, updated_at: job.updated_at || null, finished_at: job.finished_at || null }; }

async function claimJob(job, token) {
  const leaseToken = crypto.randomBytes(24).toString("hex");
  const leaseUntil = new Date(Date.now() + 6 * 60 * 1000);
  let claimed = null;
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(JOBS).where({ job_id: job.job_id }).limit(1).get();
    const current = result.data && result.data[0];
    if (!current || current.status !== "queued" || !secretMatches(current.dispatch_token, token)) throw new Error("SPEAKING_JOB_NOT_AVAILABLE");
    const attemptCount = Number(current.attempt_count || 0) + 1;
    if (attemptCount > 5) throw new Error("SPEAKING_AI_RETRY_EXHAUSTED");
    const updatedAt = now();
    await transaction.collection(JOBS).doc(current._id || current.job_id).update({ status: "processing", stage: current.stage || "audio_quality", attempt_count: attemptCount, lease_token: leaseToken, lease_until: leaseUntil, updated_at: updatedAt });
    claimed = { ...current, status: "processing", lease_token: leaseToken, lease_until: leaseUntil, attempt_count: attemptCount, updated_at: updatedAt };
  });
  return claimed;
}
function reportIdentity(job) {
  return {
    report_id: stable("speaking_report", job.discussion_id, String(job.discussion_revision)),
    report_version: `discussion-r${Math.max(1, Number(job.discussion_revision || 1))}`,
  };
}
async function requeueClaimedJob(claimed, values = {}) {
  const changedAt = now();
  let accepted = false;
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(JOBS).where({ job_id: claimed.job_id }).limit(1).get();
    const current = result.data && result.data[0];
    if (!current || current.status !== "processing" || !secretMatches(current.lease_token, claimed.lease_token)) return;
    await transaction.collection(JOBS).doc(current._id || current.job_id).update({
      ...values,
      status: "queued",
      attempt_count: Math.max(0, Number(current.attempt_count || 1) - 1),
      lease_token: null,
      lease_until: null,
      next_retry_at: values.next_retry_at || new Date(Date.now() + 15000),
      updated_at: changedAt,
    });
    accepted = true;
  });
  return accepted;
}
async function temporaryAudioUrl(asset) {
  const result = await app.getTempFileURL({ fileList: [{ fileID: asset.file_id, maxAge: 7200 }] });
  const row = result && result.fileList && result.fileList[0];
  const url = row && (row.tempFileURL || row.tempFileUrl || row.url);
  if (!url) throw new Error("AUDIO_NOT_FOUND");
  return url;
}
async function upsertPipelineReport(job, values) {
  const identity = reportIdentity(job);
  const existing = await getOne(REPORTS, { report_id: identity.report_id });
  const changedAt = now();
  const row = {
    ...identity,
    discussion_id: job.discussion_id,
    discussion_revision: Number(job.discussion_revision || 1),
    job_id: job.job_id,
    schema_version: SPEAKING_REPORT_SCHEMA_VERSION,
    prompt_version: PROMPT_VERSION,
    rubric_version: job.rubric_version || "dse-group-interaction-v1",
    status: "processing",
    ...values,
    updated_at: changedAt,
  };
  if (existing) await db.collection(REPORTS).doc(existing._id || existing.report_id).update(row);
  else await db.collection(REPORTS).doc(identity.report_id).create({ ...row, created_at: changedAt });
  return { ...(existing || {}), ...row };
}
function providerUsageEvent(job, stage, callIndex, provider, metadata = {}) {
  const eventId = stable("speaking_usage", job.job_id, stage, String(callIndex));
  const usage = metadata.usage && typeof metadata.usage === "object" ? metadata.usage : {};
  const numeric = (value) => value != null && value !== "" && Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;
  return {
    event_id: eventId, job_id: job.job_id, discussion_id: job.discussion_id, operation_id: job.operation_id,
    stage, call_index: callIndex, provider, model: lab.text(metadata.model, 200) || null,
    protocol: lab.text(metadata.protocol, 100) || null, provider_request_id: lab.text(metadata.request_id, 200) || null,
    outcome: metadata.outcome === "failed" ? "failed" : "completed",
    safe_error_code: lab.text(metadata.safe_error_code, 120) || null,
    http_status: metadata.http_status != null && Number.isInteger(Number(metadata.http_status)) ? Number(metadata.http_status) : null,
    response_finish_reason: lab.text(metadata.response_diagnostics && metadata.response_diagnostics.finish_reason, 80) || null,
    response_content_length: numeric(metadata.response_diagnostics && metadata.response_diagnostics.content_length),
    response_content_shape: lab.text(metadata.response_diagnostics && metadata.response_diagnostics.content_shape, 40) || null,
    response_content_closed: metadata.response_diagnostics && typeof metadata.response_diagnostics.content_closed === "boolean" ? metadata.response_diagnostics.content_closed : null,
    response_has_reasoning_content: metadata.response_diagnostics && typeof metadata.response_diagnostics.has_reasoning_content === "boolean" ? metadata.response_diagnostics.has_reasoning_content : null,
    input_tokens: numeric(usage.input_tokens), output_tokens: numeric(usage.output_tokens), total_tokens: numeric(usage.total_tokens),
    cached_tokens: numeric(usage.cached_tokens), reasoning_tokens: numeric(usage.reasoning_tokens), audio_seconds: numeric(usage.audio_seconds),
    usage_status: Object.values(usage).some((value) => value != null) ? "recorded" : "missing", created_at: now(),
  };
}
async function reserveProviderCall(claimed, field) {
  if (!["provider_call_count", "model_call_count"].includes(field)) throw new Error("SPEAKING_AI_SCHEMA_INVALID");
  let callIndex = null;
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(JOBS).where({ job_id: claimed.job_id }).limit(1).get();
    const current = result.data && result.data[0];
    if (!current || current.status !== "processing" || !secretMatches(current.lease_token, claimed.lease_token)) throw new Error("SPEAKING_JOB_SUPERSEDED");
    callIndex = Math.max(0, Number(current[field] || 0)) + 1;
    await transaction.collection(JOBS).doc(current._id || current.job_id).update({ [field]: callIndex, updated_at: now() });
  });
  return callIndex;
}
async function saveProviderUsage(job, stage, callIndex, provider, metadata) {
  try {
    const row = providerUsageEvent(job, stage, callIndex, provider, metadata);
    const existing = await getOne(USAGE, { event_id: row.event_id });
    if (!existing) await db.collection(USAGE).doc(row.event_id).create(row);
    return true;
  } catch (error) {
    console.error("speakingLab usage ledger failed", job.job_id, stage, error && error.message);
    return false;
  }
}
function canonicalTranscript(output, participants) {
  const tracksWithEligibility = output.speaker_tracks.map((track) => ({
    ...track,
    candidate_eligible: track.candidate_eligible === false ? false : !(Number(track.speech_duration_ms || 0) < 4000 && Number(track.turn_count || 0) <= 1),
  }));
  const speakerInfo = lab.canonicalizeSpeakerTracks(tracksWithEligibility, output.segments);
  const segmentInfo = lab.canonicalizeSegments(output.segments, speakerInfo, output.duration_ms);
  if (!segmentInfo.segments.length) throw new Error("SPEAKING_AUDIO_NOT_RELIABLY_SCORABLE");
  const selection = lab.candidateSpeakerKeys(speakerInfo.tracks, participants);
  const candidateSet = new Set(selection.candidate_keys);
  const canonicalSegments = segmentInfo.segments.map((segment) => ({ ...segment, evaluation_role: candidateSet.has(segment.speaker_key) && !lab.isLikelyFacilitatorCue(segment) ? "candidate" : "non_candidate_context" }));
  return {
    language: output.language, duration_ms: output.duration_ms,
    speaker_tracks: speakerInfo.tracks.map((track) => ({ ...track, evaluation_role: candidateSet.has(track.speaker_key) ? "candidate" : "non_candidate_context", safe_reason_code: selection.reason_by_key[track.speaker_key] || null })),
    segments: canonicalSegments,
    rejected_segment_count: segmentInfo.rejected.length,
    external_cue_count: canonicalSegments.filter((segment) => lab.isLikelyFacilitatorCue(segment)).length,
    candidate_speaker_keys: selection.candidate_keys,
    non_candidate_speaker_keys: selection.non_candidate_keys,
  };
}
async function processQueuedJob(event) {
  const job = await getOne(JOBS, { job_id: lab.text(event.job_id, 120) });
  if (!job || !secretMatches(job.dispatch_token, event.dispatch_token)) throw new Error("SPEAKING_JOB_NOT_AVAILABLE");
  let claimed;
  try { claimed = await claimJob(job, event.dispatch_token); } catch (error) { return { success: true, status: "stale_or_already_claimed" }; }
  try {
    const rows = await discussionRows(claimed.discussion_id);
    const discussion = rows.discussion;
    if (discussion.deleted_at || String(discussion.active_analysis_job_id || "") !== String(claimed.job_id) || Number(discussion.discussion_revision || 1) !== Number(claimed.discussion_revision || 1)) throw new Error("SPEAKING_JOB_SUPERSEDED");
    const asset = await getOne(ASSETS, { asset_id: claimed.formal_audio_asset_id, discussion_id: claimed.discussion_id, asset_kind: "formal_discussion", status: "uploaded" });
    if (!asset) throw new Error("AUDIO_UPLOAD_INCOMPLETE");
    const speech = createSpeechProvider();
    if (claimed.stage === "audio_quality") {
      const quality = await speech.inspectAudio({ mime_type: asset.mime_type, size_bytes: asset.actual_size_bytes || asset.expected_size_bytes });
      await requeueClaimedJob(claimed, { stage: "transcription", audio_quality: quality, next_retry_at: now() });
      return { success: true, status: "queued", stage: "transcription", job_id: claimed.job_id };
    }
    if (claimed.stage === "transcription") {
      const transcriptionInput = claimed.provider_task_id ? { task_id: claimed.provider_task_id } : { audio_url: await temporaryAudioUrl(asset) };
      const callIndex = await reserveProviderCall(claimed, "provider_call_count");
      let transcription;
      try {
        transcription = await speech.transcribeAndDiarize(transcriptionInput);
      } catch (error) {
        await saveProviderUsage(claimed, "transcription", callIndex, speech.name, { outcome: "failed", safe_error_code: error && error.code, request_id: error && error.requestId, usage: {} });
        throw error;
      }
      await saveProviderUsage(claimed, "transcription", callIndex, speech.name, { request_id: transcription.request_id, usage: transcription.output && transcription.output.usage || {} });
      if (transcription.status === "pending") {
        await requeueClaimedJob(claimed, {
          stage: "transcription", provider_task_id: transcription.task_id,
          provider_submitted_at: claimed.provider_submitted_at || now(),
          provider_poll_count: Number(claimed.provider_poll_count || 0) + (claimed.provider_task_id ? 1 : 0),
          next_retry_at: new Date(Date.now() + 15000),
        });
        return { success: true, status: "pending", stage: "transcription", job_id: claimed.job_id };
      }
      const transcript = canonicalTranscript(transcription.output, rows.participants);
      const expectedCandidates = rows.participants.length;
      const quality = {
        status: transcript.candidate_speaker_keys.length >= 3 ? (transcript.candidate_speaker_keys.length === expectedCandidates && !transcript.rejected_segment_count ? "scorable" : "scorable_with_warning") : "not_reliably_scorable",
        warning_codes: [
          ...(transcript.candidate_speaker_keys.length !== expectedCandidates ? ["SPEAKER_COUNT_MISMATCH"] : []),
          ...(transcript.rejected_segment_count ? ["INVALID_SEGMENTS_REMOVED"] : []),
          ...(transcript.non_candidate_speaker_keys.length ? ["NON_CANDIDATE_CONTEXT_PRESENT"] : []),
          ...(transcript.external_cue_count ? ["FACILITATOR_CUE_EXCLUDED"] : []),
        ],
      };
      await upsertPipelineReport(claimed, { stage: "speaker_canonicalization", audio_quality: quality, transcript });
      if (quality.status === "not_reliably_scorable") throw new Error("SPEAKING_AUDIO_NOT_RELIABLY_SCORABLE");
      await requeueClaimedJob(claimed, { stage: "dse_analysis", provider_task_id: transcription.task_id, next_retry_at: now() });
      return { success: true, status: "queued", stage: "dse_analysis", job_id: claimed.job_id };
    }
    if (claimed.stage === "dse_analysis") {
      const identity = reportIdentity(claimed);
      const pipelineReport = await getOne(REPORTS, { report_id: identity.report_id, status: "processing" });
      const transcript = pipelineReport && reportTranscript(pipelineReport);
      if (!pipelineReport || !transcript || !Array.isArray(transcript.segments) || !transcript.segments.length) throw new Error("SPEAKING_AI_SCHEMA_INVALID");
      const candidateKeys = Array.isArray(transcript.candidate_speaker_keys) ? transcript.candidate_speaker_keys : [];
      const nonCandidateKeys = Array.isArray(transcript.non_candidate_speaker_keys) ? transcript.non_candidate_speaker_keys : [];
      const speakingTurns = lab.canonicalSpeakingTurns(transcript.segments, candidateKeys);
      const model = createModelProvider();
      const modelCallIndex = await reserveProviderCall(claimed, "model_call_count");
      let result;
      try {
        result = await model.callStructuredModel({
          system_prompt: dseAnalysisPrompt(),
          user_prompt: dseAnalysisUserPrompt({ taskText: discussion.prompt_text, candidateSpeakerKeys: candidateKeys, nonCandidateSpeakerKeys: nonCandidateKeys, segments: transcript.segments, speakingTurns, schemaVersion: SPEAKING_REPORT_SCHEMA_VERSION }),
        });
      } catch (error) {
        await saveProviderUsage(claimed, "dse_analysis", modelCallIndex, model.name, { model: model.model, protocol: model.protocol, outcome: "failed", safe_error_code: error && error.code, http_status: error && error.httpStatus, request_id: error && error.requestId, response_diagnostics: error && error.responseDiagnostics, usage: {} });
        throw error;
      }
      await saveProviderUsage(claimed, "dse_analysis", modelCallIndex, model.name, { model: model.model, protocol: model.protocol, request_id: result.request_id, usage: result.usage });
      const analysis = lab.canonicalizeReport(result.output, transcript.speaker_tracks.map((track) => track.speaker_key), transcript.segments, { reportVersion: identity.report_version, candidateSpeakerKeys: candidateKeys, nonCandidateKeys });
      const finishedAt = now();
      await db.runTransaction(async (transaction) => {
        const jobResult = await transaction.collection(JOBS).where({ job_id: claimed.job_id }).limit(1).get();
        const currentJob = jobResult.data && jobResult.data[0];
        const discussionResult = await transaction.collection(DISCUSSIONS).where({ discussion_id: claimed.discussion_id }).limit(1).get();
        const currentDiscussion = discussionResult.data && discussionResult.data[0];
        const reportResult = await transaction.collection(REPORTS).where({ report_id: identity.report_id }).limit(1).get();
        const currentReport = reportResult.data && reportResult.data[0];
        if (!currentJob || currentJob.status !== "processing" || !secretMatches(currentJob.lease_token, claimed.lease_token) || !currentDiscussion || String(currentDiscussion.active_analysis_job_id || "") !== String(claimed.job_id) || Number(currentDiscussion.discussion_revision || 1) !== Number(claimed.discussion_revision || 1) || !currentReport || currentReport.status !== "processing") throw new Error("SPEAKING_JOB_SUPERSEDED");
        await transaction.collection(REPORTS).doc(currentReport._id || currentReport.report_id).update({ status: "ready", stage: "published", ...replaceFields({ dse_analysis: analysis, model_metadata: { provider: model.name, model: model.model, protocol: model.protocol, hostname: model.hostname, prompt_version: PROMPT_VERSION, schema_version: SPEAKING_REPORT_SCHEMA_VERSION } }, ["dse_analysis", "model_metadata"]), finished_at: finishedAt, updated_at: finishedAt });
        await transaction.collection(JOBS).doc(currentJob._id || currentJob.job_id).update({ status: "succeeded", stage: "publishing", safe_error_code: null, lease_token: null, lease_until: null, next_retry_at: null, finished_at: finishedAt, updated_at: finishedAt });
        await transaction.collection(DISCUSSIONS).doc(currentDiscussion._id || currentDiscussion.discussion_id).update({ analysis_status: "ready", active_report_version: identity.report_version, updated_at: finishedAt });
      });
      return { success: true, status: "succeeded", stage: "publishing", job_id: claimed.job_id, report_version: identity.report_version };
    }
    throw new Error("SPEAKING_AI_SCHEMA_INVALID");
  } catch (error) {
    const code = error && error.code || error && error.message || "SPEAKING_PROVIDER_NOT_CONFIGURED";
    const failedAt = now();
    await db.runTransaction(async (transaction) => {
      const jobResult = await transaction.collection(JOBS).where({ job_id: claimed.job_id }).limit(1).get();
      const currentJob = jobResult.data && jobResult.data[0];
      if (!currentJob || currentJob.status !== "processing" || !secretMatches(currentJob.lease_token, claimed.lease_token)) return;
      await transaction.collection(JOBS).doc(currentJob._id || currentJob.job_id).update({ status: "failed", stage: currentJob.stage || "audio_quality", safe_error_code: code, lease_token: null, lease_until: null, finished_at: failedAt, updated_at: failedAt });
      const discussionResult = await transaction.collection(DISCUSSIONS).where({ discussion_id: currentJob.discussion_id, active_analysis_job_id: currentJob.job_id }).limit(1).get();
      const discussion = discussionResult.data && discussionResult.data[0];
      if (discussion) await transaction.collection(DISCUSSIONS).doc(discussion._id || discussion.discussion_id).update({ analysis_status: "failed", updated_at: failedAt });
    });
    return { success: false, code, job_id: job.job_id };
  }
}

async function confirmVoice(actor, event) {
  const rows = await authorizedDiscussion(actor, event.discussion_id);
  const participant = rows.participants.find((item) => String(item.participant_id) === String(event.participant_id));
  if (!participant || !lab.canConfirmVoice(actor, participant, rows.discussion)) throw new Error("VOICE_CONFIRMATION_DENIED");
  const accepted = event.confirmed === true;
  const status = accepted ? "student_confirmed" : "disputed";
  const eventId = id("identity_event");
  const expectedRevision = Number(event.mapping_revision);
  const expectedSpeakerKey = String(event.speaker_key || "");
  await db.runTransaction(async (transaction) => {
    const discussionResult = await transaction.collection(DISCUSSIONS).where({ discussion_id: rows.discussion.discussion_id }).limit(1).get();
    const currentDiscussion = discussionResult.data && discussionResult.data[0];
    const participantResult = await transaction.collection(PARTICIPANTS).where({ participant_id: participant.participant_id }).limit(1).get();
    const current = participantResult.data && participantResult.data[0];
    if (!currentDiscussion || !current || !lab.canConfirmVoice(actor, current, currentDiscussion)) throw new Error("VOICE_CONFIRMATION_DENIED");
    if (!current.matched_speaker_key) throw new Error("VOICE_MATCH_UNCERTAIN");
    if (current.identity_status === "disputed") throw new Error("VOICE_DISPUTE_LOCKED");
    if (!Number.isInteger(expectedRevision) || expectedRevision !== Number(current.mapping_revision || 0) || expectedSpeakerKey !== String(current.matched_speaker_key || "")) throw new Error("VOICE_MATCH_STALE");
    const changedAt = now();
    await transaction.collection(PARTICIPANTS).doc(current._id || current.participant_id).update({ identity_status: status, identity_confirmed_at: accepted ? changedAt : null, identity_confirmed_by_uid: accepted ? actor.auth_uid : null, identity_confirmation_source: accepted ? "student" : null, updated_at: changedAt });
    if (!accepted) await transaction.collection(DISCUSSIONS).doc(currentDiscussion._id || currentDiscussion.discussion_id).update({ report_projection_revision: Number(currentDiscussion.report_projection_revision || 0) + 1, updated_at: changedAt });
    await transaction.collection(EVENTS).doc(eventId).create({ event_id: eventId, discussion_id: rows.discussion.discussion_id, participant_id: current.participant_id, speaker_key: current.matched_speaker_key, event_type: accepted ? "student_confirmed" : "student_disputed", mapping_revision: current.mapping_revision, actor_uid: actor.auth_uid, created_at: changedAt });
  });
  if (!accepted) await invalidateShares(rows.discussion.discussion_id, { reason: "VOICE_IDENTITY_DISPUTED" });
  return { success: true, identity_status: status };
}
async function teacherUpdateVoiceMapping(actor, event) {
  if (!lab.isTeacher(actor)) throw new Error("TEACHER_REQUIRED");
  const rows = await authorizedDiscussion(actor, event.discussion_id, false);
  const report = await getOne(REPORTS, { discussion_id: rows.discussion.discussion_id, report_version: rows.discussion.active_report_version, status: "ready" });
  if (!report || !report.dse_analysis) throw new Error("VOICE_MAPPING_NOT_READY");
  // The browser submits only participant/Speaker pairs.  The allowed Speaker
  // set is derived from the immutable server report, never from browser arrays.
  const transcript = reportTranscript(report);
  const analysis = reportAnalysis(report);
  const serverSpeakerKeys = [...new Set((transcript.speaker_tracks || []).map((track) => track.speaker_key)
    .concat((transcript.segments || []).map((segment) => segment.speaker_key))
    .concat((analysis.candidates || []).map((candidate) => candidate.speaker_key)).filter(Boolean))];
  const candidateSpeakerKeys = [...new Set((analysis.candidates || []).map((candidate) => candidate.speaker_key).filter(Boolean))];
  const mapping = lab.canonicalizeMapping(event.mapping, serverSpeakerKeys, rows.participants, { requireAll: false, candidateSpeakerKeys });
  const revision = Number(event.mapping_revision);
  if (!Number.isInteger(revision) || revision !== Number(rows.discussion.mapping_revision || 0)) throw new Error("VOICE_MATCH_STALE");
  const nextRevision = revision + 1;
  const changedAt = now();
  const eventRows = rows.participants.map((participant) => ({ participant, event_id: id("identity_event") }));
  await db.runTransaction(async (transaction) => {
    const discussionResult = await transaction.collection(DISCUSSIONS).where({ discussion_id: rows.discussion.discussion_id }).limit(1).get();
    const currentDiscussion = discussionResult.data && discussionResult.data[0];
    if (!currentDiscussion || currentDiscussion.deleted_at || Number(currentDiscussion.mapping_revision || 0) !== revision || String(currentDiscussion.active_report_version || "") !== String(rows.discussion.active_report_version || "")) throw new Error("VOICE_MATCH_STALE");
    const participantResult = await transaction.collection(PARTICIPANTS).where({ discussion_id: rows.discussion.discussion_id }).limit(20).get();
    const currentParticipants = (participantResult.data || []).filter((participant) => !participant.removed_at);
    lab.canonicalizeMapping(mapping, serverSpeakerKeys, currentParticipants, { requireAll: false, candidateSpeakerKeys });
    for (const eventRow of eventRows) {
      const participant = currentParticipants.find((item) => String(item.participant_id) === String(eventRow.participant.participant_id));
      if (!participant) throw new Error("VOICE_MATCH_STALE");
      const pair = mapping.find((item) => item.participant_id === String(participant.participant_id));
      const update = { mapping_revision: nextRevision, updated_at: changedAt };
      if (pair) Object.assign(update, { matched_speaker_key: pair.speaker_key, identity_status: "teacher_confirmed", identity_confirmed_at: changedAt, identity_confirmed_by_uid: actor.auth_uid, identity_confirmation_source: "teacher", ...(participant.voice_reference_asset_id ? { voice_reference_status: "deletion_due" } : {}) });
      else Object.assign(update, { matched_speaker_key: null, identity_status: "unmatched", identity_confirmed_at: null, identity_confirmed_by_uid: null, identity_confirmation_source: null });
      await transaction.collection(PARTICIPANTS).doc(participant._id || participant.participant_id).update(update);
      if (pair && participant.voice_reference_asset_id) {
        const assetResult = await transaction.collection(ASSETS).where({ asset_id: participant.voice_reference_asset_id, discussion_id: rows.discussion.discussion_id, asset_kind: "voice_reference", status: "uploaded" }).limit(1).get();
        const referenceAsset = assetResult.data && assetResult.data[0];
        if (referenceAsset) await transaction.collection(ASSETS).doc(referenceAsset._id || referenceAsset.asset_id).update({ matched_at: changedAt, delete_after: new Date(changedAt.getTime() + 7 * 24 * 60 * 60 * 1000), updated_at: changedAt });
      }
      await transaction.collection(EVENTS).doc(eventRow.event_id).create({ event_id: eventRow.event_id, discussion_id: rows.discussion.discussion_id, participant_id: participant.participant_id, speaker_key: pair ? pair.speaker_key : null, event_type: pair ? "teacher_locked" : "teacher_unmatched", mapping_revision: nextRevision, actor_uid: actor.auth_uid, created_at: changedAt });
    }
    await transaction.collection(DISCUSSIONS).doc(currentDiscussion._id || currentDiscussion.discussion_id).update({ mapping_revision: nextRevision, report_projection_revision: Number(currentDiscussion.report_projection_revision || 0) + 1, updated_at: changedAt });
  });
  await invalidateShares(rows.discussion.discussion_id, { reason: "VOICE_MAPPING_CHANGED" });
  return { success: true, mapping, mapping_revision: nextRevision };
}

function publicVoiceprintTarget(subject, profile) {
  return {
    target_kind: subject.kind,
    student_id: subject.kind === "vip" ? subject.student_id || null : null,
    participant_id: subject.kind === "guest" ? subject.participant_id : null,
    discussion_id: subject.kind === "guest" ? subject.discussion_id : null,
    display_name: subject.display_name || (subject.kind === "guest" ? "Non-VIP participant" : "VIP student"),
    name_not_verified: subject.kind === "guest",
    voiceprint: voiceprintStatusView(profile),
    passage: VOICEPRINT_PASSAGE,
    passage_version: VOICEPRINT_PASSAGE_VERSION,
  };
}

function ownVoiceprintSubject(actor) {
  if (!lab.isActiveStudent(actor)) throw new Error("STUDENT_REQUIRED");
  return {
    kind: "vip",
    subject_key: `vip:${actor.auth_uid}`,
    student_uid: actor.auth_uid,
    student_id: lab.text(actor.student_id, 120),
    participant_id: null,
    discussion_id: null,
    display_name: lab.normalizeWhitespace(actor.english_name || actor.name || "", 160) || "My voiceprint",
  };
}

async function teacherVoiceprintSubject(actor, event) {
  if (!lab.isTeacher(actor)) throw new Error("TEACHER_REQUIRED");
  const studentId = lab.normalizeWhitespace(event.student_id, 120);
  if (studentId) {
    const profile = await getOne("students", { student_id: studentId, active: true });
    if (!profile || profile.role !== "student" || !profile.auth_uid) throw new Error("STUDENT_NOT_FOUND");
    return {
      kind: "vip",
      subject_key: `vip:${profile.auth_uid}`,
      student_uid: profile.auth_uid,
      student_id: profile.student_id,
      participant_id: null,
      discussion_id: null,
      display_name: lab.normalizeWhitespace(profile.english_name || profile.name || "", 160) || profile.student_id,
    };
  }
  const rows = await authorizedDiscussion(actor, event.discussion_id, false);
  const participant = rows.participants.find((item) => String(item.participant_id) === String(event.participant_id));
  if (!participant) throw new Error("PARTICIPANT_NOT_FOUND");
  if (lab.participantKind(participant) === "vip") {
    return {
      kind: "vip",
      subject_key: `vip:${participant.student_uid}`,
      student_uid: participant.student_uid,
      student_id: participant.student_id_snapshot || null,
      participant_id: null,
      discussion_id: null,
      display_name: lab.normalizeWhitespace(participant.display_name_snapshot || "", 160) || "VIP student",
    };
  }
  return {
    kind: "guest",
    subject_key: `guest:${participant.participant_id}`,
    student_uid: null,
    student_id: null,
    participant_id: participant.participant_id,
    discussion_id: rows.discussion.discussion_id,
    display_name: lab.displayGuestName(participant.guest_name || participant.display_name_snapshot) || "Non-VIP participant",
  };
}

async function getMyVoiceprint(actor) {
  const subject = ownVoiceprintSubject(actor);
  const profile = await voiceprintForSubject(subject.subject_key);
  return { success: true, target: publicVoiceprintTarget(subject, profile), provider_configured: voiceprintProvider.configured() };
}

async function teacherGetVoiceprintTarget(actor, event) {
  const subject = await teacherVoiceprintSubject(actor, event);
  const profile = await voiceprintForSubject(subject.subject_key);
  return { success: true, target: publicVoiceprintTarget(subject, profile), provider_configured: voiceprintProvider.configured() };
}

async function appendVoiceprintEvent(transaction, values) {
  const eventId = values.event_id || id("voiceprint_event");
  await transaction.collection(VOICEPRINT_EVENTS).doc(eventId).create({ event_id: eventId, ...values });
  return eventId;
}

async function saveVoiceprint(actor, event, teacherMode) {
  const subject = teacherMode ? await teacherVoiceprintSubject(actor, event) : ownVoiceprintSubject(actor);
  if (event.consent_confirmed !== true) throw new Error("VOICEPRINT_CONSENT_REQUIRED");
  const operationId = lab.stableOperationId(event.operation_id);
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  const priorEvent = await getOne(VOICEPRINT_EVENTS, { operation_id: operationId, subject_key: subject.subject_key });
  if (priorEvent) {
    const replayProfile = await voiceprintForSubject(subject.subject_key);
    if (replayProfile) return { success: true, idempotent_replay: true, target: publicVoiceprintTarget(subject, replayProfile) };
  }
  const audio = voiceprintProvider.validateWavBase64(event.audio_base64);
  const providerGroupId = voiceprintProvider.groupId();
  const existing = await getOne(VOICEPRINTS, { subject_key: subject.subject_key });
  const profileId = existing && existing.voiceprint_profile_id || stable("speaking_voiceprint", subject.subject_key);
  const updating = Boolean(existing && existing.status === "active" && existing.provider_voiceprint_id);
  let providerResult;
  try {
    providerResult = updating
      ? await voiceprintProvider.update({ audioBase64: audio.base64, voiceprintId: existing.provider_voiceprint_id, subjectKey: subject.subject_key })
      : await voiceprintProvider.enroll({ audioBase64: audio.base64, subjectKey: subject.subject_key, group: providerGroupId });
  } catch (error) {
    throw new Error(error && error.code || "VOICEPRINT_PROVIDER_FAILED");
  }
  const changedAt = now();
  const nextRevision = Number(existing && existing.enrollment_revision || 0) + 1;
  const row = {
    voiceprint_profile_id: profileId,
    subject_key: subject.subject_key,
    subject_kind: subject.kind,
    student_uid: subject.student_uid,
    participant_id: subject.participant_id,
    discussion_id: subject.discussion_id,
    provider: "tencent_asr",
    provider_voiceprint_id: providerResult.voiceprintId,
    provider_group_id: providerGroupId,
    status: "active",
    passage_version: VOICEPRINT_PASSAGE_VERSION,
    sample_duration_ms: audio.durationMs,
    enrollment_revision: nextRevision,
    consent_source: teacherMode ? "teacher_in_person_confirmation" : "student_self_confirmation",
    enrolled_by_uid: actor.auth_uid,
    enrolled_at: existing && existing.enrolled_at || changedAt,
    updated_at: changedAt,
    deleted_at: null,
    deleted_by_uid: null,
    last_provider_request_id: providerResult.requestId || null,
    last_operation_id: operationId,
  };
  try {
    await db.runTransaction(async (transaction) => {
      const currentResult = await transaction.collection(VOICEPRINTS).where({ subject_key: subject.subject_key }).limit(1).get();
      const current = currentResult.data && currentResult.data[0];
      if (updating && (!current || current.status !== "active" || String(current.provider_voiceprint_id || "") !== String(existing.provider_voiceprint_id || "") || Number(current.enrollment_revision || 0) !== Number(existing.enrollment_revision || 0))) throw new Error("VOICEPRINT_STALE");
      if (!updating && current && current.status === "active" && current.provider_voiceprint_id) throw new Error("VOICEPRINT_STALE");
      if (current) await transaction.collection(VOICEPRINTS).doc(current._id || current.voiceprint_profile_id).update(row);
      else await transaction.collection(VOICEPRINTS).doc(profileId).create({ ...row, created_at: changedAt });
      await appendVoiceprintEvent(transaction, {
        operation_id: operationId,
        voiceprint_profile_id: profileId,
        subject_key: subject.subject_key,
        subject_kind: subject.kind,
        participant_id: subject.participant_id,
        discussion_id: subject.discussion_id,
        event_type: updating ? "updated" : "enrolled",
        enrollment_revision: nextRevision,
        actor_uid: actor.auth_uid,
        actor_role: actor.role,
        provider: "tencent_asr",
        provider_request_id: providerResult.requestId || null,
        created_at: changedAt,
      });
    });
  } catch (error) {
    if (!updating) {
      try { await voiceprintProvider.remove({ voiceprintId: providerResult.voiceprintId }); } catch (_cleanupError) { /* provider orphan is owner-auditable through request id */ }
    }
    throw error;
  }
  return { success: true, target: publicVoiceprintTarget(subject, row) };
}

async function deleteVoiceprint(actor, event, teacherMode) {
  const subject = teacherMode ? await teacherVoiceprintSubject(actor, event) : ownVoiceprintSubject(actor);
  const profile = await voiceprintForSubject(subject.subject_key);
  if (!profile) return { success: true, idempotent_replay: true, target: publicVoiceprintTarget(subject, null) };
  const operationId = lab.stableOperationId(event.operation_id);
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  let providerRequestId = null;
  try {
    const removed = await voiceprintProvider.remove({ voiceprintId: profile.provider_voiceprint_id });
    providerRequestId = removed.requestId || null;
  } catch (error) {
    if (!error || error.code !== "VOICEPRINT_NOT_FOUND") throw new Error(error && error.code || "VOICEPRINT_PROVIDER_FAILED");
  }
  const changedAt = now();
  await db.runTransaction(async (transaction) => {
    const currentResult = await transaction.collection(VOICEPRINTS).where({ subject_key: subject.subject_key }).limit(1).get();
    const current = currentResult.data && currentResult.data[0];
    if (!current || current.status !== "active") return;
    if (String(current.provider_voiceprint_id || "") !== String(profile.provider_voiceprint_id || "")) throw new Error("VOICEPRINT_STALE");
    await transaction.collection(VOICEPRINTS).doc(current._id || current.voiceprint_profile_id).update({
      status: "deleted", provider_voiceprint_id: null, provider_group_id: null,
      deleted_at: changedAt, deleted_by_uid: actor.auth_uid, updated_at: changedAt,
      last_provider_request_id: providerRequestId, last_operation_id: operationId,
    });
    await appendVoiceprintEvent(transaction, {
      operation_id: operationId,
      voiceprint_profile_id: current.voiceprint_profile_id,
      subject_key: subject.subject_key,
      subject_kind: subject.kind,
      participant_id: subject.participant_id,
      discussion_id: subject.discussion_id,
      event_type: "deleted",
      enrollment_revision: Number(current.enrollment_revision || 0),
      actor_uid: actor.auth_uid,
      actor_role: actor.role,
      provider: "tencent_asr",
      provider_request_id: providerRequestId,
      created_at: changedAt,
    });
  });
  return { success: true, target: publicVoiceprintTarget(subject, null) };
}

async function invalidateShares(discussionId, options = {}) {
  const shares = await getMany(SHARES, { discussion_id: discussionId }, 200);
  const active = shares.filter((item) => item.status === "active" && (!options.predicate || options.predicate(item)));
  const revokedAt = now();
  for (const share of active) await db.collection(SHARES).doc(share._id || share.share_id).update({ status: "revoked", revoked_at: revokedAt, revoke_reason: options.reason || "PROJECTION_CHANGED", updated_at: revokedAt });
}
async function createShare(actor, event, kind) {
  const rows = await authorizedDiscussion(actor, event.discussion_id);
  const report = await getOne(REPORTS, { discussion_id: rows.discussion.discussion_id, report_version: rows.discussion.active_report_version, status: "ready" });
  if (!report) throw new Error("SHARE_NOT_AVAILABLE");
  const token = crypto.randomBytes(32).toString("base64url");
  const participant = rows.participants.find((item) => String(item.student_uid) === String(actor.auth_uid));
  if (kind === "student" && (!participant || !lab.canCreateStudentShare(actor, participant, rows.discussion))) throw new Error("VOICE_CONFIRMATION_REQUIRED_FOR_SHARE");
  if (kind === "teacher" && !lab.canCreateTeacherShare(actor, rows.discussion)) throw new Error("TEACHER_REQUIRED");
  const transcript = reportTranscript(report);
  const analysis = reportAnalysis(report);
  const reportSpeakerKeys = (transcript.speaker_tracks || []).map((track) => track.speaker_key).concat((transcript.segments || []).map((segment) => segment.speaker_key)).concat((analysis.candidates || []).map((candidate) => candidate.speaker_key));
  const aliases = lab.createAliasMap([...new Set(reportSpeakerKeys.filter(Boolean))], { seed: token });
  const payload = kind === "student"
    ? lab.projectStudentShare({ report: analysis, segments: transcript.segments, participants: rows.participants, sharerParticipant: participant, aliases, discussion: { share_title: rows.discussion.title, report_generated_at: report.created_at } })
    : lab.projectTeacherShare({ report: analysis, segments: transcript.segments, participants: rows.participants, discussion: { share_title: rows.discussion.title, report_generated_at: report.created_at }, selection: event.selection || {}, aliases, now: now() });
  const shareId = id("share");
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const createdAt = now();
  const selectedNameIds = kind === "teacher" && Array.isArray(event.selection && event.selection.visible_participant_ids)
    ? new Set(event.selection.visible_participant_ids.map(String))
    : new Set(rows.participants.map((row) => String(row.participant_id)));
  const nameVisibleParticipantIds = kind === "student" ? [participant.participant_id] : rows.participants.filter((row) => selectedNameIds.has(String(row.participant_id)) && lab.identityProjection(row, { fallbackLabel: "Speaker" }).named).map((row) => row.participant_id);
  const contentSelection = kind === "teacher" ? (payload.content || {}) : null;
  const shareRow = { share_id: shareId, token_hash: lab.shareTokenHash(token), discussion_id: rows.discussion.discussion_id, report_id: report.report_id, report_version: report.report_version, share_kind: kind, created_by_uid: actor.auth_uid, student_sharer_participant_id: kind === "student" ? participant.participant_id : null, content_selection: contentSelection, name_visible_participant_ids: nameVisibleParticipantIds, snapshot_payload: payload, status: "active", expires_at: expires, created_at: createdAt, updated_at: createdAt, revoked_at: null, revoked_by_uid: null, revoke_reason: null };
  await db.runTransaction(async (transaction) => {
    const discussionResult = await transaction.collection(DISCUSSIONS).where({ discussion_id: rows.discussion.discussion_id }).limit(1).get();
    const currentDiscussion = discussionResult.data && discussionResult.data[0];
    if (!currentDiscussion || currentDiscussion.deleted_at
      || String(currentDiscussion.active_report_version || "") !== String(rows.discussion.active_report_version || "")
      || Number(currentDiscussion.mapping_revision || 0) !== Number(rows.discussion.mapping_revision || 0)
      || Number(currentDiscussion.report_projection_revision || 0) !== Number(rows.discussion.report_projection_revision || 0)) throw new Error("SHARE_PROJECTION_STALE");
    if (kind === "student") {
      const participantResult = await transaction.collection(PARTICIPANTS).where({ participant_id: participant.participant_id }).limit(1).get();
      const currentParticipant = participantResult.data && participantResult.data[0];
      if (!currentParticipant || !lab.canCreateStudentShare(actor, currentParticipant, currentDiscussion)
        || Number(currentParticipant.mapping_revision || 0) !== Number(participant.mapping_revision || 0)
        || String(currentParticipant.matched_speaker_key || "") !== String(participant.matched_speaker_key || "")) throw new Error("VOICE_CONFIRMATION_REQUIRED_FOR_SHARE");
      const priorResult = await transaction.collection(SHARES).where({ discussion_id: rows.discussion.discussion_id, share_kind: "student", student_sharer_participant_id: participant.participant_id, status: "active" }).limit(20).get();
      for (const prior of priorResult.data || []) await transaction.collection(SHARES).doc(prior._id || prior.share_id).update({ status: "revoked", revoked_at: createdAt, revoke_reason: "STUDENT_SHARE_REPLACED", updated_at: createdAt });
    }
    await transaction.collection(SHARES).doc(shareId).create(shareRow);
  });
  return { success: true, share_id: shareId, token, expires_at: expires, share_url: `speaking-report.html#share=${encodeURIComponent(token)}` };
}
async function getSharedReport(event) {
  const token = String(event.share || event.token || "");
  if (!token || token.length > 300) throw new Error("SHARE_NOT_AVAILABLE");
  const share = await getOne(SHARES, { token_hash: lab.shareTokenHash(token) });
  if (!share || share.status !== "active" || !share.expires_at || new Date(share.expires_at).getTime() <= Date.now()) throw new Error("SHARE_NOT_AVAILABLE");
  return { success: true, share_kind: share.share_kind, expires_at: share.expires_at, created_at: share.created_at, snapshot: share.snapshot_payload };
}
async function revokeShare(actor, event) {
  const share = await getOne(SHARES, { share_id: lab.text(event.share_id, 120) });
  if (!share || (String(share.created_by_uid) !== String(actor.auth_uid) && !lab.isTeacher(actor))) throw new Error("SHARE_NOT_AVAILABLE");
  const revokedAt = now();
  await db.collection(SHARES).doc(share._id || share.share_id).update({ status: "revoked", revoked_at: revokedAt, revoked_by_uid: actor.auth_uid, revoke_reason: "USER_REVOKED", updated_at: revokedAt });
  return { success: true, status: "revoked" };
}
async function deleteDiscussion(actor, event) {
  if (!lab.isTeacher(actor)) throw new Error("TEACHER_REQUIRED");
  const rows = await authorizedDiscussion(actor, event.discussion_id);
  const deletedAt = now();
  await db.collection(DISCUSSIONS).doc(rows.discussion._id || rows.discussion.discussion_id).update({ deleted_at: deletedAt, deleted_by_teacher_uid: actor.auth_uid, analysis_status: "not_ready", updated_at: deletedAt });
  const assets = await getMany(ASSETS, { discussion_id: rows.discussion.discussion_id }, 200);
  for (const asset of assets.filter((item) => !item.deleted_at)) await db.collection(ASSETS).doc(asset._id || asset.asset_id).update({ delete_after: deletedAt, updated_at: deletedAt });
  const guestVoiceprints = await getMany(VOICEPRINTS, { discussion_id: rows.discussion.discussion_id, subject_kind: "guest", status: "active" }, 20);
  for (const profile of guestVoiceprints) await db.collection(VOICEPRINTS).doc(profile._id || profile.voiceprint_profile_id).update({ status: "delete_pending", delete_reason: "DISCUSSION_DELETED", delete_requested_at: deletedAt, delete_requested_by_uid: actor.auth_uid, updated_at: deletedAt });
  await invalidateShares(rows.discussion.discussion_id, { reason: "DISCUSSION_DELETED" });
  return { success: true, deleted: true };
}
function friendlyMessage(code) {
  const messages = {
    AUTH_REQUIRED: "Please sign in first.", STUDENT_REQUIRED: "This action is for students.", TEACHER_REQUIRED: "Teacher access is required.",
    DISCUSSION_NOT_FOUND: "This Discussion is no longer available.", DISCUSSION_ACCESS_DENIED: "You do not have access to this Discussion.",
    ROSTER_FROZEN: "The participant list is already frozen.", PARTICIPANT_LIMIT_REACHED: "A Discussion can have up to six participants.", DSE_REQUIRES_THREE_TO_SIX: "A DSE report requires three to six listed participants. Two participants do not generate a report.",
    GUEST_NAME_DUPLICATE: "That participant name is already in this Discussion. Add a suffix such as 1 or 2.",
    DURATION_INVALID: "Choose a recording time from 180 to 1800 seconds.", RECORDING_SETUP_LOCKED: "Recording setup is locked after the formal audio is uploaded.",
    AUDIO_REQUIRED: "Upload the formal Discussion recording first.", AUDIO_FILE_INVALID: "Choose a supported audio file.", AUDIO_UPLOAD_INCOMPLETE: "The audio upload is incomplete. Retry the same upload.",
    IDEMPOTENCY_KEY_REUSED: "That upload request was already used for a different file. Start a new upload.", VOICE_REFERENCE_LOCKED: "This Voice Reference is locked. Ask a teacher to reopen it.",
    SPEAKING_VOICEPRINT_NOT_CONFIGURED: "Tencent voiceprint registration is not configured yet.", VOICEPRINT_CONSENT_REQUIRED: "Confirm consent before registering this reusable voiceprint.",
    VOICEPRINT_AUDIO_INVALID: "Record the voiceprint with this page for a clear 16 kHz mono WAV sample.", VOICEPRINT_AUDIO_DURATION_INVALID: "The voiceprint sample must be between 8 and 30 seconds.", VOICEPRINT_NO_HUMAN_VOICE: "Tencent could not find enough clear speech. Move closer and record again.",
    VOICEPRINT_CAPACITY_REACHED: "The Tencent voiceprint library has reached its current capacity.", VOICEPRINT_PROVIDER_UNAVAILABLE: "Tencent voiceprint service is temporarily unavailable. Please try again.", VOICEPRINT_PROVIDER_INVALID_RESPONSE: "Tencent returned an invalid voiceprint response. Please try again.", VOICEPRINT_PROVIDER_FAILED: "Tencent could not save this voiceprint. Please record again.", VOICEPRINT_NOT_FOUND: "This voiceprint no longer exists at Tencent. Record it again.", VOICEPRINT_STALE: "This voiceprint changed in another session. Refresh before trying again.",
    SPEAKING_PROVIDER_NOT_CONFIGURED: "Speaking analysis is not enabled yet; no report was generated.", SPEAKING_ASR_UNAVAILABLE: "Speech transcription is temporarily unavailable. Please retry.", SPEAKING_ASR_FAILED: "Tencent could not transcribe this recording. Please check the audio and retry.",
    SPEAKING_ASR_INVALID_RESPONSE: "Tencent returned an incomplete transcript. Please retry.", SPEAKING_AUDIO_NOT_RELIABLY_SCORABLE: "The recording could not be scored reliably. Its available transcript was preserved.", SPEAKING_AI_TIMEOUT: "Speaking analysis was interrupted. Please retry.",
    SPEAKING_AI_SCHEMA_INVALID: "Speaking analysis returned an invalid report. Please retry.", SPEAKING_AI_INPUT_TOO_LARGE: "This transcript is too large for one reliable report. Shorten the recording and retry.", SPEAKING_AI_INVALID_RESPONSE: "Speaking analysis returned an invalid response. Please retry.", SPEAKING_AI_FAILED: "Speaking analysis is temporarily unavailable. Please retry.", VOICE_MATCH_STALE: "The voice mapping changed. Refresh before confirming.", VOICE_MAPPING_NOT_READY: "Generate a report before editing Voice Matches.",
    VOICE_DISPUTE_LOCKED: "Your voice concern is waiting for a teacher. Only a teacher can change the mapping now.",
    VOICE_CONFIRMATION_REQUIRED_FOR_SHARE: "Confirm your voice before creating a student share.", SHARE_PROJECTION_STALE: "The report or identity labels changed. Refresh before sharing.", SHARE_NOT_AVAILABLE: "This share link is no longer available.",
  };
  return messages[code] || "The Speaking Lab request could not be completed. Please try again.";
}

exports.main = async (event = {}) => {
  try {
    const action = lab.text(event.action, 80);
    if (action === "getSharedReport") return await getSharedReport(event);
    if (action === "processQueuedJob") return await processQueuedJob(event);
    const actor = await profileForAuth();
    if (action === "listDiscussions") return await listDiscussions(actor, event);
    if (action === "getDiscussion") return await getDiscussion(actor, event);
    if (action === "getMyVoiceprint") return await getMyVoiceprint(actor);
    if (action === "saveMyVoiceprint") return await saveVoiceprint(actor, event, false);
    if (action === "deleteMyVoiceprint") return await deleteVoiceprint(actor, event, false);
    if (action === "teacherGetVoiceprintTarget") return await teacherGetVoiceprintTarget(actor, event);
    if (action === "teacherSaveVoiceprint") return await saveVoiceprint(actor, event, true);
    if (action === "teacherDeleteVoiceprint") return await deleteVoiceprint(actor, event, true);
    if (action === "createDiscussion") return await createDiscussion(actor, event);
    if (action === "addVipParticipant") return await addParticipant(actor, event, "vip");
    if (action === "addGuestParticipant") return await addParticipant(actor, event, "guest");
    if (action === "renameGuest") return await renameGuest(actor, event);
    if (action === "updateDiscussionDuration") return await updateDiscussionDuration(actor, event);
    if (action === "respondInvitation") return await respondInvitation(actor, event);
    if (action === "startAudioUpload") return await startAudioUpload(actor, event);
    if (action === "finishAudioUpload") return await finishAudioUpload(actor, event);
    if (action === "startVoiceReferenceUpload") return await startVoiceReferenceUpload(actor, event);
    if (action === "finishVoiceReferenceUpload") return await finishVoiceReferenceUpload(actor, event);
    if (action === "getVoiceConfirmationPlayback") return await getVoiceConfirmationPlayback(actor, event);
    if (action === "startAnalysis") return await startAnalysis(actor, event);
    if (action === "confirmVoice") return await confirmVoice(actor, event);
    if (action === "teacherReopenVoiceReference") return await teacherReopenVoiceReference(actor, event);
    if (action === "teacherUpdateVoiceMapping") return await teacherUpdateVoiceMapping(actor, event);
    if (action === "removeParticipant") return await removeParticipant(actor, event);
    if (action === "createStudentShare") return await createShare(actor, event, "student");
    if (action === "createTeacherShare") return await createShare(actor, event, "teacher");
    if (action === "revokeShare") return await revokeShare(actor, event);
    if (action === "deleteDiscussion") return await deleteDiscussion(actor, event);
    throw new Error("UNKNOWN_ACTION");
  } catch (error) {
    const code = error && (error.code || error.message) || "SPEAKING_LAB_ERROR";
    console.error("speakingLab failed", code);
    return { success: false, code, message: friendlyMessage(code) };
  }
};

exports._test = {
  friendlyMessage, publicJob, participantView, discussionView, replaceFields, uploadMetadataView, voiceprintSubjectKey, voiceprintStatusView, publicVoiceprintTarget, reportIdentity, providerUsageEvent, canonicalTranscript,
  constants: { DISCUSSIONS, PARTICIPANTS, ASSETS, JOBS, REPORTS, EVENTS, SHARES, USAGE, VOICEPRINTS, VOICEPRINT_EVENTS, VOICE_PASSAGE_VERSION, VOICEPRINT_PASSAGE_VERSION },
};
