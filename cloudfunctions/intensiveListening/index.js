const cloudbase = require("@cloudbase/node-sdk");
const crypto = require("crypto");
const service = require("./service");
const listeningMaterial = require("./material");
const notifications = require("../_shared/intensive-listening-notifications");
const intensiveSpelling = require("../_shared/intensive-listening-spelling");
const learningActivity = require("../_shared/learning-activity");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const MATERIALS = "intensive_listening_materials";
const PROGRESS = "intensive_listening_progress";
const REPLAYS = "intensive_listening_replays";
const DISPUTES = "answer_disputes";
const LEARNING_ACTIVITY = "learning_activity_sessions";
const ACTIVITY_MODES = ["dictation"];
const ACTIVITY_REASONS = ["audio", "playback", "typing", "input", "replay", "review", "interaction", "navigation", "flush", "pause", "close", "hidden", "blur", "pagehide", "unit-switch", "complete", "permission", "modal", "thinking", "network", "auto-advance", "superseded"];
const ACTIVITY_MAX_SPANS = 30;
const ACTIVITY_MAX_SPAN_SECONDS = 60;
const ACTIVITY_LEASE_SECONDS = 180;
const ACTIVITY_TRANSPORT_TOLERANCE_SECONDS = 5;
const ACTIVITY_MAX_FLUSH_SECONDS = 60;

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
  const normalized = listeningMaterial.normalizeMaterial(material);
  if (!listeningMaterial.trainingSegments(normalized, "dictation").length) {
    throw new Error("MATERIAL_EMPTY");
  }
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

function safeListeningMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return ["dictation"].includes(mode) ? mode : "";
}

async function listCatalog(profile) {
  if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
  const [setRows, materialRows, progressRows] = await Promise.all([
    getAll("sets"),
    getAll(MATERIALS),
    getAll(PROGRESS, { where: { student_uid: profile.auth_uid } }),
  ]);
  const sets = setRows.map((row) => row.data && typeof row.data === "object" ? { ...row.data, _id: row._id } : row)
    .filter((row) => row.visible !== false && isIntensiveListeningSet(row));
  const materialMap = new Map(materialRows
    .map((row) => row.data && typeof row.data === "object" ? { ...row.data, _id: row._id } : row)
    .filter((row) => row.visible !== false && String(row.set_id || row.material_id || ""))
    .map((row) => [String(row.set_id || row.material_id), row]));
  const progressMap = new Map(progressRows.map((row) => [service.progressScope(row), row]));
  const output = [];
  for (const set of sets) {
    const material = materialMap.get(String(set.set_id));
    if (!material) continue;
    const normalizedMaterial = listeningMaterial.normalizeMaterial(material);
    if (!listeningMaterial.trainingSegments(normalizedMaterial, "dictation").length) continue;
    const progress = progressMap.get(service.progressScope(material)) || null;
    const linked = await linkedPracticeFor(set, material);
    output.push(notifications.safeCatalogItem(set, material, progress, null, linked, service));
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
  if (isIntensiveListeningSet(set)) return;
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
  const normalized = listeningMaterial.normalizeMaterial(material);
  const units = Array.isArray(material.units) && material.units.length
    ? material.units
    : normalized.tracks.dictation.segments;
  const unit = units.find((candidate) => String(candidate.unit_id || candidate.segment_id) === id);
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

function notificationUpdateFields({ sessionId, status, context, assignmentId, target, now, startSummary, latestSummary, dueAt, closedAt, closeReason, practiceTrack }) {
  const latest = latestSummary || startSummary || {};
  const fields = {
    notification_session_id: sessionId || null,
    notification_session_status: status,
    notification_practice_context: context || "self_study",
    notification_assignment_id: assignmentId || null,
    notification_practice_track: practiceTrack || "dictation",
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
    practiceTrack: record.notification_practice_track || "dictation",
  });
  const fields = notificationUpdateFields({
    sessionId,
    status: finalPhase,
    context: record.notification_practice_context,
    practiceTrack: record.notification_practice_track || "dictation",
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

function activityMode(event) {
  const mode = safeListeningMode(event && (event.mode || event.practice_mode));
  if (!ACTIVITY_MODES.includes(mode)) throw new Error("LISTENING_MODE_INVALID");
  return mode;
}

function activityReason(value, fallback = "interaction") {
  const reason = String(value || fallback).trim().toLowerCase().slice(0, 40);
  return ACTIVITY_REASONS.includes(reason) ? reason : "interaction";
}

function activitySessionId(student, event) {
  const supplied = String(event && event.session_id || "").trim();
  if (supplied) return safeId(supplied, "ACTIVITY_SESSION_INVALID");
  return `la_${crypto.randomBytes(16).toString("hex")}`;
}

function activityLeaseId(student) {
  return stableId("learning-activity-lease", student.auth_uid);
}

function activityLeaseSessionId(lock) {
  return String(lock && (lock.active_session_id || lock.session_id) || "");
}

function activityDate(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isRecentActivityLease(lock, now) {
  if (!lock || lock.kind !== "lease" || lock.status !== "active") return false;
  const received = activityDate(lock.last_received_at);
  return Boolean(received && (now.getTime() - received.getTime()) < ACTIVITY_LEASE_SECONDS * 1000);
}

function safeActivitySession(session) {
  const source = session && typeof session === "object" ? session : {};
  return {
    session_id: String(source.session_id || ""),
    material_id: String(source.material_id || source.set_id || ""),
    set_id: String(source.set_id || source.material_id || ""),
    practice_mode: safeListeningMode(source.practice_mode) || "dictation",
    status: ["active", "paused", "closed"].includes(String(source.status)) ? String(source.status) : "closed",
    effective_seconds: Math.max(0, Math.floor(Number(source.effective_seconds) || 0)),
    daily_seconds: learningActivity.mergeDailyBuckets([source]),
    last_sequence: Math.max(0, Math.floor(Number(source.last_sequence) || 0)),
  };
}

async function loadActivitySession(student, sessionId) {
  return getOne(LEARNING_ACTIVITY, { session_id: sessionId, student_uid: student.auth_uid, kind: "session" });
}

async function loadActivityLease(student) {
  try {
    const result = await db.collection(LEARNING_ACTIVITY).doc(activityLeaseId(student)).get();
    return result && result.data && (Array.isArray(result.data) ? result.data[0] : result.data) || null;
  } catch (error) {
    const message = String(error && (error.message || error.code) || "").toLowerCase();
    if (message.includes("not exist") || message.includes("not found")) return null;
    throw error;
  }
}

async function saveActivitySession(session, update) {
  const documentId = session._id || session.session_id;
  await db.collection(LEARNING_ACTIVITY).doc(documentId).update(update);
  return { ...session, ...update };
}

async function releaseActivityLease(student, sessionId, now) {
  const lock = await loadActivityLease(student);
  if (!lock || activityLeaseSessionId(lock) !== String(sessionId || "")) return;
  await db.collection(LEARNING_ACTIVITY).doc(activityLeaseId(student)).update({
    kind: "lease",
    status: "released",
    active_session_id: null,
    released_at: now,
    updated_at: now,
  });
}

async function startLearningActivity(student, event, set, material) {
  if (student.role !== "student") throw new Error("STUDENT_REQUIRED");
  if (event.assignment_id) throw new Error("LISTENING_NOT_ASSIGNABLE");
  if (!isIntensiveListeningSet(set)) throw new Error("MATERIAL_NOT_FOUND");
  const mode = activityMode(event);
  const normalized = listeningMaterial.normalizeMaterial(material);
  if (!listeningMaterial.validateCanonicalMaterial(normalized)) throw new Error("MATERIAL_INVALID");
  const sessionId = activitySessionId(student, event);
  const now = new Date();
  const existing = await loadActivitySession(student, sessionId);
  if (existing && String(existing.material_id || existing.set_id) === String(material.material_id || material.set_id)
      && String(existing.practice_mode || "") === mode && existing.status !== "closed") {
    return { success: true, session: safeActivitySession(existing), reused: true };
  }
  const lock = await loadActivityLease(student);
  const activeLeaseSessionId = activityLeaseSessionId(lock);
  if (isRecentActivityLease(lock, now) && activeLeaseSessionId !== sessionId) {
    return { success: true, code: "ACTIVITY_SESSION_SUPERSEDED", superseded: true, session_id: activeLeaseSessionId };
  }
  if (activeLeaseSessionId && activeLeaseSessionId !== sessionId) {
    const previous = await loadActivitySession(student, activeLeaseSessionId);
    if (previous && previous.status === "active") {
      await saveActivitySession(previous, { status: "paused", close_reason: "superseded", updated_at: now });
    }
  }
  const session = {
    kind: "session",
    session_id: sessionId,
    student_uid: student.auth_uid,
    student_id_snapshot: String(student.student_id || ""),
    activity_type: "listening",
    material_id: String(material.material_id || material.set_id),
    set_id: String(material.set_id || material.material_id),
    practice_mode: mode,
    content_revision: String(normalized.content_revision || normalized.content_version || "1"),
    status: "active",
    started_at: now,
    last_received_at: now,
    last_effective_at: null,
    closed_at: null,
    close_reason: null,
    effective_seconds: 0,
    daily_seconds: {},
    unit_ids: [],
    last_sequence: 0,
    accepted_windows: [],
    integrity_flags: [],
    notification_session_id: null,
    created_at: now,
    updated_at: now,
  };
  try {
    await db.collection(LEARNING_ACTIVITY).doc(sessionId).create(session);
  } catch (error) {
    const message = String(error && (error.message || error.code) || "").toLowerCase();
    if (!message.includes("exist") && !message.includes("duplicate") && !message.includes("already")) throw error;
    const raced = await loadActivitySession(student, sessionId);
    if (!raced) throw error;
    return { success: true, session: safeActivitySession(raced), reused: true };
  }
  const lease = {
    kind: "lease",
    active_session_id: sessionId,
    student_uid: student.auth_uid,
    status: "active",
    last_received_at: now,
    updated_at: now,
  };
  try {
    if (lock) await db.collection(LEARNING_ACTIVITY).doc(activityLeaseId(student)).update(lease);
    else await db.collection(LEARNING_ACTIVITY).doc(activityLeaseId(student)).create(lease);
  } catch (error) {
    // A lease race is benign: the next flush will receive a superseded response.
    const message = String(error && (error.message || error.code) || "").toLowerCase();
    if (!message.includes("exist") && !message.includes("duplicate") && !message.includes("already")) throw error;
  }
  return { success: true, session: safeActivitySession(session), reused: false };
}

function activitySpans(event) {
  if (!Array.isArray(event.spans) || !event.spans.length || event.spans.length > ACTIVITY_MAX_SPANS) {
    throw new Error("ACTIVITY_SPANS_INVALID");
  }
  return event.spans.map((span) => {
    const start = Number(span && span.client_start_ms);
    const end = Number(span && span.client_end_ms);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("ACTIVITY_SPAN_INVALID");
    const seconds = Math.min(ACTIVITY_MAX_SPAN_SECONDS, Math.floor((end - start) / 1000));
    if (seconds <= 0) throw new Error("ACTIVITY_SPAN_INVALID");
    return { seconds, unit_id: span && span.unit_id ? String(span.unit_id).slice(0, 120) : null, reason: activityReason(span && span.reason) };
  });
}

function appendActivityBuckets(daily, windows, start, seconds) {
  let cursor = start.getTime();
  const end = cursor + seconds * 1000;
  learningActivity.splitSeconds(new Date(cursor), new Date(end)).forEach((part) => {
    daily[part.date] = (daily[part.date] || 0) + part.seconds;
    windows.push({ start_at: new Date(part.start_ms), end_at: new Date(part.end_ms), seconds: part.seconds, day: part.date });
  });
}

async function ensureActivityNotification(student, material, session, mode, now) {
  if (session.notification_session_id) return session;
  // The original progress notifier still owns the immediate Started event.
  // Bind the time session to that same thread so a long first
  // unit cannot create a second bell/email thread at the 60-second flush.
  let progress = await loadBestRecord(student, material);
    if (progress.notification_session_status !== "active" || !progress.notification_session_id) {
      const summary = recordNotificationSummary(progress, null, material);
      const sessionId = notifications.createSessionId();
      const fields = notificationUpdateFields({
        sessionId, status: "active", context: "self_study", assignmentId: null,
        target: 100, now, startSummary: summary, latestSummary: summary,
        dueAt: notifications.sessionDeadline(now), practiceTrack: "dictation",
      });
      const claim = await claimNotificationSession(student, material, progress, fields);
      progress = claim.record;
      if (claim.claimed) {
        await createSessionEvent(notifications.buildSessionEvent({
          student, material, record: progress, sessionId, phase: "started", occurredAt: now,
          startSummary: summary, endSummary: summary, targetPercentage: 100,
          assignmentId: null, practiceContext: "self_study", practiceTrack: "dictation",
          effectiveSeconds: session.effective_seconds,
        }));
      }
    }
  if (progress.notification_session_status !== "active" || !progress.notification_session_id) return session;
  return saveActivitySession(session, { notification_session_id: progress.notification_session_id, updated_at: now });
}

async function closeActivityNotification(student, material, session, reason, now) {
  if (!session.notification_session_id) return;
  const mode = safeListeningMode(session.practice_mode) || "dictation";
  const progress = await loadBestRecord(student, material);
  const summary = recordNotificationSummary(progress, null, material);
  const ownsActiveThread = progress.notification_session_status === "active"
    && String(progress.notification_session_id || "") === String(session.notification_session_id);
  // A result-based completion may already have closed this shared thread. Do
  // not append a second Paused email when the time tracker later exits.
  if (!ownsActiveThread) return;
  const fields = notificationUpdateFields({
    sessionId: session.notification_session_id, status: reason === "complete" ? "completed" : "paused", context: "self_study",
    assignmentId: null, target: 100, now, latestSummary: summary,
    closedAt: now, closeReason: reason, practiceTrack: mode,
  });
  await saveNotificationOnProgress(student, material, progress, fields);
  await createSessionEvent(notifications.buildSessionEvent({
    student,
    material,
    record: { ...progress, notification_session_started_at: progress.notification_session_started_at || session.started_at, effective_seconds: session.effective_seconds },
    sessionId: session.notification_session_id,
    phase: reason === "complete" ? "completed" : "paused",
    occurredAt: now,
    startSummary: {
      percentage: Number(progress.notification_start_percentage) || 0,
      completed_unit_count: Number(progress.notification_start_completed_count) || 0,
    },
    endSummary: summary,
    targetPercentage: 100,
    assignmentId: null,
    practiceContext: "self_study",
    practiceTrack: mode,
    effectiveSeconds: session.effective_seconds,
  }));
}

async function recordLearningActivity(student, event, set, material) {
  if (student.role !== "student") throw new Error("STUDENT_REQUIRED");
  if (event.assignment_id) throw new Error("LISTENING_NOT_ASSIGNABLE");
  const mode = activityMode(event);
  const normalized = listeningMaterial.normalizeMaterial(material);
  if (!listeningMaterial.validateCanonicalMaterial(normalized)) throw new Error("MATERIAL_INVALID");
  const sessionId = activitySessionId(student, event);
  let session = await loadActivitySession(student, sessionId);
  if (!session || session.status === "closed") {
    const started = await startLearningActivity(student, { ...event, session_id: sessionId }, set, material);
    if (started.superseded) return started;
    session = await loadActivitySession(student, sessionId);
  }
  if (!session || String(session.practice_mode || "") !== mode || String(session.material_id || session.set_id) !== String(material.material_id || material.set_id)) {
    throw new Error("ACTIVITY_SESSION_INVALID");
  }
  const lock = await loadActivityLease(student);
  const now = new Date();
  const activeLeaseSessionId = activityLeaseSessionId(lock);
  if (isRecentActivityLease(lock, now) && activeLeaseSessionId !== sessionId) {
    return { success: true, code: "ACTIVITY_SESSION_SUPERSEDED", superseded: true, session_id: activeLeaseSessionId };
  }
  const sequence = Math.max(0, Math.floor(Number(event.sequence) || 0));
  if (!sequence) throw new Error("ACTIVITY_SEQUENCE_INVALID");
  const spans = activitySpans(event);
  const validUnitIds = new Set(normalized.units.map((unit) => String(unit.unit_id || unit.segment_id || "")).filter(Boolean));
  spans.forEach((span) => {
    if (span.unit_id && !validUnitIds.has(span.unit_id)) throw new Error("ACTIVITY_UNIT_INVALID");
  });
  const requestedTotal = spans.reduce((sum, span) => sum + span.seconds, 0);
  let total = 0;
  let duplicate = false;
  const sessionDocumentId = session._id || sessionId;
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(LEARNING_ACTIVITY).doc(sessionDocumentId).get();
    const latest = result && result.data && (Array.isArray(result.data) ? result.data[0] : result.data);
    if (!latest || String(latest.student_uid || "") !== String(student.auth_uid) || latest.kind !== "session") {
      throw new Error("ACTIVITY_SESSION_INVALID");
    }
    if (sequence <= Math.max(0, Number(latest.last_sequence) || 0)) {
      duplicate = true;
      session = latest;
      return;
    }
    const previousReceivedAt = activityDate(latest.last_received_at || latest.started_at);
    const observedElapsed = previousReceivedAt
      ? Math.max(0, Math.floor((now.getTime() - previousReceivedAt.getTime()) / 1000))
      : 0;
    // Even the first flush is bounded by server-observed wall time. Otherwise a
    // forged first request could claim a full minute immediately after opening.
    let remaining = Math.max(0, Math.min(ACTIVITY_MAX_FLUSH_SECONDS, observedElapsed + ACTIVITY_TRANSPORT_TOLERANCE_SECONDS));
    const acceptedSpans = [];
    spans.forEach((span) => {
      if (remaining <= 0) return;
      const seconds = Math.min(span.seconds, remaining);
      if (seconds > 0) acceptedSpans.push({ ...span, seconds });
      remaining -= seconds;
    });
    total = acceptedSpans.reduce((sum, span) => sum + span.seconds, 0);
    const integrityFlags = Array.isArray(latest.integrity_flags) ? latest.integrity_flags.slice(-19) : [];
    if (total < requestedTotal) integrityFlags.push("server_elapsed_cap");
    const daily = { ...(latest.daily_seconds && typeof latest.daily_seconds === "object" ? latest.daily_seconds : {}) };
    const windows = Array.isArray(latest.accepted_windows) ? latest.accepted_windows.slice(-90) : [];
    let cursor = new Date(now.getTime() - total * 1000);
    const unitIds = Array.isArray(latest.unit_ids) ? latest.unit_ids.slice(0, 119) : [];
    acceptedSpans.forEach((span) => {
      const unitId = span.unit_id;
      if (unitId && !unitIds.includes(unitId)) unitIds.push(unitId);
      appendActivityBuckets(daily, windows, cursor, span.seconds);
      cursor = new Date(cursor.getTime() + span.seconds * 1000);
    });
    const accepted = Math.max(0, Math.floor(Number(latest.effective_seconds) || 0)) + total;
    const update = {
      status: "active", last_received_at: now, last_effective_at: total > 0 ? now : latest.last_effective_at || null,
      effective_seconds: accepted, daily_seconds: daily, unit_ids: unitIds,
      last_sequence: sequence, accepted_windows: windows.slice(-100),
      integrity_flags: integrityFlags.slice(-20), updated_at: now,
    };
    await transaction.collection(LEARNING_ACTIVITY).doc(sessionDocumentId).update(update);
    session = { ...latest, ...update };
  });
  if (duplicate) {
    return { success: true, duplicate: true, accepted_seconds: Math.max(0, Number(session.effective_seconds) || 0), session: safeActivitySession(session) };
  }
  session = await ensureActivityNotification(student, material, session, mode, now);
  if (lock) await db.collection(LEARNING_ACTIVITY).doc(activityLeaseId(student)).update({ status: "active", active_session_id: sessionId, last_received_at: now, updated_at: now });
  return { success: true, accepted_seconds: Math.max(0, Number(session.effective_seconds) || 0), accepted_span_seconds: total, clamped: total < requestedTotal, session: safeActivitySession(session) };
}

async function pauseLearningActivity(student, event, set, material) {
  const sessionId = activitySessionId(student, event);
  const session = await loadActivitySession(student, sessionId);
  if (!session) return { success: true, session_id: sessionId, status: "paused", accepted_seconds: 0 };
  const now = new Date();
  if (session.status === "closed") return { success: true, session: safeActivitySession(session), idempotent: true };
  const updated = await saveActivitySession(session, { status: "paused", last_received_at: now, close_reason: activityReason(event.reason, "pause"), updated_at: now });
  await releaseActivityLease(student, sessionId, now);
  return { success: true, session: safeActivitySession(updated) };
}

async function closeLearningActivity(student, event, set, material) {
  const sessionId = activitySessionId(student, event);
  const session = await loadActivitySession(student, sessionId);
  if (!session) return { success: true, session_id: sessionId, status: "closed", accepted_seconds: 0 };
  if (session.status === "closed") return { success: true, session: safeActivitySession(session), idempotent: true };
  const now = new Date();
  const updated = await saveActivitySession(session, {
    status: "closed", last_received_at: now, closed_at: now,
    close_reason: activityReason(event.reason, "close"), updated_at: now,
  });
  await closeActivityNotification(student, material, updated, activityReason(event.reason, "close"), now);
  await releaseActivityLease(student, sessionId, now);
  return { success: true, session: safeActivitySession(updated) };
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
    const normalized = listeningMaterial.normalizeMaterial(material);
    const base = {
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
    return {
      ...base,
      listening_version: 3,
      tracks: {
        dictation: { enabled: normalized.tracks.dictation.enabled, revision: normalized.content_revision, segment_count: listeningMaterial.trainingSegments(normalized, "dictation").length },
      },
    };
  }
  const student = profile;
  let best = await loadBestRecord(student, material);
  best = await repairPolicyProgress(student, set, material, best, false);
  let active = best;
  let replayMode = false;
  let assignment = null;
  if (event.assignment_id) {
    throw new Error("LISTENING_NOT_ASSIGNABLE");
  }
  if (event.replay_id) {
    active = await loadReplayRecord(student, material, event.replay_id);
    active = await repairPolicyProgress(student, set, material, active, true);
    replayMode = true;
  }
  const base = {
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
      required_listening_tracks: Array.isArray(assignment.required_listening_tracks) ? assignment.required_listening_tracks : [],
    } : null,
  };
  return { ...base, listening_version: 3, tracks: base.material.tracks };
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
    completed: false,
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
  const saved = await require("../_shared/argue-notifications").saveStudentDispute(db, {
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
  return { success: true, dispute_id: disputeId, status: "pending", already_exists: saved.already_exists };
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
    MATERIAL_INVALID: "This listening material is not ready for practice.",
    ASSIGNMENT_NOT_FOUND: "This assignment is no longer available.",
    LISTENING_NOT_ASSIGNABLE: "Listening practice is self-study and cannot be assigned.",
    LISTENING_MODE_INVALID: "This listening mode is unavailable.",
    ACTIVITY_SESSION_INVALID: "This learning-time session is unavailable.",
    ACTIVITY_SEQUENCE_INVALID: "This learning-time batch is unavailable.",
    ACTIVITY_SESSION_SUPERSEDED: "This learning-time session was superseded by another tab.",
    ACTIVITY_SPANS_INVALID: "This learning-time batch is unavailable.",
    ACTIVITY_SPAN_INVALID: "This learning-time span is invalid.",
    ACTIVITY_UNIT_INVALID: "This listening unit is unavailable.",
    ACTIVITY_SESSION_REQUIRED: "Start a learning-time session before recording activity.",
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
    // Listening is one self-study surface. Apply the boundary once before any
    // material action so stale or forged Assignment URLs cannot reach grading,
    // notifications, replay, or learning-time writes.
    if (profile.role === "student" && event.assignment_id) throw new Error("LISTENING_NOT_ASSIGNABLE");
    if (action === "startLearningActivity") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return await startLearningActivity(profile, event, set, material);
    }
    if (action === "recordLearningActivity") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return await recordLearningActivity(profile, event, set, material);
    }
    if (action === "pauseLearningActivity") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return await pauseLearningActivity(profile, event, set, material);
    }
    if (action === "closeLearningActivity") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return await closeLearningActivity(profile, event, set, material);
    }
    if (action === "bootstrap") return await bootstrap(profile, event, set, material);
    if (action === "check") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return await checkUnit(profile, event, set, material);
    }
    if (action === "recordActivity") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return await recordActivity(profile, event, set, material);
    }
    if (action === "reveal") return await revealAnswer(profile, event, set, material);
    if (action === "policy") return await policyStatus(event, material);
    if (action === "provideWord") return await provideTeacherWord(profile, event, material);
    if (action === "submitSpellingDispute") return await submitSpellingDispute(profile, event, material);
    if (action === "exportMaterial") return await exportMaterial(profile, material);
    if (action === "startReplay") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return await startReplay(profile, material);
    }
    throw new Error("ACTION_NOT_SUPPORTED");
  } catch (error) {
    console.error("intensiveListening failed", {
      code: String(error && error.message || "INTENSIVE_LISTENING_ERROR").slice(0, 120),
      category: String(error && error.category || "").slice(0, 80),
    });
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
