#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  node scripts/import-intensive-listening.js <transcript.json> --set-id <IL-ID> --title <title> --audio-src <public/path.mp3> [--content-version <version>]

Each timestamped transcript record becomes one final Intensive Listening unit.
The public content record contains metadata only; words and accepted answers are
written to ignored .cloudbase-private/source/intensive-listening/.`);
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
const setId = option("--set-id");
const title = option("--title");
const audioSrc = option("--audio-src");
const publishedOn = option("--published-on", false);
const contentVersion = option("--content-version", false) || "1";

if (!/^IL-[A-Za-z0-9-]+$/.test(setId)) throw new Error("--set-id must start with IL-");
if (/^(?:https?:)?\/\//i.test(audioSrc) || audioSrc.startsWith("/")) throw new Error("--audio-src must be a same-site relative path");
const audioPath = path.join(projectRoot, audioSrc);
if (!fs.existsSync(audioPath)) throw new Error(`Audio file is missing: ${audioSrc}`);

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
const records = Array.isArray(payload)
  ? payload
  : ["segments", "transcript", "items", "results"].map((key) => payload && payload[key]).find(Array.isArray);
if (!records || !records.length) throw new Error("Transcript must be an array or contain a segments array");

const units = records.map((record, index) => {
  if (!record || typeof record !== "object") throw new Error(`Record ${index + 1} must be an object`);
  const text = String(record.text == null ? record.transcript || "" : record.text).trim();
  if (!text) throw new Error(`Record ${index + 1} has no text`);
  const range = timeRange(record, index + 1);
  return {
    unit_id: `unit-${String(index + 1).padStart(2, "0")}`,
    speaker: String(record.speaker || record.speaker_name || "").trim(),
    text,
    start_seconds: range.start,
    end_seconds: range.end,
    slots: slotsForText(text, index + 1),
  };
});

const material = {
  material_id: setId,
  set_id: setId,
  title,
  audio_src: audioSrc,
  content_version: contentVersion,
  visible: true,
  source_format: "timestamped_transcript",
  segmentation_policy: "source_segments",
  units,
};

const meta = {
  id: setId,
  sectionId: "intensive-listening",
  title,
  href: `intensive-listening.html?set=${encodeURIComponent(setId)}`,
  publishedOn: publishedOn || new Date().toISOString().slice(0, 10),
  topic: "BBC 6 Minute English",
  tags: ["Intensive Listening", "BBC"],
  note: `${units.length} listening units`,
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

const metaPath = path.join(projectRoot, "content", "intensive-listening", `${setId}.json`);
const privatePath = path.join(projectRoot, ".cloudbase-private", "source", "intensive-listening", `${setId}.json`);
writeJson(metaPath, meta);
writeJson(privatePath, material);

const linkedBbcId = setId.replace(/^IL-/, "");
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

const slotCount = units.reduce((sum, unit) => sum + unit.slots.length, 0);
console.log(`Imported ${setId}: ${units.length} units, ${slotCount} private word slots`);
console.log(`Public metadata: ${path.relative(projectRoot, metaPath)}`);
console.log(`Private source: ${path.relative(projectRoot, privatePath)}`);
if (linkedBbcFiles.length) console.log(`Linked BBC practice: ${linkedBbcId}`);
console.log("Private CloudBase import rows updated incrementally");
