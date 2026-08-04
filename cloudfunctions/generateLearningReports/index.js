"use strict";

const { runScheduledGeneration } = require("../learningReports/index");

function text(value) {
  return String(value == null ? "" : value).trim();
}

function authorizedTimerEvent(event) {
  const expected = text(process.env.LEARNING_REPORT_CRON_TOKEN);
  if (!expected) throw new Error("REPORT_CRON_NOT_CONFIGURED");
  if (text(event && event.internal_token) !== expected) throw new Error("REPORT_CRON_UNAUTHORIZED");
}

// Configure the CloudBase timer with a static event such as
// {"internal_token":"<LEARNING_REPORT_CRON_TOKEN>"}. The function ignores
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
