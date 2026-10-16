const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "deploy-static-to-cos.js"), "utf8");
// Synthetic locators only. Never load a real private link map into this test.
const filename = `h-${"ab".repeat(24)}.html`;
const retiredFilename = `h-${"cd".repeat(24)}.html`;

async function runScenario({ multipart = false, retry = false, failure = "" } = {}) {
  const logs = [];
  const calls = [];
  const contents = new Map([
    ["index.html", Buffer.from("index")],
    [filename, multipart ? Buffer.alloc(4 * 1024 * 1024, 1) : Buffer.from("handout content")],
  ]);
  let retried = false;
  let settle;
  const finished = new Promise((resolve) => { settle = resolve; });
  const processFixture = {
    env: { TENCENT_CLOUD_SECRET_ID: "fixture-id", TENCENT_CLOUD_SECRET_KEY: "fixture-key" },
    set exitCode(value) { settle(value); },
  };
  function respond(method, parameters, callback) {
    calls.push({ method, key: parameters.Key });
    if (failure === "listing" && method === "getBucket") {
      callback(new Error(`Cannot list https://example.invalid/${filename}`));
      return;
    }
    if (method === "getBucket") {
      callback(null, { Contents: [{ Key: retiredFilename, ETag: "obsolete", Size: 1 }] });
      return;
    }
    if (failure === "delete" && method === "deleteObject") {
      callback(new Error(`Cannot remove https://example.invalid/${retiredFilename}?diagnostic=1`));
      return;
    }
    const uploadMethod = multipart ? "multipartUpload" : "putObject";
    if (parameters.Key === filename && method === uploadMethod) {
      if (failure === "upload") {
        callback(Object.assign(new Error(`Cannot upload ${filename}`), { code: "AccessDenied" }));
        return;
      }
      if (retry && !retried) {
        retried = true;
        callback(Object.assign(new Error(`Connection interrupted for ${filename}`), { code: "ConnectionReset" }));
        return;
      }
    }
    callback(null, { UploadId: "fixture-upload", ETag: "fixture-etag" });
  }
  class FakeCos {
    constructor() {
      for (const method of ["getBucket", "putObject", "deleteObject", "multipartInit", "multipartUpload", "multipartComplete", "multipartAbort"]) {
        this[method] = (parameters, callback) => respond(method, parameters, callback);
      }
    }
  }
  const fsFixture = {
    existsSync: () => true,
    readdirSync: () => Array.from(contents.keys(), (name) => ({ name, isDirectory: () => false, isFile: () => true })),
    readFileSync: (file) => contents.get(path.basename(file)),
    statSync: (file) => ({ size: contents.get(path.basename(file)).length }),
    createReadStream: () => ({}),
  };
  const consoleFixture = Object.fromEntries(["log", "warn", "error"].map((level) => [level, (message) => {
    logs.push({ level, message });
    if (message.startsWith("COS deployment complete:")) settle(0);
  }]));
  vm.runInNewContext(source, {
    __dirname: "/fixture/scripts",
    require: (name) => name === "fs" ? fsFixture : name === "cos-nodejs-sdk-v5" ? FakeCos : require(name),
    process: processFixture,
    console: consoleFixture,
    Buffer,
    setTimeout: (callback) => { callback(); return 0; },
  }, { filename: "deploy-static-to-cos.js" });
  const exitCode = await finished;
  const combined = logs.map(({ message }) => message).join("\n");
  assert(!combined.includes(filename), "A current access locator escaped into deployment logs");
  assert(!combined.includes(retiredFilename), "A retired access locator escaped into deployment errors");
  assert(combined.includes("[private-handout]"), "The scenario did not exercise locator redaction");
  if (!failure) {
    assert.equal(exitCode, 0);
    assert(calls.some(({ method, key }) => method === "deleteObject" && key === retiredFilename), "Redaction must not change the remote deletion key");
    assert(calls.some(({ method, key }) => (method === "putObject" || method === "multipartUpload") && key === filename), "Redaction must not change the real upload key");
  } else {
    assert.equal(exitCode, 1);
    if (failure === "upload") assert(!calls.some(({ method }) => method === "deleteObject"), "Failed uploads must still prevent obsolete-file deletion");
  }
  if (retry) assert(logs.some(({ level, message }) => level === "warn" && message.includes("[private-handout]")), "Retry diagnostics were not exercised");
}

(async () => {
  await runScenario();
  await runScenario({ retry: true });
  await runScenario({ multipart: true, retry: true });
  await runScenario({ failure: "upload" });
  await runScenario({ failure: "listing" });
  await runScenario({ failure: "delete" });
  console.log("Handout deployment log redaction passed (6 mocked deployment scenarios).");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
