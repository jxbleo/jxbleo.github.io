#!/usr/bin/env node

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.resolve(__dirname, "..");
const payloadPath = path.join(root, "cloudfunctions", "getProtectedResource", "protected-payloads.private.js");
const publicFiles = [
  "dse-topic-bank.html",
  "assets/js/dse-topic-bank.js",
  "assets/css/dse-topic-bank.css",
  "data/home-catalog.json",
  "data/home-catalog.js",
].map((file) => path.join(root, file));

function main() {
  assert(fs.existsSync(payloadPath), "Run npm run prepare:dse-topic-bank -- --source <full-report.html> first.");
  delete require.cache[require.resolve(payloadPath)];
  const payload = require(payloadPath);
  const resource = payload.resources && payload.resources["dse-topic-bank-2012-2026"];
  assert(resource, "Protected DSE resource is missing.");
  assert.strictEqual(resource.encoding, "gzip-base64");
  assert(resource.chunks.length >= 2 && resource.chunks.length <= 64, "Unexpected protected chunk count.");
  assert(resource.chunks.every((chunk) => chunk.length <= 96000), "A protected chunk is too large.");

  const html = zlib.gunzipSync(Buffer.from(resource.chunks.join(""), "base64"));
  assert.strictEqual(html.length, resource.source_bytes);
  assert.strictEqual(crypto.createHash("sha256").update(html).digest("hex"), resource.sha256);
  assert(html.toString("utf8").includes('data-artifact-block-id="writing-index"'));
  assert(html.toString("utf8").includes('data-artifact-block-id="speaking-index"'));

  const forbiddenFullText = "Northbound travel and local retail";
  publicFiles.forEach((filePath) => {
    assert(fs.existsSync(filePath), `Missing public file: ${path.relative(root, filePath)}`);
    assert(!fs.readFileSync(filePath, "utf8").includes(forbiddenFullText), `Protected full text leaked into ${path.relative(root, filePath)}`);
  });

  const ignored = require("child_process").spawnSync("git", ["check-ignore", "-q", path.relative(root, payloadPath)], { cwd: root });
  assert.strictEqual(ignored.status, 0, "Generated protected payload must remain ignored by Git.");
  console.log(`Protected resource verified: ${resource.chunks.length} chunks, integrity OK, no tested public leak.`);
}

main();
