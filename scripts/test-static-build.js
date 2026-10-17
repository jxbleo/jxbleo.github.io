const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const manifest = require("./static-site-manifest.json");

function checkArtifact(directory) {
  const sourceRoot = path.dirname(directory);
  const release = require('./handout-store').loadRelease(sourceRoot);
  const {renderTopicBank}=require('./render-topic-bank');
  const expected = [...manifest.directories, ...manifest.rootFiles, ...Object.values(release.map.links)].sort();
  const actual = fs.readdirSync(directory).sort();
  assert(actual.length === expected.length && actual.every((name,i)=>name===expected[i]), "Only approved entry points, isolated handouts and asset directories may be published");
  assert(fs.existsSync(path.join(directory, "teacher-listening-corrector.html")), "Teacher Listening Edit target missing from static artifact");
  assert.equal(fs.readFileSync(path.join(directory,'dse-topic-bank.html'),'utf8'),renderTopicBank(release.files),'Topic-bank output must be the complete authenticated source, never its build-only placeholder');
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
    const fixtureData=require('./handout-test-fixture')(fixture);
    const writeSources=files=>{
      const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',fixtureData.key,iv);
      cipher.setAAD(Buffer.from('mrcat-independent-handouts-v1'));
      const encrypted=Buffer.concat([cipher.update(zlib.gzipSync(Buffer.from(JSON.stringify(files)))),cipher.final()]);
      fs.writeFileSync(path.join(fixture,'scripts/handouts.sealed.json'),JSON.stringify({schemaVersion:1,algorithm:'aes-256-gcm',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')}));
    };
    for (const directory of manifest.directories) fs.mkdirSync(path.join(fixture, directory));
    for (const file of manifest.rootFiles) fs.writeFileSync(path.join(fixture, file), "public fixture");
    const topicBlueprint='<html><head></head><body><main data-topic-bank-build-source>Build-only placeholder.</main></body></html>';
    fs.writeFileSync(path.join(fixture,'dse-topic-bank.html'),topicBlueprint);
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
    const topicOutput=fs.readFileSync(path.join(fixture,'dist/dse-topic-bank.html'),'utf8');
    assert(!topicOutput.includes('Build-only placeholder'));
    fs.writeFileSync(path.join(fixture,'dse-topic-bank.html'),'Missing the build marker');
    assert.notEqual(build().status,0,'Missing topic-bank marker must fail before replacing dist');
    assert.equal(fs.readFileSync(path.join(fixture,'dist/dse-topic-bank.html'),'utf8'),topicOutput);
    fs.writeFileSync(path.join(fixture,'dse-topic-bank.html'),topicBlueprint);
    const incompleteSources={...fixtureData.files};
    delete incompleteSources['dse-core-topics/published.html'];
    writeSources(incompleteSources);
    assert.notEqual(build().status,0,'Missing complete topic source must fail before replacing dist');
    assert.equal(fs.readFileSync(path.join(fixture,'dist/dse-topic-bank.html'),'utf8'),topicOutput);
    writeSources({...fixtureData.files,'dse-core-topics/published.html':fixtureData.files['dse-core-topics/published.html'].replace('<li>Task one.</li>','')});
    assert.notEqual(build().status,0,'Incomplete topic source must fail before replacing dist');
    assert.equal(fs.readFileSync(path.join(fixture,'dist/dse-topic-bank.html'),'utf8'),topicOutput);
    writeSources(fixtureData.files);
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
