#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.resolve(__dirname, "..");
const outputPath = path.join(
  root,
  "cloudfunctions",
  "getProtectedResource",
  "protected-payloads.private.js"
);
const CHUNK_SIZE = 96000;

function validateTopicBankHtml(html) {
  if (!html.includes('data-topic-bank-version="content-development-v1"')) return false;
  if (!html.includes('data-topic-bank-delivery="protected-srcdoc"') ||
      !html.includes('<title>DSE英文核心话题库</title>') ||
      !html.includes('<meta name="robots" content="noindex,nofollow,noarchive">') ||
      !html.includes('<meta name="referrer" content="no-referrer">')) return false;
  // Full text belongs in the authorized opaque-origin iframe. The public
  // reader supplies its shared toolbar; no inner links may escape the report.
  if (/data-share-header|data-resource-topbar|<base\b|<iframe\b|<form\b/i.test(html) ||
      /<(?:script|img|link)\b[^>]*\b(?:src|href)\s*=/i.test(html)) return false;
  const hrefs = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(match => match[1]);
  if (!hrefs.length || hrefs.some(href => !/^#[A-Za-z0-9_-]+$/.test(href))) return false;
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length || hrefs.some(href => !uniqueIds.has(href.slice(1)))) return false;
  const themes = [...html.matchAll(/<article class="topic" id="(topic-\d{2})"/g)];
  if (themes.length !== 20 || themes.some((match, index) => match[1] !== 'topic-' + String(index + 1).padStart(2, '0'))) return false;
  const subtopics = html.split('<section class="subtopic" ').slice(1);
  if (subtopics.length !== 100) return false;
  for (const [index, subtopic] of subtopics.entries()) {
    const id = 'topic-' + String(Math.floor(index / 5) + 1).padStart(2, '0') + '-sub-' + (index % 5 + 1);
    if (!subtopic.startsWith(`id="${id}" `) || !subtopic.includes(`class="development" id="${id}-development"`)) return false;
    const viewpoints = subtopic.match(/<ol class="viewpoints"[^>]*>([\s\S]*?)<\/ol>/);
    const tasks = subtopic.match(/<ol class="transfer-tasks">([\s\S]*?)<\/ol>/);
    if (!viewpoints || (viewpoints[1].match(/<li>/g) || []).length !== 8 ||
        !tasks || (tasks[1].match(/<li>/g) || []).length !== 3 ||
        (subtopic.match(/<section class="development"/g) || []).length !== 1 ||
        (subtopic.match(/<div class="chain">/g) || []).length !== 2 ||
        (subtopic.match(/<article class="option">/g) || []).length !== 2 ||
        !subtopic.includes('<span class="label">假设情境</span>')) return false;
  }
  return true;
}

const RESOURCE_DEFINITIONS = {
  "dse-topic-bank-2012-2026": {
    title: "DSE英文核心话题库",
    sourceEnv: "MRCAT_DSE_TOPIC_BANK_SOURCE",
    allowedRoles: ["student", "teacher"],
    validate(html) {
      return validateTopicBankHtml(html) ||
        (!html.includes('data-topic-bank-version=') && html.includes("HKDSE") && html.includes('data-artifact-block-id="topic-overview-block"'));
    },
    error: "The source does not look like the reviewed HKDSE topic-bank HTML.",
  },
  "hk8-dse-jupas-weighting-2026-27": {
    title: "港八大 DSE 选科与 JUPAS 专业加权研究报告（2026/27 入学）",
    sourceEnv: "MRCAT_JUPAS_REPORT_SOURCE",
    allowedRoles: ["student"],
    validate(html) {
      return html.includes("港八大") &&
        html.includes("JUPAS") &&
        html.includes('data-artifact-block-id="english_math_table"');
    },
    error: "The source does not look like the reviewed HK8 JUPAS weighting report HTML.",
  },
};

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : String(process.argv[index + 1] || "").trim();
}

function resourceKey() {
  return argumentValue("--resource") || "dse-topic-bank-2012-2026";
}

function sourcePath(definition) {
  return path.resolve(
    argumentValue("--source") ||
    process.env[definition.sourceEnv] ||
    ""
  );
}

function existingResources() {
  if (!fs.existsSync(outputPath)) return {};
  delete require.cache[require.resolve(outputPath)];
  const current = require(outputPath);
  return current && current.resources && typeof current.resources === "object"
    ? current.resources
    : {};
}

function splitIntoChunks(value) {
  const chunks = [];
  for (let index = 0; index < value.length; index += CHUNK_SIZE) {
    chunks.push(value.slice(index, index + CHUNK_SIZE));
  }
  return chunks;
}

function main() {
  const key = resourceKey();
  const definition = RESOURCE_DEFINITIONS[key];
  if (!definition) {
    console.error(`Unknown protected resource: ${key}`);
    process.exit(1);
  }

  const inputPath = sourcePath(definition);
  if (!inputPath || inputPath === path.parse(inputPath).root || !fs.existsSync(inputPath)) {
    console.error("Pass the local full report with --source /path/to/report.html.");
    process.exit(1);
  }

  const html = fs.readFileSync(inputPath, "utf8");
  if (!definition.validate(html)) {
    console.error(definition.error);
    process.exit(1);
  }

  const sourceBuffer = Buffer.from(html, "utf8");
  const compressed = zlib.gzipSync(sourceBuffer, { level: 9 });
  const chunks = splitIntoChunks(compressed.toString("base64"));
  const resources = existingResources();
  resources[key] = {
    title: definition.title,
    mime_type: "text/html; charset=utf-8",
    encoding: "gzip-base64",
    allowed_roles: definition.allowedRoles,
    source_bytes: sourceBuffer.length,
    compressed_bytes: compressed.length,
    sha256: crypto.createHash("sha256").update(sourceBuffer).digest("hex"),
    chunks,
  };
  const moduleValue = { resources };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `module.exports = ${JSON.stringify(moduleValue)};\n`);
  console.log(`Prepared ${key}: ${chunks.length} protected chunks.`);
  console.log("The generated payload is ignored by Git and must only enter the CloudBase deployment ZIP.");
}

if (require.main === module) main();
module.exports = { validateTopicBankHtml };
