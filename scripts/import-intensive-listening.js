#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  node scripts/import-intensive-listening.js <material.json> [--set-id <IL-ID>] [--title <title>] [--audio-src <public/path.mp3>] [--content-version <version>] [--source-family <family>] [--source-label <label>] [--series-label <label>] [--published-on <YYYY-MM-DD>] [--linked-practice-set-id <set-id>]

The JSON may be an array of transcript records or a self-contained object with
materialId, sourceSetId, title, audioSrc, contentVersion, and segments. V2
objects may also contain media, transcriptRevision, and explicit tracks with
dictation and shadowing segments. Segment practiceMode values are dictation,
listen_only/context_only, or skip. Public content contains
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
const cliPublishedOn = option("--published-on", false);
const setHint = option("--set-id", false);
const existingMetaPath = path.join(projectRoot, "content", "intensive-listening", (setHint || "unknown") + ".json");
const existingMeta = setHint && fs.existsSync(existingMetaPath) ? readJson(existingMetaPath) : {};

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
    start = clockSeconds(record.start == null ? (record.start_time == null ? record.start_seconds : record.start_time) : record.start);
    end = clockSeconds(record.end == null ? (record.end_time == null ? record.end_seconds : record.end_time) : record.end);
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
const setId = setHint
  || String(payload && (payload.materialId || payload.material_id || payload.setId || payload.set_id) || "").trim();
const title = option("--title", false) || String(payload && payload.title || "").trim();
const audioSrc = option("--audio-src", false)
  || String(payload && (payload.audioSrc || payload.audio_src) || "").trim();
const contentVersion = option("--content-version", false)
  || String(payload && (payload.contentVersion || payload.content_version) || "1").trim();
const sourceSetId = String(payload && (payload.sourceSetId || payload.source_set_id) || setId.replace(/^IL-/, "")).trim();
const sourceFamilyInput = option("--source-family", false)
  || String(payload && (payload.sourceFamily || payload.source_family) || existingMeta.sourceFamily || "").trim().toLowerCase();
const sourceLabelInput = option("--source-label", false)
  || String(payload && (payload.sourceLabel || payload.source_label) || existingMeta.sourceLabel || "").trim();
const seriesLabelInput = option("--series-label", false)
  || String(payload && (payload.seriesLabel || payload.series_label) || existingMeta.seriesLabel || "").trim();
const linkedPracticeSetId = option("--linked-practice-set-id", false)
  || String(payload && (payload.linkedPracticeSetId || payload.linked_practice_set_id) || existingMeta.linkedPracticeSetId || "").trim();
let sourceFamily = sourceFamilyInput;
let sourceLabel = sourceLabelInput;
let seriesLabel = seriesLabelInput;
if (!sourceFamily && /^IL-BBC-/i.test(setId)) sourceFamily = "bbc";
if (!sourceFamily && /^(?:IL-)?C\d+-T\d+-S\d+$/i.test(setId)) sourceFamily = "ielts";
if (!sourceLabel && sourceFamily === "bbc") sourceLabel = "BBC";
if (!sourceLabel && sourceFamily === "ielts") sourceLabel = "IELTS";
if (!seriesLabel && sourceFamily === "bbc") seriesLabel = "BBC 6 Minute English";
if (!seriesLabel && sourceFamily === "ielts") seriesLabel = "IELTS Listening";
if (!sourceLabel) throw new Error("A source label is required for new material (use --source-label)");
const publishedOn = cliPublishedOn
  || String(payload && (payload.publishedOn || payload.published_on) || "").trim()
  || (() => {
    const match = setId.match(/^IL-BBC-(\d{2})(\d{2})(\d{2})$/i);
    return match ? `20${match[1]}-${match[2]}-${match[3]}` : "";
  })();

if (!/^IL-[A-Za-z0-9-]+$/.test(setId)) throw new Error("The material ID must start with IL- (use materialId or --set-id)");
if (!title) throw new Error("A material title is required (use title or --title)");
if (!audioSrc) throw new Error("A public audio path is required (use audioSrc or --audio-src)");
if (/^(?:https?:)?\/\//i.test(audioSrc) || audioSrc.startsWith("/")) throw new Error("audioSrc must be a same-site relative path");
const audioPath = path.join(projectRoot, audioSrc);
if (!fs.existsSync(audioPath)) throw new Error(`Audio file is missing: ${audioSrc}`);

const schemaVersion = Number(payload && (payload.schemaVersion || payload.schema_version)) || 1;
const sourceTracks = payload && payload.tracks && typeof payload.tracks === "object" ? payload.tracks : null;
let records = Array.isArray(payload)
  ? payload
  : ["segments", "transcript", "items", "results"].map((key) => payload && payload[key]).find(Array.isArray)
    || (sourceTracks && sourceTracks.dictation && Array.isArray(sourceTracks.dictation.segments) ? sourceTracks.dictation.segments : null);
if (!records) records = [];

const units = records.map((record, index) => {
  if (!record || typeof record !== "object") throw new Error(`Record ${index + 1} must be an object`);
  const text = String(record.text == null ? record.transcript || "" : record.text).trim();
  if (!text) throw new Error(`Record ${index + 1} has no text`);
  const range = timeRange(record, index + 1);
  let practiceMode = String(record.practiceMode || record.practice_mode || "dictation").trim().toLowerCase();
  if (!["dictation", "listen_only", "context_only", "skip"].includes(practiceMode)) {
    throw new Error(`Record ${index + 1} has unsupported practiceMode: ${practiceMode}`);
  }
  const suppliedSlots = Array.isArray(record.slots) ? record.slots : null;
  if (practiceMode === "context_only") practiceMode = "listen_only";
  const slots = practiceMode === "dictation"
    ? (suppliedSlots && suppliedSlots.length ? suppliedSlots.map((slot, slotIndex) => ({
      slot_id: String(slot.slotId || slot.slot_id || `u${String(index + 1).padStart(2, "0")}-w${String(slotIndex + 1).padStart(3, "0")}`),
      prefix: String(slot.prefix || ""), suffix: String(slot.suffix || ""), answer: String(slot.answer || slot.text || ""),
      accepted_answers: Array.isArray(slot.acceptedAnswers || slot.accepted_answers) ? (slot.acceptedAnswers || slot.accepted_answers).map(String) : [String(slot.answer || slot.text || "")],
      spelling_requirement: String(slot.spellingRequirement || slot.spelling_requirement || "required") === "provided" ? "provided" : "required",
    })) : slotsForText(text, index + 1)) : [];
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
const shadowingSegments = sourceTracks && sourceTracks.shadowing && Array.isArray(sourceTracks.shadowing.segments)
  ? sourceTracks.shadowing.segments.map((segment, index) => {
    const range = timeRange(segment, index + 1);
    const text = String(segment.text == null ? segment.transcript || "" : segment.text).trim();
    if (!text) throw new Error(`Shadowing segment ${index + 1} has no text`);
    return {
      segment_id: String(segment.segmentId || segment.segment_id || `shadow-${String(index + 1).padStart(3, "0")}`),
      speaker: String(segment.speaker || segment.speaker_name || "").trim(), text,
      start_seconds: range.start, end_seconds: range.end,
      practice_mode: String(segment.practiceMode || segment.practice_mode || "shadowing").trim().toLowerCase(),
      reference_words: Array.isArray(segment.referenceWords || segment.reference_words) ? (segment.referenceWords || segment.reference_words).map((word, wordIndex) => ({
        word_id: String(word.wordId || word.word_id || `w${String(wordIndex + 1).padStart(3, "0")}`), text: String(word.text || ""), unscored: word.unscored === true,
      })) : [],
    };
  }) : [];
if (!dictationUnits.length && !shadowingSegments.length) throw new Error("The material must contain at least one dictation or shadowing segment");

const material = {
  material_id: setId,
  set_id: setId,
  source_set_id: sourceSetId,
  source_family: sourceFamily,
  source_label: sourceLabel,
  series_label: seriesLabel,
  published_on: publishedOn,
  linked_practice_set_id: linkedPracticeSetId || null,
  title,
  audio_src: audioSrc,
  content_version: contentVersion,
  policy_revision: Number(payload && (payload.policyRevision || payload.policy_revision)) || 1,
  visible: true,
  source_format: "timestamped_transcript",
  segmentation_policy: "source_segments",
  units,
};
if (schemaVersion >= 2 || sourceTracks) {
  const dictationTrack = sourceTracks && sourceTracks.dictation || {};
  const shadowingTrack = sourceTracks && sourceTracks.shadowing || {};
  material.schema_version = 2;
  material.schemaVersion = 2;
  material.media = payload.media && typeof payload.media === "object" ? { ...payload.media } : { audio_src: audioSrc };
  material.transcript_revision = String(payload.transcriptRevision || payload.transcript_revision || "1");
  material.tracks = {
    dictation: {
      enabled: dictationTrack.enabled !== false && dictationUnits.length > 0,
      revision: String(dictationTrack.revision || "1"),
      segments: units.filter((unit) => unit.practice_mode === "dictation").map((unit) => ({ ...unit, segment_id: unit.unit_id })),
    },
    shadowing: {
      enabled: shadowingTrack.enabled !== false && shadowingSegments.length > 0,
      revision: String(shadowingTrack.revision || "1"),
      segments: shadowingSegments,
    },
  };
}

const metaPath = path.join(projectRoot, "content", "intensive-listening", `${setId}.json`);
const meta = {
  id: setId,
  sectionId: "intensive-listening",
  title,
  href: `intensive-listening.html?set=${encodeURIComponent(setId)}`,
  publishedOn: publishedOn || String(payload && payload.publishedOn || existingMeta.publishedOn || "") || new Date().toISOString().slice(0, 10),
  topic: seriesLabel,
  tags: ["Listening", sourceLabel].filter(Boolean),
  note: `${dictationUnits.length + shadowingSegments.length} listening segments`,
  sourceFamily,
  sourceLabel,
  seriesLabel,
  sourceSetId,
  linkedPracticeSetId: linkedPracticeSetId || null,
  dictationUnitCount: dictationUnits.length,
  sequenceUnitCount: units.length,
  schemaVersion: material.schema_version || 1,
  shadowingSegmentCount: shadowingSegments.length,
  trackCount: (dictationUnits.length ? 1 : 0) + (shadowingSegments.length ? 1 : 0),
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

const linkedSourceId = linkedPracticeSetId || sourceSetId || setId.replace(/^IL-/, "");
const linkedBbcId = sourceSetId || setId.replace(/^IL-/, "");
const linkedBbcPaths = sourceFamily === "bbc" ? [
  path.join(projectRoot, "content", "bbc-six-minute-english", `${linkedBbcId}.json`),
  path.join(projectRoot, "data", `${linkedBbcId}.json`),
] : [
  path.join(projectRoot, "content", "ielts-listening", `${linkedSourceId}.json`),
  path.join(projectRoot, "data", `${linkedSourceId}.json`),
];
const linkedBbcFiles = linkedBbcPaths.filter((filePath) => fs.existsSync(filePath));
linkedBbcFiles.forEach((filePath) => {
  const linkedBbc = readJson(filePath);
  if (linkedBbc && typeof linkedBbc === "object" && (sourceFamily === "bbc" || linkedPracticeSetId)) {
    linkedBbc.intensiveListeningSetId = setId;
    writeJson(filePath, linkedBbc);
  }
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
  mastery_enabled: false,
  source_family: sourceFamily,
  source_label: sourceLabel,
  series_label: seriesLabel,
  published_on: publishedOn,
  source_set_id: sourceSetId,
  linked_practice_set_id: linkedPracticeSetId || null,
  dictation_unit_count: dictationUnits.length,
  sequence_unit_count: units.length,
  schema_version: material.schema_version || 1,
  transcript_revision: material.transcript_revision || "1",
  tracks: material.tracks || null,
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
