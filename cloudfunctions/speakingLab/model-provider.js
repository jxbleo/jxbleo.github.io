"use strict";

class SpeakingModelError extends Error {
  constructor(code = "SPEAKING_PROVIDER_NOT_CONFIGURED") {
    super(code);
    this.code = code;
    this.name = "SpeakingModelError";
  }
}

function createModelProvider() {
  throw new SpeakingModelError();
}

function providerConfigStatus(env = process.env) {
  const required = ["SPEAKING_AI_TEXT_API_KEY", "SPEAKING_AI_TEXT_API_URL", "SPEAKING_AI_TEXT_MODEL", "SPEAKING_AI_TEXT_PROTOCOL"];
  const missing = required.filter((name) => !String(env && env[name] || "").trim());
  return { configured: missing.length === 0, missing };
}

async function callStructuredModel() { throw new SpeakingModelError(); }

module.exports = { SpeakingModelError, createModelProvider, providerConfigStatus, callStructuredModel };
