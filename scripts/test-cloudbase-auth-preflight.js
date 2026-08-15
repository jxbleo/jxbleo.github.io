#!/usr/bin/env node

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.resolve(__dirname, "../assets/js/cloudbase-client.js"), "utf8");

function clientFor(loginStates) {
  let loginCalls = 0;
  let functionCalls = 0;
  const app = {
    auth() {
      return {
        getLoginState() {
          const next = loginStates[Math.min(loginCalls, loginStates.length - 1)];
          loginCalls += 1;
          if (next instanceof Error) throw next;
          return Promise.resolve(next);
        },
      };
    },
    callFunction() {
      functionCalls += 1;
      return Promise.resolve({ result: { success: true } });
    },
  };
  const storage = new Map();
  const window = {
    MRCAT_CONFIG: { cloudbaseEnvId: "test", region: "ap-shanghai" },
    cloudbase: { init() { return app; } },
    crypto: { randomUUID() { return "test-uuid"; } },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      setItem(key, value) { storage.set(key, value); },
    },
    setTimeout(callback) { callback(); },
    dispatchEvent() {},
    CustomEvent: function CustomEvent() {},
  };
  vm.runInNewContext(source, {
    window,
    URL,
    fetch,
    Image: function Image() {},
    CustomEvent: window.CustomEvent,
  });
  return {
    cloud: window.MrCatCloud,
    counts() { return { loginCalls, functionCalls }; },
  };
}

(async () => {
  const credentialError = new Error("null is not an object (evaluating 't.scope')");
  const recovered = clientFor([credentialError, { user: { uid: "student" } }]);
  const result = await recovered.cloud.callAuthenticatedFunction("submitAttempt", { mode: "test" });
  assert.equal(result.success, true);
  assert.deepEqual(recovered.counts(), { loginCalls: 2, functionCalls: 1 });

  const unavailable = clientFor([credentialError, credentialError]);
  await assert.rejects(
    unavailable.cloud.callAuthenticatedFunction("submitAttempt", {}),
    (error) => error.code === "AUTH_TEMPORARILY_UNAVAILABLE"
  );
  assert.deepEqual(unavailable.counts(), { loginCalls: 2, functionCalls: 0 });

  const signedOut = clientFor([null]);
  await assert.rejects(
    signedOut.cloud.callAuthenticatedFunction("submitAttempt", {}),
    /LOGIN_REQUIRED/
  );
  assert.deepEqual(signedOut.counts(), { loginCalls: 1, functionCalls: 0 });

  console.log("CloudBase authenticated preflight tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
