#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const bbcHtml = fs.readFileSync(path.join(root, "bbc.html"), "utf8");
const submitAttemptJs = fs.readFileSync(path.join(root, "cloudfunctions/submitAttempt/index.js"), "utf8");

const inlineScript = bbcHtml.match(/<script>\n\(function\(\) \{[\s\S]*?<\/script>/);
assert(inlineScript, "BBC inline runtime script must exist");
new vm.Script(inlineScript[0].replace(/^<script>\n/, "").replace(/<\/script>$/, ""));

const correctionStart = bbcHtml.indexOf("function enterCorrectionMode(results)");
const correctionEnd = bbcHtml.indexOf("function markCorrectionChanged", correctionStart);
assert(correctionStart >= 0 && correctionEnd > correctionStart, "BBC must provide inline correction mode");
const correctionBlock = bbcHtml.slice(correctionStart, correctionEnd);

assert(
  correctionBlock.includes("result.isCorrect || result.type === 'mc'"),
  "correct answers and every MC question must stay locked during correction"
);
assert(
  correctionBlock.includes("field.disabled = false;"),
  "incorrect non-MC fields must reopen for correction"
);
assert(
  correctionBlock.includes("applyMcLocks();"),
  "first-submission MC locks must be reapplied after the result dialog closes"
);
assert(
  bbcHtml.includes("showResultOverlay(response, function()"),
  "closing the result dialog must enter correction without leaving the worksheet"
);
assert(
  bbcHtml.includes("submitBtn.textContent = 'Submit Again';"),
  "correction must expose a repeat submission"
);
assert(
  bbcHtml.includes("markCorrectionChanged(target);"),
  "repeat submission must activate only after an editable answer changes"
);
assert(
  submitAttemptJs.includes("answers = { ...answers, ...bbcMcLockedAnswers };"),
  "BBC retries must continue grading MC questions from their first submitted choices"
);

console.log("BBC inline-correction tests passed.");
