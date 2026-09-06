"use strict";

const crypto = require("crypto");
const LEASE_MS = 10 * 60 * 1000;
const text = (value) => String(value == null ? "" : value).trim();
const normalized = (value) => text(value).toLowerCase().replace(/\s+/g, " ");
async function one(db, collection, query) {
  const result = await db.collection(collection).where(query).limit(1).get();
  return result.data && result.data[0] || null;
}

function revision(dispute, source) {
  return dispute.dispute_type === "intensive_spelling_exemption"
    ? `${dispute.content_version || "1"}:${Number(source && source.policy_revision) || 1}`
    : String(source && source.grading_version || "1");
}

// Both the Teacher workspace and the email entry use this transaction boundary.
// The grading change and its audit are committed exactly once; a failed regrade
// can resume the committed decision without creating another grading version.
async function resolve({ db, event, teacher, regrade, provideWord, nextVersion, now = new Date() }) {
  const disputeId = text(event.dispute_id);
  const decision = text(event.decision);
  const note = text(event.teacher_note).slice(0, 1000);
  const token = crypto.randomUUID();
  let work;
  await db.runTransaction(async (transaction) => {
    const dispute = await one(transaction, "answer_disputes", { dispute_id: disputeId });
    if (!dispute) throw new Error("DISPUTE_NOT_AVAILABLE");
    const student = await one(transaction, "students", { auth_uid: dispute.student_uid });
    const assignment = dispute.assignment_id
      ? await one(transaction, "assignments", { assignment_id: dispute.assignment_id }) : null;
    if (!student || student.deleted || student.deleted_at || student.delete_pending ||
        (assignment && assignment.status === "cancelled")) throw new Error("DISPUTE_NOT_AVAILABLE");
    if (dispute.status !== "pending") throw new Error("DISPUTE_ALREADY_RESOLVED");
    const intensive = dispute.dispute_type === "intensive_spelling_exemption";
    if (!(intensive ? ["keep", "provide"] : ["keep", "add", "replace"]).includes(decision)) {
      throw new Error("DISPUTE_DECISION_REQUIRED");
    }
    if (dispute.resolution_token && new Date(dispute.resolution_started_at).getTime() > now.getTime() - LEASE_MS) {
      throw new Error("DISPUTE_PROCESSING");
    }
    let patch;
    if (dispute.resolution_decision) {
      if (dispute.resolution_decision !== decision || text(dispute.resolution_note) !== note) {
        throw new Error("DISPUTE_DECISION_COMMITTED");
      }
      patch = {};
    } else {
      const source = intensive
        ? await one(transaction, "intensive_listening_materials", { set_id: dispute.set_id, content_version: String(dispute.content_version || "1") })
        : await one(transaction, "grading_keys", { set_id: dispute.set_id });
      if (!source && (intensive || decision !== "keep")) throw new Error(intensive ? "MATERIAL_NOT_FOUND" : "GRADING_KEY_NOT_FOUND");
      if (event.expected_revision != null && text(event.expected_revision) !== revision(dispute, source)) {
        throw new Error("DISPUTE_REVIEW_CHANGED");
      }
      patch = {
        resolution_decision: decision, resolution_note: note,
        resolution_teacher_uid: teacher.auth_uid, resolution_requested_at: now,
      };
      if (!intensive && decision !== "keep") {
        if (!text(dispute.submitted_answer)) throw new Error("EMPTY_ANSWER_NOT_ACCEPTABLE");
        const answers = { ...(source.answers || {}) };
        const before = answers[dispute.question_id];
        const accepted = before == null ? [] : Array.isArray(before) ? before.slice() : [before];
        if (decision === "add") {
          if (!accepted.some((item) => normalized(item) === normalized(dispute.submitted_answer))) accepted.push(dispute.submitted_answer);
          answers[dispute.question_id] = accepted;
        } else answers[dispute.question_id] = dispute.submitted_answer;
        const version = nextVersion(source.grading_version);
        const historyId = `argue-${crypto.createHash("sha256").update(disputeId).digest("hex").slice(0, 40)}`;
        await transaction.collection("grading_key_history").doc(historyId).create({
          history_id: historyId, set_id: dispute.set_id, question_id: dispute.question_id,
          dispute_id: disputeId, decision, answer_before: before == null ? null : before,
          answer_after: answers[dispute.question_id], grading_version_before: source.grading_version || "1",
          grading_version_after: version, changed_by_teacher_uid: teacher.auth_uid, changed_at: now,
          auto_regrade_scope: "matching_historical_attempts", applied: true, applied_at: now,
        });
        await transaction.collection("grading_keys").doc(source._id).update({ answers, grading_version: version, updated_at: now });
        patch.grading_version_after = version;
        patch.resolution_history_id = historyId;
      }
    }
    patch.resolution_token = token;
    patch.resolution_started_at = now;
    await transaction.collection("answer_disputes").doc(dispute._id).update(patch);
    work = { ...dispute, ...patch };
  });
  try {
    const originalTeacher = { ...teacher, auth_uid: work.resolution_teacher_uid };
    let effects = {};
    if (work.dispute_type === "intensive_spelling_exemption") {
      effects = await provideWord(work, decision, originalTeacher, note);
    } else if (decision !== "keep") {
      const result = await regrade(work, originalTeacher, now, work.grading_version_after, work.resolution_history_id);
      effects = {
        auto_regrade_scanned_attempt_count: result.scanned_attempt_count,
        auto_regrade_adjusted_attempt_count: result.adjusted_attempt_count,
      };
    }
    await db.runTransaction(async (transaction) => {
      const current = await one(transaction, "answer_disputes", { dispute_id: disputeId });
      if (!current || current.resolution_token !== token) throw new Error("DISPUTE_PROCESSING");
      await transaction.collection("answer_disputes").doc(work._id).update({
        ...effects, status: decision === "keep" ? "rejected" : "approved",
        decision, teacher_note: note, resolved_by_teacher_uid: work.resolution_teacher_uid,
        student_seen: false, student_seen_at: null, resolved_at: now, updated_at: now,
        resolution_token: null, resolution_started_at: null,
      });
      if (work.resolution_history_id) {
        await transaction.collection("grading_key_history").doc(work.resolution_history_id).update({
          ...effects, auto_regrade_applied: true, auto_regrade_applied_at: now,
        });
      }
    });
    return { success: true };
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const current = await one(transaction, "answer_disputes", { dispute_id: disputeId });
      if (current && current.resolution_token === token) {
        await transaction.collection("answer_disputes").doc(work._id).update({ resolution_token: null, resolution_started_at: null });
      }
    });
    throw error;
  }
}

module.exports = { resolve, revision };
