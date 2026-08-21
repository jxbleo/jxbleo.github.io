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

check("AI Tutor header groups the approved Home, History, and New actions", () => {
  const page = read(pagePath);
  const styles = read(stylePath);
  requireEvery(page, [">Home</button>", ">History</button>", ">New</button>"], "AI Tutor toolbar");
  assert(/<div class="toolbar-pair"[\s\S]*?>History<\/button>[\s\S]*?>New<\/button>[\s\S]*?<\/div>/.test(page), "History and New must share the right-side toolbar group");
  assert(/\.toolbar-home\s*\{[\s\S]*?color:\s*#c9403a/.test(styles), "Home must retain red text styling");
});

const publicActions = [
  "listCompositions",
  "createComposition",
  "startPhotoUpload",
  "finishPhotoUpload",
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

check("AI Tutor keeps only back, portfolio, and actions in its top toolbar", () => {
  const page = read(pagePath);
  const client = read(clientPath);
  const header = /<header\b[^>]*class=["'][^"']*ai-tutor-header[^"']*["'][^>]*>([\s\S]*?)<\/header>/.exec(page);
  assert(header, "missing AI Tutor top toolbar");
  requireEvery(header[1], ["header-back", "portfolio-toggle", "header-actions"], "AI Tutor top toolbar");
  assert(!/brand-lockup|AI Tutor Writing Studio/i.test(`${page}\n${client}`),
    "the removed AI Tutor Writing Studio brand lockup must not remain in the writing workspace");
  assert(!/mobile-toolbar|mobile-context/.test(`${page}\n${client}`),
    "the writing workspace must not render a second mobile toolbar below the primary toolbar");
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

check("toolbar back action uses a custom confirmation before Dashboard navigation", () => {
  const page = read(pagePath);
  const client = read(clientPath);
  const backTag = /<button\b[^>]*id=["']header-back["'][^>]*>/i.exec(page);
  assert(backTag, "the toolbar back control must be a button so it cannot navigate immediately");
  assert(!/<a\b[^>]*(?:id=["']header-back["']|class=["'][^"']*header-back)/i.test(page),
    "the toolbar back control must not be a direct Dashboard anchor");
  requireEvery(page, ["leave-confirmation", "role=\"alertdialog\"", "aria-modal=\"true\"", "data-cancel-leave", "data-confirm-leave"],
    "custom leave-confirmation dialog");
  assert(/header-back[\s\S]{0,1000}addEventListener\s*\(\s*["']click["'][\s\S]{0,500}(?:leave-confirmation|openLeave|showLeave|confirm)/i.test(client)
      || /getElementById\s*\(\s*["']header-back["']\s*\)[\s\S]{0,650}(?:leave-confirmation|openLeave|showLeave|confirm)/i.test(client)
      || /matches\s*\(\s*["']#header-back["']\s*\)[\s\S]{0,120}(?:openLeave|showLeave|confirm)/i.test(client),
    "clicking Back must open the custom confirmation dialog");
  assert(/data-confirm-leave[\s\S]{0,180}(?:confirmLeave|dashboard\.html|window\.location)/i.test(client)
      && /function\s+confirmLeave\s*\([^)]*\)[\s\S]{0,400}(?:dashboard\.html|window\.location)/i.test(client),
    "only the dialog confirmation action may navigate back to Dashboard");
  assert(!/header-back[^\n]{0,400}(?:href\s*=\s*["'][^"']*dashboard|location\.(?:href|assign|replace)\s*\(?\s*["'][^"']*dashboard)/i.test(`${page}\n${client}`),
    "the Back control must not navigate directly before confirmation");
});

check("writing Back and Leave dialog use the approved red and Apple-style treatment", () => {
  const page = read(pagePath);
  const styles = read(stylePath);
  assert(/\.header-back\s*\{[^}]*color\s*:\s*#(?:c9403a|aa4141)/i.test(styles),
    "the top-left Back arrow must be red");
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
});

check("each revision-required sentence renders only source, consolidated analysis, and response area", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const cardSource = functionSource(client, "sentenceCardHtml", "submitRewrites");
  requireEvery(cardSource, [
    "original-sentence", "sentence-row-number", "index + 1", "grammar-analysis", "grammar-analysis-copy", "analysisParts",
    "sentence.coaching_summary", "issue && issue.explanation", "issue && issue.suggestion",
    "result.feedback", "sentence-response", "rewrite-input",
  ], "three-part sentence row");
  assert(!/grammar-analysis-label|grammar-analysis-point|grammar-analysis-summary|grammar-analysis-result|issue\.category|result\.next_step/.test(cardSource),
    "the grammar box must not render headings, categories, split feedback blocks, or English result enums");
  requireEvery(styles, [".grammar-analysis", ".grammar-analysis-copy", ".sentence-response"],
    "single-paragraph grammar analysis styles");
  assert(!/\.grammar-analysis-(?:label|point|points|summary|result)\s*\{|\.issue-list\s*\{|\.coaching-summary\s*\{|\.sentence-feedback\s*\{/.test(styles),
    "legacy split grammar-feedback styles must be removed");
});

check("effective sentences use the matrix-style colored checkmark and no coaching controls", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const teacher = read("assets/js/teacher.js");
  const appStyles = read("assets/css/app.css");
  const cardSource = functionSource(client, "sentenceCardHtml", "submitRewrites");
  const effectiveStart = cardSource.indexOf("if (!required)");
  const effectiveEnd = cardSource.indexOf("var visibility");
  const effectiveBranch = cardSource.slice(effectiveStart, effectiveEnd);
  requireEvery(effectiveBranch, ["sentence-effective-icon", "icon('check')", "这句话无需修改"],
    "effective sentence summary");
  assert(!/grammar-analysis|sentence-response|rewrite-input|你的改写/.test(effectiveBranch),
    "effective sentences must not render analysis or rewrite controls");
  assert(!/no-rewrite-needed/.test(`${client}\n${styles}`),
    "the removed disabled no-rewrite textarea must not remain in source or styles");
  assert(/function rewriteRequired[\s\S]{0,260}["']effective["']/.test(client),
    "legacy effective sentences without rewrite_required must remain exempt from rewriting");
  requireEvery(styles, [".sentence-card.is-effective .original-sentence", ".sentence-effective-icon"],
    "effective sentence styling");
  assert(/function matrixStatusIcon[\s\S]{0,300}status === 'passed'\) return '✓'/.test(teacher),
    "the teacher matrix comparison target must remain its completed checkmark");
  assert(/\.progress-matrix-status-icon\s*\{[^}]*width\s*:\s*22px[^}]*height\s*:\s*22px/is.test(appStyles),
    "the teacher matrix checkmark must retain its 22px circular frame");
  assert(/\.sentence-effective-icon\s*\{[^}]*width\s*:\s*22px[^}]*height\s*:\s*22px[^}]*color\s*:\s*#fff[^}]*background\s*:\s*var\(--sentence-color\)/is.test(styles),
    "the writing checkmark must match the matrix circle while inheriting its sentence color");
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
  assert(/\.capsule-row\s*\{[^}]*padding\s*:[^;}]*16px/is.test(styles),
    "the capsule row must reserve space for its status marks");
});

check("Sentence Revision numbers every row and ends with one Check action", () => {
  const client = read(clientPath);
  const styles = read(stylePath);
  const renderSource = functionSource(client, "renderLanguage", "sentenceCapsuleHtml");
  const cardSource = functionSource(client, "sentenceCardHtml", "submitRewrites");
  requireEvery(cardSource, ["numberedOriginal", "sentence-row-number", "aria-hidden=\"true\""],
    "sentence-row numbering");
  assert((cardSource.match(/numberedOriginal/g) || []).length >= 3,
    "required and effective sentence rows must share the same numbered original");
  assert(/data-submit-rewrites[^>]*>Check<\/button>/.test(renderSource),
    "the editable footer must expose exactly the concise Check action");
  assert(!/未完成的句子|全部完成，提交检查|再次提交检查|icon\('arrow'\)/.test(renderSource),
    "the footer must remove the old hint, dynamic labels, and arrow icon");
  assert(/\.batch-actions\s*\{[^}]*justify-content\s*:\s*flex-end/is.test(styles),
    "the lone desktop Check action must align to the trailing edge");
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
  requireEvery(pollingSource, ["getComposition", "rewrite_results", "setTimeout"], "rewrite result polling");
  assert(/\.catch\s*\([\s\S]{0,500}setTimeout/.test(pollingSource),
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
    suggested_title: "Going Home", overview: "Overview", profile_observations: [],
    sentences: [{
      sentence_id: "s001", original: "I go home.", status: "needs_revision",
      rewrite_required: false, issues: [], coaching_summary: "Agreement", reference_revision: "I go home.",
    }],
  }, [{ sentence_id: "s001", original: "I goes home." }]);
  assert.strictEqual(language.sentences[0].rewrite_required, true);
  assert.strictEqual(language.sentences[0].original, "I goes home.",
    "server must restore the exact source sentence instead of trusting the model echo");
  const effectiveLanguage = backend._test.canonicalLanguageResult({
    suggested_title: "Going Home", overview: "Overview", profile_observations: [],
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
  assert.throws(() => backend._test.canonicalLanguageResult({
    suggested_title: "Wrong Sentence", overview: "Overview", profile_observations: [],
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
  const sentenceProperties = languageProperties.sentences.items.properties;
  const issueProperties = sentenceProperties.issues.items.properties;
  const observationProperties = languageProperties.profile_observations.items.properties;
  const rewriteProperties = schemas.REWRITE_SCHEMA.properties;
  const rewriteResultProperties = rewriteProperties.results.items.properties;

  assertDescriptionMatches(languageProperties.overview, chinese, "LANGUAGE_SCHEMA.overview");
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
