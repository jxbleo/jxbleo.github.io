#!/usr/bin/env node

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { roleCanAccess } = require("../cloudfunctions/getProtectedResource/access-policy");

const root = path.resolve(__dirname, "..");
const payloadPath = path.join(root, "cloudfunctions", "getProtectedResource", "protected-payloads.private.js");
const publicFiles = [
  "dse-topic-bank.html",
  "assets/js/dse-topic-bank.js",
  "assets/css/dse-topic-bank.css",
  "hk8-dse-jupas-weighting-report-2026-27.html",
  "assets/js/jupas-protected-report.js",
  "data/home-catalog.json",
  "data/home-catalog.js",
].map((file) => path.join(root, file));

function unpackResource(resource) {
  assert(resource, "Protected resource is missing.");
  assert.strictEqual(resource.encoding, "gzip-base64");
  assert(resource.chunks.length >= 2 && resource.chunks.length <= 64, "Unexpected protected chunk count.");
  assert(resource.chunks.every((chunk) => chunk.length <= 96000), "A protected chunk is too large.");

  const html = zlib.gunzipSync(Buffer.from(resource.chunks.join(""), "base64"));
  assert.strictEqual(html.length, resource.source_bytes);
  assert.strictEqual(crypto.createHash("sha256").update(html).digest("hex"), resource.sha256);
  return html.toString("utf8");
}

function main() {
  assert(fs.existsSync(payloadPath), "Run npm run prepare:dse-topic-bank -- --source <full-report.html> first.");
  delete require.cache[require.resolve(payloadPath)];
  const payload = require(payloadPath);
  const resource = payload.resources && payload.resources["dse-topic-bank-2012-2026"];
  const htmlText = unpackResource(resource);
  assert(htmlText.includes('data-artifact-block-id="writing-index"'));
  assert(htmlText.includes('data-artifact-block-id="speaking-index"'));
  assert(!htmlText.includes('data-artifact-block-id="further-questions"'), "Further Questions must not be present in the protected report.");

  const jupasResource = payload.resources && payload.resources["hk8-dse-jupas-weighting-2026-27"];
  const jupasHtml = unpackResource(jupasResource);
  assert.deepStrictEqual(jupasResource.allowed_roles, ["student"], "JUPAS report must be student-only.");
  assert.strictEqual(roleCanAccess({ role: "student" }, jupasResource), true);
  assert.strictEqual(roleCanAccess({ role: "teacher" }, jupasResource), false);
  assert.strictEqual(roleCanAccess({ role: "teacher" }, resource), true, "Legacy protected resources must keep teacher access.");
  assert(jupasHtml.includes('data-artifact-block-id="english_math_table"'));
  assert(jupasHtml.includes('data-artifact-block-id="rules_table"'));
  assert(jupasHtml.includes("Admission%20Requirements_JUPAS%20(UG%20Website).pdf"));
  assert(!jupasHtml.includes("岭南大学官方计分／权重资料</a>.pdf)"), "Broken Lingnan PDF suffix is still visible.");

  const forbiddenFullText = "Northbound travel and local retail";
  const forbiddenJupasText = "条件权重（例如第一／第二选修科）在原始明细中保留适用范围";
  publicFiles.forEach((filePath) => {
    assert(fs.existsSync(filePath), `Missing public file: ${path.relative(root, filePath)}`);
    const publicText = fs.readFileSync(filePath, "utf8");
    assert(!publicText.includes(forbiddenFullText), `Protected topic-bank text leaked into ${path.relative(root, filePath)}`);
    assert(!publicText.includes(forbiddenJupasText), `Protected JUPAS report text leaked into ${path.relative(root, filePath)}`);
  });

  const ignored = require("child_process").spawnSync("git", ["check-ignore", "-q", path.relative(root, payloadPath)], { cwd: root });
  assert.strictEqual(ignored.status, 0, "Generated protected payload must remain ignored by Git.");
  console.log(`Protected resources verified: DSE ${resource.chunks.length} chunks, JUPAS ${jupasResource.chunks.length} chunks, integrity OK, no tested public leak.`);
}

main();
