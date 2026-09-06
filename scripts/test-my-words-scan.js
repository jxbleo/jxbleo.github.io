"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const scan = require("../cloudfunctions/vocabularyScan/index.js")._test;
const worker = require("../cloudfunctions/vocabularyScanWorker/index.js")._test;
const schema = require("../cloudfunctions/vocabularyScan/schemas.js");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const rawOcr = {
  blocks: [{
    block_type: "paragraph",
    sentences: [{
      text: "I don't trust well-known numbers, but take it into account.",
      uncertain_tokens: [
        { token_index: 2, token_text: "trust", reason: "blur" },
        { token_index: 2, token_text: "trust", reason: "duplicate" },
        { token_index: 90, token_text: "bad", reason: "ignored" },
      ],
      marked_tokens: [
        { token_index: 1, token_text: "don't", mark_type: "underline", confidence: "high" },
        { token_index: 3, token_text: "well-known", mark_type: "circle", confidence: "low" },
        { token_index: 6, token_text: "take", mark_type: "star", confidence: "medium" },
        { token_index: 6, token_text: "take", mark_type: "star", confidence: "medium" },
      ],
    }],
  }],
};

const ocr = scan.canonicalizeOcr(rawOcr);
const sentence = ocr.blocks[0].sentences[0];
assert.deepStrictEqual(sentence.tokens.map((token) => token.text), ["I", "don't", "trust", "well-known", "numbers", "but", "take", "it", "into", "account"]);
assert.deepStrictEqual(sentence.marked_tokens.map((token) => token.token_text), ["don't", "take"]);
assert.deepStrictEqual(sentence.uncertain_tokens.map((token) => token.token_text), ["trust"]);
assert.strictEqual(ocr.token_count, 10);

const page = { page_id: "page_1", page_index: 0, status: "succeeded", ocr };
const candidate = scan.rebuildCandidate(page, { sentence_id: sentence.sentence_id, token_ids: ["token_9", "token_7", "token_10"] });
assert.strictEqual(candidate.text, "take into account");
assert.strictEqual(candidate.kind, "phrase");
assert.strictEqual(candidate.context, sentence.text);
assert.deepStrictEqual(candidate.context_token_ranges.map((range) => candidate.context.slice(range.start, range.end)), ["take", "into", "account"]);
assert.throws(() => scan.rebuildCandidate(page, { sentence_id: "sentence_missing", token_ids: ["token_1", "token_2"] }), /CANDIDATE/);
assert.throws(() => scan.rebuildCandidate(page, { sentence_id: sentence.sentence_id, token_ids: [] }), /CANDIDATE/);

const longText = Array.from({ length: 90 }, (_, index) => `word${index}`).join(" ");
const longOcr = scan.canonicalizeOcr({ blocks: [{ block_type: "paragraph", sentences: [{ text: longText, uncertain_tokens: [], marked_tokens: [] }] }] });
const longSentence = longOcr.blocks[0].sentences[0];
const windowed = scan.rebuildCandidate({ page_id: "page_2", page_index: 1, status: "succeeded", ocr: longOcr }, { sentence_id: longSentence.sentence_id, token_ids: ["token_40", "token_41"] });
assert(windowed.context.length <= 320);
assert(windowed.context_token_ranges.every((range) => range.start >= 0 && range.end <= windowed.context.length));
assert.throws(() => scan.rebuildCandidate({ page_id: "page_2", page_index: 1, status: "succeeded", ocr: longOcr }, { sentence_id: longSentence.sentence_id, token_ids: ["token_1", "token_90"] }), /CANDIDATE_CONTEXT_TOO_LONG/);

assert.throws(() => scan.canonicalizeOcr({ blocks: Array.from({ length: 26 }, () => ({ block_type: "paragraph", sentences: [{ text: "word ".repeat(240), uncertain_tokens: [], marked_tokens: [] }] })) }), /OCR_TOO_LARGE/);
assert.throws(() => scan.canonicalizeOcr({ blocks: [] }), /OCR_EMPTY/);

assert.strictEqual(scan.sameManifest([{ page_index: 0, mime_type: "image/jpeg", size_bytes: 4 }], [{ page_index: 0, mime_type: "image/jpeg", size_bytes: 4 }]), true);
assert.strictEqual(scan.sameManifest([{ page_index: 0, mime_type: "image/jpeg", size_bytes: 4 }], [{ page_index: 0, mime_type: "image/png", size_bytes: 4 }]), false);
assert.strictEqual(scan.secretMatches("x", "x"), true);
assert.strictEqual(scan.secretMatches("x", "y"), false);
assert.strictEqual(worker.secretMatches("timer", "timer"), true);
assert.strictEqual(worker.isTimerEvent({ Type: "Timer", TriggerName: "vocabulary-scan-worker-minute" }), true);
assert.strictEqual(worker.isTimerEvent({ Type: "HTTP" }), false);
assert.deepStrictEqual(scan.modelUsageSummary({ telemetry: { attempts: [{ input_tokens: 3, output_tokens: 2, total_tokens: 5 }, { input_tokens: 7, output_tokens: 1, total_tokens: 8 }] } }), { call_count: 2, input_tokens: 10, output_tokens: 3, total_tokens: 13 });
assert.deepStrictEqual(scan.mergeModelUsage({ call_count: 1, input_tokens: 3, output_tokens: 2, total_tokens: 5 }, { call_count: 2, input_tokens: 10, output_tokens: 3, total_tokens: 13 }), { call_count: 3, input_tokens: 13, output_tokens: 5, total_tokens: 18 });
assert.deepStrictEqual(schema.validateOutput(rawOcr), []);
assert(schema.validateOutput({ blocks: [{ block_type: "bad", sentences: [] }] }).length > 0);

const html = read("my-words.html");
const dashboardHtml = read("dashboard.html");
const dashboardJs = read("assets/js/dashboard.js");
const appCss = read("assets/css/app.css");
const js = read("assets/js/my-words-scan.js");
const css = read("assets/css/my-words-scan.css");
const myWordsJs = read("assets/js/my-words.js");
const backend = read("cloudfunctions/vocabularyScan/index.js");
const workerSource = read("cloudfunctions/vocabularyScanWorker/index.js");
const shared = read("cloudfunctions/_shared/personal-vocabulary-items.js");
const provider = read("cloudfunctions/vocabularyScan/model-provider.js");

assert(html.includes("data-open-scan") && html.includes("data-open-manual"));
assert(html.includes('id="my-words-add-form" hidden'));
assert(html.includes('capture="environment"') && html.includes("data-scan-commit"));
assert(html.includes("data-scan-photo-choice") && html.includes('data-scan-photo-source="camera"') && html.includes('data-scan-photo-source="library"'));
assert(html.includes("my-words-scan-photo-drop") && html.includes("data-scan-photo-count"));
assert(html.includes("data-scan-progress") && html.includes("data-scan-progress-track") && html.includes("data-scan-ready-hint"));
assert(html.includes("Long-press") && html.includes("not next to each other"));
assert(html.includes('data-scan-mode="crop"') && html.includes('data-scan-mode="mask"') && html.includes('data-scan-mode="erase"'));
assert(html.includes("data-scan-preview") && html.includes("data-scan-page-prev"));
assert(html.includes("assets/js/my-words-scan.js?v=20260906-2") && html.includes("assets/css/my-words-scan.css?v=20260905-1"));
assert(dashboardHtml.includes("dashboard-words-scan-overlay") && dashboardHtml.includes("data-scan-next disabled>Upload</button>"));
assert(!dashboardHtml.includes("Bring in the words you found.") && !dashboardHtml.includes("Prepare Photos"));
assert(dashboardHtml.includes("Page") || js.includes("'Page '"));
assert(dashboardJs.includes("is-scan-covered") && js.includes("isDashboardScan") && js.includes("is-choose-phase"));
assert(appCss.includes("width: min(720px, 100%)") && appCss.includes("height: min(720px, 86dvh)"));
assert(appCss.includes("dashboard-words-scan-overlay") && appCss.includes("blur(30px) saturate(160%)"));

assert(js.includes("getBoundingClientRect") && js.includes("destination-out"));
assert(js.includes("cropHandles") && js.includes("exportProcessed") && js.includes("3000"));
assert(js.includes("longPressMove") && js.includes("data-scan-finish-phrase"));
assert(js.includes("flushCandidateSync") && js.includes("candidate_revision"));
assert(js.includes("getPagePreview") && js.includes("removePage") && js.includes("retryPage"));
assert(js.includes("state.didCommit") && js.includes("mrcat:scan-opened") && js.includes("mrcat:scan-committed") && js.includes("mrcat:scan-closed"));
assert(js.includes("focusTrap") && js.includes("window.scrollTo(0, state.scrollY)"));
assert(js.includes("openPhotoChoice") && js.includes("pendingPhotoReplaceIndex") && js.includes("my-words-scan-photo-card"));
assert(js.includes("renderScanProgress") && js.includes("showReviewReady") && js.includes("aria-valuenow"));
assert(js.includes("is-collapsed") && js.includes("is-empty"));
assert(js.includes("textContent") && !js.includes("reviewHost.innerHTML") && !js.includes("drawerHost.innerHTML"));
assert(myWordsJs.includes("mrcat:close-add-panel") && myWordsJs.includes("mrcat:scan-committed"));

assert(css.includes("touch-action: none") && css.includes("prefers-reduced-motion") && css.includes("forced-colors"));
assert(css.includes("my-words-scan-photo-choice-sheet") && css.includes("my-words-scan-photo-drop") && css.includes("my-words-scan-replace-photo"));
assert(css.includes("myWordsScanBeam") && css.includes("my-words-scan-ready-hint") && css.includes("-webkit-touch-callout: none"));
assert(css.includes("grid-template-rows: auto minmax(0, 1fr) auto") && css.includes("height: clamp(142px, 22dvh, 176px)") && css.includes("overflow-y: auto"));
assert(css.includes(".my-words-scan-candidate strong") && css.includes("font-size: .7rem"));
assert(css.includes("is-phrase-anchor") && css.includes("is-marked") && css.includes("is-selected"));

assert(backend.includes("db.runTransaction") && backend.includes("claimPageJob"));
assert(backend.includes("const info = await app.auth().getUserInfo()") && !backend.includes("getUserInfo().then"));
assert(backend.includes("candidate_revision") && backend.includes("context_token_ranges"));
assert(backend.includes('cleanup_error: "PHOTO_DELETE_RETRY_REQUIRED"'));
assert(backend.includes("reserveQuotaForScan") && backend.includes("quota_refunded_at"));
assert(workerSource.includes("recoverExpiredLeases") && workerSource.includes("retryCleanup"));
assert(workerSource.includes("active_vocabulary_scan_id: null") && workerSource.includes("refundUnusedQuota"));
assert(shared.includes("context_token_ranges") && shared.includes("saved_examples"));
assert(provider.includes('../writingTutor/model-provider') && provider.includes("vision: true"));

console.log("My Words Scan tests passed");
