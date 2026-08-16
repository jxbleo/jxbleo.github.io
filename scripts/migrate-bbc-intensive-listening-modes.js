#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const service = require("../cloudfunctions/intensiveListening/service");
const root = path.resolve(__dirname, "..");
const inputDir = path.join(root, ".cloudbase-private/source/intensive-listening");
const outputOption = process.argv.find((value) => value.startsWith("--output-dir="));
const outputDir = outputOption ? path.resolve(outputOption.slice(13)) : path.join(root, ".cloudbase-private/source-json/bbc");
const transcriptOption = process.argv.find((value) => value.startsWith("--transcript-dir="));
const transcriptDir = transcriptOption ? path.resolve(transcriptOption.slice(17)) : "";
const bumpVersion = process.argv.includes("--bump-version");
const compact = (value) => String(value || "").replace(/\s+/g, " ").trim();

function opening(segment, index) {
  if (index > 7) return false;
  const text = compact(segment.text);
  return /^(?:six|6)\s*minute(?:s)?\s+english\.?$/i.test(text)
    || /^(?:from\s+)?b\s*bc\s+learning\s*english/i.test(text)
    || /^(?:from\s+)?bbclearningenglish/i.test(text)
    || /^com\.?$/i.test(text)
    || /\bhello,?\s+(?:welcome to|this is)\s+(?:six|6)\s+minute/i.test(text)
    || /^(?:and\s+)?i['’]?m\s+[a-z]+\.?$/i.test(text)
    || /^(?:six|6)\s*minute(?:s)?\s+english\s+from\s+b\s*bc/i.test(text);
}

function promotion(segment) {
  const text = compact(segment.text);
  if (/\bfeel uncomfortable\b|\bdeath and trauma\b|\bwon['’]?t go into detail\b/i.test(text)) return false;
  return /\b(?:our|the)\s+website\b/i.test(text)
    || /\bbbclearningenglish\b/i.test(text)
    || /\bb\s*bc\s+learning\s*english\s+dot\s+com\b/i.test(text)
    || /\b(?:find|practice|available|free|plus|along with|test)[^.!?]{0,100}\b(?:quiz|worksheet)\b/i.test(text)
    || /\btopic page\b|\bfull vocabulary list\b/i.test(text)
    || /\btest what you['’]?ve learned\b/i.test(text)
    || /\bfind all this episode['’]?s vocabulary along with a transcript\b/i.test(text)
    || /\bfind a (?:free )?transcript (?:for|including)\b/i.test(text)
    || /\bcheck the transcript for this episode\b/i.test(text)
    || /\bmore episodes and learning activities\b|\bloads more activities\b/i.test(text);
}

function tailStart(segments) {
  for (let index = Math.max(0, segments.length - 20); index < segments.length; index += 1) {
    const text = compact(segments[index].text);
    if (/\bonce again,? (?:our )?six minutes are up\b/i.test(text)
      || /\bthat['’]?s it for this episode\b/i.test(text)
      || /\bokay,? once again (?:our )?six minutes are up\b/i.test(text)
      || /\bthanks for joining us\b/i.test(text)
      || /\bsee you\b.*\bgoodbye\b/i.test(text)
      || /\bgoodbye for now\b|\bbut now it['’]?s goodbye\b/i.test(text)) return index;
  }
  return segments.length;
}

function classify(material) {
  const source = service.sourceMaterial(material);
  const tail = tailStart(source.segments);
  const currentVersion = Math.max(1, Number(material.content_version) || 1);
  source.contentVersion = String(bumpVersion ? currentVersion + 1 : currentVersion);
  source.policyRevision = 1;
  source.segments.forEach((segment, index) => {
    segment.practiceMode = opening(segment, index) || promotion(segment) || index >= tail ? "skip" : "dictation";
  });
  source.segments.forEach((segment, index) => {
    if (!/^(?:com|dot com)\.?$/i.test(compact(segment.text))) return;
    const previous = source.segments[index - 1];
    const next = source.segments[index + 1];
    if ((previous && previous.practiceMode === "skip") || (next && next.practiceMode === "skip")) segment.practiceMode = "skip";
  });
  source.segments.forEach((segment, index) => {
    const next = source.segments[index + 1];
    if (next && next.practiceMode === "skip" && /\b(?:remember|as usual|you can find|all of which)\b/i.test(compact(segment.text))) {
      segment.practiceMode = "skip";
    }
  });
  return source;
}

fs.mkdirSync(outputDir, { recursive: true });
if (transcriptDir) fs.mkdirSync(transcriptDir, { recursive: true });
const files = fs.readdirSync(inputDir).filter((name) => /^IL-BBC-26.*\.json$/.test(name)).sort();
let totalSkipped = 0;
for (const fileName of files) {
  const material = JSON.parse(fs.readFileSync(path.join(inputDir, fileName), "utf8"));
  const source = classify(material);
  const skipped = source.segments.filter((segment) => segment.practiceMode === "skip");
  totalSkipped += skipped.length;
  fs.writeFileSync(path.join(outputDir, fileName), JSON.stringify(source, null, 2) + "\n");
  if (transcriptDir) {
    const lines = [`# ${source.title}`, "", `- Material: ${source.materialId}`, `- Source: ${source.sourceSetId}`, `- Content version: ${source.contentVersion}`, ""];
    source.segments.forEach((segment) => {
      lines.push(`## ${segment.timestamp} · ${segment.speaker || "Speaker"} · ${segment.practiceMode}`);
      lines.push("", segment.text, "");
    });
    fs.writeFileSync(path.join(transcriptDir, fileName.replace(/\.json$/, ".md")), lines.join("\n") + "\n");
  }
  console.log(`${fileName}: ${skipped.length} skip, ${source.segments.length - skipped.length} dictation, v${source.contentVersion}`);
  skipped.forEach((segment) => console.log(`  SKIP ${segment.timestamp} ${compact(segment.text)}`));
}
console.log(`Prepared ${files.length} materials with ${totalSkipped} skipped segments in ${outputDir}`);
