"use strict";

const { runScheduledGeneration } = require("../learningReports/index");

function text(value) {
  return String(value == null ? "" : value).trim();
}

function timerToken(event) {
  const direct = text(event && event.internal_token);
  if (direct) return direct;

  const message = text(event && event.Message);
  if (!message) return "";
  try {
    const parsed = JSON.parse(message);
    if (typeof parsed === "string") return text(parsed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.internal_token != null) {
      return text(parsed.internal_token);
    }
    return message;
  } catch (_) {
    return message;
  }
}

function authorizedTimerEvent(event) {
  const expected = text(process.env.LEARNING_REPORT_CRON_TOKEN);
  if (!expected) throw new Error("REPORT_CRON_NOT_CONFIGURED");
  if (timerToken(event) !== expected) throw new Error("REPORT_CRON_UNAUTHORIZED");
}

// Configure the SCF timer's CustomArgument with the same value as
// LEARNING_REPORT_CRON_TOKEN. SCF exposes that string as event.Message. The
// direct internal_token form remains supported for bounded owner-run tests.
// The function ignores
// all caller-supplied dates, periods, class IDs, and status values; the report
// service derives its allowed work from the server's Shanghai clock.
exports.main = async (event = {}) => {
  try {
    authorizedTimerEvent(event);
    return await runScheduledGeneration(new Date());
  } catch (error) {
    const code = error && error.message || "REPORT_CRON_ERROR";
    console.error("generateLearningReports failed", error);
    return {
      success: false,
      code,
      message: code === "REPORT_CRON_NOT_CONFIGURED"
        ? "Learning report timer is not configured."
        : "Learning report timer is not authorized.",
    };
  }
};
