"use strict";

const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");
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
const DEFAULT_DAILY_WORD_LIMIT = 5000;
const MAX_COMPOSITION_CHARS = 30000;
const MAX_PROMPT_CHARS = 10000;
const MAX_UPLOAD_PAGES = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UPLOAD_TTL_MS = 30 * 60 * 1000;
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

function compositionView(composition) {
  return {
    ...summaryView(composition),
    confirmed_text: composition.confirmed_text || "",
    pending_ocr: composition.pending_ocr || null,
    standardized_review: composition.standardized_review || null,
    language_review: composition.language_review || null,
    rewrite_results: composition.rewrite_results || null,
    replacement_pending: Boolean(composition.pending_replacement),
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

async function getComposition(student, event) {
  return { success: true, composition: compositionView(await ownedComposition(student, event.composition_id)), rubrics: publicRubrics() };
}

async function startPhotoUpload(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  if (composition.status === "completed") throw new Error("COMPOSITION_READ_ONLY");
  const pages = Array.isArray(event.pages) ? event.pages : [];
  if (!pages.length || pages.length > MAX_UPLOAD_PAGES) throw new Error("PHOTO_PAGE_COUNT_INVALID");
  const now = new Date();
  const uploads = [];
  for (let index = 0; index < pages.length; index += 1) {
    const mimeType = text(pages[index].mime_type, 80).toLowerCase();
    const extension = imageExtension(mimeType);
    const sizeBytes = Number(pages[index].size_bytes || 0);
    if (!extension || !Number.isFinite(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_IMAGE_BYTES) {
      throw new Error("PHOTO_FILE_INVALID");
    }
    const photoId = randomId("writing_photo");
    const cloudPath = `writing-tutor/${student.auth_uid}/${composition.composition_id}/${photoId}.${extension}`;
    const metadata = await app.getUploadMetadata({ cloudPath });
    const view = uploadMetadataView(metadata, cloudPath);
    await db.collection(UPLOADS).add({
      photo_id: photoId, composition_id: composition.composition_id, student_uid: student.auth_uid,
      status: "uploading", page_index: index, file_id: view.file_id, cloud_path: cloudPath,
      original_name: text(pages[index].file_name, 160), mime_type: mimeType,
      expected_size_bytes: sizeBytes, replace_current: event.replace_current === true,
      expires_at: new Date(now.getTime() + UPLOAD_TTL_MS), created_at: now, updated_at: now,
    });
    uploads.push({ photo_id: photoId, ...view });
  }
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
  const photoIds = Array.isArray(event.photo_ids) ? event.photo_ids.slice(0, MAX_UPLOAD_PAGES) : [];
  if (!photoIds.length) throw new Error("PHOTO_UPLOAD_REQUIRED");
  const rows = await photoRows(student, composition.composition_id, photoIds);
  const info = await app.getFileInfo({ fileList: rows.map((row) => row.file_id) });
  const fileMap = new Map((info.fileList || []).map((file) => [file.fileID, file]));
  for (const row of rows) {
    const file = fileMap.get(row.file_id);
    if (!file || Number(file.size || 0) < 1 || Number(file.size || 0) > MAX_IMAGE_BYTES) {
      throw new Error("PHOTO_UPLOAD_INVALID");
    }
    await db.collection(UPLOADS).doc(row._id).update({ status: "uploaded", uploaded_at: new Date(), updated_at: new Date() });
  }
  return { success: true };
}

async function extractOcr(student, event) {
  const composition = await ownedComposition(student, event.composition_id);
  if (composition.status === "completed") throw new Error("COMPOSITION_READ_ONLY");
  const photoIds = Array.isArray(event.photo_ids) ? event.photo_ids.slice(0, MAX_UPLOAD_PAGES) : [];
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
  const pendingOcr = {
    full_text: text(ocr.full_text, MAX_COMPOSITION_CHARS),
    paragraphs: Array.isArray(ocr.paragraphs) ? ocr.paragraphs.map((item) => text(item, MAX_COMPOSITION_CHARS)) : [],
    uncertain_spans: Array.isArray(ocr.uncertain_spans) ? ocr.uncertain_spans.slice(0, 100) : [],
    replace_current: event.replace_current === true || rows.some((row) => row.replace_current === true),
    model_metadata: ocrResponse.metadata,
    extracted_at: new Date(),
  };
  await db.collection(COMPOSITIONS).doc(composition._id).update({ pending_ocr: pendingOcr, status: "ocr_review", updated_at: new Date() });
  return { success: true, ocr: pendingOcr, composition: compositionView({ ...composition, pending_ocr: pendingOcr, status: "ocr_review" }) };
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
    const student = await authenticatedStudent();
    await retryPrivatePhotoCleanup(student);
    const action = text(event.action, 80);
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
