"use strict";

const crypto = require("crypto");
const notifications = require("./argue-notifications");
const TYPE = "writing_sentence";
const text = (v) => String(v == null ? "" : v).trim();
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
const scope = (c) => hash(JSON.stringify([Number(c.revision || 1), c.language_review]));
const sentences = (c) => c.language_review && c.language_review.sentences || [];
async function one(db, collection, query) {
  const result = await db.collection(collection).where(query).limit(1).get();
  return result.data && result.data[0] || null;
}
function replace(db, value) { return db.command && db.command.set ? db.command.set(value) : value; }

// Apply inside the same transaction that publishes an AI result. A stale worker
// must never overwrite a teacher approval committed while the model was running.
function applyApprovals(composition, record = {}) {
  const results = new Map((record.results || []).map((item) => [item.sentence_id, item]));
  const approvals = composition.writing_sentence_approvals || {};
  for (const sentence of sentences(composition)) {
    const approval = approvals[sentence.sentence_id];
    if (!approval || approval.composition_revision !== Number(composition.revision || 1)
        || approval.original !== sentence.original) continue;
    results.set(sentence.sentence_id, {
      ...(results.get(sentence.sentence_id) || {}), sentence_id: sentence.sentence_id,
      student_rewrite: approval.student_rewrite, accepted: true,
      teacher_approved: true, dispute_id: approval.dispute_id,
    });
  }
  return { ...record, results: [...results.values()], passed: sentences(composition)
    .filter((s) => s.rewrite_required).every((s) => results.get(s.sentence_id)?.accepted === true) };
}

async function submit({ db, student, event, now = new Date() }) {
  const compositionId = text(event.composition_id);
  const sentenceId = text(event.sentence_id);
  const operation = text(event.operation_id).slice(0, 160);
  if (!operation) throw new Error("OPERATION_ID_REQUIRED");
  const disputeId = `writing-${hash(JSON.stringify([student.auth_uid, compositionId, sentenceId, operation])).slice(0, 40)}`;
  let saved;
  await db.runTransaction(async (tx) => {
    const c = await one(tx, "writing_compositions", { composition_id: compositionId, student_uid: student.auth_uid });
    if (!c) throw new Error("COMPOSITION_NOT_FOUND");
    const prior = await one(tx, "answer_disputes", { dispute_id: disputeId });
    if (prior) { saved = prior; return; }
    const sentence = sentences(c).find((s) => s.sentence_id === sentenceId);
    const result = (applyApprovals(c, c.rewrite_results || {}).results || []).find((r) => r.sentence_id === sentenceId);
    if (c.status === "completed" || !sentence || !sentence.rewrite_required || result?.accepted) {
      throw new Error("WRITING_SENTENCE_NOT_INCORRECT");
    }
    if (c.pending_replacement || event.review_scope !== scope(c)
        || text(event.submitted_answer) !== text(result?.student_rewrite || sentence.original)) throw new Error("DISPUTE_REVIEW_CHANGED");
    const summaries = { ...(c.writing_sentence_disputes || {}) };
    const pending = summaries[sentenceId];
    if (pending && pending.status === "pending" && pending.review_scope === scope(c)) {
      saved = await one(tx, "answer_disputes", { dispute_id: pending.dispute_id });
      if (saved) return;
    }
    saved = {
      _id: disputeId, dispute_id: disputeId, dispute_type: TYPE, requester_role: "student",
      student_uid: student.auth_uid, composition_id: compositionId,
      composition_revision: Number(c.revision || 1), review_scope: scope(c),
      set_id: compositionId, set_title_snapshot: c.title || "Writing", assignment_id: null, attempt_id: null,
      question_id: sentenceId, question_text_snapshot: sentence.original,
      submitted_answer: result?.student_rewrite || sentence.original,
      answer_snapshot: sentence.reference_revision || "",
      explanation_snapshot: [sentence.coaching_summary, result?.feedback].filter(Boolean).join("\n"),
      student_reason: text(event.student_reason).slice(0, 1000), status: "pending",
      created_at: now, updated_at: now, email_notification_status: "pending",
    };
    const { _id, ...document } = saved;
    await tx.collection("answer_disputes").doc(_id).create(document);
    summaries[sentenceId] = { dispute_id: disputeId, review_scope: scope(c), status: "pending", created_at: now, teacher_note: "" };
    await tx.collection("writing_compositions").doc(c._id).update({ writing_sentence_disputes: replace(db, summaries) });
  });
  // A durable email intent is already committed. SMTP/outbox failure cannot undo it.
  try { await notifications.enqueue(db, saved); } catch (_) { console.error("Writing Argue email enqueue deferred", saved.dispute_id); }
  return { success: true, dispute_id: saved.dispute_id };
}

async function resolve({ db, event, teacher, now = new Date() }) {
  const decision = text(event.decision);
  if (!["approve", "reject"].includes(decision)) throw new Error("DISPUTE_DECISION_REQUIRED");
  await db.runTransaction(async (tx) => {
    const d = await one(tx, "answer_disputes", { dispute_id: text(event.dispute_id) });
    if (!d || d.dispute_type !== TYPE) throw new Error("DISPUTE_NOT_AVAILABLE");
    if (d.status !== "pending") throw new Error("DISPUTE_ALREADY_RESOLVED");
    const student = await one(tx, "students", { auth_uid: d.student_uid });
    const c = await one(tx, "writing_compositions", { composition_id: d.composition_id, student_uid: d.student_uid });
    if (!student || student.deleted || student.deleted_at || student.delete_pending || !c) throw new Error("DISPUTE_NOT_AVAILABLE");
    // Old requests remain rejectable, but cannot approve a replaced manuscript/review.
    if (decision === "approve" && (scope(c) !== d.review_scope || c.pending_replacement)) throw new Error("DISPUTE_REVIEW_CHANGED");
    const teacherNote = text(event.teacher_note).slice(0, 1000);
    const status = decision === "approve" ? "approved" : "rejected";
    const summaries = { ...(c.writing_sentence_disputes || {}) };
    if (summaries[d.question_id]?.dispute_id === d.dispute_id) {
      summaries[d.question_id] = { ...summaries[d.question_id], status, teacher_note: teacherNote, resolved_at: now };
    }
    const patch = { writing_sentence_disputes: replace(db, summaries) };
    if (decision === "approve") {
      const approvals = { ...(c.writing_sentence_approvals || {}) };
      // Preserve the first approved sentence if another old request is processed later.
      if (!approvals[d.question_id] || approvals[d.question_id].composition_revision !== d.composition_revision
          || approvals[d.question_id].original !== d.question_text_snapshot) {
        approvals[d.question_id] = { dispute_id: d.dispute_id, composition_revision: d.composition_revision,
          original: d.question_text_snapshot, student_rewrite: d.submitted_answer, teacher_uid: teacher.auth_uid, approved_at: now };
      }
      const record = applyApprovals({ ...c, writing_sentence_approvals: approvals }, c.rewrite_results || {});
      patch.writing_sentence_approvals = replace(db, approvals);
      patch.rewrite_results = replace(db, record);
      patch.updated_at = now;
      if (record.passed) {
        patch.status = "completed";
        patch.completed_at = c.completed_at || now;
        // Retire any redundant check so its retries/failure state cannot reopen
        // a fully approved composition. The durable job remains audit history.
        patch.active_job_id = null;
        patch.active_job = replace(db, null);
        patch.ocr_job = replace(db, null);
        patch.pending_rewrite_check = replace(db, null);
        patch.pending_revision_scan = replace(db, null);
        patch.pending_upload = replace(db, null);
      }
    }
    await tx.collection("writing_compositions").doc(c._id).update(patch);
    await tx.collection("answer_disputes").doc(d._id).update({ status, decision, teacher_note: teacherNote,
      resolved_by_teacher_uid: teacher.auth_uid, resolved_at: now, updated_at: now, student_seen: false, student_seen_at: null });
  });
  return { success: true };
}

module.exports = { TYPE, scope, submit, resolve, applyApprovals };
