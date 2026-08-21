#!/usr/bin/env node

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const failures = [];

function check(label, test) {
  try {
    test();
    process.stdout.write(`\u2713 ${label}\n`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    process.stdout.write(`\u2717 ${label}\n`);
  }
}

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert(fs.existsSync(absolutePath), `missing ${relativePath}`);
  return fs.readFileSync(absolutePath, "utf8");
}

function readExisting(relativePaths) {
  return relativePaths
    .filter((relativePath) => fs.existsSync(path.join(root, relativePath)))
    .map((relativePath) => read(relativePath))
    .join("\n");
}

function requireEvery(source, values, context) {
  values.forEach((value) => {
    assert(source.includes(value), `${context} must include ${value}`);
  });
}

function inputAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
    attributes[match[1].toLowerCase()] = match[3];
  }
  return attributes;
}

function assertClosedObjectSchemas(schema, location) {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object") {
    assert.strictEqual(schema.additionalProperties, false, `${location} must set additionalProperties: false`);
    assert(Array.isArray(schema.required), `${location} must declare required fields`);
    const propertyNames = Object.keys(schema.properties || {}).sort();
    assert.deepStrictEqual([...schema.required].sort(), propertyNames, `${location} must require every declared property`);
    propertyNames.forEach((name) => assertClosedObjectSchemas(schema.properties[name], `${location}.${name}`));
  }
  if (schema.type === "array") assertClosedObjectSchemas(schema.items, `${location}[]`);
}

function functionSource(source, functionName, nextFunctionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert(start >= 0, `missing function ${functionName}`);
  const end = nextFunctionName ? source.indexOf(`function ${nextFunctionName}(`, start + 1) : -1;
  return source.slice(start, end >= 0 ? end : source.length);
}

function matchingFunctionSource(source, namePattern, context) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+(${namePattern})\\s*\\(`).exec(source);
  assert(declaration, `missing ${context}`);
  const start = declaration.index;
  const rest = source.slice(start + declaration[0].length);
  const next = rest.search(/\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/);
  return source.slice(start, next >= 0 ? start + declaration[0].length + next : source.length);
}

function sourceFilesUnder(relativeDirectory) {
  const start = path.join(root, relativeDirectory);
  if (!fs.existsSync(start)) return [];
  const files = [];
  const visit = (absoluteDirectory) => {
    fs.readdirSync(absoluteDirectory, { withFileTypes: true }).forEach((entry) => {
      if (["node_modules", "deploy-packages", ".git"].includes(entry.name)) return;
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile() && /\.(?:js|json)$/.test(entry.name)) files.push(path.relative(root, absolutePath));
    });
  };
  visit(start);
  return files.sort();
}

function writingJobSourcePaths() {
  const allFiles = sourceFilesUnder("cloudfunctions");
  const matchingDirectories = new Set();
  allFiles.forEach((relativePath) => {
    const source = read(relativePath);
    if (/writing_ai_jobs|writingAiJob|writing-ai-job|WRITING_AI_JOB/i.test(source)) {
      matchingDirectories.add(path.dirname(relativePath));
    }
  });
  return allFiles.filter((relativePath) => matchingDirectories.has(path.dirname(relativePath)));
}

const pagePath = "ai-tutor.html";
const clientPath = "assets/js/ai-tutor.js";
const stylePath = "assets/css/ai-tutor.css";
const functionPath = "cloudfunctions/writingTutor/index.js";
const workerPath = "cloudfunctions/writingAiWorker/index.js";
const providerPath = "cloudfunctions/writingTutor/model-provider.js";
const promptPath = "cloudfunctions/writingTutor/prompts.js";
const rubricPath = "cloudfunctions/writingTutor/rubrics.js";
const schemaPath = "cloudfunctions/writingTutor/schemas.js";

const publicActions = [
  "listCompositions",
  "createComposition",
  "startPhotoUpload",
  "finishPhotoUpload",
  "extractOcr",
  "saveDraft",
  "evaluate",
  "submitRewrites",
  "getComposition",
  "getProfile",
];

const teacherActions = [
  "getWritingTutorStudentSettings",
  "updateWritingTutorStudentSettings",
];

check("AI Tutor page and dedicated assets exist", () => {
  [pagePath, clientPath, stylePath].forEach((relativePath) => read(relativePath));
});

check("AI Tutor page loads its dedicated CSS and JavaScript", () => {
  const page = read(pagePath);
  assert(/assets\/css\/ai-tutor\.css(?:\?[^"']*)?["']/.test(page), "missing ai-tutor.css reference");
  assert(/assets\/js\/ai-tutor\.js(?:\?[^"']*)?["']/.test(page), "missing ai-tutor.js reference");
});

check("student dashboard exposes the AI Tutor workspace", () => {
  const dashboard = `${read("dashboard.html")}\n${read("assets/js/dashboard.js")}`;
  assert(dashboard.includes("AI Tutor"), "missing AI Tutor label");
  assert(dashboard.includes("ai-tutor.html"), "missing ai-tutor.html link");
});

check("the two evaluation modes use the approved product labels", () => {
  const ui = `${read(pagePath)}\n${read(clientPath)}`;
  requireEvery(ui, ["通用语言批改", "标化考试内容批改"], "AI Tutor UI");
});

check("the two evaluation modes are mutually exclusive", () => {
  const page = read(pagePath);
  const radioAttributes = Array.from(page.matchAll(/<input\b[^>]*>/gi), (match) => inputAttributes(match[0]))
    .filter((attributes) => attributes.type === "radio");
  const grouped = new Map();
  radioAttributes.forEach((attributes) => {
    if (!attributes.name) return;
    const values = grouped.get(attributes.name) || [];
    values.push(attributes.value || "");
    grouped.set(attributes.name, values);
  });
  const modeGroup = Array.from(grouped.values()).find((values) => {
    const joined = values.join(" ").toLowerCase();
    return values.length === 2 && /language|general/.test(joined) && /standard|exam|rubric/.test(joined);
  });
  assert(modeGroup, "expected exactly two same-name radio inputs for general language and standardized exam modes");
});

check("writingTutor exposes every public action used by the workspace", () => {
  const backend = read(functionPath);
  const client = read(clientPath);
  requireEvery(backend, publicActions, "writingTutor backend");
  requireEvery(client, publicActions, "AI Tutor client");
  assert(client.includes("writingTutor"), "AI Tutor client must call the writingTutor function");
});

check("teacher settings expose get/update daily-limit actions", () => {
  const teacherClient = read("assets/js/teacher.js");
  const teacherBackend = read("cloudfunctions/teacherAdmin/index.js");
  requireEvery(teacherClient, teacherActions, "teacher writing settings client");
  requireEvery(teacherBackend, teacherActions, "teacher writing settings backend");
});

check("model responses use strict versioned JSON schemas", () => {
  const backend = `${read(functionPath)}\n${read(providerPath)}\n${read(schemaPath)}`;
  assert(/(?:strict\s*:\s*true|strict\s*["']?\s*:\s*true)/.test(backend), "missing strict: true Structured Outputs marker");
  assert(/additionalProperties\s*:\s*false/.test(backend), "schemas must reject additional properties");
  assert(/\brequired\s*:/.test(backend), "schemas must declare required properties");
  assert(/json_schema|response_format|text\.format/i.test(backend), "missing JSON Schema model-response format");
  assert(/(?:SCHEMA|schema)[_A-Z\w]*VERSION\s*=\s*["'][^"']+["']/.test(backend), "missing schema version constant");

  const schemas = require(path.join(root, schemaPath));
  assert(/^writing-ai-schemas-\d{4}-\d{2}-\d{2}\./.test(schemas.SCHEMA_VERSION), "SCHEMA_VERSION must be dated and revisioned");
  ["OCR_SCHEMA", "STANDARDIZED_SCHEMA", "LANGUAGE_SCHEMA", "REWRITE_SCHEMA"].forEach((name) => {
    assert(schemas[name], `missing exported ${name}`);
    assertClosedObjectSchemas(schemas[name], name);
  });
});

check("domestic-model adapters validate every returned JSON object locally", () => {
  const provider = require(path.join(root, providerPath));
  const schemas = require(path.join(root, schemaPath));
  const valid = { full_text: "Text", paragraphs: ["Text"], uncertain_spans: [] };
  assert.deepStrictEqual(provider._test.validateAgainstSchema(valid, schemas.OCR_SCHEMA), []);
  const invalid = { full_text: "Text", paragraphs: "Text", uncertain_spans: [], extra: true };
  const errors = provider._test.validateAgainstSchema(invalid, schemas.OCR_SCHEMA);
  assert(errors.some((message) => message.includes("paragraphs") && message.includes("array")));
  assert(errors.some((message) => message.includes("extra") && message.includes("not allowed")));
  const source = read(providerPath);
  requireEvery(source, ["chat_json_schema", "chat_json_object", "responses_json_schema"], "model provider protocols");
  assert(/WRITING_AI_(?:TEXT|VISION)_/.test(source), "text and vision providers must be independently configurable");
});

check("Qwen JSON wrappers are normalized before strict validation", () => {
  const provider = require(path.join(root, providerPath));
  const schemas = require(path.join(root, schemaPath));
  const expected = { full_text: "Text", paragraphs: ["Text"], uncertain_spans: [] };
  const doubleEncoded = JSON.stringify(JSON.stringify(expected));
  assert.deepStrictEqual(provider._test.parseStructuredOutput(doubleEncoded, schemas.OCR_SCHEMA), expected);
  assert.deepStrictEqual(provider._test.parseStructuredOutput(JSON.stringify([expected]), schemas.OCR_SCHEMA), expected);
  assert.deepStrictEqual(
    provider._test.parseStructuredOutput(JSON.stringify([
      { full_text: "Page one", paragraphs: ["Page one"], uncertain_spans: [] },
      { full_text: "Page two", paragraphs: ["Page two"], uncertain_spans: [{ text: "two", reason: "unclear" }] },
    ]), schemas.OCR_SCHEMA),
    {
      full_text: "Page one\n\nPage two",
      paragraphs: ["Page one", "Page two"],
      uncertain_spans: [{ text: "two", reason: "unclear" }],
    }
  );
  assert.throws(
    () => provider._test.parseStructuredOutput("not json", schemas.OCR_SCHEMA),
    /WRITING_AI_SCHEMA_RESPONSE_INVALID/
  );
});

check("OCR survives a browser request disconnect by polling the Composition", () => {
  const client = read(clientPath);
  const backend = read(functionPath);
  requireEvery(client, ["ocr_job", "getComposition"], "AI Tutor OCR polling client");
  assert(/waitForOcrResult|startOcrPolling|poll[A-Z\w]*Job|resume[A-Z\w]*Job/.test(client),
    "AI Tutor client must poll/resume the stored OCR job");
  requireEvery(backend, ["ocr_job", "processing", "succeeded", "failed"], "writingTutor OCR job state");
  assert(/network(?: request)? error|failed to fetch|networkerror/i.test(client), "OCR polling must recognize network disconnects");
});

check("photo-upload preparation is idempotent for one operation ID", () => {
  const backend = read(functionPath);
  const startSource = functionSource(backend, "startPhotoUpload", "photoRows");
  requireEvery(startSource, ["operationId", "photoId", "uploads"], "startPhotoUpload idempotency");
  assert(!/photoId\s*=\s*randomId\s*\(/.test(startSource),
    "startPhotoUpload generates a random photo_id; derive each photo_id from operation_id plus page index so a lost response can replay the same batch");
  assert(/photoId\s*=\s*stableId\s*\([\s\S]{0,320}operationId[\s\S]{0,220}(?:index|page_index)|photoId\s*=\s*stableId\s*\([\s\S]{0,220}(?:index|page_index)[\s\S]{0,320}operationId/.test(startSource),
    "startPhotoUpload must derive a stable photo_id from operation_id and page index");
  assert(/(?:pending_upload|existing|replay|idempoten|getOne|\.where\s*\()[\s\S]{0,500}operationId|operationId[\s\S]{0,500}(?:pending_upload|existing|replay|idempoten|getOne|\.where\s*\()/.test(startSource),
    "startPhotoUpload must detect/replay an existing operation_id and return upload metadata for the same batch");
});

check("an interrupted logical photo upload retries without a false background-completion claim", () => {
  const client = read(clientPath);
  const uploadSource = functionSource(client, "uploadAndExtract", "isNetworkDisconnect");
  requireEvery(uploadSource, ["logicalOperationId", "operation_id", "isNetworkDisconnect"], "photo-upload retry client");
  assert(/retry[A-Z\w]*\s*\(\s*function\s*\(\)\s*\{[\s\S]{0,1200}startPhotoUpload[\s\S]{0,1800}finishPhotoUpload/i.test(uploadSource),
    "network failure must retry the complete start/upload/finish task while logicalOperationId retains the same operation_id");
  assert(!/系统会继续(?:确认|处理|完成)同一批照片|后台会继续(?:确认|处理|完成)/.test(uploadSource),
    "client must not claim the backend will finish a batch whose photo bytes were never confirmed uploaded");
});

check("AI work uses a documented ADMINONLY writing_ai_jobs collection", () => {
  const backendSources = readExisting(sourceFilesUnder("cloudfunctions"));
  const dataModel = read("docs/04_DATA_MODEL.md");
  assert(backendSources.includes("writing_ai_jobs"), "cloud-function source must reference writing_ai_jobs");
  assert(dataModel.includes("writing_ai_jobs"), "data model must document writing_ai_jobs");
  assert(/writing_ai_jobs[\s\S]{0,800}ADMINONLY|ADMINONLY[\s\S]{0,800}writing_ai_jobs/i.test(dataModel),
    "writing_ai_jobs must be explicitly documented as ADMINONLY");
});

check("OCR action enqueues a durable job and returns immediately", () => {
  const backend = read(functionPath);
  const extractSource = functionSource(backend, "extractOcr", "deleteUploadedPhotos");
  assert(!/await\s+callStructuredModel\s*\(/.test(extractSource),
    "extractOcr must not keep the browser request open while the vision model runs");
  assert(/writing_ai_jobs|\bJOBS\b|enqueue[A-Z\w]*Job/.test(extractSource),
    "extractOcr must enqueue a persistent writing_ai_jobs record");
  assert(/status\s*:\s*["']queued["']/.test(backend), "new OCR job must start queued");
  assert(/(?:accepted\s*:\s*true|status\s*:\s*["']queued["'])/.test(backend)
      && /\bjob_id\b/.test(backend),
    "extractOcr response must immediately expose accepted/queued plus job_id");
});

check("evaluate enqueues a durable review job and returns without waiting for the model", () => {
  const backend = read(functionPath);
  const evaluateSource = functionSource(backend, "evaluate", "submitRewrites");
  assert(!/await\s+callStructuredModel\s*\(/.test(evaluateSource),
    "evaluate still waits for the language model inside the browser request; it must only reserve/enqueue and return");
  assert(/enqueue[A-Z\w]*Review[A-Z\w]*Job\s*\(/.test(evaluateSource),
    "evaluate must enqueue a persistent review job");
  assert(/(?:accepted\s*:\s*true|status\s*:\s*["']queued["'])[\s\S]{0,300}\bjob\b|\bjob\b[\s\S]{0,300}(?:accepted\s*:\s*true|status\s*:\s*["']queued["'])/.test(evaluateSource),
    "evaluate must immediately return an accepted/queued job projection");
});

check("review jobs cover both assessment modes and use the durable job lifecycle", () => {
  const backend = read(functionPath);
  const enqueueSource = matchingFunctionSource(backend, "enqueue[A-Z\\w]*Review[A-Z\\w]*Job", "review-job enqueue function");
  const performSource = matchingFunctionSource(backend, "(?:perform|process|run)[A-Z\\w]*Review[A-Z\\w]*Job", "review-job processor function");
  const processSource = functionSource(backend, "processQueuedJob", "extractOcr");
  const reviewSources = `${enqueueSource}\n${performSource}\n${processSource}`;
  requireEvery(reviewSources, ["standardized_content", "general_language"], "review job modes");
  assert(/job_type\s*:\s*["'](?:review|writing_review|standardized_review|language_review)["']|review_mode\s*:\s*mode/.test(enqueueSource),
    "review job must persist a review-specific job_type or review_mode");
  assert(/status\s*:\s*["']queued["']/.test(enqueueSource), "new review job must start queued");
  const claimIndex = processSource.indexOf("await claimQueuedJob");
  const noClaimReturnIndex = processSource.search(/if\s*\(\s*!claimed\s*\)\s*return/);
  const publishIndex = processSource.indexOf("await publishProcessingJob");
  const reviewRunIndex = processSource.search(/await\s+reviewRunner\s*\(/);
  assert(claimIndex >= 0 && noClaimReturnIndex > claimIndex && publishIndex > noClaimReturnIndex
      && reviewRunIndex > publishIndex,
    "reviewRunner must execute only after a successful lease claim, the empty-claim return guard, and active-job processing publication");
  assert(/active_job_id/.test(performSource) && /runTransaction|transaction/.test(performSource),
    "review-result publication must transactionally re-check Composition.active_job_id");
  ["queued", "processing", "succeeded", "failed", "superseded"].forEach((status) => {
    assert(new RegExp(`["']${status}["']`).test(backend), `review-job backend is missing lifecycle status ${status}`);
  });
});

check("one review operation cannot double-charge quota or invoke the model twice", () => {
  const backend = read(functionPath);
  const enqueueSource = matchingFunctionSource(backend, "enqueue[A-Z\\w]*Review[A-Z\\w]*Job", "review-job enqueue function");
  const reserveSource = functionSource(backend, "reserveUsage", "releaseUsage");
  const processSource = functionSource(backend, "processQueuedJob", "extractOcr");
  requireEvery(enqueueSource, ["operationId", "stableId", "jobId"], "review-job idempotency");
  assert(/getOne\s*\(\s*JOBS[\s\S]{0,500}(?:existing|idempoten|replay)|(?:existing|idempoten|replay)[\s\S]{0,500}getOne\s*\(\s*JOBS/.test(enqueueSource),
    "same operation_id must return the existing review job before creating another logical job");
  assert(/\.doc\s*\(\s*jobId\s*\)\.create\s*\(/.test(enqueueSource),
    "review job creation must be create-only under its stable job_id");
  assert(/stableId\s*\([\s\S]{0,220}operationId/.test(reserveSource)
      && /existing[\s\S]{0,500}(?:duplicate|reserved|succeeded)/.test(reserveSource),
    "quota reservation must reuse the same operation_id and existing usage row on retry");
  assert(/const\s+claimed\s*=\s*await\s+claimQueuedJob[\s\S]{0,220}if\s*\(\s*!claimed\s*\)\s*return/.test(processSource),
    "duplicate worker delivery must return before any review-model call when the job cannot be claimed");
});

check("terminal review-job failure releases its reserved word quota", () => {
  const backend = read(functionPath);
  const failureSource = functionSource(backend, "finishFailedJobAttempt", "processQueuedJob");
  const processSource = functionSource(backend, "processQueuedJob", "extractOcr");
  const releaseSource = functionSource(backend, "releaseUsage", "commitReviewAndUsage");
  assert(/outcome\s*=\s*await\s+finishFailedJobAttempt[\s\S]{0,500}outcome\.committed[\s\S]{0,180}!outcome\.shouldRetry[\s\S]{0,250}await\s+releaseUsage/.test(processSource),
    "processQueuedJob must release review usage only after finishFailedJobAttempt commits a terminal, non-retryable outcome");
  assert(/claimed\.terminal_failure[\s\S]{0,350}await\s+releaseUsage/.test(processSource),
    "an attempt-exhausted review job returned by claimQueuedJob must also release its usage reservation");
  assert((/status\s*!={1,2}\s*["']reserved["']/.test(releaseSource)
      || /where\s*\(\s*\{[\s\S]{0,260}status\s*:\s*["']reserved["']/.test(releaseSource))
      && /runTransaction|transaction/.test(releaseSource),
    "releaseUsage must be idempotently guarded by reserved status and use a transaction for the quota refund");
  assert(/active_job_id/.test(failureSource),
    "finishFailedJobAttempt must update only the still-active review job before processQueuedJob releases quota");
});

check("reopening a Composition resumes queued or processing review work", () => {
  const backend = read(functionPath);
  const client = read(clientPath);
  const compositionViewSource = functionSource(backend, "compositionView", "uploadMetadataView");
  const loadSource = functionSource(client, "loadComposition", "renderFatalAction");
  assert(/active_job|review_job/.test(compositionViewSource) && /job_type/.test(compositionViewSource),
    "getComposition projection must expose the active review job type and state");
  assert(/active_job|review_job/.test(loadSource),
    "loadComposition must inspect the restored review job instead of only ocr_job");
  assert(/review|standardized_content|general_language/.test(loadSource)
      && /queued|processing/.test(loadSource)
      && /poll|start[A-Z\w]*Polling|resume/i.test(loadSource),
    "loadComposition must resume polling for queued/processing review jobs after reopening");
});

check("language review after standardized review preserves the standardized result", () => {
  const backend = read(functionPath);
  const performSource = matchingFunctionSource(backend, "(?:perform|process|run)[A-Z\\w]*Review[A-Z\\w]*Job", "review-job processor function");
  assert(/standardized_review\s*:\s*job\.review_mode\s*={2,3}\s*["']standardized_content["']\s*\?\s*review\s*:\s*(?:composition|current|candidate|prepared)\.standardized_review/.test(performSource),
    "general_language review must retain the Composition's existing standardized_review");
  assert(!/standardized_review\s*:\s*job\.review_mode\s*={2,3}\s*["']general_language["']\s*\?\s*null/.test(performSource),
    "ordinary general_language review must not clear standardized_review");
});

check("a cloud-side async dispatcher processes AI jobs without a browser connection", () => {
  const primaryBackend = read(functionPath);
  const candidates = sourceFilesUnder("cloudfunctions").filter((relativePath) => !relativePath.startsWith("cloudfunctions/writingTutor/"));
  const workerFiles = candidates.filter((relativePath) => {
    const source = read(relativePath);
    return /writing_ai_jobs|processWritingAiJob|dispatchWritingAiJob/i.test(source);
  });
  const inFunctionAsyncWorker = /invokeFunctionAsync|async\s*:\s*true/i.test(primaryBackend)
    && /(?:async\s+)?function\s+(?:process|dispatch|claim)[A-Z\w]*Job\s*\(/.test(primaryBackend);
  assert(workerFiles.length || inFunctionAsyncWorker,
    "missing a CloudBase asynchronous AI-job dispatcher/worker");
  const workerSource = `${primaryBackend}\n${readExisting(workerFiles)}`;
  const jobSources = readExisting(writingJobSourcePaths());
  requireEvery(workerSource, ["exports.main", "job_id"], "AI-job dispatcher");
  assert(/callStructuredModel|model-provider|WRITING_AI_/i.test(jobSources), "cloud job processor must invoke the configured model server-side");
  assert(/timer|cron|trigger|internal_token|claim|async\s*:\s*true/i.test(workerSource), "dispatcher must have a cloud trigger/claim boundary");
});

check("AI job and operation identities are fixed and idempotent", () => {
  const backendSources = readExisting(sourceFilesUnder("cloudfunctions"));
  const client = read(clientPath);
  requireEvery(backendSources, ["job_id", "operation_id", "stableId"], "persistent AI-job identity");
  assert(/\.doc\s*\([^\n;]*(?:job|stableId)[^\n;]*\)\s*\.create\s*\(/i.test(backendSources),
    "job creation must use a stable job ID and create-only semantics");
  assert(/idempotent|existingJob|existing_job|JOB_ALREADY|replay|getOne\s*\([^\n]*(?:JOBS|writing_ai_jobs)/i.test(backendSources),
    "enqueue must return/reuse the existing logical job on retry");
  assert(!/operation_id\s*:\s*operationId\(["']ocr["']\)/.test(client),
    "OCR retry currently creates a fresh operation_id; retain one until the same OCR job reaches a terminal state or its input changes");
});

check("persistent AI jobs implement the complete lifecycle", () => {
  const sources = readExisting(writingJobSourcePaths());
  ["queued", "processing", "succeeded", "failed", "superseded"].forEach((status) => {
    assert(new RegExp(`["']${status}["']`).test(sources), `missing AI-job status ${status}`);
  });
});

check("AI-job claims have leases, bounded attempts, and retry scheduling", () => {
  const sources = readExisting(writingJobSourcePaths());
  assert(/lease_(?:token|owner|id)/i.test(sources), "missing job lease owner/token field");
  assert(/lease_(?:expires|expires_at|until)/i.test(sources), "missing job lease expiry field");
  assert(/attempt_(?:count|number)|attempts/i.test(sources), "missing job attempt counter");
  assert(/retry_(?:count|at|after)|next_(?:attempt|retry)_at|max_(?:attempts|retries)/i.test(sources),
    "missing bounded retry/backoff fields");
});

check("worker selects due retries and expired leases in CloudBase queries", () => {
  const worker = read(workerPath);
  const leaseRecovery = functionSource(worker, "recoverExpiredLeases", "dispatchQueued");
  const queuedDispatch = functionSource(worker, "dispatchQueued", "cleanupExpiredPhotos");
  assert(/\.where\s*\(\s*\{[\s\S]{0,300}lease_until\s*:\s*(?:command|db\.command)\.(?:lte|lt)\s*\(\s*now/.test(leaseRecovery),
    "recoverExpiredLeases must put lease_until <= now in the database query instead of filtering a status-only first page in memory");
  assert(/\.where\s*\(\s*\{[\s\S]{0,300}next_retry_at\s*:\s*(?:command|db\.command)\.(?:lte|lt)\s*\(\s*now/.test(queuedDispatch),
    "dispatchQueued must put next_retry_at <= now in the database query instead of filtering a status-only first page in memory");
});

check("worker timer accepts raw and JSON SCF Message tokens", () => {
  const worker = read(workerPath);
  const timerSource = functionSource(worker, "timerToken", "dateMs");
  const timerToken = Function(`"use strict"; ${timerSource}; return timerToken;`)();
  const expected = "worker-test-token";
  assert.strictEqual(timerToken({ Message: expected }), expected,
    "raw SCF event.Message must authorize the worker timer");
  assert.strictEqual(timerToken({ Message: JSON.stringify({ token: expected }) }), expected,
    "a JSON CustomArgument object delivered in event.Message must authorize the worker timer");
  assert.strictEqual(timerToken({ Message: JSON.stringify(expected) }), expected,
    "a JSON-string CustomArgument delivered in event.Message must authorize the worker timer");
});

check("model timeout is clamped below the six-minute job lease", () => {
  const source = read(providerPath);
  const maximum = source.match(/const\s+(MAX[_A-Z]*TIMEOUT_MS)\s*=\s*([^;]+);/);
  assert(maximum, "model provider must declare an explicit maximum timeout below the job lease");
  assert(/^[\d\s()+*/.-]+$/.test(maximum[2]), "maximum model timeout must be a static numeric expression");
  const maximumMs = Function(`"use strict"; return (${maximum[2]});`)();
  assert(Number.isFinite(maximumMs) && maximumMs > 0 && maximumMs < 6 * 60 * 1000,
    "maximum model timeout must be positive and remain below the fixed six-minute AI-job lease");
  const callSource = functionSource(source, "callOnce", "callStructuredModel");
  assert(new RegExp(`Math\\.min\\s*\\(\\s*${maximum[1]}\\s*,`).test(callSource),
    "callOnce must clamp WRITING_AI_TIMEOUT_MS with the declared maximum before creating its abort timer");
});

check("only the Composition active_job_id may accept a worker result", () => {
  const sources = readExisting(writingJobSourcePaths());
  requireEvery(sources, ["active_job_id", "job_id", "superseded"], "active AI-job result guard");
  assert(/active_job_id[\s\S]{0,240}(?:===|!==|==|!=)[\s\S]{0,120}job_id|job_id[\s\S]{0,120}(?:===|!==|==|!=)[\s\S]{0,240}active_job_id/i.test(sources),
    "worker must compare Composition.active_job_id with its job_id before publishing a result");
  assert(/runTransaction|transaction/i.test(sources), "active-job verification and Composition result publication must be transactional");
});

check("reopening a Composition resumes its durable AI-job state", () => {
  const backend = read(functionPath);
  const client = read(clientPath);
  const getCompositionSource = functionSource(backend, "getComposition", "startPhotoUpload");
  const compositionViewSource = functionSource(backend, "compositionView", "uploadMetadataView");
  assert(/active_job|job_status|writing_ai_jobs|\bJOBS\b/.test(`${getCompositionSource}\n${compositionViewSource}`),
    "getComposition must return the current durable job projection");
  assert(/active_job_id|job_status|queued|processing/.test(client),
    "client must recognize a restored queued/processing job after reopening a Composition");
  const loadSource = functionSource(client, "loadComposition", "renderFatalAction");
  assert(/poll|waitFor|resume/i.test(loadSource) && /job|queued|processing/i.test(loadSource),
    "loadComposition must resume polling/recovery for the persisted active job");
});

check("Qwen OCR defaults to the low-latency vision model", () => {
  const provider = require(path.join(root, providerPath));
  const previous = {
    apiKey: process.env.WRITING_AI_API_KEY,
    apiUrl: process.env.WRITING_AI_API_URL,
    model: process.env.WRITING_AI_MODEL,
    visionModel: process.env.WRITING_AI_VISION_MODEL,
  };
  try {
    process.env.WRITING_AI_API_KEY = "test-key";
    process.env.WRITING_AI_API_URL = "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions";
    process.env.WRITING_AI_MODEL = "qwen3.7-plus";
    delete process.env.WRITING_AI_VISION_MODEL;
    assert.strictEqual(provider._test.providerConfig(true).model, "qwen3.7-flash");
    assert.strictEqual(provider._test.providerConfig(false).model, "qwen3.7-plus");
  } finally {
    const keys = {
      apiKey: "WRITING_AI_API_KEY",
      apiUrl: "WRITING_AI_API_URL",
      model: "WRITING_AI_MODEL",
      visionModel: "WRITING_AI_VISION_MODEL",
    };
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete process.env[keys[key]];
      else process.env[keys[key]] = value;
    });
  }
});

check("server canonicalization overrides contradictory AI summary fields", () => {
  const backend = require(path.join(root, functionPath));
  const rubrics = require(path.join(root, rubricPath));
  const base = {
    overall_score: "0", score_scale: "wrong", summary: "Summary", strengths: [], priorities: [],
  };
  const ielts = rubrics.getRubric("ielts_task_2");
  const ieltsResult = backend._test.canonicalStandardizedResult({
    ...base,
    criteria: ielts.criteria.map((criterion, index) => ({
      criterion_id: criterion.id, name: "wrong", score: String([6, 7, 7, 8][index]), max_score: "99", rationale: "Evidence",
    })),
  }, ielts);
  assert.strictEqual(ieltsResult.overall_score, "7");
  assert.strictEqual(ieltsResult.rubric_id, "ielts_task_2");

  const dse = rubrics.getRubric("hkdse_paper_2");
  const dseResult = backend._test.canonicalStandardizedResult({
    ...base,
    criteria: dse.criteria.map((criterion, index) => ({
      criterion_id: criterion.id, name: criterion.name, score: String([5, 6, 7][index]), max_score: "7", rationale: "Evidence",
    })),
  }, dse);
  assert.strictEqual(dseResult.overall_score, "18");

  const language = backend._test.canonicalLanguageResult({
    overview: "Overview", profile_observations: [],
    sentences: [{
      sentence_id: "s001", original: "I go home.", status: "needs_revision",
      rewrite_required: false, issues: [], coaching_summary: "Agreement", reference_revision: "I go home.",
    }],
  }, [{ sentence_id: "s001", original: "I goes home." }]);
  assert.strictEqual(language.sentences[0].rewrite_required, true);
  assert.strictEqual(language.sentences[0].original, "I goes home.",
    "server must restore the exact source sentence instead of trusting the model echo");
  const persistenceUpdate = backend._test.replaceWholeFields({
    status: "sentence_training",
    language_review: { model_metadata: { model: "test" }, sentences: [] },
  }, ["language_review"]);
  assert.strictEqual(persistenceUpdate.language_review.operator, "set",
    "a first review must atomically replace language_review instead of creating paths below a null field");
  assert.strictEqual(persistenceUpdate.status, "sentence_training");
  assert.throws(() => backend._test.canonicalLanguageResult({
    overview: "Overview", profile_observations: [],
    sentences: [{ sentence_id: "s999", original: "Wrong", status: "effective", issues: [],
      coaching_summary: "", reference_revision: "" }],
  }, [{ sentence_id: "s001", original: "I goes home." }]), /WRITING_AI_SENTENCE_ALIGNMENT_FAILED/);

  const rewrites = backend._test.canonicalRewriteResults([{
    sentence_id: "s001", accepted: true, meaning_preserved: true, target_resolved: true,
    new_errors: ["New tense error"], feedback: "Revise", next_step: "complete",
  }], [{ sentence_id: "s001", text: "I went home tomorrow." }]);
  assert.strictEqual(rewrites[0].accepted, false);
  assert.strictEqual(rewrites[0].next_step, "revise_again");
  assert.strictEqual(rewrites[0].student_rewrite, "I went home tomorrow.");
});

check("prompts are versioned and make the selected Rubric authoritative", () => {
  const prompts = `${read(promptPath)}\n${read(rubricPath)}`;
  assert(/(?:PROMPT|prompt)[_A-Z\w]*VERSION\s*=\s*["'][^"']+["']/.test(prompts), "missing prompt version constant");
  assert(/selected.{0,80}(?:rubric|framework).{0,80}authoritative/is.test(prompts), "prompt must say the selected Rubric/framework is authoritative");
  assert(/(?:do not|never).{0,100}(?:reclassif|replace|switch|choose).{0,100}(?:rubric|framework)/is.test(prompts), "prompt must forbid automatic Rubric/framework reclassification");

  const promptModule = require(path.join(root, promptPath));
  const rubricModule = require(path.join(root, rubricPath));
  assert(/^writing-prompts-\d{4}-\d{2}-\d{2}\./.test(promptModule.PROMPT_VERSION), "PROMPT_VERSION must be dated and revisioned");
  assert(/^writing-rubrics-\d{4}-\d{2}-\d{2}\./.test(rubricModule.RUBRIC_VERSION), "RUBRIC_VERSION must be dated and revisioned");
  const selectedRubric = rubricModule.getRubric("hkdse_paper_2");
  const standardized = promptModule.standardizedPrompt(selectedRubric);
  assert(standardized.includes(selectedRubric.label), "standardized prompt must embed the selected rubric");
  assert(/authoritative/i.test(standardized), "selected rubric must be authoritative");
  assert(/do not replace|do not reclassify/i.test(standardized), "standardized prompt must forbid automatic replacement/reclassification");
  assert(/no numerical score/i.test(promptModule.languagePrompt()), "general language prompt must explicitly forbid scoring");
});

check("Cambridge 9093 Paper 2 task types keep their official score scales separate", () => {
  const rubricModule = require(path.join(root, rubricPath));
  const shorter = rubricModule.getRubric("cambridge_9093_p2_shorter_writing");
  const commentary = rubricModule.getRubric("cambridge_9093_p2_reflective_commentary");
  const extended = rubricModule.getRubric("cambridge_9093_p2_extended_writing");
  assert.strictEqual(shorter.overall_max, 15);
  assert.strictEqual(commentary.overall_max, 10);
  assert.strictEqual(extended.overall_max, 25);
  assert.strictEqual(shorter.criteria[0].id, "ao2_writing");
  assert.strictEqual(commentary.criteria[0].id, "ao3_analysis");
  assert.strictEqual(extended.criteria[0].id, "ao2_writing");
  const client = read(clientPath);
  [shorter.rubric_id, commentary.rubric_id, extended.rubric_id].forEach((rubricId) => {
    assert(client.includes(rubricId), `AI Tutor fallback Rubrics must include ${rubricId}`);
  });
});

check("student-facing framework names use the approved concise labels", () => {
  const rubricModule = require(path.join(root, rubricPath));
  const publicRubrics = rubricModule.publicRubrics();
  const labels = publicRubrics.map((rubric) => rubric.label);
  requireEvery(labels.join("\n"), ["IELTS Task 1", "IELTS Task 2", "DSE Paper 2"], "public Rubric labels");
  assert(labels.some((label) => label.startsWith("A Level 9093")), "missing A Level 9093 label");
  assert(!publicRubrics.some((rubric) => rubric.rubric_id === "ielts_general_task_1"), "General Training Task 1 must be hidden from new selections");
});

check("daily word quota is server-enforced and idempotent", () => {
  const backend = read(functionPath);
  assert(/daily.{0,60}(?:word|quota|limit)|(?:word|quota|limit).{0,60}daily/is.test(backend), "missing daily word-limit enforcement");
  assert(/idempoten|request[_A-Z]?id|operation[_A-Z]?id/i.test(backend), "missing stable request/idempotency key");
  assert(/Asia\/Shanghai|shanghai/i.test(backend), "daily quota must use the project Shanghai day boundary");
  assert(/(?:transaction|runTransaction|\.create\s*\()/i.test(backend), "quota claim must use an atomic/idempotent write boundary");
});

check("a logical AI request reuses its operation ID after a lost response", () => {
  const client = read(clientPath);
  assert(!/operation_id\s*:\s*operationId\(["']evaluate["']\)/.test(client),
    "evaluate currently creates a fresh random operation_id on every invocation; retain one ID until that logical review succeeds or its input changes");
  assert(!/operation_id\s*:\s*operationId\(["']rewrites["']\)/.test(client),
    "rewrite checking currently creates a fresh random operation_id on every invocation; retain one ID for retries of the same rewrite batch");
});

check("same-composition re-upload replaces only after the new result succeeds", () => {
  const backend = read(functionPath);
  const sources = `${backend}\n${read(clientPath)}`;
  assert(/re-?upload|重新上传|replace(?:ment|Current|_current)?/i.test(sources), "missing explicit re-upload/replacement path");
  assert(/composition[_A-Z]?id/i.test(sources), "replacement must keep a stable composition_id");
  const saveDraftSource = functionSource(backend, "saveDraft", "usageMatchesScope");
  assert(!/standardized_review\s*:\s*invalidatesCurrentReview\s*\?\s*null/.test(saveDraftSource),
    "saveDraft clears the committed standardized review before the replacement AI call succeeds");
  assert(!/language_review\s*:\s*invalidatesCurrentReview\s*\?\s*null/.test(saveDraftSource),
    "saveDraft clears the committed language review before the replacement AI call succeeds");
  assert(!/if\s*\(invalidatesCurrentReview\)[\s\S]{0,500}OBSERVATIONS[\s\S]{0,200}\.remove\s*\(/.test(saveDraftSource),
    "saveDraft deletes committed observations before the replacement AI call succeeds");
  assert(/pending_(?:replacement|revision|manuscript|draft)|replacement_pending/i.test(saveDraftSource),
    "replacement text must be staged separately until review and usage commit atomically");
});

check("students have no composition-deletion action", () => {
  const backend = read(functionPath);
  const client = read(clientPath);
  assert(!/deleteComposition|removeComposition/.test(`${backend}\n${client}`), "students must not be offered a composition deletion action");
  assert(!/data-(?:delete|remove)-composition/.test(client), "students must not see a composition deletion control");
});

check("successful reviews enqueue metadata-only teacher email events", () => {
  const backend = read(functionPath);
  const dispatcherPath = "cloudfunctions/sendWritingTutorEmails/index.js";
  const dispatcher = read(dispatcherPath);
  requireEvery(backend, ["writing_teacher_email_events", "enqueueReviewEmail", "await enqueueReviewEmail"], "writing review email outbox");
  requireEvery(dispatcher, ["writing_teacher_email_events", "WRITING_TUTOR_EMAIL_CRON_TOKEN", "status: \"sent\""], "writing email dispatcher");
  assert(!/confirmed_text|student_manuscript|standardized_review|language_review/.test(dispatcher),
    "teacher usage email must not load or include manuscript/review content");
  assert(/Student writing is not included/i.test(dispatcher), "email must state that it contains usage metadata only");
});

check("AI credentials and direct model endpoints never enter frontend files", () => {
  const publicSource = readExisting([
    pagePath,
    clientPath,
    stylePath,
    "assets/js/config.public.js",
    "assets/js/cloudbase-client.js",
    "dashboard.html",
    "assets/js/dashboard.js",
    "teacher.html",
    "assets/js/teacher.js",
  ]);
  assert(!/OPENAI_API_KEY|ANTHROPIC_API_KEY|DASHSCOPE_API_KEY|\bsk-[A-Za-z0-9_-]{12,}/i.test(publicSource), "AI API credential marker found in frontend");
  assert(!/api\.openai\.com|generativelanguage\.googleapis\.com|api\.anthropic\.com/i.test(publicSource), "frontend must not call a model provider directly");
  assert(!/Authorization\s*[:=]\s*["'`]Bearer/i.test(publicSource), "frontend must not construct an AI bearer token");
});

check("reference revision is hidden whenever rewrite input is available", () => {
  const page = read(pagePath);
  const client = read(clientPath);
  const styles = read(stylePath);
  const sources = `${page}\n${client}\n${styles}`;
  assert(/reference|参考句|参考修改/i.test(sources), "missing reference-revision UI");
  assert(/rewrite|改写/i.test(sources), "missing student-rewrite UI");
  assert(/(?:hide|hidden|aria-hidden|display\s*:\s*none)/i.test(sources), "missing a hiding mechanism for the reference revision");
  assert(/(?:reference|参考).{0,220}(?:rewrite|改写).{0,220}(?:hide|hidden)|(?:rewrite|改写).{0,220}(?:reference|参考).{0,220}(?:hide|hidden)/is.test(client), "client must explicitly coordinate reference visibility with rewrite-input visibility");
  assert(!/<(?:input|textarea)[^>]*(?:value|placeholder)=["'][^"']*(?:reference revision|参考修改句|正确答案)/i.test(page), "reference/correct answer must not be embedded in a visible rewrite control");
});

if (failures.length) {
  process.stderr.write(`\nAI Tutor contract failures (${failures.length}):\n`);
  failures.forEach((failure) => process.stderr.write(`- ${failure}\n`));
  process.exitCode = 1;
} else {
  console.log("\nAI Tutor source contracts passed.");
}
