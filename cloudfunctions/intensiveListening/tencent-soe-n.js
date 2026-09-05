"use strict";

/* Tencent Smart Oral Evaluation New Age adapter.
 * This module is the only place where SOE-N parameters, signing, and the
 * provider WebSocket protocol are known. It is never imported by browser code.
 */

const crypto = require("crypto");

const PROVIDER = "tencent_soe_n";
const PROVIDER_REVISION = "soe-n-wss-v1";
const DEFAULT_ENDPOINT = "wss://soe.cloud.tencent.com/soe/api/";

function value(value) {
  return String(value == null ? "" : value).trim();
}

function encode(value) {
  return encodeURIComponent(String(value == null ? "" : value));
}

function assertEndpoint(endpoint) {
  const raw = value(endpoint || DEFAULT_ENDPOINT);
  let parsed;
  try { parsed = new URL(raw); } catch (_error) { throw new Error("SOE_ENDPOINT_INVALID"); }
  if (
    parsed.protocol !== "wss:"
    || parsed.host !== "soe.cloud.tencent.com"
    || !["/soe/api", "/soe/api/"].includes(parsed.pathname)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) throw new Error("SOE_ENDPOINT_INVALID");
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function sortedQuery(parameters) {
  return Object.keys(parameters || {})
    .filter((key) => parameters[key] != null && parameters[key] !== "")
    .sort()
    .map((key) => `${key}=${parameters[key]}`)
    .join("&");
}

function signature(parameters, secretKey, requestTarget = "") {
  return crypto.createHmac("sha1", value(secretKey)).update(`${requestTarget}${sortedQuery(parameters)}`).digest("base64");
}

function unixSeconds(input, fallback) {
  const number = Number(input == null ? fallback : input);
  if (!Number.isFinite(number)) throw new Error("SOE_TIME_INVALID");
  return Math.floor(number > 100000000000 ? number / 1000 : number);
}

function buildSignedUrl(options = {}) {
  const appId = value(options.appId || options.app_id);
  const secretId = value(options.secretId || options.secret_id);
  const secretKey = value(options.secretKey || options.secret_key);
  if (!appId || !secretId || !secretKey) throw new Error("SOE_NOT_CONFIGURED");
  const endpoint = assertEndpoint(options.endpoint || DEFAULT_ENDPOINT);
  const referenceText = value(options.referenceText || options.reference_text);
  if (!referenceText) throw new Error("SOE_REFERENCE_INVALID");
  const timestamp = unixSeconds(options.timestamp, Date.now());
  const params = {
    timestamp,
    expired: unixSeconds(options.expired, timestamp + 300),
    nonce: Number(options.nonce || crypto.randomInt(1, 2147483647)),
    voice_id: value(options.voiceId || options.voice_id) || crypto.randomUUID(),
    secretid: secretId,
    server_engine_type: "16k_en",
    eval_mode: 1,
    rec_mode: 1,
    voice_format: 1,
    text_mode: 0,
    ref_text: referenceText,
    sentence_info_enabled: 0,
    score_coeff: Number(options.scoreCoeff == null ? 1 : options.scoreCoeff),
  };
  if (!(params.expired > params.timestamp)) throw new Error("SOE_TIME_INVALID");
  const parsed = new URL(endpoint);
  const requestTarget = `${parsed.host}${parsed.pathname}${encode(appId)}?`;
  const signed = signature(params, secretKey, requestTarget);
  const signedParams = { ...params, signature: signed };
  const query = Object.keys(signedParams)
    .sort()
    .map((key) => `${encode(key)}=${encode(signedParams[key] == null ? "" : signedParams[key])}`)
    .join("&");
  return `${endpoint}${encode(appId)}?${query}`;
}

function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeWord(word) {
  const source = word || {};
  return {
    reference_word: value(source.ReferenceWord || source.reference_word || source.Reference || source.reference),
    word: value(source.Word || source.word || source.CurrentWord || source.current_word),
    match_tag: source.MatchTag == null ? (source.match_tag == null ? source.matchTag : source.match_tag) : source.MatchTag,
    pron_accuracy: optionalNumber(source.PronAccuracy == null ? source.pron_accuracy : source.PronAccuracy),
    begin_ms: optionalNumber(source.MemBeginTime == null ? (source.BeginTime == null ? (source.begin_ms == null ? source.beginMs : source.begin_ms) : source.BeginTime) : source.MemBeginTime),
    end_ms: optionalNumber(source.MemEndTime == null ? (source.EndTime == null ? (source.end_ms == null ? source.endMs : source.end_ms) : source.EndTime) : source.MemEndTime),
  };
}

function normalizeResponse(payload) {
  const source = typeof payload === "string" ? JSON.parse(payload) : (payload || {});
  const data = source.result || source.Result || source.Data || source.data || source;
  const words = data.Words || data.words || data.WordResults || data.word_results || [];
  return {
    provider: PROVIDER,
    provider_revision: PROVIDER_REVISION,
    request_id: value(data.RequestId || data.request_id || source.RequestId || source.request_id || source.message_id || source.voice_id).slice(0, 200),
    suggested_score: optionalNumber(data.SuggestedScore == null ? data.suggested_score : data.SuggestedScore),
    pron_accuracy: optionalNumber(data.PronAccuracy == null ? data.pron_accuracy : data.PronAccuracy),
    pron_fluency: optionalNumber(data.PronFluency == null ? data.pron_fluency : data.PronFluency),
    pron_completion: optionalNumber(data.PronCompletion == null ? data.pron_completion : data.PronCompletion),
    words: Array.isArray(words) ? words.slice(0, 120).map(normalizeWord) : [],
  };
}

function classifyError(error, phase) {
  const source = value(error && (error.code || error.message || error)).toLowerCase();
  if (source.includes("config") || source.includes("credential") || source.includes("secret")) return "not_configured";
  if (source.includes("auth") || source.includes("sign") || source.includes("appid")) return "provider_auth_failed";
  if (source.includes("429") || source.includes("quota") || source.includes("rate")) return "quota_rate_limited";
  if (source.includes("invalid") || source.includes("format") || source.includes("reference")) return phase === "audio" ? "invalid_audio" : "invalid_reference";
  if (source.includes("timeout") || source.includes("timed out")) return phase === "sent" ? "outcome_unknown" : "timeout_before_send";
  if (source.includes("response") || source.includes("json")) return "invalid_provider_response";
  return "provider_unavailable";
}

function configFromEnv(env = process.env) {
  const enabled = value(env.LISTENING_SHADOWING_SCORING_ENABLED).toLowerCase() === "true";
  return {
    enabled,
    appId: value(env.TENCENTCLOUD_APPID),
    secretId: value(env.TENCENTCLOUD_SECRETID),
    secretKey: value(env.TENCENTCLOUD_SECRETKEY),
    endpoint: value(env.LISTENING_SHADOWING_SOE_ENDPOINT) || DEFAULT_ENDPOINT,
  };
}

function resolveSocket(factory) {
  if (factory) return factory;
  // Loading ws lazily avoids making automated tests or disabled production
  // deployments depend on a provider client at module load time.
  try { return require("ws"); } catch (_error) {
    if (typeof WebSocket !== "undefined") return WebSocket;
    throw new Error("SOE_WEBSOCKET_UNAVAILABLE");
  }
}

function evaluate(audioBuffer, options = {}) {
  const config = { ...configFromEnv(options.env || process.env), ...options };
  if (config.enabled !== true) return Promise.reject(Object.assign(new Error("SOE_SCORING_DISABLED"), { category: "not_configured" }));
  if (!config.appId || !config.secretId || !config.secretKey) return Promise.reject(Object.assign(new Error("SOE_NOT_CONFIGURED"), { category: "not_configured" }));
  const referenceText = value(options.referenceText || options.reference_text);
  const words = referenceText ? referenceText.split(/\s+/).filter(Boolean) : [];
  if (!referenceText || words.length < 1 || words.length > 30) return Promise.reject(Object.assign(new Error("SOE_REFERENCE_INVALID"), { category: "invalid_reference" }));
  const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer || []);
  if (!buffer.length) return Promise.reject(Object.assign(new Error("SOE_AUDIO_INVALID"), { category: "invalid_audio" }));
  let url;
  try {
    url = buildSignedUrl({ ...config, voiceId: options.voiceId || options.voice_id, scoreCoeff: options.scoreCoeff, referenceText });
  } catch (error) {
    error.category = classifyError(error, "connect");
    return Promise.reject(error);
  }
  const WebSocketClient = resolveSocket(options.webSocketFactory);
  const timeoutMs = Math.max(800, Math.min(8500, Number(options.timeoutMs || 7000)));
  let socket;
  let sent = false;
  let settled = false;
  let latestResult = null;
  return new Promise((resolve, reject) => {
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (socket && typeof socket.close === "function") socket.close(); } catch (_error) { /* no-op */ }
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => {
      const error = new Error(sent ? "SOE_RESULT_TIMEOUT" : "SOE_CONNECT_TIMEOUT");
      error.category = classifyError(error, sent ? "sent" : "connect");
      finish(error);
    }, timeoutMs);
    try { socket = new WebSocketClient(url); } catch (error) {
      error.category = classifyError(error, "connect");
      finish(error); return;
    }
    const sendAudio = () => {
      if (sent || settled) return;
      try {
        socket.send(buffer);
        sent = true;
        socket.send(JSON.stringify({ type: "end" }));
      } catch (error) {
        error.category = sent ? "outcome_unknown" : classifyError(error, "audio");
        finish(error);
      }
    };
    const onOpen = () => { /* Tencent sends a JSON handshake result before audio is accepted. */ };
    const onMessage = (event) => {
      try {
        const payload = event && event.data != null ? event.data : event;
        const source = JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8"));
        if (Number(source.code) !== 0) {
          const providerError = new Error(`SOE_PROVIDER_${Number(source.code) || "ERROR"}`);
          providerError.category = classifyError(source.message || providerError, sent ? "sent" : "connect");
          finish(providerError);
          return;
        }
        if (source.result || source.Result || source.Data || source.data) latestResult = source;
        if (!sent) { sendAudio(); return; }
        if (Number(source.final) === 1) {
          const finalPayload = (source.result || source.Result || source.Data || source.data) ? source : latestResult;
          if (!finalPayload) throw new Error("SOE_RESPONSE_INVALID");
          finish(null, normalizeResponse(finalPayload));
        }
      } catch (error) {
        error.category = "invalid_provider_response";
        finish(error);
      }
    };
    const onError = (error) => {
      const wrapped = error instanceof Error ? error : new Error(value(error));
      wrapped.category = classifyError(wrapped, sent ? "sent" : "connect");
      finish(wrapped);
    };
    if (typeof socket.on === "function") {
      socket.on("open", onOpen);
      socket.on("message", onMessage);
      socket.on("error", onError);
      socket.on("close", () => { if (!settled) onError(new Error("SOE_SOCKET_CLOSED")); });
    } else {
      socket.onopen = onOpen;
      socket.onmessage = onMessage;
      socket.onerror = onError;
      socket.onclose = () => { if (!settled) onError(new Error("SOE_SOCKET_CLOSED")); };
    }
  });
}

module.exports = {
  PROVIDER,
  PROVIDER_REVISION,
  DEFAULT_ENDPOINT,
  assertEndpoint,
  sortedQuery,
  signature,
  buildSignedUrl,
  normalizeResponse,
  classifyError,
  configFromEnv,
  evaluate,
};
