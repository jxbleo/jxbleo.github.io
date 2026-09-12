#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const library = require("../cloudfunctions/_shared/speaking-voiceprint-library");
const tencent = require("../cloudfunctions/_shared/tencent-asr-voiceprint");
const lab = require("../cloudfunctions/_shared/speaking-lab");
const error = (code) => new tencent.TencentVoiceprintError(code);

function fixture(occupancy = { mrcat_speaking: 20 }) {
  const counts = new Map(Object.entries(occupancy));
  const calls = [];
  let sequence = 0;
  const provider = {
    groupId: () => "mrcat_speaking",
    count: async ({ group }) => { calls.push(["count", group || "all"]); return { total: group ? counts.get(group) || 0 : [...counts.values()].reduce((a, b) => a + b, 0) }; },
    listGroups: async () => ({ groups: [...counts.keys()] }),
    enroll: async ({ group, subjectKey }) => {
      calls.push(["enroll", group, subjectKey]);
      if ((counts.get(group) || 0) >= 20) throw error("VOICEPRINT_CAPACITY_REACHED");
      counts.set(group, (counts.get(group) || 0) + 1);
      return { voiceprintId: `id-${++sequence}`, requestId: `request-${sequence}` };
    },
  };
  return { counts, calls, provider };
}

async function run() {
  const input = { audioBase64: "in-memory-only", subjectKey: "vip:test" };
  for (const base of ["mrcat_speaking", "a".repeat(128)]) {
    const names = Array.from({ length: 1000 }, (_, i) => library.groupAt(base, i));
    assert.equal(names[0], base);
    assert.equal(new Set(names).size, 1000);
    assert(names.every((name) => /^[A-Za-z_]{1,128}$/.test(name)));
  }
  assert.equal(library.groupAt("mrcat_speaking", 1), "mrcat_speaking_A");
  assert.equal(library.groupAt("mrcat_speaking", 27), "mrcat_speaking_AA");

  const fullGroup = fixture();
  const next = await library.enrollAvailable(input, fullGroup);
  assert.equal(next.groupId, "mrcat_speaking_A");
  assert.equal(fullGroup.counts.get("mrcat_speaking"), 20, "old IDs need no migration");
  assert.equal(fullGroup.counts.get("mrcat_speaking_A"), 1);

  const holes = fixture({ mrcat_speaking: 19, mrcat_speaking_A: 20, another_application: 5 });
  assert.equal((await library.enrollAvailable(input, holes)).groupId, "mrcat_speaking");
  assert.equal(holes.counts.get("another_application"), 5);

  // All requests read stale counts before the provider atomically grants slots.
  const race = fixture({ mrcat_speaking: 19 });
  const registered = await Promise.all(Array.from({ length: 25 }, (_, i) => library.enrollAvailable({ ...input, subjectKey: `vip:${i}` }, race)));
  assert.equal(new Set(registered.map((row) => row.voiceprintId)).size, 25);
  assert.deepEqual([...race.counts.values()], [20, 20, 4]);
  assert(race.calls.filter(([action]) => action === "enroll").length > 25, "definite full-group races retry automatically");

  const fullAccount = fixture({ unrelated: 1000 });
  await assert.rejects(library.enrollAvailable(input, fullAccount), { code: "VOICEPRINT_CAPACITY_REACHED" });
  assert.equal(fullAccount.calls.some(([action]) => action === "enroll"), false);
  assert.deepEqual(await library.registrationAvailability(null, fullAccount), { available: false, code: "VOICEPRINT_CAPACITY_REACHED" });
  const priorCalls = fullAccount.calls.length;
  assert.deepEqual(await library.registrationAvailability({ status: "active", provider_voiceprint_id: "existing" }, fullAccount), { available: true, code: null });
  assert.equal(fullAccount.calls.length, priorCalls, "updates bypass allocation and account fullness");
  assert.equal((await library.registrationAvailability({ status: "delete_pending" }, fullAccount)).code, "VOICEPRINT_BUSY");

  const unknown = fixture({});
  let unknownAttempts = 0;
  unknown.provider.enroll = async () => { unknownAttempts++; throw error("VOICEPRINT_PROVIDER_UNAVAILABLE"); };
  await assert.rejects(library.enrollAvailable(input, unknown), { code: "VOICEPRINT_PROVIDER_UNAVAILABLE" });
  assert.equal(unknownAttempts, 1, "uncertain enroll timeouts must not create duplicate IDs");
  const racingAccount = fixture({ mrcat_speaking: 19 });
  racingAccount.provider.enroll = async () => { racingAccount.counts.set("other", 981); throw error("VOICEPRINT_CAPACITY_REACHED"); };
  await assert.rejects(library.enrollAvailable(input, racingAccount), { code: "VOICEPRINT_CAPACITY_REACHED" });
  const busy = fixture({});
  let busyAttempts = 0;
  busy.provider.enroll = async () => { busyAttempts++; throw error("VOICEPRINT_CAPACITY_REACHED"); };
  await assert.rejects(library.enrollAvailable(input, busy), { code: "VOICEPRINT_BUSY" });
  assert.equal(busyAttempts, 3);

  const groups = library.groupsForProfiles([
    { provider_voiceprint_id: "legacy" },
    { provider_voiceprint_id: "new", provider_group_id: "mrcat_speaking_A" },
    { provider_voiceprint_id: "same-group", provider_group_id: "mrcat_speaking_A" },
    { status: "deleted" },
  ], "mrcat_speaking");
  assert.deepEqual(groups, ["mrcat_speaking", "mrcat_speaking_A"]);
  let active = 0, peak = 0;
  const scores = { mrcat_speaking: [{ voiceprintId: "alice", score: 81 }], mrcat_speaking_A: [{ voiceprintId: "bob", score: 87 }] };
  const matchProvider = { identify: async ({ group, topN }, options) => {
    assert.equal(topN, 20);
    assert(options.timeoutMs <= 5000);
    peak = Math.max(peak, ++active);
    await new Promise(setImmediate);
    active--;
    return { matches: scores[group] || [] };
  } };
  const identified = await library.identifyAcrossGroups({ audioBase64: input.audioBase64, groups: [...groups, "extra", ...groups] }, { provider: matchProvider });
  assert.equal(peak, 2);
  assert.deepEqual(identified.matches.map((m) => m.voiceprintId), ["bob", "alice"]);
  const result = lab.automaticVoiceMatches([{ speaker_key: "spk_01", matches: identified.matches.map((m) => ({ student_uid: m.voiceprintId, score: m.score })) }])[0];
  assert.equal(result.student_uid, "bob", "global best may belong to a different group");
  assert.equal(result.status, "matched", "preserve the current 70-point rule without reintroducing a margin gate");
  assert.equal(result.margin, 6);
  const conflicted = lab.automaticVoiceMatches(["spk_01", "spk_02"].map((speaker_key) => ({ speaker_key, matches: identified.matches.map((m) => ({ student_uid: m.voiceprintId, score: m.score })) })));
  assert.equal(conflicted.filter((m) => m.status === "matched").length, 1);
  await assert.rejects(library.identifyAcrossGroups({ audioBase64: input.audioBase64, groups }, { provider: { identify: async ({ group }) => {
    if (group.endsWith("_A")) throw error("VOICEPRINT_PROVIDER_UNAVAILABLE");
    return { matches: [{ voiceprintId: "wrong-if-partial", score: 99 }] };
  } } }), { code: "VOICEPRINT_PROVIDER_UNAVAILABLE" });
  let deadlineCalls = 0;
  await assert.rejects(library.identifyAcrossGroups({ audioBase64: input.audioBase64, groups }, { deadlineAt: 10, now: () => 11, provider: { identify: async () => { deadlineCalls++; } } }), { code: "VOICEPRINT_PROVIDER_UNAVAILABLE" });
  assert.equal(deadlineCalls, 0);
  let largeGroupCalls = 0;
  const largeGroups = Array.from({ length: 50 }, (_, index) => library.groupAt("mrcat_speaking", index));
  await library.identifyAcrossGroups({ audioBase64: input.audioBase64, groups: largeGroups }, { now: () => 1, provider: { identify: async () => { largeGroupCalls++; return { matches: [] }; } } });
  assert.equal(largeGroupCalls, 50, "1,000 registered speakers must not be truncated to the first group");

  // Execute the actual service with a small transaction double to verify that
  // updates preserve their original group and concurrent subject creation loses
  // safely, cleaning up only the newly created provider ID.
  const source = fs.readFileSync(path.join(__dirname, "../cloudfunctions/speakingLab/index.js"), "utf8");
  const baseProfiles = [{ _id: "profile", subject_key: "vip:u", status: "active", provider_voiceprint_id: "old-id", provider_group_id: "mrcat_speaking_A", enrollment_revision: 2 }];
  const writes = [], removed = [];
  let currentRows = baseProfiles;
  const collection = () => ({ where: () => ({ limit: () => ({ get: async () => ({ data: currentRows }) }) }), doc: (id) => ({ update: async (row) => writes.push({ id, row }), create: async (row) => writes.push({ id, row }) }) });
  const context = {
    db: { command: { in: (values) => values }, runTransaction: async (fn) => fn({ collection }) },
    VOICEPRINTS: "speaking_voiceprints", VOICEPRINT_PASSAGE_VERSION: "test",
    ownVoiceprintSubject: () => ({ kind: "vip", subject_key: "vip:u", student_uid: "u", participant_id: null, discussion_id: null }),
    getOne: async (name) => name === "speaking_voiceprint_events" ? null : baseProfiles[0] || null,
    VOICEPRINT_EVENTS: "speaking_voiceprint_events", lab, stable: () => "new-profile", now: () => new Date(0),
    voiceprintProfiles: async () => [], appendVoiceprintEvent: async () => {}, publicVoiceprintTarget: (_subject, row) => row,
    voiceprintProvider: { validateWavBase64: () => ({ base64: "audio", durationMs: 10000 }), groupId: () => "mrcat_speaking", update: async () => ({ voiceprintId: "old-id" }), remove: async ({ voiceprintId }) => removed.push(voiceprintId) },
    voiceprintLibrary: { enrollAvailable: async () => ({ voiceprintId: "new-id", groupId: "mrcat_speaking_B" }) },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("async function saveVoiceprint("), source.indexOf("async function deleteVoiceprint(")), context);
  await context.saveVoiceprint({ auth_uid: "u", role: "student" }, { consent_confirmed: true, operation_id: "operation-update", audio_base64: "audio" }, false);
  assert.equal(writes[0].row.provider_group_id, "mrcat_speaking_A");
  assert.equal(writes[0].row.provider_voiceprint_id, "old-id");
  assert.equal(writes[0].row.enrollment_revision, 3);
  baseProfiles.length = 0;
  currentRows = [];
  writes.length = 0;
  await context.saveVoiceprint({ auth_uid: "u", role: "student" }, { consent_confirmed: true, operation_id: "operation-new", audio_base64: "audio" }, false);
  assert.equal(writes[0].row.provider_group_id, "mrcat_speaking_B");
  assert.equal(writes[0].row.provider_voiceprint_id, "new-id");
  assert.equal(Object.hasOwn(writes[0].row, "data"), false);
  currentRows = [{ _id: "winner", status: "active", provider_voiceprint_id: "winner-id" }];
  await assert.rejects(context.saveVoiceprint({ auth_uid: "u" }, { consent_confirmed: true, operation_id: "operation-race", audio_base64: "audio" }, false), /VOICEPRINT_STALE/);
  assert.deepEqual(removed, ["new-id"]);
  baseProfiles.push({ status: "delete_pending" });
  await assert.rejects(context.saveVoiceprint({ auth_uid: "u" }, { consent_confirmed: true, operation_id: "operation-pending", audio_base64: "audio" }, false), /VOICEPRINT_BUSY/);

  const studentSource = fs.readFileSync(path.join(__dirname, "../assets/js/speaking-lab.js"), "utf8");
  const nodes = new Map();
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, { disabled: false, hidden: false, textContent: "", classList: { toggle() {}, remove() {} } }); return nodes.get(id); };
  const uiCalls = [];
  const ui = {
    document: { getElementById: node }, voiceprintLoadGeneration: 0,
    voiceprintProviderConfigured: true, voiceprintRegistrationAvailable: true, voiceprintRegistrationMessage: "",
    voiceprintController: null, voiceprintPressToken: 0, voiceprintTime: () => "00:00", friendlyError: (e) => e.message,
    call: async (action, payload) => { uiCalls.push({ action, payload }); return { provider_configured: true, target: { voiceprint: { status: "missing" } }, registration: { available: false, message: "Account capacity reached." } }; },
  };
  vm.createContext(ui);
  vm.runInContext(studentSource.slice(studentSource.indexOf("    function renderMyVoiceprint("), studentSource.indexOf("    function saveVoiceprintRecording(")), ui);
  await ui.loadMyVoiceprint(true);
  assert.equal(uiCalls[0].payload.check_capacity, true);
  assert.equal(node("voiceprint-record").disabled, true);
  ui.resetVoiceprintPage();
  assert.equal(node("voiceprint-record").disabled, true, "page reset must retain the capacity gate");
  assert.equal(node("voiceprint-message").textContent, "Account capacity reached.");
  ui.renderMyVoiceprint({ target: { voiceprint: { status: "active" } }, provider_configured: true, registration: { available: true } });
  assert.equal(node("voiceprint-record").disabled, false, "an existing ID remains replaceable");
  console.log("Speaking voiceprint multi-group allocation, matching and lifecycle tests passed.");
}

module.exports = run;
if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });
