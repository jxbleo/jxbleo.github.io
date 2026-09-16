#!/usr/bin/env node
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require('path').join(__dirname, '../assets/js/speaking-review.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function browser(kind, mode = 'teacher', failure = false, modern = false) {
  const nodes = {}, calls = [], events = {};
  function node(id) {
    return nodes[id] ||= { hidden: false, innerHTML: '', textContent: '', dataset: {}, handlers: {},
      addEventListener(event, fn) { this.handlers[event] = fn; }, pause() {}, load() {}, removeAttribute() {}, play: async () => {} };
  }
  const analysis = { domains: { fluency_coherence: { score: null, commentary_zh: 'Insufficient evidence' } },
    summary_zh: 'Synthetic feedback <img onerror=bad>', transcript: [{ start_ms: 0, text: '<script>bad</script>' }],
    thinking_prompt_zh: 'Chinese thinking prompt', thinking_keywords_en: ['example'], sample_answer_en: 'Synthetic sample', sample_response_en: 'Improved response',
    group_summary_zh: 'Synthetic group feedback', candidates: [{ speaker_label: 'Speaker 1', domains: {}, turn_reviews: [{ start_ms: 0, end_ms: 2000, transcript_text: 'My turn', communication_strategies: { strength_zh: 'Strength', limitation_zh: 'Limitation', improvement_zh: 'Improvement' } }] }] };
  if (modern) {
    analysis.domains = { ideas_organisation: { score: 6, strengths: [{ point_zh: 'Specific strength', explanation_zh: 'Grounded explanation' }], weaknesses: [{ point_zh: 'Specific weakness', explanation_zh: 'Needs detail', improvement_zh: 'Add evidence', example_en: 'Try an example' }] }, vocabulary_language_patterns: { score: 5 } };
    analysis.sample_responses = [1, 2, 3].map(i => ({ thinking_prompt_zh: 'Paired thinking ' + i, response_en: 'Exemplar answer ' + i }));
  }
  const window = { location: { search: '?report=report%26one', href: 'https://example.test/speaking-review.html?report=report%26one', replace(url) { calls.push({ redirect: url }); } },
    addEventListener(event, fn) { events[event] = fn; },
    MrCatLoginNavigation: { loginHref(url) { return 'index.html?return=' + encodeURIComponent(url); } },
    MrCatAuth: { getSession: async () => ({ mode, profile: { active: true, name: 'Teacher' } }), logout: async () => {} },
    MrCatCloud: { callFunction: async (name, args) => {
      calls.push({ name, ...args });
      if (args.action === 'getTeacherSpeakingReport') return failure ? { success: false, code: 'SPEAKING_REPORT_NOT_AVAILABLE' } : { success: true, report: { title: 'Test title', report_id: 'report&one', notification_id: 'notice-1', kind, question: { part: 3, text: 'Question', bullets: ['One'], closing: 'Closing instruction' }, analysis } };
      return args.action === 'getTeacherSpeakingAudio' ? { success: true, audio_url: 'https://audio.example.test/private' } : { success: true };
    } },
  };
  vm.runInNewContext(source, { window, document: { getElementById: node, querySelector: node }, URL, URLSearchParams, console });
  await tick(); await tick();
  return { nodes, calls, events };
}
(async () => {
  for (const kind of ['group_discussion', 'individual_response', 'ielts']) {
    const { nodes, calls } = await browser(kind);
    const html = nodes['review-content'].innerHTML;
    assert(html.includes('<details class="speaking-report-card"><summary>Transcript'));
    assert(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
    assert(!html.includes('<img onerror'));
    assert(calls.some(c => c.action === 'markActivityAttemptsReviewed' && c.attempt_ids[0] === 'notice-1'));
    assert(!calls.some(c => c.action === 'getTeacherSpeakingAudio'), 'private audio is fetched only on demand');
    nodes['review-play'].handlers.click.call(nodes['review-play']); await tick();
    assert.equal(nodes['review-audio'].src, 'https://audio.example.test/private');
    if (kind === 'group_discussion') {
      assert(html.includes('href="#candidate-0"')); assert(html.includes('id="candidate-0"'));
      assert(html.includes('Turn-by-turn review')); assert(html.includes('Strength'));
    } else if (kind === 'ielts') {
      assert(html.indexOf('<summary>Transcript') < html.indexOf('<h2>Analysis'), 'IELTS transcript precedes analysis');
      assert(html.includes('Chinese thinking prompt')); assert(html.includes('<details><summary>Sample Answer'));
      assert(html.indexOf('Chinese thinking prompt') < html.indexOf('<details><summary>Sample Answer'));
      assert(!html.includes('null')); assert(html.includes('no overall band')); assert(html.includes('Closing instruction'));
    } else assert(html.includes('Improved response'));
  }
  const teacherSource = fs.readFileSync(require('path').join(__dirname, '../assets/js/teacher.js'), 'utf8');
  const prefetchSource = teacherSource.slice(teacherSource.indexOf('    function prefetchNotificationItems('), teacherSource.indexOf('    function openAttemptPaperReview('));
  const prefetched = [];
  const context = { Promise, prefetchNotificationThread: async attempt => { prefetched.push(attempt.attempt_id); } };
  vm.runInNewContext(prefetchSource + '\nthis.prefetch = prefetchNotificationItems;', context);
  await context.prefetch([{ type: 'speaking' }, { type: 'intensive_listening' }, { type: 'attempt', attempt: { attempt_id: 'a1' } }]);
  assert.deepEqual(prefetched, ['a1'], 'Speaking/Listening summaries never enter the attempt-detail prefetch queue');
  const modern = await browser('individual_response', 'teacher', false, true);
  const modernHtml = modern.nodes['review-content'].innerHTML;
  assert(modernHtml.includes('Specific strength') && modernHtml.includes('Specific weakness') && modernHtml.includes('Add evidence'));
  assert(!modernHtml.includes('Communication Strategies'), 'current IO/VL assessment does not add CS');
  assert.equal((modernHtml.match(/<summary>Show exemplar/g) || []).length, 3);
  assert(modernHtml.indexOf('Paired thinking 1') < modernHtml.indexOf('Exemplar answer 1'));
  const student = await browser('ielts', 'student');
  assert(!student.calls.some(c => c.action === 'getTeacherSpeakingReport'));
  assert.equal(student.nodes['review-switch'].hidden, false);
  const visitor = await browser('ielts', 'visitor');
  assert(visitor.calls.some(c => c.redirect && decodeURIComponent(c.redirect).includes('report=report%26one')));
  const missing = await browser('ielts', 'teacher', true);
  assert(!missing.calls.some(c => c.action === 'markActivityAttemptsReviewed'));
  assert.equal(missing.nodes['review-recovery'].hidden, false);
  assert(!/localStorage|sessionStorage|indexedDB/.test(source));
  console.log('Speaking report reader: all layouts, escaping, on-demand audio, login return, teacher boundary, unavailable report and read timing passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
