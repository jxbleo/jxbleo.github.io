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
const RESOURCE_KEY = "dse-topic-bank-2012-2026";
const TITLE = "HKDSE 英文写作与口语全话题备考库（2012–2026）";
const CHUNK_SIZE = 96000;

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : String(process.argv[index + 1] || "").trim();
}

function sourcePath() {
  return path.resolve(
    argumentValue("--source") ||
    process.env.MRCAT_DSE_TOPIC_BANK_SOURCE ||
    ""
  );
}

function splitIntoChunks(value) {
  const chunks = [];
  for (let index = 0; index < value.length; index += CHUNK_SIZE) {
    chunks.push(value.slice(index, index + CHUNK_SIZE));
  }
  return chunks;
}

function main() {
  const inputPath = sourcePath();
  if (!inputPath || inputPath === path.parse(inputPath).root || !fs.existsSync(inputPath)) {
    console.error("Pass the local full report with --source /path/to/report.html.");
    process.exit(1);
  }

  const html = fs.readFileSync(inputPath, "utf8");
  if (!html.includes("HKDSE") || !html.includes("data-artifact-block-id=\"topic-overview-block\"")) {
    console.error("The source does not look like the reviewed HKDSE topic-bank HTML.");
    process.exit(1);
  }

  const sourceBuffer = Buffer.from(html, "utf8");
  const compressed = zlib.gzipSync(sourceBuffer, { level: 9 });
  const chunks = splitIntoChunks(compressed.toString("base64"));
  const moduleValue = {
    resources: {
      [RESOURCE_KEY]: {
        title: TITLE,
        mime_type: "text/html; charset=utf-8",
        encoding: "gzip-base64",
        source_bytes: sourceBuffer.length,
        compressed_bytes: compressed.length,
        sha256: crypto.createHash("sha256").update(sourceBuffer).digest("hex"),
        chunks,
      },
    },
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `module.exports = ${JSON.stringify(moduleValue)};\n`);
  console.log(`Prepared ${RESOURCE_KEY}: ${chunks.length} protected chunks.`);
  console.log("The generated payload is ignored by Git and must only enter the CloudBase deployment ZIP.");
}

main();
