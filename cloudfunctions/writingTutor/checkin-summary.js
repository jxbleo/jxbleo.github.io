"use strict";

// Read-only, owner-scoped receipt metadata. Count on the server, never from a
// paginated portfolio. A composition counts once, not once per rewrite round.
async function getCheckinSummary(db, student, event) {
  const id = String(event.composition_id || "").trim().slice(0, 96);
  const result = await db.collection("writing_compositions").where({
    composition_id: id, student_uid: student.auth_uid,
  }).limit(1).get();
  const composition = result.data && result.data[0];
  if (!composition || composition.deleted_at) throw new Error("COMPOSITION_NOT_FOUND");
  if (composition.status !== "completed" || !composition.completed_at) throw new Error("COMPOSITION_NOT_COMPLETED");
  // Use this composition's completion boundary so reopening an old receipt
  // does not award it a later composition's rank. ID breaks timestamp ties.
  const scope = { student_uid: student.auth_uid, status: "completed" };
  const earlier = await db.collection("writing_compositions").where({
    ...scope, completed_at: db.command.lt(composition.completed_at),
  }).count();
  const tied = await db.collection("writing_compositions").where({
    ...scope, completed_at: composition.completed_at,
    composition_id: db.command.lte(composition.composition_id),
  }).count();
  if (!Number.isInteger(earlier.total) || !Number.isInteger(tied.total) || tied.total < 1) throw new Error("CHECKIN_COUNT_UNAVAILABLE");
  return { success: true, completed_count: earlier.total + tied.total,
    word_count: Number(composition.word_count || 0), completed_at: composition.completed_at };
}
module.exports = { getCheckinSummary };
