const crypto = require("crypto");

const API_VERSION = "2018-06-08";
const SERVICE = "tcb";

function omitNullish(value) {
  if (Array.isArray(value)) return value.map(omitNullish);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined)
      .map(([key, item]) => [key, omitNullish(item)])
  );
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

function credentials() {
  const secretId = String(process.env.TENCENTCLOUD_SECRETID || "").trim();
  const secretKey = String(process.env.TENCENTCLOUD_SECRETKEY || "").trim();
  if (!secretId || !secretKey) throw new Error("CLOUDBASE_MANAGER_CREDENTIALS_MISSING");
  return {
    secretId,
    secretKey,
    token: String(process.env.TENCENTCLOUD_SESSIONTOKEN || "").trim(),
  };
}

function endpoint() {
  if (Object.prototype.hasOwnProperty.call(process.env, "USE_INTERNAL_ENDPOINT")) {
    const region = String(process.env.INTERNAL_ENDPOINT_REGION || "").trim();
    return region
      ? `https://${SERVICE}.${region}.tencentcloudapi.woa.com`
      : `https://${SERVICE}.internal.tencentcloudapi.com`;
  }
  return process.env.TCB_BASE_URL || `https://${SERVICE}.tencentcloudapi.com`;
}

function authorization({ method, url, action, timestamp, payload, secretId, secretKey }) {
  const parsed = new URL(url);
  const headers = "content-type:application/json\nhost:" + parsed.hostname + "\n";
  const signedHeaders = "content-type;host";
  const canonicalRequest = [
    method,
    parsed.pathname,
    parsed.search.slice(1),
    headers,
    signedHeaders,
    sha256(JSON.stringify(payload)),
  ].join("\n");
  const date = utcDate(timestamp);
  const stringToSign = [
    "TC3-HMAC-SHA256",
    timestamp,
    `${date}/${SERVICE}/tc3_request`,
    sha256(canonicalRequest),
  ].join("\n");
  const secretDate = hmacSha256(date, `TC3${secretKey}`);
  const secretService = hmacSha256(SERVICE, secretDate);
  const secretSigning = hmacSha256("tc3_request", secretService);
  const signature = hmacSha256(stringToSign, secretSigning, "hex");
  return `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${SERVICE}/tc3_request, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function request(action, data = {}, config) {
  const { secretId, secretKey, token } = credentials();
  const url = endpoint();
  const payload = omitNullish(data);
  const timestamp = Math.floor(Date.now() / 1000);
  const headers = {
    Host: new URL(url).host,
    "X-TC-Action": action,
    "X-TC-Timestamp": String(timestamp),
    "X-TC-Version": API_VERSION,
    "Content-Type": "application/json",
    Authorization: authorization({
      method: "POST",
      url,
      action,
      timestamp,
      payload,
      secretId,
      secretKey,
    }),
  };
  if (config && config.region) headers["X-TC-Region"] = config.region;
  if (token) headers["X-TC-Token"] = token;

  let response;
  let bodyText;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(60000)
        : undefined,
    });
    bodyText = await response.text();
  } catch (error) {
    const wrapped = new Error(error && error.message ? error.message : "CLOUDBASE_MANAGER_REQUEST_FAILED");
    wrapped.code = error && error.code;
    wrapped.action = action;
    throw wrapped;
  }

  let body;
  try {
    body = JSON.parse(bodyText.replace(/^\uFEFF/, ""));
  } catch (error) {
    const wrapped = new Error(bodyText || "CLOUDBASE_MANAGER_INVALID_RESPONSE");
    wrapped.code = `HTTP_${response.status}`;
    wrapped.action = action;
    throw wrapped;
  }
  const result = body && body.Response;
  if (!response.ok || (result && result.Error)) {
    const apiError = result && result.Error;
    const wrapped = new Error(apiError && apiError.Message || `HTTP_${response.status}`);
    wrapped.name = "CloudBaseError";
    wrapped.code = apiError && apiError.Code || `HTTP_${response.status}`;
    wrapped.requestId = result && result.RequestId || "";
    wrapped.action = action;
    wrapped.original = apiError || null;
    throw wrapped;
  }
  return result || {};
}

function init(options = {}) {
  const envId = String(options.envId || process.env.TENCENTCLOUD_TCB_ENVID || "").trim();
  if (!envId) throw new Error("CLOUDBASE_MANAGER_ENV_ID_MISSING");
  const region = String(options.region || process.env.TCB_REGION || process.env.TENCENTCLOUD_REGION || "").trim();
  const config = { envId, region };

  const user = {
    getEndUserList: ({ limit, offset }) => request("DescribeEndUsers", {
      EnvId: config.envId,
      Limit: limit,
      Offset: offset,
    }, config),
    createEndUser: ({ username, password }) => request("CreateEndUserAccount", {
      EnvId: config.envId,
      Username: username,
      Password: password,
    }, config),
    setEndUserStatus: ({ uuid, status }) => request("ModifyEndUser", {
      EnvId: config.envId,
      UUId: uuid,
      Status: status,
    }, config),
    deleteEndUsers: ({ userList }) => request("DeleteEndUser", {
      EnvId: config.envId,
      UserList: userList,
    }, config),
    modifyEndUser: ({ uuid, username, password }) => request("ModifyEndUserAccount", {
      EnvId: config.envId,
      Uuid: uuid,
      ...(username ? { Username: username } : {}),
      ...(password ? { Password: password } : {}),
    }, config),
  };
  return { user };
}

module.exports = { init };
