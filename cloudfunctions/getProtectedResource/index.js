const cloudbase = require("@cloudbase/node-sdk");
const payloads = require("./protected-payloads.private");
const { roleCanAccess } = require("./access-policy");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const MAX_RESOURCE_KEY_LENGTH = 96;

async function getAuthenticatedProfile() {
  const userInfo = await app.auth().getUserInfo();
  const uid = userInfo && (userInfo.uid || userInfo.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");

  const result = await db.collection("students").where({
    auth_uid: String(uid),
    active: true,
  }).limit(1).get();
  const profile = result.data && result.data[0];
  if (!profile) throw new Error("STUDENT_NOT_LINKED");
  return profile;
}

function requireResourceRole(profile, resource) {
  if (!roleCanAccess(profile, resource)) throw new Error("ACCESS_DENIED");
}

function requestedResource(event) {
  const key = String(event && event.resource_key || "").trim().slice(0, MAX_RESOURCE_KEY_LENGTH);
  if (!key || !Object.prototype.hasOwnProperty.call(payloads.resources || {}, key)) {
    throw new Error("RESOURCE_NOT_FOUND");
  }
  return { key, resource: payloads.resources[key] };
}

function manifestView(key, resource) {
  return {
    success: true,
    resource_key: key,
    title: resource.title,
    mime_type: resource.mime_type || "text/html; charset=utf-8",
    encoding: resource.encoding,
    chunk_count: resource.chunks.length,
    source_bytes: resource.source_bytes,
    compressed_bytes: resource.compressed_bytes,
    sha256: resource.sha256,
  };
}

function chunkView(key, resource, event) {
  const index = Number(event && event.chunk_index);
  if (!Number.isInteger(index) || index < 0 || index >= resource.chunks.length) {
    throw new Error("INVALID_CHUNK");
  }
  return {
    success: true,
    resource_key: key,
    chunk_index: index,
    chunk_count: resource.chunks.length,
    chunk: resource.chunks[index],
  };
}

function errorView(error) {
  const code = String(error && error.message || "RESOURCE_ERROR");
  const messages = {
    AUTH_REQUIRED: "Please log in with a student account.",
    STUDENT_NOT_LINKED: "This login is not linked to an active student profile.",
    ACCESS_DENIED: "This account cannot open protected student resources.",
    RESOURCE_NOT_FOUND: "This protected resource is unavailable.",
    INVALID_CHUNK: "The requested resource segment is invalid.",
  };
  return {
    success: false,
    code: Object.prototype.hasOwnProperty.call(messages, code) ? code : "RESOURCE_ERROR",
    message: messages[code] || "Unable to load this protected resource.",
  };
}

exports.main = async (event = {}) => {
  try {
    const profile = await getAuthenticatedProfile();
    const { key, resource } = requestedResource(event);
    requireResourceRole(profile, resource);
    if (String(event.action || "manifest") === "chunk") {
      return chunkView(key, resource, event);
    }
    return manifestView(key, resource);
  } catch (error) {
    return errorView(error);
  }
};
