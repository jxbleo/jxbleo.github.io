#!/usr/bin/env node
"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../assets/js/speaking-report.js"), "utf8");
const snapshot = {
  share_kind: "teacher", title: "Synthetic classroom discussion · 2026-10-10", generated_at: "2026-10-11T04:00:00Z",
  group_summary_zh: "小組比較不同方案，並提出支持理由。", group_strengths: ["回應同伴的觀點"],
  group_priorities: ["以具體例子支持觀點"], discussion_flow: ["提出方案，再比較利弊。"],
  candidates: [{ speaker_label: "Speaker 1", summary_zh: "能清楚表達觀點。", domains: {
    communication_strategies: { score: 5, commentary_zh: "主動邀請同伴參與。", strengths: ["Invite peers"], priority_actions: ["Build on another view"], language_suggestions: ["Could we also consider <another option>?"] },
    ideas_organisation: { score: 4, commentary_zh: "有清晰立場。", strengths: ["Clear position"], priority_actions: ["Add evidence"], language_suggestions: ["For example…"] },
    vocabulary_language_patterns: { score: null, commentary_zh: "Language feedback" },
  }, turn_reviews: [{ start_ms: 0, end_ms: 12000, transcript_text: "We could compare the two options.",
    communication_strategies: { strength_zh: "能引入比較。", limitation_zh: "未邀請同伴回應。", improvement_zh: "加上一個開放問題。", sample_en: "What do you think?" },
    ideas_organisation: { commentary_zh: "Historical coaching remains readable.", sample_en: "One advantage is…" },
  }], evidence: [{ start_ms: 0, text: 'Evidence <script>unsafe</script>' }] },
  { speaker_label: 'Speaker 2', summary_zh: 'SECOND STUDENT ONLY', domains: { ideas_organisation: { score: 6, commentary_zh: 'SECOND DOMAIN ONLY' } },
    turn_reviews: [{ start_ms: 13000, end_ms: 18000, transcript_text: 'SECOND TURN ONLY', communication_strategies: { commentary_zh: 'Second coaching', sample_en: 'Second example' } }] }],
  transcript: [{ speaker_label: "Speaker 1", text: "GROUP TRANSCRIPT NOT DISPLAYED" }],
};
const metadata = { source_label: 'DSE 2019 · Set 8.3', discussion_date: '2026-10-10' };
async function render({ valid = true, token = "synthetic-token", sharedSnapshot = snapshot, sharedMetadata = metadata } = {}) {
  const selected = { innerHTML: '' }, buttons = [], calls = [];
  const root = { innerHTML: '', querySelector: () => selected, querySelectorAll() {
    const match = this.innerHTML.match(/id="speaking-selected-report" aria-live="polite">([\s\S]*)<\/div><\/article>$/);
    selected.innerHTML = match ? match[1] : '';
    for (const item of this.innerHTML.matchAll(/data-candidate-index="(\d+)"[^>]*aria-pressed="(true|false)"/g)) {
      const attributes = { 'data-candidate-index': item[1], 'aria-pressed': item[2] };
      buttons.push({ attributes, getAttribute: key => attributes[key], setAttribute: (key, value) => { attributes[key] = value; }, addEventListener(event, handler) { this[event] = handler; } });
    }
    return buttons;
  } };
  const window = { location: { hash: token ? "#share=" + token : "", search: "" }, MrCatCloud: {
    getLoginState: async () => null,
    signInAnonymously: async () => { calls.push("anonymous"); return {}; },
    callFunction: async (name, args) => { calls.push({ name, ...args }); return valid
      ? { success: true, snapshot: sharedSnapshot, metadata: sharedMetadata, expires_at: "2026-10-17T04:00:00Z" }
      : { success: false, code: "SHARE_NOT_AVAILABLE" }; },
  } };
  vm.runInNewContext(source, { window, document: { getElementById: () => root }, URLSearchParams });
  await new Promise(resolve => setImmediate(resolve));
  return { html: root.innerHTML, calls, selected, buttons };
}
async function main() {
  const { html, calls, selected, buttons } = await render();
  assert.equal(calls[0], "anonymous");
  assert.equal(calls[1].action, "getSharedReport");
  assert(html.includes('<h1>Synthetic classroom discussion</h1>'));
  assert(html.includes('<dt>Source</dt><dd>DSE 2019 · Set 8.3</dd>'));
  assert(html.includes('<dt>Discussion Date</dt><dd>2026-10-10</dd>'));
  assert(!/Private share|Report generated|Expires|Names are hidden|infer identity|2026-10-11/.test(html));
  assert.match(html, /<\/details><\/section><\/div><\/article>$/, 'the report ends at the details disclosure');
  for (const text of ["Invite peers", "Build on another view", "Add evidence", "Language suggestions", "What do you think?", "Historical coaching remains readable.", "See more details", "—/7"]) assert(html.includes(text), text);
  assert(html.includes("&lt;script&gt;unsafe&lt;/script&gt;"));
  assert(html.includes("&lt;another option&gt;"));
  assert(!html.includes("<script>"));
  assert(!/Pronunciation|Not assessed|Turn-by-turn review|Group summary|GROUP TRANSCRIPT NOT DISPLAYED|SECOND STUDENT ONLY/.test(html));
  assert.match(selected.innerHTML, /<details class="speaking-shared-turn-review"><summary>See more details<\/summary>/);
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].attributes['aria-pressed'], 'true');
  buttons[1].click();
  assert.equal(buttons[0].attributes['aria-pressed'], 'false');
  assert.equal(buttons[1].attributes['aria-pressed'], 'true');
  assert(selected.innerHTML.includes('SECOND STUDENT ONLY'));
  assert(!selected.innerHTML.includes('Invite peers'));
  assert(!/<details[^>]*\sopen(?:\s|>)/.test(selected.innerHTML));
  buttons[0].click();
  assert(selected.innerHTML.includes('Invite peers'));
  assert(!selected.innerHTML.includes('SECOND STUDENT ONLY'));
  assert.equal(calls.length, 2, 'switching students never refetches or changes share authority');
  const duplicate = structuredClone(snapshot); duplicate.candidates[1].speaker_label = duplicate.candidates[0].speaker_label;
  const sameNames = await render({ sharedSnapshot: duplicate }); sameNames.buttons[1].click();
  assert(sameNames.selected.innerHTML.includes('SECOND STUDENT ONLY'), 'selection uses candidate index, not display name');
  const own = await render({ sharedSnapshot: { share_kind: 'student', self: snapshot.candidates[0], participant_summaries: [{ speaker_label: 'PEER HIDDEN' }] } });
  assert.equal(own.buttons.length, 0); assert(own.selected.innerHTML.includes('Invite peers')); assert(!own.html.includes('PEER HIDDEN'));
  assert((await render({ sharedSnapshot: { share_kind: 'teacher', candidates: [] } })).html.includes('No student report'));
  const legacy = await render({ sharedMetadata: null });
  assert(legacy.html.includes('<h1>Synthetic classroom discussion</h1>'));
  assert(legacy.html.includes('<dt>Source</dt><dd>Not recorded</dd>'));
  assert(legacy.html.includes('<dt>Discussion Date</dt><dd>2026-10-10</dd>'));
  const noDate = await render({ sharedSnapshot: { ...snapshot, title: 'A title mentioning 2026-10-10' }, sharedMetadata: null });
  assert(noDate.html.includes('<h1>A title mentioning 2026-10-10</h1>'));
  assert(noDate.html.includes('<dt>Discussion Date</dt><dd>Not recorded</dd>'));
  const escaped = await render({ sharedMetadata: { source_label: '<script>source</script>', discussion_date: '<img>' } });
  assert(escaped.html.includes('&lt;script&gt;source&lt;/script&gt;'));
  assert(escaped.html.includes('&lt;img&gt;'));
  assert((await render({ valid: false })).html.includes("Report unavailable"));
  assert.equal((await render({ token: "" })).calls.length, 0);
  assert(!/localStorage|sessionStorage|indexedDB/.test(source));
  console.log("Parent Speaking reader: anonymous entry, one-student selection, duplicate labels, collapsed details, PD omission, escaping, legacy/student shares and unavailable links passed.");
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { snapshot, metadata };
