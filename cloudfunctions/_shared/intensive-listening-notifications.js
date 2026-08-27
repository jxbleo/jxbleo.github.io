const crypto = require("crypto");

const THREE_MINUTES_MS = 180000;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function safeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function fallbackSourceMetadata(value = {}) {
  const sourceSetId = text(value.source_set_id || value.sourceSetId || value.set_id || value.material_id);
  const materialId = text(value.material_id || value.materialId || value.set_id || "");
  const explicitFamily = text(value.source_family || value.sourceFamily).toLowerCase();
  const explicitLabel = text(value.source_label || value.sourceLabel);
  const explicitSeries = text(value.series_label || value.seriesLabel);
  let sourceFamily = explicitFamily;
  let sourceLabel = explicitLabel;
  let seriesLabel = explicitSeries;
  if (!sourceFamily && /^IL-BBC-/i.test(materialId)) sourceFamily = "bbc";
  if (!sourceLabel && sourceFamily === "bbc") sourceLabel = "BBC";
  if (!seriesLabel && sourceFamily === "bbc") seriesLabel = "BBC 6 Minute English";
  if (!sourceFamily && /^(?:IL-)?C\d+-T\d+-S\d+$/i.test(materialId || sourceSetId)) sourceFamily = "ielts";
  if (!sourceLabel && sourceFamily === "ielts") sourceLabel = "IELTS";
  if (!seriesLabel && sourceFamily === "ielts") seriesLabel = "IELTS Listening";
  const dateCandidate = text(value.published_on || value.publishedOn);
  let publishedOn = /^\d{4}-\d{2}-\d{2}$/.test(dateCandidate) ? dateCandidate : "";
  if (!publishedOn) {
    const bbc = materialId.match(/^IL-BBC-(\d{2})(\d{2})(\d{2})$/i)
      || sourceSetId.match(/^BBC-(\d{2})(\d{2})(\d{2})$/i);
    if (bbc) publishedOn = `20${bbc[1]}-${bbc[2]}-${bbc[3]}`;
  }
  return {
    source_family: sourceFamily || "",
    source_label: sourceLabel || "",
    series_label: seriesLabel || "",
    published_on: publishedOn,
    source_set_id: sourceSetId || "",
    linked_practice_set_id: text(value.linked_practice_set_id || value.linkedPracticeSetId) || null,
  };
}

function safeRelativeHref(value, fallback = "") {
  const href = text(value);
  if (!href || href.startsWith("/") || /^(?:https?:)?\/\//i.test(href) || href.includes("\\")) return fallback;
  try {
    const parsed = new URL(href, "https://mrcat.invalid/");
    if (parsed.origin !== "https://mrcat.invalid") return fallback;
    return `${parsed.pathname.replace(/^\//, "")}${parsed.search}${parsed.hash}`;
  } catch (_error) {
    return fallback;
  }
}

function materialTitle(set, material) {
  return text(material && material.title) || text(set && set.title) || "Intensive Listening";
}

function estimatedMinutes(set, material) {
  const direct = Number(material && (material.estimated_minutes || material.estimatedMinutes));
  if (Number.isFinite(direct) && direct > 0) return Math.max(1, Math.ceil(direct));
  const fromSet = Number(set && set.estimated_minutes);
  if (Number.isFinite(fromSet) && fromSet > 0) return Math.max(1, Math.ceil(fromSet));
  const units = Array.isArray(material && material.units) ? material.units : [];
  const end = units.reduce((max, unit) => Math.max(max, Number(unit && unit.end_seconds) || 0), 0);
  return end > 0 ? Math.max(1, Math.ceil(end / 60)) : null;
}

function safeProgress(material, progress, service) {
  const source = progress && typeof progress === "object" ? progress : {};
  const current = service && service.publicProgress
    ? service.publicProgress(material, source)
    : source;
  return {
    percentage: Number(current.percentage) || 0,
    best_percentage: Number(current.best_percentage) || 0,
    completed_count: Number(current.completed_count) || 0,
    independent_count: Number(current.independent_count) || 0,
    assisted_count: Number(current.assisted_count) || 0,
    replay_count: Number(current.replay_count) || 0,
    updated_at: source.updated_at || null,
    completed_at: source.completed_at || null,
  };
}

function safeCatalogItem(set, material, progress, assignment, linkedPractice, service) {
  const metadata = { ...fallbackSourceMetadata(set || {}), ...fallbackSourceMetadata(material || {}) };
  const materialId = text(material && (material.material_id || material.set_id)) || text(set && set.set_id);
  const setId = text(set && set.set_id) || materialId;
  const units = Array.isArray(material && material.units) ? material.units : [];
  const dictationUnitCount = units.filter((unit) => String(unit && unit.practice_mode || "dictation") === "dictation").length;
  const sequenceUnitCount = units.length;
  const safe = safeProgress(material, progress, service);
  const output = {
    set_id: setId,
    title: materialTitle(set, material),
    source_family: text(set && set.source_family) || metadata.source_family,
    source_label: text(set && set.source_label) || metadata.source_label,
    series_label: text(set && set.series_label) || metadata.series_label,
    published_on: text(set && set.published_on) || metadata.published_on,
    source_set_id: text(set && set.source_set_id) || metadata.source_set_id,
    estimated_minutes: estimatedMinutes(set, material),
    dictation_unit_count: Number(set && set.dictation_unit_count) || dictationUnitCount,
    sequence_unit_count: Number(set && set.sequence_unit_count) || sequenceUnitCount,
    href: safeRelativeHref(set && set.link, `intensive-listening.html?set=${encodeURIComponent(setId)}`),
    linked_practice: linkedPractice && linkedPractice.set_id ? {
      set_id: text(linkedPractice.set_id),
      title: text(linkedPractice.title) || text(linkedPractice.set_id),
      href: safeRelativeHref(linkedPractice.href || linkedPractice.link),
    } : null,
    progress: safe,
    open_assignment: assignment ? {
      assignment_id: text(assignment.assignment_id || assignment._id),
      due_at: assignment.due_at || assignment.assigned_at || null,
      completion_target: Number(assignment.passing_percentage == null ? 100 : assignment.passing_percentage),
      status: text(assignment.status) || "to_do",
    } : null,
  };
  // Never let a malformed linked practice row leak an unsafe destination.
  if (output.linked_practice && !output.linked_practice.href) output.linked_practice = null;
  return output;
}

function createSessionId(randomBytes = crypto.randomBytes) {
  return `ils_${randomBytes(12).toString("hex")}`;
}

function sessionEventId(sessionId, phase) {
  const id = text(sessionId);
  if (!id || !["started", "paused", "completed"].includes(phase)) throw new Error("SESSION_EVENT_INVALID");
  return `${id}::${phase === "started" ? "started" : "final"}`;
}

function activityThreadKey(studentUid, assignmentId, setId) {
  const student = text(studentUid) || "unknown-student";
  return assignmentId
    ? `${student}::assignment::${text(assignmentId)}`
    : `${student}::self-study::${text(setId) || "unknown-set"}`;
}

function sessionContext({ replay = false, assignment = null } = {}) {
  if (replay) return { practice_context: "review", target_percentage: 100 };
  if (assignment) {
    return {
      practice_context: "assignment",
      target_percentage: Number(assignment.passing_percentage == null ? 100 : assignment.passing_percentage),
    };
  }
  return { practice_context: "self_study", target_percentage: 100 };
}

function sessionDeadline(now) {
  const date = safeDate(now) || new Date();
  return new Date(date.getTime() + THREE_MINUTES_MS);
}

function sessionDurationSeconds(startedAt, endedAt) {
  const start = safeDate(startedAt);
  const end = safeDate(endedAt);
  if (!start || !end) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
}

function sessionSummary(record = {}) {
  return {
    percentage: Number(record.percentage) || 0,
    completed_unit_count: Number(record.completed_unit_count) || 0,
    independent_unit_count: Number(record.independent_unit_count) || 0,
    assisted_unit_count: Number(record.assisted_unit_count) || 0,
  };
}

function buildSessionEvent({ student, material, record, sessionId, phase, occurredAt, startSummary, endSummary, targetPercentage, assignmentId, practiceContext, threadKey }) {
  const occurred = safeDate(occurredAt) || new Date();
  const start = startSummary || sessionSummary(record);
  const end = endSummary || sessionSummary(record);
  const startedAt = safeDate(record.notification_session_started_at) || occurred;
  const final = phase !== "started";
  return {
    event_id: sessionEventId(sessionId, phase),
    event_kind: "intensive_listening_session",
    session_id: text(sessionId),
    session_phase: phase,
    student_uid: text(student && student.auth_uid),
    student_id_snapshot: text(student && student.student_id),
    student_name_snapshot: text(student && (student.name || student.english_name || student.student_id)),
    set_id: text(material && (material.set_id || material.material_id)),
    set_title: text(material && material.title) || "Intensive Listening",
    assignment_id: text(assignmentId) || null,
    thread_key: text(threadKey) || activityThreadKey(student && student.auth_uid, assignmentId, material && (material.set_id || material.material_id)),
    mode: "intensive_listening",
    delivery_policy: "intensive_listening_immediate",
    practice_context: text(practiceContext) || "self_study",
    occurred_at: occurred,
    submitted_at: occurred,
    session_started_at: startedAt,
    session_ended_at: final ? occurred : null,
    session_duration_seconds: final ? sessionDurationSeconds(startedAt, occurred) : null,
    start_percentage: start.percentage,
    completion_percentage: end.percentage,
    completed_unit_count: end.completed_unit_count,
    independent_unit_count: end.independent_unit_count,
    assisted_unit_count: end.assisted_unit_count,
    new_completed_unit_count: final ? Math.max(0, end.completed_unit_count - start.completed_unit_count) : 0,
    target_percentage: Number(targetPercentage == null ? 100 : targetPercentage),
    target_met: final && end.percentage >= Number(targetPercentage == null ? 100 : targetPercentage),
    unread: true,
    // Intensive events use the same private outbox contract as attempt
    // emails.  Keeping these fields on every event makes the timer able to
    // claim Started/Paused/Completed events immediately and keeps retries
    // idempotent across both notification families.
    status: "pending",
    retry_count: 0,
    due_at: occurred,
    window_started_at: occurred,
    window_ends_at: occurred,
    delivery_status: "pending",
    created_at: occurred,
    updated_at: occurred,
  };
}

function normalizeBellItem(event, student = {}) {
  const row = event || {};
  return {
    activity_id: text(row.event_id || row._id),
    activity_type: "intensive_listening",
    thread_key: text(row.thread_key),
    student_uid: text(row.student_uid),
    student_id: text(student.student_id || row.student_id_snapshot),
    student_name: text(student.name || row.student_name_snapshot || row.student_id_snapshot),
    set_id: text(row.set_id),
    set_title: text(row.set_title || row.set_id),
    assignment_id: text(row.assignment_id) || null,
    occurred_at: row.occurred_at || row.submitted_at || null,
    session_phase: text(row.session_phase),
    practice_context: text(row.practice_context),
    completion_percentage: Number(row.completion_percentage) || 0,
    completed_unit_count: Number(row.completed_unit_count) || 0,
    independent_unit_count: Number(row.independent_unit_count) || 0,
    assisted_unit_count: Number(row.assisted_unit_count) || 0,
    new_completed_unit_count: Number(row.new_completed_unit_count) || 0,
    target_percentage: Number(row.target_percentage == null ? 100 : row.target_percentage),
    target_met: row.target_met === true,
    unread: row.unread !== false,
  };
}

function eventTime(item) {
  const date = safeDate(item && (item.occurred_at || item.submitted_at || item.created_at));
  return date ? date.getTime() : 0;
}

function mergeNotificationFeed(attempts = [], intensiveEvents = [], options = {}) {
  const excluded = new Set((options.excludeThreadKeys || []).map(text).filter(Boolean));
  const rows = [];
  (attempts || []).forEach((attempt) => rows.push({ source: "attempt", row: attempt, thread_key: text(attempt.thread_key) }));
  (intensiveEvents || []).forEach((event) => rows.push({ source: "intensive", row: event, thread_key: text(event.thread_key) }));
  rows.sort((a, b) => eventTime(b.row) - eventTime(a.row));
  const seen = new Set();
  const page = [];
  rows.forEach((item) => {
    if (page.length >= Number(options.limit || 10)) return;
    if (!item.thread_key || excluded.has(item.thread_key) || seen.has(item.thread_key)) return;
    seen.add(item.thread_key);
    page.push(item);
  });
  return {
    rows: page,
    thread_keys: page.map((item) => item.thread_key),
    consumed_attempts: (attempts || []).length,
    consumed_intensive: (intensiveEvents || []).length,
    has_more: rows.length > page.length,
  };
}

module.exports = {
  THREE_MINUTES_MS,
  fallbackSourceMetadata,
  safeRelativeHref,
  safeCatalogItem,
  createSessionId,
  sessionEventId,
  activityThreadKey,
  sessionContext,
  sessionDeadline,
  sessionDurationSeconds,
  sessionSummary,
  buildSessionEvent,
  normalizeBellItem,
  mergeNotificationFeed,
};
