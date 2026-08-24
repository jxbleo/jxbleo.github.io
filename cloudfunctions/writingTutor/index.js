"use strict";

const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");
const tcbApiCaller = require("@cloudbase/node-sdk/dist/utils/tcbapirequester");
const { CloudBase } = require("@cloudbase/node-sdk/dist/cloudbase");
const { RUBRIC_VERSION, getRubric, publicRubrics } = require("./rubrics");
const {
  SCHEMA_VERSION, OCR_SCHEMA, OCR_LOCATION_SCHEMA, REVISION_SCAN_SCHEMA, STANDARDIZED_SCHEMA, LANGUAGE_SCHEMA, REWRITE_SCHEMA,
} = require("./schemas");
const {
  PROMPT_VERSION, ocrPrompt, ocrLocationPrompt, revisionScanPrompt, standardizedPrompt, languagePrompt, rewritePrompt,
} = require("./prompts");
const { callStructuredModel } = require("./model-provider");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const COMPOSITIONS = "writing_compositions";
const UPLOADS = "writing_photo_uploads";
const OBSERVATIONS = "writing_observations";
const USAGE = "writing_ai_usage_events";
const EMAIL_EVENTS = "writing_teacher_email_events";
const JOBS = "writing_ai_jobs";
const DEFAULT_DAILY_WORD_LIMIT = 5000;
const MAX_COMPOSITION_CHARS = 30000;
const MAX_PROMPT_CHARS = 10000;
const MAX_TITLE_CHARS = 80;
const MAX_UPLOAD_PAGES = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const INCOMPLETE_UPLOAD_TTL_MS = 30 * 60 * 1000;
const CONFIRMED_UPLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY_DRAFT_RETENTION_MS = 30 * 60 * 1000;
const JOB_LEASE_MS = 6 * 60 * 1000;
const OCR_LOCATION_MIN_LEASE_REMAINING_MS = 100 * 1000;
const MAX_JOB_ATTEMPTS = 3;
const PROMPT_BUNDLE_VERSION = `${PROMPT_VERSION}|${SCHEMA_VERSION}|${RUBRIC_VERSION}`;

function text(value, limit = 30000) {
  return String(value == null ? "" : value).trim().slice(0, limit);
}

function normalizedTitle(value) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, MAX_TITLE_CHARS).trim();
}

function normalizedSuggestedTitle(value) {
  const words = String(value == null ? "" : value)
    .match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g);
  if (!words || !words.length) return "Student Writing";
  const selected = words.slice(0, 6).map((word) => word.slice(0, 36));
  if (selected.length === 1) {
    if (selected[0].toLowerCase() === "essay") selected.unshift("Student");
    else selected.push("Essay");
  }
  const fitted = [];
  for (const word of selected) {
    if ([...fitted, word].join(" ").length > MAX_TITLE_CHARS) break;
    fitted.push(word);
  }
  return fitted.length >= 2 ? fitted.join(" ") : "Student Writing";
}

function isLegacyUntitled(value) {
  return normalizedTitle(value).toLowerCase() === "untitled writing";
}

function titleSource(composition) {
  if (composition && composition.title_source) return composition.title_source;
  const legacyTitle = normalizedTitle(composition && composition.title);
  return legacyTitle && !isLegacyUntitled(legacyTitle) ? "student" : "pending_ai";
}

function visibleTitle(composition) {
  const title = normalizedTitle(composition && composition.title);
  return titleSource(composition) === "pending_ai" && isLegacyUntitled(title) ? "" : title;
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function stableId(prefix, ...parts) {
  const digest = crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 40);
  return `${prefix}_${digest}`;
}

function revisionJobId(studentUid, compositionId, operationId) {
  return stableId("writing_revision_job", studentUid, compositionId, operationId);
}

function revisionPhotoId(studentUid, compositionId, operationId, index) {
  return stableId("writing_revision_photo", studentUid, compositionId, operationId, String(index));
}

function secretMatches(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function invokeFunctionAsync(functionName, data) {
  const { TCB_ROUTE_KEY } = CloudBase.getCloudbaseContext();
  const result = await tcbApiCaller.request({
    config: app.config,
    params: {
      action: "functions.invokeFunction",
      function_name: functionName,
      async: true,
      request_data: JSON.stringify(data || {}),
    },
    method: "post",
    headers: {
      "content-type": "application/json",
      ...(TCB_ROUTE_KEY ? { "X-TCB-Route-Key": TCB_ROUTE_KEY } : {}),
    },
  });
  if (result && result.code) throw new Error("AI_JOB_DISPATCH_FAILED");
  return result;
}

function dateMs(value) {
  const result = value ? new Date(value).getTime() : 0;
  return Number.isFinite(result) ? result : 0;
}

function shanghaiDayKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

function wordCount(value) {
  const normalized = text(value).normalize("NFKC");
  if (!normalized) return 0;
  const words = normalized.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:[.,]\d+)*|[\p{Script=Han}]/gu);
  return words ? words.length : 0;
}

function dailyLimit(student) {
  const configured = Number(student && student.writing_ai_daily_word_limit);
  if (Number.isInteger(configured) && configured >= 0 && configured <= 100000) return configured;
  const fallback = Number(process.env.WRITING_AI_DEFAULT_DAILY_WORD_LIMIT || DEFAULT_DAILY_WORD_LIMIT);
  return Number.isInteger(fallback) && fallback >= 0 ? fallback : DEFAULT_DAILY_WORD_LIMIT;
}

async function authenticatedStudent() {
  const userInfo = await app.auth().getUserInfo();
  const uid = userInfo && (userInfo.uid || userInfo.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");
  const authUid = String(uid);
  const result = await db.collection("students").where({ auth_uid: authUid, active: true }).limit(1).get();
  const student = result.data && result.data[0];
  if (!student || String(student.auth_uid || "") !== authUid) throw new Error("STUDENT_NOT_LINKED");
  if ((student.role || "student") !== "student") throw new Error("STUDENT_REQUIRED");
  return student;
}

async function getOne(collection, query) {
  const result = await db.collection(collection).where(query).limit(1).get();
  return result.data && result.data[0];
}

async function ownedComposition(student, compositionId) {
  const composition = await getOne(COMPOSITIONS, {
    composition_id: text(compositionId, 96), student_uid: student.auth_uid,
  });
  if (!composition) throw new Error("COMPOSITION_NOT_FOUND");
  return composition;
}

function summaryView(composition) {
  return {
    composition_id: composition.composition_id,
    title: visibleTitle(composition),
    title_source: titleSource(composition),
    title_updated_at: composition.title_updated_at || null,
    prompt_text: composition.prompt_text || "",
    assessment_mode: composition.assessment_mode || null,
    rubric_id: composition.rubric_id || null,
    standardized_rubric_id: composition.standardized_rubric_id || null,
    status: composition.status || "draft",
    revision: Number(composition.revision || 1),
    word_count: Number(composition.word_count || 0),
    overall_score: composition.standardized_review && composition.standardized_review.overall_score || null,
    has_standardized_review: Boolean(composition.standardized_review),
    has_language_review: Boolean(composition.language_review),
    created_at: composition.created_at || null,
    updated_at: composition.updated_at || null,
    completed_at: composition.completed_at || null,
  };
}

function isDiscardableEmptyComposition(composition) {
  if (!composition || (composition.status || "draft") !== "draft") return false;
  if (Number(composition.revision || 1) !== 1 || Number(composition.word_count || 0) > 0) return false;
  if (visibleTitle(composition) || text(composition.prompt_text) || text(composition.confirmed_text)) return false;
  if (text(composition.library_prompt_id, 120)) return false;
  return !composition.pending_upload
    && !composition.pending_ocr
    && !composition.pending_revision_scan
    && !composition.scanned_rewrite_drafts
    && !composition.pending_replacement
    && !composition.pending_rewrite_check
    && !composition.active_job_id
    && !composition.active_job
    && !composition.ocr_job
    && !composition.standardized_review
    && !composition.language_review
    && !composition.rewrite_results
    && !composition.completed_at;
}

function isDiscardableDraftComposition(composition) {
  if (!composition || (composition.status || "draft") !== "draft") return false;
  if (Number(composition.revision || 1) !== 1 || text(composition.library_prompt_id, 120)) return false;
  return !composition.pending_upload
    && !composition.pending_ocr
    && !composition.pending_revision_scan
    && !composition.scanned_rewrite_drafts
    && !composition.pending_replacement
    && !composition.pending_rewrite_check
    && !composition.active_job_id
    && !composition.active_job
    && !composition.ocr_job
    && !composition.standardized_review
    && !composition.language_review
    && !composition.rewrite_results
    && !composition.completed_at;
}

async function discardEmptyComposition(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  if (!isDiscardableEmptyComposition(composition)) {
    return { success: true, discarded: false, composition: summaryView(composition) };
  }
  await db.collection(COMPOSITIONS).doc(composition._id).remove();
  return { success: true, discarded: true, composition_id: composition.composition_id };
}

async function discardDraftComposition(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  if (!isDiscardableDraftComposition(composition)) {
    return { success: true, discarded: false, composition: summaryView(composition) };
  }
  await db.collection(COMPOSITIONS).doc(composition._id).remove();
  return { success: true, discarded: true, composition_id: composition.composition_id };
}

function publicJobView(job) {
  if (!job || typeof job !== "object") return null;
  return {
    job_id: job.job_id || null,
    operation_id: job.operation_id || null,
    job_type: job.job_type || null,
    ocr_purpose: job.job_type === "ocr" ? ocrPurpose(job.ocr_purpose) : null,
    review_mode: job.review_mode || null,
    status: job.status || null,
    error_code: job.error_code || null,
    attempt_count: Number(job.attempt_count || 0),
    created_at: job.created_at || null,
    started_at: job.started_at || null,
    finished_at: job.finished_at || null,
  };
}

function ocrPurpose(value) {
  return text(value, 40).toLowerCase() === "prompt" ? "prompt" : "writing";
}

function publicRevisionCandidates(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    candidate_id: text(item && item.candidate_id, 120),
    sentence_id: item && item.sentence_id ? text(item.sentence_id, 40) : null,
    written_number: Number.isInteger(item && item.written_number) ? item.written_number : null,
    recognized_text: text(item && item.recognized_text, 3000),
    confidence: ["high", "medium", "low"].includes(item && item.confidence) ? item.confidence : "low",
    warnings: Array.isArray(item && item.warnings)
      ? item.warnings.map((warning) => text(warning, 300)).filter(Boolean).slice(0, 12)
      : [],
    status: ["mapped", "check", "unresolved"].includes(item && item.status) ? item.status : "unresolved",
  })).filter((item) => item.candidate_id);
}

function compositionView(composition) {
  const activeJob = publicJobView(composition.active_job || composition.ocr_job);
  const pendingRewriteItems = composition.pending_rewrite_check
    && Array.isArray(composition.pending_rewrite_check.items)
    ? composition.pending_rewrite_check.items.map((item) => ({
      sentence_id: text(item && item.sentence_id, 40),
      text: text(item && item.text, 3000),
    })).filter((item) => item.sentence_id && item.text)
    : [];
  const pendingUpload = composition.pending_upload && typeof composition.pending_upload === "object"
    ? {
      kind: composition.pending_upload.kind === "revision_scan" ? "revision_scan" : "composition_ocr",
      status: composition.pending_upload.status || "uploading",
      created_at: composition.pending_upload.created_at || null,
      page_count: Array.isArray(composition.pending_upload.photo_ids)
        ? composition.pending_upload.photo_ids.length : 0,
      ocr_purpose: composition.pending_upload.kind === "revision_scan"
        ? null : ocrPurpose(composition.pending_upload.ocr_purpose),
    }
    : null;
  const pendingRevisionScan = composition.pending_revision_scan && typeof composition.pending_revision_scan === "object"
    ? {
      operation_id: text(composition.pending_revision_scan.operation_id, 160) || null,
      composition_revision: Number(composition.pending_revision_scan.composition_revision || 1),
      items: publicRevisionCandidates(composition.pending_revision_scan.items),
      unresolved_items: publicRevisionCandidates(composition.pending_revision_scan.unresolved_items),
      missing_sentence_ids: Array.isArray(composition.pending_revision_scan.missing_sentence_ids)
        ? composition.pending_revision_scan.missing_sentence_ids.map((id) => text(id, 40)).filter(Boolean)
        : [],
    }
    : null;
  const scannedRewriteDrafts = Array.isArray(composition.scanned_rewrite_drafts)
    ? composition.scanned_rewrite_drafts.map((item) => ({
      sentence_id: text(item && item.sentence_id, 40),
      text: text(item && item.text, 3000),
      operation_id: text(item && item.operation_id, 160),
      imported_at: item && item.imported_at || null,
    })).filter((item) => item.sentence_id && item.text)
    : [];
  return {
    ...summaryView(composition),
    confirmed_text: composition.confirmed_text || "",
    pending_ocr: composition.pending_ocr || null,
    pending_revision_scan: pendingRevisionScan,
    scanned_rewrite_drafts: scannedRewriteDrafts,
    standardized_review: composition.standardized_review || null,
    language_review: composition.language_review || null,
    rewrite_results: composition.rewrite_results || null,
    rewrite_check_pending: Boolean(composition.pending_rewrite_check),
    pending_rewrite_items: pendingRewriteItems,
    replacement_pending: Boolean(composition.pending_replacement),
    pending_upload: pendingUpload,
    active_job: activeJob,
    ocr_job: activeJob && activeJob.job_type === "ocr" ? activeJob : null,
    revision_scan_job: activeJob && activeJob.job_type === "revision_ocr" ? activeJob : null,
    prompt_version: composition.prompt_version || null,
    schema_version: composition.schema_version || null,
    rubric_version: composition.rubric_version || null,
  };
}

function uploadMetadataView(metadata, cloudPath) {
  const data = metadata && metadata.data || {};
  return {
    url: data.url, token: data.token, authorization: data.authorization,
    file_id: data.fileId, cos_file_id: data.cosFileId, cloud_path: cloudPath,
  };
}

function imageExtension(mimeType) {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mimeType] || "";
}

function sentenceUnits(manuscript) {
  const source = String(manuscript || "");
  let parts = [];
  try {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    parts = Array.from(segmenter.segment(source), (item) => item.segment).filter((item) => item.trim());
  } catch (_error) {
    parts = source.match(/[^.!?\n]+(?:[.!?]+[\"')\]]*|$)/g) || [];
  }
  return parts.map((original, index) => ({
    sentence_id: `s${String(index + 1).padStart(3, "0")}`,
    original,
  }));
}

async function createComposition(student, event) {
  const now = new Date();
  const requestedTitle = normalizedTitle(event.title);
  const title = isLegacyUntitled(requestedTitle) ? "" : requestedTitle;
  const assessmentMode = text(event.assessment_mode, 80) || "general_language";
  if (!["general_language", "standardized_content"].includes(assessmentMode)) throw new Error("ASSESSMENT_MODE_INVALID");
  const composition = {
    composition_id: randomId("composition"),
    student_uid: student.auth_uid,
    title,
    title_source: title ? "student" : "pending_ai",
    prompt_text: text(event.prompt_text, MAX_PROMPT_CHARS),
    confirmed_text: text(event.confirmed_text, MAX_COMPOSITION_CHARS),
    assessment_mode: assessmentMode,
    rubric_id: null,
    status: "draft",
    revision: 1,
    word_count: wordCount(event.confirmed_text),
    source: event.source === "library" ? "library" : "student",
    library_prompt_id: text(event.library_prompt_id, 120) || null,
    created_at: now,
    updated_at: now,
  };
  await db.collection(COMPOSITIONS).add(composition);
  return { success: true, composition: compositionView(composition), rubrics: publicRubrics() };
}

async function listCompositions(student) {
  const result = await db.collection(COMPOSITIONS).where({ student_uid: student.auth_uid }).limit(200).get();
  const rows = (result.data || []).sort((a, b) => dateMs(b.updated_at) - dateMs(a.updated_at));
  const now = Date.now();
  const visibleRows = [];
  const staleEmptyRows = [];
  rows.forEach((row) => {
    if (!isDiscardableEmptyComposition(row)) {
      visibleRows.push(row);
      return;
    }
    const createdAt = dateMs(row.created_at);
    if (!createdAt || now - createdAt >= EMPTY_DRAFT_RETENTION_MS) staleEmptyRows.push(row);
  });
  await Promise.all(staleEmptyRows.filter((row) => row._id).map((row) => (
    db.collection(COMPOSITIONS).doc(row._id).remove()
  )));
  return { success: true, compositions: visibleRows.map(summaryView), rubrics: publicRubrics() };
}

async function ocrPhotoUrls(student, composition) {
  let photoIds = composition.pending_ocr && Array.isArray(composition.pending_ocr.photo_ids)
    ? composition.pending_ocr.photo_ids.slice(0, MAX_UPLOAD_PAGES)
    : [];
  if (!photoIds.length && composition.active_job_id) {
    const job = await getOne(JOBS, {
      job_id: composition.active_job_id,
      student_uid: student.auth_uid,
      composition_id: composition.composition_id,
    });
    if (job && job.job_type === "ocr" && Array.isArray(job.photo_ids)) {
      photoIds = job.photo_ids.slice(0, MAX_UPLOAD_PAGES);
    }
  }
  if (!photoIds.length) return [];
  const rows = await photoRows(student, composition.composition_id, photoIds);
  const available = rows.filter((row) => row.status === "uploaded" && row.file_id);
  if (!available.length) return [];
  const result = await app.getTempFileURL({
    fileList: available.map((row) => ({ fileID: row.file_id, maxAge: 900 })),
  });
  const byId = new Map((result.fileList || []).map((item) => [item.fileID, item.tempFileURL]));
  return available.map((row) => byId.get(row.file_id)).filter(Boolean);
}

async function getComposition(student, event) {
  let composition = await ownedComposition(student, event.composition_id);
  const legacyOcrJob = composition.ocr_job && typeof composition.ocr_job === "object"
    ? composition.ocr_job : null;
  if (!composition.active_job_id && legacyOcrJob && !legacyOcrJob.job_id
    && ["queued", "processing"].includes(legacyOcrJob.status)) {
    const now = new Date();
    await db.collection(COMPOSITIONS).doc(composition._id).update({
      status: "ocr_failed",
      ocr_job: {
        ...legacyOcrJob, status: "failed",
        error_code: "LEGACY_OCR_JOB_NOT_RESUMABLE", finished_at: now,
      },
      updated_at: now,
    });
    composition = await ownedComposition(student, event.composition_id);
  }
  if (composition.pending_upload && !composition.pending_ocr) {
    try {
      const finishUpload = composition.pending_upload.kind === "revision_scan"
        ? finishRevisionScanUpload : finishPhotoUpload;
      await finishUpload(student, {
        composition_id: composition.composition_id,
        operation_id: composition.pending_upload.operation_id,
        photo_ids: composition.pending_upload.photo_ids,
        replace_current: composition.pending_upload.replace_current === true,
        ocr_purpose: composition.pending_upload.ocr_purpose,
      });
      composition = await ownedComposition(student, event.composition_id);
    } catch (error) {
      // The storage upload may still be in flight. Retain the batch so a later
      // authenticated poll can complete the handoff without another upload.
      console.error("writingTutor pending upload recovery deferred", error && error.message);
    }
  }
  let photoUrls = [];
  try { photoUrls = await ocrPhotoUrls(student, composition); } catch (error) {
    console.error("writingTutor photo preview failed", error && error.message);
  }
  return {
    success: true,
    composition: compositionView(composition),
    ocr_photo_urls: photoUrls,
    rubrics: publicRubrics(),
  };
}

async function startPhotoUpload(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  if (composition.status === "completed") throw new Error("COMPOSITION_READ_ONLY");
  const operationId = text(event.operation_id, 160);
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  const pages = Array.isArray(event.pages) ? event.pages : [];
  const purpose = ocrPurpose(event.ocr_purpose);
  if (!pages.length || pages.length > MAX_UPLOAD_PAGES) throw new Error("PHOTO_PAGE_COUNT_INVALID");
  const existingJob = await getOne(JOBS, {
    job_id: stableId("writing_job", student.auth_uid, operationId),
    student_uid: student.auth_uid,
  });
  if (existingJob) {
    if (existingJob.composition_id !== composition.composition_id || existingJob.job_type !== "ocr"
      || ocrPurpose(existingJob.ocr_purpose) !== purpose) {
      throw new Error("IDEMPOTENCY_KEY_REUSED");
    }
    const existingPhotoIds = Array.isArray(existingJob.photo_ids) ? existingJob.photo_ids : [];
    const existingRows = existingPhotoIds.length
      ? await photoRows(student, composition.composition_id, existingPhotoIds) : [];
    if (existingRows.length !== pages.length || existingRows.some((row, index) =>
      Number(row.page_index) !== index
      || row.mime_type !== text(pages[index].mime_type, 80).toLowerCase()
      || Number(row.expected_size_bytes) !== Number(pages[index].size_bytes || 0))) {
      throw new Error("IDEMPOTENCY_KEY_REUSED");
    }
    return {
      success: true, uploads: [], idempotent_replay: true,
      job: publicJobView(existingJob), composition: compositionView(composition),
      ...(existingJob.status === "succeeded" && composition.pending_ocr
        ? { ocr: composition.pending_ocr } : {}),
    };
  }
  const now = new Date();
  const uploads = [];
  for (let index = 0; index < pages.length; index += 1) {
    const mimeType = text(pages[index].mime_type, 80).toLowerCase();
    const extension = imageExtension(mimeType);
    const sizeBytes = Number(pages[index].size_bytes || 0);
    if (!extension || !Number.isFinite(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_IMAGE_BYTES) {
      throw new Error("PHOTO_FILE_INVALID");
    }
    const photoId = stableId("writing_photo", student.auth_uid, composition.composition_id, operationId, String(index));
    const cloudPath = `writing-tutor/${student.auth_uid}/${composition.composition_id}/${photoId}.${extension}`;
    const metadata = await app.getUploadMetadata({ cloudPath });
    const view = uploadMetadataView(metadata, cloudPath);
    const record = {
      photo_id: photoId, composition_id: composition.composition_id, student_uid: student.auth_uid,
      status: "uploading", page_index: index, file_id: view.file_id, cloud_path: cloudPath,
      original_name: text(pages[index].file_name, 160), mime_type: mimeType,
      expected_size_bytes: sizeBytes, replace_current: event.replace_current === true,
      ocr_purpose: purpose,
      operation_id: operationId,
      expires_at: new Date(now.getTime() + INCOMPLETE_UPLOAD_TTL_MS), created_at: now, updated_at: now,
    };
    let existing = await getOne(UPLOADS, { photo_id: photoId, student_uid: student.auth_uid });
    if (!existing) {
      try {
        await db.collection(UPLOADS).doc(photoId).create(record);
        existing = record;
      } catch (_error) {
        existing = await getOne(UPLOADS, { photo_id: photoId, student_uid: student.auth_uid });
      }
    }
    if (!existing
      || existing.composition_id !== composition.composition_id
      || existing.operation_id !== operationId
      || ocrPurpose(existing.ocr_purpose) !== purpose
      || Number(existing.page_index) !== index
      || existing.mime_type !== mimeType
      || Number(existing.expected_size_bytes) !== sizeBytes) {
      throw new Error("IDEMPOTENCY_KEY_REUSED");
    }
    if (existing.status !== "uploaded") {
      await db.collection(UPLOADS).doc(existing._id || photoId).update({
        status: "uploading", file_id: view.file_id, cloud_path: cloudPath,
        expires_at: new Date(now.getTime() + INCOMPLETE_UPLOAD_TTL_MS), updated_at: now,
      });
    }
    uploads.push({ photo_id: photoId, ...view });
  }
  await db.collection(COMPOSITIONS).doc(composition._id).update(replaceWholeFields({
    pending_upload: {
      operation_id: operationId,
      photo_ids: uploads.map((upload) => upload.photo_id),
      replace_current: event.replace_current === true,
      ocr_purpose: purpose,
      status: "uploading",
      created_at: now,
    },
    status: "photo_uploading",
    updated_at: now,
  }, ["pending_upload"]));
  return { success: true, uploads };
}

async function photoRows(student, compositionId, photoIds) {
  const rows = [];
  for (const photoId of photoIds) {
    const row = await getOne(UPLOADS, {
      photo_id: text(photoId, 100), composition_id: compositionId, student_uid: student.auth_uid,
    });
    if (!row) throw new Error("PHOTO_UPLOAD_NOT_FOUND");
    rows.push(row);
  }
  return rows.sort((a, b) => Number(a.page_index || 0) - Number(b.page_index || 0));
}

async function finishPhotoUpload(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  const operationId = text(event.operation_id, 160);
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  const photoIds = Array.isArray(event.photo_ids) ? event.photo_ids.slice(0, MAX_UPLOAD_PAGES) : [];
  const purpose = ocrPurpose(event.ocr_purpose);
  if (!photoIds.length) throw new Error("PHOTO_UPLOAD_REQUIRED");
  const rows = await photoRows(student, composition.composition_id, photoIds);
  if (rows.some((row) => row.operation_id !== operationId)) throw new Error("UPLOAD_BATCH_SUPERSEDED");
  if (rows.some((row) => ocrPurpose(row.ocr_purpose) !== purpose)) throw new Error("UPLOAD_BATCH_SUPERSEDED");
  const info = await app.getFileInfo({ fileList: rows.map((row) => row.file_id) });
  const fileMap = new Map((info.fileList || []).map((file) => [file.fileID, file]));
  for (const row of rows) {
    const file = fileMap.get(row.file_id);
    if (!file || Number(file.size || 0) < 1 || Number(file.size || 0) > MAX_IMAGE_BYTES) {
      throw new Error("PHOTO_UPLOAD_INVALID");
    }
    const uploadedAt = new Date();
    await db.collection(UPLOADS).doc(row._id).update({
      status: "uploaded", uploaded_at: uploadedAt,
      expires_at: new Date(uploadedAt.getTime() + CONFIRMED_UPLOAD_TTL_MS), updated_at: uploadedAt,
    });
  }
  // Upload confirmation and durable OCR enqueue are one server-side handoff.
  // Once this call reaches CloudBase, closing the browser cannot strand an
  // uploaded photo between two client requests.
  return await enqueueOcrJob(student, { ...event, operation_id: operationId, photo_ids: photoIds, ocr_purpose: purpose });
}

function revisionRequiredUnits(composition) {
  const sentences = composition && composition.language_review
    && Array.isArray(composition.language_review.sentences)
    ? composition.language_review.sentences : [];
  const acceptedIds = new Set(composition && composition.rewrite_results
    && Array.isArray(composition.rewrite_results.results)
    ? composition.rewrite_results.results
      .filter((item) => item && item.accepted === true)
      .map((item) => text(item.sentence_id, 40)).filter(Boolean)
    : []);
  return sentences.filter((item) => item && item.rewrite_required === true
    && text(item.sentence_id, 40) && !acceptedIds.has(text(item.sentence_id, 40)));
}

function revisionUnitNumber(sentenceId) {
  const match = /^s(\d+)$/i.exec(text(sentenceId, 40));
  return match ? Number(match[1]) : NaN;
}

function revisionSourceUnits(composition) {
  const sentences = composition && composition.language_review
    && Array.isArray(composition.language_review.sentences)
    ? composition.language_review.sentences : [];
  const requiredIds = new Set(revisionRequiredUnits(composition).map((item) => text(item.sentence_id, 40)));
  return sentences.map((item) => ({
    sentence_id: text(item && item.sentence_id, 40),
    written_number: revisionUnitNumber(item && item.sentence_id),
    source_sentence: text(item && item.original, 3000),
    rewrite_required: requiredIds.has(text(item && item.sentence_id, 40)),
  })).filter((item) => item.sentence_id && Number.isInteger(item.written_number));
}

function revisionScanCandidate(studentUid, compositionId, operationId, item, index, expectedByNumber, seenNumbers) {
  const writtenNumber = Number.isInteger(item && item.written_number) ? item.written_number : null;
  const recognizedText = text(item && item.recognized_text, 3000);
  const confidence = ["high", "medium", "low"].includes(item && item.confidence) ? item.confidence : "low";
  const warnings = Array.isArray(item && item.warnings)
    ? item.warnings.map((warning) => text(warning, 300)).filter(Boolean).slice(0, 12)
    : [];
  const candidate = {
    candidate_id: stableId("revision_candidate", studentUid, compositionId, operationId, String(index)),
    sentence_id: null, written_number: writtenNumber, recognized_text: recognizedText,
    confidence, warnings, status: "unresolved",
  };
  if (!recognizedText) {
    candidate.warnings.push("EMPTY_RECOGNIZED_TEXT");
    candidate.status = "check";
    return candidate;
  }
  if (!Number.isInteger(writtenNumber)) {
    candidate.warnings.push("MISSING_SENTENCE_NUMBER");
    return candidate;
  }
  const target = expectedByNumber.get(writtenNumber);
  if (!target) {
    candidate.warnings.push("SENTENCE_NUMBER_OUT_OF_RANGE_OR_NOT_REQUIRED");
    return candidate;
  }
  candidate.sentence_id = target.sentence_id;
  if (seenNumbers.has(writtenNumber)) {
    candidate.warnings.push("DUPLICATE_SENTENCE_NUMBER");
    candidate.status = "check";
    return candidate;
  }
  seenNumbers.add(writtenNumber);
  candidate.status = confidence !== "high" || warnings.length ? "check" : "mapped";
  return candidate;
}

function canonicalRevisionScanResult(result, composition, studentUid, operationId, metadata) {
  const requiredUnits = revisionRequiredUnits(composition);
  if (!requiredUnits.length) throw new Error("REVISION_SCAN_NO_REQUIRED_SENTENCES");
  const expectedByNumber = new Map(requiredUnits
    .map((unit) => [revisionUnitNumber(unit.sentence_id), unit])
    .filter(([number]) => Number.isInteger(number)));
  const modelItems = [];
  if (Array.isArray(result && result.items)) modelItems.push(...result.items);
  if (Array.isArray(result && result.unmapped_items)) modelItems.push(...result.unmapped_items);
  if (!modelItems.length) throw new Error("WRITING_AI_REVISION_SCAN_EMPTY");
  if (modelItems.length > 200) throw new Error("WRITING_AI_REVISION_SCAN_TOO_LARGE");
  const seenNumbers = new Set();
  const items = modelItems.map((item, index) => revisionScanCandidate(
    studentUid, composition.composition_id, operationId, item, index, expectedByNumber, seenNumbers,
  ));
  const numberCounts = new Map();
  items.forEach((item) => {
    if (Number.isInteger(item.written_number) && expectedByNumber.has(item.written_number)) {
      numberCounts.set(item.written_number, (numberCounts.get(item.written_number) || 0) + 1);
    }
  });
  items.forEach((item) => {
    if (Number.isInteger(item.written_number) && numberCounts.get(item.written_number) > 1) {
      item.status = "check";
      if (!item.warnings.includes("DUPLICATE_SENTENCE_NUMBER")) item.warnings.push("DUPLICATE_SENTENCE_NUMBER");
    }
  });
  const presentIds = new Set(items
    .filter((item) => item.sentence_id && item.recognized_text)
    .map((item) => item.sentence_id));
  const missingSentenceIds = requiredUnits.map((unit) => unit.sentence_id)
    .filter((sentenceId) => !presentIds.has(sentenceId));
  const unresolvedItems = items.filter((item) => item.status !== "mapped");
  return {
    operation_id: operationId, composition_revision: Number(composition.revision || 1),
    items, unresolved_items: unresolvedItems, missing_sentence_ids: missingSentenceIds,
    model_metadata: metadata || null, scanned_at: new Date(),
  };
}

function revisionPhotoJobMatches(existing, composition, operationId, photoIds) {
  return existing && existing.composition_id === composition.composition_id
    && existing.job_type === "revision_ocr" && existing.operation_id === operationId
    && JSON.stringify(existing.photo_ids || []) === JSON.stringify(photoIds || []);
}

async function startRevisionScanUpload(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  if (composition.status === "completed") throw new Error("COMPOSITION_READ_ONLY");
  if (!revisionRequiredUnits(composition).length) throw new Error("REVISION_SCAN_NO_REQUIRED_SENTENCES");
  const operationId = text(event.operation_id, 160);
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  const pages = Array.isArray(event.pages) ? event.pages : [];
  if (!pages.length || pages.length > MAX_UPLOAD_PAGES) throw new Error("PHOTO_PAGE_COUNT_INVALID");
  const jobId = revisionJobId(student.auth_uid, composition.composition_id, operationId);
  const existingJob = await getOne(JOBS, { job_id: jobId, student_uid: student.auth_uid });
  if (existingJob) {
    const existingPhotoIds = Array.isArray(existingJob.photo_ids) ? existingJob.photo_ids : [];
    if (existingJob.composition_id !== composition.composition_id || existingJob.job_type !== "revision_ocr"
      || existingJob.operation_id !== operationId || existingPhotoIds.length !== pages.length
      || existingPhotoIds.some((photoId, index) => photoId !== revisionPhotoId(
        student.auth_uid, composition.composition_id, operationId, index,
      ))) throw new Error("IDEMPOTENCY_KEY_REUSED");
    const existingRows = await photoRows(student, composition.composition_id, existingPhotoIds);
    if (existingRows.length !== pages.length || existingRows.some((row, index) =>
      Number(row.page_index) !== index
      || row.mime_type !== text(pages[index].mime_type, 80).toLowerCase()
      || Number(row.expected_size_bytes) !== Number(pages[index].size_bytes || 0))) {
      throw new Error("IDEMPOTENCY_KEY_REUSED");
    }
    return { success: true, uploads: [], idempotent_replay: true, job: publicJobView(existingJob), composition: compositionView(composition) };
  }
  const now = new Date();
  const uploads = [];
  for (let index = 0; index < pages.length; index += 1) {
    const mimeType = text(pages[index].mime_type, 80).toLowerCase();
    const extension = imageExtension(mimeType);
    const sizeBytes = Number(pages[index].size_bytes || 0);
    if (!extension || !Number.isFinite(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_IMAGE_BYTES) throw new Error("PHOTO_FILE_INVALID");
    const photoId = revisionPhotoId(student.auth_uid, composition.composition_id, operationId, index);
    const cloudPath = `writing-tutor/${student.auth_uid}/${composition.composition_id}/revision-scan/${photoId}.${extension}`;
    const metadata = await app.getUploadMetadata({ cloudPath });
    const view = uploadMetadataView(metadata, cloudPath);
    const record = {
      photo_id: photoId, composition_id: composition.composition_id, student_uid: student.auth_uid,
      status: "uploading", upload_kind: "revision_scan", page_index: index,
      file_id: view.file_id, cloud_path: cloudPath, original_name: text(pages[index].file_name, 160),
      mime_type: mimeType, expected_size_bytes: sizeBytes, operation_id: operationId,
      expires_at: new Date(now.getTime() + INCOMPLETE_UPLOAD_TTL_MS), created_at: now, updated_at: now,
    };
    let existing = await getOne(UPLOADS, { photo_id: photoId, student_uid: student.auth_uid });
    if (!existing) {
      try { await db.collection(UPLOADS).doc(photoId).create(record); existing = record; }
      catch (_error) { existing = await getOne(UPLOADS, { photo_id: photoId, student_uid: student.auth_uid }); }
    }
    if (!existing || existing.composition_id !== composition.composition_id || existing.operation_id !== operationId
      || existing.upload_kind !== "revision_scan" || Number(existing.page_index) !== index
      || existing.mime_type !== mimeType || Number(existing.expected_size_bytes) !== sizeBytes) throw new Error("IDEMPOTENCY_KEY_REUSED");
    if (existing.status !== "uploaded") {
      await db.collection(UPLOADS).doc(existing._id || photoId).update({
        status: "uploading", file_id: view.file_id, cloud_path: cloudPath,
        expires_at: new Date(now.getTime() + INCOMPLETE_UPLOAD_TTL_MS), updated_at: now,
      });
    }
    uploads.push({ photo_id: photoId, ...view });
  }
  await db.collection(COMPOSITIONS).doc(composition._id).update(replaceWholeFields({
    pending_upload: { kind: "revision_scan", operation_id: operationId,
      photo_ids: uploads.map((upload) => upload.photo_id), status: "uploading",
      composition_revision: Number(composition.revision || 1), created_at: now },
    status: "revision_photo_uploading", updated_at: now,
  }, ["pending_upload"]));
  return { success: true, uploads };
}

async function finishRevisionScanUpload(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  if (composition.status === "completed") throw new Error("COMPOSITION_READ_ONLY");
  if (!revisionRequiredUnits(composition).length) throw new Error("REVISION_SCAN_NO_REQUIRED_SENTENCES");
  const operationId = text(event.operation_id, 160);
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  const photoIds = Array.isArray(event.photo_ids) ? event.photo_ids.slice(0, MAX_UPLOAD_PAGES) : [];
  if (!photoIds.length || new Set(photoIds).size !== photoIds.length) throw new Error("PHOTO_UPLOAD_REQUIRED");
  const jobId = revisionJobId(student.auth_uid, composition.composition_id, operationId);
  const existingJob = await getOne(JOBS, { job_id: jobId, student_uid: student.auth_uid });
  if (existingJob) {
    if (!revisionPhotoJobMatches(existingJob, composition, operationId, photoIds)) throw new Error("IDEMPOTENCY_KEY_REUSED");
    const latest = await ownedComposition(student, composition.composition_id);
    if (existingJob.status === "queued") {
      try { await invokeFunctionAsync("writingTutor", { action: "processQueuedJob", job_id: jobId, dispatch_token: existingJob.dispatch_token }); }
      catch (error) { console.error("writingTutor revision scan replay dispatch deferred", jobId, error && error.message); }
    }
    return { success: true, accepted: ["queued", "processing"].includes(existingJob.status), idempotent_replay: true,
      job: publicJobView(existingJob), composition: compositionView(latest) };
  }
  const rows = await photoRows(student, composition.composition_id, photoIds);
  if (rows.some((row) => row.operation_id !== operationId || row.upload_kind !== "revision_scan")) throw new Error("UPLOAD_BATCH_SUPERSEDED");
  if (rows.some((row) => !["uploaded", "uploading"].includes(row.status))) throw new Error("PHOTO_UPLOAD_INCOMPLETE");
  const info = await app.getFileInfo({ fileList: rows.map((row) => row.file_id) });
  const fileMap = new Map((info.fileList || []).map((file) => [file.fileID, file]));
  rows.forEach((row) => {
    const file = fileMap.get(row.file_id);
    if (!file || Number(file.size || 0) < 1 || Number(file.size || 0) > MAX_IMAGE_BYTES) throw new Error("PHOTO_UPLOAD_INVALID");
  });
  const now = new Date();
  const job = {
    job_id: jobId, job_type: "revision_ocr", operation_id: operationId,
    dispatch_token: crypto.randomBytes(32).toString("hex"), student_uid: student.auth_uid,
    composition_id: composition.composition_id, composition_revision: Number(composition.revision || 1),
    photo_ids: photoIds, sentence_ids: revisionRequiredUnits(composition).map((item) => item.sentence_id),
    prompt_bundle_version: PROMPT_BUNDLE_VERSION, status: "queued", attempt_count: 0, error_code: null,
    lease_token: null, lease_until: null, next_retry_at: now, created_at: now, updated_at: now,
    started_at: null, finished_at: null,
  };
  const activeJob = publicJobView(job);
  try {
    await db.runTransaction(async (transaction) => {
      const compositionResult = await transaction.collection(COMPOSITIONS).where({ composition_id: composition.composition_id, student_uid: student.auth_uid }).limit(1).get();
      const current = compositionResult.data && compositionResult.data[0];
      if (!current) throw new Error("COMPOSITION_NOT_FOUND");
      if (Number(current.revision || 1) !== Number(job.composition_revision || 1)) throw new Error("COMPOSITION_REVISION_CHANGED");
      if (current.active_job_id && current.active_job_id !== jobId) {
        const priorResult = await transaction.collection(JOBS).where({ job_id: current.active_job_id, student_uid: student.auth_uid, composition_id: composition.composition_id }).limit(1).get();
        const prior = priorResult.data && priorResult.data[0];
        if (prior && ["queued", "processing", "failed"].includes(prior.status)) {
          await transaction.collection(JOBS).doc(prior._id).update({ status: "superseded", superseded_by_job_id: jobId, lease_token: null, lease_until: null, next_retry_at: null, finished_at: now, updated_at: now });
        }
      }
      const created = await transaction.collection(JOBS).doc(jobId).create(job);
      if (created && created.code) throw created;
      for (const row of rows) {
        await transaction.collection(UPLOADS).doc(row._id).update({
          status: "uploaded", uploaded_at: row.uploaded_at || now,
          expires_at: new Date(now.getTime() + CONFIRMED_UPLOAD_TTL_MS), updated_at: now,
        });
      }
      await transaction.collection(COMPOSITIONS).doc(current._id).update(replaceWholeFields({
        pending_upload: null, pending_revision_scan: null, active_job_id: jobId,
        active_job: activeJob, status: "revision_ocr_queued", updated_at: now,
      }, ["pending_upload", "pending_revision_scan", "active_job"]));
    });
  } catch (error) {
    const raced = await getOne(JOBS, { job_id: jobId, student_uid: student.auth_uid });
    if (!raced || !revisionPhotoJobMatches(raced, composition, operationId, photoIds)) throw error;
    const latest = await ownedComposition(student, composition.composition_id);
    return { success: true, accepted: ["queued", "processing"].includes(raced.status), idempotent_replay: true, job: publicJobView(raced), composition: compositionView(latest) };
  }
  try { await invokeFunctionAsync("writingTutor", { action: "processQueuedJob", job_id: jobId, dispatch_token: job.dispatch_token }); }
  catch (error) { console.error("writingTutor revision scan async dispatch deferred", jobId, error && error.message); }
  return { success: true, accepted: true, job: activeJob, composition: compositionView({ ...composition, pending_upload: null, pending_revision_scan: null, active_job_id: jobId, active_job: activeJob, status: "revision_ocr_queued", updated_at: now }) };
}

function retryableJobError(code) {
  return code === "WRITING_AI_TIMEOUT"
    || code === "WRITING_AI_UNAVAILABLE"
    || code === "WRITING_AI_SCHEMA_RESPONSE_INVALID"
    || /^WRITING_AI_HTTP_(?:429|5\d\d)$/.test(code);
}

async function enqueueOcrJob(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  if (composition.status === "completed") throw new Error("COMPOSITION_READ_ONLY");
  const operationId = text(event.operation_id, 160);
  const purpose = ocrPurpose(event.ocr_purpose);
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  const jobId = stableId("writing_job", student.auth_uid, operationId);
  const existing = await getOne(JOBS, { job_id: jobId, student_uid: student.auth_uid });
  if (existing) {
    if (existing.composition_id !== composition.composition_id || existing.job_type !== "ocr"
      || ocrPurpose(existing.ocr_purpose) !== purpose) {
      throw new Error("IDEMPOTENCY_KEY_REUSED");
    }
    let latest = composition;
    if (!composition.active_job_id && ["queued", "processing"].includes(existing.status)) {
      const projection = publicJobView(existing);
      await db.collection(COMPOSITIONS).doc(composition._id).update({
        active_job_id: jobId,
        active_job: projection,
        ocr_job: projection,
        pending_upload: null,
        status: existing.status === "processing" ? "ocr_processing" : "ocr_queued",
        updated_at: new Date(),
      });
      latest = await ownedComposition(student, composition.composition_id);
    }
    if (existing.status === "queued") {
      try {
        await invokeFunctionAsync("writingTutor", {
          action: "processQueuedJob", job_id: jobId, dispatch_token: existing.dispatch_token,
        });
      } catch (error) {
        console.error("writingTutor replay dispatch deferred", jobId, error && error.message);
      }
    }
    if (existing.status === "succeeded" && latest.pending_ocr) {
      return {
        success: true, accepted: false, idempotent_replay: true,
        job: publicJobView(existing), ocr: latest.pending_ocr,
        composition: compositionView(latest),
      };
    }
    return {
      success: true, accepted: true, idempotent_replay: true,
      job: publicJobView(existing), composition: compositionView(latest),
    };
  }
  let photoIds = Array.isArray(event.photo_ids) ? event.photo_ids.slice(0, MAX_UPLOAD_PAGES) : [];
  if (!photoIds.length && composition.active_job_id) {
    const prior = await getOne(JOBS, {
      job_id: composition.active_job_id,
      student_uid: student.auth_uid,
      composition_id: composition.composition_id,
    });
    if (prior && prior.job_type === "ocr" && Array.isArray(prior.photo_ids)) {
      photoIds = prior.photo_ids.slice(0, MAX_UPLOAD_PAGES);
    }
  }
  const rows = await photoRows(student, composition.composition_id, photoIds);
  if (!rows.length || rows.some((row) => row.status !== "uploaded")) throw new Error("PHOTO_UPLOAD_INCOMPLETE");
  const now = new Date();
  const job = {
    job_id: jobId,
    job_type: "ocr",
    ocr_purpose: purpose,
    operation_id: operationId,
    dispatch_token: crypto.randomBytes(32).toString("hex"),
    student_uid: student.auth_uid,
    composition_id: composition.composition_id,
    composition_revision: Number(composition.revision || 1),
    photo_ids: photoIds,
    replace_current: event.replace_current === true || rows.some((row) => row.replace_current === true),
    previous_status: composition.status || "draft",
    status: "queued",
    attempt_count: 0,
    error_code: null,
    lease_token: null,
    lease_until: null,
    next_retry_at: now,
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null,
  };
  const activeJob = publicJobView(job);
  try {
    await db.runTransaction(async (transaction) => {
      const compositionResult = await transaction.collection(COMPOSITIONS).where({
        composition_id: composition.composition_id,
        student_uid: student.auth_uid,
      }).limit(1).get();
      const current = compositionResult.data && compositionResult.data[0];
      if (!current) throw new Error("COMPOSITION_NOT_FOUND");
      if (current.active_job_id && current.active_job_id !== jobId) {
        const priorResult = await transaction.collection(JOBS).where({
          job_id: current.active_job_id,
          student_uid: student.auth_uid,
          composition_id: composition.composition_id,
        }).limit(1).get();
        const prior = priorResult.data && priorResult.data[0];
        if (prior && ["queued", "processing", "failed"].includes(prior.status)) {
          await transaction.collection(JOBS).doc(prior._id).update({
            status: "superseded", superseded_by_job_id: jobId,
            lease_token: null, lease_until: null,
            finished_at: now, updated_at: now,
          });
        }
      }
      const created = await transaction.collection(JOBS).doc(jobId).create(job);
      if (created && created.code) throw created;
      await transaction.collection(COMPOSITIONS).doc(current._id).update({
        active_job_id: jobId,
        active_job: activeJob,
        ocr_job: activeJob,
        pending_upload: null,
        status: "ocr_queued",
        updated_at: now,
      });
    });
  } catch (_error) {
    const raced = await getOne(JOBS, { job_id: jobId, student_uid: student.auth_uid });
    if (!raced || raced.composition_id !== composition.composition_id || raced.job_type !== "ocr"
      || ocrPurpose(raced.ocr_purpose) !== purpose) {
      throw _error;
    }
    const latest = await ownedComposition(student, composition.composition_id);
    return {
      success: true,
      accepted: raced.status !== "succeeded",
      idempotent_replay: true,
      job: publicJobView(raced),
      ocr: raced.status === "succeeded" ? latest.pending_ocr || null : undefined,
      composition: compositionView(latest),
    };
  }
  try {
    await invokeFunctionAsync("writingTutor", {
      action: "processQueuedJob", job_id: jobId, dispatch_token: job.dispatch_token,
    });
  } catch (error) {
    // The durable queue remains authoritative; writingAiWorker will redispatch it.
    console.error("writingTutor async dispatch deferred", jobId, error && error.message);
  }
  return {
    success: true,
    accepted: true,
    job: activeJob,
    composition: compositionView({
      ...composition,
      active_job_id: jobId,
      active_job: activeJob,
      ocr_job: activeJob,
      status: "ocr_queued",
      updated_at: now,
    }),
  };
}

function canonicalOcrUncertaintyRegions(rawRegions, spanCount, pageCount) {
  if (!Array.isArray(rawRegions)) return [];
  const spanLimit = Number.isInteger(spanCount) && spanCount >= 0 ? spanCount : 0;
  const pageLimit = Number.isInteger(pageCount) && pageCount >= 0 ? pageCount : 0;
  const chosen = new Map();
  const confidenceRank = { medium: 1, high: 2 };
  rawRegions.slice(0, 200).forEach((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const fields = ["span_index", "page_index", "x", "y", "width", "height"];
    if (fields.some((field) => !Number.isInteger(raw[field]))) return;
    const { span_index: spanIndex, page_index: pageIndex, x, y, width, height } = raw;
    if (spanIndex < 0 || spanIndex >= spanLimit || pageIndex < 0 || pageIndex >= pageLimit) return;
    if (!["high", "medium", "low"].includes(raw.confidence) || raw.confidence === "low") return;
    if (x < 0 || x >= 1000 || y < 0 || y >= 1000
      || width < 4 || width > 1000 || height < 4 || height > 350
      || x + width > 1000 || y + height > 1000) return;
    const candidate = { span_index: spanIndex, page_index: pageIndex, x, y, width, height, confidence: raw.confidence };
    const previous = chosen.get(spanIndex);
    if (!previous) {
      chosen.set(spanIndex, candidate);
      return;
    }
    const candidateRank = confidenceRank[candidate.confidence];
    const previousRank = confidenceRank[previous.confidence];
    const candidateArea = candidate.width * candidate.height;
    const previousArea = previous.width * previous.height;
    if (candidateRank > previousRank || (candidateRank === previousRank && candidateArea < previousArea)) {
      chosen.set(spanIndex, candidate);
    }
  });
  return [...chosen.values()].sort((a, b) => a.span_index - b.span_index);
}

function hasOcrLocationLeaseBudget(job, nowMs = Date.now()) {
  return dateMs(job && job.lease_until) - nowMs >= OCR_LOCATION_MIN_LEASE_REMAINING_MS;
}

async function performOcrJob(student, job) {
  const composition = await ownedComposition(student, job.composition_id);
  if (composition.active_job_id !== job.job_id) return { superseded: true };
  const photoIds = Array.isArray(job.photo_ids) ? job.photo_ids.slice(0, MAX_UPLOAD_PAGES) : [];
  const rows = await photoRows(student, composition.composition_id, photoIds);
  if (!rows.length || rows.some((row) => row.status !== "uploaded")) throw new Error("PHOTO_UPLOAD_INCOMPLETE");
  const urls = await app.getTempFileURL({ fileList: rows.map((row) => ({ fileID: row.file_id, maxAge: 600 })) });
  const urlMap = new Map((urls.fileList || []).map((item) => [item.fileID, item.tempFileURL]));
  const imageUrls = rows.map((row) => urlMap.get(row.file_id)).filter(Boolean);
  if (imageUrls.length !== rows.length) throw new Error("PHOTO_URL_FAILED");
  const purpose = ocrPurpose(job.ocr_purpose);
  const ocrResponse = await callStructuredModel({
    system: ocrPrompt(),
    userText: purpose === "prompt"
      ? "Transcribe the attached writing-task prompt in page order. Return only the required structured result."
      : "Transcribe the attached composition pages in page order. Return only the required structured result.",
    schemaName: "writing_ocr_v1", schema: OCR_SCHEMA, images: imageUrls, vision: true,
  });
  const ocr = ocrResponse.data;
  const fullText = text(ocr.full_text, MAX_COMPOSITION_CHARS);
  const paragraphs = Array.isArray(ocr.paragraphs)
    ? ocr.paragraphs.map((item) => text(item, MAX_COMPOSITION_CHARS)).filter(Boolean)
    : [];
  if (!fullText && !paragraphs.length) throw new Error("WRITING_AI_OCR_EMPTY");
  const uncertainSpans = Array.isArray(ocr.uncertain_spans)
    ? ocr.uncertain_spans.map((item) => ({
      text: text(item && item.text, 1000),
      reason: text(item && item.reason, 1000),
    })).filter((item) => item.text).slice(0, 100)
    : [];
  let uncertainRegions = [];
  let locationStatus = uncertainSpans.length ? "unavailable" : "not_needed";
  let locationModelMetadata = null;
  if (uncertainSpans.length && imageUrls.length && hasOcrLocationLeaseBudget(job)) {
    try {
      const locationResponse = await callStructuredModel({
        system: ocrLocationPrompt(),
        userText: JSON.stringify(uncertainSpans.map((span, spanIndex) => ({ span_index: spanIndex, text: span.text }))),
        schemaName: "writing_ocr_locations_v1",
        schema: OCR_LOCATION_SCHEMA,
        images: imageUrls,
        vision: true,
        timeoutMs: 45000,
      });
      uncertainRegions = canonicalOcrUncertaintyRegions(
        locationResponse.data && locationResponse.data.regions,
        uncertainSpans.length,
        imageUrls.length,
      );
      locationModelMetadata = locationResponse.metadata || null;
      locationStatus = uncertainRegions.length === uncertainSpans.length ? "complete" : "partial";
      if (!uncertainRegions.length) locationStatus = "unavailable";
    } catch (error) {
      const safeCode = error && typeof error.message === "string"
        && /^WRITING_AI_[A-Z0-9_]{2,120}$/.test(error.message)
        ? error.message : "WRITING_AI_LOCATION_UNAVAILABLE";
      console.error("writingTutor OCR location unavailable", safeCode);
    }
  }
  const pendingOcr = {
    full_text: fullText || paragraphs.join("\n\n"),
    paragraphs,
    uncertain_spans: uncertainSpans,
    uncertain_regions: uncertainRegions,
    location_status: locationStatus,
    location_model_metadata: locationModelMetadata,
    photo_ids: photoIds,
    ocr_purpose: purpose,
    replace_current: job.replace_current === true,
    model_metadata: ocrResponse.metadata,
    extracted_at: new Date(),
  };
  const finishedAt = new Date();
  const succeededJob = publicJobView({ ...job, status: "succeeded", finished_at: finishedAt });
  let outcome = "lease_lost";
  await db.runTransaction(async (transaction) => {
    const compositionResult = await transaction.collection(COMPOSITIONS).where({
      composition_id: composition.composition_id,
      student_uid: student.auth_uid,
    }).limit(1).get();
    const jobResult = await transaction.collection(JOBS).where({ job_id: job.job_id }).limit(1).get();
    const current = compositionResult.data && compositionResult.data[0];
    const currentJob = jobResult.data && jobResult.data[0];
    if (!currentJob || currentJob.status !== "processing"
      || !secretMatches(currentJob.lease_token, job.lease_token)) return;
    if (!current || current.active_job_id !== job.job_id) {
      await transaction.collection(JOBS).doc(currentJob._id).update({
        status: "superseded", error_code: null, lease_token: null, lease_until: null,
        next_retry_at: null, finished_at: finishedAt, updated_at: finishedAt,
      });
      outcome = "superseded";
      return;
    }
    await transaction.collection(COMPOSITIONS).doc(current._id).update({
      pending_ocr: pendingOcr,
      active_job: succeededJob,
      ocr_job: succeededJob,
      status: "ocr_review",
      updated_at: finishedAt,
    });
    await transaction.collection(JOBS).doc(currentJob._id).update({
      status: "succeeded", error_code: null, lease_token: null, lease_until: null,
      next_retry_at: null, finished_at: finishedAt, updated_at: finishedAt,
    });
    outcome = "succeeded";
  });
  return { status: outcome, pendingOcr: outcome === "succeeded" ? pendingOcr : null };
}

async function performRevisionOcrJob(student, job) {
  const composition = await ownedComposition(student, job.composition_id);
  if (composition.active_job_id !== job.job_id) return { status: "superseded" };
  if (Number(composition.revision || 1) !== Number(job.composition_revision || 1)) {
    throw new Error("COMPOSITION_REVISION_CHANGED");
  }
  const requiredUnits = revisionRequiredUnits(composition);
  if (!requiredUnits.length) throw new Error("REVISION_SCAN_NO_REQUIRED_SENTENCES");
  const photoIds = Array.isArray(job.photo_ids) ? job.photo_ids.slice(0, MAX_UPLOAD_PAGES) : [];
  const rows = await photoRows(student, composition.composition_id, photoIds);
  if (!rows.length || rows.some((row) => row.status !== "uploaded" || row.upload_kind !== "revision_scan")) {
    throw new Error("PHOTO_UPLOAD_INCOMPLETE");
  }
  const urls = await app.getTempFileURL({ fileList: rows.map((row) => ({ fileID: row.file_id, maxAge: 600 })) });
  const urlMap = new Map((urls.fileList || []).map((item) => [item.fileID, item.tempFileURL]));
  const imageUrls = rows.map((row) => urlMap.get(row.file_id)).filter(Boolean);
  if (imageUrls.length !== rows.length) throw new Error("PHOTO_URL_FAILED");
  const sourceUnits = revisionSourceUnits(composition);
  const allowedNumbers = requiredUnits.map((unit) => revisionUnitNumber(unit)).filter(Number.isInteger);
  const modelResponse = await callStructuredModel({
    system: revisionScanPrompt(), schemaName: "writing_revision_scan_v1", schema: REVISION_SCAN_SCHEMA,
    images: imageUrls, vision: true,
    userText: `ALLOWED_GLOBAL_SENTENCE_NUMBERS_JSON:\n${JSON.stringify(allowedNumbers)}\nSOURCE_SENTENCES_JSON:\n${JSON.stringify(sourceUnits)}\nReturn only candidates visible in the attached pages.`,
  });
  const pending = canonicalRevisionScanResult(modelResponse.data, composition, student.auth_uid, job.operation_id, modelResponse.metadata);
  const now = new Date();
  const succeededJob = publicJobView({ ...job, status: "succeeded", finished_at: now });
  let outcome = "lease_lost";
  await db.runTransaction(async (transaction) => {
    const compositionResult = await transaction.collection(COMPOSITIONS).where({ composition_id: job.composition_id, student_uid: job.student_uid }).limit(1).get();
    const jobResult = await transaction.collection(JOBS).where({ job_id: job.job_id }).limit(1).get();
    const current = compositionResult.data && compositionResult.data[0];
    const currentJob = jobResult.data && jobResult.data[0];
    if (!currentJob || currentJob.status !== "processing" || !secretMatches(currentJob.lease_token, job.lease_token)) return;
    if (!current || current.active_job_id !== job.job_id || Number(current.revision || 1) !== Number(job.composition_revision || 1)) {
      await transaction.collection(JOBS).doc(currentJob._id).update({ status: "superseded", lease_token: null, lease_until: null, next_retry_at: null, finished_at: now, updated_at: now });
      outcome = "superseded";
      return;
    }
    await transaction.collection(COMPOSITIONS).doc(current._id).update(replaceWholeFields({
      pending_revision_scan: pending, active_job: succeededJob, status: "revision_scan_review", updated_at: now,
    }, ["pending_revision_scan", "active_job"]));
    await transaction.collection(JOBS).doc(currentJob._id).update({ status: "succeeded", error_code: null, lease_token: null, lease_until: null, next_retry_at: null, finished_at: now, updated_at: now });
    outcome = "succeeded";
  });
  if (outcome === "succeeded") {
    try { await deleteUploadedPhotos(rows); }
    catch (error) { console.error("writingTutor revision scan photo cleanup failed", error && error.message); }
  }
  return { status: outcome, pendingRevisionScan: outcome === "succeeded" ? pending : null };
}

async function claimQueuedJob(jobId, dispatchToken) {
  let claimed = null;
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(JOBS).where({ job_id: jobId }).limit(1).get();
    const current = result.data && result.data[0];
    if (!current || !secretMatches(current.dispatch_token, dispatchToken)) throw new Error("AI_JOB_UNAUTHORIZED");
    const leaseActive = current.status === "processing" && dateMs(current.lease_until) > Date.now();
    if (leaseActive || ["succeeded", "failed", "superseded"].includes(current.status)) return;
    if (Number(current.attempt_count || 0) >= MAX_JOB_ATTEMPTS) {
      const now = new Date();
      const failedJob = publicJobView({
        ...current, status: "failed", error_code: "WRITING_AI_ATTEMPTS_EXHAUSTED", finished_at: now,
      });
      await transaction.collection(JOBS).doc(current._id).update({
        status: "failed", error_code: "WRITING_AI_ATTEMPTS_EXHAUSTED",
        lease_token: null, lease_until: null, next_retry_at: null,
        finished_at: now, updated_at: now,
      });
      const compositionResult = await transaction.collection(COMPOSITIONS).where({
        composition_id: current.composition_id, student_uid: current.student_uid,
      }).limit(1).get();
      const composition = compositionResult.data && compositionResult.data[0];
      if (composition && composition.active_job_id === current.job_id) {
        await transaction.collection(COMPOSITIONS).doc(composition._id).update({
          active_job: failedJob,
          ocr_job: current.job_type === "ocr" ? failedJob : composition.ocr_job || null,
          status: jobCompositionStatus(current, "failed") || composition.status,
          updated_at: now,
        });
      }
      claimed = { ...current, status: "failed", terminal_failure: true };
      return;
    }
    if (current.status === "queued" && dateMs(current.next_retry_at) > Date.now()) return;
    if (current.status !== "queued" && current.status !== "processing") return;
    const now = new Date();
    const attemptCount = Number(current.attempt_count || 0) + 1;
    const leaseToken = crypto.randomBytes(16).toString("hex");
    const update = {
      status: "processing",
      attempt_count: attemptCount,
      lease_token: leaseToken,
      started_at: current.started_at || now,
      lease_until: new Date(now.getTime() + JOB_LEASE_MS),
      next_retry_at: null,
      updated_at: now,
      error_code: null,
    };
    await transaction.collection(JOBS).doc(current._id).update(update);
    claimed = { ...current, ...update };
  });
  return claimed;
}

async function publishProcessingJob(job) {
  let active = false;
  const now = new Date();
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(COMPOSITIONS).where({
      composition_id: job.composition_id, student_uid: job.student_uid,
    }).limit(1).get();
    const jobResult = await transaction.collection(JOBS).where({ job_id: job.job_id }).limit(1).get();
    const composition = result.data && result.data[0];
    const currentJob = jobResult.data && jobResult.data[0];
    if (!currentJob || currentJob.status !== "processing"
      || !secretMatches(currentJob.lease_token, job.lease_token)) return;
    if (!composition || composition.active_job_id !== job.job_id) {
      await transaction.collection(JOBS).doc(currentJob._id).update({
        status: "superseded", lease_token: null, lease_until: null,
        finished_at: now, updated_at: now,
      });
      return;
    }
    const activeJob = publicJobView(job);
    await transaction.collection(COMPOSITIONS).doc(composition._id).update({
      active_job: activeJob,
      ocr_job: job.job_type === "ocr" ? activeJob : composition.ocr_job || null,
      status: jobCompositionStatus(job, "processing") || composition.status,
      updated_at: now,
    });
    active = true;
  });
  return active;
}

async function finishFailedJobAttempt(job, code) {
  const shouldRetry = retryableJobError(code) && Number(job.attempt_count || 0) < MAX_JOB_ATTEMPTS;
  const status = shouldRetry ? "queued" : "failed";
  const finishedAt = shouldRetry ? null : new Date();
  const nextRetryAt = shouldRetry ? new Date(Date.now() + Number(job.attempt_count || 1) * 5000) : null;
  let committed = false;
  await db.runTransaction(async (transaction) => {
    const jobResult = await transaction.collection(JOBS).where({ job_id: job.job_id }).limit(1).get();
    const currentJob = jobResult.data && jobResult.data[0];
    if (!currentJob || currentJob.status !== "processing"
      || !secretMatches(currentJob.lease_token, job.lease_token)) return;
    const now = new Date();
    await transaction.collection(JOBS).doc(currentJob._id).update({
      status, error_code: code, lease_token: null, lease_until: null,
      next_retry_at: nextRetryAt, finished_at: finishedAt, updated_at: now,
    });
    const compositionResult = await transaction.collection(COMPOSITIONS).where({
      composition_id: job.composition_id, student_uid: job.student_uid,
    }).limit(1).get();
    const composition = compositionResult.data && compositionResult.data[0];
    if (composition && composition.active_job_id === job.job_id) {
      const activeJob = publicJobView({ ...job, status, error_code: code, finished_at: finishedAt });
      await transaction.collection(COMPOSITIONS).doc(composition._id).update({
        active_job: activeJob,
        ocr_job: job.job_type === "ocr" ? activeJob : composition.ocr_job || null,
        status: jobCompositionStatus(job, status) || composition.status,
        updated_at: now,
      });
    }
    committed = true;
  });
  return { committed, status, shouldRetry };
}

async function processQueuedJob(event) {
  const jobId = text(event.job_id, 120);
  const dispatchToken = text(event.dispatch_token, 200);
  if (!jobId || !dispatchToken) throw new Error("AI_JOB_UNAUTHORIZED");
  const claimed = await claimQueuedJob(jobId, dispatchToken);
  if (!claimed) return { success: true, accepted: false };
  const runner = claimed.job_type === "review"
    ? performReviewJob
    : claimed.job_type === "rewrite"
      ? performRewriteJob
      : claimed.job_type === "revision_ocr"
        ? performRevisionOcrJob
      : null;
  let student = null;
  if (claimed.job_type === "review") {
    const students = await db.collection("students").where({
      auth_uid: claimed.student_uid, active: true, role: "student",
    }).limit(1).get();
    student = students.data && students.data[0];
    if (claimed.terminal_failure) {
      await releaseUsage(student || { auth_uid: claimed.student_uid }, { usage_id: claimed.usage_id }, claimed.error_code || "WRITING_AI_ATTEMPTS_EXHAUSTED");
      return { success: false, status: "failed", code: claimed.error_code || "WRITING_AI_ATTEMPTS_EXHAUSTED" };
    }
  }
  if (!await publishProcessingJob(claimed)) {
    if (claimed.job_type === "review") await releaseUsage(student || { auth_uid: claimed.student_uid }, { usage_id: claimed.usage_id }, "AI_JOB_SUPERSEDED");
    return { success: true, status: "superseded" };
  }
  try {
    if (!student) {
      const students = await db.collection("students").where({
        auth_uid: claimed.student_uid, active: true, role: "student",
      }).limit(1).get();
      student = students.data && students.data[0];
    }
    if (!student) throw new Error("STUDENT_NOT_LINKED");
    const result = claimed.job_type === "ocr"
      ? await performOcrJob(student, claimed)
      : runner
        ? await runner(student, claimed)
        : (() => { throw new Error("AI_JOB_TYPE_INVALID"); })();
    if (claimed.job_type === "review" && result.status === "superseded") {
      await releaseUsage(student, { usage_id: claimed.usage_id }, "AI_JOB_SUPERSEDED");
    }
    return { success: result.status === "succeeded", status: result.status };
  } catch (error) {
    const code = error && error.message || "WRITING_TUTOR_ERROR";
    const outcome = await finishFailedJobAttempt(claimed, code);
    if (claimed.job_type === "review" && outcome.committed && !outcome.shouldRetry) {
      await releaseUsage(student || { auth_uid: claimed.student_uid }, { usage_id: claimed.usage_id }, code);
    }
    console.error("writingTutor AI job attempt failed", claimed.job_id, claimed.attempt_count, code);
    return { success: false, status: outcome.committed ? outcome.status : "lease_lost", code };
  }
}

async function extractOcr(student, event) {
  return await enqueueOcrJob(student, event);
}

async function deleteUploadedPhotos(rows) {
  const fileList = rows.map((row) => row.file_id).filter(Boolean);
  let deleted = fileList.length === 0;
  if (fileList.length) {
    try {
      await app.deleteFile({ fileList });
      deleted = true;
    } catch (error) {
      console.error("writingTutor photo cleanup failed", error);
    }
  }
  const now = new Date();
  await Promise.all(rows.map((row) => db.collection(UPLOADS).doc(row._id).update(deleted
    ? { status: "deleted", deleted_at: now, cleanup_error: null, updated_at: now }
    : { status: "uploaded", cleanup_error: "PHOTO_DELETE_RETRY_REQUIRED", updated_at: now })));
}

async function retryPrivatePhotoCleanup(student) {
  try {
    const result = await db.collection(UPLOADS).where({ student_uid: student.auth_uid }).limit(100).get();
    const now = Date.now();
    const stale = (result.data || []).filter((row) =>
      ["uploading", "uploaded"].includes(row.status)
      && (row.cleanup_error || dateMs(row.expires_at) < now));
    if (stale.length) await deleteUploadedPhotos(stale);
  } catch (error) {
    console.error("writingTutor deferred photo cleanup failed", error);
  }
}

async function saveSourceDraft(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  if (!isDiscardableDraftComposition(composition)) throw new Error("COMPOSITION_NOT_DRAFT");
  const mode = text(event.assessment_mode, 80) || composition.assessment_mode || "general_language";
  if (!["general_language", "standardized_content"].includes(mode)) throw new Error("ASSESSMENT_MODE_INVALID");
  const rubricId = text(event.rubric_id, 120) || null;
  if (rubricId) getRubric(rubricId);
  const submittedTitle = normalizedTitle(event.title);
  const confirmedText = text(event.confirmed_text, MAX_COMPOSITION_CHARS);
  const now = new Date();
  const update = {
    title: submittedTitle,
    title_source: submittedTitle ? "student" : "pending_ai",
    prompt_text: text(event.prompt_text, MAX_PROMPT_CHARS),
    confirmed_text: confirmedText,
    assessment_mode: mode,
    rubric_id: mode === "standardized_content" ? rubricId : null,
    word_count: wordCount(confirmedText),
    updated_at: now,
  };
  await db.collection(COMPOSITIONS).doc(composition._id).update(update);
  return { success: true, composition: compositionView({ ...composition, ...update }) };
}

async function adoptPromptOcr(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  const pendingOcr = composition.pending_ocr && typeof composition.pending_ocr === "object"
    ? composition.pending_ocr : null;
  if (!pendingOcr || ocrPurpose(pendingOcr.ocr_purpose) !== "prompt") throw new Error("PROMPT_OCR_NOT_PENDING");
  const promptText = text(event.prompt_text, MAX_PROMPT_CHARS);
  if (!promptText) throw new Error("WRITING_PROMPT_REQUIRED");
  const photoIds = Array.isArray(pendingOcr.photo_ids) ? pendingOcr.photo_ids.slice(0, MAX_UPLOAD_PAGES) : [];
  const now = new Date();
  const update = replaceWholeFields({
    prompt_text: promptText,
    pending_ocr: null,
    pending_upload: null,
    active_job_id: null,
    active_job: null,
    ocr_job: null,
    status: "draft",
    updated_at: now,
  }, ["pending_ocr", "pending_upload", "active_job", "ocr_job"]);
  await db.collection(COMPOSITIONS).doc(composition._id).update(update);
  if (photoIds.length) {
    try {
      const rows = await photoRows(student, composition.composition_id, photoIds);
      await deleteUploadedPhotos(rows);
    } catch (error) {
      console.error("writingTutor prompt photo cleanup deferred", error && error.message);
    }
  }
  return {
    success: true,
    composition: compositionView({
      ...composition,
      prompt_text: promptText,
      pending_ocr: null,
      pending_upload: null,
      active_job_id: null,
      active_job: null,
      ocr_job: null,
      status: "draft",
      updated_at: now,
    }),
  };
}

async function saveDraft(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  if (composition.status === "completed") throw new Error("COMPOSITION_READ_ONLY");
  const confirmedText = text(event.confirmed_text, MAX_COMPOSITION_CHARS);
  if (!confirmedText) throw new Error("MANUSCRIPT_REQUIRED");
  const mode = text(event.assessment_mode, 80);
  if (mode && !["general_language", "standardized_content"].includes(mode)) throw new Error("ASSESSMENT_MODE_INVALID");
  const rubricId = text(event.rubric_id, 120) || null;
  if (mode === "standardized_content") getRubric(rubricId);
  const replacing = Boolean(composition.pending_ocr && composition.pending_ocr.replace_current);
  const contentChanged = confirmedText !== String(composition.confirmed_text || "");
  const invalidatesCurrentReview = replacing || contentChanged;
  const now = new Date();
  const currentCandidate = reviewCandidate(composition);
  const submittedTitleRaw = normalizedTitle(event.title);
  const existingTitle = normalizedTitle(currentCandidate.title);
  const existingTitleSource = titleSource(currentCandidate);
  const submittedTitle = existingTitleSource === "pending_ai" && isLegacyUntitled(submittedTitleRaw)
    ? "" : submittedTitleRaw;
  const preservesAiTitle = submittedTitle && submittedTitle === existingTitle
    && ["ai", "generated"].includes(existingTitleSource);
  const draft = {
    title: submittedTitle,
    title_source: submittedTitle ? (preservesAiTitle ? existingTitleSource : "student") : "pending_ai",
    prompt_text: text(event.prompt_text, MAX_PROMPT_CHARS),
    confirmed_text: confirmedText,
    assessment_mode: mode || composition.assessment_mode || null,
    rubric_id: mode === "standardized_content" ? rubricId : null,
    word_count: wordCount(confirmedText),
  };
  const hasCommittedReview = Boolean(composition.standardized_review || composition.language_review);
  if (invalidatesCurrentReview && hasCommittedReview) {
    const pendingRevision = Number(composition.pending_replacement && composition.pending_replacement.revision)
      || Number(composition.revision || 1) + 1;
    const pendingReplacement = {
      ...draft,
      revision: pendingRevision,
      staged_at: now,
    };
    const stagedUpdate = {
      title: draft.title,
      title_source: draft.title_source,
      pending_replacement: pendingReplacement,
      pending_ocr: null,
      pending_revision_scan: null,
      scanned_rewrite_drafts: null,
      updated_at: now,
    };
    await db.collection(COMPOSITIONS).doc(composition._id).update(stagedUpdate);
    const allUploads = await db.collection(UPLOADS).where({
      composition_id: composition.composition_id, student_uid: student.auth_uid, status: "uploaded",
    }).limit(MAX_UPLOAD_PAGES * 3).get();
    await deleteUploadedPhotos(allUploads.data || []);
    return {
      success: true,
      composition: compositionView({
        ...composition, ...draft, revision: pendingRevision, status: "ready",
        pending_ocr: null, pending_replacement: pendingReplacement,
      }),
    };
  }
  const update = {
    ...draft,
    standardized_rubric_id: invalidatesCurrentReview
      ? null
      : composition.standardized_rubric_id || (composition.standardized_review && composition.rubric_id) || null,
    status: "ready",
    revision: invalidatesCurrentReview ? Number(composition.revision || 1) + 1 : Number(composition.revision || 1),
    pending_ocr: null,
    pending_revision_scan: null,
    scanned_rewrite_drafts: invalidatesCurrentReview ? null : composition.scanned_rewrite_drafts || null,
    pending_replacement: null,
    standardized_review: composition.standardized_review || null,
    language_review: composition.language_review || null,
    rewrite_results: composition.rewrite_results || null,
    updated_at: now,
  };
  await db.collection(COMPOSITIONS).doc(composition._id).update(update);
  const allUploads = await db.collection(UPLOADS).where({ composition_id: composition.composition_id, student_uid: student.auth_uid, status: "uploaded" }).limit(MAX_UPLOAD_PAGES * 3).get();
  await deleteUploadedPhotos(allUploads.data || []);
  return { success: true, composition: compositionView({ ...composition, ...update }) };
}

async function updateCompositionTitle(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  const title = normalizedTitle(event.title);
  if (!title) throw new Error("TITLE_REQUIRED");
  const now = new Date();
  const update = { title, title_source: "student", title_updated_at: now };
  await db.collection(COMPOSITIONS).doc(composition._id).update(update);
  return { success: true, composition: compositionView({ ...composition, ...update }) };
}

function usageMatchesScope(usage, composition, mode) {
  return usage && usage.composition_id === composition.composition_id
    && Number(usage.composition_revision || 1) === Number(composition.revision || 1)
    && usage.mode === mode
    && String(usage.rubric_id || "") === String(composition.rubric_id || "");
}

async function reserveUsage(student, composition, event, mode) {
  const operationId = text(event.operation_id, 160);
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  const usageId = stableId("writing_usage", student.auth_uid, operationId);
  const existing = await getOne(USAGE, { usage_id: usageId, student_uid: student.auth_uid });
  if (existing) {
    if (!usageMatchesScope(existing, composition, mode)) throw new Error("IDEMPOTENCY_KEY_REUSED");
    if (existing.status === "succeeded") return { duplicate: true, usage: existing };
    if (existing.status === "reserved") return { duplicate: false, reused: true, usage: existing };
    throw new Error("AI_OPERATION_ALREADY_FAILED");
  }
  const words = wordCount(composition.confirmed_text);
  const dayKey = shanghaiDayKey();
  const limit = dailyLimit(student);
  const now = new Date();
  try {
    await db.collection(USAGE).doc(usageId).create({
      usage_id: usageId, operation_id: operationId, student_uid: student.auth_uid,
      composition_id: composition.composition_id, composition_revision: Number(composition.revision || 1),
      mode, rubric_id: composition.rubric_id || null, word_count: words, day_key: dayKey,
      status: "reserved", created_at: now, updated_at: now,
    });
  } catch (_error) {
    const raced = await getOne(USAGE, { usage_id: usageId, student_uid: student.auth_uid });
    if (raced && !usageMatchesScope(raced, composition, mode)) throw new Error("IDEMPOTENCY_KEY_REUSED");
    if (raced && raced.status === "succeeded") return { duplicate: true, usage: raced };
    throw new Error("AI_OPERATION_IN_PROGRESS");
  }
  try {
    await db.runTransaction(async (transaction) => {
      const result = await transaction.collection("students").where({ auth_uid: student.auth_uid, active: true }).limit(1).get();
      const current = result.data && result.data[0];
      if (!current) throw new Error("STUDENT_NOT_LINKED");
      const currentDay = text(current.writing_ai_usage_day, 20);
      const used = currentDay === dayKey ? Number(current.writing_ai_words_used_today || 0) : 0;
      const currentLimit = dailyLimit(current);
      if (used + words > currentLimit) throw new Error("WRITING_AI_DAILY_LIMIT_REACHED");
      await transaction.collection("students").doc(current._id).update({
        writing_ai_usage_day: dayKey, writing_ai_words_used_today: used + words, updated_at: now,
      });
    });
  } catch (error) {
    await db.collection(USAGE).doc(usageId).update({ status: "rejected", failure_code: error.message, updated_at: new Date() });
    throw error;
  }
  return { duplicate: false, usage: { usage_id: usageId, word_count: words, day_key: dayKey, limit } };
}

function reviewCandidate(composition) {
  return composition.pending_replacement
    ? { ...composition, ...composition.pending_replacement }
    : composition;
}

function reviewScopeMatches(job, composition, mode, rubricId) {
  const candidate = reviewCandidate(composition);
  return job && job.job_type === "review"
    && Number(job.composition_revision || 1) === Number(candidate.revision || 1)
    && job.review_mode === mode
    && String(job.rubric_id || "") === String(rubricId || "");
}

function jobCompositionStatus(job, status) {
  if (job.job_type === "ocr") return status === "processing" ? "ocr_processing" : status === "queued" ? "ocr_queued" : "ocr_failed";
  if (job.job_type === "review") return status === "processing" ? "review_processing" : status === "queued" ? "review_queued" : "review_failed";
  if (job.job_type === "rewrite") return status === "processing" ? "rewrite_processing" : status === "queued" ? "rewrite_queued" : "rewrite_failed";
  if (job.job_type === "revision_ocr") return status === "processing" ? "revision_ocr_processing" : status === "queued" ? "revision_ocr_queued" : "revision_ocr_failed";
  return null;
}

function replaceWholeFields(update, fieldNames) {
  const persistenceUpdate = { ...update };
  for (const fieldName of fieldNames) {
    if (Object.prototype.hasOwnProperty.call(persistenceUpdate, fieldName)) {
      persistenceUpdate[fieldName] = db.command.set(persistenceUpdate[fieldName]);
    }
  }
  return persistenceUpdate;
}

async function enqueueReviewJob(student, composition, prepared, event, mode, usage) {
  const operationId = text(event.operation_id, 160);
  const jobId = stableId("writing_job", student.auth_uid, operationId);
  const existing = await getOne(JOBS, { job_id: jobId, student_uid: student.auth_uid });
  if (existing) {
    if (existing.composition_id !== composition.composition_id || !reviewScopeMatches(existing, composition, mode, prepared.rubric_id)
      || existing.usage_id !== usage.usage_id) throw new Error("IDEMPOTENCY_KEY_REUSED");
    let latest = composition;
    if (["queued", "processing"].includes(existing.status) && composition.active_job_id !== jobId) {
      const activeJob = publicJobView(existing);
      await db.collection(COMPOSITIONS).doc(composition._id).update({
        active_job_id: jobId,
        active_job: activeJob,
        status: jobCompositionStatus(existing, existing.status),
        updated_at: new Date(),
      });
      latest = await ownedComposition(student, composition.composition_id);
    }
    if (existing.status === "queued") {
      try {
        await invokeFunctionAsync("writingTutor", {
          action: "processQueuedJob", job_id: jobId, dispatch_token: existing.dispatch_token,
        });
      } catch (error) {
        console.error("writingTutor review replay dispatch deferred", jobId, error && error.message);
      }
    }
    return {
      success: true,
      accepted: ["queued", "processing"].includes(existing.status),
      idempotent_replay: true,
      job: publicJobView(existing),
      composition: compositionView(latest),
      review: mode === "standardized_content" ? latest.standardized_review || null : latest.language_review || null,
    };
  }
  const now = new Date();
  const job = {
    job_id: jobId,
    job_type: "review",
    review_mode: mode,
    operation_id: operationId,
    dispatch_token: crypto.randomBytes(32).toString("hex"),
    student_uid: student.auth_uid,
    composition_id: composition.composition_id,
    composition_revision: Number(prepared.revision || 1),
    rubric_id: prepared.rubric_id || null,
    usage_id: usage.usage_id,
    prompt_bundle_version: PROMPT_BUNDLE_VERSION,
    status: "queued",
    attempt_count: 0,
    error_code: null,
    lease_token: null,
    lease_until: null,
    next_retry_at: now,
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null,
  };
  const activeJob = publicJobView(job);
  try {
    await db.runTransaction(async (transaction) => {
      const compositionResult = await transaction.collection(COMPOSITIONS).where({
        composition_id: composition.composition_id, student_uid: student.auth_uid,
      }).limit(1).get();
      const current = compositionResult.data && compositionResult.data[0];
      if (!current) throw new Error("COMPOSITION_NOT_FOUND");
      const currentCandidate = reviewCandidate(current);
      if (Number(currentCandidate.revision || 1) !== Number(job.composition_revision || 1)) {
        throw new Error("COMPOSITION_REVISION_CHANGED");
      }
      const created = await transaction.collection(JOBS).doc(jobId).create(job);
      if (created && created.code) throw created;
      await transaction.collection(COMPOSITIONS).doc(current._id).update({
        active_job_id: jobId,
        active_job: activeJob,
        status: "review_queued",
        updated_at: now,
      });
    });
  } catch (error) {
    const raced = await getOne(JOBS, { job_id: jobId, student_uid: student.auth_uid });
    if (!raced || raced.composition_id !== composition.composition_id || raced.job_type !== "review") throw error;
    const latest = await ownedComposition(student, composition.composition_id);
    return {
      success: true, accepted: ["queued", "processing"].includes(raced.status), idempotent_replay: true,
      job: publicJobView(raced), composition: compositionView(latest),
    };
  }
  try {
    await invokeFunctionAsync("writingTutor", {
      action: "processQueuedJob", job_id: jobId, dispatch_token: job.dispatch_token,
    });
  } catch (error) {
    console.error("writingTutor review async dispatch deferred", jobId, error && error.message);
  }
  return {
    success: true, accepted: true, job: activeJob,
    composition: compositionView({
      ...composition, active_job_id: jobId, active_job: activeJob,
      status: "review_queued", updated_at: now,
    }),
  };
}

async function releaseUsage(student, usage, code) {
  if (!usage || !usage.usage_id) return;
  await db.runTransaction(async (transaction) => {
    const usageResult = await transaction.collection(USAGE).where({
      usage_id: usage.usage_id, student_uid: student.auth_uid, status: "reserved",
    }).limit(1).get();
    const row = usageResult.data && usageResult.data[0];
    if (!row) return;
    const result = await transaction.collection("students").where({ auth_uid: student.auth_uid }).limit(1).get();
    const current = result.data && result.data[0];
    if (current && text(current.writing_ai_usage_day, 20) === row.day_key) {
      await transaction.collection("students").doc(current._id).update({
        writing_ai_words_used_today: Math.max(0, Number(current.writing_ai_words_used_today || 0) - Number(row.word_count || 0)),
        updated_at: new Date(),
      });
    }
    await transaction.collection(USAGE).doc(row._id).update({
      status: "failed", failure_code: text(code, 120), released_at: new Date(), updated_at: new Date(),
    });
  });
}

async function commitReviewAndUsage(composition, usage, update) {
  const now = new Date();
  await db.runTransaction(async (transaction) => {
    const usageResult = await transaction.collection(USAGE)
      .where({ usage_id: usage.usage_id, status: "reserved" }).limit(1).get();
    const usageRow = usageResult.data && usageResult.data[0];
    if (!usageRow) throw new Error("AI_USAGE_RESERVATION_LOST");
    await transaction.collection(COMPOSITIONS).doc(composition._id).update(update);
    await transaction.collection(USAGE).doc(usageRow._id).update({
      status: "succeeded", succeeded_at: now, updated_at: now,
    });
  });
}

async function enqueueReviewEmail(student, usage, composition, mode) {
  const now = new Date();
  const emailId = stableId("writing_email", usage.usage_id);
  try {
    await db.collection(EMAIL_EVENTS).doc(emailId).create({
      event_id: emailId, usage_id: usage.usage_id, student_uid: student.auth_uid,
      student_id: student.student_id || "", student_name: student.name || "",
      composition_id: composition.composition_id, mode, rubric_id: composition.rubric_id || null,
      word_count: Number(usage.word_count || 0), day_key: usage.day_key,
      status: "pending", created_at: now, updated_at: now,
    });
  } catch (_error) {
    // Email is an asynchronous side effect; duplicate/outbox failure never invalidates a review.
  }
}

function validateLanguageResult(result, units) {
  const expectedIds = new Set(units.map((unit) => unit.sentence_id));
  const received = Array.isArray(result.sentences) ? result.sentences : [];
  if (received.length !== units.length) throw new Error("WRITING_AI_SENTENCE_ALIGNMENT_FAILED");
  const seen = new Set();
  for (const item of received) {
    if (!expectedIds.has(item.sentence_id) || seen.has(item.sentence_id)) {
      throw new Error("WRITING_AI_SENTENCE_ALIGNMENT_FAILED");
    }
    seen.add(item.sentence_id);
  }
}

function canonicalLanguageResult(result, units) {
  validateLanguageResult(result, units);
  const byId = new Map(result.sentences.map((item) => [item.sentence_id, item]));
  const suggestedTitle = normalizedSuggestedTitle(result.suggested_title);
  return {
    ...result,
    suggested_title: suggestedTitle,
    sentences: units.map((unit) => {
      const item = byId.get(unit.sentence_id);
      return {
        ...item,
        sentence_id: unit.sentence_id,
        original: unit.original,
        rewrite_required: item.status !== "effective",
      };
    }),
    prompt_version: PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
  };
}

function numericScore(value) {
  const source = String(value == null ? "" : value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(source)) return NaN;
  return Number(source);
}

function roundedToStep(value, step) {
  return Number((Math.round((value + Number.EPSILON) / step) * step).toFixed(8));
}

function canonicalStandardizedResult(result, rubric) {
  const received = Array.isArray(result.criteria) ? result.criteria : [];
  const byId = new Map(received.map((item) => [text(item.criterion_id, 120), item]));
  if (received.length !== rubric.criteria.length || byId.size !== rubric.criteria.length
    || rubric.criteria.some((criterion) => !byId.has(criterion.id))) {
    throw new Error("WRITING_AI_RUBRIC_ALIGNMENT_FAILED");
  }
  const criterionStep = Number(rubric.criterion_score_step || 1);
  const canonicalCriteria = rubric.criteria.map((criterion) => {
    const source = byId.get(criterion.id);
    const score = numericScore(source.score);
    const criterionMax = Number(criterion.max_score);
    if (!Number.isFinite(score) || score < 0 || score > criterionMax
      || Math.abs(score / criterionStep - Math.round(score / criterionStep)) > 1e-8) {
      throw new Error("WRITING_AI_RUBRIC_SCORE_INVALID");
    }
    return {
      ...source,
      criterion_id: criterion.id,
      name: criterion.name,
      score: String(score),
      max_score: String(criterion.max_score || ""),
    };
  });
  const rawOverall = rubric.overall_calculation === "weighted_average"
    ? canonicalCriteria.reduce((sum, item, index) => sum + Number(item.score) * Number(rubric.criteria[index].weight || 0), 0)
      / rubric.criteria.reduce((sum, criterion) => sum + Number(criterion.weight || 0), 0)
    : canonicalCriteria.reduce((sum, item) => sum + Number(item.score), 0);
  const overall = roundedToStep(rawOverall, Number(rubric.score_step || 1));
  if (!Number.isFinite(overall) || overall < 0 || overall > Number(rubric.overall_max)) {
    throw new Error("WRITING_AI_RUBRIC_SCORE_INVALID");
  }
  const suggestedTitle = normalizedSuggestedTitle(result.suggested_title);
  return {
    ...result,
    suggested_title: suggestedTitle,
    overall_score: String(overall),
    score_scale: rubric.score_scale,
    criteria: canonicalCriteria,
    rubric_id: rubric.rubric_id,
    rubric_label: rubric.label,
    prompt_version: PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
    rubric_version: RUBRIC_VERSION,
  };
}

function canonicalRewriteResults(results, items) {
  const ids = new Set(items.map((item) => item.sentence_id));
  const received = Array.isArray(results) ? results : [];
  const resultIds = new Set(received.map((item) => item.sentence_id));
  if (received.length !== items.length || resultIds.size !== items.length
    || received.some((item) => !ids.has(item.sentence_id))) {
    throw new Error("WRITING_AI_SENTENCE_ALIGNMENT_FAILED");
  }
  const rewriteTextById = new Map(items.map((item) => [item.sentence_id, item.text]));
  return received.map((item) => {
    const accepted = item.meaning_preserved === true && item.target_resolved === true
      && Array.isArray(item.new_errors) && item.new_errors.length === 0;
    return {
      ...item,
      accepted,
      next_step: accepted ? "complete" : "revise_again",
      student_rewrite: rewriteTextById.get(item.sentence_id) || "",
    };
  });
}

function rewriteFeedbackHistory(record) {
  const source = record && typeof record === "object" ? record : {};
  const existing = Array.isArray(source.feedback_history) ? source.feedback_history : [];
  if (existing.length) {
    return existing.map((batch, index) => ({
      ...batch,
      round: Number.isFinite(Number(batch && batch.round)) && Number(batch.round) > 0
        ? Number(batch.round) : index + 1,
      results: Array.isArray(batch && batch.results) ? batch.results : [],
    }));
  }
  if (!Array.isArray(source.results) || !source.results.length) return [];
  return [{
    round: 1,
    operation_id: text(source.operation_id, 160),
    overall_feedback: text(source.overall_feedback, 3000),
    results: source.results,
    prompt_version: source.prompt_version || null,
    schema_version: source.schema_version || null,
    model_metadata: source.model_metadata || null,
    checked_at: source.checked_at || null,
  }];
}

function appendRewriteFeedbackHistory(record, batch) {
  const history = rewriteFeedbackHistory(record);
  const operationId = text(batch && batch.operation_id, 160);
  const replay = operationId && history.find((item) => item.operation_id === operationId);
  if (replay) return { round: replay.round, history };
  const round = history.reduce((highest, item) => Math.max(highest, Number(item.round) || 0), 0) + 1;
  return { round, history: history.concat([{ ...batch, round }]) };
}

async function replaceObservations(student, composition, observations) {
  await db.collection(OBSERVATIONS).where({ composition_id: composition.composition_id, student_uid: student.auth_uid }).remove();
  const now = new Date();
  for (const observation of (observations || []).slice(0, 30)) {
    await db.collection(OBSERVATIONS).add({
      observation_id: randomId("writing_observation"), student_uid: student.auth_uid,
      composition_id: composition.composition_id, composition_revision: Number(composition.revision || 1),
      category: text(observation.category, 120), observation: text(observation.observation, 1000),
      evidence_sentence_ids: Array.isArray(observation.evidence_sentence_ids) ? observation.evidence_sentence_ids.slice(0, 50) : [],
      created_at: now,
    });
  }
}

async function performReviewJob(student, job) {
  const composition = await ownedComposition(student, job.composition_id);
  if (composition.active_job_id !== job.job_id) return { status: "superseded" };
  const prepared = { ...reviewCandidate(composition), assessment_mode: job.review_mode, rubric_id: job.rubric_id || null };
  if (!reviewScopeMatches(job, composition, job.review_mode, job.rubric_id)) throw new Error("COMPOSITION_REVISION_CHANGED");
  if (!prepared.confirmed_text) throw new Error("MANUSCRIPT_REQUIRED");
  const rubric = job.review_mode === "standardized_content" ? getRubric(job.rubric_id) : null;
  if (rubric && !text(prepared.prompt_text, MAX_PROMPT_CHARS)) throw new Error("WRITING_PROMPT_REQUIRED");
  let review;
  if (job.review_mode === "standardized_content") {
    const modelResponse = await callStructuredModel({
      system: standardizedPrompt(rubric), schemaName: "standardized_writing_review_v1", schema: STANDARDIZED_SCHEMA,
      userText: `SELECTED_FRAMEWORK_ID: ${rubric.rubric_id}\nTASK_PROMPT_DATA:\n<task_prompt>${prepared.prompt_text}</task_prompt>\nSTUDENT_MANUSCRIPT_DATA:\n<student_manuscript>${prepared.confirmed_text}</student_manuscript>`,
    });
    review = { ...canonicalStandardizedResult(modelResponse.data, rubric), model_metadata: modelResponse.metadata };
  } else {
    const units = sentenceUnits(prepared.confirmed_text);
    if (!units.length) throw new Error("MANUSCRIPT_REQUIRED");
    const modelResponse = await callStructuredModel({
      system: languagePrompt(), schemaName: "language_sentence_review_v2", schema: LANGUAGE_SCHEMA,
      userText: `TASK_PROMPT_DATA (may be empty):\n<task_prompt>${prepared.prompt_text || ""}</task_prompt>\nSENTENCE_DATA_JSON:\n${JSON.stringify(units)}`,
    });
    review = { ...canonicalLanguageResult(modelResponse.data, units), model_metadata: modelResponse.metadata };
  }
  const now = new Date();
  const pendingReplacement = Boolean(composition.pending_replacement);
  const languageNeedsTraining = job.review_mode === "general_language"
    && Array.isArray(review.sentences)
    && review.sentences.some((sentence) => sentence.rewrite_required === true);
  const succeededJob = publicJobView({ ...job, status: "succeeded", finished_at: now });
  const update = {
    assessment_mode: job.review_mode,
    rubric_id: rubric ? rubric.rubric_id : null,
    standardized_rubric_id: rubric ? rubric.rubric_id : composition.standardized_rubric_id || null,
    standardized_review: job.review_mode === "standardized_content" ? review : composition.standardized_review || null,
    language_review: job.review_mode === "general_language" ? review : composition.language_review || null,
    rewrite_results: job.review_mode === "general_language" ? null : composition.rewrite_results || null,
    status: job.review_mode === "general_language" ? (languageNeedsTraining ? "sentence_training" : "completed") : "reviewed",
    prompt_version: PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
    rubric_version: rubric ? RUBRIC_VERSION : null,
    last_ai_review_at: now,
    active_job: succeededJob,
    updated_at: now,
  };
  if (pendingReplacement) {
    Object.assign(update, {
      prompt_text: prepared.prompt_text,
      confirmed_text: prepared.confirmed_text,
      word_count: prepared.word_count,
      revision: Number(prepared.revision || composition.revision || 1),
      pending_replacement: null,
      standardized_rubric_id: rubric ? rubric.rubric_id : null,
      standardized_review: job.review_mode === "standardized_content" ? review : null,
      language_review: job.review_mode === "general_language" ? review : null,
      rewrite_results: null,
      pending_revision_scan: null,
      scanned_rewrite_drafts: null,
      completed_at: job.review_mode === "general_language" && !languageNeedsTraining ? now : null,
    });
  }
  if (job.review_mode === "general_language" && !languageNeedsTraining) update.completed_at = now;
  let outcome = "lease_lost";
  let usageRow = null;
  await db.runTransaction(async (transaction) => {
    const compositionResult = await transaction.collection(COMPOSITIONS).where({
      composition_id: job.composition_id, student_uid: job.student_uid,
    }).limit(1).get();
    const jobResult = await transaction.collection(JOBS).where({ job_id: job.job_id }).limit(1).get();
    const usageResult = await transaction.collection(USAGE).where({ usage_id: job.usage_id, status: "reserved" }).limit(1).get();
    const current = compositionResult.data && compositionResult.data[0];
    const currentJob = jobResult.data && jobResult.data[0];
    usageRow = usageResult.data && usageResult.data[0];
    if (!currentJob || currentJob.status !== "processing" || !secretMatches(currentJob.lease_token, job.lease_token)) return;
    if (!current || current.active_job_id !== job.job_id || !reviewScopeMatches(job, current, job.review_mode, job.rubric_id)) {
      await transaction.collection(JOBS).doc(currentJob._id).update({
        status: "superseded", lease_token: null, lease_until: null, next_retry_at: null,
        finished_at: now, updated_at: now,
      });
      outcome = "superseded";
      return;
    }
    if (!usageRow) throw new Error("AI_USAGE_RESERVATION_LOST");
    const persistenceUpdate = { ...update };
    const currentCandidate = reviewCandidate(current);
    const currentTitleIsStudent = titleSource(current) === "student";
    const candidateTitleIsStudent = titleSource(currentCandidate) === "student";
    if (currentTitleIsStudent) {
      persistenceUpdate.title = normalizedTitle(current.title);
      persistenceUpdate.title_source = "student";
    } else if (candidateTitleIsStudent) {
      persistenceUpdate.title = normalizedTitle(currentCandidate.title);
      persistenceUpdate.title_source = "student";
    } else {
      persistenceUpdate.title = normalizedSuggestedTitle(review.suggested_title);
      persistenceUpdate.title_source = "ai";
    }
    await transaction.collection(COMPOSITIONS).doc(current._id).update(replaceWholeFields(persistenceUpdate, [
      "standardized_review", "language_review", "rewrite_results", "active_job",
    ]));
    await transaction.collection(JOBS).doc(currentJob._id).update({
      status: "succeeded", error_code: null, lease_token: null, lease_until: null,
      next_retry_at: null, finished_at: now, updated_at: now,
    });
    await transaction.collection(USAGE).doc(usageRow._id).update({ status: "succeeded", succeeded_at: now, updated_at: now });
    outcome = "succeeded";
  });
  if (outcome === "succeeded") {
    if (job.review_mode === "general_language") {
      try { await replaceObservations(student, prepared, review.profile_observations); }
      catch (error) { console.error("writingTutor profile observation update failed", error); }
    } else if (pendingReplacement) {
      try { await db.collection(OBSERVATIONS).where({ composition_id: composition.composition_id, student_uid: student.auth_uid }).remove(); }
      catch (error) { console.error("writingTutor stale observation cleanup failed", error); }
    }
    await enqueueReviewEmail(student, usageRow || { usage_id: job.usage_id }, prepared, job.review_mode);
  }
  return { status: outcome, review: outcome === "succeeded" ? review : null };
}

async function evaluate(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  const candidate = reviewCandidate(composition);
  if (!candidate.confirmed_text) throw new Error("MANUSCRIPT_REQUIRED");
  const mode = text(event.assessment_mode || candidate.assessment_mode, 80);
  if (!["general_language", "standardized_content"].includes(mode)) throw new Error("ASSESSMENT_MODE_REQUIRED");
  const prepared = { ...candidate, assessment_mode: mode };
  prepared.rubric_id = mode === "standardized_content" ? text(event.rubric_id || candidate.rubric_id, 120) : null;
  if (mode === "standardized_content") {
    getRubric(prepared.rubric_id);
    if (!text(prepared.prompt_text, MAX_PROMPT_CHARS)) throw new Error("WRITING_PROMPT_REQUIRED");
  }
  if (composition.active_job_id) {
    const active = await getOne(JOBS, { job_id: composition.active_job_id, student_uid: student.auth_uid });
    if (active && ["queued", "processing"].includes(active.status)
      && reviewScopeMatches(active, composition, mode, prepared.rubric_id)) {
      return { success: true, accepted: true, idempotent_replay: true, job: publicJobView(active), composition: compositionView(composition) };
    }
  }
  const reservation = await reserveUsage(student, prepared, event, mode);
  if (reservation.duplicate) {
    const latest = await ownedComposition(student, composition.composition_id);
    return { success: true, idempotent_replay: true, composition: compositionView(latest), review: mode === "standardized_content" ? latest.standardized_review : latest.language_review };
  }
  try {
    return await enqueueReviewJob(student, composition, prepared, event, mode, reservation.usage);
  } catch (error) {
    if (!reservation.reused) await releaseUsage(student, reservation.usage, error.message);
    throw error;
  }
}

function preparedRewriteItems(language, submitted) {
  if (!language || !Array.isArray(language.sentences)) throw new Error("LANGUAGE_REVIEW_REQUIRED");
  const expected = new Map(language.sentences
    .filter((item) => item.rewrite_required === true)
    .map((item) => [item.sentence_id, item]));
  const unique = new Map();
  for (const item of Array.isArray(submitted) ? submitted : []) {
    const sentenceId = text(item && item.sentence_id, 40);
    const rewriteText = text(item && item.text, 3000);
    if (expected.has(sentenceId) && rewriteText) unique.set(sentenceId, { sentence_id: sentenceId, text: rewriteText });
  }
  const items = Array.from(unique.values());
  if (!items.length) throw new Error("REWRITES_REQUIRED");
  return { items, expected };
}

function rewritePayloadHash(composition, items) {
  return stableId("rewrite_payload", composition.composition_id, String(Number(composition.revision || 1)), JSON.stringify(items));
}

function rewriteScopeMatches(job, composition, payloadHash) {
  return job && job.job_type === "rewrite"
    && Number(job.composition_revision || 1) === Number(composition.revision || 1)
    && job.payload_hash === payloadHash;
}

async function enqueueRewriteJob(student, composition, event, items) {
  const operationId = text(event.operation_id, 160);
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  const jobId = stableId("writing_job", student.auth_uid, operationId);
  const payloadHash = rewritePayloadHash(composition, items);
  const existing = await getOne(JOBS, { job_id: jobId, student_uid: student.auth_uid });
  if (existing) {
    if (existing.composition_id !== composition.composition_id || !rewriteScopeMatches(existing, composition, payloadHash)) {
      throw new Error("IDEMPOTENCY_KEY_REUSED");
    }
    const latest = await ownedComposition(student, composition.composition_id);
    if (existing.status === "succeeded"
      && latest.rewrite_results && latest.rewrite_results.operation_id === operationId) {
      return {
        success: true, accepted: false, idempotent_replay: true,
        results: latest.rewrite_results.results || [],
        overall_feedback: latest.rewrite_results.overall_feedback || "",
        passed: latest.rewrite_results.passed === true,
        job: publicJobView(existing), composition: compositionView(latest),
      };
    }
    if (["queued", "processing"].includes(existing.status)
      && latest.active_job_id === jobId
      && latest.pending_rewrite_check
      && latest.pending_rewrite_check.payload_hash === payloadHash) {
      if (existing.status === "queued") {
        try {
          await invokeFunctionAsync("writingTutor", {
            action: "processQueuedJob", job_id: jobId, dispatch_token: existing.dispatch_token,
          });
        } catch (error) {
          console.error("writingTutor rewrite replay dispatch deferred", jobId, error && error.message);
        }
      }
      return {
        success: true, accepted: true, idempotent_replay: true,
        job: publicJobView(existing), composition: compositionView(latest),
      };
    }
    return {
      success: true, accepted: false, idempotent_replay: true,
      job: publicJobView(existing), composition: compositionView(latest),
    };
  }
  const now = new Date();
  const job = {
    job_id: jobId,
    job_type: "rewrite",
    operation_id: operationId,
    dispatch_token: crypto.randomBytes(32).toString("hex"),
    student_uid: student.auth_uid,
    composition_id: composition.composition_id,
    composition_revision: Number(composition.revision || 1),
    payload_hash: payloadHash,
    sentence_ids: items.map((item) => item.sentence_id),
    prompt_bundle_version: PROMPT_BUNDLE_VERSION,
    status: "queued",
    attempt_count: 0,
    error_code: null,
    lease_token: null,
    lease_until: null,
    next_retry_at: now,
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null,
  };
  const pending = {
    operation_id: operationId,
    composition_revision: Number(composition.revision || 1),
    payload_hash: payloadHash,
    items,
    created_at: now,
  };
  const activeJob = publicJobView(job);
  try {
    await db.runTransaction(async (transaction) => {
      const compositionResult = await transaction.collection(COMPOSITIONS).where({
        composition_id: composition.composition_id, student_uid: student.auth_uid,
      }).limit(1).get();
      const current = compositionResult.data && compositionResult.data[0];
      if (!current) throw new Error("COMPOSITION_NOT_FOUND");
      if (Number(current.revision || 1) !== Number(job.composition_revision || 1)) {
        throw new Error("COMPOSITION_REVISION_CHANGED");
      }
      if (!current.language_review || !Array.isArray(current.language_review.sentences)) {
        throw new Error("LANGUAGE_REVIEW_REQUIRED");
      }
      if (current.active_job_id && current.active_job_id !== jobId) {
        const priorResult = await transaction.collection(JOBS).where({
          job_id: current.active_job_id, student_uid: student.auth_uid,
          composition_id: composition.composition_id,
        }).limit(1).get();
        const prior = priorResult.data && priorResult.data[0];
        if (prior && ["queued", "processing", "failed"].includes(prior.status)) {
          await transaction.collection(JOBS).doc(prior._id).update({
            status: "superseded", superseded_by_job_id: jobId,
            lease_token: null, lease_until: null, next_retry_at: null,
            finished_at: now, updated_at: now,
          });
        }
      }
      const created = await transaction.collection(JOBS).doc(jobId).create(job);
      if (created && created.code) throw created;
      await transaction.collection(COMPOSITIONS).doc(current._id).update(replaceWholeFields({
        pending_rewrite_check: pending,
        active_job_id: jobId,
        active_job: activeJob,
        status: "rewrite_queued",
        updated_at: now,
      }, ["pending_rewrite_check", "active_job"]));
    });
  } catch (error) {
    const raced = await getOne(JOBS, { job_id: jobId, student_uid: student.auth_uid });
    if (!raced || raced.composition_id !== composition.composition_id || !rewriteScopeMatches(raced, composition, payloadHash)) {
      throw error;
    }
    const latest = await ownedComposition(student, composition.composition_id);
    return {
      success: true, accepted: ["queued", "processing"].includes(raced.status), idempotent_replay: true,
      job: publicJobView(raced), composition: compositionView(latest),
    };
  }
  try {
    await invokeFunctionAsync("writingTutor", {
      action: "processQueuedJob", job_id: jobId, dispatch_token: job.dispatch_token,
    });
  } catch (error) {
    console.error("writingTutor rewrite async dispatch deferred", jobId, error && error.message);
  }
  return {
    success: true, accepted: true, job: activeJob,
    composition: compositionView({
      ...composition, pending_rewrite_check: pending,
      active_job_id: jobId, active_job: activeJob,
      status: "rewrite_queued", updated_at: now,
    }),
  };
}

async function performRewriteJob(student, job) {
  const composition = await ownedComposition(student, job.composition_id);
  if (composition.active_job_id !== job.job_id) return { status: "superseded" };
  const pending = composition.pending_rewrite_check;
  if (!pending || pending.operation_id !== job.operation_id
    || pending.payload_hash !== job.payload_hash
    || !rewriteScopeMatches(job, composition, pending.payload_hash)) {
    throw new Error("REWRITE_CHECK_SUPERSEDED");
  }
  const language = composition.language_review;
  const prepared = preparedRewriteItems(language, pending.items);
  if (rewritePayloadHash(composition, prepared.items) !== job.payload_hash) throw new Error("REWRITE_CHECK_SUPERSEDED");
  const coaching = prepared.items.map((item) => {
    const source = prepared.expected.get(item.sentence_id);
    return {
      sentence_id: item.sentence_id, original: source.original, issues: source.issues,
      coaching_summary: source.coaching_summary, reference_revision: source.reference_revision,
      student_rewrite: item.text,
    };
  });
  const checkedResponse = await callStructuredModel({
    system: rewritePrompt(), schemaName: "student_rewrite_check_v1", schema: REWRITE_SCHEMA,
    userText: `COACHING_AND_STUDENT_REWRITE_DATA_JSON:\n${JSON.stringify(coaching)}`,
  });
  const checked = checkedResponse.data;
  const enrichedResults = canonicalRewriteResults(Array.isArray(checked.results) ? checked.results : [], prepared.items);
  const previousRecord = composition.rewrite_results || {};
  const previous = Array.isArray(previousRecord.results) ? previousRecord.results : [];
  const merged = new Map(previous.map((item) => [item.sentence_id, item]));
  enrichedResults.forEach((item) => merged.set(item.sentence_id, item));
  const allRequired = language.sentences.filter((item) => item.rewrite_required).map((item) => item.sentence_id);
  const passed = allRequired.every((id) => merged.get(id) && merged.get(id).accepted === true);
  const now = new Date();
  const feedbackHistory = appendRewriteFeedbackHistory(previousRecord, {
    operation_id: job.operation_id,
    overall_feedback: checked.overall_feedback,
    results: enrichedResults,
    prompt_version: PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
    model_metadata: checkedResponse.metadata,
    checked_at: now,
  });
  const record = {
    result_id: stableId("rewrite_check", student.auth_uid, job.operation_id),
    operation_id: job.operation_id,
    results: Array.from(merged.values()),
    overall_feedback: checked.overall_feedback,
    check_round: feedbackHistory.round,
    feedback_history: feedbackHistory.history,
    passed,
    prompt_version: PROMPT_VERSION,
    schema_version: SCHEMA_VERSION,
    model_metadata: checkedResponse.metadata,
    checked_at: now,
  };
  const succeededJob = publicJobView({ ...job, status: "succeeded", finished_at: now });
  let outcome = "lease_lost";
  await db.runTransaction(async (transaction) => {
    const compositionResult = await transaction.collection(COMPOSITIONS).where({
      composition_id: job.composition_id, student_uid: job.student_uid,
    }).limit(1).get();
    const jobResult = await transaction.collection(JOBS).where({ job_id: job.job_id }).limit(1).get();
    const current = compositionResult.data && compositionResult.data[0];
    const currentJob = jobResult.data && jobResult.data[0];
    if (!currentJob || currentJob.status !== "processing"
      || !secretMatches(currentJob.lease_token, job.lease_token)) return;
    const currentPending = current && current.pending_rewrite_check;
    if (!current || current.active_job_id !== job.job_id
      || Number(current.revision || 1) !== Number(job.composition_revision || 1)
      || !currentPending || currentPending.operation_id !== job.operation_id
      || currentPending.payload_hash !== job.payload_hash) {
      await transaction.collection(JOBS).doc(currentJob._id).update({
        status: "superseded", lease_token: null, lease_until: null, next_retry_at: null,
        finished_at: now, updated_at: now,
      });
      outcome = "superseded";
      return;
    }
    await transaction.collection(COMPOSITIONS).doc(current._id).update(replaceWholeFields({
      rewrite_results: record,
      pending_rewrite_check: null,
      active_job: succeededJob,
      status: passed ? "completed" : "sentence_training",
      completed_at: passed ? now : null,
      updated_at: now,
    }, ["rewrite_results", "pending_rewrite_check", "active_job"]));
    await transaction.collection(JOBS).doc(currentJob._id).update({
      status: "succeeded", error_code: null, lease_token: null, lease_until: null,
      next_retry_at: null, finished_at: now, updated_at: now,
    });
    outcome = "succeeded";
  });
  return { status: outcome, results: outcome === "succeeded" ? enrichedResults : null };
}

async function submitRewrites(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  const prepared = preparedRewriteItems(composition.language_review, event.items);
  const operationId = text(event.operation_id, 160);
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  if (composition.rewrite_results && composition.rewrite_results.operation_id === operationId) {
    return {
      success: true, accepted: false, idempotent_replay: true,
      results: composition.rewrite_results.results || [],
      overall_feedback: composition.rewrite_results.overall_feedback || "",
      passed: composition.rewrite_results.passed === true,
      composition: compositionView(composition),
    };
  }
  return await enqueueRewriteJob(student, composition, event, prepared.items);
}

function revisionImportError(code, details) {
  const error = new Error(code);
  if (details) error.details = details;
  return error;
}

async function confirmRevisionScanImport(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  const revision = Number(event.revision);
  const operationId = text(event.operation_id, 160);
  if (!Number.isInteger(revision) || revision < 1) throw new Error("COMPOSITION_REVISION_REQUIRED");
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  const priorDrafts = Array.isArray(composition.scanned_rewrite_drafts) ? composition.scanned_rewrite_drafts : [];
  if (!composition.pending_revision_scan && priorDrafts.some((item) => item && item.operation_id === operationId)) {
    return { success: true, accepted: false, idempotent_replay: true, composition: compositionView(composition) };
  }
  const pending = composition.pending_revision_scan;
  if (!pending || pending.operation_id !== operationId) throw new Error("REVISION_SCAN_NOT_PENDING");
  if (Number(pending.composition_revision || 1) !== revision || Number(composition.revision || 1) !== revision) {
    throw new Error("COMPOSITION_REVISION_CHANGED");
  }
  const required = new Set(revisionRequiredUnits(composition).map((item) => item.sentence_id));
  const submitted = Array.isArray(event.items) ? event.items : [];
  if (submitted.length > Math.min(required.size, 200)) throw new Error("REVISION_SCAN_IMPORT_INVALID");
  const seen = new Set();
  const invalid = [];
  const items = submitted.map((item, index) => {
    const sentenceId = text(item && item.sentence_id, 40);
    const rewriteText = text(item && item.text, 3000);
    let issue = null;
    if (!item || typeof item !== "object" || Array.isArray(item)) issue = "ITEM_INVALID";
    else if (typeof item.sentence_id !== "string") issue = "SENTENCE_ID_INVALID";
    else if (typeof item.text !== "string") issue = "REWRITE_TEXT_INVALID";
    else if (!sentenceId) issue = "SENTENCE_ID_REQUIRED";
    else if (!required.has(sentenceId)) issue = "SENTENCE_NOT_REWRITE_REQUIRED";
    else if (seen.has(sentenceId)) issue = "DUPLICATE_SENTENCE_ID";
    else if (!rewriteText) issue = "REWRITE_TEXT_REQUIRED";
    if (issue) invalid.push({ index, sentence_id: sentenceId || null, code: issue });
    if (sentenceId) seen.add(sentenceId);
    return { sentence_id: sentenceId, text: rewriteText };
  });
  if (invalid.length) throw revisionImportError("REVISION_SCAN_IMPORT_INVALID", { invalid_items: invalid });
  const now = new Date();
  const merged = new Map(priorDrafts.filter((item) => item && required.has(item.sentence_id)).map((item) => [item.sentence_id, item]));
  items.forEach((item) => merged.set(item.sentence_id, { ...item, operation_id: operationId, imported_at: now }));
  const drafts = Array.from(merged.values());
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection(COMPOSITIONS).where({ composition_id: composition.composition_id, student_uid: student.auth_uid }).limit(1).get();
    const current = result.data && result.data[0];
    if (!current) throw new Error("COMPOSITION_NOT_FOUND");
    const currentPending = current.pending_revision_scan;
    if (!currentPending && Array.isArray(current.scanned_rewrite_drafts)
      && current.scanned_rewrite_drafts.some((item) => item && item.operation_id === operationId)) return;
    if (!currentPending || currentPending.operation_id !== operationId
      || Number(currentPending.composition_revision || 1) !== revision
      || Number(current.revision || 1) !== revision) throw new Error("COMPOSITION_REVISION_CHANGED");
    await transaction.collection(COMPOSITIONS).doc(current._id).update(replaceWholeFields({
      scanned_rewrite_drafts: drafts, pending_revision_scan: null,
      status: "sentence_training", updated_at: now,
    }, ["scanned_rewrite_drafts", "pending_revision_scan"]));
  });
  const latest = await ownedComposition(student, composition.composition_id);
  return { success: true, accepted: true, operation_id: operationId, composition: compositionView(latest) };
}

async function getProfile(student) {
  const rowsResult = await db.collection(OBSERVATIONS).where({ student_uid: student.auth_uid }).limit(500).get();
  const rows = rowsResult.data || [];
  const grouped = new Map();
  for (const row of rows) {
    const category = text(row.category, 120) || "Other";
    const current = grouped.get(category) || { category, count: 0, recent_observations: [] };
    current.count += 1;
    if (current.recent_observations.length < 5) current.recent_observations.push(row.observation);
    grouped.set(category, current);
  }
  const dayKey = shanghaiDayKey();
  const used = text(student.writing_ai_usage_day, 20) === dayKey ? Number(student.writing_ai_words_used_today || 0) : 0;
  return {
    success: true,
    profile: Array.from(grouped.values()).sort((a, b) => b.count - a.count),
    quota: { day_key: dayKey, daily_word_limit: dailyLimit(student), words_used_today: used, words_remaining: Math.max(0, dailyLimit(student) - used) },
    rubrics: publicRubrics(),
  };
}

function friendlyMessage(code) {
  const messages = {
    AUTH_REQUIRED: "Please sign in first.", STUDENT_NOT_LINKED: "This student account is not linked.",
    COMPOSITION_NOT_FOUND: "This writing record could not be found.", COMPOSITION_READ_ONLY: "Completed writing is read-only. Use it as a new composition to continue.",
    COMPOSITION_NOT_DRAFT: "This writing has already entered review and can no longer be discarded as a draft.",
    TITLE_REQUIRED: "Please enter a title.",
    MANUSCRIPT_REQUIRED: "Please confirm your writing first.", WRITING_PROMPT_REQUIRED: "A task prompt is required for standardized assessment.",
    RUBRIC_REQUIRED: "Choose an assessment framework.", RUBRIC_NOT_AVAILABLE: "This assessment framework is not available yet.",
    WRITING_AI_DAILY_LIMIT_REACHED: "Today's AI writing word limit has been reached. Ask your teacher to adjust it if needed.",
    WRITING_AI_NOT_CONFIGURED: "AI writing review is not configured yet.", AI_OPERATION_IN_PROGRESS: "This review is already being processed.",
    IDEMPOTENCY_KEY_REUSED: "This request identifier has already been used for another writing operation. Please try again.",
    REVISION_SCAN_NO_REQUIRED_SENTENCES: "There are no sentences currently waiting for a rewrite.",
    REVISION_SCAN_NOT_PENDING: "This handwriting scan is no longer waiting to be imported. Refresh the writing record and try again.",
    REVISION_SCAN_IMPORT_INVALID: "One or more scanned rewrites are invalid or no longer match the current review. Please check the highlighted rows.",
    WRITING_AI_REVISION_SCAN_EMPTY: "No readable rewrite candidates were found in those photos. Please try clearer photos.",
    WRITING_AI_REVISION_SCAN_TOO_LARGE: "Too many rewrite candidates were found in one scan. Please photograph fewer answers at a time.",
    COMPOSITION_REVISION_REQUIRED: "This rewrite scan is from an outdated writing revision. Refresh and scan again.",
    PROMPT_OCR_NOT_PENDING: "This writing prompt scan is no longer waiting for confirmation.",
  };
  return messages[code] || "The AI writing request could not be completed. Please try again.";
}

exports.main = async (event = {}) => {
  try {
    const action = text(event.action, 80);
    if (action === "processQueuedJob") return await processQueuedJob(event);
    const student = await authenticatedStudent();
    await retryPrivatePhotoCleanup(student);
    if (action === "createComposition") return await createComposition(student, event);
    if (action === "listCompositions") return await listCompositions(student);
    if (action === "discardEmptyComposition") return await discardEmptyComposition(student, event);
    if (action === "discardDraftComposition") return await discardDraftComposition(student, event);
    if (action === "getComposition") return await getComposition(student, event);
    if (action === "startPhotoUpload") return await startPhotoUpload(student, event);
    if (action === "finishPhotoUpload") return await finishPhotoUpload(student, event);
    if (action === "startRevisionScanUpload") return await startRevisionScanUpload(student, event);
    if (action === "finishRevisionScanUpload") return await finishRevisionScanUpload(student, event);
    if (action === "extractOcr") return await extractOcr(student, event);
    if (action === "saveSourceDraft") return await saveSourceDraft(student, event);
    if (action === "adoptPromptOcr") return await adoptPromptOcr(student, event);
    if (action === "saveDraft") return await saveDraft(student, event);
    if (action === "updateCompositionTitle") return await updateCompositionTitle(student, event);
    if (action === "evaluate") return await evaluate(student, event);
    if (action === "submitRewrites") return await submitRewrites(student, event);
    if (action === "confirmRevisionScanImport") return await confirmRevisionScanImport(student, event);
    if (action === "getProfile") return await getProfile(student);
    throw new Error("UNKNOWN_ACTION");
  } catch (error) {
    const code = error && error.message || "WRITING_TUTOR_ERROR";
    console.error("writingTutor failed", code, error);
    return { success: false, code, message: friendlyMessage(code), ...(error && error.details ? { details: error.details } : {}) };
  }
};

exports._test = {
  wordCount, sentenceUnits, shanghaiDayKey, dailyLimit, canonicalLanguageResult,
  canonicalStandardizedResult, canonicalRewriteResults, rewriteFeedbackHistory, appendRewriteFeedbackHistory,
  canonicalRevisionScanResult, revisionSourceUnits, canonicalOcrUncertaintyRegions, hasOcrLocationLeaseBudget, roundedToStep,
  usageMatchesScope, replaceWholeFields, PROMPT_BUNDLE_VERSION,
  isDiscardableEmptyComposition,
  collections: { COMPOSITIONS, UPLOADS, OBSERVATIONS, USAGE, EMAIL_EVENTS, JOBS },
};
