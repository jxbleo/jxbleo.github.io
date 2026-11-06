#!/usr/bin/env node
'use strict';

// Local orchestration only. Frozen publishers retain ownership of all remote writes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const privateRoot = path.join(root, '.cloudbase-private');
const hosts = ['mrcatenglish.com', 'www.mrcatenglish.com'];
const bucket = 'mrcatenglish-web-1441914554';
const region = 'ap-shanghai';
const env = 'mrcat-dev-d9gwy2v1icdfdf597';
const superseded = { 'ielts-unit2-tail72-20261106': 'ielts-c8t1s4-trim-20261106' };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const read = p => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
function save(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, p);
}
function failure(code, stage) { return Object.assign(new Error(code), { code, stage }); }
function classify(error) {
  const raw = String(error?.cause?.code || error?.code || error?.name || 'UNKNOWN');
  const code = /^[A-Za-z0-9_.-]{1,100}$/.test(raw) ? raw : 'UNKNOWN';
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return { code, category: 'dns', action: 'Retry the read-only preflight with approved network access; do not retry uploads.' };
  if (/EPERM|EACCES/.test(code)) return { code, category: 'permission', action: 'Request the required sandbox escalation; do not change global security settings.' };
  if (/TIMEOUT|ETIMEDOUT|AbortError|TimeoutError|ECONN|EPIPE/.test(code)) return { code, category: 'connection', action: 'Check network/proxy and approval execution; a timeout does not establish whether a remote write completed.' };
  if (/AUTH|CREDENTIAL|Expired|Unauthorized|AccessDenied|Signature|SecretId/.test(code)) return { code, category: 'authentication', action: 'Refresh CloudBase CLI login (tcb login), then repeat preflight; never paste credentials into chat.' };
  return { code, category: 'publisher', action: 'Inspect this attempt and the package stage/receipt before any resume; do not bypass guards.' };
}
function packagePath(name, base = privateRoot) {
  if (!/^[a-z0-9][a-z0-9_-]+$/i.test(name || '') || /offline|synthetic|fixture/i.test(name)) throw failure('INVALID_PACKAGE', 'selection');
  const p = path.join(base, name);
  if (!fs.existsSync(p) || fs.realpathSync(p) !== p) throw failure('INVALID_PACKAGE', 'selection');
  return p;
}
function inspect(p) {
  let receipt;
  try { receipt = read(path.join(p, 'receipt.json')); } catch { return { package: path.basename(p), state: 'invalid-receipt' }; }
  const state = read(path.join(p, 'release-control-state.json'));
  return {
    package: path.basename(p),
    supersededBy: superseded[path.basename(p)],
    state: receipt ? 'receipt-present' : state?.state || (fs.existsSync(path.join(p, 'plan.json')) ? 'prepared-or-partial' : 'no-receipt'),
    recordedAt: receipt?.at || receipt?.publishedAt || null,
    units: receipt?.units, revision: receipt?.revision,
    receiptSha256: receipt ? sha(fs.readFileSync(path.join(p, 'receipt.json'))) : null,
    lastAttempt: state || undefined,
    liveVerifiedNow: false,
  };
}
function receiptFiles(receipt) {
  const files = receipt?.files || receipt?.objects || [];
  if (!Array.isArray(files) || !files.length) throw failure('RECEIPT_REQUIRES_PACKAGE_SPECIFIC_VERIFICATION', 'verify');
  return files.map(f => {
    if (typeof f.key !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(f.key) || f.key.startsWith('/') || f.key.split('/').includes('..') || !/^[a-f0-9]{64}$/.test(f.sha256)) throw failure('UNSUPPORTED_RECEIPT', 'verify');
    return { key: f.key, sha256: f.sha256 };
  });
}
// Subprocess deadlines also cover DNS and SDK handles that ignore AbortSignal.
function probe(stage, extra = [], timeout = 15000) {
  const r = spawnSync(process.execPath, [__filename, '_probe', stage, ...extra], {
    cwd: root, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
  });
  if (r.error) throw failure(r.error.code === 'ETIMEDOUT' ? 'PROBE_TIMEOUT' : r.error.code, stage);
  let output;
  try { output = JSON.parse(r.stdout); } catch { throw failure('PROBE_NO_RESULT', stage); }
  if (r.status !== 0 || !output.ok) throw failure(output.code || 'PROBE_FAILED', stage);
  return output;
}
async function worker(stage, argument) {
  if (stage === 'dns') {
    const { lookup } = require('node:dns').promises;
    for (const host of [...hosts, `${bucket}.cos.${region}.myqcloud.com`, 'tcb-api.tencentcloudapi.com']) await lookup(host);
  } else if (stage === 'public-http') {
    for (const host of hosts) {
      const r = await fetch(`https://${host}/index.html`, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw failure('HTTP_' + r.status, stage);
    }
  } else if (stage === 'refresh-login') {
    const r = spawnSync('tcb', ['env', 'list', '--json'], { timeout: 10000, killSignal: 'SIGKILL', stdio: 'pipe' });
    if (r.error) throw failure(r.error.code, stage);
    if (r.status !== 0) throw failure('AUTH_REFRESH_FAILED', stage);
  } else if (stage === 'credentials' || stage === 'cos-read' || stage === 'database-read') {
    let c;
    try { c = read(path.join(os.homedir(), '.config/.cloudbase/auth.json'))?.credential; } catch { throw failure('AUTH_FILE_INVALID', stage); }
    if (!c || !(c.secretId || c.tmpSecretId) || !(c.secretKey || c.tmpSecretKey)) throw failure('AUTH_LOGIN_REQUIRED', stage);
    // Use the same expiry contract as the existing project helper, without implicit refresh.
    if (c.tmpExpired && Date.now() > Number(c.tmpExpired) - 60000) throw failure('AUTH_EXPIRED', stage);
    if (stage === 'cos-read') {
      const COS = require('cos-nodejs-sdk-v5');
      const cos = new COS({ SecretId: c.secretId || c.tmpSecretId, SecretKey: c.secretKey || c.tmpSecretKey, SecurityToken: c.token || c.tmpToken, Timeout: 8000 });
      await new Promise((resolve, reject) => cos.headObject({ Bucket: bucket, Region: region, Key: 'index.html' }, (e, r) => e ? reject(e) : resolve(r)));
    }
    if (stage === 'database-read') {
      const sdk = require('@cloudbase/node-sdk').init({ env, region, secretId: c.secretId || c.tmpSecretId, secretKey: c.secretKey || c.tmpSecretKey, sessionToken: c.token || c.tmpToken });
      await sdk.database().collection('sets').limit(1).get(); // Discard content, never log records.
    }
  } else if (stage === 'verify') {
    const files = receiptFiles(read(path.join(packagePath(argument), 'receipt.json')));
    for (const f of files) for (const host of hosts) {
      const r = await fetch(`https://${host}/${f.key}?release_check=${Date.now()}`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw failure('HTTP_' + r.status, stage);
      if (sha(Buffer.from(await r.arrayBuffer())) !== f.sha256) throw failure('LIVE_HASH_DIFFERS_FROM_RECEIPT', stage);
    }
    return { ok: true, checkedObjects: files.length, checkedUrls: files.length * hosts.length, scope: 'receipt-static-files-only' };
  } else throw failure('UNKNOWN_STAGE', stage);
  return { ok: true, stage };
}
function preflight(database, runProbe = probe) {
  const stages = ['credentials', 'dns', 'public-http', 'cos-read', ...(database ? ['database-read'] : [])];
  for (const stage of stages) {
    console.error(`[preflight] ${stage}`);
    try { runProbe(stage); } catch (e) {
      if (stage !== 'credentials' || e.code !== 'AUTH_EXPIRED') throw e;
      console.error('[preflight] refreshing existing CLI login (bounded, no interactive login)');
      runProbe('refresh-login'); runProbe('credentials');
    }
  }
  return { ok: true, stages, writePermissionTested: false };
}
function runChild(file, timeoutMs, onProgress = () => {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [file], { cwd: root, detached: true, stdio: 'inherit' });
    let timedOut = false, interrupted = false, hardKill, finished = false;
    const kill = signal => { try { process.kill(-child.pid, signal); } catch {} };
    const stop = () => { kill('SIGTERM'); hardKill = setTimeout(() => kill('SIGKILL'), 1500); };
    const interrupt = () => { interrupted = true; stop(); };
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const deadline = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const heartbeat = setInterval(onProgress, 30000);
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline); clearTimeout(hardKill); clearInterval(heartbeat);
      kill('SIGKILL'); // Also reap any descendants left behind by a timed-out publisher.
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
      resolve({ ...result, timedOut, interrupted });
    };
    child.once('error', e => finish({ code: null, error: e.code }));
    child.once('close', (code, signal) => finish({ code, signal }));
  });
}
async function runPackage(p, database, resume, timeoutMs = 600000, options = {}) {
  if (superseded[path.basename(p)]) throw failure('PACKAGE_SUPERSEDED_CHECK_STATUS', 'selection');
  const file = path.join(p, 'publish.cjs');
  if (!fs.existsSync(file)) throw failure('PUBLISHER_MISSING', 'selection');
  if (fs.existsSync(path.join(p, 'receipt.json')) && !resume) throw failure('RECEIPT_EXISTS_VERIFY_BEFORE_RESUME', 'selection');
  const lock = path.join(options.lockDir || privateRoot, 'release-control.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); } catch (e) { if (e.code === 'EEXIST') throw failure('ANOTHER_RELEASE_OR_STALE_LOCK', 'lock'); throw e; }
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, package: path.basename(p), at: new Date().toISOString() }));
  const stateFile = path.join(p, 'release-control-state.json');
  const beforeReceipt = fs.existsSync(path.join(p, 'receipt.json')) ? sha(fs.readFileSync(path.join(p, 'receipt.json'))) : null;
  const errorFile = path.join(p, 'last-error.json');
  const beforeError = fs.existsSync(errorFile) ? sha(fs.readFileSync(errorFile)) : null;
  const attempt = { startedAt: new Date().toISOString(), package: path.basename(p), state: 'preflight', publisherStarted: false };
  const record = () => { save(stateFile, attempt); save(path.join(p, 'control-attempts', attempt.startedAt.replace(/[:.]/g, '-') + '.json'), attempt); };
  try {
    record(); (options.preflight || preflight)(database);
    attempt.state = 'running'; attempt.publisherStarted = true; record();
    const result = await (options.runChild || runChild)(file, timeoutMs, () => console.error(`[publish] still running: ${path.basename(p)}; no completion claimed`));
    attempt.process = result;
    if (result.timedOut || result.interrupted || result.code !== 0) throw failure(result.timedOut ? 'PUBLISH_TIMEOUT' : result.interrupted ? 'PUBLISH_INTERRUPTED' : 'PUBLISH_FAILED', 'publisher');
    const receipt = path.join(p, 'receipt.json');
    if (!fs.existsSync(receipt) || sha(fs.readFileSync(receipt)) === beforeReceipt) throw failure('NO_NEW_RECEIPT', 'receipt');
    read(receipt); // Reject malformed receipt; keep receipt provenance with the publisher.
    attempt.state = 'publisher-completed-with-receipt';
    attempt.receiptSha256 = sha(fs.readFileSync(receipt));
    attempt.completedAt = new Date().toISOString(); record();
    return attempt;
  } catch (e) {
    attempt.state = attempt.publisherStarted ? 'failed-or-partial-needs-readback' : 'blocked-before-publisher';
    if (attempt.publisherStarted && fs.existsSync(errorFile) && sha(fs.readFileSync(errorFile)) !== beforeError) {
      try {
        const detail = read(errorFile);
        attempt.publisherDiagnostic = {
          stage: /^[a-zA-Z0-9_-]{1,100}$/.test(detail.stage) ? detail.stage : 'see-package-error',
          ...classify({ code: detail.error }),
        };
        console.error(JSON.stringify({ publisherDiagnostic: attempt.publisherDiagnostic }));
      } catch { /* A malformed package diagnostic cannot hide the original failure. */ }
    }
    attempt.error = { stage: e.stage, ...classify(e) }; record(); throw e;
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
async function main(args) {
  const [command, name] = args;
  if (command === 'status') {
    const folders = name ? [packagePath(name)] : fs.readdirSync(privateRoot, { withFileTypes: true }).filter(d => d.isDirectory() && !/offline|synthetic|fixture/i.test(d.name) && fs.existsSync(path.join(privateRoot, d.name, 'publish.cjs'))).map(d => path.join(privateRoot, d.name));
    return folders.map(inspect);
  }
  if (command === 'preflight') {
    const output = path.join(privateRoot, 'release-control', 'preflight.json');
    try {
      const result = { ...preflight(args.includes('--database')), at: new Date().toISOString() };
      save(output, result); return result;
    } catch (e) {
      save(output, { ok: false, at: new Date().toISOString(), publisherStarted: false, stage: e.stage, ...classify(e) }); throw e;
    }
  }
  if (command === 'verify') {
    const p = packagePath(name), receipt = read(path.join(p, 'receipt.json'));
    const files = receiptFiles(receipt);
    const report = { ...probe('verify', [name], Math.max(15000, files.length * 2 * 12000)), at: new Date().toISOString(), receiptSha256: sha(fs.readFileSync(path.join(p, 'receipt.json'))), databaseVerified: false };
    save(path.join(p, 'release-control-verification.json'), report); return report;
  }
  if (command === 'run') return runPackage(packagePath(name), args.includes('--database'), args.includes('--resume'));
  throw failure('USAGE_status_[package]_OR_preflight_[--database]_OR_verify_package_OR_run_package_[--database]_[--resume]', 'arguments');
}
module.exports = { classify, inspect, receiptFiles, packagePath, preflight, runChild, runPackage };
if (require.main === module) {
  if (process.argv[2] === '_probe') {
    worker(process.argv[3], process.argv[4]).then(r => { console.log(JSON.stringify(r)); process.exit(0); }, e => { console.log(JSON.stringify({ ok: false, code: classify(e).code })); process.exit(1); });
  } else main(process.argv.slice(2)).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => {
    console.error(JSON.stringify({ ok: false, stage: e.stage, ...classify(e) }, null, 2)); process.exitCode = 1;
  });
}
