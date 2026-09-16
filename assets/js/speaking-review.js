(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var reportId = new URLSearchParams(window.location.search).get('report') || '';
  var busy = false;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function status(value) { $('review-status').textContent = value; }
  function loginUrl() { return window.MrCatLoginNavigation.loginHref(window.location.href, 'speaking-review.html'); }
  function call(action) {
    return window.MrCatCloud.callFunction('speakingLab', { action: action, report_id: reportId }).then(function (result) {
      if (!result || !result.success) { var error = new Error(result && result.message || 'Unable to load report.'); error.code = result && result.code; throw error; }
      return result;
    });
  }
  function time(ms) { var s = Math.max(0, Math.floor(Number(ms || 0) / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function date(value) { if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value); var d = new Date(value); return isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }); }
  function list(title, rows) { return Array.isArray(rows) && rows.length ? '<h3>' + esc(title) + '</h3><ul>' + rows.map(function (row) { return '<li>' + esc(row) + '</li>'; }).join('') + '</ul>' : ''; }
  function feedbackPoints(title, rows) {
    if (!Array.isArray(rows) || !rows.length) return '';
    return '<h4>' + esc(title) + '</h4>' + rows.map(function (row) {
      return '<p><b>' + esc(row.point_zh) + '</b><br>' + esc(row.explanation_zh) + '</p>' +
        (row.improvement_zh ? '<p><b>Try this</b><br>' + esc(row.improvement_zh) + '</p>' : '') +
        (row.example_en ? '<blockquote>' + esc(row.example_en) + '</blockquote>' : '');
    }).join('');
  }
  function exemplars(analysis) {
    var samples = Array.isArray(analysis.sample_responses) && analysis.sample_responses.length ? analysis.sample_responses
      : analysis.sample_response_en ? [{ response_en: analysis.sample_response_en }] : [];
    if (!samples.length) return '';
    return '<section class="speaking-report-card"><h2>5** Exemplars</h2>' + samples.map(function (sample, index) {
      return '<h3>Exemplar ' + (index + 1) + '</h3>' + (sample.thinking_prompt_zh ? '<p>' + esc(sample.thinking_prompt_zh) + '</p>' : '') +
        '<details><summary>Show exemplar</summary><p>' + esc(sample.response_en) + '</p></details>';
    }).join('') + '</section>';
  }
  function scores(domains, ielts, individual) {
    var labels = ielts ? { fluency_coherence: 'Fluency & Coherence', lexical_resource: 'Lexical Resource', grammatical_range_accuracy: 'Grammatical Range & Accuracy' }
      : { communication_strategies: 'Communication Strategies', ideas_organisation: 'Ideas & Organisation', vocabulary_language_patterns: 'Vocabulary & Language Patterns' };
    if (individual && !ielts && !(domains && domains.communication_strategies)) delete labels.communication_strategies;
    return '<div class="review-scores">' + Object.keys(labels).map(function (key) {
      var domain = domains && domains[key] || {};
      return '<section class="review-score"><h3>' + esc(labels[key]) + '</h3><strong>' + esc(domain.score == null ? '—' : domain.score) + (domain.score == null ? '' : '<small> / ' + (ielts ? '9' : '7') + '</small>') + '</strong><p>' + esc(domain.commentary_zh) + '</p>' + feedbackPoints('What works', domain.strengths) + feedbackPoints('How to improve', domain.weaknesses) +
        (domain.evidence || []).map(function (e) { return '<blockquote>' + esc(e.quote) + '</blockquote>'; }).join('') + '</section>';
    }).join('') + '</div><p class="review-meta">Pronunciation &amp; Delivery: Not assessed · 暂不评估' + (ielts ? ' · Single-question training estimates; no overall band.' : '') + '</p>';
  }
  function coaching(item) {
    return ['strength_zh', 'limitation_zh', 'improvement_zh'].map(function (key, i) { return item[key] ? '<p><b>' + ['What worked', 'What could be stronger', 'How to improve'][i] + '</b><br>' + esc(item[key]) + '</p>' : ''; }).join('') +
      (item.commentary_zh ? '<p>' + esc(item.commentary_zh) + '</p>' : '') + (item.sample_en ? '<blockquote>' + esc(item.sample_en) + '</blockquote>' : '');
  }
  function turns(rows) {
    if (!Array.isArray(rows) || !rows.length) return '';
    return '<details><summary>Turn-by-turn review</summary>' + rows.map(function (row, i) {
      return '<article class="review-turn"><h3>Turn ' + (i + 1) + ' · ' + time(row.start_ms) + '–' + time(row.end_ms) + '</h3>' +
        (row.asr_text_status !== 'higher_confidence' ? '<p class="review-meta">Possible ASR error</p>' : '') + '<blockquote>' + esc(row.transcript_text) + '</blockquote><h4>Communication Strategies</h4>' + coaching(row.communication_strategies || {}) + '<h4>Ideas &amp; Organisation</h4>' + coaching(row.ideas_organisation || {}) + '</article>';
    }).join('') + '</details>';
  }
  function transcript(rows) {
    return '<details class="speaking-report-card"><summary>Transcript</summary>' + (rows || []).map(function (row) {
      return '<p><small class="review-meta">' + time(row.start_ms) + ' ' + esc(row.speaker_label) + '</small><br>' + esc(row.text) + '</p>';
    }).join('') + '</details>';
  }
  function render(row) {
    var analysis = row.analysis || {}, group = row.kind === 'group_discussion', ielts = row.kind === 'ielts';
    document.querySelector('.speaking-review-shell').dataset.exam = ielts ? 'ielts' : 'dse';
    $('review-title').textContent = row.title;
    var q = row.question || {};
    var html = '<section class="speaking-report-card"><p class="eyebrow accent">SESSION DETAILS</p><h2>' + esc(group ? 'Group Discussion' : ielts ? 'IELTS Speaking · Part ' + q.part : 'Individual Response') + '</h2><p>' + esc([row.student_name, row.student_id].filter(Boolean).join(' · ')) + '</p><p class="review-meta">' + esc(date(row.date)) + (row.duration_seconds ? ' · ' + time(row.duration_seconds * 1000) : '') + '</p>' +
      (q.text ? '<p>' + esc(q.text) + '</p>' + list('You should say', q.bullets) + (q.closing ? '<p>' + esc(q.closing) + '</p>' : '') : '') +
      '<button type="button" class="outline-button" id="review-play">Listen to recording</button><p id="review-audio-status" role="status"></p><audio id="review-audio" controls preload="none" hidden></audio>' +
      (group ? '<nav class="review-candidate-links" aria-label="Student reports">' + (analysis.candidates || []).map(function (candidate, i) { return '<a class="outline-button" href="#candidate-' + i + '">' + esc(candidate.speaker_label) + '</a>'; }).join('') + '</nav>' : '') + '</section>';
    if (ielts) html += transcript(analysis.transcript);
    if (group) {
      html += '<section class="speaking-report-card"><h2>Group report</h2><p>' + esc(analysis.group_summary_zh) + '</p>' + list('Group strengths', analysis.group_strengths) + list('Group priorities', analysis.group_priorities) + list('Discussion flow', analysis.discussion_flow) + '</section>';
      html += (analysis.candidates || []).map(function (candidate, i) {
        return '<section id="candidate-' + i + '" class="speaking-report-card review-candidate"><p class="eyebrow accent">STUDENT REPORT</p><h2>' + esc(candidate.speaker_label) + '</h2><p>' + esc(candidate.summary_zh) + '</p>' + scores(candidate.domains, false) + list('Strengths', candidate.strengths) + list('Priority actions', candidate.priority_actions) + list('Language suggestions', candidate.language_suggestions) + turns(candidate.turn_reviews) + '</section>';
      }).join('');
    } else {
      html += '<section class="speaking-report-card"><h2>Analysis</h2>' + scores(analysis.domains, ielts, true) + '<p>' + esc(analysis.summary_zh) + '</p>' + list('Strengths', analysis.strengths) + list('Priority actions', analysis.priority_actions) + list('Language suggestions', analysis.language_suggestions) + '</section>';
      html += ielts ? '<section class="speaking-report-card"><h2>Band 8 Answer</h2><h3>Thinking Prompt</h3><p>' + esc(analysis.thinking_prompt_zh) + '</p><p>' + esc((analysis.thinking_keywords_en || []).join(' · ')) + '</p><details><summary>Sample Answer</summary><p>' + esc(analysis.sample_answer_en) + '</p></details></section>'
        : exemplars(analysis);
    }
    $('review-content').innerHTML = html + (ielts ? '' : transcript(analysis.transcript));
    $('review-play').addEventListener('click', function () {
      var button = this; button.disabled = true; $('review-audio-status').textContent = 'Loading recording…';
      call('getTeacherSpeakingAudio').then(function (result) {
        var url = new URL(result.audio_url); if (url.protocol !== 'https:') throw new Error('Invalid audio URL');
        $('review-audio').src = url.href; $('review-audio').hidden = false; $('review-audio-status').textContent = '';
        return $('review-audio').play().catch(function () {});
      }).catch(function () { $('review-audio-status').textContent = 'Recording could not be loaded. Try again.'; }).finally(function () { button.disabled = false; });
    });
  }
  function clearAudio() { var audio = $('review-audio'); if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } }
  function fail(error) {
    $('review-recovery').hidden = false;
    var auth = /AUTH_REQUIRED|LOGIN_REQUIRED|UNAUTHENTICATED|LOGIN_EXPIRED/.test((error.code || '') + ' ' + error.message);
    $('review-login').hidden = !auth; $('review-login').href = loginUrl();
    $('review-switch').hidden = error.code !== 'TEACHER_REQUIRED';
    status(error.code === 'TEACHER_REQUIRED' ? 'This report requires a teacher account. Switch accounts to continue.' : error.code === 'SPEAKING_REPORT_NOT_AVAILABLE' ? 'This report is no longer available.' : auth ? 'Please sign in again to return to this report.' : 'Unable to load the report. Please try again.');
  }
  function start() {
    if (busy) return;
    if (!reportId) { status('The report link is incomplete. Please reopen the notification.'); return; }
    busy = true; clearAudio(); $('review-content').innerHTML = ''; $('review-recovery').hidden = true; status('Loading…');
    window.MrCatAuth.getSession().then(function (session) {
      if (!session || session.mode === 'none' || session.mode === 'visitor') { window.location.replace(loginUrl()); return null; }
      if (session.mode !== 'teacher' || !session.profile || session.profile.active === false) { var error = new Error('Teacher required'); error.code = 'TEACHER_REQUIRED'; throw error; }
      $('review-identity').textContent = session.profile.name || session.profile.student_id;
      return call('getTeacherSpeakingReport').then(function (result) {
        render(result.report); status('');
        // Reading successfully from either entry clears this teacher's bell item. Sending mail never does.
        window.MrCatCloud.callFunction('teacherAdmin', { action: 'markActivityAttemptsReviewed', attempt_ids: [result.report.notification_id] }).catch(function () {});
      });
    }).catch(fail).finally(function () { busy = false; });
  }
  $('review-retry').addEventListener('click', start);
  $('review-switch').addEventListener('click', function () { window.MrCatAuth.logout().then(function () { window.location.replace(loginUrl()); }).catch(fail); });
  window.addEventListener('pagehide', clearAudio);
  // Reload private content and authorization when returning through browser history.
  window.addEventListener('pageshow', function (event) { if (event.persisted) start(); });
  start();
})();
