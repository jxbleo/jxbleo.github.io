"use strict";

const crypto = require("crypto");
const text = value => String(value == null ? "" : value).trim();
const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
async function one(db, name, query) {
  const result = await db.collection(name).where(query).limit(1).get();
  return result.data && result.data[0];
}
function isBbc(set) {
  return set && /^BBC-/.test(set.set_id) && (set.type === "bbc-six-minute-english" || set.section_id === "bbc-six-minute-english");
}
function publicOverrides(set) {
  const output = {};
  for (const [id, item] of Object.entries(set.bbc_question_overrides || {})) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) continue;
    const safe = {};
    for (const field of ["sentence", "question", "left"]) {
      if (typeof item[field] === "string") safe[field] = item[field];
    }
    if (Array.isArray(item.options)) safe.options = item.options.map(String);
    output[id] = safe;
  }
  return output;
}
async function readPublic(db, setId) {
  const set = await one(db, "sets", { set_id: text(setId), visible: true });
  if (!isBbc(set)) throw new Error("BBC_SET_NOT_FOUND");
  return { success: true, overrides: publicOverrides(set) };
}
async function read(db, setId) {
  const set = await one(db, "sets", { set_id: text(setId) });
  if (!isBbc(set)) throw new Error("BBC_SET_NOT_FOUND");
  const key = await one(db, "grading_keys", { set_id: set.set_id });
  if (!key) throw new Error("GRADING_KEY_NOT_FOUND");
  return { success: true, overrides: publicOverrides(set), answers: key.answers || {},
    explanations: key.explanations || {}, grading_version: String(key.grading_version || "1") };
}
function requestId(event, teacher, operation) {
  if (!/^[\w-]{16,100}$/.test(text(event.request_id))) throw new Error("BBC_REQUEST_ID_REQUIRED");
  return "bbc-" + crypto.createHash("sha256").update([operation, teacher.auth_uid, event.set_id, event.request_id].join("::")).digest("hex").slice(0, 40);
}
function cleanChange(change, key) {
  if (!change || !own(key.answers, change.question_id)) throw new Error("BBC_QUESTION_NOT_FOUND");
  const allowed = ["question_id", "sentence", "question", "left", "options", "explanation"];
  if (Object.keys(change).some(field => !allowed.includes(field))) throw new Error("BBC_FIELD_NOT_EDITABLE");
  const fields = ["sentence", "question", "left"].filter(field => own(change, field));
  if (fields.length !== 1) throw new Error("BBC_QUESTION_REQUIRED");
  const field = fields[0];
  if (typeof change[field] !== "string" || !text(change[field]) || change[field].length > 6000) throw new Error("BBC_QUESTION_REQUIRED");
  const blanks = change[field].match(/_{5,}/g) || [];
  if (field === "sentence" && (blanks.length !== 1 || blanks[0] !== "_____")) throw new Error("BBC_BLANK_REQUIRED");
  const question = { [field]: text(change[field]) };
  if (own(change, "options")) {
    if (field !== "question" || !Array.isArray(change.options) || change.options.length < 2 || change.options.length > 4 ||
      change.options.some(option => typeof option !== "string" || !text(option) || option.length > 2000)) throw new Error("BBC_OPTIONS_INVALID");
    question.options = change.options.map(text);
  }
  if (typeof change.explanation !== "string" || change.explanation.length > 12000) throw new Error("BBC_EXPLANATION_INVALID");
  return { id: change.question_id, question, explanation: change.explanation.trim() };
}
async function save(db, event, teacher, nextVersion) {
  const historyId = requestId(event, teacher, "edit");
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify(event.changes)).digest("hex");
  return db.runTransaction(async tx => {
    const previous = await one(tx, "grading_key_history", { history_id: historyId });
    if (previous) {
      if (previous.request_fingerprint !== fingerprint) throw new Error("BBC_REQUEST_CHANGED");
      return { success: true, grading_version: previous.grading_version_after };
    }
    const set = await one(tx, "sets", { set_id: text(event.set_id) });
    if (!isBbc(set)) throw new Error("BBC_SET_NOT_FOUND");
    const key = await one(tx, "grading_keys", { set_id: set.set_id });
    if (!key) throw new Error("GRADING_KEY_NOT_FOUND");
    if (text(event.expected_revision) !== String(key.grading_version || "1")) throw new Error("BBC_EDIT_CONFLICT");
    if (!Array.isArray(event.changes) || !event.changes.length || event.changes.length > 100) throw new Error("BBC_CHANGES_REQUIRED");
    const changes = event.changes.map(change => cleanChange(change, key));
    if (new Set(changes.map(change => change.id)).size !== changes.length) throw new Error("BBC_DUPLICATE_QUESTION");
    const overrides = publicOverrides(set);
    const explanations = { ...(key.explanations || {}) };
    const before = changes.map(change => ({ question_id: change.id, question: overrides[change.id] || null, explanation: explanations[change.id] || "" }));
    for (const change of changes) {
      overrides[change.id] = change.question;
      explanations[change.id] = change.explanation;
    }
    const version = nextVersion(key.grading_version);
    const now = new Date();
    await tx.collection("grading_key_history").doc(historyId).create({
      history_id: historyId, set_id: set.set_id, decision: "edit_bbc_content", request_fingerprint: fingerprint,
      content_before: before, content_after: changes, grading_version_before: String(key.grading_version || "1"),
      grading_version_after: version, changed_by_teacher_uid: teacher.auth_uid, changed_at: now,
    });
    await tx.collection("sets").doc(set._id).update({ bbc_question_overrides: overrides, updated_at: now });
    await tx.collection("grading_keys").doc(key._id).update({ explanations, grading_version: version, updated_at: now });
    return { success: true, grading_version: version };
  });
}
async function accept(db, event, teacher, resolve) {
  const id = requestId(event, teacher, "accept");
  const answer = text(event.submitted_answer);
  if (!answer || answer.length > 1000) throw new Error("EMPTY_ANSWER_NOT_ACCEPTABLE");
  await db.runTransaction(async tx => {
    const previous = await one(tx, "answer_disputes", { dispute_id: id });
    if (previous) {
      if (previous.question_id !== event.question_id || previous.submitted_answer !== answer) throw new Error("BBC_REQUEST_CHANGED");
      return;
    }
    const set = await one(tx, "sets", { set_id: text(event.set_id) });
    if (!isBbc(set)) throw new Error("BBC_SET_NOT_FOUND");
    const key = await one(tx, "grading_keys", { set_id: set.set_id });
    if (!key || !own(key.answers, event.question_id)) throw new Error("BBC_QUESTION_NOT_FOUND");
    if (text(event.expected_revision) !== String(key.grading_version || "1")) throw new Error("BBC_EDIT_CONFLICT");
    await tx.collection("answer_disputes").doc(id).create({
      dispute_id: id, requester_role: "teacher", student_uid: teacher.auth_uid,
      student_id_snapshot: teacher.student_id || "", student_name_snapshot: teacher.name || "",
      set_id: set.set_id, attempt_id: null, assignment_id: null, question_id: event.question_id,
      submitted_answer: answer, question_text_snapshot: text(event.question_text).slice(0, 2000),
      answer_snapshot: key.answers[event.question_id], explanation_snapshot: (key.explanations || {})[event.question_id] || "",
      source: "bbc_teacher_preview_accept", status: "pending", created_at: new Date(), updated_at: new Date(),
    });
  });
  const dispute = await one(db, "answer_disputes", { dispute_id: id });
  if (dispute.status !== "approved") await resolve({ dispute_id: id, decision: "add",
    expected_revision: event.expected_revision, teacher_note: "Accepted from BBC teacher preview." }, teacher);
  const resolved = await one(db, "answer_disputes", { dispute_id: id });
  return { success: true, grading_version: resolved.grading_version_after };
}
module.exports = { read, readPublic, publicOverrides, save, accept };
