"use strict";

const REFRESH_KIND = "ir-coaching-v2";
function isRefresh(job) { return job && job.refresh_kind === REFRESH_KIND; }
function assertSource(job, response, report) {
  if (!isRefresh(job)) return;
  if (job.stage !== "analysis" || !report || report.status !== "ready" || !report.dse_analysis ||
      report.session_type !== "individual_response" || report.response_session_id !== response.response_session_id ||
      report.report_id !== job.source_report_id || report.report_version !== job.source_report_version ||
      response.report_id !== job.source_report_id || response.active_report_version !== job.source_report_version ||
      Number(response.active_audio_revision) !== Number(job.response_revision) ||
      !report.transcript || !Array.isArray(report.transcript.segments) || !report.transcript.segments.length) {
    throw new Error("SPEAKING_JOB_SUPERSEDED");
  }
}
function preserveAssessment(previous, generated) {
  // A coaching-only upgrade must not silently regrade a submitted response.
  const result = { ...generated };
  for (const key of ["summary_zh", "domains", "strengths", "priority_actions", "language_suggestions"]) {
    if (Object.prototype.hasOwnProperty.call(previous, key)) result[key] = previous[key];
    else delete result[key];
  }
  return result;
}
function failureStatus(job, response) { return isRefresh(job) && response && response.report && response.report_id ? "ready" : "failed"; }
module.exports = { REFRESH_KIND, isRefresh, assertSource, preserveAssessment, failureStatus };
