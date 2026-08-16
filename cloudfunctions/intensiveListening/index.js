const cloudbase = require("@cloudbase/node-sdk");
const crypto = require("crypto");
const service = require("./service");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const MATERIALS = "intensive_listening_materials";
const PROGRESS = "intensive_listening_progress";
const REPLAYS = "intensive_listening_replays";

async function getOne(collection, query) {
  const result = await db.collection(collection).where(query).limit(1).get();
  return result.data && result.data[0] || null;
}

async function getAuthenticatedStudent() {
  const userInfo = await app.auth().getUserInfo();
  const uid = userInfo && (userInfo.uid || userInfo.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");
  const student = await getOne("students", { auth_uid: String(uid), active: true });
  if (!student) throw new Error("STUDENT_NOT_LINKED");
  if ((student.role || "student") !== "student") throw new Error("STUDENT_REQUIRED");
  return student;
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
  await db.collection(collection).doc(documentId).set(payload);
  return payload;
}

function statusRank(status) {
  return { to_do: 0, failed: 0, passed: 1, mastered: 2 }[String(status || "to_do")] || 0;
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
    const masteryEnabled = assignment.mastery_enabled === true;
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
  if (!Array.isArray(unit.slots) || !unit.slots.length || unit.slots.length > 120) throw new Error("UNIT_INVALID");
  return unit;
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

async function bootstrap(student, event, set, material) {
  const best = await loadBestRecord(student, material);
  let active = best;
  let replayMode = false;
  if (event.replay_id) {
    active = await loadReplayRecord(student, material, event.replay_id);
    replayMode = true;
  }
  return {
    success: true,
    material: service.publicMaterial(material),
    progress: responseProgress(material, active, replayMode ? best : null),
    replay_id: replayMode ? active.replay_id : null,
    assignment_id: event.assignment_id ? String(event.assignment_id) : null,
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
    STUDENT_REQUIRED: "Student access is required.",
    MATERIAL_REQUIRED: "No listening material was selected.",
    MATERIAL_NOT_FOUND: "This listening material is unavailable.",
    MATERIAL_EMPTY: "This listening material has no units.",
    UNIT_NOT_FOUND: "This listening unit is unavailable.",
    SLOT_COUNT_MISMATCH: "The word slots changed. Reload the material and try again.",
    SLOT_TOO_LONG: "One word entry is too long.",
    MATERIAL_NOT_COMPLETE: "Finish the material before starting again.",
    REPLAY_NOT_ACTIVE: "This temporary practice has ended. Open the material again.",
  };
  return { success: false, code, message: messages[code] || "Unable to continue this listening practice." };
}

exports.main = async (event = {}) => {
  try {
    const student = await getAuthenticatedStudent();
    const action = String(event.action || "bootstrap");
    const { set, material } = await loadMaterial(event);
    if (action === "bootstrap" || action === "warm") return bootstrap(student, event, set, material);
    if (action === "check") return checkUnit(student, event, set, material);
    if (action === "reveal") return revealAnswer(student, event, set, material);
    if (action === "startReplay") return startReplay(student, material);
    throw new Error("ACTION_NOT_SUPPORTED");
  } catch (error) {
    console.error("intensiveListening failed", error);
    return errorResponse(error);
  }
};

exports.__test = { stableId, monotonicStatus, recordPayload };
