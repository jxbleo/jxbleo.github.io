"use strict";

const crypto = require("crypto");
const tencent = require("./tencent-asr-voiceprint");

// Tencent ASR's published limits. A GroupId is storage routing, never a class
// or an identity boundary. Existing IDs and groups must survive updates.
const GROUP_CAPACITY = 20;
const ACCOUNT_CAPACITY = 1000;
const GROUP_LIMIT = 1000;
const MAX_ALLOCATION_CHECKS = 8;
const MAX_ENROLL_ATTEMPTS = 3;
const MATCH_CONCURRENCY = 2;

function failure(code) { return new tencent.TencentVoiceprintError(code); }
function groupAt(base, index) {
  if (!/^[A-Za-z_]{1,128}$/.test(base) || !Number.isInteger(index) || index < 0 || index >= GROUP_LIMIT) throw failure("SPEAKING_VOICEPRINT_NOT_CONFIGURED");
  if (index === 0) return base;
  let suffix = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) suffix = String.fromCharCode(65 + (value - 1) % 26) + suffix;
  const prefix = base.length <= 120 ? base : `${base.slice(0, 108)}_${crypto.createHash("sha256").update(base).digest("hex").slice(0, 8).replace(/[0-9]/g, (digit) => String.fromCharCode(75 + Number(digit)))}`;
  return `${prefix}_${suffix}`;
}

async function registrationAvailability(profile, options = {}) {
  // Replacing an existing ID uses no new capacity, even at the account limit.
  if (profile && profile.status === "active" && profile.provider_voiceprint_id) return { available: true, code: null };
  if (profile && profile.status === "delete_pending") return { available: false, code: "VOICEPRINT_BUSY" };
  try {
    const { total } = await (options.provider || tencent).count({}, { timeoutMs: 5000 });
    return { available: total < ACCOUNT_CAPACITY, code: total < ACCOUNT_CAPACITY ? null : "VOICEPRINT_CAPACITY_REACHED" };
  } catch (error) {
    return { available: false, code: error && error.code || "VOICEPRINT_PROVIDER_UNAVAILABLE" };
  }
}

async function enrollAvailable({ audioBase64, subjectKey, profiles = [] }, options = {}) {
  const provider = options.provider || tencent;
  const base = options.baseGroup || provider.groupId();
  const requestOptions = { timeoutMs: 5000 };
  const { total } = await provider.count({}, requestOptions);
  if (total >= ACCOUNT_CAPACITY) throw failure("VOICEPRINT_CAPACITY_REACHED");
  const { groups } = await provider.listGroups(requestOptions);
  const existingGroups = new Set(groups);
  const managed = Array.from({ length: GROUP_LIMIT }, (_, index) => groupAt(base, index));
  const hints = new Map();
  profiles.forEach((profile) => {
    if (profile.provider_voiceprint_id && profile.status !== "deleted") {
      const group = profile.provider_group_id || base;
      hints.set(group, (hints.get(group) || 0) + 1);
    }
  });
  // Database occupancy only orders candidates; Tencent always checks capacity.
  const vacant = managed.filter((group) => existingGroups.has(group) && (hints.get(group) || 0) < GROUP_CAPACITY);
  const fullHints = managed.filter((group) => existingGroups.has(group) && (hints.get(group) || 0) >= GROUP_CAPACITY);
  const fresh = managed.filter((group) => !existingGroups.has(group));
  const candidates = [...vacant, ...(existingGroups.size < GROUP_LIMIT ? fresh : []), ...fullHints];
  let attempts = 0;
  let checks = 0;
  for (const group of candidates) {
    if (++checks > MAX_ALLOCATION_CHECKS || attempts >= MAX_ENROLL_ATTEMPTS) break;
    if (existingGroups.has(group)) {
      if ((await provider.count({ group }, requestOptions)).total >= GROUP_CAPACITY) continue;
    } else {
      if (existingGroups.size >= GROUP_LIMIT) continue;
      existingGroups.add(group);
    }
    attempts += 1;
    try {
      const result = await provider.enroll({ audioBase64, subjectKey, group }, { timeoutMs: 30000 });
      return { ...result, groupId: group };
    } catch (error) {
      // Retry only a definite refusal: timeouts may already have created an ID.
      // Tencent atomically enforces the last slot when registrants race.
      if (!error || error.code !== "VOICEPRINT_CAPACITY_REACHED") throw error;
      if ((await provider.count({}, requestOptions)).total >= ACCOUNT_CAPACITY) throw failure("VOICEPRINT_CAPACITY_REACHED");
    }
  }
  throw failure("VOICEPRINT_BUSY");
}

function groupsForProfiles(profiles, base = tencent.groupId()) {
  return [...new Set(profiles.filter((profile) => profile.provider_voiceprint_id).map((profile) => profile.provider_group_id || base))].sort();
}

async function identifyAcrossGroups({ audioBase64, groups }, options = {}) {
  const provider = options.provider || tencent;
  const selected = [...new Set(groups)];
  if (selected.length > GROUP_LIMIT || selected.some((group) => typeof group !== "string" || !/^[A-Za-z_]{1,128}$/.test(group))) throw failure("VOICEPRINT_PROVIDER_INVALID_RESPONSE");
  const clock = options.now || Date.now;
  const deadline = options.deadlineAt || clock() + 20000;
  const matches = [];
  let cursor = 0;
  let failed = null;
  async function worker() {
    while (!failed && cursor < selected.length) {
      const group = selected[cursor++];
      const remaining = deadline - clock();
      if (remaining <= 0) { failed = failure("VOICEPRINT_PROVIDER_UNAVAILABLE"); return; }
      try {
        // Include the whole group so inactive/Guest records cannot hide an
        // eligible runner-up below a prematurely truncated top-N result.
        const result = await provider.identify({ audioBase64, group, topN: GROUP_CAPACITY }, { timeoutMs: Math.min(5000, remaining) });
        matches.push(...result.matches);
      } catch (error) { failed = error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MATCH_CONCURRENCY, selected.length) }, worker));
  // Never use partial group results: the missing group could contain a closer
  // match. The existing identity rules run only after the global merge.
  if (failed) throw failed;
  if (selected.length && clock() > deadline) throw failure("VOICEPRINT_PROVIDER_UNAVAILABLE");
  const unique = new Map();
  for (const match of matches) {
    const prior = unique.get(match.voiceprintId);
    if (!prior || Number(match.score) > Number(prior.score)) unique.set(match.voiceprintId, match);
  }
  return { matches: [...unique.values()].sort((a, b) => Number(b.score) - Number(a.score)) };
}

module.exports = { GROUP_CAPACITY, ACCOUNT_CAPACITY, groupAt, registrationAvailability, enrollAvailable, groupsForProfiles, identifyAcrossGroups };
