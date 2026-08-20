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

const pagePath = "ai-tutor.html";
const clientPath = "assets/js/ai-tutor.js";
const stylePath = "assets/css/ai-tutor.css";
const functionPath = "cloudfunctions/writingTutor/index.js";
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
  requireEvery(client, ["waitForOcrResult", "ocr_job", "getComposition"], "AI Tutor OCR polling client");
  requireEvery(backend, ["ocr_job", "processing", "succeeded", "failed"], "writingTutor OCR job state");
  assert(/network(?: request)? error|failed to fetch|networkerror/i.test(client), "OCR polling must recognize network disconnects");
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
      sentence_id: "s001", original: "I goes home.", status: "needs_revision",
      rewrite_required: false, issues: [], coaching_summary: "Agreement", reference_revision: "I go home.",
    }],
  }, [{ sentence_id: "s001", original: "I goes home." }]);
  assert.strictEqual(language.sentences[0].rewrite_required, true);

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
