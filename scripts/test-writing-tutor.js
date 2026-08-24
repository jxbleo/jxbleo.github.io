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

function assertDescriptionMatches(schema, pattern, location) {
  assert(schema && typeof schema.description === "string", `${location} must declare a description`);
  assert(pattern.test(schema.description), `${location} description must match ${pattern}`);
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
  const lineStart = source.lastIndexOf("\n", start) + 1;
  const indent = source.slice(lineStart, start);
  const escapedIndent = indent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rest = source.slice(start + declaration[0].length);
  const next = rest.search(new RegExp(`\\n${escapedIndent}(?:async\\s+)?function\\s+[A-Za-z_$][\\w$]*\\s*\\(`));
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

check("AI Tutor header keeps only History, the current title, and revision percentage", () => {
  const page = read(pagePath);
  const styles = read(stylePath);
  const header = /<header\b[^>]*class=["'][^"']*ai-tutor-header[^"']*["'][^>]*>([\s\S]*?)<\/header>/.exec(page);
  assert(header, "missing AI Tutor top toolbar");
  requireEvery(header[1], [">History</button>", "current-writing-title-window", "revision-progress"], "AI Tutor toolbar");
  assert(!/>Home<|>New<|header-back|header-new-writing|student-chip|header-actions/.test(header[1]),
    "Home, New, and student identity must not remain in the top toolbar");
  assert(/\.ai-tutor-header\s*\{[^}]*grid-template-columns/is.test(styles),
    "the sparse toolbar must keep a centered title between balanced edge columns");
});

check("History owns both Home and New actions", () => {
  const page = read(pagePath);
  const client = read(clientPath);
  const sidebar = /<aside\b[^>]*id=["']portfolio-sidebar["'][^>]*>([\s\S]*?)<\/aside>/.exec(page);
  assert(sidebar, "missing History drawer");
  requireEvery(sidebar[1], ["sidebar-actions", 'id="history-home"', ">Home</button>", 'id="history-new-writing"', "New"],
    "History navigation actions");
  assert(/history-new-writing[\s\S]{0,500}closeSidebar\(\)[\s\S]{0,120}createNewWriting\(\)/.test(client),
    "New from History must close the drawer before creating the Composition");
});

const publicActions = [
  "listCompositions",
  "createComposition",
  "discardEmptyComposition",
  "startPhotoUpload",
  "finishPhotoUpload",
  "startRevisionScanUpload",
  "finishRevisionScanUpload",
  "confirmRevisionScanImport",
  "extractOcr",
  "saveDraft",
  "evaluate",
  "submitRewrites",
  "updateCompositionTitle",
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

check("AI Tutor keeps one sparse top toolbar", () => {
  const page = read(pagePath);
  const client = read(clientPath);
  const header = /<header\b[^>]*class=["'][^"']*ai-tutor-header[^"']*["'][^>]*>([\s\S]*?)<\/header>/.exec(page);
  assert(header, "missing AI Tutor top toolbar");
  requireEvery(header[1], ["portfolio-toggle", "current-writing-title-window", "revision-progress"], "AI Tutor top toolbar");
  assert(!/brand-lockup|AI Tutor Writing Studio/i.test(`${page}\n${client}`),
    "the removed AI Tutor Writing Studio brand lockup must not remain in the writing workspace");
  assert(!/mobile-toolbar|mobile-context/.test(`${page}\n${client}`),
    "the writing workspace must not render a second mobile toolbar below the primary toolbar");
});

check("the open Composition survives refresh through an authenticated URL locator", () => {
  const client = read(clientPath);
  const locatorSource = functionSource(client, "requestedCompositionId", "syncCompositionLocator");
  const syncSource = functionSource(client, "syncCompositionLocator", "updateCurrentWritingTitleOverflow");
  const resetSource = functionSource(client, "resetDraft", "discardCurrentEmptyComposition");
  const homeSource = functionSource(client, "returnToTutorHome", "createNewWriting");
  const loadSource = functionSource(client, "loadComposition", "renderFatalAction");
  const initSource = functionSource(client, "init");
  requireEvery(locatorSource, ["URLSearchParams", "composition"], "Composition URL reader");
  requireEvery(syncSource, ["history.replaceState", "searchParams.set('composition'", "searchParams.delete('composition'"],
    "Composition URL writer");
  assert(/syncCompositionLocator\s*\(\s*compositionId\s*\(\s*state\.current\s*\)\s*\)/.test(resetSource),
    "opening or creating a Composition must store its locator in the current URL");
  assert(/syncCompositionLocator\s*\(\s*['\"]['\"]\s*\)/.test(homeSource),
    "returning to the AI Tutor home must clear the Composition locator");
  requireEvery(initSource, ["requestedCompositionId()", "loadComposition(requestedId)"],
    "refresh restoration");
  assert(/COMPOSITION_NOT_FOUND[\s\S]{0,500}syncCompositionLocator\s*\(\s*['\"]['\"]\s*\)/.test(loadSource),
    "a stale empty locator must be cleared instead of trapping the student on an error page");
});

check("the toolbar shows and safely scrolls the current AI-generated title", () => {
  const page = read(pagePath);
  const client = read(clientPath);
  const styles = read(stylePath);
  requireEvery(page, ["current-writing-title-window", "current-writing-title-track"], "current writing title markup");
  assert(/portfolio-toggle[\s\S]*current-writing-title-window[\s\S]*revision-progress/.test(page),
    "the current title must remain between History and the right-edge percentage");
  const titleSource = functionSource(client, "updateCurrentWritingTitle", "sentencePalette");
  requireEvery(titleSource, ["editableCompositionTitle(state.current)", "document.title", "aria-label"],
    "current writing title projection");
  requireEvery(client, ["scrollWidth", "clientWidth", "ResizeObserver", "prefers-reduced-motion"],
    "responsive title overflow behavior");
  assert(/\.current-writing-title-window\s*\{[^}]*min-width\s*:\s*0[^}]*overflow\s*:\s*hidden/is.test(styles)
      && /\.ai-tutor-header\s*\{[^}]*grid-template-columns\s*:[^;}]*minmax\(0,3fr\)/is.test(styles),
    "the toolbar title must shrink within the available mobile width");
  assert(/\.current-writing-title-window\.is-overflowing\s+\.current-writing-title-track\s*\{[^}]*animation[^}]*infinite\s+alternate/is.test(styles),
    "long titles must move horizontally with pauses in both directions");
  const reducedMotion = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/i.exec(styles);
  assert(reducedMotion && /current-writing-title-track[\s\S]*text-overflow\s*:\s*ellipsis/i.test(reducedMotion[1]),
    "reduced-motion users must receive a stable ellipsis instead of title animation");
});

check("toolbar percentage measures accepted required revisions only", () => {
  const page = read(pagePath);
  const client = read(clientPath);
  const styles = read(stylePath);
  const summarySource = functionSource(client, "revisionProgressSummary", "updateRevisionProgress");
  const updateSource = functionSource(client, "updateRevisionProgress", "sentencePalette");
  requireEvery(page, ['id="revision-progress"', "hidden"], "revision percentage output");
  requireEvery(summarySource, ["rewriteRequired(sentence)", "accepted === true", "completed / total", "Math.round"],
    "required-sentence progress calculation");
  requireEvery(updateSource, ["progress.percentage + '%'", "progress.completed", "progress.total", "progress.remaining", "aria-label"],
    "revision progress display and accessible detail");
  assert(/\.revision-progress\s*\{[^}]*justify-self\s*:\s*end[^}]*font-variant-numeric\s*:\s*tabular-nums/is.test(styles),
    "the percentage must remain stable at the far-right edge of the toolbar");
  assert(!/统一检查完成：只需要再处理标记为/.test(client),
    "the removed post-Check instruction must not appear below the toolbar");
});

check("portfolio is a dismissible fixed drawer at every viewport", () => {
  const page = read(pagePath);
  const client = read(clientPath);
  const styles = read(stylePath);
  requireEvery(page, [
    'id="portfolio-toggle"', 'aria-expanded="false"', 'aria-controls="portfolio-sidebar"',
    'id="portfolio-sidebar"', 'id="sidebar-close"', 'id="sidebar-scrim"', "hidden",
  ], "portfolio drawer markup");
  assert(/\.portfolio-sidebar\s*\{[^}]*position\s*:\s*fixed[^}]*(?:transform\s*:\s*translateX|visibility\s*:\s*hidden)/is.test(styles),
    "portfolio must default to a hidden fixed drawer, including on iPad and desktop");
  assert(/\.portfolio-sidebar\.is-open\s*\{[^}]*(?:translateX\s*\(\s*0\s*\)|visibility\s*:\s*visible)/is.test(styles),
    "the drawer needs one explicit open state");
  assert(!/@media[^{}]*\([^)]*min-width[^)]*\)[\s\S]{0,1400}\.portfolio-sidebar\s*\{[^}]*(?:position\s*:\s*(?:sticky|relative|static)|transform\s*:\s*none|visibility\s*:\s*visible)/i.test(styles),
    "wide-screen media rules must not pin the portfolio open");
  requireEvery(client, ["openSidebar", "closeSidebar", "portfolioToggle", "sidebar-close", "sidebarScrim", "Escape"],
    "portfolio drawer interactions");
  assert(/portfolioToggle\.addEventListener\s*\(\s*["']click["'][\s\S]{0,240}(?:openSidebar|closeSidebar)/.test(client),
    "portfolio toolbar button must toggle the drawer");
  assert(/sidebar-close[^\n]{0,160}addEventListener\s*\(\s*["']click["'][^\n]{0,120}closeSidebar/.test(client),
    "drawer close button must hide the portfolio");
  assert(/sidebarScrim\.addEventListener\s*\(\s*["']click["']\s*,\s*closeSidebar/.test(client),
    "clicking the scrim must hide the portfolio");
  assert(/event\.key\s*={2,3}\s*["']Escape["'][\s\S]{0,240}state\.sidebarOpen[\s\S]{0,120}closeSidebar/.test(client),
    "Escape must hide an open portfolio drawer");
});

check("History Home uses a custom confirmation before Dashboard navigation", () => {
  const page = read(pagePath);
  const client = read(clientPath);
  const homeTag = /<button\b[^>]*id=["']history-home["'][^>]*>/i.exec(page);
  assert(homeTag, "History Home must be a button so it cannot navigate immediately");
  assert(!/<a\b[^>]*id=["']history-home["']/i.test(page),
    "History Home must not be a direct Dashboard anchor");
  requireEvery(page, ["leave-confirmation", "role=\"alertdialog\"", "aria-modal=\"true\"", "data-cancel-leave", "data-confirm-leave"],
    "custom leave-confirmation dialog");
  assert(/matches\s*\(\s*["']#history-home["']\s*\)[\s\S]{0,120}(?:openLeave|showLeave|confirm)/i.test(client),
    "clicking History Home must open the custom confirmation dialog");
  assert(/data-confirm-leave[\s\S]{0,180}(?:confirmLeave|dashboard\.html|window\.location)/i.test(client)
      && /function\s+confirmLeave\s*\([^)]*\)[\s\S]{0,400}(?:dashboard\.html|window\.location)/i.test(client),
    "only the dialog confirmation action may navigate back to Dashboard");
  assert(!/history-home[^\n]{0,400}(?:href\s*=\s*["'][^"']*dashboard|location\.(?:href|assign|replace)\s*\(?\s*["'][^"']*dashboard)/i.test(`${page}\n${client}`),
    "History Home must not navigate directly before confirmation");
});

check("History Home and Leave dialog use the approved red and Apple-style treatment", () => {
  const page = read(pagePath);
  const styles = read(stylePath);
  assert(/\.sidebar-home-action\s*\{[^}]*color\s*:\s*#(?:c9403a|aa4141)/i.test(styles),
    "Home inside History must retain the red leave-navigation treatment");
  requireEvery(page, [">Cancel<", ">Leave<"], "Leave dialog actions");
  assert(/\.confirmation-dialog\s*\{[^}]*width\s*:\s*min\(320px[^}]*border-radius\s*:\s*22px/is.test(styles),
    "Leave dialog must use the compact 320px Apple-style glass box");
  assert(/\.confirmation-actions\s*\{[^}]*grid-template-columns\s*:\s*repeat\(2[^}]*border-top/is.test(styles),
    "Cancel and Leave must use the split-button action row");
  assert(/\.confirmation-cancel\s*\{[^}]*color\s*:\s*var\(--ai-accent\)/i.test(styles)
      && /\.confirmation-leave\s*\{[^}]*color\s*:\s*#c9403a/i.test(styles),
    "Cancel must be green and Leave must be red");
});

check("portfolio titles support inline student editing through updateCompositionTitle", () => {
  const client = read(clientPath);
  const renderSource = functionSource(client, "renderPortfolio", "renderWritingProfile");
  requireEvery(renderSource, ["portfolio-title-form", "data-edit-title", "data-cancel-title"],
    "inline portfolio title editor");
  assert(/writingCall\s*\(\s*["']updateCompositionTitle["']/.test(client),
    "saving the inline title editor must call updateCompositionTitle");
  assert(/addEventListener\s*\(\s*["']submit["'][\s\S]{0,1800}(?:data-title-form|portfolio-title-form)/.test(client)
      || /(?:data-title-form|portfolio-title-form)[\s\S]{0,1800}writingCall\s*\(\s*["']updateCompositionTitle["']/.test(client),
    "the inline form submit path must save the edited title");
});

check("Writing home is an action-first adaptive workspace", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const welcome = functionSource(client, "renderWelcome", "welcomeGreeting");
  requireEvery(welcome, [
    "Ready to keep writing?", "welcomeContinueHtml", "Start New", "Polishing", "Brainstorming",
    "welcomeRecentHtml", "welcomeWritingFocusHtml",
  ], "Writing home workspace");
  requireEvery(client, ["Recent Writing", "Writing Focus", "See All"], "Writing home secondary sections");
  assert(!/YOUR AI WRITING STUDIO|拍照或输入|两种批改|亲手重写/.test(welcome),
    "the permanent feature-marketing hero must not return to Writing home");
  requireEvery(styles, [
    ".writing-home-dashboard", 'grid-template-areas: "continue start" "recent focus"',
    ".writing-home-continue", ".writing-mode-card", ".writing-recent-list", ".writing-focus-list",
  ], "Writing home responsive layout");
  assert(/@media\s*\(max-width:\s*980px\)[\s\S]{0,1600}grid-template-areas:\s*"continue"\s*"start"\s*"recent"\s*"focus"/i.test(styles),
    "phone and narrow tablet layouts must preserve the approved action order");
});

check("Writing home quick-start persists the selected review mode", () => {
  const client = read(clientPath);
  const backend = read("cloudfunctions/writingTutor/index.js");
  const createClient = functionSource(client, "createNewWriting", "renderSource");
  const createServer = functionSource(backend, "createComposition", "listCompositions");
  requireEvery(client, ['data-start-mode="language"', 'data-start-mode="standardized"', "button.getAttribute('data-start-mode')"],
    "Writing home mode actions");
  requireEvery(createClient, ["selectedMode", "apiMode(selectedMode)", "composition.assessment_mode"],
    "mode-aware Composition creation");
  requireEvery(createServer, ["event.assessment_mode", "general_language", "standardized_content", "ASSESSMENT_MODE_INVALID", "assessment_mode: assessmentMode"],
    "server-persisted initial review mode");
});

check("the two evaluation modes use the approved product labels", () => {
  const ui = `${read(pagePath)}\n${read(clientPath)}`;
  requireEvery(ui, ["Polishing", "Brainstorming"], "AI Tutor UI");
});

check("the first writing screen keeps only the compact source controls", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const renderSource = functionSource(client, "renderSource", "rubricOptions");
  const textSource = functionSource(client, "textSourceHtml", "photoSourceHtml");
  requireEvery(renderSource, [
    "source-mode-switch", "Polishing", "Brainstorming", "Type", "Scan",
    "Title", "field-optional", "Optional", "data-discard-source", ">Discard</button>",
    "state.inputMethod === 'photo' ? 'Scan' : 'Submit'",
  ], "compact Writing source screen");
  requireEvery(textSource, ["Your Writing", "writing-text", "Type or paste your writing here…"], "language text-entry field");
  assert(!/NEW WRITING|这一次想练什么|第 1 步|选择批改方式|保存并开始批改|上传并识别文字/.test(renderSource),
    "the source screen must not restore the removed heading, step, labels, or verbose submit copy");
  assert(/standardized\s*\?\s*'<label class="field"><span>作文题目/.test(renderSource),
    "Writing Prompt must render only for standardized mode");
  requireEvery(styles, [".source-discard-button", "color: #c9403a", ".source-form-actions"],
    "compact red Discard treatment");
});

check("photo entry opens the native camera, stages multiple pages, and scans only on submit", () => {
  const client = read(clientPath);
  const photoSource = functionSource(client, "photoSourceHtml", "sourcePayload");
  requireEvery(photoSource, [
    "data-writing-photo-input", "data-writing-photo-camera", 'capture="environment"',
    "Take a Photo", "Take Another Photo", "Choose from Library", "multiple",
    "source-photo-card-actions", "Page ", "state.photoUrls.length", "Remove",
  ], "photo staging controls");
  assert(!/data-move-photo|前移|后移|移除/.test(photoSource),
    "initial photo staging must not expose reorder controls or Chinese remove copy");
  assert(!/button\.matches\(\s*["']\[data-move-photo\]["']\s*\)/.test(client),
    "removed photo reorder controls must not leave a dead click handler");
  assert(/\.source-photo-card-actions\s*\{[^}]*justify-content:\s*flex-end/.test(read(stylePath)),
    "the initial photo Remove action must align to the bottom-right");
  assert(/inputMethod:\s*["']text["']/.test(client), "direct text entry must be the default");
  assert(/target\.matches\(\s*["']\[data-writing-photo-input\]["']\s*\)/.test(client),
    "both camera and library inputs must stage selected photos");
  assert(/button\.matches\(\s*["']\[data-input-method\]["']\s*\)[\s\S]{0,500}renderSource\(\)[\s\S]{0,500}querySelector\(\s*["']\[data-writing-photo-camera\]["']\s*\)[\s\S]{0,300}cameraInput\.click\(\)/.test(client),
    "selecting Scan mode must synchronously open the rear-camera input");
  assert(/if\s*\(state\.inputMethod === ["']photo["']\)\s*uploadAndExtract\(\)/.test(client),
    "OCR must start only when the source form is explicitly submitted");
});

check("Discard confirms only when the source contains student input", () => {
  const client = read(clientPath);
  const requestSource = functionSource(client, "requestSourceDiscard", "openLeaveConfirmation");
  const dialogSource = functionSource(client, "openLeaveConfirmation", "closeLeaveConfirmation");
  const confirmSource = functionSource(client, "confirmLeave", "updateSourceState");
  requireEvery(requestSource, ["sourceHasUserInput", "returnToTutorHome", "openLeaveConfirmation('discard')"],
    "conditional source Discard confirmation");
  requireEvery(dialogSource, ["Discard this writing?", "Your saved draft will stay in History", "Discard"],
    "Discard confirmation copy");
  requireEvery(confirmSource, ["leaveDialogAction", "window.clearTimeout(state.autosaveTimer)", "returnToTutorHome"],
    "confirmed source Discard action");
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

check("OCR Review is a focused paragraph editor with inline uncertainty marks", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const renderSource = functionSource(client, "renderOcr", "saveAndEvaluate");
  requireEvery(renderSource, [
    "OCR Review", "Compare with Image", "contenteditable=\"true\"",
    "data-confirm-ocr", ">Confirm</button>",
  ], "focused OCR Review controls");
  assert(!/Upload Again|Confirm Text &amp; Start Review/.test(renderSource),
    "OCR Review must expose only the centered Confirm footer action");
  assert(!/先确认识别文字|第 2 步|有 ['\"] \+ uncertainCount|可编辑 OCR 文本|请自行修正识别错误/.test(renderSource),
    "OCR Review must not restore the removed heading, step, count, or editor-label fields");
  requireEvery(client, ["ocrEditorHtml", "ocrUncertainRanges", "data-ocr-uncertain", "ocrEditorText"],
    "inline OCR uncertainty handling");
  requireEvery(styles, [".ocr-uncertain", ".ocr-text-editor > p", "margin: 0 0 1em"],
    "uncertain highlight and one-Enter paragraph spacing");
  assert(/\.ocr-review-actions\s*\{[^}]*justify-content\s*:\s*center/i.test(styles),
    "the sole OCR Review Confirm action must be centered");
  assert(/\.ocr-uncertain\s*\{[^}]*color\s*:\s*#a52634[^}]*background\s*:\s*rgba\(218,55,69,\.16\)/i.test(styles),
    "uncertain OCR spans must use the approved red text and pale-red fill");
});

check("language review renders exactly three primary cards in the approved order", () => {
  const client = read(clientPath);
  const renderSource = functionSource(client, "renderLanguage", "sentenceCapsuleHtml");
  const cardMarkers = Array.from(renderSource.matchAll(/language-(overall|manuscript|sentence-review)-card/g), (match) => match[1]);
  assert.deepStrictEqual(cardMarkers, ["overall", "manuscript", "sentence-review"],
    "language review must render only the overall, original-manuscript, and sentence-review primary cards, in that order");
  requireEvery(renderSource, ["Language Review", "Draft", "Sentence Revision"], "language review card headings");
  assert(!/整体评价|>原文<|句子批改/.test(renderSource),
    "the three language-review card titles must use only the approved English names");

  const overallIndex = renderSource.indexOf("language-overall-card");
  const manuscriptIndex = renderSource.indexOf("language-manuscript-card");
  const sentenceReviewIndex = renderSource.indexOf("language-sentence-review-card");
  assert(overallIndex < manuscriptIndex && manuscriptIndex < sentenceReviewIndex,
    "language review primary cards must stay ordered as overall, manuscript, then sentence correction");
  requireEvery(renderSource, ["cefr_estimate", "CEFR Writing Estimate", "lower: '-'", "middle: ''", "upper: '+'"],
    "CEFR writing estimate presentation");
  assert(!/偏下|中段|偏上/.test(renderSource),
    "the student-facing CEFR level must use compact minus/base/plus notation instead of Chinese position labels");
  assert(renderSource.indexOf("cefrHtml") < renderSource.indexOf("state.review && state.review.overview"),
    "the CEFR writing estimate must appear before the general Language Review overview");
});

check("each revision-required sentence renders only source, consolidated analysis, and response area", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const cardSource = functionSource(client, "sentenceCardHtml", "submitRewrites");
  requireEvery(cardSource, [
    "original-sentence", "sentence-row-number", "index + 1", "grammar-analysis", "grammar-analysis-copy", "analysisParts",
    "sentence.coaching_summary", "issue && issue.explanation", "issue && issue.suggestion",
    "sentenceRewriteFeedbackHistory", "rewrite-feedback-round",
    "sentence-response", "rewrite-input", "Your Attempt",
  ], "three-part sentence row");
  assert(/\.rewrite-area label\s*\{[^}]*color\s*:\s*var\(--ai-muted\)/is.test(styles),
    "Your Attempt must use the muted supporting-text color");
  assert(!/grammar-analysis-label|grammar-analysis-point|grammar-analysis-summary|grammar-analysis-result|issue\.category|result\.next_step/.test(cardSource),
    "the grammar box must not render headings, categories, split feedback blocks, or English result enums");
  requireEvery(styles, [".grammar-analysis", ".grammar-analysis-copy", ".sentence-response"],
    "single-paragraph grammar analysis styles");
  assert(!cardSource.includes("次点评"),
    "saved feedback rounds must not expose ordinal labels in the student interface");
  assert(/\.rewrite-feedback-round\s*\+\s*\.rewrite-feedback-round\s*\{[^}]*border-top\s*:\s*1px\s+solid/is.test(styles),
    "a visible divider must appear only between consecutive submitted feedback rounds");
  assert(!/\.rewrite-feedback-round\s*>\s*span\s*\{/.test(styles),
    "the removed feedback-round label must not retain presentation styles");
  assert(!/\.grammar-analysis-(?:label|point|points|summary|result)\s*\{|\.issue-list\s*\{|\.coaching-summary\s*\{|\.sentence-feedback\s*\{/.test(styles),
    "legacy split grammar-feedback styles must be removed");
});

check("each revision-required sentence is one accessible two-face card", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const cardSource = functionSource(client, "sentenceCardHtml", "submitRewrites");
  requireEvery(cardSource, [
    "sentence-flip-card", "sentence-card-inner", "sentence-card-face", "sentence-analysis-face",
    "sentence-rewrite-face", "sentence-face-flip-hit", "grammar-analysis", "rewrite-input", "data-flip-sentence",
  ], "sentence flip-card markup");
  assert((cardSource.match(/<article/g) || []).length <= 1,
    "a revision-required sentence must not split its analysis and input into separate article cards");
  assert(/sentence-analysis-face[\s\S]*grammar-analysis/.test(cardSource)
      && /sentence-rewrite-face[\s\S]*editableResponse/.test(cardSource)
      && /editableResponse[\s\S]*rewrite-input/.test(cardSource),
    "the analysis and rewrite faces must live inside the same sentence card");
  const rewriteFaceStart = cardSource.indexOf("sentence-rewrite-face");
  const rewriteFaceEnd = cardSource.indexOf("</section>", rewriteFaceStart);
  const rewriteFaceSource = cardSource.slice(rewriteFaceStart, rewriteFaceEnd);
  assert(rewriteFaceStart >= 0 && /editableResponse/.test(rewriteFaceSource),
    "the back face must contain the student's rewrite input");
  assert(!/grammar-analysis|analysisCopy|coaching_summary|issue\.explanation|issue\.suggestion/.test(rewriteFaceSource),
    "the rewrite face must not expose the sentence analysis at the same time");
  requireEvery(cardSource, ["aria-hidden", "aria-controls", "aria-pressed"], "flip-card accessibility state");
  assert(/<button[^>]*data-flip-sentence/.test(cardSource),
    "card flipping must use native keyboard-operable buttons");
  assert(/data-flip-sentence[\s\S]{0,1800}(?:state\.[A-Za-z_$][\w$]*Faces|state\.[A-Za-z_$][\w$]*Face)[\s\S]{0,600}renderLanguage/.test(client),
    "clicking a flip control must toggle that sentence's face and rerender it");

  requireEvery(styles, [".sentence-flip-card", ".sentence-card-inner", ".sentence-card-face", "backface-visibility", "rotateY(180deg)"],
    "physical two-face card styling");
  assert(/\.sentence-card-inner(?:\.is-flipped|\.show-rewrite|\[data-face=[^\]]+\])\s*\{[^}]*transform\s*:\s*rotateY\(180deg\)/is.test(styles),
    "the rewrite state must visibly turn the shared card to its other face");
});

check("sentence-card flipping honors keyboard, ARIA, and reduced-motion preferences", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const cardSource = functionSource(client, "sentenceCardHtml", "submitRewrites");
  assert(/<button[^>]*data-flip-sentence[^>]*(?:aria-label|aria-controls)[^>]*>/.test(cardSource)
      || /<button[^>]*(?:aria-label|aria-controls)[^>]*data-flip-sentence[^>]*>/.test(cardSource),
    "every flip action needs a native button and an accessible relationship or name");
  assert(/aria-hidden=["'][^"']*(?:showRewrite|rewriteFace|face)[^"']*["']|aria-hidden=["']\s*["']\s*\+/.test(cardSource),
    "the inactive card face must be hidden from assistive technology");
  const reducedMotionStart = styles.search(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  const reducedMotionEnd = styles.indexOf("@media", reducedMotionStart + 10);
  const reducedMotion = styles.slice(reducedMotionStart, reducedMotionEnd >= 0 ? reducedMotionEnd : styles.length);
  assert(reducedMotionStart >= 0, "missing prefers-reduced-motion rules");
  assert(/sentence-card-inner|sentence-flip-card/.test(reducedMotion)
      && /transition(?:-duration)?\s*:\s*(?:none|0s|\.01ms)(?:\s*!important)?/.test(reducedMotion),
    "reduced-motion mode must remove the card-turn transition");
});

check("phone rewrite focus leaves the sentence card lower than tablet layout", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const focusSource = functionSource(client, "focusSentenceRewriteTarget", "renderLanguage");
  requireEvery(focusSource, ["max-width: 600px", "preventScroll", "scrollIntoView", "block: 'start'"],
    "phone-only rewrite focus alignment");
  assert(/@media\s*\(max-width:\s*600px\)\s*\{[\s\S]{0,240}\.sentence-card\s*\{[^}]*scroll-margin-top\s*:\s*136px/i.test(styles),
    "phone cards must use the lower 136px rewrite-focus offset");
  assert(/if\s*\(!phoneLayout\)\s*\{[\s\S]{0,120}target\.focus\(\)/.test(focusSource),
    "iPad and desktop focus behavior must remain unchanged");
});

check("sentence rewrite drafts persist by Composition revision and restore on reopen", () => {
  const client = read(clientPath);
  const keySource = matchingFunctionSource(client, "rewriteDraftStorageKey", "rewrite-draft storage key");
  const saveSource = matchingFunctionSource(client, "saveRewriteDraftSnapshot", "rewrite-draft save function");
  const restoreSource = matchingFunctionSource(client, "restoreRewriteDraftSnapshot", "rewrite-draft restore function");
  const restoreStateSource = functionSource(client, "restoreLanguageReviewState", "prepareLanguageReview");
  const prepareSource = functionSource(client, "prepareLanguageReview", "sentenceId");
  requireEvery(keySource, ["compositionId", "revision"], "rewrite-draft identity");
  assert(/compositionId\s*\([^)]*\)[\s\S]{0,300}(?:\.revision|revision)|(?:\.revision|revision)[\s\S]{0,300}compositionId\s*\(/.test(keySource),
    "rewrite draft keys must include both composition_id and revision");
  requireEvery(saveSource, ["localStorage", "setItem", "state.rewrites", "rewriteDraftStorageKey"],
    "rewrite-draft persistence");
  assert(!/sessionStorage/.test(`${saveSource}\n${restoreSource}`),
    "sentence drafts must survive closing the browser, not only the current tab session");
  requireEvery(restoreSource, ["localStorage", "getItem", "state.rewrites", "rewriteDraftStorageKey"],
    "rewrite-draft restoration");
  assert(/data-rewrite-id[\s\S]{0,500}saveRewriteDraftSnapshot\s*\(/.test(client),
    "every sentence textarea input must synchronously update its saved browser draft");
  assert(/restoreRewriteDraftSnapshot\s*\(/.test(restoreStateSource)
      && /restoreLanguageReviewState\s*\(/.test(prepareSource),
    "opening a saved language review must restore its sentence drafts before rendering");
});

check("Check snapshots sentence drafts before starting the durable rewrite request", () => {
  const client = read(clientPath);
  const backend = read(functionPath);
  const submitSource = matchingFunctionSource(client, "submitRewrites", "submitRewrites client action");
  const enqueueSource = matchingFunctionSource(backend, "enqueue[A-Z\\w]*Rewrite[A-Z\\w]*Job", "rewrite-job enqueue function");
  const performSource = matchingFunctionSource(backend, "performRewriteJob", "rewrite-job processor function");
  const saveIndex = submitSource.indexOf("saveRewriteDraftSnapshot");
  const requestIndex = submitSource.indexOf("writingCall('submitRewrites'");
  assert(saveIndex >= 0 && requestIndex > saveIndex,
    "Check must synchronously save the exact local submission snapshot before the network request");
  requireEvery(enqueueSource, ["pending_rewrite_check", "items", "runTransaction", "invokeFunctionAsync"],
    "durable rewrite submission snapshot");
  const pendingWriteIndex = enqueueSource.indexOf("pending_rewrite_check: pending");
  const dispatchIndex = enqueueSource.lastIndexOf("invokeFunctionAsync");
  assert(pendingWriteIndex >= 0 && dispatchIndex > pendingWriteIndex,
    "pending_rewrite_check must be durably stored before the rewrite worker is dispatched");
  const pendingReadIndex = performSource.indexOf("pending_rewrite_check");
  const modelIndex = performSource.indexOf("callStructuredModel");
  assert(pendingReadIndex >= 0 && modelIndex > pendingReadIndex,
    "performRewriteJob must load the durable pending snapshot before calling the model");
});

check("rewrite draft cleanup removes only accepted sentences and retains failures", () => {
  const client = read(clientPath);
  const cleanupSource = matchingFunctionSource(client, "clearAcceptedRewriteDrafts", "accepted rewrite-draft cleanup");
  const successSource = matchingFunctionSource(client, "applyRewriteResult", "rewrite success application");
  const failureSource = matchingFunctionSource(client, "renderRewriteFailure", "rewrite failure UI");
  const submitSource = matchingFunctionSource(client, "submitRewrites", "submitRewrites client action");
  requireEvery(cleanupSource, ["accepted", "state.rewrites", "delete", "saveRewriteDraftSnapshot"],
    "accepted-only rewrite draft cleanup");
  assert(/accepted\s*={2,3}\s*true[\s\S]{0,300}delete\s+state\.rewrites|if\s*\([^)]*accepted[^)]*\)[\s\S]{0,300}delete\s+state\.rewrites/.test(cleanupSource),
    "rejected or unchecked sentence drafts must not be deleted");
  assert(/clearAcceptedRewriteDrafts\s*\(/.test(successSource),
    "successful rewrite results must prune their accepted local drafts");
  assert(!/clearAcceptedRewriteDrafts|localStorage\.removeItem/.test(failureSource),
    "terminal AI failure must retain all local sentence drafts");
  const networkIndex = submitSource.search(/isNetworkDisconnect\s*\(\s*error\s*\)/);
  const networkReturnIndex = submitSource.indexOf("return", networkIndex);
  const cleanupIndex = submitSource.indexOf("clearAcceptedRewriteDrafts", networkIndex);
  assert(networkIndex >= 0 && networkReturnIndex > networkIndex
      && (cleanupIndex < 0 || networkReturnIndex < cleanupIndex),
    "network-disconnect recovery must return without clearing any sentence drafts");
});

check("effective sentences use the static CORRECT status and no coaching controls", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const cardSource = functionSource(client, "sentenceCardHtml", "submitRewrites");
  const effectiveStart = cardSource.indexOf("if (!required)");
  const effectiveEnd = cardSource.indexOf("var visibility");
  const effectiveBranch = cardSource.slice(effectiveStart, effectiveEnd);
  requireEvery(effectiveBranch, [
    "sentence-flip-card", "sentence-card-inner-static", "sentence-card-face",
    "sentence-effective-face", "sentenceMeta",
  ],
    "effective sentence summary");
  assert(!/grammar-analysis|sentence-response|rewrite-input|Your Attempt/.test(effectiveBranch),
    "effective sentences must not render analysis or rewrite controls");
  assert(!/data-flip-sentence/.test(effectiveBranch),
    "already-correct source sentences must use the same bordered card without pretending to have another face");
  assert(!/no-rewrite-needed/.test(`${client}\n${styles}`),
    "the removed disabled no-rewrite textarea must not remain in source or styles");
  assert(/function rewriteRequired[\s\S]{0,260}["']effective["']/.test(client),
    "legacy effective sentences without rewrite_required must remain exempt from rewriting");
  requireEvery(styles, [".sentence-card.is-effective .original-sentence", ".sentence-state.is-correct"],
    "effective sentence styling");
  requireEvery(cardSource, ["'correct'", "'CORRECT'", "revisionMark", "'✓'", "sentence-state-mark"],
    "CORRECT status label");
  assert(!/sentence-effective-icon|sentence-corrected-icon/.test(`${client}\n${styles}`),
    "checks must live after the status label rather than inline after sentence text");
  assert(!/thumbUp/.test(client), "the superseded thumbs-up icon must be removed");
});

check("sentence correction has one list mode and no layout-switch controls", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const renderSource = functionSource(client, "renderLanguage", "sentenceCapsuleHtml");
  assert(/class=["']sentence-list["']/.test(renderSource), "sentence corrections must render as the default list");
  assert(!/data-layout|view-toggle|state\.layout|data-next-sentence/.test(client),
    "sentence correction must not expose the removed layout or next-sentence controls");
  assert(!/sentence-list\.sequential|\.sentence-list\s*\.sequential/.test(styles),
    "styles must not retain a sequential-only sentence mode");
});

check("sentence number navigation is horizontal, accessible, and locates its list row", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const renderSource = functionSource(client, "renderLanguage", "sentenceCapsuleHtml");
  const capsuleSource = functionSource(client, "sentenceCapsuleHtml", "sentenceCardHtml");
  requireEvery(renderSource, ["句子导航", "capsule-row", "sentenceCapsuleHtml"], "sentence number navigation");
  requireEvery(capsuleSource, ["data-sentence-index", "aria-label", "aria-current"], "sentence number button");
  requireEvery(capsuleSource, ["is-done", "capsuleStatus", "，已完成"], "sentence completion status");
  assert(/data-sentence-index[\s\S]{0,1800}scrollIntoView/.test(client),
    "clicking a sentence number must scroll the corresponding list row into view");
  assert(/\.capsule-row\s*\{[^}]*overflow-x\s*:\s*auto/i.test(styles),
    "sentence numbers must support horizontal scrolling");
  assert(/\.capsule-row\s*\{[^}]*(?:-webkit-overflow-scrolling\s*:\s*touch|touch-action\s*:\s*pan-x)/i.test(styles),
    "sentence number scrolling must preserve native touch momentum or horizontal pan behavior");
  assert(!/language-toolbar-bottom|progress-copy|capsule-hint|已填写|左右滑动数字/.test(`${client}\n${styles}`),
    "the capsule bar must not show progress copy or navigation instructions beneath the numbers");
  assert(/\.sentence-capsule\s*\{[^}]*border\s*:\s*1px\s+solid/is.test(styles),
    "every sentence capsule must use the same one-pixel solid border");
  assert(!/\.sentence-capsule\.is-done[^}]*\{[^}]*(?:inset|border-width)/is.test(styles)
      && !/\.sentence-capsule\.is-review[^}]*\{[^}]*border-style\s*:\s*dashed/is.test(styles),
    "done and review states must not visually thicken or dash the capsule border");
  assert(/\.sentence-capsule\.is-done::after\s*\{[^}]*content\s*:\s*["']✓["']/is.test(styles),
    "completed capsules must show a small checkmark beneath the number");
  assert(/\.sentence-capsule\.is-done::after\s*\{[^}]*color\s*:\s*var\(--ai-success\)/is.test(styles),
    "completed capsule checks must always use semantic green");
  assert(/\.sentence-capsule\.is-review::after,\s*\.sentence-capsule\.has-gap::after\s*\{[^}]*content\s*:\s*["']×["'][^}]*color\s*:\s*var\(--ai-danger\)/is.test(styles),
    "unresolved capsules must show a semantic red cross beneath the number");
  assert(/\.capsule-row\s*\{[^}]*padding\s*:[^;}]*16px/is.test(styles),
    "the capsule row must reserve space for its status marks");
});

check("every Sentence Revision row keeps its indexed soft background without a left accent line", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const cardSource = functionSource(client, "sentenceCardHtml", "submitRewrites");
  requireEvery(cardSource, ["sentenceColorStyle(index)", "sentence-card"], "indexed sentence-card color binding");
  assert(/\.sentence-card\s*\{[^}]*background\s*:\s*var\(--sentence-soft\)[^}]*box-shadow\s*:\s*none/is.test(styles),
    "every sentence row must show its pale indexed background before interaction");
  assert(/\.sentence-card\.is-active\s*\{[^}]*background\s*:\s*var\(--sentence-soft\)/is.test(styles),
    "navigation focus must preserve rather than introduce the row background");
  assert(!/\.sentence-card[^}]*box-shadow\s*:[^;}]*inset[^;}]*var\(--sentence-color\)/is.test(styles),
    "sentence rows must not render the former dark indexed line on the left");
});

check("Sentence Revision numbers every row and ends with one Submit action", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const renderSource = functionSource(client, "renderLanguage", "sentenceCapsuleHtml");
  const cardSource = functionSource(client, "sentenceCardHtml", "submitRewrites");
  requireEvery(cardSource, ["sentenceNumber", "sentence-card-meta", "sentence-row-number", "aria-hidden=\"true\""],
    "sentence-row numbering");
  assert((cardSource.match(/sentenceMeta/g) || []).length >= 4,
    "required and effective sentence rows must share the same top metadata row");
  assert(/data-submit-rewrites[^>]*>Submit<\/button>/.test(renderSource),
    "the editable footer must expose exactly the concise Submit action");
  assert(!/未完成的句子|全部完成，提交检查|再次提交检查|icon\('arrow'\)/.test(renderSource),
    "the footer must remove the old hint, dynamic labels, and arrow icon");
  assert(/\.batch-actions\s*\{[^}]*justify-content\s*:\s*flex-end/is.test(styles),
    "the lone desktop Submit action must align to the trailing edge");
  assert(/\.sentence-row-number\s*\{[^}]*(?:display\s*:\s*inline-block)[^}]*border\s*:\s*0[^}]*border-radius\s*:\s*0[^}]*background\s*:\s*transparent/is.test(styles),
    "sentence rows must use the BBC worksheet-style plain sequence number rather than a capsule");
  assert(/\.sentence-card-meta\s*\{[^}]*display\s*:\s*flex/is.test(styles)
      && /\.sentence-card-meta\s*\{[^}]*justify-content\s*:\s*space-between/is.test(styles)
      && /\.sentence-card-meta\s*\{[^}]*align-items\s*:\s*baseline/is.test(styles),
    "the bare sequence number and revision status must share a compact top metadata row");
  assert(!/\.original-sentence,\s*\.corrected-sentence\s*\{[^}]*grid-template-columns/is.test(styles),
    "the number must not consume sentence width or alter wrapped line alignment");
});

check("accepted revisions default to the corrected sentence and show REVISED status", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const prepareSource = functionSource(client, "restoreLanguageReviewState", "prepareLanguageReview");
  const cardSource = functionSource(client, "sentenceCardHtml", "submitRewrites");
  requireEvery(prepareSource, ["stored.accepted === true", "state.rewriteFace[id] = true"],
    "accepted revision default face");
  requireEvery(cardSource, [
    "correctedSentence", "corrected-sentence", "sentence-corrected-highlight",
    "'revised'", "'REVISED'", "sentence-state-mark",
  ], "accepted corrected sentence");
  assert(/accepted\s*\?\s*correctedResponse\s*:\s*editableResponse/.test(cardSource),
    "accepted revisions must replace the input face with the persisted corrected sentence");
  requireEvery(styles, [".corrected-sentence", ".sentence-corrected-highlight", ".sentence-state.is-revised"],
    "accepted corrected sentence styling");
  assert(!/sentence-corrected-icon/.test(`${client}\n${styles}`),
    "accepted checks must not appear inline after the corrected sentence");
});

check("sentence cards expose three explicit top-right revision states", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const cardSource = functionSource(client, "sentenceCardHtml", "submitRewrites");
  requireEvery(cardSource, [
    "revisionState", "!required ? 'correct'", "accepted ? 'revised' : 'needs-revision'",
    "'CORRECT'", "'REVISED'", "'NEEDS REVISION'", "revisionMark",
    "revisionState === 'needs-revision' ? '×' : '✓'",
  ], "three-state revision label");
  requireEvery(styles, [
    ".sentence-state.is-correct", ".sentence-state.is-revised",
    ".sentence-state.is-needs-revision", "var(--ai-success)", "var(--ai-danger)",
  ], "revision state colors");
});

check("sentence flip cards resize to the active face without reserved blank space", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  requireEvery(client, [
    "function activeSentenceCardFace", "function syncSentenceCardHeight",
    "function observeSentenceCardHeights", "window.ResizeObserver", "face.offsetHeight",
    "has-measured-height", "window.requestAnimationFrame(observeSentenceCardHeights)",
  ], "active-face height measurement");
  const flipSource = client.slice(client.indexOf("else if (button.matches('[data-flip-sentence]'))"), client.indexOf("else if (button.matches('[data-sentence-index]'))"));
  requireEvery(flipSource, ["syncSentenceCardHeight(flipInner)", "observeSentenceCardHeights()"],
    "flip-time height synchronization");
  assert(/\.sentence-card-inner\s*\{[^}]*height\s+320ms\s+cubic-bezier\(\.22,1,\.36,1\)/is.test(styles),
    "height changes must use the restrained card transition");
  assert(/\.sentence-card-face\s*\{[^}]*align-self\s*:\s*start/is.test(styles),
    "the initial grid must preserve each face's natural content height for measurement");
  assert(/\.sentence-card-inner\.has-measured-height\s+\.sentence-card-face\s*\{[^}]*position\s*:\s*absolute/is.test(styles),
    "measured faces must stop reserving the hidden face's height");
});

check("sentence cards flip from the whole surface and keep Sample as the sole secondary action", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const cardSource = functionSource(client, "sentenceCardHtml", "submitRewrites");
  requireEvery(cardSource, [
    "sentence-face-flip-hit", "翻到句子改写面", "翻到句子分析面",
    "sample-action", "sample-button", ">Sample</button>",
  ], "whole-card flip and Sample controls");
  assert(!/我记住了，开始改写|返回查看分析|查看已订正句子|查看参考句|隐藏参考句/.test(cardSource),
    "the removed instructional flip buttons and old reference label must not render");
  assert(/grammar-analysis[\s\S]{0,1200}sampleButton\s*\+\s*reference/.test(cardSource),
    "Sample must sit immediately after the analysis and directly control the following reference panel");
  assert(/\.sentence-face-flip-hit\s*\{[^}]*position\s*:\s*absolute[^}]*inset\s*:\s*0[^}]*cursor\s*:\s*pointer/is.test(styles),
    "a native button must cover the available card surface");
  assert(/\.sample-action\s*\{[^}]*justify-content\s*:\s*flex-end/is.test(styles),
    "Sample must use the trailing analysis position");
  assert(/\.sentence-face-content[^}]*pointer-events\s*:\s*none/is.test(styles)
      && /\.sentence-face-content button[^}]*pointer-events\s*:\s*auto/is.test(styles),
    "Sample and form controls must remain independently interactive above the card flip surface");
});

check("sentence navigation replaces the primary toolbar when it reaches the top", () => {
  const styles = read(stylePath);
  assert(/\.language-toolbar\s*\{[^}]*position\s*:\s*sticky[^}]*z-index\s*:\s*100[^}]*top\s*:\s*0/is.test(styles),
    "the sentence-number toolbar must stick to the viewport top above the primary toolbar");
  assert(/\.language-sentence-review-card\s*\{[^}]*position\s*:\s*relative[^}]*z-index\s*:\s*90/is.test(styles),
    "the sticky sentence toolbar's card must sit above the primary toolbar stacking context");
  assert(!/@media\s*\(max-width:\s*760px\)[\s\S]{0,2400}\.language-toolbar\s*\{[^}]*top\s*:\s*(?:9|1[01])\dpx/i.test(styles),
    "mobile rules must not pin sentence navigation below the primary toolbar");
});

check("writing cards shrink to the phone viewport without horizontal page overflow", () => {
  const styles = read(stylePath);
  requireEvery(styles, [
    ".ai-tutor-main, .stage", ".language-review-stack", ".language-review-card, .sentence-list, .sentence-card",
    "overflow-wrap: anywhere", ".photo-preview-grid { grid-template-columns: minmax(0,1fr);",
  ], "phone-width safeguards");
  assert(/\.capsule-row\s*\{[^}]*min-width\s*:\s*0[^}]*overflow-x\s*:\s*auto/is.test(styles),
    "only the sentence capsule row may scroll horizontally");
});

check("Draft preserves paragraph breaks while sentence highlights remain inline", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const highlightSource = functionSource(client, "highlightedManuscriptHtml", "compositionStatus");
  requireEvery(highlightSource, [
    "source.slice(cursor, matchAt)", "leadingWhitespace", "trailingWhitespace",
    "visibleSentence", 'role="button"', 'tabindex="0"', "</span>",
  ], "paragraph-preserving manuscript highlights");
  assert(!/<button class=["']manuscript-sentence-highlight/.test(highlightSource),
    "Draft sentence highlights must not use atomic button boxes");
  assert(/\.manuscript-text\s*\{[^}]*white-space\s*:\s*pre-wrap/i.test(styles),
    "Draft must preserve the manuscript's original paragraph whitespace");
  assert(/\.manuscript-sentence-highlight\s*\{[^}]*display\s*:\s*inline/i.test(styles),
    "sentence highlights must remain in the paragraph's inline formatting flow");
  assert(/closest\([^)]*data-manuscript-sentence/.test(client)
      && /data-manuscript-sentence[\s\S]{0,500}(?:Enter|event\.key !== ' ')[\s\S]{0,300}\.click\(\)/.test(client),
    "inline sentence navigation must remain clickable and keyboard accessible");
});

check("each sentence shares one color across manuscript, capsule, and correction", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  requireEvery(client, [
    "sentencePalette", "sentenceColorStyle", "highlightedManuscriptHtml", "data-manuscript-sentence",
    "manuscript-sentence-highlight", "sentence-original-highlight",
  ], "sentence color coordination");
  const capsuleSource = functionSource(client, "sentenceCapsuleHtml", "sentenceCardHtml");
  const cardSource = functionSource(client, "sentenceCardHtml", "submitRewrites");
  assert(capsuleSource.includes("sentenceColorStyle(index)") && cardSource.includes("sentenceColorStyle(index)"),
    "the capsule and correction card must receive the same indexed color variables");
  assert(/data-manuscript-sentence[\s\S]{0,1200}scrollIntoView/.test(client),
    "clicking a manuscript sentence must use the shared sentence navigation path");
  requireEvery(styles, ["--sentence-color", "--sentence-soft", ".manuscript-sentence-highlight", ".sentence-original-highlight"],
    "sentence color styles");
  const paletteSource = client.slice(client.indexOf("var sentencePalette"), client.indexOf("function compositionStatus"));
  assert(paletteSource.includes("var sentencePalette") && !/#0f766e|#0b5d57|#287b91|#dff4ed|#c9eee2/i.test(paletteSource),
    "the sentence palette must avoid the interface's established green and teal family");
  assert.strictEqual((paletteSource.match(/\{\s*color:/g) || []).length, 8,
    "the sentence palette must provide eight colors before repeating");
  assert(!/\.manuscript-sentence-highlight[^}]*\{[^}]*box-shadow\s*:\s*inset\s+0\s+-/i.test(styles)
      && !/\.sentence-original-highlight\s*\{[^}]*box-shadow\s*:\s*inset\s+0\s+-/i.test(styles),
    "sentence highlights must not draw an underline-like inset shadow");
});

check("Sentence Revision exposes an accessible photographed-draft import flow", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const renderSource = functionSource(client, "renderLanguage", "sentenceCapsuleHtml");
  requireEvery(renderSource, [
    "Scan Revisions", "revision-scan-photo", "capture=\"environment\"",
    "image/jpeg,image/png,image/webp", "data-start-revision-scan",
  ], "Sentence Revision scan trigger");
  assert(!renderSource.includes("亲自重写后再按 Submit"),
    "Sentence Revision must omit the removed rewrite-and-scan instruction");
  assert(/batch-actions[\s\S]{0,500}data-start-revision-scan[\s\S]{0,600}data-submit-rewrites/.test(renderSource),
    "the camera trigger must sit immediately before Submit in the bottom action row");
  assert(/data-start-revision-scan[^>]*aria-label="Scan Revisions"[^>]*title="Scan Revisions"[^>]*>[\s\S]{0,120}icon\('camera'\)[\s\S]{0,120}<\/button>/.test(renderSource),
    "the bottom scan trigger must be an accessible camera-only button");
  assert(/!state\.readOnly[\s\S]{0,500}Scan Revisions/.test(renderSource),
    "completed/read-only writing must not expose photographed draft import");
  assert(/\.scan-revision-trigger\s*\{[^}]*width\s*:\s*44px[^}]*height\s*:\s*44px/is.test(styles),
    "the scan trigger must remain a compact square camera button");
  assert(/@media\s*\(max-width:\s*760px\)[\s\S]*\.batch-actions\s*\{[^}]*flex-direction\s*:\s*row/is.test(styles),
    "phone actions must keep the camera to the left of Submit");
  requireEvery(styles, [
    ".revision-scan-surface", ".revision-scan-target", ".revision-scan-target-number",
    ".revision-scan-recognized", ".revision-scan-confidence", "#fca5a5", "#fef2f2",
  ], "accessible Review Scan styling");
  requireEvery(styles, [
    ".revision-scan-confidence.is-high", ".revision-scan-confidence.is-medium",
    ".revision-scan-confidence.is-low", "width: 13px", "height: 13px",
  ], "compact Review Scan confidence markers");
});

check("Revision Scan stages an ordered multi-photo batch before cloud upload", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const backend = read(functionPath);
  const selectionSource = functionSource(client, "renderRevisionScanPhotoSelection", "revisionScanCandidateHtml");
  requireEvery(selectionSource, [
    "revision-photo-position", "revision-photo-carousel", "Add Photo", "Remove", "Start Scanning",
    "data-add-revision-photo", "data-remove-revision-photo", "data-start-revision-upload",
    "scan.files.push(file)", "scan.previewUrls.push", "8 - scan.files.length", "activePhotoIndex",
  ], "revision photo staging screen");
  assert(!selectionSource.includes("Revision Photos"),
    "the photographed-revision staging surface must omit its former heading");
  assert(/revision-photo-card-actions[\s\S]{0,500}data-add-revision-photo[\s\S]{0,500}data-remove-revision-photo/.test(selectionSource),
    "Add Photo and Remove must share each current photo's action layer");
  assert(/\(closest \+ 1\) \+ '\/' \+ slides\.length/.test(selectionSource)
      && /aria-label['"], 'Photo ' \+ \(closest \+ 1\) \+ ' of ' \+ slides\.length/.test(selectionSource),
    "the centered counter must track the visible photo as current/total rather than x/8");
  requireEvery(selectionSource, ["selection.scrollIntoView", "block: 'start'", "window.requestAnimationFrame", "carousel.scrollLeft"],
    "stable post-camera positioning");
  requireEvery(styles, [
    ".revision-photo-carousel", "scroll-snap-type: x mandatory", ".revision-photo-position",
    "margin: 0 auto 14px", ".revision-photo-card img", "height: min(56vh,620px)", "scroll-margin-top: 90px",
  ], "iPad and phone revision-photo layout");
  assert(/target\.id[\s\S]{0,60}revision-scan-photo[\s\S]{0,220}addRevisionScanPhotos/.test(client),
    "choosing the first revision photo must stage it locally rather than upload immediately");
  assert(/data-start-revision-upload[\s\S]{0,260}beginRevisionScanUpload\(revisionScanState\(\)\.files\.slice\(\)\)/.test(client),
    "only Start Scanning may hand the accumulated photo batch to cloud upload");
  assert(/const MAX_UPLOAD_PAGES\s*=\s*8/.test(backend),
    "the client eight-photo limit must match the server boundary");
});

check("Review Scan keeps only mapping cards and imports their edited scan text", () => {
  const client = read(clientPath);
  const reviewSource = functionSource(client, "revisionScanCandidateHtml", "renderRevisionScanReview");
  const pageSource = functionSource(client, "renderRevisionScanReview", "renderRevisionScanWaiting");
  const importSource = functionSource(client, "confirmRevisionScanImport", "renderLanguage");
  const eligibleSource = functionSource(client, "revisionScanSentences", "revisionScanSentenceLabel");
  requireEvery(reviewSource, [
    "data-scan-sentence", "data-scan-text", "revision-scan-confidence",
    "revisionScanSentenceLabel(sid)", "claimedByAnother", "disabled",
    "revisionScanSentenceDetails", "revisionScanConfidenceMeta",
  ], "Review Scan mapping cards");
  [
    "Keep typed", "Use scanned", "data-scan-choice", "已有手写草稿",
    "SCANNED REVISION", "NEEDS REVISION", "手写编号",
  ].forEach((removed) => assert(!reviewSource.includes(removed), `Review Scan card must omit ${removed}`));
  [
    "revision-scan-heading", "revision-scan-count", "revision-scan-instructions",
    "revision-scan-missing", "SENTENCE REVISION", "Review Scan",
  ].forEach((removed) => assert(!pageSource.includes(removed), `Review Scan page must omit ${removed}`));
  assert(/rewriteRequired\s*\(\s*sentence\s*\)[\s\S]{0,180}accepted\s*={2,3}\s*true/.test(eligibleSource),
    "Review Scan target choices must exclude originally-correct and already-accepted sentences");
  assert(/revisionScanSentences\(\)\.length[\s\S]{0,500}Scan Revisions/.test(functionSource(client, "renderLanguage", "sentenceCapsuleHtml")),
    "Scan Revisions must disappear when no unfinished revision target remains");
  requireEvery(importSource, [
    "confirmRevisionScanImport", "revision", "operation_id", "sentence_id", "saveRewriteDraftSnapshot",
  ], "confirmed scan import");
  requireEvery(pageSource, ["revisionScanCanConfirm", "Confirm Scanning"],
    "Review Scan confirmation boundary");
  assert(!pageSource.includes("导入选中的草稿"),
    "the former import label must be replaced by Confirm Scanning");
  assert(!/submitRewrites\s*\(|data-submit-rewrites/.test(importSource),
    "scan import must populate drafts without automatically running Check");
  assert(!/revisionScanSelection|data-scan-choice|Keep typed|Use scanned/.test(client),
    "Review Scan must not retain the removed typed-versus-scanned choice state");
  assert(/selected\.forEach\([\s\S]{0,180}state\.rewrites\[item\.sentence_id\]\s*=\s*item\.text/.test(importSource),
    "explicit import must place each reviewed scanned sentence into its selected draft");
  assert(/state\.review[\s\S]{0,220}rewriteRequired\(sentence\)[\s\S]{0,120}state\.rewriteFace\[sentenceId\(sentence, index\)\]\s*=\s*true/.test(importSource),
    "successful scan import must return with every revision-required card showing its attempt face");
});

check("revision photo upload retries one logical start-upload-finish task without a false handoff claim", () => {
  const client = read(clientPath);
  const uploadSource = functionSource(client, "beginRevisionScanUpload", "confirmRevisionScanImport");
  requireEvery(uploadSource, [
    "logicalOperationId('revision-scan'", "retryNetworkTask", "startRevisionScanUpload",
    "uploadWithMetadata", "finishRevisionScanUpload", "renderRevisionScanFailure",
  ], "revision scan upload lifecycle");
  assert(/retryNetworkTask\s*\(\s*function\s*\(\)\s*\{[\s\S]{0,1800}startRevisionScanUpload[\s\S]{0,2200}uploadWithMetadata[\s\S]{0,1600}finishRevisionScanUpload/.test(uploadSource),
    "the same operation retry must cover upload bytes and the durable server handoff");
  assert(/isNetworkDisconnect\s*\(\s*error\s*\)[\s\S]{0,500}renderRevisionScanFailure/.test(uploadSource),
    "an unconfirmed network disconnect must not claim that cloud OCR is definitely continuing");
});

check("photo upload state atomically replaces nullable pending-upload fields", () => {
  const backend = read(functionPath);
  const photoUploadSource = functionSource(backend, "startPhotoUpload", "photoRows");
  const revisionUploadSource = functionSource(backend, "startRevisionScanUpload", "finishRevisionScanUpload");
  const revisionFinishSource = functionSource(backend, "finishRevisionScanUpload", "retryableJobError");
  [
    [photoUploadSource, "composition photo upload"],
    [revisionUploadSource, "revision photo upload"],
  ].forEach(([source, context]) => {
    assert(/\.update\s*\(\s*replaceWholeFields\s*\(\s*\{[\s\S]*pending_upload\s*:[\s\S]*\}\s*,\s*\[\s*["']pending_upload["']\s*\]\s*\)\s*\)/.test(source),
      `${context} must replace pending_upload atomically when the stored field is null`);
  });
  assert(/\.update\s*\(\s*replaceWholeFields\s*\(\s*\{[\s\S]*pending_upload\s*:\s*null[\s\S]*active_job\s*:[\s\S]*\[[^\]]*["']pending_upload["'][^\]]*["']pending_revision_scan["'][^\]]*["']active_job["'][^\]]*\]\s*\)\s*\)/.test(revisionFinishSource),
    "revision upload handoff must atomically clear nullable upload state and replace active_job");
});

check("revision OCR uses a strict durable job and canonical server mapping", () => {
  const backend = read(functionPath);
  const prompts = read(promptPath);
  const enqueueSource = functionSource(backend, "finishRevisionScanUpload", "retryableJobError");
  const performSource = functionSource(backend, "performRevisionOcrJob", "claimQueuedJob");
  const processSource = functionSource(backend, "processQueuedJob", "extractOcr");
  requireEvery(enqueueSource, [
    "revisionJobId", "job_type: \"revision_ocr\"", "composition_revision",
    ".doc(jobId).create", "status: \"queued\"", "invokeFunctionAsync",
  ], "durable revision OCR enqueue");
  requireEvery(performSource, [
    "active_job_id", "composition_revision", "writing_revision_scan_v1",
    "REVISION_SCAN_SCHEMA", "canonicalRevisionScanResult", "runTransaction",
    "lease_token", "pending_revision_scan", "deleteUploadedPhotos",
    "photoIds", "rows.map", "imageUrls", "images: imageUrls",
  ], "guarded revision OCR result publication");
  assert(/claimed\.job_type\s*={2,3}\s*["']revision_ocr["'][\s\S]{0,180}performRevisionOcrJob/.test(processSource),
    "the durable dispatcher must execute revision_ocr jobs");
  requireEvery(prompts, ["8, 8., 8、, 8), or (8)", "primary mapping signal", "must never cause you to invent"],
    "revision number-marker prompt boundary");
});

check("revision scan canonicalization never silently accepts missing, duplicate, or invalid numbers", () => {
  const backend = require(path.join(root, functionPath));
  const composition = {
    composition_id: "composition-test",
    revision: 3,
    language_review: {
      sentences: [
        { sentence_id: "s001", original: "Already correct.", rewrite_required: false },
        { sentence_id: "s002", original: "Needs work two.", rewrite_required: true },
        { sentence_id: "s003", original: "Needs work three.", rewrite_required: true },
        { sentence_id: "s004", original: "Needs work four.", rewrite_required: true },
        { sentence_id: "s005", original: "Needs work five.", rewrite_required: true },
        { sentence_id: "s006", original: "Already revised six.", rewrite_required: true },
      ],
    },
    rewrite_results: {
      results: [{ sentence_id: "s006", accepted: true, student_rewrite: "Revised six." }],
    },
  };
  const result = backend._test.canonicalRevisionScanResult({
    items: [
      { written_number: 2, recognized_text: "Rewrite two.", confidence: "high", warnings: [] },
      { written_number: 3, recognized_text: "Rewrite three A.", confidence: "medium", warnings: [] },
      { written_number: 3, recognized_text: "Rewrite three B.", confidence: "high", warnings: [] },
      { written_number: 99, recognized_text: "Wrong number.", confidence: "high", warnings: [] },
      { written_number: null, recognized_text: "No number.", confidence: "low", warnings: [] },
      { written_number: 4, recognized_text: "", confidence: "high", warnings: [] },
      { written_number: 5, recognized_text: "Rewrite five.", confidence: "medium", warnings: [] },
      { written_number: 6, recognized_text: "Should not replace a completed sentence.", confidence: "high", warnings: [] },
    ],
    unmapped_items: [],
  }, composition, "student-test", "operation-test", { provider: "test" });
  const sentenceTwo = result.items.find((item) => item.written_number === 2);
  const sentenceThree = result.items.filter((item) => item.written_number === 3);
  const outOfRange = result.items.find((item) => item.written_number === 99);
  const missingNumber = result.items.find((item) => item.written_number === null);
  const mediumConfidence = result.items.find((item) => item.written_number === 5);
  const completedSentence = result.items.find((item) => item.written_number === 6);
  assert.strictEqual(sentenceTwo.sentence_id, "s002");
  assert.strictEqual(sentenceTwo.status, "mapped");
  assert(sentenceThree.every((item) => item.status === "check"
      && item.warnings.includes("DUPLICATE_SENTENCE_NUMBER")),
    "every duplicate candidate must remain reviewable instead of auto-importing");
  assert.strictEqual(outOfRange.sentence_id, null);
  assert.strictEqual(outOfRange.status, "unresolved");
  assert.strictEqual(missingNumber.sentence_id, null);
  assert.strictEqual(missingNumber.status, "unresolved");
  assert.strictEqual(mediumConfidence.sentence_id, "s005");
  assert.strictEqual(mediumConfidence.status, "check",
    "medium-confidence handwriting must remain visible for student review");
  assert.strictEqual(completedSentence.sentence_id, null);
  assert.strictEqual(completedSentence.status, "unresolved");
  assert(completedSentence.warnings.includes("SENTENCE_NUMBER_OUT_OF_RANGE_OR_NOT_REQUIRED"),
    "an already-accepted sentence must not remain an eligible scan target");
  assert.deepStrictEqual(result.missing_sentence_ids, ["s004"],
    "a present low-confidence candidate is not missing, while empty handwriting remains missing and accepted work stays excluded");
});

check("confirmed revision scan import is revision-bound, transactional, and draft-only", () => {
  const backend = read(functionPath);
  const importSource = functionSource(backend, "confirmRevisionScanImport", "getProfile");
  requireEvery(importSource, [
    "pending_revision_scan", "composition_revision", "operationId", "revisionRequiredUnits",
    "DUPLICATE_SENTENCE_ID", "runTransaction", "scanned_rewrite_drafts",
    "replaceWholeFields", "idempotent_replay",
  ], "confirmed revision scan import boundary");
  assert(!/callStructuredModel|rewrite_results\s*:|pending_rewrite_check\s*:/.test(importSource),
    "import must persist editable drafts only and must not grade or publish Check results");
  assert(!/if\s*\(\s*!submitted\.length\s*\)\s*throw/.test(importSource),
    "the server must retain idempotent compatibility with an empty confirmed import");
});

check("expired revision uploads retain a revision-specific recoverable failure", () => {
  const worker = read(workerPath);
  const cleanupSource = functionSource(worker, "cleanupExpiredPhotos", "exports.main");
  requireEvery(cleanupSource, [
    "upload_kind", "revision_scan", "revision_ocr", "revision_ocr_failed",
    "PHOTO_UPLOAD_EXPIRED", "active_job",
  ], "revision upload expiry recovery");
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
  ["OCR_SCHEMA", "OCR_LOCATION_SCHEMA", "REVISION_SCAN_SCHEMA", "STANDARDIZED_SCHEMA", "LANGUAGE_SCHEMA", "REWRITE_SCHEMA"].forEach((name) => {
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
  const languageWithoutCefr = {
    suggested_title: "A Draft", overview: "总体建议。", sentences: [], profile_observations: [],
  };
  assert(provider._test.validateAgainstSchema(languageWithoutCefr, schemas.LANGUAGE_SCHEMA)
    .some((message) => message.includes("cefr_estimate") && message.includes("required")),
  "new language reviews must contain a CEFR writing estimate");
  const languageWithInvalidCefr = {
    ...languageWithoutCefr,
    cefr_estimate: { level: "B1", position: "top", commentary_zh: "整体接近 B1 上段。" },
  };
  assert(provider._test.validateAgainstSchema(languageWithInvalidCefr, schemas.LANGUAGE_SCHEMA)
    .some((message) => message.includes("position") && message.includes("lower, middle, upper")),
  "CEFR within-band position must use the closed enum");
  const validRevisionScan = {
    items: [
      { written_number: 8, recognized_text: "I agree.", confidence: "high", warnings: [] },
      { written_number: null, recognized_text: "Another idea.", confidence: "low", warnings: ["number unclear"] },
    ],
    unmapped_items: [],
  };
  assert.deepStrictEqual(provider._test.validateAgainstSchema(validRevisionScan, schemas.REVISION_SCAN_SCHEMA), []);
  const invalidRevisionScan = {
    items: [{ written_number: "8", recognized_text: "I agree.", confidence: "certain", warnings: [] }],
    unmapped_items: [],
  };
  const revisionErrors = provider._test.validateAgainstSchema(invalidRevisionScan, schemas.REVISION_SCAN_SCHEMA);
  assert(revisionErrors.some((message) => message.includes("written_number")),
    "revision scan marker must be an integer or null");
  assert(revisionErrors.some((message) => message.includes("confidence")),
    "revision scan confidence must use the closed enum");
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

check("OCR location contract is strict, indexed, and prompt-safe", () => {
  const schemas = require(path.join(root, schemaPath));
  const prompts = require(path.join(root, promptPath));
  const provider = require(path.join(root, providerPath));
  const valid = { regions: [{ span_index: 0, page_index: 0, x: 10, y: 20, width: 40, height: 25, confidence: "high" }] };
  assert.deepStrictEqual(provider._test.validateAgainstSchema(valid, schemas.OCR_LOCATION_SCHEMA), []);
  assert(provider._test.validateAgainstSchema({ regions: [{ ...valid.regions[0], extra: true }] }, schemas.OCR_LOCATION_SCHEMA)
    .some((message) => /extra.*not allowed/.test(message)));
  const prompt = prompts.ocrLocationPrompt();
  requireEvery(prompt.toLowerCase(), ["untrusted", "indexed", "never transcribe", "page_index", "zero-based", "top-left", "0..1000", "at most one", "omit", "low", "crosses a line", "ignore any instructions", "only the required json"], "OCR location prompt boundary");
  assert(/^writing-ai-schemas-\d{4}-\d{2}-\d{2}\.\d+$/.test(schemas.SCHEMA_VERSION));
  assert(/^writing-prompts-\d{4}-\d{2}-\d{2}\.\d+$/.test(prompts.PROMPT_VERSION));
});

check("explicit OCR locator timeout is bounded without changing defaults", () => {
  const provider = require(path.join(root, providerPath));
  const original = process.env.WRITING_AI_TIMEOUT_MS;
  process.env.WRITING_AI_TIMEOUT_MS = "12345";
  assert.strictEqual(provider._test.normalizeTimeoutMs(), 12345);
  assert.strictEqual(provider._test.normalizeTimeoutMs(45000), 45000);
  assert.strictEqual(provider._test.normalizeTimeoutMs(1), 1000);
  assert.strictEqual(provider._test.normalizeTimeoutMs(999999), 300000);
  if (original == null) delete process.env.WRITING_AI_TIMEOUT_MS;
  else process.env.WRITING_AI_TIMEOUT_MS = original;
});

check("OCR location canonicalization rejects unsafe boxes deterministically", () => {
  const backend = require(path.join(root, functionPath));
  const canonical = backend._test.canonicalOcrUncertaintyRegions([
    { span_index: 1, page_index: 0, x: 10, y: 20, width: 100, height: 50, confidence: "medium" },
    { span_index: 1, page_index: 0, x: 12, y: 22, width: 20, height: 20, confidence: "high" },
    { span_index: 0, page_index: 0, x: 0, y: 0, width: 4, height: 4, confidence: "low" },
    { span_index: 2, page_index: 0, x: 990, y: 0, width: 20, height: 20, confidence: "high" },
    { span_index: 0, page_index: 3, x: 0, y: 0, width: 10, height: 10, confidence: "high" },
  ], 2, 1);
  assert.deepStrictEqual(canonical, [{ span_index: 1, page_index: 0, x: 12, y: 22, width: 20, height: 20, confidence: "high" }]);
  assert.deepStrictEqual(backend._test.canonicalOcrUncertaintyRegions([
    { span_index: 0, page_index: 0, x: 0, y: 0, width: 4, height: 4, confidence: "high", answer: "secret" },
  ], 1, 1), [{ span_index: 0, page_index: 0, x: 0, y: 0, width: 4, height: 4, confidence: "high" }]);
});

check("optional OCR location preserves enough lease budget to publish transcription", () => {
  const backend = require(path.join(root, functionPath));
  const now = Date.now();
  assert.strictEqual(backend._test.hasOcrLocationLeaseBudget({ lease_until: new Date(now + 100001) }, now), true);
  assert.strictEqual(backend._test.hasOcrLocationLeaseBudget({ lease_until: new Date(now + 99999) }, now), false);
  assert.strictEqual(backend._test.hasOcrLocationLeaseBudget({}, now), false);
  const source = read(functionPath);
  const perform = functionSource(source, "performOcrJob", "performRevisionOcrJob");
  assert(/hasOcrLocationLeaseBudget\(job\)[\s\S]{0,240}callStructuredModel/.test(perform),
    "locator must be skipped when its possible provider repair would endanger OCR publication");
});

check("OCR locator failure cannot fail the required transcription commit", () => {
  const backend = read(functionPath);
  const perform = functionSource(backend, "performOcrJob", "performRevisionOcrJob");
  requireEvery(perform, ["OCR_LOCATION_SCHEMA", "ocrLocationPrompt", "timeoutMs: 45000", "location_status", "uncertain_regions", "locationModelMetadata"], "optional OCR location path");
  assert(/try\s*\{[\s\S]*callStructuredModel\([\s\S]*OCR_LOCATION_SCHEMA[\s\S]*\}\s*catch\s*\(error\)/.test(perform), "locator call must be best effort");
  assert(/location unavailable[\s\S]*safeCode/.test(perform), "locator logs must use a stable safe code");
  perform.split("\n").filter((line) => line.includes("console.error")).forEach((line) => {
    assert(!/(imageUrls|uncertainSpans|rawRegions|locationResponse\.data)/.test(line), "locator logs must not include request or response data");
  });
  const job = functionSource(backend, "performOcrJob", "performRevisionOcrJob");
  assert(/status: "succeeded"/.test(job), "OCR job must still commit succeeded after locator fallback");
});

check("OCR Review overlays retain span identity and delegated accessible interactions", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const pageRender = functionSource(client, "renderOcr", "saveAndEvaluate");
  requireEvery(pageRender, ["ocr-photo-page", "ocr-photo-layer", "ocr-photo-overlay", "viewBox=\"0 0 1000 1000\"", "preserveAspectRatio=\"none\"", "data-ocr-page-index", "figcaption", "ocrRegionSvg"], "OCR overlay page structure");
  requireEvery(client, ["data-ocr-span-index", "data-ocr-region-index", "activateOcrRegion", "hideOcrRegion", "scrollIntoView", "Locate unclear text in OCR editor"], "OCR overlay identity and activation");
  requireEvery(styles, [".ocr-photo-page", ".ocr-photo-layer", ".ocr-photo-overlay", ".ocr-photo-region", ".ocr-photo-region.is-active", ".ocr-photo-region.is-acknowledged", "prefers-reduced-motion"], "OCR overlay styles");
  assert(/document\.addEventListener\('click'/.test(client) && /document\.addEventListener\('keydown'/.test(client), "OCR regions must use delegated event handlers");
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
  const evaluateSource = matchingFunctionSource(backend, "evaluate", "evaluate action");
  assert(!/await\s+callStructuredModel\s*\(/.test(evaluateSource),
    "evaluate still waits for the language model inside the browser request; it must only reserve/enqueue and return");
  assert(/enqueue[A-Z\w]*Review[A-Z\w]*Job\s*\(/.test(evaluateSource),
    "evaluate must enqueue a persistent review job");
  assert(/(?:accepted\s*:\s*true|status\s*:\s*["']queued["'])[\s\S]{0,300}\bjob\b|\bjob\b[\s\S]{0,300}(?:accepted\s*:\s*true|status\s*:\s*["']queued["'])/.test(evaluateSource),
    "evaluate must immediately return an accepted/queued job projection");
});

check("submitRewrites enqueues a durable rewrite job without waiting for the model", () => {
  const backend = read(functionPath);
  const submitSource = matchingFunctionSource(backend, "submitRewrites", "submitRewrites");
  const enqueueSource = matchingFunctionSource(backend, "enqueue[A-Z\\w]*Rewrite[A-Z\\w]*Job", "rewrite-job enqueue function");
  assert(!/await\s+callStructuredModel\s*\(/.test(submitSource),
    "submitRewrites must not keep the browser request open while the rewrite-check model runs");
  assert(/enqueue[A-Z\w]*Rewrite[A-Z\w]*Job\s*\(|(?:writing_ai_jobs|\bJOBS\b)[\s\S]{0,800}job_type\s*:\s*["']rewrite["']/.test(submitSource),
    "submitRewrites must enqueue a persistent rewrite job");
  assert(/(?:accepted\s*:\s*true|status\s*:\s*["']queued["'])[\s\S]{0,320}\bjob\b|\bjob\b[\s\S]{0,320}(?:accepted\s*:\s*true|status\s*:\s*["']queued["'])/.test(`${submitSource}\n${enqueueSource}`),
    "submitRewrites must immediately return an accepted/queued rewrite-job projection");
});

check("rewrite jobs use a stable create-only identity and run the model only in performRewriteJob", () => {
  const backend = read(functionPath);
  const enqueueSource = matchingFunctionSource(backend, "enqueue[A-Z\\w]*Rewrite[A-Z\\w]*Job", "rewrite-job enqueue function");
  const performSource = matchingFunctionSource(backend, "performRewriteJob", "rewrite-job processor function");
  requireEvery(enqueueSource, ["operationId", "stableId", "jobId", "items", "composition_revision"], "rewrite-job identity and payload");
  assert(/job_type\s*:\s*["']rewrite["']/.test(enqueueSource),
    "rewrite job must persist job_type rewrite");
  assert(/status\s*:\s*["']queued["']/.test(enqueueSource),
    "new rewrite job must start queued");
  assert(/\.doc\s*\(\s*jobId\s*\)\.create\s*\(/.test(enqueueSource),
    "rewrite job creation must be create-only under its stable job_id");
  assert(/getOne\s*\(\s*JOBS[\s\S]{0,700}(?:existing|idempoten|replay)|(?:existing|idempoten|replay)[\s\S]{0,700}getOne\s*\(\s*JOBS/.test(enqueueSource),
    "same rewrite operation_id must reuse its existing durable job");
  assert(/await\s+callStructuredModel\s*\(/.test(performSource),
    "performRewriteJob must execute the rewrite-check model");
  requireEvery(performSource, ["student_rewrite_check_v1", "REWRITE_SCHEMA"], "rewrite-job model call");
});

check("performRewriteJob transactionally guards its lease and atomically replaces rewrite_results", () => {
  const backend = read(functionPath);
  const performSource = matchingFunctionSource(backend, "performRewriteJob", "rewrite-job processor function");
  requireEvery(performSource, ["runTransaction", "active_job_id", "lease_token", "processing", "rewrite_results"],
    "rewrite-job publication guard");
  assert(/active_job_id[\s\S]{0,220}(?:===|!==|==|!=)[\s\S]{0,100}(?:job\.job_id|job_id)|(?:job\.job_id|job_id)[\s\S]{0,100}(?:===|!==|==|!=)[\s\S]{0,220}active_job_id/.test(performSource),
    "performRewriteJob must reject a result when the Composition no longer owns the job");
  assert(/currentJob[\s\S]{0,220}status[\s\S]{0,100}["']processing["']/.test(performSource)
      && /(?:secretMatches\s*\([^)]*lease_token|lease_token[\s\S]{0,160}(?:===|!==|==|!=)[\s\S]{0,160}lease_token)/.test(performSource),
    "performRewriteJob must re-check the processing job and its lease token inside the publication path");
  assert(/transaction\.collection\s*\(\s*COMPOSITIONS\s*\)[\s\S]*\.update\s*\(\s*replaceWholeFields\s*\([\s\S]*["']rewrite_results["']/.test(performSource),
    "rewrite_results must be published through replaceWholeFields in the same transaction as the job result");
});

check("job status projection and queued-job dispatch support rewrite jobs", () => {
  const backend = read(functionPath);
  const statusSource = functionSource(backend, "jobCompositionStatus", "replaceWholeFields");
  const processSource = functionSource(backend, "processQueuedJob", "extractOcr");
  assert(/job\.job_type\s*={2,3}\s*["']rewrite["']/.test(statusSource),
    "jobCompositionStatus must project rewrite-job states onto the Composition");
  ["rewrite_queued", "rewrite_processing", "rewrite_failed"].forEach((status) => {
    assert(statusSource.includes(status), `jobCompositionStatus must expose ${status}`);
  });
  assert(/claimed\.job_type\s*={2,3}\s*["']rewrite["'][\s\S]{0,240}performRewriteJob|performRewriteJob[\s\S]{0,240}claimed\.job_type\s*={2,3}\s*["']rewrite["']/.test(processSource),
    "processQueuedJob must dispatch claimed rewrite jobs to performRewriteJob");
  const claimIndex = processSource.indexOf("await claimQueuedJob");
  const publishIndex = processSource.indexOf("await publishProcessingJob");
  const rewriteRunIndex = processSource.search(/await\s+(?:performRewriteJob|rewriteRunner|runner)\s*\(/);
  assert(claimIndex >= 0 && publishIndex > claimIndex && rewriteRunIndex > publishIndex,
    "the rewrite model must run only after claimQueuedJob and publishProcessingJob succeed");
});

check("rewrite Check polls, survives disconnects, and resumes after reopening the Composition", () => {
  const client = read(clientPath);
  const submitSource = matchingFunctionSource(client, "submitRewrites", "submitRewrites client action");
  const pollingSource = matchingFunctionSource(client, "startRewritePolling", "rewrite polling function");
  const loadSource = functionSource(client, "loadComposition", "renderFatalAction");
  requireEvery(client, ["rewritePollActive", "rewritePollGeneration", "stopRewritePolling"], "rewrite polling state");
  requireEvery(submitSource, ["logicalOperationId", "submitRewrites", "renderRewriteWaiting", "isNetworkDisconnect"],
    "rewrite Check network recovery");
  assert(/\.then\s*\([^)]*\)[\s\S]{0,1600}renderRewriteWaiting|renderRewriteWaiting[\s\S]{0,1600}\.then\s*\(/.test(submitSource),
    "an accepted rewrite job must switch to the durable waiting/polling UI");
  assert(/isNetworkDisconnect\s*\(\s*error\s*\)[\s\S]{0,500}renderRewriteWaiting/.test(submitSource),
    "a lost submit response must reconcile the same Composition instead of rendering a fatal Network error");
  const networkIndex = submitSource.search(/isNetworkDisconnect\s*\(\s*error\s*\)/);
  const networkReturnIndex = submitSource.indexOf("return", networkIndex);
  const clearOperationIndex = submitSource.indexOf("clearLogicalOperation('rewrites')", networkIndex);
  assert(networkIndex >= 0 && networkReturnIndex > networkIndex
      && (clearOperationIndex < 0 || networkReturnIndex < clearOperationIndex),
    "the network-disconnect branch must return before clearing the rewrite operation_id");
  requireEvery(pollingSource, ["getComposition", "rewriteReady", "setTimeout"], "rewrite result polling");
  const sharedPolling = matchingFunctionSource(client, "startWaitingPolling", "shared waiting polling function");
  assert(/\.catch\s*\([\s\S]{0,900}scheduleWaitingPoll/.test(sharedPolling),
    "rewrite polling must keep retrying after a transient network failure");
  assert(/job_type\s*={2,3}\s*["']rewrite["']/.test(loadSource)
      && /queued|processing/.test(loadSource)
      && /renderRewriteWaiting|startRewritePolling/.test(loadSource),
    "loadComposition must resume queued/processing rewrite work after refresh or login");
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
  const reviewRunIndex = processSource.search(/await\s+(?:reviewRunner|runner)\s*\(/);
  assert(claimIndex >= 0 && noClaimReturnIndex > claimIndex && publishIndex > noClaimReturnIndex
      && reviewRunIndex > publishIndex,
    "the review runner must execute only after a successful lease claim, the empty-claim return guard, and active-job processing publication");
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
    suggested_title: "A Short Title", overall_score: "0", score_scale: "wrong", summary: "Summary", strengths: [], priorities: [],
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
    suggested_title: "Going Home", cefr_estimate: { level: "B1", position: "upper", commentary_zh: "整体接近 B1 上段。" }, overview: "Overview", profile_observations: [],
    sentences: [{
      sentence_id: "s001", original: "I go home.", status: "needs_revision",
      rewrite_required: false, issues: [], coaching_summary: "Agreement", reference_revision: "I go home.",
    }],
  }, [{ sentence_id: "s001", original: "I goes home." }]);
  assert.strictEqual(language.sentences[0].rewrite_required, true);
  assert.strictEqual(language.sentences[0].original, "I goes home.",
    "server must restore the exact source sentence instead of trusting the model echo");
  const effectiveLanguage = backend._test.canonicalLanguageResult({
    suggested_title: "Going Home", cefr_estimate: { level: "B1", position: "middle", commentary_zh: "整体达到 B1。" }, overview: "Overview", profile_observations: [],
    sentences: [{
      sentence_id: "s001", original: "I go home.", status: "effective",
      rewrite_required: true, issues: [], coaching_summary: "表达准确。", reference_revision: "",
    }],
  }, [{ sentence_id: "s001", original: "I go home." }]);
  assert.strictEqual(effectiveLanguage.sentences[0].rewrite_required, false,
    "server must exempt effective sentences even when the model returns a contradictory rewrite flag");
  const persistenceUpdate = backend._test.replaceWholeFields({
    status: "sentence_training",
    language_review: { model_metadata: { model: "test" }, sentences: [] },
  }, ["language_review"]);
  assert.strictEqual(persistenceUpdate.language_review.operator, "set",
    "a first review must atomically replace language_review instead of creating paths below a null field");
  assert.strictEqual(persistenceUpdate.status, "sentence_training");
  const rewritePersistenceUpdate = backend._test.replaceWholeFields({
    status: "completed",
    rewrite_results: { checked_at: new Date(), results: [] },
  }, ["rewrite_results"]);
  assert.strictEqual(rewritePersistenceUpdate.rewrite_results.operator, "set",
    "a first rewrite check must atomically replace rewrite_results instead of creating paths below a null field");
  const uploadPersistenceUpdate = backend._test.replaceWholeFields({
    status: "revision_photo_uploading",
    pending_upload: { kind: "revision_scan", composition_revision: 2 },
  }, ["pending_upload"]);
  assert.strictEqual(uploadPersistenceUpdate.pending_upload.operator, "set",
    "a new photo batch must atomically replace pending_upload instead of creating paths below a null field");
  assert.throws(() => backend._test.canonicalLanguageResult({
    suggested_title: "Wrong Sentence", cefr_estimate: { level: "A2", position: "lower", commentary_zh: "证据有限。" }, overview: "Overview", profile_observations: [],
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

  const legacyFeedback = {
    operation_id: "rewrite-round-1", overall_feedback: "First batch", checked_at: new Date("2026-08-22T10:00:00Z"),
    results: [{ sentence_id: "s001", student_rewrite: "I go home.", accepted: false, feedback: "请修改时态。" }],
  };
  const feedbackHistory = backend._test.appendRewriteFeedbackHistory(legacyFeedback, {
    operation_id: "rewrite-round-2", overall_feedback: "Second batch", checked_at: new Date("2026-08-22T10:05:00Z"),
    results: [{ sentence_id: "s001", student_rewrite: "I went home.", accepted: true, feedback: "时态已修正。" }],
  });
  assert.strictEqual(feedbackHistory.round, 2);
  assert.deepStrictEqual(feedbackHistory.history.map((batch) => batch.round), [1, 2]);
  assert.deepStrictEqual(feedbackHistory.history.map((batch) => batch.results[0].feedback), ["请修改时态。", "时态已修正。"]);
  const feedbackReplay = backend._test.appendRewriteFeedbackHistory({ feedback_history: feedbackHistory.history }, {
    operation_id: "rewrite-round-2", results: [],
  });
  assert.strictEqual(feedbackReplay.history.length, 2,
    "an idempotent rewrite replay must not append the same feedback round twice");
});

check("rewrite checks preserve every feedback round before replacing the current result view", () => {
  const backend = read(functionPath);
  const performSource = functionSource(backend, "performRewriteJob", "submitRewrites");
  requireEvery(performSource, [
    "appendRewriteFeedbackHistory", "feedback_history", "check_round",
    "previousRecord", "enrichedResults", "rewrite_results: record",
  ], "durable rewrite feedback history");
  assert(performSource.indexOf("appendRewriteFeedbackHistory") < performSource.indexOf("rewrite_results: record"),
    "the new feedback round must be assembled before the whole rewrite result is published");
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
  const ocrPrompt = promptModule.ocrPrompt();
  requireEvery(ocrPrompt, ["one paragraphs item", "joined with two newline characters", "exact non-empty substring", "repeated ambiguous occurrences separately"],
    "OCR paragraph and uncertainty prompt contract");
  const languagePrompt = promptModule.languagePrompt();
  requireEvery(languagePrompt, ["A1", "A2", "B1", "B2", "C1", "C2", "lower", "middle", "upper", "cefr_estimate.commentary_zh"],
    "CEFR writing estimate prompt contract");
  requireEvery(languagePrompt, ["B1-", "B1+", "偏下", "中段", "偏上"], "compact CEFR notation contract");
  assert(/Do not describe[\s\S]{0,180}偏下[\s\S]{0,80}中段[\s\S]{0,80}偏上/.test(languagePrompt),
    "the model must not expose Chinese within-band position labels");
  assert(/manuscript-specific|this manuscript/i.test(languagePrompt),
    "CEFR estimate must describe this manuscript rather than the student's overall level");
  assert(/not.{0,80}(?:overall English proficiency|formal CEFR certificate)/i.test(languagePrompt),
    "CEFR estimate must explicitly avoid claiming certified or global proficiency");
});

check("language coaching prompts bind commentary fields to Simplified Chinese", () => {
  const promptModule = require(path.join(root, promptPath));
  const language = promptModule.languagePrompt();
  const rewrites = promptModule.rewritePrompt();
  assert(/Simplified Chinese|简体中文/i.test(language),
    "language coaching prompt must explicitly require Simplified Chinese commentary");
  requireEvery(language, [
    "overview", "category", "explanation", "suggestion", "coaching_summary",
    "observation", "original", "span", "reference_revision",
  ], "language coaching language contract");
  assert(/profile[_ -]?observations?|profile observation/i.test(language),
    "language coaching prompt must bind profile observations to its language requirement");
  assert(/(?:original|span)[\s\S]{0,500}(?:English|英文)|(?:English|英文)[\s\S]{0,500}(?:original|span)/i.test(language),
    "language coaching prompt must preserve source English in original/span fields");
  assert(/reference_revision[\s\S]{0,240}(?:English|英文)|(?:English|英文)[\s\S]{0,240}reference_revision/i.test(language),
    "language coaching prompt must keep reference revisions in English");

  assert(/Simplified Chinese|简体中文/i.test(rewrites),
    "rewrite-check prompt must explicitly require Simplified Chinese feedback");
  requireEvery(rewrites, ["feedback", "new_errors", "overall_feedback"], "rewrite feedback language contract");
});

check("language and rewrite schemas describe Chinese commentary and English source fields", () => {
  const schemas = require(path.join(root, schemaPath));
  const chinese = /Simplified Chinese|简体中文/i;
  const english = /English|英文/i;
  const languageProperties = schemas.LANGUAGE_SCHEMA.properties;
  const cefrProperties = languageProperties.cefr_estimate.properties;
  const sentenceProperties = languageProperties.sentences.items.properties;
  const issueProperties = sentenceProperties.issues.items.properties;
  const observationProperties = languageProperties.profile_observations.items.properties;
  const rewriteProperties = schemas.REWRITE_SCHEMA.properties;
  const rewriteResultProperties = rewriteProperties.results.items.properties;

  assertDescriptionMatches(languageProperties.overview, chinese, "LANGUAGE_SCHEMA.overview");
  assert(schemas.LANGUAGE_SCHEMA.required.includes("cefr_estimate"), "LANGUAGE_SCHEMA must require cefr_estimate");
  assert.deepStrictEqual(cefrProperties.level.enum, ["A1", "A2", "B1", "B2", "C1", "C2"]);
  assert.deepStrictEqual(cefrProperties.position.enum, ["lower", "middle", "upper"]);
  assertDescriptionMatches(cefrProperties.commentary_zh, chinese, "LANGUAGE_SCHEMA.cefr_estimate.commentary_zh");
  ["category", "explanation", "suggestion"].forEach((field) => {
    assertDescriptionMatches(issueProperties[field], chinese, `LANGUAGE_SCHEMA.sentences[].issues[].${field}`);
  });
  assertDescriptionMatches(sentenceProperties.coaching_summary, chinese, "LANGUAGE_SCHEMA.sentences[].coaching_summary");
  ["category", "observation"].forEach((field) => {
    assertDescriptionMatches(observationProperties[field], chinese, `LANGUAGE_SCHEMA.profile_observations[].${field}`);
  });
  assertDescriptionMatches(sentenceProperties.original, english, "LANGUAGE_SCHEMA.sentences[].original");
  assertDescriptionMatches(issueProperties.span, english, "LANGUAGE_SCHEMA.sentences[].issues[].span");
  assertDescriptionMatches(sentenceProperties.reference_revision, english, "LANGUAGE_SCHEMA.sentences[].reference_revision");

  assertDescriptionMatches(rewriteResultProperties.feedback, chinese, "REWRITE_SCHEMA.results[].feedback");
  const newErrorsDescription = rewriteResultProperties.new_errors.items.description
    ? rewriteResultProperties.new_errors.items
    : rewriteResultProperties.new_errors;
  assertDescriptionMatches(newErrorsDescription, chinese, "REWRITE_SCHEMA.results[].new_errors[]");
  assertDescriptionMatches(rewriteProperties.overall_feedback, chinese, "REWRITE_SCHEMA.overall_feedback");
});

check("both initial-review contracts return one short English suggested title", () => {
  const schemas = require(path.join(root, schemaPath));
  const prompts = require(path.join(root, promptPath));
  const shortEnglishTitle = /(?:2\s*(?:-|\u2013|\u2014|to)\s*6[\s\S]{0,30}English[\s\S]{0,30}(?:title|words?)|English[\s\S]{0,30}(?:title|words?)[\s\S]{0,30}2\s*(?:-|\u2013|\u2014|to)\s*6)/i;
  ["STANDARDIZED_SCHEMA", "LANGUAGE_SCHEMA"].forEach((schemaName) => {
    const schema = schemas[schemaName];
    const suggestedTitle = schema && schema.properties && schema.properties.suggested_title;
    assert(suggestedTitle, `${schemaName} must declare suggested_title`);
    assert(schema.required.includes("suggested_title"), `${schemaName} must require suggested_title`);
    assertDescriptionMatches(suggestedTitle, shortEnglishTitle, `${schemaName}.suggested_title`);
  });
  [
    ["standardizedPrompt", prompts.standardizedPrompt(require(path.join(root, rubricPath)).getRubric("ielts_task_2"))],
    ["languagePrompt", prompts.languagePrompt()],
  ].forEach(([name, prompt]) => {
    assert(prompt.includes("suggested_title"), `${name} must request suggested_title in the same review call`);
    assert(shortEnglishTitle.test(prompt), `${name} must require a 2-6 English word title`);
  });
});

check("AI review persists its suggested title only until the student names the Composition", () => {
  const backend = read(functionPath);
  const performSource = matchingFunctionSource(backend,
    "(?:perform|process|run)[A-Z\\w]*Review[A-Z\\w]*Job", "review-job processor function");
  requireEvery(performSource, ["suggested_title", "title_source"], "review title persistence");
  assert(/titleSource\s*\([^)]*\)\s*={2,3}\s*["']student["'][\s\S]{0,500}if\s*\(\s*(?:current|candidate)TitleIsStudent\s*\)/.test(performSource)
      || /title_source[\s\S]{0,320}(?:!={1,2}|not)[\s\S]{0,120}["']student["']|["']student["'][\s\S]{0,120}(?:!={1,2}|not)[\s\S]{0,320}title_source/i.test(performSource),
    "review publication must check that title_source is not student before persisting the AI title");
  assert(/suggested_title[\s\S]{0,500}title_source\s*(?::|=)\s*["']ai["']|title_source\s*(?::|=)\s*["']ai["'][\s\S]{0,500}suggested_title/i.test(performSource),
    "an accepted suggested title must be marked with title_source: ai");
});

check("manual title editing is allowed after completion without changing activity ordering", () => {
  const backend = read(functionPath);
  const updateSource = functionSource(backend, "updateCompositionTitle", "usageMatchesScope");
  requireEvery(updateSource, ["ownedComposition", "title", "title_source", "student"],
    "manual title update action");
  assert(!/status\s*={2,3}\s*["']completed["'][\s\S]{0,180}(?:throw|COMPOSITION_READ_ONLY)|COMPOSITION_READ_ONLY/.test(updateSource),
    "updateCompositionTitle must remain available for completed writing");
  assert(!/(?:^|[,{])\s*updated_at\s*:/m.test(updateSource),
    "editing a title must not change updated_at or reorder the portfolio by learning activity");
  assert(/action\s*={2,3}\s*["']updateCompositionTitle["'][\s\S]{0,120}updateCompositionTitle\s*\(/.test(backend),
    "the authenticated writingTutor router must expose updateCompositionTitle");
});

check("title generation reuses the two review model calls", () => {
  const backend = read(functionPath);
  const performSource = matchingFunctionSource(backend,
    "(?:perform|process|run)[A-Z\\w]*Review[A-Z\\w]*Job", "review-job processor function");
  const modelCalls = Array.from(performSource.matchAll(/callStructuredModel\s*\(/g));
  assert.strictEqual(modelCalls.length, 2,
    "performReviewJob must keep exactly its standardized and language review calls, with no independent title-generation call");
  assert(!/(?:generate|create|suggest)[A-Z\w]*Title\s*\([^)]*\)[\s\S]{0,500}callStructuredModel/i.test(backend),
    "the backend must not add a separate model request just to generate a title");
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

check("empty New Writing placeholders are hidden and safely discarded", () => {
  const backend = read(functionPath);
  const client = read(clientPath);
  const emptyGuard = functionSource(backend, "isDiscardableEmptyComposition", "discardEmptyComposition");
  const discardAction = functionSource(backend, "discardEmptyComposition", "createComposition");
  const listSource = functionSource(backend, "listCompositions", "ocrPhotoUrls");
  requireEvery(emptyGuard, [
    'status || "draft"', "revision", "word_count", "visibleTitle", "prompt_text",
    "confirmed_text", "library_prompt_id", "pending_upload", "pending_ocr",
    "active_job_id", "standardized_review", "language_review", "completed_at",
  ], "server empty-draft guard");
  assert(/isDiscardableEmptyComposition\s*\(\s*composition\s*\)[\s\S]{0,220}\.remove\s*\(/.test(discardAction),
    "the discard action may remove only a server-verified empty draft");
  requireEvery(listSource, ["isDiscardableEmptyComposition", "visibleRows", "staleEmptyRows", "EMPTY_DRAFT_RETENTION_MS"],
    "History empty-draft cleanup");
  requireEvery(client, [
    "function isEmptyCompositionDraft", "function portfolioCompositions",
    "function discardCurrentEmptyComposition", "discardEmptyComposition",
    "function returnToTutorHome",
  ], "client empty-draft lifecycle");
  assert(/function renderPortfolio[\s\S]{0,500}portfolioCompositions\s*\(\s*\)/.test(client),
    "History counts and rows must exclude empty New Writing placeholders immediately");
  assert(!/data-(?:delete|remove|discard)-composition/.test(client),
    "empty cleanup must not introduce a student-facing delete control");
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

check("the shared AI waiting assets load before the Tutor client", () => {
  const page = read(pagePath);
  const client = read(clientPath);
  requireEvery(`${page}\n${client}`, [
    "assets/css/ai-waiting-runner.css",
    "assets/js/ai-waiting-runner.js",
    "data-view-waiting-result",
  ], "AI waiting asset loading");
  assert(page.indexOf("ai-waiting-runner.js") < page.indexOf("ai-tutor.js"), "Runner must load before ai-tutor.js");
});

check("visitor access explains how to request a temporary student account", () => {
  const page = read(pagePath);
  const client = read(clientPath);
  requireEvery(page, [
    'id="visitor-access-dialog"',
    "@猫先生英语",
    "mailto:jxbleo@foxmail.com",
    "获取临时学生账号",
  ], "AI Tutor visitor access dialog");
  assert(client.includes("state.session.mode !== 'student'"), "AI Tutor must gate the workspace by student session");
  assert(client.indexOf("state.session.mode !== 'student'") < client.indexOf("writingCall('getProfile')", client.indexOf("function init")), "visitor gate must run before private writing calls");
  assert(client.includes("accessDialog.hidden = false"), "non-students must see the temporary-account dialog");
  assert(client.includes("app.inert = true"), "the unavailable writing workspace must be inert behind the modal");
});

check("all four durable jobs use one waiting renderer and keep their polling", () => {
  const client = read(clientPath);
  const waitingFunctions = [
    ["renderOcrWaiting", "startOcrPolling"],
    ["renderReviewWaiting", "startReviewPolling"],
    ["renderRewriteWaiting", "applyRewriteResult"],
    ["renderRevisionScanWaiting", "renderRevisionScanFailure"],
  ];
  waitingFunctions.forEach(([name, next]) => {
    const waiting = functionSource(client, name, next);
    assert(waiting.includes("renderAiWaitingExperience"), `${name} must use the shared waiting renderer`);
    assert(!waiting.includes("loading-orbit"), `${name} must not retain the rotating loader`);
  });
  ["startOcrPolling", "startReviewPolling", "startRewritePolling", "startRevisionScanPolling"].forEach((name) => {
    const source = matchingFunctionSource(client, name, `${name} source`);
    assert(source.includes("getComposition"), `${name} must keep polling getComposition`);
  });
  requireEvery(client, [
    "function renderAiWaitingExperience",
    "function updateAiWaitingExperience",
    "function finishAiWaitingExperience",
    "function destroyAiWaitingExperience",
    "waitingRunner: null",
    "waitingKind: ''",
    "waitingTaskState: ''",
  ], "waiting lifecycle API");
});

check("the waiting stages reflect server state and expose only a durable handoff", () => {
  const client = read(clientPath);
  const renderer = `${functionSource(client, "waitingStageDefinitions", "waitingStageClass")}\n${functionSource(client, "renderAiWaitingExperience", "updateAiWaitingExperience")}`;
  requireEvery(renderer, ["Uploaded", "Reading", "Organising", "Preparing", "Reviewing", "Comparing", "Checking", "Matching", "Ready", "runner-canvas", "data-return-home"], "waiting renderer contract");
  assert(!/Continue in Background|Waiting for the same saved|checks every 5 seconds|Distance|Ink/.test(renderer), "V2 waiting renderer must remove legacy copy and metrics");
  assert(/waitingStageDefinitions\s*\(\s*kind/.test(renderer), "waiting stages must be task-specific");
  const ocrWaiting = functionSource(client, "renderOcrWaiting", "startOcrPolling");
  assert(/durable:\s*!uploadPending/.test(ocrWaiting), "OCR upload confirmation must gate the durable handoff");
  assert(/allowBackground:\s*!uploadPending/.test(ocrWaiting), "OCR upload confirmation must gate Back");
  assert(!/预计|剩余秒|百分比|%/.test(renderer), "waiting renderer must not display fake progress or time estimates");
  assert(/revision_ocr\s*:\s*["']revision-scan-waiting["']/.test(client), "revision OCR must keep its existing screen identity");
  const revisionUpload = matchingFunctionSource(client, "beginRevisionScanUpload", "revision upload source");
  assert(/status:\s*["']photo_uploading["'][\s\S]{0,180}durable:\s*false/.test(revisionUpload), "revision upload must render a non-durable Uploading state before finish");
  assert(!/renderRevisionScanWaiting\s*\(\s*\{[^}]*status:\s*["']queued["'][^)]*\)\s*;/.test(revisionUpload), "revision upload must not claim a queued durable job before finishRevisionScanUpload");
});

check("V2 polling is visible-aware, serialized, wakeable, and bounded", () => {
  const client = read(clientPath);
  requireEvery(client, [
    "waitingPollTimer",
    "waitingPollInFlight",
    "waitingPollWakePending",
    "waitingPollFailures",
    "scheduleWaitingPoll",
    "wakeWaitingPoll",
    "clearWaitingPollSchedule",
    "waitingPollDelay",
    "visibilitychange",
    "online",
    "focus",
  ], "shared polling controller");
  assert(/waitingPollInFlight/.test(client) && /if\s*\(state\.waitingPollInFlight\)/.test(client), "polling needs an in-flight guard");
  assert(/hidden[\s\S]{0,180}10000|document\.hidden[\s\S]{0,180}10\s*\*\s*1000/.test(client), "hidden tabs must use the 10-second cadence");
  assert(/!document\.hidden[\s\S]{0,180}3000|document\.hidden\s*\?\s*10000\s*:\s*3000/.test(client), "visible tabs must use the 3-second cadence");
  assert(/3\s*\*\s*1000[\s\S]{0,180}20\s*\*\s*1000|waitingPollFailures[\s\S]{0,260}20\s*\*\s*1000/.test(client), "poll errors must back off to a 20-second cap");
  assert(/Math\.min\(4,\s*state\.waitingPollFailures\s*\+\s*1\)/.test(client), "the fourth transient failure must actually reach the 20-second backoff");
  assert(/function poll\(\)[\s\S]{0,180}waitingPollNow\s*=\s*poll[\s\S]{0,180}if\s*\(state\.waitingPollInFlight\)/.test(client), "a new task must retain its wake callback while an older request is still in flight");
  ["startOcrPolling", "startReviewPolling", "startRewritePolling", "startRevisionScanPolling"].forEach((name) => {
    const source = matchingFunctionSource(client, name, `${name} source`);
    requireEvery(source, ["getComposition", "scheduleWaitingPoll", "waitingPollInFlight"], `${name} serialized polling`);
  });
});

check("waiting stages and task predicates keep durable identity guards", () => {
  const client = read(clientPath);
  requireEvery(client, ["composition_id", "operation_id", "generationKey", "isActive", "waitingKind"], "stale polling guard vocabulary");
  requireEvery(client, ["pending_ocr", "reviewReady", "rewriteReady", "revisionScanReady"], "ready predicates");
  assert(/waitingResultAction/.test(client), "result action must be held by the waiting surface");
  assert(/compositionId|composition_id/.test(client), "polling must retain Composition identity");
  assert(/revisionScanJobFrom\(result\s*&&\s*result\.composition\s*\|\|\s*result\)/.test(client), "revision scan operation guards must inspect the returned Composition");
});

check("success remains Ready until the student clicks one result action", () => {
  const client = read(clientPath);
  const renderer = functionSource(client, "finishAiWaitingExperience", "destroyAiWaitingExperience");
  requireEvery(renderer, ["waitingResultAction", "data-view-waiting-result", "Your Draft Is Ready", "Your Review Is Ready", "Your Feedback Is Ready", "Your Revision Scan Is Ready"], "Ready handoff");
  assert(!/next\s*\(\)|typeof\s+next\s*===\s*["']function["']\s*\)\s*next/.test(renderer), "finishAiWaitingExperience must not auto-run the result callback");
  requireEvery(client, ["Review Text", "View Review", "View Feedback", "Review Scan", "waitingReadyAnnounced", "AudioContext", "ready-announced"], "Ready controls and sound");
  requireEvery(client, ["unlockWaitingReadySound", "pointerdown", "audio.resume"], "user-gesture audio unlock");
  assert(/data-view-waiting-result[\s\S]{0,700}(waitingResultAction|action)/.test(client), "result button must atomically consume the pending action");
  ["showOcrResult", "showReviewResult", "applyRewriteResult"].forEach((name) => {
    const source = matchingFunctionSource(client, name, `${name} success source`);
    assert(source.includes("finishAiWaitingExperience"), `${name} must use the Ready handoff`);
  });
});

check("success and failure paths cleanly hand off or destroy the Runner", () => {
  const client = read(clientPath);
  [
    ["showOcrResult", "renderOcr"],
    ["showReviewResult", "renderStandardized"],
    ["applyRewriteResult", "renderCompletion"],
  ].forEach(([name, expected]) => {
    const source = matchingFunctionSource(client, name, `${name} success source`);
    assert(source.includes("finishAiWaitingExperience"), `${name} must use the bounded finish handoff`);
    assert(source.includes(expected), `${name} must retain its existing success exit`);
  });
  ["renderOcrFailure", "renderReviewFailure", "renderRewriteFailure", "renderRevisionScanFailure", "renderFatalAction"].forEach((name) => {
    const source = matchingFunctionSource(client, name, `${name} cleanup source`);
    assert(source.includes("destroyAiWaitingExperience"), `${name} must destroy the Runner`);
  });
  requireEvery(client, [
    "window.addEventListener('pagehide'",
    "document.addEventListener('visibilitychange'",
    "state.waitingRunner.pause()",
    "state.waitingRunner.resume()",
  ], "Runner page lifecycle");
  const finishSource = functionSource(client, "finishAiWaitingExperience", "destroyAiWaitingExperience");
  requireEvery(finishSource, ["waitingTaskState = 'ready'", "setTaskState('ready')", "waitingResultAction"], "Ready handoff");
  assert(!/\.finish\s*\(/.test(finishSource), "Ready must not stop the Runner through finish()");
});

check("the Runner remains optional and does not own AI state", () => {
  const runner = read("assets/js/ai-waiting-runner.js");
  requireEvery(runner, ["window.MrCatWaitingRunner", "mount", "snapshot", "requestAnimationFrame"], "Runner module");
  assert(!/writingCall|CloudBase|composition|job_id|student_uid|fetch\s*\(|localStorage|indexedDB|document\.cookie/i.test(runner), "Runner must not own AI or persistence state");
  assert(/window\.MrCatWaitingRunner/.test(read(clientPath)), "Tutor must tolerate a missing optional Runner module");
});

if (failures.length) {
  process.stderr.write(`\nAI Tutor contract failures (${failures.length}):\n`);
  failures.forEach((failure) => process.stderr.write(`- ${failure}\n`));
  process.exitCode = 1;
} else {
  console.log("\nAI Tutor source contracts passed.");
}
