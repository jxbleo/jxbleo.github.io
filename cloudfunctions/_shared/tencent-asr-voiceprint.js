"use strict";

/*
 * Minimal Tencent ASR voiceprint adapter.
 *
 * The adapter deliberately uses Node 18's built-in fetch and crypto modules so
 * the cloud function does not need the complete Tencent SDK. Credentials are
 * read only from the CloudBase runtime environment and are never accepted from
 * a browser request.
 */

const crypto = require("crypto");

const API_VERSION = "2019-06-14";
const SERVICE = "asr";
const DEFAULT_ENDPOINT = "https://asr.tencentcloudapi.com";
const DEFAULT_GROUP_ID = "mrcat_speaking";
const SAMPLE_RATE = 16000;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MIN_AUDIO_MS = 8000;
const MAX_AUDIO_MS = 30000;

class TencentVoiceprintError extends Error {
  constructor(code, options = {}) {
    super(code);
    this.name = "TencentVoiceprintError";
    this.code = code;
    this.providerCode = options.providerCode || null;
    this.requestId = options.requestId || null;
  }
}

function text(value, limit = 200) {
  return String(value == null ? "" : value).trim().slice(0, limit);
}

function sha256(value, encoding = "hex") {
  return crypto.createHash("sha256").update(value).digest(encoding);
}

function hmacSha256(value, secret, encoding) {
  return crypto.createHmac("sha256", secret).update(value).digest(encoding);
}

function utcDate(timestamp) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function omitNullish(value) {
  if (Array.isArray(value)) return value.map(omitNullish);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined)
    .map(([key, item]) => [key, omitNullish(item)]));
}

function credentials(source = process.env) {
  const secretId = text(source.TENCENTCLOUD_SECRETID, 300);
  const secretKey = text(source.TENCENTCLOUD_SECRETKEY, 300);
  if (!secretId || !secretKey) throw new TencentVoiceprintError("SPEAKING_VOICEPRINT_NOT_CONFIGURED");
  return {
    secretId,
    secretKey,
    token: text(source.TENCENTCLOUD_SESSIONTOKEN, 2000),
  };
}

function endpoint(source = process.env) {
  const configured = text(source.SPEAKING_TENCENT_ASR_ENDPOINT, 500);
  const value = configured || DEFAULT_ENDPOINT;
  let parsed;
  try { parsed = new URL(value); } catch (_error) { throw new TencentVoiceprintError("SPEAKING_VOICEPRINT_NOT_CONFIGURED"); }
  if (parsed.protocol !== "https:" && !/\.example\.test$/i.test(parsed.hostname)) throw new TencentVoiceprintError("SPEAKING_VOICEPRINT_NOT_CONFIGURED");
  return parsed.toString().replace(/\/$/, "");
}

function groupId(source = process.env) {
  const value = text(source.SPEAKING_TENCENT_VOICEPRINT_GROUP_ID || DEFAULT_GROUP_ID, 128);
  // Enrolment documentation is stricter than 1:N verification documentation,
  // so use their common letters/underscore subset for a group used by both.
  if (!/^[A-Za-z_]{1,128}$/.test(value)) throw new TencentVoiceprintError("SPEAKING_VOICEPRINT_NOT_CONFIGURED");
  return value;
}

function region(source = process.env) {
  return text(source.SPEAKING_TENCENT_ASR_REGION || source.TCB_REGION || source.TENCENTCLOUD_REGION, 80);
}

function authorization({ method = "POST", url, timestamp, payload, secretId, secretKey }) {
  const parsed = new URL(url);
  const canonicalHeaders = `content-type:application/json\nhost:${parsed.hostname}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    method,
    parsed.pathname || "/",
    parsed.search.slice(1),
    canonicalHeaders,
    signedHeaders,
    sha256(JSON.stringify(payload)),
  ].join("\n");
  const date = utcDate(timestamp);
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", timestamp, credentialScope, sha256(canonicalRequest)].join("\n");
  const secretDate = hmacSha256(date, `TC3${secretKey}`);
  const secretService = hmacSha256(SERVICE, secretDate);
  const secretSigning = hmacSha256("tc3_request", secretService);
  const signature = hmacSha256(stringToSign, secretSigning, "hex");
  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function safeProviderCode(providerCode) {
  const code = text(providerCode, 200);
  if (/VoicePrintFull/i.test(code)) return "VOICEPRINT_CAPACITY_REACHED";
  if (/NoHumanVoice/i.test(code)) return "VOICEPRINT_NO_HUMAN_VOICE";
  if (/NotExistentVoicePrintId/i.test(code)) return "VOICEPRINT_NOT_FOUND";
  if (/VoiceDataTooLong|Audio|Decode|Parameter/i.test(code)) return "VOICEPRINT_AUDIO_INVALID";
  return "VOICEPRINT_PROVIDER_FAILED";
}

async function request(action, data = {}, options = {}) {
  const auth = credentials(options.env || process.env);
  const url = options.endpoint || endpoint(options.env || process.env);
  const payload = omitNullish(data);
  const timestamp = Number.isInteger(options.timestamp) ? options.timestamp : Math.floor(Date.now() / 1000);
  const headers = {
    Host: new URL(url).host,
    "X-TC-Action": action,
    "X-TC-Timestamp": String(timestamp),
    "X-TC-Version": API_VERSION,
    "Content-Type": "application/json",
    Authorization: authorization({ url, timestamp, payload, secretId: auth.secretId, secretKey: auth.secretKey }),
  };
  const selectedRegion = options.region == null ? region(options.env || process.env) : text(options.region, 80);
  if (selectedRegion) headers["X-TC-Region"] = selectedRegion;
  if (auth.token) headers["X-TC-Token"] = auth.token;

  let response;
  let bodyText;
  try {
    response = await (options.fetch || fetch)(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(Number(options.timeoutMs || 30000))
        : undefined,
    });
    bodyText = await response.text();
  } catch (_error) {
    throw new TencentVoiceprintError("VOICEPRINT_PROVIDER_UNAVAILABLE");
  }
  let body;
  try { body = JSON.parse(String(bodyText || "").replace(/^\uFEFF/, "")); }
  catch (_error) { throw new TencentVoiceprintError("VOICEPRINT_PROVIDER_INVALID_RESPONSE"); }
  const result = body && body.Response;
  if (!response.ok || !result || result.Error) {
    const providerCode = result && result.Error && result.Error.Code || `HTTP_${response.status}`;
    throw new TencentVoiceprintError(safeProviderCode(providerCode), {
      providerCode,
      requestId: result && result.RequestId,
    });
  }
  return result;
}

function decodeBase64(value) {
  const normalized = text(value, Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 200).replace(/^data:audio\/[\w.+-]+;base64,/i, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) throw new TencentVoiceprintError("VOICEPRINT_AUDIO_INVALID");
  let buffer;
  try { buffer = Buffer.from(normalized, "base64"); } catch (_error) { throw new TencentVoiceprintError("VOICEPRINT_AUDIO_INVALID"); }
  if (!buffer.length || buffer.length > MAX_AUDIO_BYTES) throw new TencentVoiceprintError("VOICEPRINT_AUDIO_INVALID");
  return { buffer, base64: normalized };
}

function wavInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new TencentVoiceprintError("VOICEPRINT_AUDIO_INVALID");
  }
  let offset = 12;
  let format = null;
  let dataBytes = null;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkSize;
    if (end > buffer.length) throw new TencentVoiceprintError("VOICEPRINT_AUDIO_INVALID");
    if (chunkId === "fmt " && chunkSize >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    }
    if (chunkId === "data") dataBytes = chunkSize;
    offset = end + (chunkSize % 2);
  }
  if (!format || dataBytes == null || format.audioFormat !== 1 || format.channels !== 1 || format.sampleRate !== SAMPLE_RATE || format.bitsPerSample !== 16) {
    throw new TencentVoiceprintError("VOICEPRINT_AUDIO_INVALID");
  }
  const durationMs = Math.round(dataBytes / (SAMPLE_RATE * 2) * 1000);
  if (durationMs < MIN_AUDIO_MS || durationMs > MAX_AUDIO_MS) throw new TencentVoiceprintError("VOICEPRINT_AUDIO_DURATION_INVALID");
  return { ...format, dataBytes, durationMs };
}

function validateWavBase64(value) {
  const decoded = decodeBase64(value);
  return { ...wavInfo(decoded.buffer), base64: decoded.base64, byteLength: decoded.buffer.length };
}

function normalizeBaseData(result) {
  const data = result && result.Data || {};
  const voiceprintId = text(data.VoicePrintId, 200);
  if (!voiceprintId) throw new TencentVoiceprintError("VOICEPRINT_PROVIDER_INVALID_RESPONSE", { requestId: result && result.RequestId });
  return { voiceprintId, speakerNick: text(data.SpeakerNick, 64), requestId: text(result && result.RequestId, 200) };
}

function speakerNick(subjectKey) {
  return `mrcat_${sha256(text(subjectKey, 300)).slice(0, 20)}`;
}

function commonAudioPayload(audioBase64) {
  const audio = validateWavBase64(audioBase64);
  return { audio, payload: { VoiceFormat: 1, SampleRate: SAMPLE_RATE, Data: audio.base64 } };
}

async function enroll({ audioBase64, subjectKey, group } = {}, options = {}) {
  const { audio, payload } = commonAudioPayload(audioBase64);
  const result = await request("VoicePrintEnroll", {
    ...payload,
    SpeakerNick: speakerNick(subjectKey),
    GroupId: group || groupId(options.env || process.env),
  }, options);
  return { ...normalizeBaseData(result), durationMs: audio.durationMs };
}

async function update({ audioBase64, voiceprintId, subjectKey } = {}, options = {}) {
  const { audio, payload } = commonAudioPayload(audioBase64);
  const id = text(voiceprintId, 200);
  if (!id) throw new TencentVoiceprintError("VOICEPRINT_NOT_FOUND");
  const result = await request("VoicePrintUpdate", {
    ...payload,
    VoicePrintId: id,
    SpeakerNick: speakerNick(subjectKey),
  }, options);
  return { ...normalizeBaseData(result), durationMs: audio.durationMs };
}

async function remove({ voiceprintId } = {}, options = {}) {
  const id = text(voiceprintId, 200);
  if (!id) throw new TencentVoiceprintError("VOICEPRINT_NOT_FOUND");
  const result = await request("VoicePrintDelete", { VoicePrintId: id, DelMod: 0 }, options);
  return { voiceprintId: id, requestId: text(result && result.RequestId, 200) };
}

async function verify({ audioBase64, voiceprintId } = {}, options = {}) {
  const { audio, payload } = commonAudioPayload(audioBase64);
  const id = text(voiceprintId, 200);
  if (!id) throw new TencentVoiceprintError("VOICEPRINT_NOT_FOUND");
  const result = await request("VoicePrintVerify", { ...payload, VoicePrintId: id }, options);
  const data = result && result.Data || {};
  return {
    voiceprintId: text(data.VoicePrintId || id, 200),
    score: Number.isFinite(Number(data.Score)) ? Number(data.Score) : null,
    decision: Number(data.Decision) === 1,
    durationMs: audio.durationMs,
    requestId: text(result && result.RequestId, 200),
  };
}

async function identify({ audioBase64, topN = 6, group } = {}, options = {}) {
  const { audio, payload } = commonAudioPayload(audioBase64);
  const result = await request("VoicePrintGroupVerify", {
    ...payload,
    GroupId: group || groupId(options.env || process.env),
    TopN: Math.min(1000, Math.max(1, Math.round(Number(topN) || 1))),
  }, options);
  const tops = result && result.Data && Array.isArray(result.Data.VerifyTops) ? result.Data.VerifyTops : [];
  return {
    matches: tops.map((item) => ({
      voiceprintId: text(item && item.VoicePrintId, 200),
      score: Number.isFinite(Number(item && item.Score)) ? Number(item.Score) : null,
    })).filter((item) => item.voiceprintId).sort((left, right) => Number(right.score || 0) - Number(left.score || 0)),
    durationMs: audio.durationMs,
    requestId: text(result && result.RequestId, 200),
  };
}

function configured(source = process.env) {
  return Boolean(text(source.TENCENTCLOUD_SECRETID, 300) && text(source.TENCENTCLOUD_SECRETKEY, 300));
}

module.exports = {
  API_VERSION,
  SERVICE,
  SAMPLE_RATE,
  MAX_AUDIO_BYTES,
  MIN_AUDIO_MS,
  MAX_AUDIO_MS,
  TencentVoiceprintError,
  configured,
  groupId,
  authorization,
  validateWavBase64,
  safeProviderCode,
  request,
  enroll,
  update,
  remove,
  verify,
  identify,
  _test: { credentials, endpoint, region, speakerNick, wavInfo, decodeBase64 },
};
