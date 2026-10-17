#!/usr/bin/env node

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const vm = require("vm");
const { roleCanAccess } = require("../cloudfunctions/getProtectedResource/access-policy");
const { validateTopicBankHtml } = require("./prepare-protected-resource");
const { validateBlueprint, validateTopicBankHtml: validateDirectTopicBankHtml } = require("./render-topic-bank");

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

async function checkAuthorizedDelivery(payload) {
  let authenticatedUid = "", activeProfile = null, profileReads = 0;
  const app = {
    auth: () => ({ getUserInfo: async () => ({ uid: authenticatedUid }) }),
    database: () => ({ collection: (name) => {
      assert.strictEqual(name, "students");
      return { where: (query) => {
        assert.deepStrictEqual(JSON.parse(JSON.stringify(query)), { auth_uid: authenticatedUid, active: true });
        return { limit: (limit) => {
          assert.strictEqual(limit, 1);
          return { get: async () => { profileReads++; return { data: activeProfile ? [activeProfile] : [] }; } };
        } };
      } };
    } }),
  };
  const entry = { exports: {}, require: (name) => {
    if (name === "@cloudbase/node-sdk") return { SYMBOL_CURRENT_ENV: "test", init: () => app };
    if (name === "./protected-payloads.private") return payload;
    if (name === "./access-policy") return { roleCanAccess };
    throw new Error("Unexpected protected resource dependency: " + name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "cloudfunctions/getProtectedResource/index.js"), "utf8"), entry);
  const call = (action, extra = {}) => entry.exports.main({ resource_key: "dse-topic-bank-2012-2026", action, chunk_index: 0, auth_uid: "untrusted-uid", role: "teacher", ...extra });
  for (const action of ["manifest", "chunk"]) {
    assert.strictEqual((await call(action)).code, "AUTH_REQUIRED");
    authenticatedUid = "verified-uid";
    assert.strictEqual((await call(action)).code, "STUDENT_NOT_LINKED");
    activeProfile = { role: "visitor" };
    assert.strictEqual((await call(action)).code, "ACCESS_DENIED");
    for (const role of ["student", "teacher"]) {
      activeProfile = { role };
      const before = profileReads;
      const result = await call(action);
      assert.strictEqual(result.success, true);
      assert.strictEqual(profileReads, before + 1, "Each manifest/chunk must recheck the active profile.");
      assert(!JSON.stringify(result).includes("verified-uid"));
    }
    activeProfile = null;
    assert.strictEqual((await call(action)).code, "STUDENT_NOT_LINKED", "An inactive/unlinked profile must lose access to every action.");
    authenticatedUid = "";
  }
  authenticatedUid = "verified-uid";
  activeProfile = { role: "teacher" };
  assert.strictEqual((await call("manifest", { resource_key: "hk8-dse-jupas-weighting-2026-27" })).code, "ACCESS_DENIED");
  activeProfile = { role: "student" };
  assert.strictEqual((await call("manifest", { resource_key: "hk8-dse-jupas-weighting-2026-27" })).success, true);
  for (const index of [-1, 0.5, payload.resources["dse-topic-bank-2012-2026"].chunks.length]) {
    assert.strictEqual((await call("chunk", { chunk_index: index })).code, "INVALID_CHUNK");
  }
}

async function main() {
  assert(fs.existsSync(payloadPath), "Run npm run prepare:dse-topic-bank -- --source <full-report.html> first.");
  delete require.cache[require.resolve(payloadPath)];
  const payload = require(payloadPath);
  const resource = payload.resources && payload.resources["dse-topic-bank-2012-2026"];
  const htmlText = unpackResource(resource);
  if (htmlText.includes('data-topic-bank-version=')) {
    assert(validateTopicBankHtml(htmlText), "The protected topic bank must have all 100 complete subtopics and only internal resources.");
    assert(!validateTopicBankHtml(htmlText.replace('class="development"', 'class="missing-development"')), "Missing development must fail validation.");
    assert(!validateTopicBankHtml(htmlText.replace('href="#reader-content"', 'href="https://example.invalid/"')), "External inner links must fail validation.");
    assert(!validateTopicBankHtml(htmlText.replace('<body ', '<body data-share-header ')), "A duplicate shared toolbar must fail validation.");
    assert(!validateTopicBankHtml(htmlText.replace('<ol class="transfer-tasks"><li>', '<ol class="transfer-tasks"><div>')), "Incomplete task coverage must fail validation.");
    assert(htmlText.includes("catch (_) { location.hash = hash; }"), "Opaque-origin srcdoc requires a History API fallback.");
    assert(htmlText.includes("closest('a[href^=\"#\"]')"), "All hash links must use explicit local navigation inside srcdoc.");
  } else {
    assert(htmlText.includes('data-artifact-block-id="writing-index"'));
    assert(htmlText.includes('data-artifact-block-id="speaking-index"'));
  }
  assert(!htmlText.includes('data-artifact-block-id="further-questions"'), "Further Questions must not be present in the protected report.");
  assert.deepStrictEqual(resource.allowed_roles, ["student", "teacher"], "The retained legacy endpoint must keep its student/teacher authorization.");
  const publicShell = fs.readFileSync(path.join(root, "dse-topic-bank.html"), "utf8");
  assert(validateBlueprint(publicShell) || validateDirectTopicBankHtml(publicShell), "The topic bank must use the direct-reader build entry or complete direct HTML.");
  assert(!/<iframe\b|getProtectedResource|cloudbase-client|auth\.js/.test(publicShell), "The public topic bank must not retain the old access shell.");
  assert(publicShell.includes('data-share-header'), "The direct reader must retain the shared toolbar.");

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
  const currentPrivateClaim = htmlText.match(/<p class="claim">([^<]+)<\/p>/)?.[1];
  publicFiles.forEach((filePath) => {
    assert(fs.existsSync(filePath), `Missing public file: ${path.relative(root, filePath)}`);
    const publicText = fs.readFileSync(filePath, "utf8");
    assert(!publicText.includes(forbiddenJupasText), `Protected JUPAS report text leaked into ${path.relative(root, filePath)}`);
    // The owner now permits complete topic content at its direct public entry.
    // Other public metadata/asset files must not accidentally acquire that text.
    if (path.basename(filePath) !== 'dse-topic-bank.html') {
      assert(!publicText.includes(forbiddenFullText), `Unexpected topic-bank text in ${path.relative(root, filePath)}`);
      if (currentPrivateClaim) assert(!publicText.includes(currentPrivateClaim), `Unexpected viewpoint text in ${path.relative(root, filePath)}`);
    }
  });

  const ignored = require("child_process").spawnSync("git", ["check-ignore", "-q", path.relative(root, payloadPath)], { cwd: root });
  assert.strictEqual(ignored.status, 0, "Generated protected payload must remain ignored by Git.");
  await checkAuthorizedDelivery(payload);
  console.log(`Retained protected endpoints verified: legacy DSE ${resource.chunks.length} chunks, JUPAS ${jupasResource.chunks.length} chunks, integrity/auth OK; JUPAS remains private.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
