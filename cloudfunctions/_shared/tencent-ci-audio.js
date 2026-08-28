"use strict";

/*
 * Minimal Tencent COS/CI audio-excerpt adapter.
 *
 * Speaking Lab uses it only after diarization, to turn one uninterrupted
 * Speaker turn into the 16 kHz mono WAV accepted by Tencent voiceprints. The
 * derived file is private and callers must delete it after verification.
 */

const crypto = require("crypto");

const MIN_EXCERPT_MS = 8000;
const MAX_EXCERPT_MS = 30000;

class TencentCiAudioError extends Error {
  constructor(code, options = {}) {
    super(code);
    this.name = "TencentCiAudioError";
    this.code = code;
    this.providerCode = options.providerCode || null;
    this.requestId = options.requestId || null;
  }
}

function text(value, limit = 2048) {
  return String(value == null ? "" : value).trim().slice(0, limit);
}

function sha1(value, encoding = "hex") {
  return crypto.createHash("sha1").update(value).digest(encoding);
}

function hmacSha1(value, secret, encoding = "hex") {
  return crypto.createHmac("sha1", secret).update(value).digest(encoding);
}

function xmlEscape(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;",
  }[character]));
}

function xmlValue(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return "";
  return match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
}

function credentials(source = process.env) {
  const secretId = text(source.TENCENTCLOUD_SECRETID, 300);
  const secretKey = text(source.TENCENTCLOUD_SECRETKEY, 300);
  if (!secretId || !secretKey) throw new TencentCiAudioError("SPEAKING_CLIP_PROVIDER_NOT_CONFIGURED");
  return { secretId, secretKey, token: text(source.TENCENTCLOUD_SESSIONTOKEN, 2000) };
}

function region(source = process.env) {
  const value = text(source.SPEAKING_TENCENT_CI_REGION || source.SPEAKING_TENCENT_ASR_REGION || source.TCB_REGION || source.TENCENTCLOUD_REGION, 80);
  if (!/^[a-z]+-[a-z]+(?:-\d+)?$/.test(value)) throw new TencentCiAudioError("SPEAKING_CLIP_PROVIDER_NOT_CONFIGURED");
  return value;
}

function parseCloudFileId(value) {
  const fileId = text(value, 2048);
  const match = fileId.match(/^cloud:\/\/([A-Za-z0-9_-]+)\.([^/]+)\/(.+)$/);
  if (!match || !/^[A-Za-z0-9][A-Za-z0-9.-]*-\d+$/.test(match[2]) || !match[3] || match[3].includes("..")) {
    throw new TencentCiAudioError("SPEAKING_CLIP_SOURCE_INVALID");
  }
  return { fileId, environment: match[1], bucket: match[2], object: match[3] };
}

function derivedCloudFileId(source, object) {
  const parsed = typeof source === "string" ? parseCloudFileId(source) : source;
  const safeObject = text(object, 1024).replace(/^\/+/, "");
  if (!safeObject || safeObject.includes("..")) throw new TencentCiAudioError("SPEAKING_CLIP_OUTPUT_INVALID");
  return `cloud://${parsed.environment}.${parsed.bucket}/${safeObject}`;
}

function canonicalHeaderValue(value) {
  return encodeURIComponent(String(value || "").trim().toLowerCase()).replace(/%20/g, "%20");
}

function authorization({ method, pathname, host, contentType, timestamp, secretId, secretKey }) {
  const keyTime = `${timestamp};${timestamp + 900}`;
  const headerList = "content-type;host";
  const httpHeaders = `content-type=${canonicalHeaderValue(contentType)}&host=${canonicalHeaderValue(host)}`;
  const httpString = `${String(method || "GET").toLowerCase()}\n${pathname || "/"}\n\n${httpHeaders}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;
  const signKey = hmacSha1(keyTime, secretKey);
  const signature = hmacSha1(stringToSign, signKey);
  return `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${headerList}&q-url-param-list=&q-signature=${signature}`;
}

function endpoint(bucket, selectedRegion, pathname) {
  return `https://${bucket}.ci.${selectedRegion}.myqcloud.com${pathname}`;
}

function safeProviderCode(code) {
  const value = text(code, 200);
  if (/AccessDenied|Auth|Signature|InvalidAccessKey|NoSuchBucket|Unauthorized/i.test(value)) return "SPEAKING_CLIP_PROVIDER_NOT_CONFIGURED";
  if (/NoSuchKey|InvalidArgument|InvalidParameter|MediaFormat|Decode|Input/i.test(value)) return "SPEAKING_CLIP_SOURCE_INVALID";
  if (/Queue|Busy|Timeout|Internal|Unavailable|Network/i.test(value)) return "SPEAKING_CLIP_PROVIDER_UNAVAILABLE";
  return "SPEAKING_CLIP_PROVIDER_FAILED";
}

async function request({ source, method = "GET", pathname, body = "", env = process.env, fetch: selectedFetch, timestamp, timeoutMs } = {}) {
  const parsed = typeof source === "string" ? parseCloudFileId(source) : source;
  const selectedRegion = region(env);
  const auth = credentials(env);
  const host = `${parsed.bucket}.ci.${selectedRegion}.myqcloud.com`;
  const contentType = "application/xml";
  const requestTime = Number.isInteger(timestamp) ? timestamp : Math.floor(Date.now() / 1000);
  const headers = {
    Host: host,
    Date: new Date(requestTime * 1000).toUTCString(),
    "Content-Type": contentType,
    Authorization: authorization({ method, pathname, host, contentType, timestamp: requestTime, secretId: auth.secretId, secretKey: auth.secretKey }),
  };
  if (auth.token) headers["x-cos-security-token"] = auth.token;
  let response;
  let responseText;
  try {
    response = await (selectedFetch || fetch)(endpoint(parsed.bucket, selectedRegion, pathname), {
      method,
      headers,
      ...(body ? { body } : {}),
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(Number(timeoutMs || 30000))
        : undefined,
    });
    responseText = await response.text();
  } catch (_error) {
    throw new TencentCiAudioError("SPEAKING_CLIP_PROVIDER_UNAVAILABLE");
  }
  if (!response.ok) {
    const providerCode = xmlValue(responseText, "Code") || `HTTP_${response.status}`;
    throw new TencentCiAudioError(safeProviderCode(providerCode), { providerCode, requestId: response.headers && response.headers.get && response.headers.get("x-cos-request-id") });
  }
  return { xml: responseText, requestId: response.headers && response.headers.get && response.headers.get("x-cos-request-id") || null };
}

function createJobXml({ source, outputObject, startMs, durationMs, env = process.env }) {
  const parsed = typeof source === "string" ? parseCloudFileId(source) : source;
  const start = Number(startMs);
  const duration = Number(durationMs);
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration < MIN_EXCERPT_MS || duration > MAX_EXCERPT_MS) {
    throw new TencentCiAudioError("SPEAKING_CLIP_RANGE_INVALID");
  }
  const output = text(outputObject, 1024).replace(/^\/+/, "");
  if (!output || output.includes("..") || !output.toLowerCase().endsWith(".wav")) throw new TencentCiAudioError("SPEAKING_CLIP_OUTPUT_INVALID");
  return `<Request><Tag>Transcode</Tag><Input><Object>${xmlEscape(parsed.object)}</Object></Input><Operation><Transcode><Container><Format>wav</Format></Container><Audio><Codec>pcm_s16le</Codec><Samplerate>16000</Samplerate><Channels>1</Channels><SampleFormat>s16</SampleFormat></Audio><TimeInterval><Start>${(start / 1000).toFixed(3)}</Start><Duration>${(duration / 1000).toFixed(3)}</Duration></TimeInterval></Transcode><Output><Region>${xmlEscape(region(env))}</Region><Bucket>${xmlEscape(parsed.bucket)}</Bucket><Object>${xmlEscape(output)}</Object></Output><UserData>speaking_voice_match</UserData></Operation></Request>`;
}

async function createExcerptJob(input = {}, options = {}) {
  const parsed = parseCloudFileId(input.sourceCloudFileId);
  const outputObject = text(input.outputObject, 1024).replace(/^\/+/, "");
  const body = createJobXml({ source: parsed, outputObject, startMs: input.startMs, durationMs: input.durationMs, env: options.env || process.env });
  const result = await request({ source: parsed, method: "POST", pathname: "/jobs", body, ...options });
  const jobId = xmlValue(result.xml, "JobId");
  if (!jobId) throw new TencentCiAudioError("SPEAKING_CLIP_PROVIDER_INVALID_RESPONSE", { requestId: result.requestId });
  return {
    jobId,
    status: xmlValue(result.xml, "State") || "Submitted",
    outputObject,
    outputFileId: derivedCloudFileId(parsed, outputObject),
    requestId: result.requestId,
  };
}

async function describeExcerptJob(input = {}, options = {}) {
  const parsed = parseCloudFileId(input.sourceCloudFileId);
  const jobId = text(input.jobId, 200);
  if (!/^[A-Za-z0-9_-]{4,200}$/.test(jobId)) throw new TencentCiAudioError("SPEAKING_CLIP_JOB_INVALID");
  const result = await request({ source: parsed, method: "GET", pathname: `/jobs/${jobId}`, ...options });
  const status = xmlValue(result.xml, "State");
  if (!status) throw new TencentCiAudioError("SPEAKING_CLIP_PROVIDER_INVALID_RESPONSE", { requestId: result.requestId });
  return {
    jobId,
    status,
    providerCode: xmlValue(result.xml, "Code") || null,
    message: xmlValue(result.xml, "Message") || null,
    requestId: result.requestId,
  };
}

function configured(source = process.env) {
  try { credentials(source); region(source); return true; } catch (_error) { return false; }
}

module.exports = {
  MIN_EXCERPT_MS,
  MAX_EXCERPT_MS,
  TencentCiAudioError,
  configured,
  parseCloudFileId,
  derivedCloudFileId,
  authorization,
  createJobXml,
  createExcerptJob,
  describeExcerptJob,
  safeProviderCode,
  _test: { credentials, region, xmlEscape, xmlValue, request },
};
