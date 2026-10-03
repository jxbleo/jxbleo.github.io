#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");
const { speakingRuntimeBundlePlugins, speakingRuntimeMaxBundleBytes } = require("./package-cloudfunctions");

const root = path.resolve(__dirname, "..");

async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "mrcat-speaking-package-test-"));
  const envKeys = ["TENCENTCLOUD_RUNENV", "TENCENTCLOUD_REGION", "SCF_NAMESPACE", "TCB_UUID", "TCB_CUSTOM_USER_ID", "TCB_CONTEXT_KEYS"];
  const prior = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const priorFetch = global.fetch;
  global.fetch = async () => { throw new Error("Unexpected network call in offline package test"); };
  process.env.TENCENTCLOUD_RUNENV = "SCF";
  process.env.TENCENTCLOUD_REGION = "ap-shanghai";
  process.env.SCF_NAMESPACE = "offline-fixture";
  delete process.env.TCB_UUID;
  delete process.env.TCB_CUSTOM_USER_ID;
  delete process.env.TCB_CONTEXT_KEYS;
  const common = { bundle: true, platform: "node", target: "node18", format: "cjs", minify: true, charset: "utf8", external: ["@aws-sdk/client-s3"], logLevel: "silent" };
  try {
    assert.equal(speakingRuntimeBundlePlugins("writingTutor").length, 0, "pruning must stay Speaking-only");
    for (const name of ["speakingLab", "speakingAiWorker"]) {
      const outfile = path.join(folder, `${name}.cjs`);
      await esbuild.build({ ...common, entryPoints: [path.join(root, "cloudfunctions", name, "index.js")], outfile, plugins: speakingRuntimeBundlePlugins(name) });
      const bytes = fs.statSync(outfile).size;
      assert(bytes <= speakingRuntimeMaxBundleBytes, `${name}: ${bytes} bytes exceeds ${speakingRuntimeMaxBundleBytes}`);
      const runtime = require(outfile);
      assert.equal(typeof runtime.main, "function");
      const denied = await runtime.main({});
      assert.equal(denied.success, false, "anonymous/invalid timer must still be rejected");
      assert.equal(denied.code, "AUTH_REQUIRED");
      console.log(`${name} bundle loads and rejects unauthorized access: ${bytes} bytes`);
    }

    const promptFile = path.join(root,"cloudfunctions/_shared/speaking-ir-prompts.js");
    const packedPrompts = path.join(folder,"prompts.cjs");
    await esbuild.build({...common,entryPoints:[promptFile],outfile:packedPrompts,plugins:speakingRuntimeBundlePlugins("speakingLab")});
    assert.deepEqual(require(packedPrompts),require(promptFile),"compressed prompt data must restore exact source strings");
    console.log("Packaged IR prompts restore byte-identical source strings.");

    // Build the real SDK with exactly the production pruning plugin and exercise
    // the retained adapters through a fake low-level transport. No cloud calls.
    const sdkFile = path.join(folder, "sdk-smoke.cjs");
    await esbuild.build({ ...common, stdin: {
      contents: 'module.exports = { sdk: require("@cloudbase/node-sdk"), CloudBase: require("@cloudbase/node-sdk/dist/cloudbase").CloudBase, requester: require("@cloudbase/node-sdk/dist/utils/tcbapirequester") };',
      resolveDir: root, sourcefile: "speaking-sdk-smoke.js", loader: "js",
    }, outfile: sdkFile, plugins: speakingRuntimeBundlePlugins("speakingLab") });
    const { sdk, CloudBase, requester } = require(sdkFile);
    const app = sdk.init({ env: "offline-fixture" });
    CloudBase.getCloudbaseContext = () => ({ TCB_UUID: "synthetic-user" });
    assert.equal(app.auth().getUserInfo().uid, "synthetic-user", "server authentication context must remain intact");
    const calls = [];
    requester.request = async (input) => {
      calls.push(input.params.action);
      if (input.params.action.startsWith("database.")) throw new Error("OFFLINE_DATABASE_TRANSPORT_REACHED");
      return { data: { download_list: [], delete_list: [] }, requestId: "synthetic-request" };
    };
    const db = app.database();
    assert.equal(typeof db.runTransaction, "function");
    await assert.rejects(db.collection("synthetic").limit(1).get(), /OFFLINE_DATABASE_TRANSPORT_REACHED/);
    await app.getTempFileURL({ fileList: ["cloud://offline-fixture/audio"] });
    await app.deleteFile({ fileList: ["cloud://offline-fixture/audio"] });
    await requester.request({ params: { action: "functions.invokeFunction" } });
    assert(calls.some((action) => action.startsWith("database.")));
    assert(calls.includes("storage.batchGetDownloadUrl"));
    assert(calls.includes("storage.batchDeleteFile"));
    assert(calls.includes("functions.invokeFunction"), "low-level async dispatch remains available");
    await assert.rejects(app.callFunction({ name: "unused-facade" }), /SPEAKING_SDK_FEATURE_NOT_PACKAGED/);
    assert.throws(() => app.logger(), /SPEAKING_SDK_FEATURE_NOT_PACKAGED/);
    console.log("Speaking package smoke passed: auth, database, storage, async requester, fail-closed unused SDK facades.");
  } finally {
    global.fetch = priorFetch;
    for (const key of envKeys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
