#!/usr/bin/env node
"use strict";

// Owner-only paired configuration: never print or persist credentials or full environments.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { isDeepStrictEqual } = require("util");
const policy = require("./text-model-policy.json");
const ENV_ID = "mrcat-dev-d9gwy2v1icdfdf597";
const TARGETS = [
  { name: "writingTutor", prefix: "WRITING_AI_TEXT" },
  { name: "speakingLab", prefix: "SPEAKING_AI_TEXT" },
];
const PRESERVED_FIELDS = ["Runtime", "Handler", "MemorySize", "Timeout", "InitTimeout", "InstallDependency", "Triggers", "VpcConfig", "Role", "Layers", "PublicNetConfig", "CfsConfig", "DeadLetterConfig", "AsyncRunEnable", "TraceEnable", "Type", "CodeInfo"];

function desiredPatch(prefix, selected = policy) {
  const valid = (value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(value);
  if (!valid(selected.primary_model) || !Array.isArray(selected.quota_fallback_models)
      || selected.quota_fallback_models.length > 8
      || !selected.quota_fallback_models.every(valid)
      || new Set([selected.primary_model, ...selected.quota_fallback_models]).size !== selected.quota_fallback_models.length + 1) {
    throw new Error("INVALID_TEXT_MODEL_POLICY");
  }
  return {
    [`${prefix}_MODEL`]: selected.primary_model,
    [`${prefix}_QUOTA_FALLBACK_MODELS`]: selected.quota_fallback_models.join(","),
    // Clear the legacy singular fallback as well, so an empty list really disables fallback.
    [`${prefix}_QUOTA_FALLBACK_MODEL`]: "",
  };
}

function variables(detail) {
  if (!detail || !detail.Environment || !Array.isArray(detail.Environment.Variables)) throw new Error("FUNCTION_ENVIRONMENT_UNAVAILABLE");
  return Object.fromEntries(detail.Environment.Variables.map(({ Key, Value }) => [Key, Value]));
}

function nextVariables(detail, target) {
  const current = variables(detail), patch = desiredPatch(target.prefix);
  if (!Object.hasOwn(current, `${target.prefix}_QUOTA_FALLBACK_MODEL`)) delete patch[`${target.prefix}_QUOTA_FALLBACK_MODEL`];
  return { ...current, ...patch };
}

function ensurePreserved(before, after, expected) {
  if (!isDeepStrictEqual(variables(after), expected)) throw new Error("ENVIRONMENT_VERIFICATION_FAILED");
  for (const field of PRESERVED_FIELDS) {
    if (!isDeepStrictEqual(before[field], after[field])) throw new Error(`UNRELATED_CONFIGURATION_CHANGED:${field}`);
  }
}

function safeView(detail, target) {
  const env = variables(detail);
  return { function: target.name, status: detail.Status,
    primary_model: env[`${target.prefix}_MODEL`] || (target.name === "writingTutor" ? env.WRITING_AI_MODEL : null),
    quota_fallback_models: (env[`${target.prefix}_QUOTA_FALLBACK_MODELS`] || env[`${target.prefix}_QUOTA_FALLBACK_MODEL`] || "").split(",").filter(Boolean) };
}

async function configure(client, { apply = false, check = false, emit = console.log, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  desiredPatch(TARGETS[0].prefix);
  const get = (target) => client.call({ Action: "GetFunction", Param: { FunctionName: target.name, Namespace: ENV_ID, ShowCode: "FALSE" } });
  // Read both before any mutation: no half-apply because the second function is missing or unreadable.
  const before = await Promise.all(TARGETS.map(get));
  const expected = before.map((detail, index) => nextVariables(detail, TARGETS[index]));
  before.forEach((detail) => { if (detail.Status !== "Active") throw new Error("FUNCTION_NOT_ACTIVE"); });
  let matched = true;
  for (let index = 0; index < TARGETS.length; index += 1) {
    const target = TARGETS[index], detail = before[index];
    const changed = !isDeepStrictEqual(variables(detail), expected[index]);
    matched = matched && !changed;
    emit(JSON.stringify({ mode: apply ? "apply" : check ? "check" : "dry-run", ...safeView(detail, target), matches_policy: !changed, desired: policy }));
    if (!apply || !changed) continue;
    const fresh = await get(target);
    if (fresh.Status !== "Active") throw new Error("FUNCTION_NOT_ACTIVE");
    ensurePreserved(detail, fresh, variables(detail));
    await client.call({ Action: "UpdateFunctionConfiguration", Param: {
      FunctionName: target.name, Namespace: ENV_ID,
      Environment: { Variables: Object.entries(expected[index]).map(([Key, Value]) => ({ Key, Value })) },
    } });
    let live;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      live = await get(target);
      if (live.Status === "Active" && isDeepStrictEqual(variables(live), expected[index])) break;
      if (attempt % 10 === 0) emit(JSON.stringify({ function: target.name, waiting_for_active: true, status: live.Status }));
      await sleep(1500);
    }
    if (live.Status !== "Active") throw new Error("FUNCTION_UPDATE_NOT_ACTIVE");
    ensurePreserved(detail, live, expected[index]);
    emit(JSON.stringify({ verified: true, ...safeView(live, target), unrelated_configuration_preserved: true }));
  }
  if (apply) {
    const final = await Promise.all(TARGETS.map(get));
    final.forEach((detail, index) => {
      if (detail.Status !== "Active") throw new Error("FUNCTION_NOT_ACTIVE");
      ensurePreserved(before[index], detail, expected[index]);
    });
    emit(JSON.stringify({ paired_configuration_verified: true, policy }));
  } else if (check && !matched) throw new Error("TEXT_MODEL_CONFIGURATION_DRIFT");
  return { matched: apply || matched };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--apply", "--check"].includes(arg)) || args.length > 1) throw new Error("USE_NO_FLAG_OR_APPLY_OR_CHECK");
  const Manager = require("@cloudbase/manager-node");
  const credential = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/.cloudbase/auth.json"), "utf8")).credential;
  const app = new Manager({ envId: ENV_ID, region: "ap-shanghai",
    secretId: credential.secretId || credential.tmpSecretId,
    secretKey: credential.secretKey || credential.tmpSecretKey,
    token: credential.token || credential.tmpToken });
  await configure(app.commonService("scf", "2018-04-16"), { apply: args.includes("--apply"), check: args.includes("--check") });
}

if (require.main === module) main().catch((error) => {
  // SDK errors may contain request details; emit only a bounded code and known local errors.
  console.error(JSON.stringify({ code: String(error.code || "TEXT_MODEL_CONFIGURATION_FAILED").slice(0,120),
    reason: /^[A-Z_]+(?::[A-Za-z]+)?$/.test(String(error.message)) ? error.message : "Cloud request failed; refresh the CloudBase CLI login and rerun --check before retrying --apply." }));
  process.exitCode = 1;
});
module.exports = { policy, TARGETS, desiredPatch, variables, configure };
