"use strict";

// Teacher-only read projection. Never load prompts, answers, audio, or credentials.
const crypto = require("crypto");
const PAGE_SIZE = 100;
const PRICE_DATE = "2026-09-16";
const SOURCES = {
  writing: { table: "writing_model_usage_events", fields: "event_id job_id student_uid stage model outcome usage_status input_tokens output_tokens cached_input_tokens created_at" },
  speaking: { table: "speaking_model_usage_events", fields: "event_id job_id discussion_id response_session_id student_uid stage model provider outcome safe_error_code input_tokens output_tokens cached_tokens audio_seconds created_at" },
  scan: { table: "vocabulary_scan_jobs", fields: "job_id student_uid status attempt_count model_usage model_metadata.model created_at finished_at" },
  legacy: { table: "writing_ai_jobs", fields: "job_id student_uid job_type status attempt_count telemetry_version created_at finished_at" },
};
const field = names => Object.fromEntries(("_id " + names).split(" ").map(key => [key, true]));
const text = (v, max = 160) => String(v == null ? "" : v).trim().slice(0, max);
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
function iso(value) { const n = value == null ? NaN : new Date(value).getTime(); return Number.isFinite(n) ? new Date(n).toISOString() : null; }
function identityKey(uid) { return crypto.createHash("sha256").update(String(uid)).digest("hex").slice(0, 24); }

function estimate(model, input, output, cached) {
  if (input == null || output == null) return null;
  let rate;
  if (/^qwen3\.8-max(?:-0902)?$/.test(model)) rate = [12, 36, 1.5];
  else if (/^qwen3\.7-plus(?:-2026-05-26)?$/.test(model)) {
    const factor = model === "qwen3.7-plus" ? 0.8 : 1;
    rate = (input > 256000 ? [6, 24, 1.2] : [2, 8, 0.4]).map(n => n * factor);
  } else if (/^qwen3\.7-flash(?:-2026-07-15)?$/.test(model)) {
    rate = input > 256000 ? [1.2, 4.8, 0.24] : input > 32000 ? [0.6, 2.4, 0.12] : [0.2, 0.8, 0.04];
  }
  if (!rate) return null;
  const hit = Math.min(input, count(cached) || 0);
  return ((input - hit) * rate[0] + output * rate[1] + hit * rate[2]) / 1000000;
}

function normalize(source, raw) {
  const scan = source === "scan", legacy = source === "legacy";
  const speech = source === "speaking" && /transcription/.test(raw.stage || "");
  const usage = scan ? raw.model_usage || {} : raw;
  const input = count(usage.input_tokens), output = count(usage.output_tokens);
  const cached = count(usage.cached_input_tokens ?? usage.cached_tokens);
  const model = text(scan ? raw.model_metadata && raw.model_metadata.model : raw.model, 100);
  const quota = raw.outcome === "quota_exhausted" || raw.safe_error_code === "SPEAKING_AI_FREE_QUOTA_EXHAUSTED";
  const status = quota ? "quota_exhausted" : /^(?:failed|http_error|network_error|transport_error|response_received|timeout|invalid_json|schema_error|schema_invalid|invalid_response|validation_failed|parse_error)$/.test(raw.outcome || raw.status || "") ? "failed"
    : /^(?:succeeded|completed|structured_success)$/.test(raw.outcome || raw.status || "") ? "completed"
      : /^(?:queued|processing)$/.test(raw.status || "") ? "pending" : "unknown";
  const calls = legacy ? null : scan ? count(usage.call_count) : 1;
  const recorded = !legacy && input != null && output != null;
  const module = source === "speaking" ? "speaking" : scan ? "scan" : "writing";
  const stage = text(legacy ? raw.job_type : scan ? "vocabulary_page_ocr" : raw.stage, 80);
  const textModel = !speech && !scan && !legacy && !/ocr/.test(stage);
  // Scan jobs aggregate physical calls; unknown per-call tiers must not be invented.
  const priceable = !legacy && !speech && (!scan || calls === 1);
  return {
    id: source + ":" + text(raw._id || raw.event_id || raw.job_id, 200),
    occurred_at: iso(scan || legacy ? raw.finished_at || raw.created_at : raw.created_at),
    module, stage, kind: legacy ? "legacy_task" : scan ? "task_summary" : speech ? "speech_call" : "model_call",
    model: model || (speech ? text(raw.provider, 100) : ""), status, call_count: calls,
    input_tokens: recorded ? input : null, output_tokens: recorded ? output : null,
    total_tokens: recorded ? input + output : null, cached_input_tokens: recorded ? cached : null,
    usage_status: speech ? "not_applicable" : quota ? "nonbillable" : recorded ? "recorded" : "missing",
    audio_seconds: speech && typeof raw.audio_seconds === "number" && raw.audio_seconds >= 0 ? raw.audio_seconds : null,
    estimated_cny: quota ? 0 : priceable ? estimate(model, input, output, cached) : null,
    comparison_max_cny: textModel && recorded ? estimate("qwen3.8-max", input, output, 0) : null,
    comparison_plus_cny: textModel && recorded ? estimate("qwen3.7-plus", input, output, 0) : null,
    students: [], group: false,
  };
}

async function lookup(db, table, key, values, fields) {
  const ids = [...new Set(values.filter(Boolean).map(String))];
  const result = [];
  // At most four requests in flight; one result per stable key in these collections.
  for (let start = 0; start < ids.length; start += 80) {
    const tasks = [];
    for (let i = start; i < Math.min(start + 80, ids.length); i += 20) {
      tasks.push(db.collection(table).where({ [key]: db.command.in(ids.slice(i, i + 20)) }).field(field(fields)).limit(100).get());
    }
    for (const page of await Promise.all(tasks)) result.push(...page.data || []);
  }
  return result;
}

async function attachIdentities(db, entries) {
  const speaking = entries.filter(x => x.source === "speaking");
  const jobs = await lookup(db, "speaking_ai_jobs", "job_id", speaking.map(x => x.raw.job_id), "job_id student_uid discussion_id response_session_id");
  const jobMap = new Map(jobs.map(j => [j.job_id, j]));
  const refs = speaking.map(x => ({ ...jobMap.get(x.raw.job_id), ...Object.fromEntries(Object.entries(x.raw).filter(([, v]) => v != null)) }));
  const [responses, discussions] = await Promise.all([
    lookup(db, "speaking_individual_responses", "response_session_id", refs.map(j => j.response_session_id), "response_session_id student_uid student_name_snapshot student_id_snapshot exam_family"),
    lookup(db, "speaking_discussions", "discussion_id", refs.map(j => j.discussion_id), "discussion_id creator_uid"),
  ]);
  const responseMap = new Map(responses.map(r => [r.response_session_id, r]));
  const discussionMap = new Map(discussions.map(r => [r.discussion_id, r]));
  const owners = entries.map(entry => {
    const ref = { ...jobMap.get(entry.raw.job_id), ...Object.fromEntries(Object.entries(entry.raw).filter(([, v]) => v != null)) };
    const response = responseMap.get(ref.response_session_id);
    const discussion = discussionMap.get(ref.discussion_id);
    entry.row.group = Boolean(discussion || ref.discussion_id);
    entry.row.exam_family = response ? response.exam_family === "ielts" ? "ielts" : "dse" : null;
    return { uid: text(ref.student_uid || response && response.student_uid || discussion && discussion.creator_uid), snapshot: response };
  });
  const profiles = await lookup(db, "students", "auth_uid", owners.map(x => x.uid), "auth_uid student_id name chinese_name english_name role deleted deleted_at");
  const byUid = new Map(profiles.map(p => [String(p.auth_uid), p]));
  entries.forEach((entry, index) => {
    const owner = owners[index], profile = byUid.get(owner.uid), snapshot = owner.snapshot || {};
    if (!owner.uid) return;
    const deleted = profile && (profile.deleted || profile.deleted_at);
    const login = text(profile && !deleted ? profile.student_id : snapshot.student_id_snapshot);
    entry.row.students = [{
      key: identityKey(owner.uid),
      name: text(profile && (text(profile.chinese_name) + text(profile.english_name) || profile.name) || snapshot.student_name_snapshot || "Historical account"),
      login_id: login.startsWith("__deleted__:") ? "" : login,
      role: profile && profile.role === "teacher" ? "teacher" : "student",
      deleted: Boolean(deleted),
    }];
  });
}

function parseCursor(event, now) {
  const cursor = event.cursor;
  if (!cursor) return { as_of: now.toISOString(), after: {}, done: {} };
  if (typeof cursor !== "object" || Array.isArray(cursor) || !iso(cursor.as_of)
      || new Date(cursor.as_of) > now || !cursor.after || typeof cursor.after !== "object"
      || !cursor.done || typeof cursor.done !== "object") throw new Error("AI_USAGE_CURSOR_INVALID");
  const result = { as_of: iso(cursor.as_of), after: {}, done: {} };
  for (const key of Object.keys(SOURCES)) {
    if (cursor.after[key] != null && (typeof cursor.after[key] !== "string" || cursor.after[key].length > 240)) throw new Error("AI_USAGE_CURSOR_INVALID");
    result.after[key] = cursor.after[key] || "";
    result.done[key] = cursor.done[key] === true;
  }
  return result;
}

async function listPage(db, event = {}, teacher, now = new Date()) {
  if (!teacher || !teacher.auth_uid || teacher.active !== true || teacher.role !== "teacher") throw new Error("TEACHER_REQUIRED");
  const cursor = parseCursor(event, now), entries = [];
  let scanned = 0;
  const pages = await Promise.all(Object.entries(SOURCES).map(async ([source, config]) => {
    if (cursor.done[source]) return { source, rows: [] };
    const where = cursor.after[source] ? { _id: db.command.gt(cursor.after[source]) } : {};
    const page = await db.collection(config.table).where(where).orderBy("_id", "asc").field(field(config.fields)).limit(PAGE_SIZE).get();
    return { source, rows: page.data || [] };
  }));
  for (const { source, rows } of pages) {
    scanned += rows.length;
    if (rows.length) cursor.after[source] = String(rows[rows.length - 1]._id);
    cursor.done[source] = cursor.done[source] || rows.length < PAGE_SIZE;
    for (const raw of rows) {
      if (iso(raw.created_at) && new Date(raw.created_at) > new Date(cursor.as_of)) continue;
      if (source === "legacy" && (raw.telemetry_version || !raw.attempt_count)) continue;
      if (source === "scan" && !raw.attempt_count && !(raw.model_usage && raw.model_usage.call_count)) continue;
      entries.push({ source, raw, row: normalize(source, raw) });
    }
  }
  const legacy = entries.filter(x => x.source === "legacy");
  const recordedJobs = new Set();
  for (let i = 0; i < legacy.length; i += 4) {
    const matches = await Promise.all(legacy.slice(i, i + 4).map(async entry => {
      const result = await db.collection("writing_model_usage_events").where({ job_id: entry.raw.job_id }).field({ job_id: true }).limit(1).get();
      return result.data && result.data[0] && entry.raw.job_id;
    }));
    matches.filter(Boolean).forEach(id => recordedJobs.add(id));
  }
  const visible = entries.filter(x => x.source !== "legacy" || !recordedJobs.has(x.raw.job_id));
  await attachIdentities(db, visible);
  const complete = Object.keys(SOURCES).every(key => cursor.done[key]);
  return {
    success: true, rows: visible.map(x => x.row), scanned_count: scanned,
    as_of: cursor.as_of, complete, next_cursor: complete ? null : cursor,
    pricing: { checked_at: PRICE_DATE, currency: "CNY", region: "Beijing", before_free_quota: true, source_url: "https://help.aliyun.com/zh/model-studio/model-pricing" },
  };
}

module.exports = { listPage, estimate, normalize, parseCursor, PAGE_SIZE };
