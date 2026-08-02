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

const RESOURCE_DEFINITIONS = {
  "dse-topic-bank-2012-2026": {
    title: "HKDSE 英文写作与口语全话题备考库（2012–2026）",
    sourceEnv: "MRCAT_DSE_TOPIC_BANK_SOURCE",
    allowedRoles: ["student", "teacher"],
    validate(html) {
      return html.includes("HKDSE") && html.includes('data-artifact-block-id="topic-overview-block"');
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

main();
