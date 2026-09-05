"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const publish = require("./publish-github-main");

assert.equal(publish.parseRepoSlug("https://github.com/jxbleo/jxbleo.github.io.git"), "jxbleo/jxbleo.github.io");
assert.equal(publish.parseRepoSlug("git@github.com:jxbleo/jxbleo.github.io.git"), "jxbleo/jxbleo.github.io");
assert.equal(publish.parseRepoSlug("ssh://git@github.com/jxbleo/jxbleo.github.io.git"), "jxbleo/jxbleo.github.io");
assert.throws(() => publish.parseRepoSlug("https://example.com/owner/repo.git"), /github\.com/);

assert.equal(publish.isNetworkPushFailure({ stdout: "", stderr: "Failed to connect to github.com port 443" }), true);
assert.equal(publish.isNetworkPushFailure({ stdout: "", stderr: "Could not resolve host: github.com" }), true);
assert.equal(publish.isNetworkPushFailure({ stdout: "", stderr: "rejected (fetch first)" }), false);
assert.equal(publish.isNetworkPushFailure({ error: { code: "ETIMEDOUT" } }), true);

assert.deepEqual(
  publish.parseNameStatusZero("M\0speaking-lab.html\0D\0old.html\0A\0new.html\0"),
  [
    { status: "M", path: "speaking-lab.html" },
    { status: "D", path: "old.html" },
    { status: "A", path: "new.html" },
  ]
);
assert.equal(publish.apiPathBranch("release/main"), "release/main");
assert.equal(publish.parseArgs(["--branch", "main", "--push-timeout-ms", "15000"]).pushTimeoutMs, 15000);
assert.throws(() => publish.parseArgs(["--push-timeout-ms", "10"]), /1000/);

const treeSha = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
const parentSha = execFileSync("git", ["rev-parse", "HEAD^"], { encoding: "utf8" }).trim();
const commitInput = {
  treeSha,
  parentSha,
  message: "Deterministic API commit contract",
  identity: { name: "Mr Cat Release Test", email: "release-test@example.invalid" },
  date: "2026-08-30T00:00:00.000Z",
};
const testObjectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mrcat-git-objects-"));
const previousObjectDirectory = process.env.GIT_OBJECT_DIRECTORY;
let testObjectDirectoryCleaned = false;
function cleanupTestObjectDirectory() {
  if (testObjectDirectoryCleaned) return;
  testObjectDirectoryCleaned = true;
  if (previousObjectDirectory == null) delete process.env.GIT_OBJECT_DIRECTORY;
  else process.env.GIT_OBJECT_DIRECTORY = previousObjectDirectory;
  fs.rmSync(testObjectDirectory, { recursive: true, force: true });
}
process.env.GIT_OBJECT_DIRECTORY = testObjectDirectory;
process.on("exit", cleanupTestObjectDirectory);
assert.equal(
  publish.createMatchingLocalCommit(commitInput),
  publish.createMatchingLocalCommit(commitInput),
  "matching API commit reconstruction must be deterministic"
);

assert.deepEqual(publish.gitObjectDate("2026-08-30T14:22:37Z"), {
  timestamp: 1788099757,
  timezone: "+0000",
});
assert.deepEqual(publish.gitObjectDate("2026-08-30T22:22:37+08:00"), {
  timestamp: 1788099757,
  timezone: "+0800",
});
assert.equal(
  publish.createMatchingLocalCommit({
    treeSha: "f61c878e88e325d129fd45baef6fe3f9297d2982",
    parentSha: "3741a3bdc23c6c95d0854ca68dcca31e5fce02ac",
    message: "Publish Speaking report and Set navigation updates",
    identity: { name: "jxbleo", email: "47422976+jxbleo@users.noreply.github.com" },
    date: "2026-08-30T22:22:37+08:00",
  }),
  "3531ef59d5290f65f739c33c29cad0c7bd1b6e24",
  "local reconstruction must match the real GitHub Git Data API commit"
);

cleanupTestObjectDirectory();
console.log("GitHub publication fallback contracts passed.");
