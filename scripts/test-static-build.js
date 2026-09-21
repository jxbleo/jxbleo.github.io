const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifest = require("./static-site-manifest.json");

function checkArtifact(directory) {
  const expected = [...manifest.directories, ...manifest.rootFiles].sort();
  assert.deepEqual(fs.readdirSync(directory).sort(), expected, "Only approved entry points and asset directories may be published");
  for (const excluded of manifest.excludedPaths) {
    assert(!fs.existsSync(path.join(directory, excluded)), `Private/source-only path published: ${excluded}`);
  }
}

if (process.argv.includes("--artifact")) {
  checkArtifact(path.join(root, "dist"));
} else {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mrcat-static-build-"));
  try {
    fs.mkdirSync(path.join(fixture, "scripts"));
    for (const file of ["build-static-site.js", "static-site-manifest.json"]) {
      fs.copyFileSync(path.join(__dirname, file), path.join(fixture, "scripts", file));
    }
    for (const directory of manifest.directories) fs.mkdirSync(path.join(fixture, directory));
    for (const file of manifest.rootFiles) fs.writeFileSync(path.join(fixture, file), "public fixture");
    for (const excluded of manifest.excludedPaths) {
      fs.mkdirSync(path.join(fixture, excluded), { recursive: true });
      fs.writeFileSync(path.join(fixture, excluded, "source.json"), "private fixture");
    }
    fs.writeFileSync(path.join(fixture, "unapproved-preview.html"), "prototype fixture");
    fs.mkdirSync(path.join(fixture, "dist"));
    fs.writeFileSync(path.join(fixture, "dist", "stale.html"), "old artifact");
    const build = () => spawnSync(process.execPath, ["scripts/build-static-site.js"], { cwd: fixture, encoding: "utf8" });
    const result = build();
    assert.equal(result.status, 0, result.stderr);
    checkArtifact(path.join(fixture, "dist"));
    fs.unlinkSync(path.join(fixture, "index.html"));
    assert.notEqual(build().status, 0, "Missing approved entry must fail the build");
    assert(fs.existsSync(path.join(fixture, "dist", "index.html")), "Invalid source must not erase the previous artifact");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
console.log("Static publication boundary passed.");
