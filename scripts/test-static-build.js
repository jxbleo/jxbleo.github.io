const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifest = require("./static-site-manifest.json");

function checkArtifact(directory) {
  const sourceRoot = path.dirname(directory);
  const release = require('./handout-store').loadRelease(sourceRoot);
  const expected = [...manifest.directories, ...manifest.rootFiles, ...Object.values(release.map.links)].sort();
  const actual = fs.readdirSync(directory).sort();
  assert(actual.length === expected.length && actual.every((name,i)=>name===expected[i]), "Only approved entry points, isolated handouts and asset directories may be published");
  assert(fs.existsSync(path.join(directory, "teacher-listening-corrector.html")), "Teacher Listening Edit target missing from static artifact");
  for (const excluded of manifest.excludedPaths) {
    assert(!fs.existsSync(path.join(directory, excluded)), `Private/source-only path published: ${excluded}`);
  }
  for (const retired of ["assets/js/listening-shadowing.js", "assets/css/listening-shadowing.css"]) {
    assert(!fs.existsSync(path.join(directory, retired)), `Retired Shadowing asset published: ${retired}`);
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
    require('./handout-test-fixture')(fixture);
    for (const directory of manifest.directories) fs.mkdirSync(path.join(fixture, directory));
    for (const file of manifest.rootFiles) fs.writeFileSync(path.join(fixture, file), "public fixture");
    const sharedSource = '<html><head></head><body><header data-share-header="report">stale copy</header><main>report fixture</main></body></html>';
    fs.writeFileSync(path.join(fixture, 'speaking-report.html'), sharedSource);
    for (const excluded of manifest.excludedPaths) {
      fs.mkdirSync(path.join(fixture, excluded), { recursive: true });
      fs.writeFileSync(path.join(fixture, excluded, "source.json"), "private fixture");
    }
    fs.writeFileSync(path.join(fixture, "unapproved-preview.html"), "prototype fixture");
    fs.mkdirSync(path.join(fixture, "dist"));
    fs.writeFileSync(path.join(fixture, "dist", "stale.html"), "old artifact");
    const build = () => spawnSync(process.execPath, ["scripts/build-static-site.js"], { cwd: fixture, encoding: "utf8", env: {...process.env, MRCAT_HANDOUT_LINKS_JSON:'', MRCAT_HANDOUT_CONTENT_KEY:''} });
    const result = build();
    assert.equal(result.status, 0, result.stderr);
    checkArtifact(path.join(fixture, "dist"));
    const sharedOutput = fs.readFileSync(path.join(fixture, 'dist/speaking-report.html'), 'utf8');
    assert(sharedOutput.includes(require('./share-header').render('report')));
    assert(sharedOutput.includes('<main>report fixture</main>'));
    assert(!sharedOutput.includes('stale copy'));
    fs.writeFileSync(path.join(fixture, 'speaking-report.html'), sharedSource.replace('</body>', '<header data-share-header="report"></header></body>'));
    assert.notEqual(build().status, 0, 'Duplicate shared header must fail before replacing dist');
    assert.equal(fs.readFileSync(path.join(fixture, 'dist/speaking-report.html'), 'utf8'), sharedOutput);
    fs.writeFileSync(path.join(fixture, 'speaking-report.html'), sharedSource);
    fs.mkdirSync(path.join(fixture, "dist/assets/js"), { recursive: true });
    fs.writeFileSync(path.join(fixture, "dist/assets/js/listening-shadowing.js"), "retired fixture");
    assert.throws(() => checkArtifact(path.join(fixture, "dist")), /Retired Shadowing asset published/);
    fs.unlinkSync(path.join(fixture, "dist/assets/js/listening-shadowing.js"));
    fs.unlinkSync(path.join(fixture, "index.html"));
    assert.notEqual(build().status, 0, "Missing approved entry must fail the build");
    assert(fs.existsSync(path.join(fixture, "dist", "index.html")), "Invalid source must not erase the previous artifact");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
console.log("Static publication boundary passed.");
