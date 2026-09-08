const cloudbase = require("@cloudbase/node-sdk");
const crypto = require("crypto");
const service = require("./service");
const shadowing = require("./shadowing-service");
const soe = require("./tencent-soe-n");
const notifications = require("../_shared/intensive-listening-notifications");
const intensiveSpelling = require("../_shared/intensive-listening-spelling");
const learningActivity = require("../_shared/learning-activity");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const MATERIALS = "intensive_listening_materials";
const PROGRESS = "intensive_listening_progress";
const REPLAYS = "intensive_listening_replays";
const DISPUTES = "answer_disputes";
const SHADOW_PROGRESS = "listening_shadowing_progress";
const SHADOW_TAKES = "listening_shadowing_takes";
const SHADOW_USAGE = "listening_shadowing_usage";
const ASSIGNMENT_TRACKS = "listening_assignment_tracks";
const LEARNING_ACTIVITY = "learning_activity_sessions";
const SYSTEM_CONFIG = "system_config";
const SHADOW_POLICY_KEY = "listening_shadowing_score_policy";
const SHADOW_MAX_SEGMENT_WORDS = shadowing.MAX_REFERENCE_WORDS;
const SHADOW_MIN_TAKE_SECONDS = 2;
const SHADOW_PROVIDER_MAX_SECONDS = 300;
const ACTIVITY_MODES = ["dictation", "shadowing"];
const ACTIVITY_REASONS = ["audio", "playback", "typing", "input", "recording", "replay", "review", "interaction", "navigation", "flush", "pause", "close", "hidden", "blur", "pagehide", "mode-switch", "unit-switch", "complete", "permission", "modal", "thinking", "network", "auto-advance", "superseded"];
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
  const normalized = shadowing.normalizeMaterial(material);
  if (!shadowing.trainingSegments(normalized, "dictation").length && !shadowing.trainingSegments(normalized, "shadowing").length) {
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
  return ["dictation", "shadowing"].includes(mode) ? mode : "";
}

async function setModePreference(profile, event) {
  if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
  const mode = safeListeningMode(event.mode || event.practice_mode);
  if (!mode) throw new Error("LISTENING_MODE_INVALID");
  const update = { listening_mode_preference: mode, updated_at: new Date() };
  if (profile._id) await db.collection("students").doc(profile._id).update(update);
  else await db.collection("students").where({ auth_uid: profile.auth_uid, active: true }).limit(1).update(update);
  return { success: true, preferred_mode: mode };
}

async function listCatalog(profile) {
  if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
  const [setRows, materialRows, progressRows, shadowProgressRows] = await Promise.all([
    getAll("sets"),
    getAll(MATERIALS),
    getAll(PROGRESS, { where: { student_uid: profile.auth_uid } }),
    getAll(SHADOW_PROGRESS, { where: { student_uid: profile.auth_uid } }),
  ]);
  const sets = setRows.map((row) => row.data && typeof row.data === "object" ? { ...row.data, _id: row._id } : row)
    .filter((row) => row.visible !== false && isIntensiveListeningSet(row));
  const materialMap = new Map(materialRows
    .map((row) => row.data && typeof row.data === "object" ? { ...row.data, _id: row._id } : row)
    .filter((row) => row.visible !== false && String(row.set_id || row.material_id || ""))
    .map((row) => [String(row.set_id || row.material_id), row]));
  const progressMap = new Map(progressRows.map((row) => [service.progressScope(row), row]));
  const shadowProgressMap = new Map(shadowProgressRows.map((row) => [String(row.material_id || row.set_id), row]));
  const output = [];
  for (const set of sets) {
    const material = materialMap.get(String(set.set_id));
    if (!material) continue;
    const normalizedMaterial = shadowing.normalizeMaterial(material);
    if (!shadowing.trainingSegments(normalizedMaterial, "dictation").length && !shadowing.trainingSegments(normalizedMaterial, "shadowing").length) continue;
    const progress = progressMap.get(service.progressScope(material)) || null;
    const linked = await linkedPracticeFor(set, material);
    output.push(notifications.safeCatalogItem(set, material, progress, null, linked, service, shadowProgressMap.get(String(material.material_id || material.set_id)) || null));
  }
  return {
    success: true,
    preferred_mode: safeListeningMode(profile.listening_mode_preference) || "dictation",
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

function shadowingProgressId(student, material, revision) {
  return stableId("shadowing-progress", student.auth_uid, material.material_id || material.set_id, revision || shadowing.normalizeMaterial(material).tracks.shadowing.revision);
}

function revealThresholdPreference(student) {
  const value = student && student.listening_transcript_reveal_threshold;
  const normalized = value === "off" ? "off" : Number(value);
  return [1, 2, 3, 5, "off"].includes(normalized) ? normalized : 3;
}

function applyRevealPreference(progress, student) {
  const threshold = revealThresholdPreference(student);
  const states = progress && progress.segment_states && typeof progress.segment_states === "object"
    ? progress.segment_states
    : {};
  const nextStates = {};
  Object.keys(states).forEach((segmentId) => {
    const current = states[segmentId] || {};
    nextStates[segmentId] = {
      ...current,
      transcript_revealed: current.transcript_revealed === true
        || (threshold !== "off" && Number(current.complete_listen_count) >= Number(threshold)),
    };
  });
  return { ...progress, reveal_threshold: threshold, segment_states: nextStates };
}

function safeShadowingProgress(progress, includePrivate = false) {
  const source = progress && typeof progress === "object" ? progress : {};
  const states = source.segment_states && typeof source.segment_states === "object" ? source.segment_states : {};
  const outputStates = {};
  Object.keys(states).forEach((segmentId) => {
    const state = states[segmentId] || {};
    outputStates[segmentId] = {
      complete_listen_count: Math.max(0, Number(state.complete_listen_count) || 0),
      transcript_revealed: state.transcript_revealed === true,
      best_score: state.best_score == null ? null : Math.max(0, Math.min(100, Math.round(Number(state.best_score) || 0))),
      best_take_id: state.best_take_id || null,
      best_word_states: (includePrivate || state.transcript_revealed === true) && Array.isArray(state.best_word_states) ? state.best_word_states.slice(0, 120).map((word) => ({
        word_id: String(word.word_id || ""), state: ["normal", "yellow", "red", "unscored"].includes(word.state) ? word.state : "normal",
      })) : [],
      latest_score: state.latest_score == null
        ? (state.best_score == null ? null : Math.max(0, Math.min(100, Math.round(Number(state.best_score) || 0))))
        : Math.max(0, Math.min(100, Math.round(Number(state.latest_score) || 0))),
      latest_take_id: state.latest_take_id || state.best_take_id || null,
      latest_word_states: (includePrivate || state.transcript_revealed === true) && Array.isArray(state.latest_word_states || state.best_word_states) ? (state.latest_word_states || state.best_word_states).slice(0, 120).map((word) => ({
        word_id: String(word.word_id || ""), state: ["normal", "yellow", "red", "unscored"].includes(word.state) ? word.state : "normal",
      })) : [],
      qualified: state.qualified === true,
      assisted: state.assisted === true,
      independent: state.independent === true,
      in_to_improve: state.in_to_improve === true,
      updated_at: state.updated_at || null,
    };
  });
  const summary = shadowing.progressSummary({ ...source, segment_states: outputStates });
  return {
    progress_id: source.progress_id || null,
    material_id: String(source.material_id || ""),
    set_id: String(source.set_id || ""),
    shadowing_revision: String(source.shadowing_revision || ""),
    reveal_threshold: [1, 2, 3, 5, "off"].includes(source.reveal_threshold) ? source.reveal_threshold : 3,
    segment_states: outputStates,
    qualified_segment_count: summary.qualified_segment_count,
    segment_count: summary.segment_count,
    percentage: summary.percentage,
    completed: summary.completed,
    completed_at: source.completed_at || null,
    updated_at: source.updated_at || null,
  };
}

async function loadShadowingProgress(student, material, create = false) {
  const normalized = shadowing.normalizeMaterial(material);
  const revision = normalized.tracks.shadowing.revision;
  const progressId = shadowingProgressId(student, material, revision);
  const existing = await getOne(SHADOW_PROGRESS, {
    progress_id: progressId,
    student_uid: student.auth_uid,
    material_id: normalized.material_id,
    shadowing_revision: revision,
  });
  if (existing) return applyRevealPreference(existing, student);
  const blank = shadowing.createProgress(normalized, {
    progress_id: progressId,
    student_uid: student.auth_uid,
    reveal_threshold: revealThresholdPreference(student),
  });
  if (!create) return blank;
  const now = new Date();
  const payload = { ...blank, created_at: now, updated_at: now };
  try {
    await db.collection(SHADOW_PROGRESS).doc(progressId).create(payload);
    return payload;
  } catch (error) {
    const message = String(error && (error.message || error.code) || "").toLowerCase();
    if (!message.includes("exist") && !message.includes("duplicate") && !message.includes("already")) throw error;
    return await getOne(SHADOW_PROGRESS, { progress_id: progressId, student_uid: student.auth_uid }) || payload;
  }
}

async function saveShadowingProgress(student, material, progress) {
  const normalized = shadowing.normalizeMaterial(material);
  const progressId = progress.progress_id || shadowingProgressId(student, material, normalized.tracks.shadowing.revision);
  const now = new Date();
  const safe = safeShadowingProgress({ ...progress, progress_id: progressId, student_uid: student.auth_uid, material_id: normalized.material_id, set_id: normalized.set_id, shadowing_revision: normalized.tracks.shadowing.revision, updated_at: now }, true);
  const payload = { ...progress, ...safe, student_uid: student.auth_uid, created_at: progress.created_at || now, updated_at: now };
  delete payload._id;
  try {
    await db.collection(SHADOW_PROGRESS).doc(progress._id || progressId).update(payload);
  } catch (error) {
    const message = String(error && (error.message || error.code) || "").toLowerCase();
    if (!message.includes("not found") && !message.includes("exist")) throw error;
    await db.collection(SHADOW_PROGRESS).doc(progressId).create(payload);
  }
  return { ...progress, ...payload };
}

function shadowingTrackResponse(material, progress, revealAll = false) {
  const normalized = shadowing.normalizeMaterial(material);
  // The learner Shadowing surface contains scored practice lines only. Context
  // and skip units remain canonical material but are not accepted by the
  // listen/take endpoints, so returning them here would create dead controls.
  const segments = shadowing.trainingSegments(normalized, "shadowing");
  const states = progress && progress.segment_states || {};
  return segments.map((segment) => {
    const state = states[segment.segment_id] || {};
    const revealed = revealAll || state.transcript_revealed === true;
    const result = {
      segment_id: segment.segment_id,
      start_seconds: segment.start_seconds,
      end_seconds: segment.end_seconds,
      speaker: segment.speaker,
      practice_mode: shadowing.normalizeMode(segment.practice_mode),
      transcript_revealed: revealed,
      complete_listen_count: Number(state.complete_listen_count) || 0,
      best_score: state.best_score == null ? null : Number(state.best_score),
      latest_score: state.latest_score == null ? (state.best_score == null ? null : Number(state.best_score)) : Number(state.latest_score),
      qualified: state.qualified === true,
      assisted: state.assisted === true,
      independent: state.independent === true,
      in_to_improve: state.in_to_improve === true,
    };
    if (revealed) {
      result.text = segment.text;
      result.reference_words = shadowing.referenceWords(segment).map((word) => ({
        word_id: word.word_id, text: word.text, unscored: word.unscored === true,
      }));
    }
    return result;
  });
}

function shadowingProgressResponse(material, progress) {
  const safe = safeShadowingProgress(progress);
  const normalized = shadowing.normalizeMaterial(material);
  return {
    ...safe,
    material_id: normalized.material_id,
    set_id: normalized.set_id,
    shadowing_revision: normalized.tracks.shadowing.revision,
    to_improve: shadowing.toImproveQueue(safe, shadowing.trainingSegments(normalized, "shadowing")),
  };
}

async function scoringPolicy() {
  const row = await getOne(SYSTEM_CONFIG, { config_key: SHADOW_POLICY_KEY });
  if (!row) return null;
  const value = row.value && typeof row.value === "object" ? row.value : row;
  return { ...value, revision: String(value.revision || row.revision || "") };
}

function assertShadowingProviderConfigured() {
  const config = soe.configFromEnv();
  if (config.enabled !== true || !config.appId || !config.secretId || !config.secretKey) {
    throw new Error("SCORING_NOT_AVAILABLE");
  }
  try { soe.assertEndpoint(config.endpoint); } catch (_error) { throw new Error("SCORING_NOT_AVAILABLE"); }
  return config;
}

function shadowingReference(material, segmentId) {
  const normalized = shadowing.normalizeMaterial(material);
  const segment = shadowing.trainingSegments(normalized, "shadowing").find((item) => item.segment_id === String(segmentId));
  if (!segment) throw new Error("SHADOWING_SEGMENT_NOT_FOUND");
  const words = shadowing.referenceWords(segment);
  if (!segment.text || !words.length || words.length > SHADOW_MAX_SEGMENT_WORDS) throw new Error("SHADOWING_REFERENCE_INVALID");
  return segment;
}

async function authorizedListeningAssignment(student, material, assignmentId, track) {
  if (assignmentId) throw new Error("LISTENING_NOT_ASSIGNABLE");
  return null;
}

async function enforceShadowingQuota(student, material, segmentId, policy) {
  const now = Date.now();
  const tenMinutes = new Date(now - 10 * 60 * 1000);
  const hour = new Date(now - 60 * 60 * 1000);
  const shanghaiKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const [segmentRows, hourRows, dayRows] = await Promise.all([
    getAll(SHADOW_USAGE, { where: { student_uid: student.auth_uid, material_id: material.material_id || material.set_id, segment_id: segmentId, usage_day: shanghaiKey, billable_claimed: true }, orderBy: { field: "created_at", direction: "desc" }, limit: 50 }),
    getAll(SHADOW_USAGE, { where: { student_uid: student.auth_uid, usage_day: shanghaiKey, billable_claimed: true }, orderBy: { field: "created_at", direction: "desc" }, limit: 500 }),
    getAll(SHADOW_USAGE, { where: { student_uid: student.auth_uid, usage_day: shanghaiKey, billable_claimed: true }, orderBy: { field: "created_at", direction: "desc" }, limit: 500 }),
  ]);
  const within = (row, cutoff) => {
    const at = new Date(row.sent_at || row.created_at || 0).getTime();
    return at >= cutoff.getTime();
  };
  const intervalSeconds = Math.max(0, Number(policy && (policy.min_interval_seconds || policy.minIntervalSeconds)) || 2);
  if (intervalSeconds && [...hourRows, ...segmentRows].some((row) => Date.now() - new Date(row.sent_at || row.created_at || 0).getTime() < intervalSeconds * 1000)) throw new Error("SHADOWING_RATE_LIMITED");
  if (segmentRows.filter((row) => within(row, tenMinutes)).length >= 6) throw new Error("SHADOWING_SEGMENT_QUOTA");
  if (hourRows.filter((row) => within(row, hour)).length >= 60) throw new Error("SHADOWING_HOURLY_QUOTA");
  if (dayRows.filter((row) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(row.sent_at || row.created_at || 0)) === shanghaiKey).length >= 250) throw new Error("SHADOWING_DAILY_QUOTA");
  const globalLimit = Number(policy && (policy.global_daily_limit || policy.globalDailyLimit));
  if (Number.isFinite(globalLimit) && globalLimit > 0) {
    const counted = await db.collection(SHADOW_USAGE).where({ usage_day: shanghaiKey, billable_claimed: true }).count();
    if (Number(counted && counted.total) >= globalLimit) throw new Error("SHADOWING_GLOBAL_QUOTA");
  }
}

async function shadowingBootstrap(student, event, set, material, base) {
  const normalized = shadowing.normalizeMaterial(material);
  const progress = await loadShadowingProgress(student, material, false);
  const preferredMode = safeListeningMode(event.mode) || safeListeningMode(student.listening_mode_preference) || "dictation";
  return {
    ...base,
    listening_version: 3,
    preferred_mode: preferredMode,
    material: { ...base.material, units: base.material.units, modes: base.material.modes },
    tracks: {
      dictation: { enabled: normalized.tracks.dictation.enabled, revision: normalized.content_revision, segment_count: shadowing.trainingSegments(normalized, "dictation").length },
      shadowing: { enabled: normalized.tracks.shadowing.enabled, revision: normalized.content_revision, segment_count: shadowing.trainingSegments(normalized, "shadowing").length },
    },
    shadowing_progress: shadowingProgressResponse(material, progress),
    shadowing_segments: shadowingTrackResponse(material, progress, false),
  };
}

async function getTrack(student, event, material) {
  const track = String(event.track || "").toLowerCase();
  if (!shadowing.TRACKS.includes(track)) throw new Error("LISTENING_TRACK_INVALID");
  if (event.assignment_id) throw new Error("LISTENING_NOT_ASSIGNABLE");
  const normalized = shadowing.normalizeMaterial(material);
  if (!normalized.tracks[track].enabled) throw new Error("LISTENING_TRACK_DISABLED");
  if (track === "dictation") return { success: true, track, revision: normalized.tracks.dictation.revision, segments: service.publicMaterial(material).tracks.dictation.segments };
  const progress = await loadShadowingProgress(student, material, false);
  return { success: true, track, revision: normalized.tracks.shadowing.revision, segments: shadowingTrackResponse(material, progress, false), progress: shadowingProgressResponse(material, progress) };
}

async function setRevealThreshold(student, event, material) {
  const value = event.reveal_threshold == null ? event.revealThreshold : event.reveal_threshold;
  const threshold = value === "off" ? "off" : Number(value);
  if (![1, 2, 3, 5, "off"].includes(threshold)) throw new Error("REVEAL_THRESHOLD_INVALID");
  const progress = await loadShadowingProgress(student, material, true);
  await db.collection("students").doc(student._id).update({
    listening_transcript_reveal_threshold: threshold,
    updated_at: new Date(),
  });
  const nextStates = {};
  Object.keys(progress.segment_states || {}).forEach((segmentId) => {
    const current = progress.segment_states[segmentId] || {};
    nextStates[segmentId] = {
      ...current,
      transcript_revealed: current.transcript_revealed === true
        || (threshold !== "off" && Number(current.complete_listen_count) >= Number(threshold)),
    };
  });
  const saved = await saveShadowingProgress(student, material, { ...progress, reveal_threshold: threshold, segment_states: nextStates });
  return { success: true, reveal_threshold: threshold, progress: shadowingProgressResponse(material, saved) };
}

async function revealShadowingTranscript(student, event, material) {
  const segment = shadowingReference(material, event.segment_id);
  const progress = await loadShadowingProgress(student, material, true);
  const current = progress.segment_states && progress.segment_states[segment.segment_id];
  if (!current) throw new Error("SHADOWING_SEGMENT_NOT_FOUND");
  const saved = await saveShadowingProgress(student, material, {
    ...progress,
    segment_states: {
      ...progress.segment_states,
      [segment.segment_id]: { ...current, transcript_revealed: true, updated_at: new Date() },
    },
  });
  return {
    success: true,
    segment_id: segment.segment_id,
    transcript_revealed: true,
    segment: shadowingTrackResponse(material, saved, false).find((item) => item.segment_id === segment.segment_id),
    progress: shadowingProgressResponse(material, saved),
  };
}

async function startCompleteListen(student, event, material) {
  const segment = shadowingReference(material, event.segment_id);
  if (event.assignment_id) throw new Error("LISTENING_NOT_ASSIGNABLE");
  const progress = await loadShadowingProgress(student, material, true);
  const now = new Date();
  const durationMs = Math.max(400, Math.round((Number(segment.end_seconds) - Number(segment.start_seconds)) * 1000));
  const pending = progress.pending_play_tokens && typeof progress.pending_play_tokens === "object"
    ? { ...progress.pending_play_tokens }
    : {};
  Object.keys(pending).forEach((key) => {
    if (new Date(pending[key] && pending[key].expires_at || 0).getTime() <= now.getTime()) delete pending[key];
  });
  const playToken = `play_${crypto.randomBytes(18).toString("hex")}`;
  const tokenKey = stableId(student.auth_uid, material.material_id || material.set_id, segment.segment_id, playToken);
  pending[tokenKey] = {
    segment_id: segment.segment_id,
    started_at: now,
    earliest_complete_at: new Date(now.getTime() + Math.max(250, Math.ceil(durationMs * 0.9))),
    expires_at: new Date(now.getTime() + durationMs + 120000),
  };
  const keys = Object.keys(pending);
  while (keys.length > 20) delete pending[keys.shift()];
  await saveShadowingProgress(student, material, { ...progress, pending_play_tokens: pending });
  return { success: true, segment_id: segment.segment_id, play_token: playToken };
}

async function recordCompleteListen(student, event, material) {
  const segment = shadowingReference(material, event.segment_id);
  const token = safeId(event.complete_play_token || event.play_token, "COMPLETE_PLAY_TOKEN_REQUIRED");
  const progress = await loadShadowingProgress(student, material, true);
  const pending = progress.pending_play_tokens && typeof progress.pending_play_tokens === "object" ? { ...progress.pending_play_tokens } : {};
  const tokens = progress.complete_play_tokens && typeof progress.complete_play_tokens === "object" ? { ...progress.complete_play_tokens } : {};
  const tokenKey = stableId(student.auth_uid, material.material_id || material.set_id, segment.segment_id, token);
  let credited = false;
  if (!tokens[tokenKey]) {
    const issued = pending[tokenKey];
    const now = Date.now();
    if (!issued || String(issued.segment_id) !== String(segment.segment_id)) throw new Error("COMPLETE_PLAY_TOKEN_INVALID");
    if (new Date(issued.earliest_complete_at || 0).getTime() > now) throw new Error("COMPLETE_PLAY_TOO_EARLY");
    if (new Date(issued.expires_at || 0).getTime() < now) throw new Error("COMPLETE_PLAY_TOKEN_EXPIRED");
    delete pending[tokenKey];
    const state = progress.segment_states[segment.segment_id] || {};
    const threshold = progress.reveal_threshold;
    const countCap = threshold === "off" ? 5 : Math.max(1, Math.min(5, Number(threshold) || 3));
    const nextState = { ...state, complete_listen_count: Math.min(countCap, (Number(state.complete_listen_count) || 0) + 1), updated_at: new Date() };
    if (threshold !== "off" && nextState.complete_listen_count >= Number(threshold)) nextState.transcript_revealed = true;
    tokens[tokenKey] = new Date().toISOString();
    const keys = Object.keys(tokens);
    if (keys.length > 200) delete tokens[keys[0]];
    progress.segment_states = { ...progress.segment_states, [segment.segment_id]: nextState };
    progress.complete_play_tokens = tokens;
    progress.pending_play_tokens = pending;
    credited = true;
  }
  const saved = await saveShadowingProgress(student, material, progress);
  if (credited) await refreshShadowingNotification(student, material, saved, null);
  const current = saved.segment_states[segment.segment_id] || {};
  const base = {
    success: true,
    segment_id: segment.segment_id,
    transcript_revealed: current.transcript_revealed === true,
    segment: shadowingTrackResponse(material, saved, false).find((item) => item.segment_id === segment.segment_id),
    progress: shadowingProgressResponse(material, saved),
  };
  return base;
}

function takePath(student, material, takeId) {
  return `listening-shadowing/${String(student.auth_uid).replace(/[^A-Za-z0-9._:-]/g, "_")}/${String(material.material_id || material.set_id).replace(/[^A-Za-z0-9._:-]/g, "_")}/${takeId}.wav`;
}

function takeLockId(student) {
  return `slock_${stableId("shadowing-take-lock", student.auth_uid)}`;
}

async function releaseTakeLock(student, takeId) {
  const lockId = takeLockId(student);
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(SHADOW_TAKES).doc(lockId).get();
    const lock = result && result.data && (Array.isArray(result.data) ? result.data[0] : result.data);
    if (!lock || String(lock.active_take_id || "") !== String(takeId)) return;
    await transaction.collection(SHADOW_TAKES).doc(lockId).update({ active_take_id: null, status: "idle", released_at: new Date(), updated_at: new Date() });
  });
}

function validatesTakeFile(take, fileId) {
  const value = String(fileId || "").trim();
  return Boolean(value && (value === take.upload_path || value.endsWith(`/${take.upload_path}`)));
}

function shadowingMaxDurationSeconds(segment) {
  const sourceDuration = Math.max(0, Number(segment.end_seconds) - Number(segment.start_seconds));
  return Math.min(SHADOW_PROVIDER_MAX_SECONDS, Math.max(SHADOW_MIN_TAKE_SECONDS, sourceDuration * 1.8 + 3));
}

function shadowingMaxBytes(segment) {
  return Math.min(10 * 1024 * 1024, Math.ceil(shadowingMaxDurationSeconds(segment) * 32000 + 44));
}

async function reserveShadowingTake(student, event, material) {
  const segment = shadowingReference(material, event.segment_id);
  const clientTakeId = safeId(event.client_take_id || event.clientTakeId, "CLIENT_TAKE_ID_REQUIRED");
  if (event.assignment_id) throw new Error("LISTENING_NOT_ASSIGNABLE");
  const assignment = null;
  const progress = await loadShadowingProgress(student, material, true);
  const segmentProgress = progress.segment_states && progress.segment_states[segment.segment_id];
  if (!segmentProgress || Number(segmentProgress.complete_listen_count) < 1) throw new Error("SHADOWING_LISTEN_REQUIRED");
  const duplicate = await getOne(SHADOW_TAKES, { student_uid: student.auth_uid, client_take_id: clientTakeId, material_id: material.material_id || material.set_id });
  if (duplicate) return { success: true, take_id: duplicate.take_id, client_take_id: clientTakeId, upload_path: duplicate.upload_path, status: duplicate.status, idempotent: true };
  const policy = await scoringPolicy();
  if (!policy || policy.status !== "approved") throw new Error("SCORING_POLICY_NOT_APPROVED");
  assertShadowingProviderConfigured();
  await enforceShadowingQuota(student, material, segment.segment_id, policy);
  const takeId = `sht_${stableId(student.auth_uid, material.material_id || material.set_id, clientTakeId)}`;
  const now = new Date();
  const payload = {
    take_id: takeId,
    client_take_id: clientTakeId,
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    material_id: material.material_id || material.set_id,
    set_id: material.set_id,
    shadowing_revision: shadowing.normalizeMaterial(material).tracks.shadowing.revision,
    segment_id: segment.segment_id,
    assignment_id: assignment && (assignment.assignment_id || assignment._id) || null,
    reference_hash: shadowing.stableReferenceHash(segment, policy),
    upload_path: takePath(student, material, takeId),
    status: "reserved",
    provider: soe.PROVIDER,
    provider_revision: soe.PROVIDER_REVISION,
    scoring_policy_revision: String(policy.revision || ""),
    progress_id: progress.progress_id,
    reserved_at: now,
    expires_at: new Date(now.getTime() + 10 * 60 * 1000),
    created_at: now,
    updated_at: now,
  };
  try {
    await db.runTransaction(async (transaction) => {
      const lockId = takeLockId(student);
      const lockResult = await transaction.collection(SHADOW_TAKES).doc(lockId).get();
      const lock = lockResult && lockResult.data && (Array.isArray(lockResult.data) ? lockResult.data[0] : lockResult.data);
      if (lock && lock.active_take_id && new Date(lock.expires_at || 0).getTime() > now.getTime() && String(lock.active_take_id) !== takeId) throw new Error("SHADOWING_TAKE_IN_FLIGHT");
      await transaction.collection(SHADOW_TAKES).doc(takeId).create(payload);
      await transaction.collection(SHADOW_TAKES).doc(lockId).set({ kind: "student_take_lock", lock_id: lockId, student_uid: student.auth_uid, active_take_id: takeId, status: "active", expires_at: payload.expires_at, updated_at: now, created_at: lock && lock.created_at || now });
    });
  } catch (error) {
    const message = String(error && (error.message || error.code) || "").toLowerCase();
    if (error && error.message === "SHADOWING_TAKE_IN_FLIGHT") throw error;
    if (!message.includes("exist") && !message.includes("duplicate") && !message.includes("already")) throw error;
    const existing = await getOne(SHADOW_TAKES, { take_id: takeId, student_uid: student.auth_uid });
    if (existing) return { success: true, take_id: takeId, client_take_id: clientTakeId, upload_path: existing.upload_path, status: existing.status, idempotent: true };
    throw error;
  }
  return { success: true, take_id: takeId, client_take_id: clientTakeId, upload_path: payload.upload_path, upload_expires_at: payload.expires_at, max_bytes: shadowingMaxBytes(segment), max_duration_seconds: shadowingMaxDurationSeconds(segment), status: payload.status, progress: shadowingProgressResponse(material, progress) };
}

async function finishShadowingTake(student, event, material) {
  const takeId = safeId(event.take_id || event.takeId, "TAKE_REQUIRED");
  const take = await getOne(SHADOW_TAKES, { take_id: takeId, student_uid: student.auth_uid });
  if (!take) throw new Error("SHADOWING_TAKE_NOT_FOUND");
  if (take.status === "scored") {
    const progress = await loadShadowingProgress(student, material, false);
    const revealed = progress.segment_states && progress.segment_states[take.segment_id] && progress.segment_states[take.segment_id].transcript_revealed === true;
    return {
      success: true,
      idempotent: true,
      ...safeShadowingResult(take, revealed),
      segment: shadowingTrackResponse(material, progress, false).find((item) => item.segment_id === take.segment_id),
      progress: shadowingProgressResponse(material, progress),
    };
  }
  if (!["reserved", "uploaded", "validating"].includes(String(take.status))) {
    if (take.status === "outcome_unknown") throw new Error("SHADOWING_OUTCOME_UNKNOWN");
    throw new Error("SHADOWING_TAKE_NOT_ACTIVE");
  }
  if (new Date(take.expires_at || 0).getTime() < Date.now()) throw new Error("SHADOWING_TAKE_EXPIRED");
  const fileId = String(event.file_id || event.fileId || "").trim();
  if (!validatesTakeFile(take, fileId)) throw new Error("SHADOWING_UPLOAD_PATH_INVALID");
  const downloaded = await app.downloadFile({ fileID: fileId });
  const buffer = downloaded && downloaded.fileContent;
  const segment = shadowingReference(material, take.segment_id);
  const validation = shadowing.validateWav(buffer, {
    max_duration_seconds: shadowingMaxDurationSeconds(segment),
    min_duration_seconds: SHADOW_MIN_TAKE_SECONDS,
    max_bytes: shadowingMaxBytes(segment),
  });
  if (!validation.valid) {
    let deleted = false;
    try { await app.deleteFile({ fileList: [fileId] }); deleted = true; } catch (_error) { /* cleanup worker retries */ }
    const invalidAt = new Date();
    await db.collection(SHADOW_TAKES).doc(take._id || takeId).update({ status: "invalid", safe_error: validation.code, file_id: fileId, delete_after: invalidAt, audio_deleted_at: deleted ? invalidAt : null, updated_at: invalidAt });
    await releaseTakeLock(student, takeId);
    throw new Error(validation.code);
  }
  const audioHash = crypto.createHash("sha256").update(buffer).digest("hex");
  const policy = await scoringPolicy();
  let preflightError = "";
  if (!policy || policy.status !== "approved") preflightError = "SCORING_POLICY_NOT_APPROVED";
  else if (String(policy.revision || "") !== String(take.scoring_policy_revision || "")) preflightError = "SCORING_POLICY_CHANGED";
  else {
    try { assertShadowingProviderConfigured(); } catch (_error) { preflightError = "SCORING_NOT_AVAILABLE"; }
  }
  if (preflightError) {
    const rejectedAt = new Date();
    let deleted = false;
    try { await app.deleteFile({ fileList: [fileId] }); deleted = true; } catch (_error) { /* cleanup worker retries */ }
    await db.collection(SHADOW_TAKES).doc(take._id || takeId).update({
      status: "invalid",
      safe_error: preflightError.toLowerCase(),
      file_id: fileId,
      delete_after: rejectedAt,
      audio_deleted_at: deleted ? rejectedAt : null,
      updated_at: rejectedAt,
    });
    await releaseTakeLock(student, takeId);
    throw new Error(preflightError);
  }
  const referenceHash = take.reference_hash || shadowing.stableReferenceHash(segment, policy);
  const cacheKey = shadowing.duplicateKey({ audio_hash: audioHash, reference_hash: referenceHash, material_id: material.material_id || material.set_id, shadowing_revision: take.shadowing_revision, policy_revision: policy.revision, provider_revision: soe.PROVIDER_REVISION });
  const cached = await getOne(SHADOW_TAKES, { duplicate_key: cacheKey, status: "scored", student_uid: student.auth_uid });
  if (cached) {
    const progress = await loadShadowingProgress(student, material, true);
    const revealedBeforeTake = progress.segment_states[take.segment_id] && progress.segment_states[take.segment_id].transcript_revealed === true;
    const savedProgress = await saveShadowingProgress(student, material, shadowing.applyTake(progress, take.segment_id, { take_id: takeId, score: cached.product_score, word_states: cached.word_states }));
    let deleted = false;
    try { await app.deleteFile({ fileList: [fileId] }); deleted = true; } catch (_error) { /* cleanup worker retries */ }
    const evaluatedAt = new Date();
    const update = { status: "scored", duplicate_key: cacheKey, deduped_from_take_id: cached.take_id, audio_hash: audioHash, byte_size: validation.bytes, duration_seconds: validation.duration_seconds, product_score: cached.product_score, word_states: cached.word_states, independent: revealedBeforeTake !== true, assisted: revealedBeforeTake === true, safe_error: null, file_id: fileId, delete_after: evaluatedAt, audio_deleted_at: deleted ? evaluatedAt : null, evaluated_at: evaluatedAt, updated_at: evaluatedAt };
    await db.collection(SHADOW_TAKES).doc(take._id || takeId).update(update);
    await releaseTakeLock(student, takeId);
    await refreshShadowingNotification(student, material, savedProgress, null);
    return { success: true, take_id: takeId, score: cached.product_score, word_states: cached.word_states, transcript_revealed: true, qualified: Number(cached.product_score) >= shadowing.PASS_LINE, segment: shadowingTrackResponse(material, savedProgress, false).find((item) => item.segment_id === take.segment_id), progress: shadowingProgressResponse(material, savedProgress), cached: true };
  }
  const usageId = stableId("shadowing-usage", takeId);
  const usageDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const usage = { usage_id: usageId, take_id: takeId, student_uid: student.auth_uid, material_id: material.material_id || material.set_id, segment_id: take.segment_id, client_take_id: take.client_take_id, provider: soe.PROVIDER, provider_revision: soe.PROVIDER_REVISION, scoring_policy_revision: String(policy.revision || ""), reference_hash: referenceHash, audio_hash: audioHash, usage_day: usageDay, status: "reserved", billable_claimed: false, estimated_billable_units: 1, created_at: new Date(), updated_at: new Date() };
  await db.collection(SHADOW_USAGE).doc(usageId).create(usage);
  await db.collection(SHADOW_TAKES).doc(take._id || takeId).update({ status: "evaluating", file_id: fileId, audio_hash: audioHash, byte_size: validation.bytes, duration_seconds: validation.duration_seconds, usage_id: usageId, updated_at: new Date() });
  let provider;
  try {
    const sentAt = new Date();
    await db.collection(SHADOW_USAGE).doc(usageId).update({ status: "sent", billable_claimed: true, sent_at: sentAt, updated_at: sentAt });
    provider = await soe.evaluate(buffer, { referenceText: segment.text, appId: process.env.TENCENTCLOUD_APPID, secretId: process.env.TENCENTCLOUD_SECRETID, secretKey: process.env.TENCENTCLOUD_SECRETKEY, endpoint: process.env.LISTENING_SHADOWING_SOE_ENDPOINT, scoreCoeff: policy.score_coeff });
  } catch (error) {
    const category = error && error.category || soe.classifyError(error, "sent");
    const terminal = category === "outcome_unknown" ? "outcome_unknown" : "provider_failed";
    const failedAt = new Date();
    let deleted = false;
    try { await app.deleteFile({ fileList: [fileId] }); deleted = true; } catch (_error) { /* cleanup worker retries */ }
    await db.collection(SHADOW_TAKES).doc(take._id || takeId).update({ status: terminal, safe_error: category, file_id: fileId, delete_after: failedAt, audio_deleted_at: deleted ? failedAt : null, updated_at: failedAt });
    await db.collection(SHADOW_USAGE).doc(usageId).update({ status: terminal, billable_claimed: true, safe_error: category, terminal_at: new Date(), updated_at: new Date() });
    await releaseTakeLock(student, takeId);
    throw new Error(category === "not_configured" ? "SCORING_NOT_AVAILABLE" : category === "outcome_unknown" ? "SHADOWING_OUTCOME_UNKNOWN" : "SHADOWING_PROVIDER_FAILED");
  }
  const wordStates = shadowing.wordStatesFromEvidence(provider.words, segment, policy);
  const productScore = shadowing.scoreFromEvidence({ ...provider, word_states: wordStates }, policy);
  const now = new Date();
  const progress = await loadShadowingProgress(student, material, true);
  const revealedBeforeTake = progress.segment_states[take.segment_id] && progress.segment_states[take.segment_id].transcript_revealed === true;
  const nextProgress = shadowing.applyTake(progress, take.segment_id, { take_id: takeId, score: productScore, word_states: wordStates }, now);
  const savedProgress = await saveShadowingProgress(student, material, nextProgress);
  let deleted = false;
  try { await app.deleteFile({ fileList: [fileId] }); deleted = true; } catch (_error) { /* bounded cleanup worker retries */ }
  const update = { status: "scored", duplicate_key: cacheKey, file_id: fileId, provider_request_id: provider.request_id || null, provider_scores: { suggested_score: provider.suggested_score, pron_accuracy: provider.pron_accuracy, pron_fluency: provider.pron_fluency, pron_completion: provider.pron_completion }, product_score: productScore, word_states: wordStates, independent: revealedBeforeTake !== true, assisted: revealedBeforeTake === true, evaluated_at: now, delete_after: now, audio_deleted_at: deleted ? now : null, updated_at: now };
  await db.collection(SHADOW_TAKES).doc(take._id || takeId).update(update);
  await db.collection(SHADOW_USAGE).doc(usageId).update({ status: "sent", billable_claimed: true, provider_request_id: provider.request_id || null, terminal_at: now, updated_at: now });
  await releaseTakeLock(student, takeId);
  await updateListeningTrackAssignment(student, material, "shadowing", savedProgress, take.assignment_id);
  await refreshShadowingNotification(student, material, savedProgress, take.assignment_id);
  return { success: true, take_id: takeId, score: productScore, word_states: wordStates, transcript_revealed: true, qualified: nextProgress.segment_states[take.segment_id].qualified, segment: shadowingTrackResponse(material, savedProgress, false).find((item) => item.segment_id === take.segment_id), progress: shadowingProgressResponse(material, savedProgress) };
}

async function registerShadowingUpload(student, event, material) {
  const takeId = safeId(event.take_id || event.takeId, "TAKE_REQUIRED");
  const take = await getOne(SHADOW_TAKES, { take_id: takeId, student_uid: student.auth_uid, material_id: material.material_id || material.set_id });
  if (!take) throw new Error("SHADOWING_TAKE_NOT_FOUND");
  const fileId = String(event.file_id || event.fileId || "").trim();
  if (!validatesTakeFile(take, fileId)) throw new Error("SHADOWING_UPLOAD_PATH_INVALID");
  if (!["reserved", "uploaded"].includes(String(take.status))) throw new Error("SHADOWING_TAKE_NOT_ACTIVE");
  await db.collection(SHADOW_TAKES).doc(take._id || takeId).update({ status: "uploaded", file_id: fileId, uploaded_at: take.uploaded_at || new Date(), updated_at: new Date() });
  return { success: true, take_id: takeId, status: "uploaded" };
}

async function cancelShadowingTake(student, event, material) {
  const takeId = safeId(event.take_id || event.takeId, "TAKE_REQUIRED");
  const take = await getOne(SHADOW_TAKES, { take_id: takeId, student_uid: student.auth_uid, material_id: material.material_id || material.set_id });
  if (!take) throw new Error("SHADOWING_TAKE_NOT_FOUND");
  if (!["reserved", "uploaded", "validating"].includes(String(take.status))) {
    return { success: true, take_id: takeId, status: take.status, already_terminal: true };
  }
  const suppliedFileId = String(event.file_id || event.fileId || "").trim();
  if (suppliedFileId && !validatesTakeFile(take, suppliedFileId)) throw new Error("SHADOWING_UPLOAD_PATH_INVALID");
  const fileId = suppliedFileId || String(take.file_id || "").trim();
  const cancelledAt = new Date();
  let deleted = false;
  if (fileId) {
    try { await app.deleteFile({ fileList: [fileId] }); deleted = true; } catch (_error) { /* cleanup worker retries */ }
  }
  await db.collection(SHADOW_TAKES).doc(take._id || takeId).update({
    status: "invalid",
    safe_error: "client_cancelled",
    file_id: fileId || null,
    delete_after: cancelledAt,
    audio_deleted_at: !fileId || deleted ? cancelledAt : null,
    updated_at: cancelledAt,
  });
  await releaseTakeLock(student, takeId);
  return { success: true, take_id: takeId, status: "invalid" };
}

function safeShadowingResult(take, transcriptRevealed = false) {
  const score = Math.max(0, Math.min(100, Math.round(Number(take.product_score) || 0)));
  return { take_id: take.take_id, score, product_score: score, word_states: transcriptRevealed && Array.isArray(take.word_states) ? take.word_states : [], transcript_revealed: transcriptRevealed, qualified: score >= shadowing.PASS_LINE };
}

async function getShadowingTake(student, event, material) {
  const takeId = safeId(event.take_id || event.takeId, "TAKE_REQUIRED");
  const take = await getOne(SHADOW_TAKES, { take_id: takeId, student_uid: student.auth_uid, material_id: material.material_id || material.set_id });
  if (!take) throw new Error("SHADOWING_TAKE_NOT_FOUND");
  const progress = await loadShadowingProgress(student, material, false);
  const revealed = progress.segment_states && progress.segment_states[take.segment_id] && progress.segment_states[take.segment_id].transcript_revealed === true;
  return { success: true, result: take.status === "scored" ? safeShadowingResult(take, revealed) : { take_id: takeId, status: take.status, safe_error: take.safe_error || null } };
}

async function continueShadowingSegment(student, event, material) {
  const segment = shadowingReference(material, event.segment_id);
  const progress = await loadShadowingProgress(student, material, true);
  const saved = await saveShadowingProgress(student, material, shadowing.continueSegment(progress, segment.segment_id));
  await updateListeningTrackAssignment(student, material, "shadowing", saved, event.assignment_id);
  return { success: true, segment_id: segment.segment_id, progress: shadowingProgressResponse(material, saved) };
}

async function updateListeningTrackAssignment(student, material, track, progress, assignmentId) {
  // Intensive Listening is self-study only. Keep this compatibility function
  // as a no-op so old progress rows cannot mutate Assignment records.
  return;
  /* istanbul ignore next -- legacy assignment rows are intentionally inert.
  const setId = material.set_id || material.material_id;
  const rows = await getAll(ASSIGNMENT_TRACKS, { where: { student_uid: student.auth_uid, set_id: setId, track } });
  const summary = shadowingProgressSummaryForTrack(material, track, progress);
  for (const row of rows) {
    if (assignmentId && String(row.assignment_id) !== String(assignmentId)) continue;
    if (row.status === "cancelled") continue;
    const update = { completed_count: summary.completed_count, segment_count: summary.segment_count, percentage: summary.percentage, updated_at: new Date() };
    if (summary.completed) { update.status = "completed"; update.completed_at = row.completed_at || new Date(); }
    await db.collection(ASSIGNMENT_TRACKS).doc(row._id || row.participation_id).update(update);
    const parentId = row.assignment_id;
    if (parentId) await refreshListeningAssignment(student, parentId);
  }
  */
}

function shadowingProgressSummaryForTrack(material, track, progress) {
  if (track === "shadowing") {
    const summary = shadowing.progressSummary(progress);
    return { completed_count: summary.qualified_segment_count, segment_count: summary.segment_count, percentage: summary.percentage, completed: summary.completed };
  }
  const summary = service.progressSummary(material, progress && progress.unit_states || {});
  return { completed_count: summary.completed_count, segment_count: summary.unit_count, percentage: summary.percentage, completed: summary.percentage >= 100 };
}

async function refreshListeningAssignment(student, assignmentId) {
  const rows = await getAll(ASSIGNMENT_TRACKS, { where: { assignment_id: assignmentId, student_uid: student.auth_uid } });
  const active = rows.filter((row) => row.status !== "cancelled");
  if (!active.length) return;
  const complete = active.every((row) => row.status === "completed");
  const aggregate = Math.round(active.reduce((sum, row) => sum + Math.max(0, Math.min(100, Number(row.percentage) || 0)), 0) / active.length);
  const assignment = await getOne("assignments", { assignment_id: assignmentId, student_uid: student.auth_uid });
  if (!assignment || assignment.status === "cancelled") return;
  const now = new Date();
  const update = {
    latest_percentage: aggregate,
    latest_raw_percentage: aggregate,
    best_percentage: Math.max(Number(assignment.best_percentage) || 0, aggregate),
    raw_best_percentage: Math.max(Number(assignment.raw_best_percentage) || 0, aggregate),
    updated_at: now,
    required_listening_tracks: active.map((row) => row.track),
  };
  if (aggregate > Number(assignment.best_percentage || 0)) update.best_improved_at = now;
  if (complete) {
    update.status = "passed";
    update.completed_at = assignment.completed_at || now;
  }
  await db.collection("assignments").doc(assignment._id || assignmentId).update(update);
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
    if (assignment.assignment_kind === "listening") {
      const assignmentId = assignment.assignment_id || assignment._id;
      const trackRows = await getAll(ASSIGNMENT_TRACKS, { where: { assignment_id: assignmentId, student_uid: student.auth_uid, track: "dictation" } });
      if (trackRows.length) {
        for (const row of trackRows) {
          if (row.status === "cancelled") continue;
          const trackUpdate = { completed_count: percentage >= 100 ? 1 : 0, segment_count: 1, percentage, updated_at: now };
          if (percentage >= 100) { trackUpdate.status = "completed"; trackUpdate.completed_at = row.completed_at || now; }
          await db.collection(ASSIGNMENT_TRACKS).doc(row._id || row.participation_id).update(trackUpdate);
        }
        await refreshListeningAssignment(student, assignmentId);
        continue;
      }
    }
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
  const normalized = shadowing.normalizeMaterial(material);
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

function shadowingSessionSummary(progress) {
  const states = progress && progress.segment_states && typeof progress.segment_states === "object" ? progress.segment_states : {};
  const values = Object.values(states);
  const qualified = values.filter((item) => item && item.qualified === true).length;
  return {
    percentage: Number(progress && progress.percentage) || 0,
    completed_unit_count: qualified,
    independent_unit_count: values.filter((item) => item && item.independent === true).length,
    assisted_unit_count: values.filter((item) => item && item.assisted === true).length,
  };
}

async function refreshShadowingNotification(student, material, progress, assignmentId) {
  let record = progress;
  const now = new Date();
  const summary = shadowingSessionSummary(progress);
  const documentId = record._id || record.progress_id || shadowingProgressId(student, material, record.shadowing_revision);
  const save = async (fields) => {
    await db.collection(SHADOW_PROGRESS).doc(documentId).update(fields);
    record = { ...record, ...fields };
    return record;
  };
  const close = async (current, reason) => {
    if (!current.notification_session_id || current.notification_session_status !== "active") return current;
    const phase = reason === "target_met" ? "completed" : "paused";
    const fields = notificationUpdateFields({ sessionId: current.notification_session_id, status: phase, context: current.notification_practice_context, assignmentId: current.notification_assignment_id, target: current.notification_target_percentage, now, latestSummary: summary, closedAt: now, closeReason: reason, practiceTrack: "shadowing" });
    const updated = await save(fields);
    await createSessionEvent(notifications.buildSessionEvent({ student, material, record: current, sessionId: current.notification_session_id, phase, occurredAt: now, startSummary: { percentage: Number(current.notification_start_percentage) || 0, completed_unit_count: Number(current.notification_start_completed_count) || 0 }, endSummary: summary, targetPercentage: Number(current.notification_target_percentage == null ? 100 : current.notification_target_percentage), assignmentId: current.notification_assignment_id, practiceContext: current.notification_practice_context, practiceTrack: "shadowing" }));
    return updated;
  };
  if (record.notification_session_status === "active" && record.notification_session_id) {
    const updated = await save({
      notification_practice_track: "shadowing",
      notification_last_active_at: now,
      notification_session_due_at: notifications.sessionDeadline(now),
      notification_latest_percentage: summary.percentage,
      notification_latest_completed_count: summary.completed_unit_count,
      notification_latest_independent_count: summary.independent_unit_count,
      notification_latest_assisted_count: summary.assisted_unit_count,
      updated_at: now,
    });
    if (summary.percentage >= Number(record.notification_target_percentage == null ? 100 : record.notification_target_percentage)) {
      return close(updated, "target_met");
    }
    return updated;
  }
  const sessionId = notifications.createSessionId();
  const context = assignmentId ? "assignment" : "self_study";
  const fields = notificationUpdateFields({
    sessionId,
    status: "active",
    context,
    assignmentId,
    target: 100,
    now,
    startSummary: summary,
    latestSummary: summary,
    dueAt: notifications.sessionDeadline(now),
    practiceTrack: "shadowing",
  });
  const updated = await save(fields);
  await createSessionEvent(notifications.buildSessionEvent({
    student,
    material,
    record: updated,
    sessionId,
    phase: "started",
    occurredAt: now,
    startSummary: summary,
    endSummary: summary,
    targetPercentage: 100,
    assignmentId,
    practiceContext: context,
    practiceTrack: "shadowing",
  }));
  if (summary.percentage >= 100) return close(updated, "target_met");
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
  const normalized = shadowing.normalizeMaterial(material);
  if (!shadowing.validateCanonicalMaterial(normalized)) throw new Error("MATERIAL_INVALID");
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
  // Bind the time session to that same mode-specific thread so a long first
  // unit cannot create a second bell/email thread at the 60-second flush.
  let progress;
  if (mode === "shadowing") {
    progress = await loadShadowingProgress(student, material, true);
    if (progress.notification_session_status !== "active" || !progress.notification_session_id) {
      progress = await refreshShadowingNotification(student, material, progress, null);
    }
  } else {
    progress = await loadBestRecord(student, material);
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
  }
  if (progress.notification_session_status !== "active" || !progress.notification_session_id) return session;
  return saveActivitySession(session, { notification_session_id: progress.notification_session_id, updated_at: now });
}

async function closeActivityNotification(student, material, session, reason, now) {
  if (!session.notification_session_id) return;
  const mode = safeListeningMode(session.practice_mode) || "dictation";
  const progress = mode === "shadowing"
    ? await loadShadowingProgress(student, material, false)
    : await loadBestRecord(student, material);
  const summary = mode === "shadowing"
    ? shadowingSessionSummary(progress)
    : recordNotificationSummary(progress, null, material);
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
  if (mode === "shadowing") {
    await db.collection(SHADOW_PROGRESS).doc(progress._id || progress.progress_id).update(fields);
  } else {
    await saveNotificationOnProgress(student, material, progress, fields);
  }
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
  const normalized = shadowing.normalizeMaterial(material);
  if (!shadowing.validateCanonicalMaterial(normalized)) throw new Error("MATERIAL_INVALID");
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
    const normalized = shadowing.normalizeMaterial(material);
    const previewProgress = shadowing.createProgress(normalized, {
      progress_id: null,
      student_uid: profile.auth_uid,
      reveal_threshold: 1,
    });
    Object.keys(previewProgress.segment_states || {}).forEach((segmentId) => {
      previewProgress.segment_states[segmentId].transcript_revealed = true;
    });
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
      preferred_mode: safeListeningMode(event.mode) || "dictation",
      tracks: {
        dictation: { enabled: normalized.tracks.dictation.enabled, revision: normalized.content_revision, segment_count: shadowing.trainingSegments(normalized, "dictation").length },
        shadowing: { enabled: normalized.tracks.shadowing.enabled, revision: normalized.content_revision, segment_count: shadowing.trainingSegments(normalized, "shadowing").length },
      },
      shadowing_progress: shadowingProgressResponse(material, previewProgress),
      shadowing_segments: shadowingTrackResponse(material, previewProgress, true),
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
  return shadowingBootstrap(student, event, set, material, base);
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
    LISTENING_MODE_INVALID: "Choose Dictation or Shadowing.",
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
    LISTENING_TRACK_INVALID: "This Listening track is unavailable.",
    LISTENING_TRACK_DISABLED: "This Listening track is not enabled for this material.",
    LISTENING_TRACK_NOT_ASSIGNED: "This Listening track is not part of the assignment.",
    SHADOWING_SEGMENT_NOT_FOUND: "This Shadowing segment is unavailable.",
    SHADOWING_REFERENCE_INVALID: "This Shadowing segment cannot be scored yet.",
    SHADOWING_LISTEN_REQUIRED: "Listen to the complete line before recording it.",
    SHADOWING_TAKE_REQUIRED: "Record a scored take before moving this line to To Improve.",
    SHADOWING_TAKE_IN_FLIGHT: "Finish the current recording before starting another.",
    SCORING_POLICY_NOT_APPROVED: "Shadowing scoring is temporarily unavailable.",
    SCORING_NOT_AVAILABLE: "Shadowing scoring is temporarily unavailable.",
    SHADOWING_PROVIDER_FAILED: "Shadowing scoring could not be completed. Please try another take.",
    SHADOWING_OUTCOME_UNKNOWN: "The recording result is being checked. Please do not retry this take.",
    COMPLETE_PLAY_TOKEN_REQUIRED: "The listening playback could not be verified.",
    COMPLETE_PLAY_TOKEN_INVALID: "Start the line with Listen before completing it.",
    COMPLETE_PLAY_TOKEN_EXPIRED: "That listening play expired. Please listen again.",
    COMPLETE_PLAY_TOO_EARLY: "Listen to the complete line before continuing.",
    REVEAL_THRESHOLD_INVALID: "Choose a valid transcript reveal setting.",
    SHADOWING_UPLOAD_PATH_INVALID: "This recording upload does not belong to the current take.",
    SHADOWING_TAKE_EXPIRED: "This recording upload has expired. Please record again.",
    SHADOWING_TAKE_NOT_FOUND: "This recording is unavailable.",
    SHADOWING_TAKE_NOT_ACTIVE: "This recording is no longer accepting audio.",
    SCORING_POLICY_CHANGED: "Shadowing scoring was updated. Please record a new take.",
    AUDIO_WAV_INVALID: "Recordings must be valid WAV audio.",
    AUDIO_FORMAT_INVALID: "Use a mono 16 kHz 16-bit WAV recording.",
    AUDIO_TOO_LONG: "This recording is too long for the line.",
    AUDIO_TOO_SHORT: "This recording is too short to score.",
    AUDIO_SILENT: "No clear speech was detected in this recording.",
    AUDIO_CLIPPED: "The recording is distorted. Please try again.",
    AUDIO_TOO_LARGE: "This recording is too large.",
    WAV_NOT_WAV: "Recordings must be WAV audio.",
    WAV_FORMAT_UNSUPPORTED: "Use a mono 16 kHz 16-bit WAV recording.",
    WAV_DURATION_INVALID: "This recording duration is not valid for the segment.",
    WAV_TOO_SILENT: "No clear speech was detected in this recording.",
    WAV_CLIPPED: "The recording is distorted. Please try again.",
    WAV_TOO_LARGE: "This recording is too large.",
    SHADOWING_SEGMENT_QUOTA: "This segment has reached its short-term scoring limit.",
    SHADOWING_HOURLY_QUOTA: "You have reached the hourly Shadowing scoring limit.",
    SHADOWING_DAILY_QUOTA: "You have reached today's Shadowing scoring limit.",
    SHADOWING_GLOBAL_QUOTA: "Shadowing scoring is busy. Please try again later.",
    SHADOWING_RATE_LIMITED: "Please wait a moment before sending another Shadowing take.",
  };
  return { success: false, code, message: messages[code] || "Unable to continue this listening practice." };
}

exports.main = async (event = {}) => {
  try {
    const profile = await getAuthenticatedProfile();
    const action = String(event.action || "bootstrap");
    if (action === "listCatalog") return await listCatalog(profile);
    if (action === "setModePreference") return await setModePreference(profile, event);
    const { set, material } = await loadMaterial(event);
    // Listening is one self-study surface. Apply the boundary once before any
    // material action so stale or forged Assignment URLs cannot reach grading,
    // notifications, recording, replay, or learning-time writes.
    if (profile.role === "student" && event.assignment_id) throw new Error("LISTENING_NOT_ASSIGNABLE");
    if (action === "startLearningActivity") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return startLearningActivity(profile, event, set, material);
    }
    if (action === "recordLearningActivity") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return recordLearningActivity(profile, event, set, material);
    }
    if (action === "pauseLearningActivity") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return pauseLearningActivity(profile, event, set, material);
    }
    if (action === "closeLearningActivity") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return closeLearningActivity(profile, event, set, material);
    }
    if (action === "bootstrap" || action === "warm") return bootstrap(profile, event, set, material);
    if (action === "getTrack" || action === "track") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return getTrack(profile, event, material);
    }
    if (action === "setRevealThreshold") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return setRevealThreshold(profile, event, material);
    }
    if (action === "revealShadowingTranscript") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return revealShadowingTranscript(profile, event, material);
    }
    if (action === "startListen" || action === "startCompleteListen") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return startCompleteListen(profile, event, material);
    }
    if (action === "completeListen") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return recordCompleteListen(profile, event, material);
    }
    if (action === "reserveShadowingTake" || action === "reserve_take") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return reserveShadowingTake(profile, event, material);
    }
    if (action === "finishShadowingTake" || action === "finish_take") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return finishShadowingTake(profile, event, material);
    }
    if (action === "registerShadowingUpload" || action === "register_upload") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return registerShadowingUpload(profile, event, material);
    }
    if (action === "cancelShadowingTake" || action === "cancel_take") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return cancelShadowingTake(profile, event, material);
    }
    if (action === "getShadowingTake" || action === "take") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return getShadowingTake(profile, event, material);
    }
    if (action === "continueShadowingSegment" || action === "continue_segment") {
      if (profile.role !== "student") throw new Error("STUDENT_REQUIRED");
      return continueShadowingSegment(profile, event, material);
    }
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
  shadowingProgressId,
  safeShadowingProgress,
  shadowingTrackResponse,
  shadowingProgressResponse,
  takePath,
  shadowingMaxDurationSeconds,
  shadowingMaxBytes,
  safeShadowingResult,
  shadowingReference,
};
