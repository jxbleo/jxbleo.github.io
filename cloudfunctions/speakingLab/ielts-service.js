"use strict";
const rules = require("../_shared/ielts-speaking");
const lab = require("../_shared/speaking-lab");
const SETS = "ielts_speaking_sets";
const RESPONSES = "speaking_individual_responses";
function createService({ db, getOne, stable, now, shanghaiDate, responseView, temporaryAudioUrl }) {
  function authorize(actor) {
    if (!lab.isActiveStudent(actor) && !lab.isTeacher(actor)) throw new Error("AUTH_REQUIRED");
  }
  async function ownResponse(actor, event) {
    authorize(actor);
    const row = await getOne(RESPONSES, { response_session_id: lab.text(event.response_session_id, 140), exam_family: rules.FAMILY, deleted_at: null });
    if (!row) throw new Error("INDIVIDUAL_RESPONSE_NOT_FOUND");
    if (!lab.isTeacher(actor) && row.student_uid !== actor.auth_uid) throw new Error("INDIVIDUAL_RESPONSE_ACCESS_DENIED");
    return row;
  }
  function paging(event) {
    return { offset: Math.min(100000, Math.max(0, Math.floor(Number(event.offset) || 0))), limit: Math.min(50, Math.max(1, Math.floor(Number(event.page_size) || 20))) };
  }
  async function listSets(actor, event) {
    authorize(actor);
    const { offset, limit } = paging(event);
    const where = { visible_to_students: true, source_verified: true };
    if (event.source_kind) {
      if (!["cambridge", "seasonal"].includes(event.source_kind)) throw new Error("IELTS_CONTENT_INVALID");
      where.source_kind = event.source_kind;
    }
    const result = await db.collection(SETS).where(where).orderBy("set_id", "asc").skip(offset).limit(limit + 1).get();
    return { success: true, sets: (result.data || []).slice(0, limit).map(rules.summary), next_offset: result.data.length > limit ? offset + limit : null };
  }
  async function getSet(actor, event) {
    authorize(actor);
    const set = await getOne(SETS, { set_id: lab.text(event.set_id, 140), visible_to_students: true, source_verified: true });
    if (!set) throw new Error("SPEAKING_SET_NOT_FOUND");
    const normalized = rules.normalizeSet(set);
    // Source provenance may contain an owner's local source filename/path.
    if (!lab.isTeacher(actor)) delete normalized.source_reference;
    return { success: true, set: normalized };
  }
  async function createResponse(actor, event) {
    if (!lab.isActiveStudent(actor)) throw new Error("STUDENT_REQUIRED");
    const operation = lab.stableOperationId(event.operation_id || "");
    if (!operation) throw new Error("OPERATION_ID_REQUIRED");
    const responseId = stable("ielts_response", actor.auth_uid, lab.text(event.set_id, 140), lab.text(event.question_id, 100), operation);
    const replay = await getOne(RESPONSES, { response_session_id: responseId, student_uid: actor.auth_uid });
    if (replay) return { success: true, idempotent_replay: true, response: responseView(actor, replay) };
    const { set } = await getSet(actor, event);
    const question = rules.questionFor(set, event.question_id);
    const created = now();
    const row = {
      response_session_id: responseId, session_type: "individual_response", exam_family: rules.FAMILY,
      student_uid: actor.auth_uid, student_id_snapshot: lab.text(actor.student_id, 120),
      student_name_snapshot: lab.text(actor.name || actor.english_name, 160),
      set_id: set.set_id, set_content_revision: set.content_revision,
      set_snapshot: { ...rules.summary(set), part_2: set.part_2 }, question_snapshot: question,
      title: `${set.title} · Part ${question.part}${question.part === 3 ? ` Q${question.order}` : ""}`,
      response_date: shanghaiDate(created), duration_limit_seconds: question.part === 2 ? 120 : 90,
      recording_status: "not_uploaded", formal_audio_asset_id: null, analysis_status: "not_ready",
      active_analysis_job_id: null, active_report_version: null, active_audio_revision: 0,
      operation_id: operation, created_at: created, updated_at: created, deleted_at: null,
    };
    await db.runTransaction(async transaction => {
      const result = await transaction.collection(RESPONSES).where({ response_session_id: responseId }).limit(1).get();
      if (!result.data.length) await transaction.collection(RESPONSES).doc(responseId).create(row);
    });
    return { success: true, response: responseView(actor, row) };
  }
  async function listResponses(actor, event) {
    authorize(actor);
    const { offset, limit } = paging(event);
    const where = { exam_family: rules.FAMILY, deleted_at: null, recording_status: "uploaded" };
    if (!lab.isTeacher(actor)) where.student_uid = actor.auth_uid;
    else if (event.student_id) where.student_id_snapshot = lab.text(event.student_id, 120);
    if (event.set_id) where.set_id = lab.text(event.set_id, 140);
    const result = await db.collection(RESPONSES).where(where).orderBy("created_at", "desc").orderBy("response_session_id", "desc").skip(offset).limit(limit + 1).get();
    const responses = (result.data || []).slice(0, limit).map(row => {
      const view = responseView(actor, row);
      delete view.set_snapshot; delete view.question_snapshot;
      view.part = row.question_snapshot.part;
      return view;
    });
    return { success: true, responses, next_offset: result.data.length > limit ? offset + limit : null };
  }
  async function getResponse(actor, event) {
    return { success: true, response: responseView(actor, await ownResponse(actor, event), { includeReport: true }) };
  }
  async function getAudio(actor, event) {
    const row = await ownResponse(actor, event);
    const asset = await getOne("speaking_audio_assets", { response_session_id: row.response_session_id, asset_id: row.formal_audio_asset_id, status: "uploaded" });
    if (!asset || !asset.file_id) throw new Error("INDIVIDUAL_RESPONSE_UPLOAD_INCOMPLETE");
    return { success: true, audio_url: await temporaryAudioUrl(asset) };
  }
  return { listIeltsSpeakingSets: listSets, getIeltsSpeakingSet: getSet, createIeltsResponse: createResponse, listIeltsResponses: listResponses, getIeltsResponse: getResponse, getIeltsResponseAudio: getAudio };
}
module.exports = { createService };
