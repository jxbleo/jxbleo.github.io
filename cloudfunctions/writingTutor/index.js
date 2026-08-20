"use strict";

const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");
const tcbApiCaller = require("@cloudbase/node-sdk/dist/utils/tcbapirequester");
const { CloudBase } = require("@cloudbase/node-sdk/dist/cloudbase");
const { RUBRIC_VERSION, getRubric, publicRubrics } = require("./rubrics");
const { SCHEMA_VERSION, OCR_SCHEMA, STANDARDIZED_SCHEMA, LANGUAGE_SCHEMA, REWRITE_SCHEMA } = require("./schemas");
const { PROMPT_VERSION, ocrPrompt, standardizedPrompt, languagePrompt, rewritePrompt } = require("./prompts");
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
const MAX_UPLOAD_PAGES = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const INCOMPLETE_UPLOAD_TTL_MS = 30 * 60 * 1000;
const CONFIRMED_UPLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const JOB_LEASE_MS = 6 * 60 * 1000;
const MAX_JOB_ATTEMPTS = 3;
const PROMPT_BUNDLE_VERSION = `${PROMPT_VERSION}|${SCHEMA_VERSION}|${RUBRIC_VERSION}`;

function text(value, limit = 30000) {
  return String(value == null ? "" : value).trim().slice(0, limit);
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function stableId(prefix, ...parts) {
  const digest = crypto.createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 40);
  return `${prefix}_${digest}`;
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
    title: composition.title || "Untitled writing",
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

function publicJobView(job) {
  if (!job || typeof job !== "object") return null;
  return {
    job_id: job.job_id || null,
    operation_id: job.operation_id || null,
    job_type: job.job_type || null,
    status: job.status || null,
    error_code: job.error_code || null,
    attempt_count: Number(job.attempt_count || 0),
    created_at: job.created_at || null,
    started_at: job.started_at || null,
    finished_at: job.finished_at || null,
  };
}

function compositionView(composition) {
  const activeJob = publicJobView(composition.active_job || composition.ocr_job);
  const pendingUpload = composition.pending_upload && typeof composition.pending_upload === "object"
    ? {
      status: composition.pending_upload.status || "uploading",
      created_at: composition.pending_upload.created_at || null,
      page_count: Array.isArray(composition.pending_upload.photo_ids)
        ? composition.pending_upload.photo_ids.length : 0,
    }
    : null;
  return {
    ...summaryView(composition),
    confirmed_text: composition.confirmed_text || "",
    pending_ocr: composition.pending_ocr || null,
    standardized_review: composition.standardized_review || null,
    language_review: composition.language_review || null,
    rewrite_results: composition.rewrite_results || null,
    replacement_pending: Boolean(composition.pending_replacement),
    pending_upload: pendingUpload,
    active_job: activeJob,
    ocr_job: activeJob && activeJob.job_type === "ocr" ? activeJob : null,
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
  const composition = {
    composition_id: randomId("composition"),
    student_uid: student.auth_uid,
    title: text(event.title, 160) || "Untitled writing",
    prompt_text: text(event.prompt_text, MAX_PROMPT_CHARS),
    confirmed_text: text(event.confirmed_text, MAX_COMPOSITION_CHARS),
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
  return { success: true, compositions: rows.map(summaryView), rubrics: publicRubrics() };
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
    if (job && Array.isArray(job.photo_ids)) photoIds = job.photo_ids.slice(0, MAX_UPLOAD_PAGES);
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
  if (composition.pending_upload && !composition.pending_ocr) {
    try {
      await finishPhotoUpload(student, {
        composition_id: composition.composition_id,
        operation_id: composition.pending_upload.operation_id,
        photo_ids: composition.pending_upload.photo_ids,
        replace_current: composition.pending_upload.replace_current === true,
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
  if (!pages.length || pages.length > MAX_UPLOAD_PAGES) throw new Error("PHOTO_PAGE_COUNT_INVALID");
  const existingJob = await getOne(JOBS, {
    job_id: stableId("writing_job", student.auth_uid, operationId),
    student_uid: student.auth_uid,
  });
  if (existingJob) {
    if (existingJob.composition_id !== composition.composition_id || existingJob.job_type !== "ocr") {
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
  await db.collection(COMPOSITIONS).doc(composition._id).update({
    pending_upload: {
      operation_id: operationId,
      photo_ids: uploads.map((upload) => upload.photo_id),
      replace_current: event.replace_current === true,
      status: "uploading",
      created_at: now,
    },
    status: "photo_uploading",
    updated_at: now,
  });
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
  if (!photoIds.length) throw new Error("PHOTO_UPLOAD_REQUIRED");
  const rows = await photoRows(student, composition.composition_id, photoIds);
  if (rows.some((row) => row.operation_id !== operationId)) throw new Error("UPLOAD_BATCH_SUPERSEDED");
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
  return await enqueueOcrJob(student, { ...event, operation_id: operationId, photo_ids: photoIds });
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
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  const jobId = stableId("writing_job", student.auth_uid, operationId);
  const existing = await getOne(JOBS, { job_id: jobId, student_uid: student.auth_uid });
  if (existing) {
    if (existing.composition_id !== composition.composition_id || existing.job_type !== "ocr") {
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
    if (!raced || raced.composition_id !== composition.composition_id || raced.job_type !== "ocr") {
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
  const ocrResponse = await callStructuredModel({
    system: ocrPrompt(),
    userText: "Transcribe the attached composition pages in page order. Return only the required structured result.",
    schemaName: "writing_ocr_v1", schema: OCR_SCHEMA, images: imageUrls, vision: true,
  });
  const ocr = ocrResponse.data;
  const fullText = text(ocr.full_text, MAX_COMPOSITION_CHARS);
  const paragraphs = Array.isArray(ocr.paragraphs)
    ? ocr.paragraphs.map((item) => text(item, MAX_COMPOSITION_CHARS)).filter(Boolean)
    : [];
  if (!fullText && !paragraphs.length) throw new Error("WRITING_AI_OCR_EMPTY");
  const pendingOcr = {
    full_text: fullText || paragraphs.join("\n\n"),
    paragraphs,
    uncertain_spans: Array.isArray(ocr.uncertain_spans) ? ocr.uncertain_spans.slice(0, 100) : [],
    photo_ids: photoIds,
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
          status: current.job_type === "ocr" ? "ocr_failed" : composition.status,
          updated_at: now,
        });
      }
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
      status: job.job_type === "ocr" ? "ocr_processing" : composition.status,
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
        status: status === "queued" ? "ocr_queued" : "ocr_failed",
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
  if (!await publishProcessingJob(claimed)) return { success: true, status: "superseded" };
  try {
    const students = await db.collection("students").where({
      auth_uid: claimed.student_uid, active: true, role: "student",
    }).limit(1).get();
    const student = students.data && students.data[0];
    if (!student) throw new Error("STUDENT_NOT_LINKED");
    const result = claimed.job_type === "ocr"
      ? await performOcrJob(student, claimed)
      : (() => { throw new Error("AI_JOB_TYPE_INVALID"); })();
    return { success: result.status === "succeeded", status: result.status };
  } catch (error) {
    const code = error && error.message || "WRITING_TUTOR_ERROR";
    const outcome = await finishFailedJobAttempt(claimed, code);
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
  const draft = {
    title: text(event.title, 160) || composition.title || "Untitled writing",
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
    const stagedUpdate = { pending_replacement: pendingReplacement, pending_ocr: null, updated_at: now };
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
    throw new Error(existing.status === "reserved" ? "AI_OPERATION_IN_PROGRESS" : "AI_OPERATION_ALREADY_FAILED");
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

async function releaseUsage(student, usage, code) {
  if (!usage || !usage.usage_id) return;
  const row = await getOne(USAGE, { usage_id: usage.usage_id, student_uid: student.auth_uid });
  if (!row || row.status !== "reserved") return;
  await db.runTransaction(async (transaction) => {
    const result = await transaction.collection("students").where({ auth_uid: student.auth_uid, active: true }).limit(1).get();
    const current = result.data && result.data[0];
    if (current && text(current.writing_ai_usage_day, 20) === row.day_key) {
      await transaction.collection("students").doc(current._id).update({
        writing_ai_words_used_today: Math.max(0, Number(current.writing_ai_words_used_today || 0) - Number(row.word_count || 0)),
        updated_at: new Date(),
      });
    }
  });
  await db.collection(USAGE).doc(row._id).update({ status: "failed", failure_code: text(code, 120), released_at: new Date(), updated_at: new Date() });
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
  const expected = new Map(units.map((unit) => [unit.sentence_id, unit.original]));
  const received = Array.isArray(result.sentences) ? result.sentences : [];
  if (received.length !== units.length) throw new Error("WRITING_AI_SENTENCE_ALIGNMENT_FAILED");
  const seen = new Set();
  for (const item of received) {
    if (!expected.has(item.sentence_id) || seen.has(item.sentence_id)) throw new Error("WRITING_AI_SENTENCE_ALIGNMENT_FAILED");
    if (item.original !== expected.get(item.sentence_id)) throw new Error("WRITING_AI_SENTENCE_ALIGNMENT_FAILED");
    seen.add(item.sentence_id);
  }
}

function canonicalLanguageResult(result, units) {
  validateLanguageResult(result, units);
  return {
    ...result,
    sentences: result.sentences.map((item) => ({
      ...item,
      rewrite_required: item.status !== "effective",
    })),
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
  return {
    ...result,
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

async function evaluate(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  const pendingReplacement = composition.pending_replacement || null;
  const candidate = pendingReplacement ? { ...composition, ...pendingReplacement } : composition;
  if (!candidate.confirmed_text) throw new Error("MANUSCRIPT_REQUIRED");
  const mode = text(event.assessment_mode || candidate.assessment_mode, 80);
  if (!["general_language", "standardized_content"].includes(mode)) throw new Error("ASSESSMENT_MODE_REQUIRED");
  const prepared = { ...candidate, assessment_mode: mode };
  if (mode === "standardized_content") prepared.rubric_id = text(event.rubric_id || candidate.rubric_id, 120);
  else prepared.rubric_id = null;
  const rubric = mode === "standardized_content" ? getRubric(prepared.rubric_id) : null;
  if (mode === "standardized_content" && !text(prepared.prompt_text, MAX_PROMPT_CHARS)) throw new Error("WRITING_PROMPT_REQUIRED");
  const reservation = await reserveUsage(student, prepared, event, mode);
  if (reservation.duplicate) {
    const latest = await ownedComposition(student, composition.composition_id);
    return { success: true, idempotent_replay: true, composition: compositionView(latest), review: mode === "standardized_content" ? latest.standardized_review : latest.language_review };
  }
  try {
    let review;
    if (mode === "standardized_content") {
      const modelResponse = await callStructuredModel({
        system: standardizedPrompt(rubric), schemaName: "standardized_writing_review_v1", schema: STANDARDIZED_SCHEMA,
        userText: `SELECTED_FRAMEWORK_ID: ${rubric.rubric_id}\nTASK_PROMPT_DATA:\n<task_prompt>${prepared.prompt_text}</task_prompt>\nSTUDENT_MANUSCRIPT_DATA:\n<student_manuscript>${prepared.confirmed_text}</student_manuscript>`,
      });
      review = { ...canonicalStandardizedResult(modelResponse.data, rubric), model_metadata: modelResponse.metadata };
    } else {
      const units = sentenceUnits(prepared.confirmed_text);
      if (!units.length) throw new Error("MANUSCRIPT_REQUIRED");
      const modelResponse = await callStructuredModel({
        system: languagePrompt(), schemaName: "language_sentence_review_v1", schema: LANGUAGE_SCHEMA,
        userText: `TASK_PROMPT_DATA (may be empty):\n<task_prompt>${prepared.prompt_text || ""}</task_prompt>\nSENTENCE_DATA_JSON:\n${JSON.stringify(units)}`,
      });
      review = { ...canonicalLanguageResult(modelResponse.data, units), model_metadata: modelResponse.metadata };
    }
    const now = new Date();
    const languageNeedsTraining = mode === "general_language"
      && Array.isArray(review.sentences)
      && review.sentences.some((sentence) => sentence.rewrite_required === true);
    const update = {
      assessment_mode: mode, rubric_id: rubric ? rubric.rubric_id : null,
      standardized_rubric_id: rubric ? rubric.rubric_id : composition.standardized_rubric_id || null,
      standardized_review: mode === "standardized_content" ? review : composition.standardized_review || null,
      language_review: mode === "general_language" ? review : composition.language_review || null,
      rewrite_results: mode === "general_language" ? null : composition.rewrite_results || null,
      status: mode === "general_language" ? (languageNeedsTraining ? "sentence_training" : "completed") : "reviewed",
      prompt_version: PROMPT_VERSION, schema_version: SCHEMA_VERSION,
      rubric_version: rubric ? RUBRIC_VERSION : null, last_ai_review_at: now, updated_at: now,
    };
    if (pendingReplacement) {
      Object.assign(update, {
        title: prepared.title,
        prompt_text: prepared.prompt_text,
        confirmed_text: prepared.confirmed_text,
        word_count: prepared.word_count,
        revision: Number(prepared.revision || composition.revision || 1),
        pending_replacement: null,
        standardized_rubric_id: rubric ? rubric.rubric_id : null,
        standardized_review: mode === "standardized_content" ? review : null,
        language_review: mode === "general_language" ? review : null,
        rewrite_results: null,
        completed_at: mode === "general_language" && !languageNeedsTraining ? now : null,
      });
    }
    if (mode === "general_language" && !languageNeedsTraining) update.completed_at = now;
    await commitReviewAndUsage(composition, reservation.usage, update);
    if (mode === "general_language") {
      try {
        await replaceObservations(student, prepared, review.profile_observations);
      } catch (observationError) {
        console.error("writingTutor profile observation update failed", observationError);
      }
    } else if (pendingReplacement) {
      try {
        await db.collection(OBSERVATIONS).where({
          composition_id: composition.composition_id, student_uid: student.auth_uid,
        }).remove();
      } catch (observationError) {
        console.error("writingTutor stale observation cleanup failed", observationError);
      }
    }
    await enqueueReviewEmail(student, reservation.usage, prepared, mode);
    return { success: true, composition: compositionView({ ...prepared, ...update }), review };
  } catch (error) {
    await releaseUsage(student, reservation.usage, error.message);
    throw error;
  }
}

async function submitRewrites(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  const language = composition.language_review;
  if (!language || !Array.isArray(language.sentences)) throw new Error("LANGUAGE_REVIEW_REQUIRED");
  const submitted = Array.isArray(event.items) ? event.items : [];
  const expected = new Map(language.sentences.map((item) => [item.sentence_id, item]));
  const items = submitted.map((item) => ({ sentence_id: text(item.sentence_id, 40), text: text(item.text, 3000) }))
    .filter((item) => expected.has(item.sentence_id) && item.text);
  if (!items.length) throw new Error("REWRITES_REQUIRED");
  const operationId = text(event.operation_id, 160);
  if (!operationId) throw new Error("OPERATION_ID_REQUIRED");
  const resultId = stableId("rewrite_check", student.auth_uid, operationId);
  if (composition.rewrite_results && composition.rewrite_results.operation_id === operationId) {
    return { success: true, idempotent_replay: true, results: composition.rewrite_results.results, overall_feedback: composition.rewrite_results.overall_feedback };
  }
  const coaching = items.map((item) => {
    const source = expected.get(item.sentence_id);
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
  const results = Array.isArray(checked.results) ? checked.results : [];
  const enrichedResults = canonicalRewriteResults(results, items);
  const allRequired = language.sentences.filter((item) => item.rewrite_required).map((item) => item.sentence_id);
  const previous = composition.rewrite_results && Array.isArray(composition.rewrite_results.results) ? composition.rewrite_results.results : [];
  const merged = new Map(previous.map((item) => [item.sentence_id, item]));
  enrichedResults.forEach((item) => merged.set(item.sentence_id, item));
  const passed = allRequired.every((id) => merged.get(id) && merged.get(id).accepted === true);
  const record = {
    result_id: resultId, operation_id: operationId, results: Array.from(merged.values()),
    overall_feedback: checked.overall_feedback, passed,
    prompt_version: PROMPT_VERSION, schema_version: SCHEMA_VERSION,
    model_metadata: checkedResponse.metadata, checked_at: new Date(),
  };
  const update = { rewrite_results: record, status: passed ? "completed" : "sentence_training", updated_at: new Date() };
  if (passed) update.completed_at = new Date();
  await db.collection(COMPOSITIONS).doc(composition._id).update(update);
  return { success: true, results: enrichedResults, overall_feedback: checked.overall_feedback, passed };
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
    MANUSCRIPT_REQUIRED: "Please confirm your writing first.", WRITING_PROMPT_REQUIRED: "A task prompt is required for standardized assessment.",
    RUBRIC_REQUIRED: "Choose an assessment framework.", RUBRIC_NOT_AVAILABLE: "This assessment framework is not available yet.",
    WRITING_AI_DAILY_LIMIT_REACHED: "Today's AI writing word limit has been reached. Ask your teacher to adjust it if needed.",
    WRITING_AI_NOT_CONFIGURED: "AI writing review is not configured yet.", AI_OPERATION_IN_PROGRESS: "This review is already being processed.",
    IDEMPOTENCY_KEY_REUSED: "This request identifier has already been used for another writing operation. Please try again.",
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
    if (action === "getComposition") return await getComposition(student, event);
    if (action === "startPhotoUpload") return await startPhotoUpload(student, event);
    if (action === "finishPhotoUpload") return await finishPhotoUpload(student, event);
    if (action === "extractOcr") return await extractOcr(student, event);
    if (action === "saveDraft") return await saveDraft(student, event);
    if (action === "evaluate") return await evaluate(student, event);
    if (action === "submitRewrites") return await submitRewrites(student, event);
    if (action === "getProfile") return await getProfile(student);
    throw new Error("UNKNOWN_ACTION");
  } catch (error) {
    const code = error && error.message || "WRITING_TUTOR_ERROR";
    console.error("writingTutor failed", code, error);
    return { success: false, code, message: friendlyMessage(code) };
  }
};

exports._test = {
  wordCount, sentenceUnits, shanghaiDayKey, dailyLimit, canonicalLanguageResult,
  canonicalStandardizedResult, canonicalRewriteResults, roundedToStep,
  usageMatchesScope, PROMPT_BUNDLE_VERSION,
  collections: { COMPOSITIONS, UPLOADS, OBSERVATIONS, USAGE, EMAIL_EVENTS },
};
