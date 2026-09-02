"use strict";

const { OCR_SCHEMA } = require("./schemas");
const { ocrPrompt } = require("./prompts");
const writingProvider = require("../writingTutor/model-provider");

async function callStructuredVision(imageUrl, options = {}) {
  // Validate configuration before crossing the provider-call audit boundary.
  // A missing environment variable must not consume the student's OCR quota.
  writingProvider._test.providerConfig(true);
  let auditStarted = false;
  const response = await writingProvider.callStructuredModel({
    system: ocrPrompt(),
    userText: "Transcribe this page and return only the required structure.",
    schemaName: "vocabulary_scan_ocr_v1",
    schema: OCR_SCHEMA,
    images: [imageUrl],
    vision: true,
    timeoutMs: 45000,
    onRequestStart: async () => {
      if (auditStarted) return;
      auditStarted = true;
      if (typeof options.onRequestStart === "function") await options.onRequestStart();
    },
  });
  return {
    output: response.data,
    metadata: response.metadata || null,
    telemetry: response.telemetry || { attempts: [] },
  };
}

module.exports = { callStructuredVision };
