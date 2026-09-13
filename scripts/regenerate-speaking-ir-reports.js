#!/usr/bin/env node
'use strict';
// Explicit owner-authorized full reanalysis. Manifests contain locators/hashes, not old reports.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { normalize } = require('./refresh-speaking-ir-coaching');
const refresh = require('../cloudfunctions/_shared/speaking-ir-refresh');
const lab = require('../cloudfunctions/_shared/speaking-lab');
const { INDIVIDUAL_RESPONSE_PROMPT_VERSION } = require('../cloudfunctions/speakingLab/prompts');
const ENV = 'mrcat-dev-d9gwy2v1icdfdf597', S = 'speaking_individual_responses', R = 'speaking_reports', J = 'speaking_ai_jobs';
const root = path.resolve(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const timestamp = () => ({ $date: { $numberLong: String(Date.now()) } });
function makeApp() {
  const Manager = require('@cloudbase/manager-node');
  const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/.cloudbase/auth.json'), 'utf8')).credential;
  return new Manager({ envId: ENV, region: 'ap-shanghai', secretId: c.secretId || c.tmpSecretId, secretKey: c.secretKey || c.tmpSecretKey, token: c.token || c.tmpToken });
}
async function execute(app, table, type, command) {
  const result = await app.database.runCommands({ MgoCommands: [{ TableName: table, CommandType: type, Command: JSON.stringify(command) }] });
  const data = normalize(JSON.parse(result.Data[0]));
  return Array.isArray(data) ? data.map(row => typeof row === 'string' ? normalize(JSON.parse(row)) : row) : data;
}
async function query(app, table, filter, projection) {
  const rows = await execute(app, table, 'QUERY', { find: table, filter, ...(projection ? { projection } : {}), limit: 1000 });
  assert(Array.isArray(rows) && rows.length < 1000, 'QUERY_REQUIRES_PAGINATION'); return rows;
}
async function update(app, table, q, values, insert = false) {
  return execute(app, table, 'UPDATE', { update: table, updates: [{ q, u: { [insert ? '$setOnInsert' : '$set']: values }, upsert: insert, multi: false }] });
}
function save(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' }); }
async function plan(app, file, from, to) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to, 'EXPLICIT_DATE_RANGE_REQUIRED');
  const rows = await query(app, S, { deleted_at: null, response_date: { $gte: from, $lte: to } });
  const items = [], skipped = {};
  for (const row of rows) {
    if (row.recording_status !== 'uploaded') { skipped.not_uploaded = (skipped.not_uploaded || 0) + 1; continue; }
    assert(['ready', 'failed', 'not_ready'].includes(row.analysis_status), 'ACTIVE_ANALYSIS_IN_SCOPE');
    const reports = await query(app, R, { response_session_id: row.response_session_id });
    const source = reports.find(r => r.report_id === row.report_id) || reports.filter(r => Number(r.response_revision) === Number(row.active_audio_revision) && r.transcript?.segments?.length).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    if (row.report_id) assert(source?.report_id === row.report_id, 'CURRENT_REPORT_MISSING');
    const oldJob = (await query(app, J, { job_id: row.active_analysis_job_id }))[0];
    assert(!oldJob || ['succeeded', 'failed'].includes(oldJob.status), 'ACTIVE_JOB_IN_SCOPE');
    const asset = (await query(app, 'speaking_audio_assets', { asset_id: row.formal_audio_asset_id, response_session_id: row.response_session_id, status: 'uploaded' }))[0];
    assert(asset, 'UPLOADED_AUDIO_METADATA_MISSING');
    const item = { response_session_id: row.response_session_id, response_id: row._id, response_date: row.response_date, source_report_id: source?.report_id || null, source_report_version: source?.report_version || null, source_job_id: source?.job_id || null, source_report_created_at: source?.created_at || null, expected_report_id: row.report_id || null, expected_report_version: row.active_report_version || null, expected_active_job_id: row.active_analysis_job_id || null, expected_analysis_status: row.analysis_status, response_revision: row.active_audio_revision, formal_audio_asset_id: row.formal_audio_asset_id, transcript_hash: source?.transcript?.segments?.length ? hash(source.transcript) : null };
    if (source) {
      assert(source.transcript?.segments?.length, 'SOURCE_TRANSCRIPT_MISSING');
      refresh.assertSource({ ...item, refresh_kind: refresh.OVERWRITE_KIND, stage: 'analysis' }, row, source);
    }
    item.job_id = 'speaking_ir_reanalysis_' + hash([path.basename(file), item.response_session_id, item.expected_active_job_id, INDIVIDUAL_RESPONSE_PROMPT_VERSION]).slice(0, 40);
    items.push(item);
  }
  const manifest = { environment: ENV, from, to, planned_at: new Date().toISOString(), prompt_version: INDIVIDUAL_RESPONSE_PROMPT_VERSION, schema_version: lab.INDIVIDUAL_RESPONSE_REPORT_SCHEMA_VERSION, items, scanned: rows.length, skipped };
  save(file, manifest); console.log(JSON.stringify({ scanned: rows.length, targets: items.length, reuse_transcript: items.filter(x => x.transcript_hash).length, need_asr: items.filter(x => !x.transcript_hash).length, skipped }));
}
async function apply(app, manifest, limit) {
  assert(manifest.prompt_version === INDIVIDUAL_RESPONSE_PROMPT_VERSION && manifest.schema_version === lab.INDIVIDUAL_RESPONSE_REPORT_SCHEMA_VERSION, 'STALE_MANIFEST');
  let queued = 0, unchanged = 0;
  for (const item of manifest.items) {
    if (queued >= limit) break;
    const row = (await query(app, S, { response_session_id: item.response_session_id }))[0];
    const existing = (await query(app, J, { job_id: item.job_id }))[0];
    if (existing && existing.status !== 'preparing') { unchanged++; continue; }
    assert(row && !row.deleted_at && row.recording_status === 'uploaded' && Number(row.active_audio_revision) === Number(item.response_revision) && row.formal_audio_asset_id === item.formal_audio_asset_id && (row.report_id || null) === item.expected_report_id && (row.active_report_version || null) === item.expected_report_version, 'SESSION_CHANGED');
    assert([item.expected_active_job_id, item.job_id].includes(row.active_analysis_job_id || null), 'ACTIVE_JOB_CHANGED');
    if (item.source_report_id) {
      const source = (await query(app, R, { report_id: item.source_report_id }))[0];
      refresh.assertSource({ ...item, refresh_kind: refresh.OVERWRITE_KIND, stage: 'analysis' }, row, source);
      assert(hash(source.transcript) === item.transcript_hash, 'TRANSCRIPT_CHANGED');
    }
    const time = timestamp();
    const job = { ...item, operation_id: item.job_id, job_type: 'individual_response_analysis', status: 'preparing', stage: item.source_report_id ? 'analysis' : 'audio_quality', attempt_count: 0, max_attempts: 5, dispatch_token: crypto.randomBytes(24).toString('hex'), lease_token: null, lease_until: null, next_retry_at: time, created_at: time, updated_at: time, finished_at: null, safe_error_code: null, prompt_version: manifest.prompt_version, schema_version: manifest.schema_version, rubric_version: 'dse-individual-response-io-vl-v2' };
    if (item.source_report_id) job.refresh_kind = refresh.OVERWRITE_KIND;
    await update(app, J, { _id: item.job_id }, job, true);
    await update(app, S, { _id: row._id, deleted_at: null, active_analysis_job_id: row.active_analysis_job_id, active_audio_revision: item.response_revision, report_id: row.report_id || null, active_report_version: row.active_report_version || null }, { active_analysis_job_id: item.job_id, updated_at: time, ...(row.analysis_status === 'ready' ? {} : { analysis_status: 'queued' }) });
    const attached = (await query(app, S, { response_session_id: item.response_session_id }))[0];
    assert(attached.active_analysis_job_id === item.job_id, 'JOB_ATTACHMENT_FAILED');
    await update(app, J, { _id: item.job_id, status: 'preparing' }, { status: 'queued', updated_at: timestamp(), next_retry_at: timestamp() });
    queued++;
  }
  console.log(JSON.stringify({ queued, unchanged }));
}
async function status(app, manifest) {
  const counts = {}, errors = {}; let verified = 0;
  const jobs = await query(app, J, { job_id: { $in: manifest.items.map(x => x.job_id) } });
  const responses = await query(app, S, { response_session_id: { $in: manifest.items.map(x => x.response_session_id) } });
  const reports = await query(app, R, { report_id: { $in: responses.map(x => x.report_id).filter(Boolean) } });
  for (const item of manifest.items) {
    const job = jobs.find(x => x.job_id === item.job_id), state = job?.status || 'not_queued'; counts[state] = (counts[state] || 0) + 1;
    if (state === 'failed') errors[job.safe_error_code || 'unknown'] = (errors[job.safe_error_code || 'unknown'] || 0) + 1;
    if (state !== 'succeeded') continue;
    const row = responses.find(x => x.response_session_id === item.response_session_id), report = reports.find(x => x.report_id === row.report_id);
    assert(row.analysis_status === 'ready' && row.active_analysis_job_id === item.job_id && report?.job_id === item.job_id && report.status === 'ready', 'RESULT_POINTER_MISMATCH');
    if (item.source_report_id) { assert.equal(report.report_id, item.source_report_id); assert.equal(report.report_version, item.source_report_version); assert.equal(hash(report.transcript), item.transcript_hash); assert.equal(report.created_at, item.source_report_created_at); }
    assert.equal(report.prompt_version, manifest.prompt_version); assert.equal(report.schema_version, manifest.schema_version);
    assert.deepStrictEqual(report.dse_analysis, row.report, 'CACHE_NOT_REPLACED');
    assert.deepStrictEqual(Object.keys(row.report.domains).sort(), ['ideas_organisation', 'vocabulary_language_patterns']);
    const canonical = lab.canonicalizeIndividualResponseReport(report.dse_analysis, report.transcript.segments);
    assert.deepStrictEqual(canonical, report.dse_analysis, 'RESULT_SCHEMA_OR_LEGACY_FIELDS');
    verified++;
  }
  console.log(JSON.stringify({ total: manifest.items.length, counts, errors, verified })); return { counts, errors, verified };
}
async function retry(app, manifest, limit) {
  let retried = 0;
  for (const item of manifest.items) {
    if (retried >= limit) break;
    const job = (await query(app, J, { job_id: item.job_id }))[0];
    if (!job || job.status !== 'failed' || Number(job.attempt_count) >= Math.min(5, Number(job.max_attempts)) || job.safe_error_code === 'SPEAKING_JOB_SUPERSEDED') continue;
    const row = (await query(app, S, { response_session_id: item.response_session_id }))[0];
    assert(row && !row.deleted_at && row.active_analysis_job_id === item.job_id && Number(row.active_audio_revision) === Number(item.response_revision), 'RETRY_TARGET_CHANGED');
    if (item.source_report_id) {
      const source = (await query(app, R, { report_id: item.source_report_id }))[0];
      refresh.assertSource(job, row, source);
      assert.equal(hash(source.transcript), item.transcript_hash, 'RETRY_TRANSCRIPT_CHANGED');
    }
    await update(app, J, { _id: job._id, status: 'failed', attempt_count: job.attempt_count }, { status: 'queued', next_retry_at: timestamp(), lease_token: null, lease_until: null, finished_at: null, updated_at: timestamp() });
    if (row.analysis_status !== 'ready') await update(app, S, { _id: row._id, active_analysis_job_id: item.job_id, deleted_at: null }, { analysis_status: 'queued', updated_at: timestamp() });
    retried++;
  }
  console.log(JSON.stringify({ retried, attempt_counters_preserved: true }));
}
async function main(argv) {
  const [mode, name, ...args] = argv, file = path.resolve(name || '');
  assert(file.startsWith(path.join(root, '.cloudbase-private') + path.sep), 'PRIVATE_MANIFEST_REQUIRED');
  const app = makeApp();
  if (mode === 'plan') return plan(app, file, args[0], args[1]);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(manifest.environment, ENV);
  if (mode === 'apply') { const limit = Number(args[0]); assert(Number.isInteger(limit) && limit > 0, 'EXPLICIT_BATCH_LIMIT_REQUIRED'); return apply(app, manifest, limit); }
  if (mode === 'status') return status(app, manifest);
  if (mode === 'retry') { const limit = Number(args[0]); assert(Number.isInteger(limit) && limit > 0, 'EXPLICIT_RETRY_LIMIT_REQUIRED'); return retry(app, manifest, limit); }
  throw new Error('MODE_MUST_BE_PLAN_APPLY_STATUS_OR_RETRY');
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({ error: error.code || 'REANALYSIS_FAILED', reason: /^[A-Z_]+$/.test(error.message) ? error.message : 'Cloud request or verification failed; no automatic unbounded retry.' })); process.exitCode = 1; });
module.exports = { makeApp, execute, query, update, plan, apply, status, hash };
