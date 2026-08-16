#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  node scripts/import-intensive-listening.js <material.json> [--set-id <IL-ID>] [--title <title>] [--audio-src <public/path.mp3>] [--content-version <version>]

The JSON may be an array of transcript records or a self-contained object with
materialId, sourceSetId, title, audioSrc, contentVersion, and segments. Segment
practiceMode values are dictation, listen_only, or skip. Public content contains
metadata only; text and answers are written to ignored private source data.`);
}

function option(name, required = true) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : "";
  if (required && (!value || value.startsWith("--"))) throw new Error(`${name} is required`);
  return value || "";
}

if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const sourceArg = args[0] && !args[0].startsWith("--") ? args[0] : "";
if (!sourceArg) throw new Error("A timestamped transcript JSON path is required");
const sourcePath = path.resolve(sourceArg);
const publishedOn = option("--published-on", false);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function clockSeconds(value) {
  if (typeof value === "number") return value;
  const parts = String(value || "").trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) throw new Error(`Invalid timestamp: ${value}`);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  throw new Error(`Invalid timestamp: ${value}`);
}

function timeRange(record, index) {
  const timestamp = record.timestamp;
  let start;
  let end;
  if (typeof timestamp === "string") {
    const parts = timestamp.trim().split(/\s*(?:-->|–|—|-)\s*/, 2);
    if (parts.length !== 2) throw new Error(`Record ${index} has an invalid timestamp range`);
    start = clockSeconds(parts[0]);
    end = clockSeconds(parts[1]);
  } else {
    start = clockSeconds(record.start == null ? record.start_time : record.start);
    end = clockSeconds(record.end == null ? record.end_time : record.end);
  }
  if (start < 0 || end <= start) throw new Error(`Record ${index} must end after it starts`);
  return { start, end };
}

const LEADING = new Set(Array.from('"“‘([{'));
const TRAILING = new Set(Array.from('"”’.,!?;:…)]}—–'));

function splitSurface(raw) {
  const surface = String(raw || "").trim();
  let prefixEnd = 0;
  while (prefixEnd < surface.length && LEADING.has(surface[prefixEnd])) prefixEnd += 1;
  let suffixStart = surface.length;
  while (suffixStart > prefixEnd && TRAILING.has(surface[suffixStart - 1])) suffixStart -= 1;
  return {
    prefix: surface.slice(0, prefixEnd),
    answer: surface.slice(prefixEnd, suffixStart),
    suffix: surface.slice(suffixStart),
  };
}

function slotsForText(text, unitNumber) {
  const slots = [];
  let pendingPrefix = "";
  String(text || "").trim().split(/\s+/).forEach((surface) => {
    const split = splitSurface(surface);
    if (!split.answer) {
      if (slots.length) slots[slots.length - 1].suffix += split.prefix + split.suffix;
      else pendingPrefix += split.prefix + split.suffix;
      return;
    }
    slots.push({
      slot_id: `u${String(unitNumber).padStart(2, "0")}-w${String(slots.length + 1).padStart(3, "0")}`,
      prefix: pendingPrefix + split.prefix,
      suffix: split.suffix,
      answer: split.answer,
      accepted_answers: [split.answer.toLowerCase().replace(/[’‘]/g, "'")],
    });
    pendingPrefix = "";
  });
  if (pendingPrefix && slots.length) slots[slots.length - 1].suffix += pendingPrefix;
  if (!slots.length) throw new Error(`Unit ${unitNumber} has no word slots`);
  return slots;
}

const payload = readJson(sourcePath);
const setId = option("--set-id", false)
  || String(payload && (payload.materialId || payload.material_id || payload.setId || payload.set_id) || "").trim();
const title = option("--title", false) || String(payload && payload.title || "").trim();
const audioSrc = option("--audio-src", false)
  || String(payload && (payload.audioSrc || payload.audio_src) || "").trim();
const contentVersion = option("--content-version", false)
  || String(payload && (payload.contentVersion || payload.content_version) || "1").trim();
const sourceSetId = String(payload && (payload.sourceSetId || payload.source_set_id) || setId.replace(/^IL-/, "")).trim();

if (!/^IL-[A-Za-z0-9-]+$/.test(setId)) throw new Error("The material ID must start with IL- (use materialId or --set-id)");
if (!title) throw new Error("A material title is required (use title or --title)");
if (!audioSrc) throw new Error("A public audio path is required (use audioSrc or --audio-src)");
if (/^(?:https?:)?\/\//i.test(audioSrc) || audioSrc.startsWith("/")) throw new Error("audioSrc must be a same-site relative path");
const audioPath = path.join(projectRoot, audioSrc);
if (!fs.existsSync(audioPath)) throw new Error(`Audio file is missing: ${audioSrc}`);

const records = Array.isArray(payload)
  ? payload
  : ["segments", "transcript", "items", "results"].map((key) => payload && payload[key]).find(Array.isArray);
if (!records || !records.length) throw new Error("Transcript must be an array or contain a segments array");

const units = records.map((record, index) => {
  if (!record || typeof record !== "object") throw new Error(`Record ${index + 1} must be an object`);
  const text = String(record.text == null ? record.transcript || "" : record.text).trim();
  if (!text) throw new Error(`Record ${index + 1} has no text`);
  const range = timeRange(record, index + 1);
  let practiceMode = String(record.practiceMode || record.practice_mode || "dictation").trim().toLowerCase();
  if (!["dictation", "listen_only", "skip"].includes(practiceMode)) {
    throw new Error(`Record ${index + 1} has unsupported practiceMode: ${practiceMode}`);
  }
  const slots = practiceMode === "dictation" ? slotsForText(text, index + 1) : [];
  const providedPositions = record.providedWordPositions || record.provided_word_positions || [];
  if (!Array.isArray(providedPositions)) throw new Error(`Record ${index + 1} providedWordPositions must be an array`);
  const uniqueProvided = [...new Set(providedPositions.map(Number))];
  uniqueProvided.forEach((position) => {
    if (!Number.isInteger(position) || position < 1 || position > slots.length) {
      throw new Error(`Record ${index + 1} has invalid provided word position: ${position}`);
    }
    slots[position - 1].spelling_requirement = "provided";
  });
  if (slots.length && slots.every((slot) => slot.spelling_requirement === "provided")) {
    practiceMode = "listen_only";
  }
  return {
    unit_id: `unit-${String(index + 1).padStart(2, "0")}`,
    speaker: String(record.speaker || record.speaker_name || "").trim(),
    text,
    start_seconds: range.start,
    end_seconds: range.end,
    practice_mode: practiceMode,
    slots,
  };
});

const dictationUnits = units.filter((unit) => unit.practice_mode === "dictation");
if (!dictationUnits.length) throw new Error("The material must contain at least one dictation segment");

const material = {
  material_id: setId,
  set_id: setId,
  source_set_id: sourceSetId,
  title,
  audio_src: audioSrc,
  content_version: contentVersion,
  policy_revision: Number(payload && (payload.policyRevision || payload.policy_revision)) || 1,
  visible: true,
  source_format: "timestamped_transcript",
  segmentation_policy: "source_segments",
  units,
};

const metaPath = path.join(projectRoot, "content", "intensive-listening", `${setId}.json`);
const existingMeta = fs.existsSync(metaPath) ? readJson(metaPath) : {};

const meta = {
  id: setId,
  sectionId: "intensive-listening",
  title,
  href: `intensive-listening.html?set=${encodeURIComponent(setId)}`,
  publishedOn: publishedOn || String(payload && payload.publishedOn || existingMeta.publishedOn || "") || new Date().toISOString().slice(0, 10),
  topic: "BBC 6 Minute English",
  tags: ["Intensive Listening", "BBC"],
  note: `${dictationUnits.length} dictation units`,
  catalogVisible: false,
  visible: true,
};

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function upsertJsonLine(filePath, keyField, record) {
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(JSON.parse)
    : [];
  const index = existing.findIndex((item) => String(item[keyField] || "") === String(record[keyField]));
  if (index >= 0) existing[index] = record;
  else existing.push(record);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, existing.map((item) => JSON.stringify(item)).join("\n") + "\n");
}

const privatePath = path.join(projectRoot, ".cloudbase-private", "source", "intensive-listening", `${setId}.json`);
writeJson(metaPath, meta);
writeJson(privatePath, material);

const linkedBbcId = sourceSetId || setId.replace(/^IL-/, "");
const linkedBbcPaths = [
  path.join(projectRoot, "content", "bbc-six-minute-english", `${linkedBbcId}.json`),
  path.join(projectRoot, "data", `${linkedBbcId}.json`),
];
const linkedBbcFiles = linkedBbcPaths.filter((filePath) => fs.existsSync(filePath));
linkedBbcFiles.forEach((filePath) => {
  const linkedBbc = readJson(filePath);
  linkedBbc.intensiveListeningSetId = setId;
  writeJson(filePath, linkedBbc);
});

const setRecord = {
  set_id: setId,
  section_id: "intensive-listening",
  title,
  type: "intensive-listening",
  course: "Intensive Listening",
  link: meta.href,
  difficulty: "",
  estimated_minutes: Math.max(1, Math.ceil(units[units.length - 1].end_seconds / 60)),
  passing_percentage: 100,
  mastery_percentage: 100,
  feedback_policy: "always",
  visible: true,
};
upsertJsonLine(path.join(projectRoot, ".cloudbase-private", "import", "sets-cloudbase.json"), "set_id", setRecord);
upsertJsonLine(
  path.join(projectRoot, ".cloudbase-private", "import", "intensive-listening-materials-cloudbase.json"),
  "material_id",
  material
);

const slotCount = dictationUnits.reduce((sum, unit) => sum + unit.slots.length, 0);
const modeCounts = units.reduce((counts, unit) => {
  counts[unit.practice_mode] += 1;
  return counts;
}, { dictation: 0, listen_only: 0, skip: 0 });
console.log(`Imported ${setId}: ${modeCounts.dictation} dictation, ${modeCounts.listen_only} listen-only, ${modeCounts.skip} skipped, ${slotCount} private word slots`);
console.log(`Public metadata: ${path.relative(projectRoot, metaPath)}`);
console.log(`Private source: ${path.relative(projectRoot, privatePath)}`);
if (linkedBbcFiles.length) console.log(`Linked BBC practice: ${linkedBbcId}`);
console.log("Private CloudBase import rows updated incrementally");
