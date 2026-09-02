"use strict";

const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");
const tcbApiCaller = require("@cloudbase/node-sdk/dist/utils/tcbapirequester");
const { SCHEMA_VERSION } = require("./schemas");
const { PROMPT_VERSION } = require("./prompts");
const { callStructuredVision } = require("./model-provider");
const { upsertPersonalVocabularyItem, compactText } = require("../_shared/personal-vocabulary-items");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const SESSIONS = "vocabulary_scan_sessions";
const PAGES = "vocabulary_scan_pages";
const JOBS = "vocabulary_scan_jobs";
const MAX_PAGES = 5;
const MAX_CANDIDATES = 100;
const MAX_PAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOKENS = 6000;
const MAX_SENTENCES = 240;
const MAX_PAGE_CHARS = 30000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 4;
const MAX_MANUAL_RETRIES = 2;
const RETRY_DELAYS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];
const ACTIVE_SCAN_STATUSES = ["uploading", "queued", "processing", "review", "partial_failure", "committing"];

function now() { return new Date(); }
function randomId(prefix) { return `${prefix}_${crypto.randomBytes(16).toString("hex")}`; }
function stableId(prefix, ...parts) { return `${prefix}_${crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 40)}`; }
function dayKey(value = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value); }
function dateMs(value) { const result = value ? new Date(value).getTime() : 0; return Number.isFinite(result) ? result : 0; }
function secretMatches(left, right) { const a = Buffer.from(String(left || "")); const b = Buffer.from(String(right || "")); return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b); }
function operation(value) { return compactText(value, 160).replace(/[^a-zA-Z0-9_.:-]/g, "_"); }
async function authenticatedUid() {
  const info = await app.auth().getUserInfo();
  const uid = String(info && (info.uid || info.userId) || "");
  if (!uid) throw new Error("AUTH_REQUIRED");
  return uid;
}

async function activeStudent() {
  const uid = await authenticatedUid();
  const result = await db.collection("students").where({ auth_uid: uid, active: true }).limit(1).get();
  const student = result.data && result.data[0];
  if (!student || (student.role || "student") !== "student") throw new Error(student ? "STUDENT_REQUIRED" : "STUDENT_NOT_LINKED");
  return student;
}
async function getOne(collection, where) { const result = await db.collection(collection).where(where).limit(1).get(); return result.data && result.data[0] || null; }
async function getActiveScan(studentUid) {
  const result = await db.collection(SESSIONS).where({
    student_uid: studentUid,
    status: db.command.in(ACTIVE_SCAN_STATUSES),
  }).limit(5).get();
  return (result.data || []).sort((a, b) => dateMs(b.updated_at) - dateMs(a.updated_at))[0] || null;
}
function publicPage(page) {
  return { page_id: page.page_id, page_index: Number(page.page_index), status: page.status, mime_type: page.mime_type, error_code: page.error_code || null, ocr: page.ocr || null, uncertainty_acknowledged: page.uncertainty_acknowledged || [], updated_at: page.updated_at || null };
}
function publicJob(job) { return { job_id: job.job_id, page_id: job.page_id, status: job.status, attempt_count: Number(job.attempt_count || 0), error_code: job.error_code || null, next_retry_at: job.next_retry_at || null }; }
function publicCandidate(candidate) { return { candidate_id: candidate.candidate_id, kind: candidate.kind, page_id: candidate.page_id, page_index: candidate.page_index, sentence_id: candidate.sentence_id, token_ids: candidate.token_ids, text: candidate.text, normalized_text: candidate.normalized_text, context: candidate.context, context_token_ranges: Array.isArray(candidate.context_token_ranges) ? candidate.context_token_ranges : [], source_title: candidate.source_title, source_path: candidate.source_path, status: candidate.status || "pending", error_code: candidate.error_code || null }; }

function tokenizeSentence(sentence) {
  const text = String(sentence || "");
  const result = [];
  const pattern = /[A-Za-z]+(?:['’][A-Za-z]+|[-‑–][A-Za-z]+)*/g;
  let match;
  while ((match = pattern.exec(text))) {
    result.push({ token_id: `token_${result.length + 1}`, text: match[0], normalized_text: match[0].normalize("NFKC").toLowerCase(), index: result.length, start: match.index, end: match.index + match[0].length, clickable: true });
    if (result.length >= MAX_TOKENS) break;
  }
  return result;
}

function canonicalizeOcr(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.blocks)) throw new Error("OCR_EMPTY");
  const blocks = [];
  let sentenceCount = 0;
  let totalChars = 0;
  let totalTokens = 0;
  for (const sourceBlock of raw.blocks.slice(0, 80)) {
    if (!sourceBlock || !Array.isArray(sourceBlock.sentences)) continue;
    const sentences = [];
    for (const sourceSentence of sourceBlock.sentences.slice(0, 80)) {
      const text = String(sourceSentence && sourceSentence.text || "").replace(/\s+/g, " ").trim().slice(0, 1200);
      if (!text) continue;
      const tokens = tokenizeSentence(text);
      totalChars += text.length;
      totalTokens += tokens.length;
      if (totalChars > MAX_PAGE_CHARS || totalTokens > MAX_TOKENS) throw new Error("OCR_TOO_LARGE");
      const tokenByIndex = new Map(tokens.map((token) => [token.index, token]));
      const uncertain = Array.isArray(sourceSentence.uncertain_tokens) ? sourceSentence.uncertain_tokens.slice(0, 40).flatMap((item) => {
        const token = tokenByIndex.get(Number(item && item.token_index));
        return token && String(item.token_text || "").normalize("NFKC").toLowerCase() === token.normalized_text ? [{ token_id: token.token_id, token_text: token.text, reason: compactText(item.reason, 160) || "Unclear transcription" }] : [];
      }) : [];
      const marked = Array.isArray(sourceSentence.marked_tokens) ? sourceSentence.marked_tokens.slice(0, 40).flatMap((item) => {
        const token = tokenByIndex.get(Number(item && item.token_index));
        const confidence = String(item && item.confidence || "").toLowerCase();
        const type = String(item && item.mark_type || "").toLowerCase();
        return token && ["high", "medium"].includes(confidence) && ["underline", "circle", "box", "highlighter", "arrow", "star"].includes(type) && String(item.token_text || "").normalize("NFKC").toLowerCase() === token.normalized_text ? [{ token_id: token.token_id, token_text: token.text, mark_type: type, confidence }] : [];
      }) : [];
      const uniqueUncertain = Array.from(new Map(uncertain.map((item) => [item.token_id, item])).values());
      const uniqueMarked = Array.from(new Map(marked.map((item) => [item.token_id, item])).values());
      sentences.push({ sentence_id: `sentence_${sentenceCount + 1}`, text, tokens, uncertain_tokens: uniqueUncertain, marked_tokens: uniqueMarked });
      sentenceCount += 1;
      if (sentenceCount >= MAX_SENTENCES) break;
    }
    if (sentences.length) blocks.push({ block_type: ["paragraph", "heading", "question", "option", "table", "other"].includes(sourceBlock.block_type) ? sourceBlock.block_type : "other", sentences });
    if (sentenceCount >= MAX_SENTENCES) break;
  }
  if (!blocks.length) throw new Error("OCR_EMPTY");
  if (!totalTokens) return { blocks, has_english: false, token_count: 0, sentence_count: sentenceCount };
  return { blocks, has_english: true, token_count: totalTokens, sentence_count: sentenceCount };
}

function pageById(pages, pageId) { return (pages || []).find((page) => page.page_id === pageId); }
function findSentence(page, sentenceId) { for (const block of page.ocr && page.ocr.blocks || []) { const found = (block.sentences || []).find((sentence) => sentence.sentence_id === sentenceId); if (found) return found; } return null; }
function candidateContext(sentence, selected) {
  const full = String(sentence.text || "");
  const first = Math.min(...selected.map((token) => token.start));
  const last = Math.max(...selected.map((token) => token.end));
  if (last - first > 320) throw new Error("CANDIDATE_CONTEXT_TOO_LONG");
  let windowStart = 0;
  if (full.length > 320) {
    const desired = Math.max(0, first - Math.floor((320 - (last - first)) / 2));
    windowStart = Math.min(desired, full.length - 320);
  }
  const rawContext = full.slice(windowStart, windowStart + 320);
  const leadingWhitespace = (rawContext.match(/^\s*/) || [""])[0].length;
  const context = rawContext.trim();
  return {
    context,
    ranges: selected.map((token) => ({ start: token.start - windowStart - leadingWhitespace, end: token.end - windowStart - leadingWhitespace }))
      .filter((range) => range.start >= 0 && range.end <= context.length),
  };
}
function rebuildCandidate(page, spec) {
  if (!page || page.status !== "succeeded" || !page.ocr) throw new Error("SCAN_PAGE_NOT_READY");
  const sentence = findSentence(page, compactText(spec && spec.sentence_id, 100));
  const tokenIds = Array.from(new Set(Array.isArray(spec && spec.token_ids) ? spec.token_ids.map((item) => compactText(item, 80)).filter(Boolean) : []));
  if (!sentence || tokenIds.length < 1 || tokenIds.length > 16) throw new Error("CANDIDATE_INVALID");
  const selected = tokenIds.map((id) => sentence.tokens.find((token) => token.token_id === id)).filter(Boolean);
  if (selected.length !== tokenIds.length) throw new Error("CANDIDATE_TOKEN_INVALID");
  selected.sort((a, b) => a.index - b.index);
  const text = selected.map((token) => token.text).join(" ");
  if (text.length > 120) throw new Error("CANDIDATE_TOO_LONG");
  const normalizedText = text.normalize("NFKC").toLowerCase();
  const kind = selected.length === 1 ? "word" : "phrase";
  const candidateId = stableId("scan_candidate", page.page_id, sentence.sentence_id, ...selected.map((token) => token.token_id));
  const context = candidateContext(sentence, selected);
  return { candidate_id: candidateId, kind, page_id: page.page_id, page_index: Number(page.page_index), sentence_id: sentence.sentence_id, token_ids: selected.map((token) => token.token_id), text, normalized_text: normalizedText, context: context.context, context_token_ranges: context.ranges, source_title: `Scanned · ${dayKey(page.created_at || now())} · Page ${Number(page.page_index) + 1}`, source_path: "my-words.html", status: "pending" };
}

async function invokeAsync(action, job) {
  const context = cloudbase.CloudBase && cloudbase.CloudBase.getCloudbaseContext ? cloudbase.CloudBase.getCloudbaseContext() : {};
  const routeKey = context && context.TCB_ROUTE_KEY;
  const result = await tcbApiCaller.request({ config: app.config, params: { action: "functions.invokeFunction", function_name: "vocabularyScan", async: true, request_data: JSON.stringify({ action, job_id: job.job_id, dispatch_token: job.dispatch_token }) }, method: "post", headers: { "content-type": "application/json", ...(routeKey ? { "X-TCB-Route-Key": routeKey } : {}) } });
  if (result && result.code) throw new Error("SCAN_DISPATCH_FAILED");
}

function imageExtension(mime) { return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[String(mime || "").toLowerCase()] || ""; }
function uploadMetadataView(metadata, cloudPath) {
  const data = metadata && metadata.data || {};
  return { url: data.url, token: data.token, authorization: data.authorization, file_id: data.fileId || data.file_id, cos_file_id: data.cosFileId || data.cos_file_id, cloud_path: cloudPath };
}
function pageManifest(pages) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_PAGES) throw new Error("PAGE_COUNT_INVALID");
  return pages.map((page, index) => {
    const mime_type = compactText(page && page.mime_type, 80).toLowerCase();
    const extension = imageExtension(mime_type);
    const size_bytes = Number(page && page.size_bytes);
    if (!extension || !Number.isInteger(size_bytes) || size_bytes < 1 || size_bytes > MAX_PAGE_BYTES) throw new Error("PHOTO_FILE_INVALID");
    return { page_index: index, mime_type, size_bytes, file_name: compactText(page && page.file_name, 160) || `scan-${index + 1}.${extension}` };
  });
}
function sameManifest(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((item, index) => item.page_index === right[index].page_index && item.mime_type === right[index].mime_type && Number(item.size_bytes) === Number(right[index].size_bytes));
}
async function clearActiveScanPointer(studentUid, scanId) {
  const student = await getOne("students", { auth_uid: studentUid });
  if (student && student.active_vocabulary_scan_id === scanId) {
    await db.collection("students").doc(student._id).update({ active_vocabulary_scan_id: null });
  }
}
async function ensureUploadRows(student, scan, manifest) {
  const uploads = [];
  for (const item of manifest) {
    const pageId = stableId("scan_page", student.auth_uid, scan.scan_id, scan.operation_id, String(item.page_index));
    const extension = imageExtension(item.mime_type);
    const cloudPath = `vocabulary-scan/${student.auth_uid}/${scan.scan_id}/${pageId}.${extension}`;
    const metadata = await app.getUploadMetadata({ cloudPath });
    const view = uploadMetadataView(metadata, cloudPath);
    let row = await getOne(PAGES, { page_id: pageId, scan_id: scan.scan_id, student_uid: student.auth_uid });
    if (!row) {
      const created = now();
      const record = { page_id: pageId, scan_id: scan.scan_id, student_uid: student.auth_uid, page_index: item.page_index, status: "uploading", file_id: view.file_id, cloud_path: cloudPath, mime_type: item.mime_type, expected_size_bytes: item.size_bytes, operation_id: scan.operation_id, expires_at: scan.expires_at, created_at: created, updated_at: created };
      try { await db.collection(PAGES).doc(pageId).create(record); row = record; }
      catch (_error) { row = await getOne(PAGES, { page_id: pageId, scan_id: scan.scan_id, student_uid: student.auth_uid }); }
    }
    if (!row || Number(row.page_index) !== item.page_index || row.mime_type !== item.mime_type || Number(row.expected_size_bytes) !== item.size_bytes) throw new Error("IDEMPOTENCY_KEY_REUSED");
    if (row.status === "uploading") {
      await db.collection(PAGES).doc(row._id || pageId).update({ file_id: view.file_id, cloud_path: cloudPath, updated_at: now() });
      uploads.push({ page_id: pageId, page_index: item.page_index, ...view });
    }
  }
  return uploads;
}
function featureEnabled() { return String(process.env.VOCABULARY_SCAN_ENABLED || "false").toLowerCase() === "true"; }
async function reserveQuotaForScan(student, scan) {
  const key = dayKey();
  let reservedAt = scan.quota_reserved_at || null;
  await db.runTransaction(async (transaction) => {
    const scanResult = await transaction.collection(SESSIONS).where({ scan_id: scan.scan_id, student_uid: student.auth_uid }).limit(1).get();
    const currentScan = scanResult.data && scanResult.data[0];
    if (!currentScan) throw new Error("SCAN_NOT_FOUND");
    if (currentScan.quota_reserved_at) { reservedAt = currentScan.quota_reserved_at; return; }
    const currentResult = await transaction.collection("students").where({ _id: student._id, auth_uid: student.auth_uid, active: true }).limit(1).get();
    const current = currentResult.data && currentResult.data[0]; if (!current) throw new Error("STUDENT_NOT_LINKED");
    const scans = String(current.vocabulary_scan_usage_day || "") === key ? Number(current.vocabulary_scan_count_today || 0) : 0;
    const pages = String(current.vocabulary_scan_usage_day || "") === key ? Number(current.vocabulary_scan_pages_today || 0) : 0;
    if (scans >= 10) throw new Error("SCAN_DAILY_LIMIT");
    if (pages + Number(currentScan.page_count || 0) > 30) throw new Error("SCAN_PAGE_DAILY_LIMIT");
    reservedAt = now();
    await transaction.collection("students").doc(current._id).update({ vocabulary_scan_usage_day: key, vocabulary_scan_count_today: scans + 1, vocabulary_scan_pages_today: pages + Number(currentScan.page_count || 0) });
    await transaction.collection(SESSIONS).doc(currentScan._id).update({ quota_reserved_at: reservedAt, quota_reserved_pages: Number(currentScan.page_count || 0), day_key: key, updated_at: reservedAt });
  });
  return reservedAt;
}
async function refundUnusedQuota(scan) {
  if (!scan || !scan.quota_reserved_at || scan.provider_call_started || scan.quota_refunded_at) return false;
  let refunded = false;
  await db.runTransaction(async (transaction) => {
    const scanResult = await transaction.collection(SESSIONS).where({ scan_id: scan.scan_id, student_uid: scan.student_uid }).limit(1).get();
    const current = scanResult.data && scanResult.data[0];
    if (!current || !current.quota_reserved_at || current.provider_call_started || current.quota_refunded_at) return;
    const studentResult = await transaction.collection("students").where({ auth_uid: scan.student_uid }).limit(1).get();
    const profile = studentResult.data && studentResult.data[0];
    if (!profile) return;
    const update = { quota_refunded_at: now(), updated_at: now() };
    await transaction.collection(SESSIONS).doc(current._id).update(update);
    if (profile.vocabulary_scan_usage_day === current.day_key) {
      await transaction.collection("students").doc(profile._id).update({
        vocabulary_scan_count_today: Math.max(0, Number(profile.vocabulary_scan_count_today || 0) - 1),
        vocabulary_scan_pages_today: Math.max(0, Number(profile.vocabulary_scan_pages_today || 0) - Number(current.quota_reserved_pages || current.page_count || 0)),
      });
    }
    refunded = true;
  });
  return refunded;
}
async function markProviderCallStarted(scan, page) {
  const at = now();
  await db.collection(PAGES).doc(page._id).update({ provider_called_at: page.provider_called_at || at, updated_at: at });
  if (!scan.provider_call_started) await db.collection(SESSIONS).doc(scan._id).update({ provider_call_started: true, provider_call_started_at: at, updated_at: at });
}
async function refreshScanStatus(scanId, studentUid) {
  const scan = await getOne(SESSIONS, { scan_id: scanId, student_uid: studentUid });
  if (!scan || ["discarded", "expired", "completed"].includes(scan.status)) return scan;
  const result = await db.collection(PAGES).where({ scan_id: scanId, student_uid: studentUid }).limit(MAX_PAGES).get();
  const pages = (result.data || []).filter((page) => page.status !== "deleted");
  let status = "processing";
  if (pages.length && pages.every((page) => ["succeeded", "failed"].includes(page.status))) {
    status = pages.some((page) => page.status === "failed") ? "partial_failure" : "review";
  } else if (pages.some((page) => page.status === "queued")) status = "queued";
  await db.collection(SESSIONS).doc(scan._id).update({ status, updated_at: now() });
  const next = { ...scan, status };
  if (pages.length && pages.every((page) => page.status === "failed") && !next.provider_call_started) await refundUnusedQuota(next);
  return next;
}
async function getCapability(student) {
  const key = dayKey();
  const usage = String(student.vocabulary_scan_usage_day || "") === key ? { scans: Number(student.vocabulary_scan_count_today || 0), pages: Number(student.vocabulary_scan_pages_today || 0) } : { scans: 0, pages: 0 };
  const active = await getActiveScan(student.auth_uid);
  const enabled = String(process.env.VOCABULARY_SCAN_ENABLED || "false").toLowerCase() === "true";
  return { success: true, enabled, limits: { scans_per_day: 10, pages_per_day: 30, max_pages: MAX_PAGES }, usage: { day_key: key, scans: usage.scans, pages: usage.pages }, current_scan: active ? { scan_id: active.scan_id, status: active.status, expires_at: active.expires_at } : null };
}

async function startUpload(student, event) {
  if (!featureEnabled()) throw new Error("SCAN_DISABLED");
  const op = operation(event.operation_id);
  if (!op) throw new Error("OPERATION_ID_REQUIRED");
  const manifest = pageManifest(event.pages);
  const existing = await getOne(SESSIONS, { student_uid: student.auth_uid, operation_id: op });
  if (existing) {
    if (!sameManifest(existing.page_manifest, manifest)) throw new Error("IDEMPOTENCY_KEY_REUSED");
    return { success: true, idempotent_replay: true, scan_id: existing.scan_id, uploads: await ensureUploadRows(student, existing, manifest) };
  }
  const active = await getActiveScan(student.auth_uid);
  if (active) throw new Error("SCAN_ALREADY_ACTIVE");
  const scanId = randomId("scan");
  const created = now();
  const expires = new Date(created.getTime() + SESSION_TTL_MS);
  const pageIds = manifest.map((item) => stableId("scan_page", student.auth_uid, scanId, op, String(item.page_index)));
  const session = { scan_id: scanId, student_uid: student.auth_uid, status: "uploading", operation_id: op, page_ids: pageIds, page_count: manifest.length, page_manifest: manifest, candidates: [], candidate_revision: 0, committed_candidates: [], commit_operation_id: null, commit_summary: null, cleanup_status: "not_needed", scan_version: { prompt: PROMPT_VERSION, schema: SCHEMA_VERSION, canonicalization: "scan-canonical-v1" }, day_key: dayKey(created), provider_call_started: false, expires_at: expires, created_at: created, updated_at: created };
  try {
    await db.runTransaction(async (transaction) => {
      const currentResult = await transaction.collection("students").where({ _id: student._id, auth_uid: student.auth_uid, active: true }).limit(1).get();
      const current = currentResult.data && currentResult.data[0];
      if (!current || (current.role || "student") !== "student") throw new Error("STUDENT_NOT_LINKED");
      if (current.active_vocabulary_scan_id) {
        const linkedResult = await transaction.collection(SESSIONS).where({ scan_id: current.active_vocabulary_scan_id, student_uid: student.auth_uid }).limit(1).get();
        const linked = linkedResult.data && linkedResult.data[0];
        const linkedIsActive = linked && ACTIVE_SCAN_STATUSES.includes(linked.status) && (!dateMs(linked.expires_at) || dateMs(linked.expires_at) > created.getTime());
        if (linkedIsActive) throw new Error("SCAN_ALREADY_ACTIVE");
        if (linked && ACTIVE_SCAN_STATUSES.includes(linked.status)) {
          await transaction.collection(SESSIONS).doc(linked._id).update({ status: "expired", candidates: [], cleanup_status: "pending", expired_at: created, updated_at: created });
        }
      }
      await transaction.collection(SESSIONS).doc(scanId).create(session);
      await transaction.collection("students").doc(current._id).update({ active_vocabulary_scan_id: scanId });
    });
  } catch (error) {
    const replay = await getOne(SESSIONS, { student_uid: student.auth_uid, operation_id: op });
    if (!replay || !sameManifest(replay.page_manifest, manifest)) throw error;
    return { success: true, idempotent_replay: true, scan_id: replay.scan_id, uploads: await ensureUploadRows(student, replay, manifest) };
  }
  return { success: true, scan_id: scanId, uploads: await ensureUploadRows(student, session, manifest) };
}

async function finishUpload(student, event) {
  if (!featureEnabled()) throw new Error("SCAN_DISABLED");
  const scan = await getOne(SESSIONS, { scan_id: compactText(event.scan_id, 100), student_uid: student.auth_uid }); if (!scan) throw new Error("SCAN_NOT_FOUND");
  if (scan.status !== "uploading") return { success: true, idempotent_replay: true, ...(await currentScan(student, scan)) };
  const rows = await db.collection(PAGES).where({ scan_id: scan.scan_id, student_uid: student.auth_uid }).limit(MAX_PAGES).get(); const pages = (rows.data || []).sort((a, b) => Number(a.page_index) - Number(b.page_index));
  if (pages.length !== scan.page_count || pages.some((page) => !page.file_id || !["uploading", "queued"].includes(page.status))) throw new Error("PHOTO_UPLOAD_INCOMPLETE");
  const info = await app.getFileInfo({ fileList: pages.map((page) => page.file_id) }); const found = new Map((info.fileList || []).map((file) => [file.fileID, file]));
  for (const page of pages) {
    const file = found.get(page.file_id);
    const actualSize = Number(file && file.size || 0);
    const actualMime = compactText(file && (file.contentType || file.content_type || file.mimeType), 80).toLowerCase();
    if (!file || actualSize !== Number(page.expected_size_bytes) || actualSize > MAX_PAGE_BYTES || (actualMime && actualMime !== page.mime_type)) throw new Error("PHOTO_UPLOAD_INVALID");
  }
  const at = now(); const jobs = [];
  const quotaReservedAt = await reserveQuotaForScan(student, scan);
  for (const page of pages) {
    const jobId = stableId("scan_job", student.auth_uid, scan.scan_id, page.page_id); const dispatchToken = randomId("dispatch"); const job = { job_id: jobId, job_type: "vocabulary_page_ocr", scan_id: scan.scan_id, page_id: page.page_id, student_uid: student.auth_uid, dispatch_token: dispatchToken, lease_token: null, lease_until: null, status: "queued", attempt_count: 0, manual_retry_count: 0, next_retry_at: at, error_code: null, prompt_version: PROMPT_VERSION, schema_version: SCHEMA_VERSION, created_at: at, updated_at: at };
    let existing = await getOne(JOBS, { job_id: jobId, student_uid: student.auth_uid });
    if (!existing) {
      try { await db.collection(JOBS).doc(jobId).create(job); existing = job; }
      catch (_error) { existing = await getOne(JOBS, { job_id: jobId, student_uid: student.auth_uid }); }
    }
    if (!existing) throw new Error("SCAN_JOB_CREATE_FAILED");
    jobs.push(existing);
    if (page.status === "uploading") await db.collection(PAGES).doc(page._id).update({ status: "queued", uploaded_at: page.uploaded_at || at, expires_at: new Date(at.getTime() + SESSION_TTL_MS), updated_at: at });
  }
  await refreshScanStatus(scan.scan_id, student.auth_uid);
  for (const job of jobs) { if (job.status === "queued") { try { await invokeAsync("processQueuedPageJob", job); } catch (_) {} } }
  return { success: true, accepted: true, ...(await currentScan(student, { ...scan, status: "queued", quota_reserved_at: quotaReservedAt })) };
}

async function currentScan(student, supplied) {
  const scan = supplied || await getActiveScan(student.auth_uid); if (!scan) return { success: true, scan: null };
  const rows = await db.collection(PAGES).where({ scan_id: scan.scan_id, student_uid: student.auth_uid }).limit(MAX_PAGES).get(); const pages = (rows.data || []).sort((a, b) => Number(a.page_index) - Number(b.page_index));
  const jobs = await db.collection(JOBS).where({ scan_id: scan.scan_id, student_uid: student.auth_uid }).limit(MAX_PAGES).get();
  return { success: true, scan: { scan_id: scan.scan_id, status: scan.status, operation_id: scan.operation_id, page_count: scan.page_count, expires_at: scan.expires_at, candidate_revision: Number(scan.candidate_revision || 0), candidates: (scan.candidates || []).map(publicCandidate), pages: pages.map(publicPage), jobs: (jobs.data || []).map(publicJob) } };
}

async function getPagePreview(student, event) {
  const scan = await getOne(SESSIONS, { scan_id: compactText(event.scan_id, 100), student_uid: student.auth_uid });
  const page = scan && await getOne(PAGES, { scan_id: scan.scan_id, page_id: compactText(event.page_id, 100), student_uid: student.auth_uid });
  if (!scan || !page || !page.file_id || page.status === "deleted") throw new Error("SCAN_PAGE_NOT_FOUND");
  const result = await app.getTempFileURL({ fileList: [{ fileID: page.file_id, maxAge: 600 }] });
  const url = result && result.fileList && result.fileList[0] && result.fileList[0].tempFileURL;
  if (!url) throw new Error("SCAN_FILE_UNAVAILABLE");
  return { success: true, page_id: page.page_id, preview_url: url, expires_in_seconds: 600 };
}

async function saveCandidates(student, event) {
  if (!featureEnabled()) throw new Error("SCAN_DISABLED");
  const scan = await getOne(SESSIONS, { scan_id: compactText(event.scan_id, 100), student_uid: student.auth_uid });
  if (!scan) throw new Error("SCAN_NOT_FOUND");
  if (!["review", "partial_failure"].includes(scan.status)) throw new Error("SCAN_NOT_READY");
  const specs = Array.isArray(event.candidates) ? event.candidates : [];
  if (specs.length > MAX_CANDIDATES) throw new Error("CANDIDATE_LIMIT");
  const requestedRevision = Number(event.candidate_revision);
  if (!Number.isInteger(requestedRevision) || requestedRevision < 1) throw new Error("CANDIDATE_REVISION_REQUIRED");
  const rows = await db.collection(PAGES).where({ scan_id: scan.scan_id, student_uid: student.auth_uid }).limit(MAX_PAGES).get();
  const pages = rows.data || [];
  const candidates = specs.map((spec) => rebuildCandidate(pageById(pages, compactText(spec && spec.page_id, 100)), spec));
  const unique = Array.from(new Map(candidates.map((item) => [item.candidate_id, item])).values());
  let saved = null;
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(SESSIONS).where({ scan_id: scan.scan_id, student_uid: student.auth_uid }).limit(1).get();
    const current = result.data && result.data[0];
    if (!current) throw new Error("SCAN_NOT_FOUND");
    if (!["review", "partial_failure"].includes(current.status)) throw new Error("SCAN_NOT_READY");
    if (requestedRevision <= Number(current.candidate_revision || 0)) {
      saved = { stale: true, revision: Number(current.candidate_revision || 0), candidates: current.candidates || [] };
      return;
    }
    await transaction.collection(SESSIONS).doc(current._id).update({ candidates: unique, candidate_revision: requestedRevision, updated_at: now() });
    saved = { stale: false, revision: requestedRevision, candidates: unique };
  });
  return { success: true, stale_revision: saved.stale, candidate_revision: saved.revision, candidates: saved.candidates.map(publicCandidate) };
}

async function acknowledgeUncertainty(student, event) {
  const scan = await getOne(SESSIONS, { scan_id: compactText(event.scan_id, 100), student_uid: student.auth_uid }); const page = scan && await getOne(PAGES, { scan_id: scan.scan_id, page_id: compactText(event.page_id, 100), student_uid: student.auth_uid }); if (!scan || !page) throw new Error("SCAN_PAGE_NOT_FOUND");
  const sentenceId = compactText(event.sentence_id, 100);
  const tokenId = compactText(event.token_id, 80);
  const sentence = findSentence(page, sentenceId);
  const valid = sentence && (sentence.uncertain_tokens || []).some((token) => token.token_id === tokenId);
  if (!valid) throw new Error("UNCERTAINTY_INVALID");
  const key = `${sentenceId}:${tokenId}`;
  const acknowledgements = Array.from(new Set([...(page.uncertainty_acknowledged || []), key])).slice(0, 100);
  await db.collection(PAGES).doc(page._id).update({ uncertainty_acknowledged: acknowledgements, updated_at: now() });
  return { success: true, page_id: page.page_id, acknowledged: acknowledgements };
}

async function retryPage(student, event) {
  if (!featureEnabled()) throw new Error("SCAN_DISABLED");
  const scan = await getOne(SESSIONS, { scan_id: compactText(event.scan_id, 100), student_uid: student.auth_uid }); const page = scan && await getOne(PAGES, { scan_id: scan.scan_id, page_id: compactText(event.page_id, 100), student_uid: student.auth_uid }); if (!scan || !page) throw new Error("SCAN_PAGE_NOT_FOUND"); if (page.status !== "failed") return currentScan(student, scan);
  const at = now(); const jobId = stableId("scan_job", student.auth_uid, scan.scan_id, page.page_id); const job = { job_id: jobId, job_type: "vocabulary_page_ocr", scan_id: scan.scan_id, page_id: page.page_id, student_uid: student.auth_uid, dispatch_token: randomId("dispatch"), lease_token: null, lease_until: null, status: "queued", attempt_count: 0, manual_retry_count: 1, next_retry_at: at, error_code: null, prompt_version: PROMPT_VERSION, schema_version: SCHEMA_VERSION, created_at: at, updated_at: at };
  const prior = await getOne(JOBS, { job_id: jobId, student_uid: student.auth_uid });
  if (prior && ["queued", "processing"].includes(prior.status)) return currentScan(student, scan);
  if (prior && Number(prior.manual_retry_count || 0) >= MAX_MANUAL_RETRIES) throw new Error("PAGE_RETRY_LIMIT");
  if (prior) await db.collection(JOBS).doc(prior._id).update({ dispatch_token: job.dispatch_token, lease_token: null, lease_until: null, status: "queued", attempt_count: 0, manual_retry_count: Number(prior.manual_retry_count || 0) + 1, next_retry_at: at, error_code: null, finished_at: null, updated_at: at });
  else await db.collection(JOBS).doc(jobId).create(job);
  await db.collection(PAGES).doc(page._id).update({ status: "queued", error_code: null, updated_at: at });
  await db.collection(SESSIONS).doc(scan._id).update({ status: "queued", updated_at: at });
  try { await invokeAsync("processQueuedPageJob", job); } catch (_) {}
  return currentScan(student, scan);
}
async function removePage(student, event) {
  if (!featureEnabled()) throw new Error("SCAN_DISABLED");
  const scan = await getOne(SESSIONS, { scan_id: compactText(event.scan_id, 100), student_uid: student.auth_uid });
  const page = scan && await getOne(PAGES, { scan_id: scan.scan_id, page_id: compactText(event.page_id, 100), student_uid: student.auth_uid });
  if (!scan || !page) throw new Error("SCAN_PAGE_NOT_FOUND");
  if (!["review", "partial_failure"].includes(scan.status)) throw new Error("SCAN_NOT_READY");
  if (page.status === "deleted") return currentScan(student, scan);
  const rows = await db.collection(PAGES).where({ scan_id: scan.scan_id, student_uid: student.auth_uid }).limit(MAX_PAGES).get();
  if ((rows.data || []).filter((item) => item.status !== "deleted").length <= 1) throw new Error("CANNOT_REMOVE_LAST_PAGE");
  const at = now();
  const job = await getOne(JOBS, { scan_id: scan.scan_id, page_id: page.page_id, student_uid: student.auth_uid });
  if (job && job.status !== "superseded") {
    await db.collection(JOBS).doc(job._id).update({ status: "superseded", lease_token: null, lease_until: null, updated_at: at });
  }
  let deleteFailed = false;
  if (page.file_id) {
    try { await app.deleteFile({ fileList: [page.file_id] }); }
    catch (_error) { deleteFailed = true; }
  }
  await db.collection(PAGES).doc(page._id).update({
    status: "deleted",
    file_id: deleteFailed ? page.file_id : null,
    cloud_path: deleteFailed ? page.cloud_path : null,
    cleanup_error: deleteFailed ? "PHOTO_DELETE_RETRY_REQUIRED" : null,
    deleted_at: at,
    updated_at: at,
  });
  await db.collection(SESSIONS).doc(scan._id).update({
    page_ids: (scan.page_ids || []).filter((id) => id !== page.page_id),
    page_count: Math.max(0, Number(scan.page_count || 1) - 1),
    candidates: (scan.candidates || []).filter((candidate) => candidate.page_id !== page.page_id),
    candidate_revision: Number(scan.candidate_revision || 0) + 1,
    updated_at: at,
  });
  await refreshScanStatus(scan.scan_id, student.auth_uid);
  return currentScan(student);
}

function safeErrorCode(error) {
  const raw = String(error && error.message || "SCAN_OCR_FAILED");
  return /^[A-Z][A-Z0-9_]{1,79}$/.test(raw) ? raw : "SCAN_OCR_FAILED";
}
function modelUsageSummary(result) {
  const attempts = result && result.telemetry && Array.isArray(result.telemetry.attempts) ? result.telemetry.attempts : [];
  const sum = (field) => attempts.reduce((total, item) => total + (Number.isInteger(item && item[field]) ? item[field] : 0), 0);
  return { call_count: attempts.length, input_tokens: sum("input_tokens"), output_tokens: sum("output_tokens"), total_tokens: sum("total_tokens") };
}
function mergeModelUsage(previous, current) {
  const left = previous || {};
  const right = current || {};
  return {
    call_count: Number(left.call_count || 0) + Number(right.call_count || 0),
    input_tokens: Number(left.input_tokens || 0) + Number(right.input_tokens || 0),
    output_tokens: Number(left.output_tokens || 0) + Number(right.output_tokens || 0),
    total_tokens: Number(left.total_tokens || 0) + Number(right.total_tokens || 0),
  };
}
async function claimPageJob(event) {
  const requestedId = compactText(event.job_id, 120);
  const suppliedToken = event.dispatch_token;
  let claimed = null;
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(JOBS).where({ job_id: requestedId }).limit(1).get();
    const current = result.data && result.data[0];
    if (!current || !secretMatches(current.dispatch_token, suppliedToken)) throw new Error("SCAN_JOB_UNAUTHORIZED");
    if (["succeeded", "superseded", "failed"].includes(current.status)) { claimed = { terminal: current.status }; return; }
    const at = now();
    if (current.status === "processing" && dateMs(current.lease_until) > at.getTime()) { claimed = { terminal: "processing" }; return; }
    if (current.status === "queued" && dateMs(current.next_retry_at) > at.getTime()) { claimed = { terminal: "scheduled" }; return; }
    const attemptCount = Number(current.attempt_count || 0) + 1;
    if (attemptCount > MAX_ATTEMPTS) {
      await transaction.collection(JOBS).doc(current._id).update({ status: "failed", error_code: "SCAN_MAX_ATTEMPTS", next_retry_at: null, updated_at: at });
      claimed = { terminal: "failed" };
      return;
    }
    const leaseToken = randomId("lease");
    await transaction.collection(JOBS).doc(current._id).update({ status: "processing", lease_token: leaseToken, lease_until: new Date(at.getTime() + LEASE_MS), attempt_count: attemptCount, updated_at: at });
    claimed = { ...current, status: "processing", lease_token: leaseToken, lease_until: new Date(at.getTime() + LEASE_MS), attempt_count: attemptCount };
  });
  return claimed;
}
async function processQueuedPageJob(event) {
  const job = await claimPageJob(event);
  if (!job || job.terminal) return { success: true, status: job && job.terminal || "not_claimed" };
  const scan = await getOne(SESSIONS, { scan_id: job.scan_id, student_uid: job.student_uid });
  const page = await getOne(PAGES, { page_id: job.page_id, scan_id: job.scan_id, student_uid: job.student_uid });
  if (!scan || !page || ["discarded", "expired", "completed"].includes(scan.status) || page.status === "deleted") {
    await db.collection(JOBS).doc(job._id).update({ status: "superseded", lease_token: null, lease_until: null, updated_at: now() });
    return { success: true, status: "superseded" };
  }
  await db.collection(PAGES).doc(page._id).update({ status: "processing", updated_at: now() });
  try {
    const urls = await app.getTempFileURL({ fileList: [{ fileID: page.file_id, maxAge: 600 }] });
    const url = urls && urls.fileList && urls.fileList[0] && urls.fileList[0].tempFileURL;
    if (!url) throw new Error("SCAN_FILE_UNAVAILABLE");
    const result = await callStructuredVision(url, { onRequestStart: async () => markProviderCallStarted(scan, page) });
    const ocr = canonicalizeOcr(result.output);
    let published = false;
    await db.runTransaction(async (transaction) => {
      const jobResult = await transaction.collection(JOBS).where({ job_id: job.job_id, student_uid: job.student_uid }).limit(1).get();
      const pageResult = await transaction.collection(PAGES).where({ page_id: page.page_id, student_uid: page.student_uid }).limit(1).get();
      const scanResult = await transaction.collection(SESSIONS).where({ scan_id: scan.scan_id, student_uid: scan.student_uid }).limit(1).get();
      const currentJob = jobResult.data && jobResult.data[0];
      const currentPage = pageResult.data && pageResult.data[0];
      const currentScan = scanResult.data && scanResult.data[0];
      if (!currentJob || currentJob.status !== "processing" || !secretMatches(currentJob.lease_token, job.lease_token) || !currentPage || !currentScan || ["discarded", "expired", "completed"].includes(currentScan.status)) return;
      const at = now();
      await transaction.collection(PAGES).doc(currentPage._id).update({ status: "succeeded", ocr, error_code: null, processed_at: at, updated_at: at });
      await transaction.collection(JOBS).doc(currentJob._id).update({ status: "succeeded", lease_token: null, lease_until: null, next_retry_at: null, error_code: null, model_metadata: result.metadata, model_usage: mergeModelUsage(currentJob.model_usage, modelUsageSummary(result)), finished_at: at, updated_at: at });
      published = true;
    });
    if (!published) return { success: true, status: "lease_lost" };
    await refreshScanStatus(scan.scan_id, scan.student_uid);
    return { success: true, status: "succeeded" };
  } catch (error) {
    const code = safeErrorCode(error);
    const rawMessage = String(error && error.message || "");
    const retryable = error && error.retryable === true || error && error.name === "AbortError" || /TIMEOUT|UNAVAILABLE|NETWORK|fetch failed|HTTP_(?:429|5\d\d)/i.test(rawMessage);
    const terminal = !retryable || Number(job.attempt_count || 0) >= MAX_ATTEMPTS;
    const retryAt = new Date(Date.now() + (RETRY_DELAYS[Math.min(Number(job.attempt_count || 1) - 1, RETRY_DELAYS.length - 1)] || RETRY_DELAYS[RETRY_DELAYS.length - 1]));
    let published = false;
    await db.runTransaction(async (transaction) => {
      const jobResult = await transaction.collection(JOBS).where({ job_id: job.job_id, student_uid: job.student_uid }).limit(1).get();
      const pageResult = await transaction.collection(PAGES).where({ page_id: page.page_id, student_uid: page.student_uid }).limit(1).get();
      const currentJob = jobResult.data && jobResult.data[0];
      const currentPage = pageResult.data && pageResult.data[0];
      if (!currentJob || !currentPage || currentJob.status !== "processing" || !secretMatches(currentJob.lease_token, job.lease_token)) return;
      const at = now();
      await transaction.collection(JOBS).doc(currentJob._id).update({ status: terminal ? "failed" : "queued", error_code: terminal ? code : null, lease_token: null, lease_until: null, next_retry_at: terminal ? null : retryAt, model_usage: mergeModelUsage(currentJob.model_usage, modelUsageSummary({ telemetry: error && error.providerTelemetry })), updated_at: at });
      await transaction.collection(PAGES).doc(currentPage._id).update({ status: terminal ? "failed" : "queued", error_code: terminal ? code : null, updated_at: at });
      published = true;
    });
    if (published) await refreshScanStatus(scan.scan_id, scan.student_uid);
    return { success: false, status: terminal ? "failed" : "queued", code: terminal ? code : "RETRY_SCHEDULED" };
  }
}

async function commitOneCandidate(student, scanId, candidateId, commitOperationId) {
  let outcome = null;
  await db.runTransaction(async (transaction) => {
    const scanResult = await transaction.collection(SESSIONS).where({ scan_id: scanId, student_uid: student.auth_uid }).limit(1).get();
    const current = scanResult.data && scanResult.data[0];
    if (!current) throw new Error("SCAN_NOT_FOUND");
    const prior = (current.committed_candidates || []).find((item) => item.candidate_id === candidateId);
    if (prior) { outcome = { candidate_id: candidateId, success: true, vocab_id: prior.vocab_id, idempotent_replay: true }; return; }
    const candidate = (current.candidates || []).find((item) => item.candidate_id === candidateId);
    if (!candidate) throw new Error("CANDIDATE_INVALID");
    const result = await upsertPersonalVocabularyItem({ db: transaction, student, event: { text: candidate.text, source_set_id: null, source_title: candidate.source_title, source_path: candidate.source_path, context: candidate.context, context_token_ranges: candidate.context_token_ranges } });
    const saved = { candidate_id: candidateId, vocab_id: result.record.vocab_id, commit_operation_id: commitOperationId, saved_at: now() };
    const committed = [...(current.committed_candidates || []).filter((item) => item.candidate_id !== candidateId), saved].slice(-MAX_CANDIDATES);
    const remaining = (current.candidates || []).filter((item) => item.candidate_id !== candidateId);
    await transaction.collection(SESSIONS).doc(current._id).update({ candidates: remaining, committed_candidates: committed, commit_operation_id: commitOperationId, status: "committing", updated_at: now() });
    outcome = { candidate_id: candidateId, success: true, vocab_id: result.record.vocab_id };
  });
  return outcome;
}
async function markCandidateFailed(student, scanId, candidateId, code) {
  const scan = await getOne(SESSIONS, { scan_id: scanId, student_uid: student.auth_uid });
  if (!scan) return;
  const candidates = (scan.candidates || []).map((item) => item.candidate_id === candidateId ? { ...item, status: "failed", error_code: code } : item);
  await db.collection(SESSIONS).doc(scan._id).update({ candidates, updated_at: now() });
}
async function claimCommit(student, scanId, commitOperationId) {
  let claimed = null;
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(SESSIONS).where({ scan_id: scanId, student_uid: student.auth_uid }).limit(1).get();
    const current = result.data && result.data[0];
    if (!current) throw new Error("SCAN_NOT_FOUND");
    if (current.status === "completed" && current.commit_operation_id === commitOperationId) {
      claimed = { ...current, idempotent_replay: true };
      return;
    }
    if (current.status === "committing" && current.commit_operation_id && current.commit_operation_id !== commitOperationId) throw new Error("COMMIT_IN_PROGRESS");
    if (!["review", "partial_failure", "committing"].includes(current.status)) throw new Error("SCAN_NOT_READY");
    if (!(current.candidates || []).some((item) => item && ["pending", "failed"].includes(item.status))) throw new Error("CANDIDATE_REQUIRED");
    const at = now();
    await transaction.collection(SESSIONS).doc(current._id).update({ status: "committing", commit_operation_id: commitOperationId, updated_at: at });
    claimed = { ...current, status: "committing", commit_operation_id: commitOperationId, updated_at: at };
  });
  return claimed;
}
async function commitCandidates(student, event) {
  if (!featureEnabled()) throw new Error("SCAN_DISABLED");
  const op = operation(event.commit_operation_id);
  if (!op) throw new Error("COMMIT_OPERATION_REQUIRED");
  const scan = await claimCommit(student, compactText(event.scan_id, 100), op);
  if (scan.idempotent_replay) return { success: true, idempotent_replay: true, partial_failure: false, summary: scan.commit_summary || [], vocab_ids: (scan.commit_summary || []).filter((item) => item.success).map((item) => item.vocab_id) };
  const candidates = (scan.candidates || []).filter((item) => item && ["pending", "failed"].includes(item.status));
  if (!candidates.length) throw new Error("CANDIDATE_REQUIRED");
  const summary = [];
  for (const candidate of candidates) {
    try { summary.push(await commitOneCandidate(student, scan.scan_id, candidate.candidate_id, op)); }
    catch (error) {
      const code = safeErrorCode(error || new Error("VOCAB_SAVE_FAILED"));
      await markCandidateFailed(student, scan.scan_id, candidate.candidate_id, code);
      summary.push({ candidate_id: candidate.candidate_id, success: false, code });
    }
  }
  const latest = await getOne(SESSIONS, { scan_id: scan.scan_id, student_uid: student.auth_uid });
  const remaining = (latest.candidates || []).filter((item) => item && ["pending", "failed"].includes(item.status));
  const committedForOperation = (latest.committed_candidates || []).filter((item) => item.commit_operation_id === op).map((item) => ({ candidate_id: item.candidate_id, success: true, vocab_id: item.vocab_id }));
  const mergedSummary = Array.from(new Map([...committedForOperation, ...summary].map((item) => [item.candidate_id, item])).values());
  const at = now();
  await db.collection(SESSIONS).doc(latest._id).update({ commit_summary: mergedSummary, status: remaining.length ? "review" : "completed", cleanup_status: remaining.length ? latest.cleanup_status || "not_needed" : "pending", completed_at: remaining.length ? null : at, updated_at: at });
  if (!remaining.length) {
    await clearActiveScanPointer(student.auth_uid, scan.scan_id);
    await cleanupScanFiles({ ...latest, cleanup_status: "pending" }, student.auth_uid);
  }
  return { success: true, partial_failure: remaining.length > 0, summary: mergedSummary, candidates: remaining.map(publicCandidate), vocab_ids: mergedSummary.filter((item) => item.success).map((item) => item.vocab_id) };
}

async function cleanupScanFiles(scan, studentUid) {
  const rows = await db.collection(PAGES).where({ scan_id: scan.scan_id, student_uid: studentUid }).limit(MAX_PAGES).get();
  const fileList = (rows.data || []).map((row) => row.file_id).filter(Boolean);
  if (fileList.length) {
    try { await app.deleteFile({ fileList }); }
    catch (_error) {
      await db.collection(SESSIONS).doc(scan._id).update({ cleanup_status: "error", cleanup_error: "PHOTO_DELETE_RETRY_REQUIRED", updated_at: now() });
      for (const row of rows.data || []) if (row.file_id) await db.collection(PAGES).doc(row._id).update({ cleanup_error: "PHOTO_DELETE_RETRY_REQUIRED", updated_at: now() });
      return false;
    }
  }
  const at = now();
  for (const row of rows.data || []) await db.collection(PAGES).doc(row._id).update({ status: "deleted", file_id: null, cloud_path: null, cleanup_error: null, deleted_at: at, updated_at: at });
  await db.collection(SESSIONS).doc(scan._id).update({ cleanup_status: "complete", cleanup_error: null, cleaned_at: at, updated_at: at });
  return true;
}
async function discardScan(student, event) {
  const scan = await getOne(SESSIONS, { scan_id: compactText(event.scan_id, 100), student_uid: student.auth_uid });
  if (!scan) return { success: true, idempotent_replay: true };
  if (["discarded", "expired"].includes(scan.status)) return { success: true, idempotent_replay: true };
  const at = now();
  const jobs = await db.collection(JOBS).where({ scan_id: scan.scan_id, student_uid: student.auth_uid }).limit(MAX_PAGES).get();
  for (const job of jobs.data || []) if (!["succeeded", "superseded"].includes(job.status)) await db.collection(JOBS).doc(job._id).update({ status: "superseded", lease_token: null, lease_until: null, updated_at: at });
  await db.collection(SESSIONS).doc(scan._id).update({ status: "discarded", candidates: [], cleanup_status: "pending", discarded_at: at, updated_at: at });
  await clearActiveScanPointer(student.auth_uid, scan.scan_id);
  await refundUnusedQuota({ ...scan, status: "discarded" });
  await cleanupScanFiles({ ...scan, cleanup_status: "pending" }, student.auth_uid);
  return { success: true };
}

const messages = { AUTH_REQUIRED: "Please log in first.", STUDENT_REQUIRED: "Only active students can scan words.", SCAN_DISABLED: "Scan Words is not available yet.", SCAN_ALREADY_ACTIVE: "Continue or discard your current scan first.", SCAN_NOT_READY: "This scan is not ready for that action.", PAGE_COUNT_INVALID: "Choose between one and five pages.", PHOTO_FILE_INVALID: "Choose a supported image no larger than 10 MB.", PHOTO_UPLOAD_INCOMPLETE: "Finish uploading each page, then try again.", PHOTO_UPLOAD_INVALID: "One uploaded page could not be verified.", OCR_EMPTY: "No readable English was found on this page.", OCR_TOO_LARGE: "This page contains too much text. Crop it into a smaller page and retry.", PAGE_RETRY_LIMIT: "This page has reached its retry limit. Remove it and scan a clearer photo.", CANDIDATE_REQUIRED: "Select at least one word or phrase.", CANDIDATE_INVALID: "Select words from one OCR sentence.", CANDIDATE_TOKEN_INVALID: "That selection is no longer available. Refresh the scan.", CANDIDATE_TOO_LONG: "Keep a phrase within 120 characters.", CANDIDATE_CONTEXT_TOO_LONG: "Those words are too far apart for one saved Context.", CANDIDATE_LIMIT: "Add the current 100 items before selecting more.", CANDIDATE_REVISION_REQUIRED: "Refresh the scan and try that selection again.", COMMIT_OPERATION_REQUIRED: "Please try adding the selected words again.", COMMIT_IN_PROGRESS: "Your previous add request is still finishing.", SCAN_NOT_FOUND: "This scan is no longer available.", SCAN_PAGE_NOT_FOUND: "This scan page is no longer available.", SCAN_FILE_UNAVAILABLE: "This processed page is no longer available.", CANNOT_REMOVE_LAST_PAGE: "Discard the scan to remove its final page.", SCAN_DAILY_LIMIT: "You have reached today's scan limit.", SCAN_PAGE_DAILY_LIMIT: "You have reached today's page limit." };
exports.main = async (event = {}) => { try { if (event.action === "processQueuedPageJob") return await processQueuedPageJob(event); const student = await activeStudent(); const action = compactText(event.action || "getCapability", 60); if (action === "getCapability") return getCapability(student); if (action === "getCurrentScan") return currentScan(student); if (action === "getPagePreview") return getPagePreview(student, event); if (action === "startUpload") return startUpload(student, event); if (action === "finishUpload") return finishUpload(student, event); if (action === "retryPage") return retryPage(student, event); if (action === "removePage") return removePage(student, event); if (action === "saveCandidates") return saveCandidates(student, event); if (action === "commitCandidates") return commitCandidates(student, event); if (action === "discardScan") return discardScan(student, event); if (action === "acknowledgeUncertainty") return acknowledgeUncertainty(student, event); throw new Error("UNKNOWN_ACTION"); } catch (error) { const code = String(error && error.message || "SCAN_ERROR"); return { success: false, code, message: messages[code] || "Scan Words could not complete that action." }; } };
exports._test = { dayKey, tokenizeSentence, canonicalizeOcr, rebuildCandidate, candidateContext, publicPage, publicCandidate, secretMatches, stableId, sameManifest, modelUsageSummary, mergeModelUsage };
