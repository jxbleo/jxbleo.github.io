"use strict";

const TIME_ZONE = "Asia/Shanghai";
const DAY_SECONDS = 86400;

function dateValue(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dayKey(value) {
  const date = dateValue(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = {};
  parts.forEach((part) => { if (part.type !== "literal") values[part.type] = part.value; });
  return values.year && values.month && values.day ? `${values.year}-${values.month}-${values.day}` : "";
}

function shanghaiMidnight(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  if (!match) return null;
  // Shanghai is UTC+08:00 and has no DST. Keep this explicit so server-side
  // aggregation cannot depend on the CloudBase function host timezone.
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - 8 * 3600 * 1000;
}

function splitSeconds(start, end) {
  const first = dateValue(start);
  const last = dateValue(end);
  if (!first || !last || last.getTime() <= first.getTime()) return [];
  const output = [];
  let cursor = first.getTime();
  const finish = last.getTime();
  while (cursor < finish && output.length < 4) {
    const key = dayKey(new Date(cursor));
    const midnight = shanghaiMidnight(key);
    let boundary = finish;
    if (midnight != null) {
      boundary = midnight + 86400000;
      while (boundary <= cursor) boundary += 86400000;
    }
    const endMs = Math.min(finish, boundary);
    const seconds = Math.max(0, Math.floor((endMs - cursor) / 1000));
    if (seconds) output.push({ date: key, start_ms: cursor, end_ms: endMs, seconds });
    cursor = endMs;
  }
  return output;
}

function mergeDailyBuckets(sessions, options = {}) {
  const totals = {};
  (sessions || []).forEach((session) => {
    const buckets = session && session.daily_seconds;
    if (buckets && typeof buckets === "object") {
      Object.keys(buckets).forEach((key) => {
        const value = Math.max(0, Math.floor(Number(buckets[key]) || 0));
        if (value) totals[key] = (totals[key] || 0) + value;
      });
      return;
    }
    const seconds = Math.max(0, Math.floor(Number(session && session.effective_seconds) || 0));
    if (seconds) {
      const key = dayKey(session.last_effective_at || session.started_at);
      if (key) totals[key] = (totals[key] || 0) + seconds;
    }
  });
  if (options.minSeconds != null) Object.keys(totals).forEach((key) => { if (totals[key] < Number(options.minSeconds)) delete totals[key]; });
  return totals;
}

function aggregateActivities(sessions) {
  const rows = new Map();
  (sessions || []).forEach((session) => {
    const materialId = String(session && (session.material_id || session.set_id) || "").trim();
    const mode = ["dictation", "shadowing"].includes(String(session && session.practice_mode || "")) ? String(session.practice_mode) : "";
    if (!materialId || !mode) return;
    const buckets = mergeDailyBuckets([session]);
    Object.keys(buckets).forEach((date) => {
      const key = `${date}::${materialId}::${mode}`;
      const current = rows.get(key) || { date, material_id: materialId, set_id: String(session.set_id || materialId), mode, effective_seconds: 0 };
      current.effective_seconds += buckets[date];
      rows.set(key, current);
    });
  });
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.material_id.localeCompare(b.material_id) || a.mode.localeCompare(b.mode));
}

function formatEffectiveTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!value) return "0 min";
  if (value < 60) return "<1 min";
  return `${Math.max(1, Math.round(value / 60))} min`;
}

module.exports = { TIME_ZONE, DAY_SECONDS, dayKey, shanghaiMidnight, splitSeconds, mergeDailyBuckets, aggregateActivities, formatEffectiveTime };
