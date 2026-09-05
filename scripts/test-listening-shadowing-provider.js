#!/usr/bin/env node

const assert = require("assert");
const soe = require("../cloudfunctions/intensiveListening/tencent-soe-n");

const url = soe.buildSignedUrl({ appId: "app", secretId: "id", secretKey: "key", timestamp: 1700000000, expired: 1700000300, nonce: 7, voiceId: "voice", referenceText: "hello world", endpoint: soe.DEFAULT_ENDPOINT });
assert.match(url, /server_engine_type=16k_en/);
assert.match(url, /eval_mode=1/);
assert.match(url, /rec_mode=1/);
assert.match(url, /voice_format=1/);
assert.match(url, /text_mode=0/);
assert.match(url, /secretid=id/);
assert.match(url, /ref_text=hello%20world/);
assert.match(url, /signature=/);
assert.doesNotMatch(url, /app_id=|secret_id=|(?:[?&])sign=/);
const parsed = new URL(url);
const signature = parsed.searchParams.get("signature");
const params = Object.fromEntries(Array.from(parsed.searchParams.entries()).filter(function(entry) { return entry[0] !== "signature"; }));
assert.strictEqual(signature, soe.signature(params, "key", "soe.cloud.tencent.com/soe/api/app?"), "signature must include the documented host/path/appid prefix and the unescaped sorted query");
assert.throws(() => soe.buildSignedUrl({ appId: "app", secretId: "id", secretKey: "key", endpoint: "https://example.invalid/" }), /SOE_ENDPOINT_INVALID/);
assert.strictEqual(soe.configFromEnv({ LISTENING_SHADOWING_SCORING_ENABLED: "false" }).enabled, false);
assert.strictEqual(soe.classifyError(new Error("timeout"), "sent"), "outcome_unknown");
assert.strictEqual(soe.classifyError(new Error("timeout"), "connect"), "timeout_before_send");
const normalized = soe.normalizeResponse({ Data: { RequestId: "req-1", SuggestedScore: 84.2, PronAccuracy: 83, Words: [{ ReferenceWord: "hello", Word: "hello", MatchTag: 0, PronAccuracy: 91 }] } });
assert.throws(() => soe.assertEndpoint("wss://soe.cloud.tencent.com/not-soe/"), /SOE_ENDPOINT_INVALID/);
assert.throws(() => soe.assertEndpoint("wss://soe.cloud.tencent.com:8443/soe/api/"), /SOE_ENDPOINT_INVALID/);
assert.strictEqual(normalized.provider, soe.PROVIDER);
assert.strictEqual(normalized.suggested_score, 84.2);
assert.strictEqual(soe.normalizeResponse({ result: { Words: [{ ReferenceWord: "hello", MatchTag: 0 }] } }).suggested_score, null);
assert.strictEqual(soe.normalizeResponse({ result: { Words: [{ ReferenceWord: "hello", MatchTag: 0 }] } }).words[0].pron_accuracy, null);
assert.strictEqual(normalized.words[0].reference_word, "hello");

const fixtureMessages = [];
class FixtureSocket {
  constructor() { this.handlers = {}; setImmediate(() => this.handlers.open && this.handlers.open()); }
  on(name, handler) { this.handlers[name] = handler; }
  send(payload) {
    fixtureMessages.push(payload);
    if (Buffer.isBuffer(payload)) return;
    assert.deepStrictEqual(JSON.parse(payload), { type: "end" });
    setImmediate(() => this.handlers.message && this.handlers.message(JSON.stringify({ code: 0, message_id: "fixture", final: 1, result: { SuggestedScore: 88, PronAccuracy: 88, PronFluency: 88, PronCompletion: 88, Words: [] } })));
  }
  close() {}
}
const OriginalFixtureSocket = FixtureSocket;
class HandshakeFixtureSocket extends OriginalFixtureSocket {
  constructor(url) {
    super(url);
    setImmediate(() => this.handlers.message && this.handlers.message(JSON.stringify({ code: 0, message: "success", voice_id: "fixture-voice" })));
  }
}
soe.evaluate(Buffer.from("audio"), {
  enabled: true, appId: "app", secretId: "id", secretKey: "key", referenceText: "hello world", endpoint: soe.DEFAULT_ENDPOINT,
  webSocketFactory: HandshakeFixtureSocket,
}).then((result) => {
  assert.strictEqual(fixtureMessages.length, 2, "recording mode must send one binary WAV message followed by one end message");
  assert(Buffer.isBuffer(fixtureMessages[0]));
  assert.deepStrictEqual(JSON.parse(fixtureMessages[1]), { type: "end" });
  assert.strictEqual(result.request_id, "fixture");
  assert.strictEqual(result.suggested_score, 88);
  console.log("Listening Shadowing provider fixture tests passed.");
}).catch((error) => { console.error(error); process.exitCode = 1; });
