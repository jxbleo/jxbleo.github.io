"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mrcat-handout-package-test-"));
const syntheticLink = "h-" + "a".repeat(48) + ".html";
const syntheticItem = { id: "fixture-handout", category: "study", title: "Synthetic handout", topic: "Writing", description: "Test fixture only", access: "Link holders", href: syntheticLink };
const syntheticCatalog = { schemaVersion: 1, items: [syntheticItem] };

function run(name, extra = []) {
  return spawnSync(process.execPath, [path.join(fixture, "scripts/package-cloudfunctions.js"), name, ...extra], {
    cwd: fixture, encoding: "utf8", timeout: 30000,
  });
}

function entries(archive) {
  return execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split(/\r?\n/).sort();
}

async function main() {
try {
  fs.mkdirSync(path.join(fixture, "scripts"));
  fs.cpSync(path.join(root, "scripts/package-cloudfunctions.js"), path.join(fixture, "scripts/package-cloudfunctions.js"));
  fs.symlinkSync(path.join(root, "node_modules"), path.join(fixture, "node_modules"), "dir");
  for (const name of ["teacherHandoutLinks", "fixtureStandard"]) {
    const directory = path.join(fixture, "cloudfunctions", name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, main: "index.js" }));
    fs.writeFileSync(path.join(directory, "index.js"), name === "teacherHandoutLinks"
      ? 'exports.main=async()=>JSON.parse(require("fs").readFileSync(require("path").join(__dirname,"handout-links.private.json"),"utf8"));'
      : 'exports.main=async()=>({success:true});');
  }
  const privateFile = path.join(fixture, "cloudfunctions/teacherHandoutLinks/handout-links.private.json");
  const archive = path.join(fixture, "deploy-packages/teacherHandoutLinks.zip");
  fs.mkdirSync(path.dirname(archive));
  const priorArchive = Buffer.from("preserve existing artifact on invalid private config");
  fs.writeFileSync(archive, priorArchive);

  for (const invalid of [
    null,
    "invalid JSON containing " + syntheticLink,
    JSON.stringify({ schemaVersion: 2, items: [] }),
    JSON.stringify({ schemaVersion: 1, items: [syntheticItem, syntheticItem] }),
    JSON.stringify({ schemaVersion: 1, items: [syntheticItem, { ...syntheticItem, id: "different-id" }] }),
    JSON.stringify({ schemaVersion: 1, items: [{ ...syntheticItem, href: "https://example.com/" + syntheticLink }] }),
    JSON.stringify({ schemaVersion: 1, items: [{ ...syntheticItem, title: "" }] }),
    JSON.stringify({ schemaVersion: 1, items: [{ ...syntheticItem, category: "information" }] }),
  ]) {
    if (invalid === null) fs.rmSync(privateFile, { force: true });
    else fs.writeFileSync(privateFile, invalid);
    const result = run("teacherHandoutLinks");
    assert.notEqual(result.status, 0, "Invalid or missing private config must fail packaging");
    assert.deepEqual(fs.readFileSync(archive), priorArchive, "Validation must preserve an existing ZIP");
    assert.match(result.stderr, /requires a valid private link directory/);
    assert.ok(![result.stdout, result.stderr].join("").includes(syntheticLink), "Validation must not print private URLs");
    assert.ok(![result.stdout, result.stderr].join("").includes('"schemaVersion"'), "Validation must not print private JSON");
  }

  const exactPrivateBytes = Buffer.from(JSON.stringify(syntheticCatalog, null, 2) + "\n");
  fs.writeFileSync(privateFile, exactPrivateBytes);
  const dryRun = run("teacherHandoutLinks", ["--dry-run"]);
  assert.equal(dryRun.status, 0, "Valid dry run should pass without replacing the ZIP");
  assert.deepEqual(fs.readFileSync(archive), priorArchive);
  const built = run("teacherHandoutLinks");
  assert.equal(built.status, 0, "Valid fixture must package successfully");
  assert.deepEqual(entries(archive), ["handout-links.private.json", "index.js", "package.json"]);
  const archivedPrivateBytes = execFileSync("unzip", ["-p", archive, "handout-links.private.json"]);
  assert.deepEqual(archivedPrivateBytes, exactPrivateBytes, "Private runtime JSON must be copied byte-for-byte into the ZIP");
  const extracted = path.join(fixture, "extracted");
  execFileSync("unzip", ["-q", archive, "-d", extracted]);
  const runtime = require(path.join(extracted, "index.js"));
  assert.deepEqual(await runtime.main(), syntheticCatalog, "Bundled runtime resolves private JSON beside index.js");

  const ordinary = run("fixtureStandard");
  assert.equal(ordinary.status, 0, "Unrelated functions must not require a private handout catalog");
  assert.deepEqual(entries(path.join(fixture, "deploy-packages/fixtureStandard.zip")), ["index.js", "package.json"]);
  console.log("Teacher handout package passed: missing/invalid map preserves old ZIP; private JSON included and runtime-readable; unrelated function package unchanged; no real link data used.");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
}

main().catch(error => { console.error(error); process.exitCode = 1; });
