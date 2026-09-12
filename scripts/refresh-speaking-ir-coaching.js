#!/usr/bin/env node
"use strict";

// Owner-authorized operator only. No credentials or student data in source/Git.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert");
const { spawnSync } = require("child_process");
const refresh = require("../cloudfunctions/_shared/speaking-ir-refresh");
const { INDIVIDUAL_RESPONSE_PROMPT_VERSION } = require("../cloudfunctions/speakingLab/prompts");
const S = "speaking_individual_responses", R = "speaking_reports", J = "speaking_ai_jobs";
const ENV = "mrcat-dev-d9gwy2v1icdfdf597", REGION = "ap-shanghai";
const root = path.resolve(__dirname, "..");
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  for (const key of ["$numberInt", "$numberLong", "$numberDouble"]) if (key in value) return Number(value[key]);
  if ("$date" in value) return new Date(normalize(value.$date)).toISOString();
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, normalize(v)]));
}
function command(table, type, data) {
  const payload = [{ TableName: table, CommandType: type, Command: JSON.stringify(data) }];
  const result = spawnSync("tcb", ["-e", ENV, "-r", REGION, "db", "nosql", "execute", "--command", JSON.stringify(payload), "--json"], { cwd: root, encoding: "utf8", timeout: 90000, maxBuffer: 24 * 1024 * 1024 });
  if (result.status !== 0) {
    const diagnostics = path.join(root, ".cloudbase-private", "ir-coaching-release", `operator-error-${Date.now()}.json`);
    privateSave(diagnostics, { type, table, status: result.status, stdout: result.stdout, stderr: result.stderr });
    throw new Error(`CloudBase ${type} failed (${result.status}); diagnostics saved privately at ${diagnostics}`);
  }
  const output = String(result.stdout || "");
  const parsed = JSON.parse(output.slice(output.indexOf("{")));
  if (!parsed.data || !Array.isArray(parsed.data.results)) throw new Error("Unexpected CloudBase response");
  return normalize(parsed.data.results[0]);
}
function query(table, filter, projection) {
  const result = command(table, "QUERY", { find: table, filter, ...(projection ? { projection } : {}), limit: 1000 });
  if (!Array.isArray(result) || result.length >= 1000) throw new Error("Query requires pagination or failed");
  return result;
}
function update(table, q, values, insert = false) {
  return command(table, "UPDATE", { update: table, updates: [{ q, u: { [insert ? "$setOnInsert" : "$set"]: values }, upsert: insert, multi: false }] });
}
function queryMany(table, key, ids) {
  const rows = [], unique = [...new Set(ids.filter(Boolean))];
  for (let start = 0; start < unique.length; start += 15) rows.push(...query(table, { [key]: { $in: unique.slice(start, start + 15) } }));
  return new Map(rows.map((row) => [row[key], row]));
}
function stamp() { return { $date: { $numberLong: String(Date.now()) } }; }
function stable(prefix, ...parts) { return `${prefix}_${crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 40)}`; }
function jobId(row) { return stable("speaking_ir_coaching_job", row.response_session_id, row.report_id); }
function privateSave(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" }); }
function eligible(row) { return row.analysis_status === "ready" && row.recording_status === "uploaded" && row.report_id && row.formal_audio_asset_id && row.report && row.report.report_version !== "dse-individual-response-v2"; }
function scopeMatches(row, original) {
  return row && !row.deleted_at && row.analysis_status === "ready" && row.report_id === original.report_id && row.active_report_version === original.active_report_version && Number(row.active_audio_revision) === Number(original.active_audio_revision);
}
function plan(file, from, to) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to, "Explicit date range required");
  const rows = query(S, { deleted_at: null, response_date: { $gte: from, $lte: to } });
  const items = [], skipped = {};
  for (const row of rows) {
    if (!eligible(row)) { const key = row.report && row.report.report_version === "dse-individual-response-v2" ? "already_v2" : row.analysis_status || "no_report"; skipped[key] = (skipped[key] || 0) + 1; continue; }
    const source = query(R, { report_id: row.report_id, response_session_id: row.response_session_id })[0];
    refresh.assertSource({ refresh_kind: refresh.REFRESH_KIND, stage: "analysis", source_report_id: row.report_id, source_report_version: row.active_report_version, response_revision: row.active_audio_revision }, row, source);
    assert.deepStrictEqual(row.report, source.dse_analysis, "Session/report assessment mismatch: investigate before refreshing");
    items.push({ response: row, source, job_id: jobId(row) });
  }
  privateSave(file, { environment: ENV, from, to, planned_at: new Date().toISOString(), items, scanned: rows.length, skipped });
  console.log(JSON.stringify({ scanned: rows.length, eligible: items.length, skipped, backup: file }));
}
function apply(manifest, limit) {
  let queued = 0, unchanged = 0, superseded = 0;
  for (const item of manifest.items) {
    if (queued >= limit) break;
    const old = item.response;
    const current = query(S, { response_session_id: old.response_session_id })[0];
    const priorJob = query(J, { job_id: item.job_id })[0];
    if (priorJob && current.active_analysis_job_id === item.job_id && priorJob.status === "preparing" && scopeMatches(current, old)) {
      update(J, { _id: item.job_id, status: "preparing" }, { status: "queued", next_retry_at: stamp(), updated_at: stamp() }); queued++; continue;
    }
    if (priorJob && (current.active_analysis_job_id === item.job_id || priorJob.status === "succeeded")) { unchanged++; continue; }
    if (!scopeMatches(current, old) || current.active_analysis_job_id !== old.active_analysis_job_id) { superseded++; continue; }
    const time = stamp();
    update(J, { _id: item.job_id }, { job_id: item.job_id, operation_id: item.job_id, job_type: "individual_response_analysis", refresh_kind: refresh.REFRESH_KIND, source_report_id: old.report_id, source_report_version: old.active_report_version, response_session_id: old.response_session_id, response_revision: old.active_audio_revision, formal_audio_asset_id: old.formal_audio_asset_id, status: "preparing", stage: "analysis", attempt_count: 0, max_attempts: 5, lease_token: null, lease_until: null, dispatch_token: crypto.randomBytes(24).toString("hex"), next_retry_at: time, created_at: time, updated_at: time, finished_at: null, safe_error_code: null, prompt_version: "dse-individual-response-prompts-2026-09-12.2", schema_version: "dse-individual-response-v2", rubric_version: "dse-individual-response-v1" }, true);
    update(J, { _id: item.job_id, status: "preparing" }, { prompt_version: INDIVIDUAL_RESPONSE_PROMPT_VERSION });
    update(S, { _id: old._id, deleted_at: null, report_id: old.report_id, active_report_version: old.active_report_version, active_audio_revision: old.active_audio_revision, active_analysis_job_id: old.active_analysis_job_id, analysis_status: "ready" }, { active_analysis_job_id: item.job_id, updated_at: time });
    const attached = query(S, { _id: old._id })[0];
    if (attached.active_analysis_job_id === item.job_id) {
      update(J, { _id: item.job_id, status: "preparing" }, { status: "queued", next_retry_at: stamp(), updated_at: stamp() }); queued++;
    } else superseded++;
  }
  console.log(JSON.stringify({ queued, unchanged, superseded }));
}
function status(manifest, retry, repairCache = false) {
  const counts = {}, errors = {}, records = [];
  const jobs = queryMany(J, "job_id", manifest.items.map((item) => item.job_id));
  const responses = queryMany(S, "response_session_id", manifest.items.map((item) => item.response.response_session_id));
  const reports = queryMany(R, "report_id", [...manifest.items.map((item) => item.source.report_id), ...[...responses.values()].map((row) => row.report_id)]);
  for (const item of manifest.items) {
    const job = jobs.get(item.job_id);
    const state = job ? job.status : "not_queued";
    counts[state] = (counts[state] || 0) + 1;
    if (!job) continue;
    const row = responses.get(item.response.response_session_id);
    if (state === "succeeded") {
      const report = reports.get(row.report_id);
      const old = reports.get(item.source.report_id);
      assert.deepStrictEqual(old, item.source, "Original report was changed");
      assert.equal(row.analysis_status, "ready");
      assert.equal(report.previous_report_id, item.source.report_id);
      assert.equal(report.schema_version, "dse-individual-response-v2");
      assert.equal(report.dse_analysis.socratic_questions.length, 4);
      assert.equal(report.dse_analysis.sample_responses.length, 3);
      assert.deepStrictEqual(report.transcript, item.source.transcript);
      for (const key of ["domains", "summary_zh", "strengths", "priority_actions", "language_suggestions"]) assert.deepStrictEqual(report.dse_analysis[key], item.source.dse_analysis[key]);
      if (repairCache && row.active_analysis_job_id === item.job_id && row.report.report_version === "dse-individual-response-v2") {
        const withoutLegacySample = { ...row.report }; delete withoutLegacySample.sample_response_en;
        assert.deepStrictEqual(withoutLegacySample, report.dse_analysis, "Only a leftover V1 sample may be repaired");
        update(S, { _id: row._id, report_id: report.report_id, active_analysis_job_id: item.job_id, deleted_at: null }, { report: report.dse_analysis });
        row.report = query(S, { _id: row._id })[0].report;
      }
      assert.deepStrictEqual(row.report, report.dse_analysis);
      records.push({ response: row, report });
    } else if (state === "failed") {
      const reason = job.safe_error_code || "unknown";
      errors[reason] = (errors[reason] || 0) + 1;
      assert.equal(row.analysis_status, "ready", "Refresh failure hid previous report");
      if (retry && job.attempt_count < 3 && reason !== "SPEAKING_JOB_SUPERSEDED" && scopeMatches(row, item.response) && row.active_analysis_job_id === item.job_id) {
        update(J, { _id: job._id, status: "failed", attempt_count: job.attempt_count }, { status: "queued", lease_token: null, lease_until: null, next_retry_at: stamp(), finished_at: null, updated_at: stamp() });
        counts.retried = (counts.retried || 0) + 1;
      }
    }
  }
  console.log(JSON.stringify({ total: manifest.items.length, counts, errors }));
  return records;
}
function main(argv) {
  const [mode, relative, ...args] = argv;
  const file = path.resolve(relative || "");
  assert(file.startsWith(path.join(root, ".cloudbase-private") + path.sep), "Manifest must be in ignored .cloudbase-private directory");
  if (mode === "plan") return plan(file, args[0], args[1]);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(manifest.environment, ENV);
  if (mode === "refine-pilot") {
    // Preserve both previous manifests/reports. Only the already-tested first
    // response is refined; all other scope entries remain exactly as approved.
    const item = manifest.items[0], row = query(S, { response_session_id: item.response.response_session_id })[0];
    assert(row && !row.deleted_at && row.analysis_status === "ready" && row.active_audio_revision === item.response.active_audio_revision);
    const source = query(R, { report_id: row.report_id })[0];
    assert.equal(source.previous_report_id, item.source.report_id);
    assert.deepStrictEqual(source.dse_analysis.domains, item.source.dse_analysis.domains);
    assert.deepStrictEqual(source.transcript, item.source.transcript);
    const nextFile = file.replace(/\.json$/, "-refined.json");
    privateSave(nextFile, { ...manifest, previous_manifest: path.basename(file), items: [{ response: row, source, job_id: jobId(row) }, ...manifest.items.slice(1)] });
    console.log(JSON.stringify({ refinedManifest: nextFile, total: manifest.items.length })); return;
  }
  if (mode === "apply") { const limit = Number(args[0] || 1); assert(Number.isInteger(limit) && limit > 0 && limit <= 1000); return apply(manifest, limit); }
  if (mode === "status" || mode === "retry" || mode === "repair-cache") {
    const records = status(manifest, mode === "retry", mode === "repair-cache");
    if (args[0] === "save") privateSave(file.replace(/\.json$/, "") + `-results-${Date.now()}.json`, records);
    return;
  }
  throw new Error("Use plan <private manifest> <from> <to>, apply <manifest> <limit>, status <manifest> [save], or retry <manifest>");
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) {
  if (error.code === "ERR_ASSERTION") {
    privateSave(path.join(root, ".cloudbase-private", "ir-coaching-release", `assertion-${Date.now()}.json`), { message: error.message, stack: error.stack });
    console.error("Safety assertion failed; private diagnostics saved.");
    console.error(String(error.stack).split("\n").filter((line) => /^\s+at /.test(line)).slice(0, 2).join("\n"));
  } else console.error(error.message);
  process.exitCode = 1;
} }
module.exports = { normalize, scopeMatches, eligible, jobId };
