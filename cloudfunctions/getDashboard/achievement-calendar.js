const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const DAY_MS = 24 * 60 * 60 * 1000;

function text(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function dateValue(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function shanghaiDateParts(value) {
  const timestamp = dateValue(value);
  if (!timestamp) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = {};
  parts.forEach((part) => {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  });
  return values.year && values.month && values.day ? values : null;
}

function dateKeyFromUtcCalendar(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function shanghaiDateKey(value) {
  const parts = shanghaiDateParts(value);
  return parts
    ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
    : "";
}

function achievementWindow(now = new Date()) {
  const parts = shanghaiDateParts(now);
  if (!parts) throw new Error("ACHIEVEMENT_WINDOW_INVALID");
  const today = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const mondayIndex = (today.getUTCDay() + 6) % 7;
  const start = new Date(today.getTime() - ((mondayIndex + (52 * 7)) * DAY_MS));
  const end = new Date(start.getTime() + (370 * DAY_MS));
  return {
    start_date: dateKeyFromUtcCalendar(start),
    today_date: dateKeyFromUtcCalendar(today),
    end_date: dateKeyFromUtcCalendar(end),
    query_start: new Date(now.getTime() - (380 * DAY_MS)),
  };
}

function normalizedSetValues(set) {
  return [set && set.section_id, set && set.section, set && set.type, set && set.course, set && set.category]
    .map((value) => text(value).toLowerCase().replace(/[\s_]+/g, "-"));
}

function achievementTypeForSet(set) {
  const setId = text(set && set.set_id);
  const values = normalizedSetValues(set);
  if (/^BBC-/i.test(setId) || values.some((value) => value === "bbc" || value === "bbc-six-minute-english")) {
    return "bbc";
  }
  if (/^(VOCAB|VOCABULARY)-/i.test(setId) || values.some((value) => value === "vocabulary")) {
    return "vocabulary";
  }
  return "";
}

function defaultPassingPercentage(type) {
  if (type === "vocabulary") return 90;
  if (type === "bbc") return 80;
  return 50;
}

function effectivePercentage(attempt) {
  const value = attempt && attempt.adjusted_percentage == null
    ? attempt && attempt.percentage
    : attempt && attempt.adjusted_percentage;
  const percentage = Number(value || 0);
  return Number.isFinite(percentage) ? percentage : 0;
}

function attemptPassed(attempt, set, type) {
  if (!attempt) return false;
  if (attempt.adjusted_passed === true || (attempt.adjusted_passed == null && attempt.passed === true)) return true;
  const snapshot = Number(attempt.passing_percentage);
  const setThreshold = Number(set && set.passing_percentage);
  const threshold = Number.isFinite(snapshot)
    ? snapshot
    : Number.isFinite(setThreshold) ? setThreshold : defaultPassingPercentage(type);
  return effectivePercentage(attempt) >= threshold;
}

function attemptAchievementKey(attempt) {
  const assignmentId = text(attempt && attempt.assignment_id);
  const setId = text(attempt && attempt.set_id);
  return assignmentId ? `assignment:${assignmentId}` : `self-study:${setId}`;
}

function exerciseTitle(set, attempt) {
  return text(
    set && (set.title || set.name || set.display_name),
    text(attempt && (attempt.resource_title || attempt.title), text(attempt && attempt.set_id, "Completed exercise"))
  );
}

function exerciseDetail(type, attempt) {
  if (type === "bbc") return "BBC 6 Minute English";
  const mode = text(attempt && attempt.mode).toLowerCase();
  return mode.includes("cloze") ? "Vocabulary · Cloze Quiz" : "Vocabulary · Quiz";
}

function writingTitle(composition) {
  return text(composition && (composition.title || composition.prompt_title), "Writing practice");
}

function buildAchievementCalendar({ attempts = [], sets = [], compositions = [], now = new Date() } = {}) {
  const window = achievementWindow(now);
  const setMap = new Map(sets.map((set) => [text(set && set.set_id), set]));
  const firstPassByKey = new Map();

  attempts.forEach((attempt) => {
    if (!attempt || text(attempt.mode).toLowerCase() === "vocabulary_practice_timed") return;
    const set = setMap.get(text(attempt.set_id)) || { set_id: attempt.set_id };
    const type = achievementTypeForSet(set);
    if (!type || !attemptPassed(attempt, set, type)) return;
    const timestamp = dateValue(attempt.submitted_at);
    if (!timestamp) return;
    const key = attemptAchievementKey(attempt);
    const current = firstPassByKey.get(key);
    if (!current || timestamp < dateValue(current.submitted_at)) firstPassByKey.set(key, attempt);
  });

  const items = [];
  firstPassByKey.forEach((attempt, achievementKey) => {
    const set = setMap.get(text(attempt.set_id)) || { set_id: attempt.set_id };
    const type = achievementTypeForSet(set);
    const percentage = Math.round(effectivePercentage(attempt) * 10) / 10;
    items.push({
      achievement_key: achievementKey,
      date: shanghaiDateKey(attempt.submitted_at),
      type,
      title: exerciseTitle(set, attempt),
      detail: exerciseDetail(type, attempt),
      result: `${percentage}% PASS`,
      percentage,
      completed_at: attempt.submitted_at,
    });
  });

  compositions.forEach((composition) => {
    if (!composition || text(composition.status).toLowerCase() !== "completed" || !dateValue(composition.completed_at)) return;
    items.push({
      achievement_key: `writing:${text(composition.composition_id || composition._id)}`,
      date: shanghaiDateKey(composition.completed_at),
      type: "writing",
      title: writingTitle(composition),
      detail: "Writing · Correction completed",
      result: "CORRECTED",
      percentage: null,
      completed_at: composition.completed_at,
    });
  });

  const dayMap = new Map();
  items.forEach((item) => {
    if (!item.date || item.date < window.start_date || item.date > window.today_date) return;
    if (!dayMap.has(item.date)) dayMap.set(item.date, []);
    dayMap.get(item.date).push(item);
  });

  const days = [...dayMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, dayItems]) => ({
    date,
    count: dayItems.length,
    items: dayItems.sort((left, right) => dateValue(left.completed_at) - dateValue(right.completed_at)).map((item) => ({
      achievement_key: item.achievement_key,
      type: item.type,
      title: item.title,
      detail: item.detail,
      result: item.result,
      percentage: item.percentage,
    })),
  }));

  return {
    start_date: window.start_date,
    today_date: window.today_date,
    end_date: window.end_date,
    total_achievements: days.reduce((sum, day) => sum + day.count, 0),
    active_days: days.length,
    days,
  };
}

module.exports = {
  achievementTypeForSet,
  achievementWindow,
  attemptPassed,
  buildAchievementCalendar,
  shanghaiDateKey,
};
