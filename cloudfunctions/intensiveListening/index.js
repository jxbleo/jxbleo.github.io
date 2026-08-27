const cloudbase = require("@cloudbase/node-sdk");
const crypto = require("crypto");
const service = require("./service");
const notifications = require("../_shared/intensive-listening-notifications");
const intensiveSpelling = require("../_shared/intensive-listening-spelling");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const MATERIALS = "intensive_listening_materials";
const PROGRESS = "intensive_listening_progress";
const REPLAYS = "intensive_listening_replays";
const DISPUTES = "answer_disputes";

async function getOne(collection, query) {
  const result = await db.collection(collection).where(query).limit(1).get();
  return result.data && result.data[0] || null;
}

async function getAll(collection, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 500), 1), 500);
  let query = db.collection(collection);
  if (options.where) query = query.where(options.where);
  if (options.orderBy) query = query.orderBy(options.orderBy.field, options.orderBy.direction || "asc");
  const result = await query.limit(limit).get();
  return result.data || [];
}

async function getAuthenticatedProfile() {
  const userInfo = await app.auth().getUserInfo();
  const uid = userInfo && (userInfo.uid || userInfo.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");
  const profile = await getOne("students", { auth_uid: String(uid), active: true });
  if (!profile) throw new Error("STUDENT_NOT_LINKED");
  const role = String(profile.role || "student");
  if (role !== "student" && role !== "teacher") throw new Error("PROFILE_ROLE_REQUIRED");
  return profile;
}

function stableId(...parts) {
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}

function safeId(value, code) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) throw new Error(code);
  return normalized;
}

async function loadMaterial(event) {
  const setId = safeId(event.set_id || event.material_id, "MATERIAL_REQUIRED");
  const [set, material] = await Promise.all([
    getOne("sets", { set_id: setId, visible: true }),
    getOne(MATERIALS, { set_id: setId, visible: true }),
  ]);
  if (!set || !material) throw new Error("MATERIAL_NOT_FOUND");
  if (!Array.isArray(material.units) || !material.units.length) throw new Error("MATERIAL_EMPTY");
  return { set, material };
}

function isOpenAssignment(assignment) {
  return assignment && !["cancelled", "canceled", "passed", "mastered", "done"].includes(String(assignment.status || "to_do"));
}

async function linkedPracticeFor(set, material) {
  const linkedId = String(
    (set && set.linked_practice_set_id)
      || (material && material.linked_practice_set_id)
      || (set && set.source_set_id)
      || (material && material.source_set_id)
      || ""
  ).trim();
  if (!linkedId) return null;
  const linked = await getOne("sets", { set_id: linkedId, visible: true });
  if (!linked || !isListeningPracticeSet(linked)) return null;
  return {
    set_id: linked.set_id,
    title: linked.title || linked.set_id,
    href: linked.link || "",
  };
}

function isListeningPracticeSet(set) {
  if (!set || isIntensiveListeningSet(set)) return false;
  const id = String(set.set_id || "");
  if (/^BBC-/i.test(id) || /^C\d+-T\d+-S\d+$/i.test(id)) return true;
  return [set.section_id, set.section, set.type, set.course, set.category]
    .some((value) => /(?:bbc|ielts|listening)/i.test(String(value || "")));
}

async function listCatalog(profile) {
  if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
  const [setRows, materialRows, progressRows, assignmentRows] = await Promise.all([
    getAll("sets"),
    getAll(MATERIALS),
    getAll(PROGRESS, { where: { student_uid: profile.auth_uid } }),
    getAll("assignments", { where: { student_uid: profile.auth_uid } }),
  ]);
  const sets = setRows.map((row) => row.data && typeof row.data === "object" ? { ...row.data, _id: row._id } : row)
    .filter((row) => row.visible !== false && isIntensiveListeningSet(row));
  const materialMap = new Map(materialRows
    .map((row) => row.data && typeof row.data === "object" ? { ...row.data, _id: row._id } : row)
    .filter((row) => row.visible !== false && String(row.set_id || row.material_id || ""))
    .map((row) => [String(row.set_id || row.material_id), row]));
  const progressMap = new Map(progressRows.map((row) => [service.progressScope(row), row]));
  const assignmentsBySet = new Map();
  assignmentRows.forEach((row) => {
    const assignment = row.data && typeof row.data === "object" ? { ...row.data, _id: row._id } : row;
    if (assignment.status === "cancelled" || assignment.status === "canceled") return;
    const list = assignmentsBySet.get(String(assignment.set_id)) || [];
    list.push(assignment);
    assignmentsBySet.set(String(assignment.set_id), list);
  });
  const output = [];
  for (const set of sets) {
    const material = materialMap.get(String(set.set_id));
    if (!material || !Array.isArray(material.units) || !material.units.length) continue;
    const progress = progressMap.get(service.progressScope(material)) || null;
    const assignments = assignmentsBySet.get(String(set.set_id)) || [];
    const open = assignments.filter(isOpenAssignment).sort((a, b) => {
      const left = new Date(a.updated_at || a.due_at || a.created_at || 0).getTime();
      const right = new Date(b.updated_at || b.due_at || b.created_at || 0).getTime();
      return right - left;
    })[0] || null;
    const linked = await linkedPracticeFor(set, material);
    output.push(notifications.safeCatalogItem(set, material, progress, open, linked, service));
  }
  return {
    success: true,
    materials: output.sort((a, b) => String(b.published_on || "").localeCompare(String(a.published_on || "")) || String(a.title).localeCompare(String(b.title))),
  };
}

function progressId(student, material) {
  return stableId(student.auth_uid, service.progressScope(material));
}

async function loadBestRecord(student, material) {
  const id = progressId(student, material);
  return await getOne(PROGRESS, { progress_id: id, student_uid: student.auth_uid }) || {
    progress_id: id,
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    set_id: material.set_id,
    material_id: material.material_id || material.set_id,
    content_version: String(material.content_version || "1"),
    policy_revision: Math.max(1, Number(material.policy_revision) || 1),
    unit_states: {},
    best_percentage: 0,
    created_at: new Date(),
  };
}

async function loadReplayRecord(student, material, replayId) {
  const id = safeId(replayId, "REPLAY_REQUIRED");
  const replay = await getOne(REPLAYS, {
    replay_id: id,
    student_uid: student.auth_uid,
    material_id: material.material_id || material.set_id,
    content_version: String(material.content_version || "1"),
  });
  if (!replay || replay.status !== "active") throw new Error("REPLAY_NOT_ACTIVE");
  return replay;
}

async function loadSessionRecord(student, material, replayId) {
  return replayId ? loadReplayRecord(student, material, replayId) : loadBestRecord(student, material);
}

function recordPayload(student, material, record, unitStates, now, replayMode) {
  const summary = service.progressSummary(material, unitStates);
  const payload = {
    ...record,
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    set_id: material.set_id,
    material_id: material.material_id || material.set_id,
    content_version: String(material.content_version || "1"),
    policy_revision: Math.max(1, Number(material.policy_revision) || 1),
    unit_states: unitStates,
    completed_unit_count: summary.completed_count,
    independent_unit_count: summary.independent_count,
    assisted_unit_count: summary.assisted_count,
    replay_count: summary.replay_count,
    percentage: summary.percentage,
    updated_at: now,
  };
  delete payload._id;
  if (replayMode) {
    payload.status = summary.percentage === 100 ? "completed" : "active";
    if (summary.percentage === 100) payload.completed_at = record.completed_at || now;
  } else {
    payload.best_percentage = Math.max(Number(record.best_percentage) || 0, summary.percentage);
    if (summary.percentage === 100) payload.completed_at = record.completed_at || now;
  }
  return payload;
}

async function saveSessionRecord(student, material, record, unitStates, replayMode) {
  const now = new Date();
  const payload = recordPayload(student, material, record, unitStates, now, replayMode);
  const collection = replayMode ? REPLAYS : PROGRESS;
  const documentId = record._id || (replayMode ? record.replay_id : record.progress_id);
  // Grading and session-notification heartbeats can arrive from different
  // tabs. Never let a stale grading snapshot replace the independently owned
  // notification state. Existing rows are patched; first writes still create
  // the complete progress record.
  const persisted = { ...payload };
  Object.keys(persisted).forEach((key) => {
    if (key.startsWith("notification_")) delete persisted[key];
  });
  if (record._id) {
    await db.collection(collection).doc(documentId).update(persisted);
  } else {
    try {
      await db.collection(collection).doc(documentId).create(persisted);
    } catch (error) {
      const message = String(error && (error.message || error.code) || "").toLowerCase();
      if (!message.includes("exist") && !message.includes("duplicate") && !message.includes("already")) throw error;
      await db.collection(collection).doc(documentId).update(persisted);
    }
  }
  return { ...record, ...persisted };
}

function statusRank(status) {
  return { to_do: 0, failed: 0, passed: 1, mastered: 2 }[String(status || "to_do")] || 0;
}

function isIntensiveListeningSet(set) {
  return Boolean(set && (
    String(set.section_id || set.section || "").toLowerCase() === "intensive-listening"
    || String(set.type || "").toLowerCase() === "intensive-listening"
    || /^IL-/i.test(String(set.set_id || ""))
  ));
}

function monotonicStatus(current, next) {
  if (current === "cancelled") return current;
  return statusRank(current) > statusRank(next) ? current : next;
}

async function syncAssignments(student, set, percentage, now) {
  const result = await db.collection("assignments").where({
    student_uid: student.auth_uid,
    set_id: set.set_id,
  }).limit(100).get();
  for (const assignment of result.data || []) {
    if (assignment.status === "cancelled") continue;
    const passing = Number(assignment.passing_percentage == null ? set.passing_percentage || 100 : assignment.passing_percentage);
    const mastery = Number(assignment.mastery_percentage == null ? set.mastery_percentage || 100 : assignment.mastery_percentage);
    const masteryEnabled = !isIntensiveListeningSet(set) && assignment.mastery_enabled === true;
    const calculated = masteryEnabled && percentage >= mastery
      ? "mastered"
      : percentage >= passing ? "passed" : "to_do";
    const status = monotonicStatus(assignment.status, calculated);
    const previousBest = Number(assignment.best_percentage) || 0;
    const update = {
      status,
      latest_percentage: percentage,
      latest_raw_percentage: percentage,
      best_percentage: Math.max(previousBest, percentage),
      raw_best_percentage: Math.max(Number(assignment.raw_best_percentage) || 0, percentage),
      progress_updated_at: percentage > previousBest ? now : assignment.progress_updated_at || now,
      updated_at: now,
    };
    if (percentage > previousBest) update.best_improved_at = now;
    if ((status === "passed" || status === "mastered") && !assignment.completed_at) update.completed_at = now;
    if (status === "mastered" && !assignment.mastered_at) update.mastered_at = now;
    await db.collection("assignments").doc(assignment._id).update(update);
  }
}

function findUnit(material, unitId) {
  const id = safeId(unitId, "UNIT_REQUIRED");
  const unit = material.units.find((candidate) => String(candidate.unit_id) === id);
  if (!unit) throw new Error("UNIT_NOT_FOUND");
  if (service.practiceMode(unit) !== "dictation") throw new Error("UNIT_NOT_DICTATION");
  if (!Array.isArray(unit.slots) || !unit.slots.length || unit.slots.length > 120) throw new Error("UNIT_INVALID");
  return unit;
}

function findSlot(material, unitId, slotId) {
  const unit = findUnit(material, unitId);
  const id = safeId(slotId, "SLOT_REQUIRED");
  const slot = unit.slots.find((candidate) => String(candidate.slot_id) === id);
  if (!slot) throw new Error("SLOT_NOT_FOUND");
  return { unit, slot };
}

function entriesFromEvent(event, slotCount) {
  if (!Array.isArray(event.entries) || event.entries.length !== slotCount) throw new Error("SLOT_COUNT_MISMATCH");
  return event.entries.map((entry) => {
    const value = String(entry == null ? "" : entry);
    if (value.length > 80) throw new Error("SLOT_TOO_LONG");
    return value;
  });
}

function responseProgress(material, record, bestRecord) {
  const progress = service.publicProgress(material, record);
  if (bestRecord) progress.best_percentage = Math.max(progress.best_percentage, Number(bestRecord.best_percentage) || 0);
  return progress;
}

function sessionSummaryFromProgress(progress) {
  return {
    percentage: Number(progress && progress.percentage) || 0,
    completed_unit_count: Number(progress && progress.completed_count) || 0,
    independent_unit_count: Number(progress && progress.independent_count) || 0,
    assisted_unit_count: Number(progress && progress.assisted_count) || 0,
  };
}

async function createSessionEvent(event) {
  const eventId = notifications.sessionEventId(event.session_id, event.session_phase);
  const payload = { ...event, event_id: eventId };
  try {
    await db.collection("teacher_attempt_email_events").doc(eventId).create(payload);
  } catch (error) {
    // A deterministic event ID makes retries and multi-tab races idempotent.
    const message = String(error && (error.message || error.code) || "").toLowerCase();
    if (!message.includes("exist") && !message.includes("duplicate") && !message.includes("already")) throw error;
  }
  return payload;
}

async function authorizedAssignment(student, material, assignmentId) {
  const id = String(assignmentId || "").trim();
  if (!id) return null;
  const rows = await getAll("assignments", { where: { student_uid: student.auth_uid, set_id: material.set_id } });
  const assignment = rows.map((row) => row.data && typeof row.data === "object" ? { ...row.data, _id: row._id } : row)
    .find((row) => String(row.assignment_id || row._id) === id);
  if (!assignment || assignment.status === "cancelled" || assignment.status === "canceled") throw new Error("ASSIGNMENT_NOT_FOUND");
  return assignment;
}

function notificationUpdateFields({ sessionId, status, context, assignmentId, target, now, startSummary, latestSummary, dueAt, closedAt, closeReason }) {
  const latest = latestSummary || startSummary || {};
  const fields = {
    notification_session_id: sessionId || null,
    notification_session_status: status,
    notification_practice_context: context || "self_study",
    notification_assignment_id: assignmentId || null,
    notification_target_percentage: Number(target == null ? 100 : target),
    notification_latest_percentage: Number(latest.percentage) || 0,
    notification_latest_completed_count: Number(latest.completed_unit_count) || 0,
    notification_latest_independent_count: Number(latest.independent_unit_count) || 0,
    notification_latest_assisted_count: Number(latest.assisted_unit_count) || 0,
    updated_at: now,
  };
  if (status === "active") {
    fields.notification_session_started_at = now;
    fields.notification_last_active_at = now;
    fields.notification_session_due_at = dueAt || notifications.sessionDeadline(now);
    fields.notification_start_percentage = Number((startSummary || {}).percentage) || 0;
    fields.notification_start_completed_count = Number((startSummary || {}).completed_unit_count) || 0;
    fields.notification_closed_at = null;
    fields.notification_close_reason = null;
  } else {
    if (closedAt) fields.notification_closed_at = closedAt;
    fields.notification_session_due_at = null;
    fields.notification_close_reason = closeReason || null;
  }
  return fields;
}

async function saveNotificationOnProgress(student, material, record, fields) {
  const documentId = record._id || record.progress_id || progressId(student, material);
  await db.collection(PROGRESS).doc(documentId).update(fields);
  return { ...record, ...fields };
}

async function claimNotificationSession(student, material, record, fields) {
  const documentId = record._id || record.progress_id || progressId(student, material);
  let claimed = false;
  let current = record;
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(PROGRESS).where({
      progress_id: record.progress_id || documentId,
      student_uid: student.auth_uid,
    }).limit(1).get();
    const latest = result.data && result.data[0] || null;
    if (latest && latest.notification_session_status === "active" && latest.notification_session_id) {
      current = latest;
      return;
    }
    const base = latest || record;
    const payload = recordPayload(
      student,
      material,
      base,
      base.unit_states && typeof base.unit_states === "object" ? base.unit_states : {},
      fields.updated_at || new Date(),
      false
    );
    const next = { ...payload, ...fields };
    delete next._id;
    await transaction.collection(PROGRESS).doc(latest && latest._id || documentId).set(next);
    current = { ...base, ...next };
    claimed = true;
  });
  return { claimed, record: current };
}

function recordNotificationSummary(record, replayRecord, material) {
  if (replayRecord) return sessionSummaryFromProgress(service.publicProgress(material, replayRecord));
  return sessionSummaryFromProgress(service.publicProgress(material, record));
}

async function closeNotificationSession(student, material, record, endSummary, reason, now) {
  const sessionId = String(record.notification_session_id || "");
  if (!sessionId || record.notification_session_status !== "active") return record;
  const finalPhase = reason === "target_met" ? "completed" : "paused";
  const event = notifications.buildSessionEvent({
    student,
    material,
    record,
    sessionId,
    phase: finalPhase,
    occurredAt: now,
    startSummary: {
      percentage: Number(record.notification_start_percentage) || 0,
      completed_unit_count: Number(record.notification_start_completed_count) || 0,
    },
    endSummary,
    targetPercentage: Number(record.notification_target_percentage == null ? 100 : record.notification_target_percentage),
    assignmentId: record.notification_assignment_id,
    practiceContext: record.notification_practice_context,
  });
  const fields = notificationUpdateFields({
    sessionId,
    status: finalPhase,
    context: record.notification_practice_context,
    assignmentId: record.notification_assignment_id,
    target: record.notification_target_percentage,
    now,
    latestSummary: endSummary,
    closedAt: now,
    closeReason: reason,
  });
  const updated = await saveNotificationOnProgress(student, material, record, fields);
  await createSessionEvent(event);
  return updated;
}

async function recordActivity(student, event, set, material) {
  const activityType = String(event.activity_type || "").trim();
  if (!["audio_progress", "replay", "seek", "unit_navigation"].includes(activityType)) {
    throw new Error("ACTIVITY_TYPE_INVALID");
  }
  // The student has started only after the media playhead moves. Replay,
  // navigation, and seek actions may refresh an existing session, but cannot
  // establish one on their own.
  const canStartSession = activityType === "audio_progress";
  const replayId = event.replay_id ? String(event.replay_id).trim() : "";
  const replay = replayId ? await loadReplayRecord(student, material, replayId) : null;
  const assignment = replay ? null : await authorizedAssignment(student, material, event.assignment_id);
  const context = notifications.sessionContext({ replay: Boolean(replay), assignment });
  const now = new Date();
  let record = await loadBestRecord(student, material);
  const summary = recordNotificationSummary(record, replay, material);
  const activeSession = record.notification_session_status === "active" && record.notification_session_id;
  const deadline = record.notification_session_due_at && new Date(record.notification_session_due_at);
  if (activeSession && deadline && Number.isFinite(deadline.getTime()) && deadline.getTime() <= now.getTime()) {
    record = await closeNotificationSession(student, material, record, {
      percentage: Number(record.notification_latest_percentage) || 0,
      completed_unit_count: Number(record.notification_latest_completed_count) || 0,
      independent_unit_count: Number(record.notification_latest_independent_count) || 0,
      assisted_unit_count: Number(record.notification_latest_assisted_count) || 0,
      }, "idle", now);
  }
  if (record.notification_session_status === "active" && record.notification_session_id &&
      summary.percentage >= Number(record.notification_target_percentage == null ? 100 : record.notification_target_percentage)) {
    const completed = await closeNotificationSession(student, material, record, summary, "target_met", now);
    return {
      success: true,
      session_id: completed.notification_session_id,
      session_status: completed.notification_session_status,
      practice_context: completed.notification_practice_context,
      progress: responseProgress(material, replay || completed, replay ? await loadBestRecord(student, material) : null),
    };
  }
  if (record.notification_session_status === "active" && record.notification_session_id) {
    const latestFields = {
      notification_last_active_at: now,
      notification_session_due_at: notifications.sessionDeadline(now),
      notification_latest_percentage: summary.percentage,
      notification_latest_completed_count: summary.completed_unit_count,
      notification_latest_independent_count: summary.independent_unit_count,
      notification_latest_assisted_count: summary.assisted_unit_count,
      updated_at: now,
    };
    const updated = await saveNotificationOnProgress(student, material, record, latestFields);
    return {
      success: true,
      session_id: updated.notification_session_id,
      session_status: updated.notification_session_status,
      practice_context: updated.notification_practice_context,
      progress: responseProgress(material, updated),
    };
  }
  // Navigation and seek signals are useful heartbeats only after real audio
  // activity has established a session. They must not turn a page-only
  // interaction into a teacher notification session.
  if (!canStartSession) {
    return {
      success: true,
      session_id: null,
      session_status: record.notification_session_status || null,
      practice_context: record.notification_practice_context || context.practice_context,
      progress: responseProgress(material, replay || record, replay ? await loadBestRecord(student, material) : null),
    };
  }
  const sessionId = notifications.createSessionId();
  const fields = notificationUpdateFields({
    sessionId,
    status: "active",
    context: context.practice_context,
    assignmentId: assignment && (assignment.assignment_id || assignment._id),
    target: context.target_percentage,
    now,
    startSummary: summary,
    latestSummary: summary,
    dueAt: notifications.sessionDeadline(now),
  });
  const claim = await claimNotificationSession(student, material, record, fields);
  if (!claim.claimed) {
    const active = claim.record;
    return {
      success: true,
      session_id: active.notification_session_id,
      session_status: active.notification_session_status,
      practice_context: active.notification_practice_context,
      progress: responseProgress(material, replay || active, replay ? await loadBestRecord(student, material) : null),
    };
  }
  const updated = claim.record;
  await createSessionEvent(notifications.buildSessionEvent({
    student,
    material,
    record: updated,
    sessionId,
    phase: "started",
    occurredAt: now,
    startSummary: summary,
    endSummary: summary,
    targetPercentage: context.target_percentage,
    assignmentId: assignment && (assignment.assignment_id || assignment._id),
    practiceContext: context.practice_context,
  }));
  if (summary.percentage >= Number(context.target_percentage == null ? 100 : context.target_percentage)) {
    const completed = await closeNotificationSession(student, material, updated, summary, "target_met", now);
    return {
      success: true,
      session_id: completed.notification_session_id,
      session_status: completed.notification_session_status,
      practice_context: completed.notification_practice_context,
      progress: responseProgress(material, replay || completed, replay ? await loadBestRecord(student, material) : null),
    };
  }
  return {
    success: true,
    session_id: sessionId,
    session_status: "active",
    practice_context: context.practice_context,
    progress: responseProgress(material, updated),
  };
}

async function refreshNotificationSession(student, material, summary) {
  const record = await loadBestRecord(student, material);
  if (record.notification_session_status !== "active" || !record.notification_session_id) return record;
  const now = new Date();
  const target = Number(record.notification_target_percentage == null ? 100 : record.notification_target_percentage);
  if (Number(summary.percentage) >= target) return closeNotificationSession(student, material, record, summary, "target_met", now);
  return saveNotificationOnProgress(student, material, record, {
    notification_last_active_at: now,
    notification_session_due_at: notifications.sessionDeadline(now),
    notification_latest_percentage: summary.percentage,
    notification_latest_completed_count: summary.completed_unit_count,
    notification_latest_independent_count: summary.independent_unit_count,
    notification_latest_assisted_count: summary.assisted_unit_count,
    updated_at: now,
  });
}

async function repairPolicyProgress(student, set, material, record, replayMode) {
  const unitStates = record.unit_states && typeof record.unit_states === "object" ? record.unit_states : {};
  if (!record._id && !Object.keys(unitStates).length) return record;
  const summary = service.progressSummary(material, unitStates);
  if (Number(record.percentage) === summary.percentage
    && Number(record.completed_unit_count) === summary.completed_count
    && String(record.policy_revision || "") === String(material.policy_revision || 1)) return record;
  const saved = await saveSessionRecord(student, material, record, unitStates, replayMode);
  saved.policy_revision = Math.max(1, Number(material.policy_revision) || 1);
  const collection = replayMode ? REPLAYS : PROGRESS;
  const documentId = saved._id || (replayMode ? saved.replay_id : saved.progress_id);
  await db.collection(collection).doc(documentId).update({ policy_revision: saved.policy_revision });
  if (!replayMode) await syncAssignments(student, set, saved.best_percentage, new Date());
  return saved;
}

async function requesterDisputes(profile, material) {
  const result = await db.collection(DISPUTES).where({
    student_uid: profile.auth_uid,
    set_id: material.set_id,
    content_version: String(material.content_version || "1"),
    dispute_type: "intensive_spelling_exemption",
  }).limit(100).get();
  return (result.data || []).map((item) => ({
    dispute_id: item.dispute_id || item._id,
    unit_id: String(item.unit_id || ""),
    slot_id: String(item.slot_id || ""),
    status: String(item.status || "pending"),
    teacher_note: String(item.teacher_note || ""),
  }));
}

async function bootstrap(profile, event, set, material) {
  const linkedPractice = await linkedPracticeFor(set, material);
  if (profile.role === "teacher") {
    return {
      success: true,
      teacher_mode: true,
      material: service.publicMaterial(material),
      progress: service.publicProgress(material, { unit_states: {}, best_percentage: 0 }),
      slot_disputes: await requesterDisputes(profile, material),
      replay_id: null,
      assignment_id: null,
      source_label: String(set.source_label || material.source_label || notifications.fallbackSourceMetadata(material).source_label || ""),
      series_label: String(set.series_label || material.series_label || notifications.fallbackSourceMetadata(material).series_label || ""),
      linked_practice: linkedPractice,
      assignment_context: null,
    };
  }
  const student = profile;
  let best = await loadBestRecord(student, material);
  best = await repairPolicyProgress(student, set, material, best, false);
  let active = best;
  let replayMode = false;
  let assignment = null;
  if (event.assignment_id) {
    const requestedAssignmentId = String(event.assignment_id).trim();
    const assignments = await getAll("assignments", { where: { student_uid: student.auth_uid, set_id: material.set_id } });
    assignment = assignments.map((row) => row.data && typeof row.data === "object" ? { ...row.data, _id: row._id } : row)
      .find((row) => String(row.assignment_id || row._id) === requestedAssignmentId && row.status !== "cancelled" && row.status !== "canceled") || null;
    if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
  }
  if (event.replay_id) {
    active = await loadReplayRecord(student, material, event.replay_id);
    active = await repairPolicyProgress(student, set, material, active, true);
    replayMode = true;
  }
  return {
    success: true,
    material: service.publicMaterial(material),
    progress: responseProgress(material, active, replayMode ? best : null),
    slot_disputes: await requesterDisputes(profile, material),
    replay_id: replayMode ? active.replay_id : null,
    assignment_id: assignment ? String(assignment.assignment_id || assignment._id) : null,
    source_label: String(set.source_label || material.source_label || notifications.fallbackSourceMetadata(material).source_label || ""),
    series_label: String(set.series_label || material.series_label || notifications.fallbackSourceMetadata(material).series_label || ""),
    linked_practice: linkedPractice,
    assignment_context: assignment ? {
      assignment_id: String(assignment.assignment_id || assignment._id),
      due_at: assignment.due_at || assignment.assigned_at || null,
      completion_target: Number(assignment.passing_percentage == null ? 100 : assignment.passing_percentage),
      status: String(assignment.status || "to_do"),
    } : null,
  };
}

async function checkUnit(student, event, set, material) {
  const replayMode = Boolean(event.replay_id);
  const record = await loadSessionRecord(student, material, event.replay_id);
  const unit = findUnit(material, event.unit_id);
  const entries = entriesFromEvent(event, unit.slots.length);
  const unitStates = record.unit_states && typeof record.unit_states === "object" ? { ...record.unit_states } : {};
  const result = service.gradeUnit(
    unit,
    entries,
    unitStates[unit.unit_id],
    `${student.auth_uid}:${material.material_id || material.set_id}:${unit.unit_id}`,
    event.replay_delta
  );
  unitStates[unit.unit_id] = result.state;
  const saved = await saveSessionRecord(student, material, record, unitStates, replayMode);
  if (!replayMode) await syncAssignments(student, set, saved.best_percentage, new Date());
  if (result.effective) {
    await refreshNotificationSession(student, material, sessionSummaryFromProgress(responseProgress(material, saved)));
  }
  return {
    success: true,
    marks: result.marks,
    effective_check: result.effective,
    checks: result.state.checks,
    completed: result.state.completed,
    progress: responseProgress(material, saved, replayMode ? await loadBestRecord(student, material) : null),
  };
}

async function revealAnswer(student, event, set, material) {
  if (student.role === "teacher") {
    const unit = findUnit(material, event.unit_id);
    return {
      success: true,
      answer_available: true,
      answer_text: String(unit.text || ""),
      answers: unit.slots.map((slot) => String(slot.answer || "")),
      completed: false,
      teacher_mode: true,
    };
  }
  const replayMode = Boolean(event.replay_id);
  const record = await loadSessionRecord(student, material, event.replay_id);
  const unit = findUnit(material, event.unit_id);
  const unitStates = record.unit_states && typeof record.unit_states === "object" ? { ...record.unit_states } : {};
  const result = service.revealUnit(unit, unitStates[unit.unit_id], event.replay_delta);
  if (!result.allowed) {
    return { success: true, answer_available: false, remaining_checks: result.remaining };
  }
  unitStates[unit.unit_id] = result.state;
  const saved = await saveSessionRecord(student, material, record, unitStates, replayMode);
  if (!replayMode) await syncAssignments(student, set, saved.best_percentage, new Date());
  await refreshNotificationSession(student, material, sessionSummaryFromProgress(responseProgress(material, saved)));
  return {
    success: true,
    answer_available: true,
    answer_text: result.answerText,
    answers: result.answers,
    checks: result.state.checks,
    completed: true,
    progress: responseProgress(material, saved, replayMode ? await loadBestRecord(student, material) : null),
  };
}

async function submitSpellingDispute(profile, event, material) {
  if (profile.role === "teacher") throw new Error("TEACHER_USE_PROVIDE_WORD");
  const { unit, slot } = findSlot(material, event.unit_id, event.slot_id);
  if (service.isProvided(slot)) {
    return { success: true, already_applied: true, status: "approved" };
  }
  if (profile.role !== "teacher") {
    const record = await loadSessionRecord(profile, material, event.replay_id);
    const state = service.normalizedUnitState(
      record.unit_states && record.unit_states[unit.unit_id],
      unit.slots.length
    );
    if (!state.assisted) throw new Error("ANSWER_REVEAL_REQUIRED");
  }
  const disputeId = stableId(
    "intensive_spelling_exemption",
    profile.auth_uid,
    material.material_id || material.set_id,
    String(material.content_version || "1"),
    unit.unit_id,
    slot.slot_id
  );
  const existing = await getOne(DISPUTES, { dispute_id: disputeId });
  if (existing) {
    return {
      success: true,
      dispute_id: disputeId,
      status: String(existing.status || "pending"),
      already_exists: true,
    };
  }
  const now = new Date();
  await db.collection(DISPUTES).add({
    dispute_id: disputeId,
    dispute_type: "intensive_spelling_exemption",
    requester_role: profile.role === "teacher" ? "teacher" : "student",
    student_uid: profile.auth_uid,
    student_id_snapshot: profile.student_id || "",
    student_name_snapshot: profile.name || profile.student_id || "",
    set_id: material.set_id,
    material_id: material.material_id || material.set_id,
    content_version: String(material.content_version || "1"),
    policy_revision_snapshot: Math.max(1, Number(material.policy_revision) || 1),
    attempt_id: null,
    assignment_id: event.assignment_id ? String(event.assignment_id) : null,
    question_id: `${unit.unit_id}:${slot.slot_id}`,
    unit_id: unit.unit_id,
    slot_id: slot.slot_id,
    speaker_snapshot: String(unit.speaker || ""),
    start_seconds_snapshot: Number(unit.start_seconds) || 0,
    end_seconds_snapshot: Number(unit.end_seconds) || 0,
    audio_src_snapshot: String(material.audio_src || ""),
    question_text_snapshot: String(unit.text || "").slice(0, 2000),
    submitted_answer: String(slot.answer || ""),
    answer_snapshot: String(slot.answer || ""),
    student_reason: String(event.reason || "").trim().slice(0, 1000),
    status: "pending",
    created_at: now,
    updated_at: now,
  });
  return { success: true, dispute_id: disputeId, status: "pending" };
}

function exportMaterial(profile, material) {
  if (profile.role !== "teacher") throw new Error("TEACHER_REQUIRED");
  return {
    success: true,
    filename: `${material.material_id || material.set_id}.json`,
    material: service.sourceMaterial(material),
  };
}

function policyStatus(event, material) {
  const currentRevision = Math.max(1, Number(material.policy_revision) || 1);
  const clientRevision = Math.max(0, Number(event.policy_revision) || 0);
  return {
    success: true,
    policy_revision: currentRevision,
    material_update: clientRevision && clientRevision !== currentRevision ? service.publicMaterial(material) : null,
  };
}

async function provideTeacherWord(profile, event, material) {
  if (profile.role !== "teacher") throw new Error("TEACHER_REQUIRED");
  const result = await intensiveSpelling.provideWord({
    db,
    material,
    unitId: event.unit_id,
    slotId: event.slot_id,
    teacherUid: profile.auth_uid,
  });
  return {
    success: true,
    teacher_mode: true,
    already_applied: result.changed !== true,
    policy_revision: result.policy_revision,
    material: service.publicMaterial(result.material),
  };
}

async function startReplay(student, material) {
  const best = await loadBestRecord(student, material);
  if (Number(best.best_percentage) < 100) throw new Error("MATERIAL_NOT_COMPLETE");
  const now = new Date();
  const replayId = `ilr_${crypto.randomBytes(12).toString("hex")}`;
  const record = {
    replay_id: replayId,
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    set_id: material.set_id,
    material_id: material.material_id || material.set_id,
    content_version: String(material.content_version || "1"),
    status: "active",
    unit_states: {},
    percentage: 0,
    completed_unit_count: 0,
    independent_unit_count: 0,
    assisted_unit_count: 0,
    replay_count: 0,
    started_at: now,
    created_at: now,
    updated_at: now,
  };
  await db.collection(REPLAYS).doc(replayId).create(record);
  return {
    success: true,
    replay_id: replayId,
    progress: responseProgress(material, record, best),
  };
}

function errorResponse(error) {
  const code = String(error && error.message || "INTENSIVE_LISTENING_ERROR");
  const messages = {
    AUTH_REQUIRED: "Please log in.",
    STUDENT_NOT_LINKED: "This login is not linked to an active student.",
    PROFILE_ROLE_REQUIRED: "This account cannot open Intensive Listening.",
    STUDENT_REQUIRED: "Student access is required.",
    TEACHER_REQUIRED: "Teacher access is required.",
    MATERIAL_REQUIRED: "No listening material was selected.",
    MATERIAL_NOT_FOUND: "This listening material is unavailable.",
    MATERIAL_EMPTY: "This listening material has no units.",
    ASSIGNMENT_NOT_FOUND: "This assignment is no longer available.",
    UNIT_NOT_FOUND: "This listening unit is unavailable.",
    UNIT_NOT_DICTATION: "This segment does not require spelling.",
    SLOT_REQUIRED: "No word was selected.",
    SLOT_NOT_FOUND: "This word is unavailable.",
    ANSWER_REVEAL_REQUIRED: "Open Show Answer before submitting this Argue request.",
    SLOT_COUNT_MISMATCH: "The word slots changed. Reload the material and try again.",
    SLOT_TOO_LONG: "One word entry is too long.",
    MATERIAL_NOT_COMPLETE: "Finish the material before starting again.",
    REPLAY_NOT_ACTIVE: "This temporary practice has ended. Open the material again.",
    ACTIVITY_TYPE_INVALID: "This listening activity is unavailable.",
    TEACHER_USE_PROVIDE_WORD: "Teacher preview uses the direct Provide Word approval.",
  };
  return { success: false, code, message: messages[code] || "Unable to continue this listening practice." };
}

exports.main = async (event = {}) => {
  try {
    const profile = await getAuthenticatedProfile();
    const action = String(event.action || "bootstrap");
    if (action === "listCatalog") return await listCatalog(profile);
    const { set, material } = await loadMaterial(event);
    if (action === "bootstrap" || action === "warm") return bootstrap(profile, event, set, material);
    if (action === "check") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return checkUnit(profile, event, set, material);
    }
    if (action === "recordActivity") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return recordActivity(profile, event, set, material);
    }
    if (action === "reveal") return revealAnswer(profile, event, set, material);
    if (action === "policy") return policyStatus(event, material);
    if (action === "provideWord") return provideTeacherWord(profile, event, material);
    if (action === "submitSpellingDispute") return submitSpellingDispute(profile, event, material);
    if (action === "exportMaterial") return exportMaterial(profile, material);
    if (action === "startReplay") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return startReplay(profile, material);
    }
    throw new Error("ACTION_NOT_SUPPORTED");
  } catch (error) {
    console.error("intensiveListening failed", error);
    return errorResponse(error);
  }
};

exports.__test = {
  stableId,
  monotonicStatus,
  recordPayload,
  sessionSummaryFromProgress,
  notificationUpdateFields,
  isOpenAssignment,
};
