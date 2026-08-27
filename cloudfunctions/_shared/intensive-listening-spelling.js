const crypto = require("crypto");

function text(value) {
  return String(value == null ? "" : value).trim();
}

function recordData(record) {
  return record && record.data && typeof record.data === "object"
    ? { ...record.data, _id: record._id }
    : record;
}

function historyId(setId, contentVersion, unitId, slotId, revision) {
  const digest = crypto.createHash("sha256")
    .update([setId, contentVersion, unitId, slotId, revision].join("\n"))
    .digest("hex")
    .slice(0, 40);
  return `il-provided-${digest}`;
}

/**
 * Apply one teacher-approved Provided Word change atomically.
 *
 * The answer itself stays in the private material. The immutable audit row
 * records only the policy transition, so this helper can be shared by direct
 * teacher preview and the student Argue approval path without leaking answer
 * text into grading history.
 */
async function provideWord({
  db,
  material,
  unitId,
  slotId,
  teacherUid,
  disputeId = null,
  now = new Date(),
}) {
  if (!db || !material) throw new Error("MATERIAL_NOT_FOUND");
  if (!text(teacherUid)) throw new Error("TEACHER_REQUIRED");
  const setId = text(material.set_id || material.material_id);
  const contentVersion = text(material.content_version) || "1";
  const targetUnitId = text(unitId);
  const targetSlotId = text(slotId);
  if (!setId || !targetUnitId || !targetSlotId) throw new Error("SLOT_NOT_FOUND");

  let result = null;
  await db.runTransaction(async (transaction) => {
    const lookup = await transaction.collection("intensive_listening_materials").where({
      set_id: setId,
      content_version: contentVersion,
    }).limit(1).get();
    const sourceRecord = lookup.data && lookup.data[0];
    const source = recordData(sourceRecord);
    if (!source || !sourceRecord || !sourceRecord._id) throw new Error("MATERIAL_NOT_FOUND");
    const units = Array.isArray(source.units) ? source.units.map((unit) => ({
      ...unit,
      slots: Array.isArray(unit.slots) ? unit.slots.map((slot) => ({ ...slot })) : [],
    })) : [];
    const unit = units.find((candidate) => text(candidate.unit_id) === targetUnitId);
    const slot = unit && unit.slots.find((candidate) => text(candidate.slot_id) === targetSlotId);
    if (!unit || !slot) throw new Error("SLOT_NOT_FOUND");
    const policyRevision = Math.max(1, Number(source.policy_revision) || 1);
    if (slot.spelling_requirement === "provided") {
      result = {
        changed: false,
        policy_revision: policyRevision,
        material: source,
      };
      return;
    }
    const nextRevision = policyRevision + 1;
    slot.spelling_requirement = "provided";
    if (unit.slots.length && unit.slots.every((candidate) => candidate.spelling_requirement === "provided")) {
      unit.practice_mode = "listen_only";
    }
    const auditId = historyId(setId, contentVersion, targetUnitId, targetSlotId, nextRevision);
    const audit = {
      history_id: auditId,
      set_id: setId,
      question_id: `${targetUnitId}:${targetSlotId}`,
      dispute_id: disputeId || null,
      change_type: "intensive_spelling_exemption",
      content_version: contentVersion,
      policy_revision_before: policyRevision,
      policy_revision_after: nextRevision,
      answer_before: "required",
      answer_after: "provided",
      changed_by_teacher_uid: text(teacherUid),
      changed_at: now,
      applied: true,
      applied_at: now,
    };
    await transaction.collection("intensive_listening_materials").doc(sourceRecord._id).update({
      units,
      policy_revision: nextRevision,
      updated_at: now,
    });
    try {
      await transaction.collection("grading_key_history").doc(auditId).create(audit);
    } catch (error) {
      const message = String(error && (error.message || error.code) || "").toLowerCase();
      if (!message.includes("exist") && !message.includes("duplicate") && !message.includes("already")) throw error;
    }
    result = {
      changed: true,
      policy_revision: nextRevision,
      material: { ...source, units, policy_revision: nextRevision, updated_at: now },
    };
  });
  return result;
}

module.exports = {
  provideWord,
};
