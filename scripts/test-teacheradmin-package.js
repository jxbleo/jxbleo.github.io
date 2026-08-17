#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const packagePath = path.join(root, "deploy-packages", "teacherAdmin.zip");
const unzippedLimitBytes = 1_500_000;

function packageTeacherAdmin() {
  const result = spawnSync(process.execPath, [
    path.join(root, "scripts", "package-cloudfunctions.js"),
    "teacherAdmin",
  ], { cwd: root, encoding: "utf8", timeout: 120000, killSignal: "SIGTERM" });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error("teacherAdmin packaging failed");
  }
}

function archiveEntries() {
  const listing = execFileSync("unzip", ["-l", packagePath], { encoding: "utf8" });
  return listing.split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s+\S+\s+\S+\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({ bytes: Number(match[1]), name: match[2].trim() }));
}

async function checkUserApiAdapter() {
  assert.strictEqual(typeof fetch, "function", "Node.js 18+ global fetch is required");
  const previous = global.fetch;
  const previousEnv = {
    secretId: process.env.TENCENTCLOUD_SECRETID,
    secretKey: process.env.TENCENTCLOUD_SECRETKEY,
    envId: process.env.TENCENTCLOUD_TCB_ENVID,
    tcbRegion: process.env.TCB_REGION,
    cloudRegion: process.env.TENCENTCLOUD_REGION,
    baseUrl: process.env.TCB_BASE_URL,
  };
  const calls = [];
  process.env.TENCENTCLOUD_SECRETID = "test-secret-id";
  process.env.TENCENTCLOUD_SECRETKEY = "test-secret-key";
  process.env.TENCENTCLOUD_TCB_ENVID = "env-from-process";
  process.env.TCB_REGION = "region-from-process";
  process.env.TCB_BASE_URL = "https://tcb.example.test";
  global.fetch = async (url, options) => {
    const action = options.headers["X-TC-Action"];
    calls.push({
      url,
      action,
      region: options.headers["X-TC-Region"],
      body: JSON.parse(options.body),
    });
    assert.match(
      options.headers.Authorization,
      /^TC3-HMAC-SHA256 Credential=test-secret-id\//,
      `missing TC3 authorization for ${action}`
    );
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ Response: action === "DescribeEndUsers" ? { Users: [] } : {} }),
    };
  };

  try {
    const adapterPath = path.join(root, "cloudfunctions", "_shared", "cloudbase-user-manager.js");
    const adapter = require(adapterPath);
    const manager = adapter.init({ envId: "test-env-from-init", region: "ap-test" });
    const response = await manager.user.getEndUserList({ limit: 10, offset: 0 });
    assert.deepStrictEqual(response.Users, []);
    await manager.user.createEndUser({ username: "student-1", password: "Test1!" });
    await manager.user.setEndUserStatus({ uuid: "uuid-1", status: "ENABLE" });
    await manager.user.deleteEndUsers({ userList: ["uuid-1"] });
    await manager.user.modifyEndUser({ uuid: "uuid-1", password: "Test2!" });
    assert.deepStrictEqual(calls.map(({ authorization, ...call }) => call), [
      {
        url: "https://tcb.example.test",
        action: "DescribeEndUsers",
        region: "ap-test",
        body: { EnvId: "test-env-from-init", Limit: 10, Offset: 0 },
      },
      {
        url: "https://tcb.example.test",
        action: "CreateEndUserAccount",
        region: "ap-test",
        body: { EnvId: "test-env-from-init", Username: "student-1", Password: "Test1!" },
      },
      {
        url: "https://tcb.example.test",
        action: "ModifyEndUser",
        region: "ap-test",
        body: { EnvId: "test-env-from-init", UUId: "uuid-1", Status: "ENABLE" },
      },
      {
        url: "https://tcb.example.test",
        action: "DeleteEndUser",
        region: "ap-test",
        body: { EnvId: "test-env-from-init", UserList: ["uuid-1"] },
      },
      {
        url: "https://tcb.example.test",
        action: "ModifyEndUserAccount",
        region: "ap-test",
        body: { EnvId: "test-env-from-init", Uuid: "uuid-1", Password: "Test2!" },
      },
    ]);
    assert.throws(() => {
      delete process.env.TENCENTCLOUD_TCB_ENVID;
      adapter.init({ region: "ap-test" });
    }, /CLOUDBASE_MANAGER_ENV_ID_MISSING/);
  } finally {
    global.fetch = previous;
    for (const [key, value] of Object.entries({
      TENCENTCLOUD_SECRETID: previousEnv.secretId,
      TENCENTCLOUD_SECRETKEY: previousEnv.secretKey,
      TENCENTCLOUD_TCB_ENVID: previousEnv.envId,
      TCB_REGION: previousEnv.tcbRegion,
      TENCENTCLOUD_REGION: previousEnv.cloudRegion,
      TCB_BASE_URL: previousEnv.baseUrl,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function main() {
  packageTeacherAdmin();
  assert.ok(fs.existsSync(packagePath), "teacherAdmin.zip was not created");
  const entries = archiveEntries();
  assert.deepStrictEqual(entries.map((entry) => entry.name).sort(), ["index.js", "package.json"]);
  const unzippedBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  assert.ok(
    unzippedBytes <= unzippedLimitBytes,
    `teacherAdmin unzipped size ${unzippedBytes} exceeds project guardrail ${unzippedLimitBytes}`
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrcat-teacheradmin-package-"));
  try {
    execFileSync("unzip", ["-q", packagePath, "-d", tempDir]);
    const bundle = fs.readFileSync(path.join(tempDir, "index.js"), "utf8");
    for (const marker of ["intensive_spelling_exemption", "dispute_type", "INTENSIVE_DECISION_REQUIRED"]) {
      assert.ok(bundle.includes(marker), `bundle is missing ${marker}`);
    }
    assert.ok(!bundle.includes("@cloudbase/manager-node"), "manager-node must not be bundled");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  await checkUserApiAdapter();
  console.log(`teacherAdmin package OK: ${unzippedBytes} unzipped bytes (guardrail ${unzippedLimitBytes})`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
