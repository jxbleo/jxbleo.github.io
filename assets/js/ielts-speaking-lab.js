(function (window) {
  'use strict';
  var api = window.MrCatCloud, auth = window.MrCatAuth;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var clockText = function (s) { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  var dateText = function (value) { return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }); };
  var operation = function () { return window.crypto.randomUUID ? window.crypto.randomUUID() : Array.from(window.crypto.getRandomValues(new Uint32Array(4))).join('-'); };
  var teacher = false, sets = [], source = 'cambridge', selectedSet = null, reportId = '', pageGeneration = 0;
  var take = null, stream = null, recorder = null, captureGeneration = 0, timer = 0, prepTimer = 0, prepDeadline = 0;
  var historyOffset = null, historyGeneration = 0, historyRows = [], pollTimer = 0, reportPolling = false;
  var modalStack = [], bodyStyle = '', scrollPosition = 0, lastAudio = null;
  function status(message) { $('ielts-status').textContent = message || ''; }
  function friendly(error) {
    if (error && /AUTH_REQUIRED|STUDENT_NOT_LINKED/.test(error.code || '')) return 'Please sign in again to continue.';
    if (error && error.code === 'DATABASE_COLLECTION_NOT_EXIST') return 'The IELTS library is not available yet.';
    return error && error.message || 'Please try again.';
  }
  async function call(action, data) {
    var timeout;
    try {
      var result = await Promise.race([api.callFunction('speakingLab', Object.assign({ action: action }, data || {})), new Promise(function (_, reject) { timeout = window.setTimeout(function () { reject(new Error('This request timed out. Please retry.')); }, 35000); })]);
      if (!result || !result.success) { var error = new Error(result && result.message || 'The request could not finish.'); error.code = result && result.code; throw error; }
      return result;
    } finally { window.clearTimeout(timeout); }
  }
  async function uploadFile(path, blob) {
    var timeout;
    try { return await Promise.race([api.uploadCloudFile(path, blob), new Promise(function (_, reject) { timeout = window.setTimeout(function () { reject(new Error('Upload timed out. Retry this same submission.')); }, 120000); })]); }
    finally { window.clearTimeout(timeout); }
  }
  function openModal(dialog) {
    if (dialog.open) return;
    if (!modalStack.length) { scrollPosition = window.scrollY; bodyStyle = document.body.style.cssText; Object.assign(document.body.style, { position: 'fixed', top: '-' + scrollPosition + 'px', width: '100%', overflow: 'hidden' }); }
    modalStack.push({ dialog: dialog, focus: document.activeElement });
    dialog.showModal();
  }
  function closeModal(dialog) {
    if (!dialog.open) return;
    var entry = modalStack.find(function (item) { return item.dialog === dialog; });
    dialog.close(); modalStack = modalStack.filter(function (item) { return item.dialog !== dialog; });
    if (!modalStack.length) { document.body.style.cssText = bodyStyle; window.scrollTo(0, scrollPosition); }
    if (entry && entry.focus && entry.focus.isConnected) entry.focus.focus({ preventScroll: true });
  }
  function confirmDiscard() {
    return new Promise(function (resolve) {
      var dialog = $('ielts-discard-dialog');
      function finish(value) { closeModal(dialog); $('ielts-keep').onclick = null; $('ielts-discard').onclick = null; dialog.oncancel = null; resolve(value); }
      $('ielts-keep').onclick = function () { finish(false); };
      $('ielts-discard').onclick = function () { finish(true); };
      dialog.oncancel = function (event) { event.preventDefault(); finish(false); };
      openModal(dialog); $('ielts-keep').focus();
    });
  }
  function bankLabel(set) { return set.source_kind === 'cambridge' ? 'Cambridge IELTS ' + set.book + ' · Test ' + set.test : String(set.year) + ' · ' + set.season; }
  function renderTopics() {
    document.querySelectorAll('[data-source]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.source === source)); });
    var query = $('ielts-search').value.trim().toLowerCase(), group = $('ielts-group').value, subgroup = $('ielts-subgroup').value;
    var rows = sets.filter(function (set) { return set.source_kind === source && (!group || String(source === 'cambridge' ? set.book : set.year) === group) && (!subgroup || String(source === 'cambridge' ? set.test : set.season) === subgroup) && (!query || (set.title + ' ' + bankLabel(set)).toLowerCase().includes(query)); });
    rows.sort(function (a, b) { return source === 'cambridge' ? b.book - a.book || a.test - b.test : b.year - a.year || String(b.season).localeCompare(String(a.season)) || a.title.localeCompare(b.title); });
    if (!rows.length) {
      var emptyBank = !sets.some(function (set) { return set.source_kind === source; });
      $('ielts-topics').innerHTML = '<div class="ielts-empty"><h2>' + (emptyBank ? source === 'seasonal' ? '当季题库 · Coming soon' : '剑雅官方真题 · 待导入' : 'No matching topics') + '</h2><p>' + (emptyBank ? source === 'seasonal' ? '题库更新后会显示在这里。' : '题目整理完成后即可开始练习。' : 'Try a different search or filter.') + '</p></div>';
      return;
    }
    $('ielts-topics').innerHTML = rows.map(function (set) { return '<button class="speaking-set-card" type="button" data-set="' + esc(set.set_id) + '"><span class="speaking-set-card-leading"><strong>' + esc(set.book || set.year) + '</strong><small>' + (source === 'cambridge' ? 'BOOK' : 'YEAR') + '</small></span><span class="speaking-set-card-copy"><span class="speaking-set-card-meta">' + esc(bankLabel(set)) + '</span><h3>' + esc(set.title) + '</h3><span class="speaking-set-card-route">Part 2 <i aria-hidden="true"></i> Part 3</span></span><span class="speaking-set-card-arrow" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m7.5 4.5 5 5.5-5 5.5"/></svg></span></button>'; }).join('');
  }
  function updateFilters() {
    var rows = sets.filter(function (set) { return set.source_kind === source; });
    var groups = Array.from(new Set(rows.map(function (set) { return source === 'cambridge' ? set.book : set.year; }))).sort(function (a, b) { return b - a; });
    var subgroups = Array.from(new Set(rows.map(function (set) { return source === 'cambridge' ? set.test : set.season; }))).sort();
    $('ielts-group').innerHTML = '<option value="">' + (source === 'cambridge' ? 'All books' : 'All years') + '</option>' + groups.map(function (group) { return '<option value="' + esc(group) + '">' + (source === 'cambridge' ? 'Cambridge IELTS ' : '') + esc(group) + '</option>'; }).join('');
    $('ielts-subgroup').innerHTML = '<option value="">' + (source === 'cambridge' ? 'All tests' : 'All seasons') + '</option>' + subgroups.map(function (group) { return '<option value="' + esc(group) + '">' + (source === 'cambridge' ? 'Test ' : '') + esc(group) + '</option>'; }).join('');
    renderTopics();
  }
  async function loadLibrary() {
    var offset = 0, result, loaded = [];
    do { result = await call('listIeltsSpeakingSets', { offset: offset, page_size: 50 }); loaded = loaded.concat(result.sets); offset = result.next_offset; } while (offset !== null);
    sets = loaded; updateFilters();
    $('ielts-history-topic').innerHTML = '<option value="">All topics</option>' + sets.map(function (set) { return '<option value="' + esc(set.set_id) + '">' + esc(bankLabel(set) + ' · ' + set.title) + '</option>'; }).join('');
    status('');
  }
  function questionMarkup(q, inButton) { var tag = inButton ? 'span' : 'p'; return '<' + tag + '>' + esc(q.text) + '</' + tag + '>' + (q.bullets ? (inButton ? '<span class="ielts-bullets" role="list">' : '<ul>') + q.bullets.map(function (b) { return inButton ? '<span role="listitem">' + esc(b) + '</span>' : '<li>' + esc(b) + '</li>'; }).join('') + (inButton ? '</span>' : '</ul>') : '') + (q.closing ? '<' + tag + '>' + esc(q.closing) + '</' + tag + '>' : ''); }
  function clearReportAudio() { if (lastAudio) { lastAudio.pause(); lastAudio.removeAttribute('src'); lastAudio.load(); lastAudio = null; } }
  function showLibrary() { pageGeneration += 1; selectedSet = null; reportId = ''; clearReportAudio(); $('ielts-library').hidden = false; $('ielts-detail').hidden = true; status(''); }
  async function openSet(id) {
    var generation = ++pageGeneration; status('Loading topic…'); reportId = ''; clearReportAudio();
    try {
      var result = await call('getIeltsSpeakingSet', { set_id: id });
      if (generation !== pageGeneration) return;
      selectedSet = result.set; var set = selectedSet;
      $('ielts-library').hidden = true; $('ielts-detail').hidden = false;
      $('ielts-detail').innerHTML = '<article class="speaking-report-card"><p class="ielts-topic-meta">' + esc(bankLabel(set)) + '</p><h2>' + esc(set.title) + '</h2><p class="eyebrow accent">PART 2</p><button class="ielts-topic-question" data-question="p2" type="button">' + questionMarkup(set.part_2, true) + '</button></article><article class="speaking-report-card"><h2>Part 3</h2><ol class="ielts-question-list">' + set.part_3.map(function (q) { return '<li><button class="ielts-topic-question" type="button" data-question="' + esc(q.question_id) + '"><small>Question ' + q.order + (q.group ? ' · ' + esc(q.group) : '') + '</small>' + esc(q.text) + '</button></li>'; }).join('') + '</ol>' + (teacher ? '<p class="ielts-muted">Teacher preview · Open History to view student recordings.</p>' : '') + '</article>';
      status('');
    } catch (error) { if (generation === pageGeneration) status(friendly(error)); }
  }
  function stopPreparation() { window.clearInterval(prepTimer); prepTimer = 0; prepDeadline = 0; $('ielts-prepare').setAttribute('aria-pressed', 'false'); }
  function cleanupCapture() {
    window.clearInterval(timer); timer = 0; stopPreparation();
    if (recorder) { recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null; if (recorder.state !== 'inactive') { try { recorder.stop(); } catch (_) {} } }
    recorder = null; if (stream) stream.getTracks().forEach(function (track) { track.stop(); }); stream = null;
  }
  function clearPreview() { $('ielts-preview').pause(); $('ielts-preview').removeAttribute('src'); $('ielts-preview').load(); $('ielts-preview').hidden = true; if (take && take.url) { URL.revokeObjectURL(take.url); take.url = ''; } }
  function updateTakeControls() {
    if (!take) return;
    var locked = take.busy || take.uploaded || take.requesting;
    $('ielts-record').disabled = locked || take.stopping;
    $('ielts-file').disabled = locked || take.recording || take.stopping;
    $('ielts-prepare').disabled = locked || take.recording || take.stopping;
    $('ielts-submit').hidden = !take.blob || take.uploaded || take.recording || take.stopping;
    $('ielts-submit').disabled = locked;
    $('ielts-record').classList.toggle('is-recording', !!take.recording);
    $('ielts-record-label').textContent = take.recording ? 'Stop recording' : take.blob ? 'Record again' : 'Tap to record';
  }
  function setTakeBlob(blob, seconds) {
    clearPreview(); take.blob = blob; take.seconds = seconds; take.response = null; take.operation = operation(); take.uploadOperation = operation();
    take.url = URL.createObjectURL(blob); $('ielts-preview').src = take.url; $('ielts-preview').hidden = false;
    $('ielts-timer').textContent = clockText(seconds) + ' / ' + clockText(take.limit);
    $('ielts-record-status').textContent = 'Listen, record again, or submit for analysis.'; updateTakeControls();
  }
  function openRecorder(q) {
    if (teacher) { status('Teacher preview · Use History to view student recordings.'); return; }
    captureGeneration += 1;
    take = { question: q, setId: selectedSet.set_id, limit: q.part === 2 ? 120 : 90, blob: null, busy: false, uploaded: false };
    $('ielts-part-label').textContent = 'IELTS · PART ' + q.part;
    $('ielts-recorder-title').textContent = q.part === 2 ? selectedSet.title : 'Question ' + q.order;
    $('ielts-question').innerHTML = questionMarkup(q);
    $('ielts-preparation').hidden = q.part !== 2; $('ielts-preparation-time').textContent = '';
    $('ielts-timer').textContent = '00:00 / ' + clockText(take.limit); $('ielts-timer').classList.remove('is-warning');
    $('ielts-record-status').textContent = 'Record one uninterrupted response. You can stop early.';
    $('ielts-submit').textContent = 'Submit & analyse'; updateTakeControls();
    openModal($('ielts-recorder'));
  }
  async function closeRecorder() {
    if (!take) return;
    if (take.busy) { $('ielts-record-status').textContent = 'Please wait for the upload to finish.'; return; }
    if (!take.uploaded && (take.blob || take.recording || take.requesting) && !(await confirmDiscard())) return;
    captureGeneration += 1; cleanupCapture(); clearPreview(); take = null; closeModal($('ielts-recorder'));
  }
  function stopRecording() {
    if (!take || !recorder || recorder.state === 'inactive' || take.stopping) return;
    take.seconds = (performance.now() - take.startedAt) / 1000; take.stopping = true; window.clearInterval(timer); updateTakeControls();
    try { recorder.stop(); } catch (_) { captureError('This recording could not be saved. Please record again.'); }
  }
  function captureError(message) { cleanupCapture(); if (take) { take.recording = false; take.requesting = false; take.stopping = false; updateTakeControls(); $('ielts-record-status').textContent = message; } }
  async function startRecording() {
    if (!take || take.busy || take.uploaded || take.requesting) return;
    if (take.recording) { stopRecording(); return; }
    if (take.blob && !(await confirmDiscard())) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { $('ielts-record-status').textContent = 'Recording is unavailable. Choose an audio file instead.'; return; }
    var generation = ++captureGeneration; clearPreview(); take.blob = null; stopPreparation(); $('ielts-preparation-time').textContent = '';
    take.requesting = true; updateTakeControls();
    try {
      var input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== captureGeneration || !take) { input.getTracks().forEach(function (track) { track.stop(); }); return; }
      stream = input;
      var preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(function (mime) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime); });
      recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      var chunks = [], device = recorder;
      device.ondataavailable = function (event) { if (event.data && event.data.size) chunks.push(event.data); };
      device.onerror = function () { captureError('The microphone stopped working. Please record again.'); };
      device.onstop = function () {
        if (generation !== captureGeneration || !take) return;
        var seconds = take.seconds || (performance.now() - take.startedAt) / 1000;
        var blob = new Blob(chunks, { type: device.mimeType || 'audio/webm' });
        cleanupCapture(); take.recording = false; take.stopping = false;
        if (!blob.size || seconds <= 0 || seconds > take.limit + 2) { captureError('The recording could not be timed reliably. Please record again.'); return; }
        setTakeBlob(blob, seconds);
      };
      device.start(250); take.startedAt = performance.now(); take.seconds = 0; take.requesting = false; take.recording = true;
      $('ielts-record-status').textContent = 'Recording…'; updateTakeControls();
      timer = window.setInterval(function () {
        if (!take || !take.recording) return;
        var seconds = (performance.now() - take.startedAt) / 1000;
        $('ielts-timer').textContent = clockText(Math.min(seconds, take.limit)) + ' / ' + clockText(take.limit);
        $('ielts-timer').classList.toggle('is-warning', seconds >= take.limit - 5);
        if (seconds >= take.limit) stopRecording();
      }, 100);
    } catch (_) { if (generation === captureGeneration) captureError('Microphone access was unavailable. Choose an audio file or try again.'); }
  }
  async function chooseFile(file) {
    if (!file || !take || take.busy || take.recording || take.uploaded) return;
    if (!/^audio\/(webm|mp4|mpeg|wav|x-m4a|aac)(;|$)/.test(file.type) || file.size > 50 * 1024 * 1024 || !file.size) { $('ielts-record-status').textContent = 'Choose a supported audio file up to 50 MB.'; return; }
    if (take.blob && !(await confirmDiscard())) return;
    stopPreparation(); var generation = captureGeneration, url = URL.createObjectURL(file), audio = document.createElement('audio');
    take.requesting = true; updateTakeControls();
    try {
      var seconds = await new Promise(function (resolve, reject) {
        var timeout = window.setTimeout(function () { audio.onloadedmetadata = audio.onerror = null; reject(new Error('Audio duration could not be checked.')); }, 15000);
        audio.onloadedmetadata = function () { window.clearTimeout(timeout); resolve(audio.duration); };
        audio.onerror = function () { window.clearTimeout(timeout); reject(new Error('This audio file could not be read.')); };
        audio.preload = 'metadata'; audio.src = url;
      });
      if (!take || generation !== captureGeneration) return;
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > take.limit) throw new Error('Choose audio no longer than ' + take.limit + ' seconds.');
      setTakeBlob(file, seconds);
    } catch (error) { if (take && generation === captureGeneration) $('ielts-record-status').textContent = friendly(error); }
    finally { audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); if (take && generation === captureGeneration) { take.requesting = false; updateTakeControls(); } }
  }
  async function submit() {
    if (!take || !take.blob || take.busy || take.uploaded) return;
    var current = take; current.busy = true; $('ielts-preview').pause(); updateTakeControls(); $('ielts-record-status').textContent = 'Uploading securely…';
    try {
      if (!current.response) current.response = (await call('createIeltsResponse', { set_id: current.setId, question_id: current.question.question_id, operation_id: current.operation })).response;
      var id = current.response.response_session_id;
      var started = await call('startIndividualResponseAudioUpload', { response_session_id: id, operation_id: current.uploadOperation, mime_type: current.blob.type.split(';')[0], size_bytes: current.blob.size, duration_seconds: current.seconds });
      if (started.status !== 'uploaded') {
        var uploaded = await uploadFile(started.upload.cloud_path, current.blob);
        await call('finishIndividualResponseAudioUpload', { response_session_id: id, asset_id: started.asset_id, uploaded_file_id: uploaded.file_id, duration_seconds: current.seconds });
      }
      current.uploaded = true;
      await call('startIndividualResponseAnalysis', { response_session_id: id });
      current.busy = false; await closeRecorder();
      status('Submitted. You can continue with another question and open History for your report.');
    } catch (error) {
      current.busy = false;
      if (current.uploaded) { await closeRecorder(); await openReport(current.response.response_session_id); status('Your recording is saved. Retry analysis from this report.'); }
      else { $('ielts-record-status').textContent = friendly(error) + ' Your local recording is still here; retry this submission.'; updateTakeControls(); }
    }
  }
  function analysisState(row) { return row.analysis_status === 'ready' ? 'Report ready' : row.analysis_status === 'failed' ? 'Analysis needs retry' : row.analysis_status === 'not_ready' ? 'Awaiting analysis' : 'Analysing…'; }
  async function loadHistory(append) {
    var generation = ++historyGeneration; $('ielts-history-more').disabled = true;
    $('ielts-history-status').textContent = 'Loading…';
    try {
      var result = await call('listIeltsResponses', { offset: append ? historyOffset : 0, page_size: 20, student_id: teacher ? $('ielts-student-id').value.trim() : undefined, set_id: $('ielts-history-topic').value });
      if (generation !== historyGeneration) return;
      historyRows = append ? historyRows.concat(result.responses) : result.responses; historyOffset = result.next_offset;
      $('ielts-history-list').innerHTML = historyRows.map(function (row) { return '<button type="button" class="ielts-history-row" data-response="' + esc(row.response_session_id) + '"><strong>' + esc(row.title) + '</strong><small>' + (teacher ? esc(row.student_name_snapshot + ' · ' + row.student_id_snapshot) + ' · ' : '') + esc(dateText(row.created_at)) + ' · ' + esc(analysisState(row)) + '</small></button>'; }).join('');
      $('ielts-history-status').textContent = historyRows.length ? '' : 'No submitted recordings yet.';
      $('ielts-history-more').hidden = historyOffset === null;
    } catch (error) { if (generation === historyGeneration) $('ielts-history-status').textContent = friendly(error); }
    finally { if (generation === historyGeneration) $('ielts-history-more').disabled = false; }
  }
  function reportMarkup(row) {
    var report = row.report, ready = row.analysis_status === 'ready' && report, q = row.question_snapshot;
    var retry = !teacher && ['not_ready', 'failed'].includes(row.analysis_status);
    var first = '<article class="speaking-report-card"><p class="eyebrow accent">SESSION DETAILS</p><h2>' + esc(row.title) + '</h2><p class="ielts-topic-meta">' + esc(bankLabel(row.set_snapshot)) + ' · ' + esc(dateText(row.created_at)) + ' · ' + esc(clockText(row.duration_seconds || 0)) + (teacher ? '<br>' + esc(row.student_name_snapshot + ' · ' + row.student_id_snapshot) : '') + '</p>' + questionMarkup(q) + '<button class="outline-button" type="button" id="ielts-play-recording">Listen to recording</button><audio class="ielts-audio" id="ielts-report-audio" controls hidden></audio>' + (ready ? '<details><summary>Transcript</summary>' + report.transcript.map(function (line) { return '<p class="ielts-prose"><small class="ielts-muted">' + esc(clockText(line.start_ms / 1000)) + '</small> ' + esc(line.text) + '</p>'; }).join('') + '</details>' : '') + '</article>';
    if (!ready) return first + '<article class="speaking-report-card"><h2>Analysis</h2><p>' + esc(analysisState(row)) + '</p><p class="ielts-muted">Your recording is saved. You can leave and return later.</p>' + (retry ? '<button class="primary-button" type="button" id="ielts-retry">Retry analysis</button> ' : '') + '<button class="outline-button" type="button" id="ielts-refresh">Refresh</button></article>';
    var labels = { fluency_coherence: 'Fluency & Coherence', lexical_resource: 'Lexical Resource', grammatical_range_accuracy: 'Grammatical Range & Accuracy' };
    var analysis = '<article class="speaking-report-card"><h2>Analysis</h2><p class="ielts-muted">Single-question training estimates · Pronunciation: 暂不评估</p><div class="ielts-score-grid">' + Object.keys(labels).map(function (key) { var domain = report.domains[key]; return '<section class="ielts-score"><h3>' + labels[key] + '</h3><strong>' + (domain.score === null ? '—' : esc(domain.score) + '<small>/9</small>') + '</strong><p>' + esc(domain.commentary_zh) + '</p>' + domain.evidence.map(function (e) { return '<blockquote>' + esc(e.quote) + '</blockquote>'; }).join('') + '</section>'; }).join('') + '</div><p class="ielts-prose">' + esc(report.summary_zh) + '</p><a class="ielts-muted" href="https://ielts.org/cdn/ielts-guides/ielts-speaking-band-descriptors.pdf" target="_blank" rel="noopener noreferrer">IELTS official band descriptors</a></article>';
    var sample = '<article class="speaking-report-card"><h2>Band 8 Answer</h2><h3>Thinking Prompt</h3><p class="ielts-prose">' + esc(report.thinking_prompt_zh) + '</p><p class="ielts-keywords">' + report.thinking_keywords_en.map(esc).join(' · ') + '</p><details><summary>Sample Answer</summary><p class="ielts-muted">An example targeting Band 8</p><p class="ielts-prose">' + esc(report.sample_answer_en) + '</p></details></article>';
    return first + analysis + sample;
  }
  async function openReport(id, quiet) {
    var generation = quiet ? pageGeneration : ++pageGeneration;
    if (!quiet) { clearReportAudio(); reportId = id; status('Loading report…'); }
    try {
      var result = await call('getIeltsResponse', { response_session_id: id });
      if (generation !== pageGeneration || reportId !== id) return;
      if (quiet && result.response.analysis_status !== 'ready' && result.response.analysis_status !== 'failed') return;
      if (quiet && $('ielts-detail').dataset.state === result.response.analysis_status) return;
      clearReportAudio(); $('ielts-library').hidden = true; $('ielts-detail').hidden = false;
      $('ielts-detail').innerHTML = reportMarkup(result.response); $('ielts-detail').dataset.state = result.response.analysis_status; status('');
    } catch (error) { if (!quiet && generation === pageGeneration) status(friendly(error)); }
  }
  document.querySelectorAll('[data-source]').forEach(function (button) { button.addEventListener('click', function () { source = button.dataset.source; updateFilters(); }); });
  ['ielts-search', 'ielts-group', 'ielts-subgroup'].forEach(function (id) { $(id).addEventListener(id === 'ielts-search' ? 'input' : 'change', renderTopics); });
  $('ielts-topics').addEventListener('click', function (event) { var button = event.target.closest('[data-set]'); if (button) openSet(button.dataset.set); });
  $('ielts-detail').addEventListener('click', async function (event) {
    var button = event.target.closest('button'); if (!button) return;
    if (button.dataset.question && selectedSet) { var q = button.dataset.question === 'p2' ? selectedSet.part_2 : selectedSet.part_3.find(function (q) { return q.question_id === button.dataset.question; }); if (q) openRecorder(q); return; }
    var id = reportId; button.disabled = true;
    try {
      if (button.id === 'ielts-refresh') await openReport(id);
      if (button.id === 'ielts-retry') { await call('startIndividualResponseAnalysis', { response_session_id: id }); await openReport(id); }
      if (button.id === 'ielts-play-recording') {
        var result = await call('getIeltsResponseAudio', { response_session_id: id });
        if (id !== reportId || !button.isConnected) return;
        var url = new URL(result.audio_url); if (url.protocol !== 'https:') throw new Error('Audio is unavailable.');
        lastAudio = $('ielts-report-audio'); lastAudio.src = url.href; lastAudio.hidden = false;
        lastAudio.onerror = function () { status('Audio playback failed or the link expired. Select Listen to recording to refresh it.'); };
        lastAudio.play().catch(function () { status('Press play to listen to the recording.'); });
      }
    } catch (error) { status(friendly(error)); } finally { if (button.isConnected) button.disabled = false; }
  });
  $('ielts-record').addEventListener('click', startRecording);
  $('ielts-file').addEventListener('change', function () { var file = $('ielts-file').files[0]; $('ielts-file').value = ''; chooseFile(file); });
  $('ielts-submit').addEventListener('click', submit);
  $('ielts-prepare').addEventListener('click', function () {
    if (!take || take.question.part !== 2 || take.busy || take.recording) return;
    if (prepTimer) { stopPreparation(); $('ielts-preparation-time').textContent = ''; return; }
    prepDeadline = performance.now() + 60000; $('ielts-prepare').setAttribute('aria-pressed', 'true'); $('ielts-preparation-time').textContent = '01:00';
    prepTimer = window.setInterval(function () { var remaining = Math.max(0, Math.ceil((prepDeadline - performance.now()) / 1000)); $('ielts-preparation-time').textContent = clockText(remaining); if (!remaining) { stopPreparation(); $('ielts-record-status').textContent = 'Preparation finished. Tap the microphone when you are ready.'; } }, 100);
  });
  $('ielts-recorder-close').addEventListener('click', closeRecorder);
  $('ielts-recorder').addEventListener('cancel', function (event) { event.preventDefault(); closeRecorder(); });
  $('ielts-history').addEventListener('click', function () { openModal($('ielts-history-dialog')); loadHistory(false); });
  function closeHistory() { historyGeneration += 1; closeModal($('ielts-history-dialog')); }
  $('ielts-history-close').addEventListener('click', closeHistory);
  $('ielts-history-dialog').addEventListener('cancel', function (event) { event.preventDefault(); closeHistory(); });
  $('ielts-history-filters').addEventListener('submit', function (event) { event.preventDefault(); loadHistory(false); });
  $('ielts-history-more').addEventListener('click', function () { loadHistory(true); });
  $('ielts-history-list').addEventListener('click', function (event) { var button = event.target.closest('[data-response]'); if (button) { closeHistory(); openReport(button.dataset.response); } });
  $('ielts-back').addEventListener('click', function () { if (!$('ielts-detail').hidden) showLibrary(); else window.location.href = teacher ? 'teacher.html' : 'dashboard.html'; });
  window.addEventListener('beforeunload', function (event) { if (take && (take.recording || take.blob || take.busy || take.requesting)) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', function () { captureGeneration += 1; cleanupCapture(); clearPreview(); take = null; clearReportAudio(); window.clearInterval(pollTimer); modalStack.slice().reverse().forEach(function (entry) { closeModal(entry.dialog); }); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && take && take.recording) stopRecording(); });
  function startPolling() {
    window.clearInterval(pollTimer);
    pollTimer = window.setInterval(async function () {
      if (document.hidden || reportPolling || take && take.busy) return;
      reportPolling = true;
      try {
        if (reportId && !['ready', 'failed'].includes($('ielts-detail').dataset.state)) await openReport(reportId, true);
        if ($('ielts-history-dialog').open && historyRows.length <= 20 && historyRows.some(function (row) { return ['queued', 'processing'].includes(row.analysis_status); })) await loadHistory(false);
      } finally { reportPolling = false; }
    }, 12000);
  }
  window.addEventListener('pageshow', function (event) { if (event.persisted) startPolling(); });
  auth.getSession().then(async function (session) {
    if (!session || !['student', 'teacher'].includes(session.mode)) { window.location.replace('index.html?return=ielts-speaking-lab.html'); return; }
    teacher = session.mode === 'teacher'; $('ielts-identity').textContent = session.profile.name || session.profile.student_id;
    $('ielts-student-filter').hidden = !teacher; $('ielts-history').disabled = false; $('ielts-library').hidden = false;
    // History stays available even before the new topic collection is deployed.
    try { await loadLibrary(); } catch (error) { status(friendly(error)); updateFilters(); }
    if (teacher) { openModal($('ielts-history-dialog')); await loadHistory(false); }
    startPolling();
  }).catch(function (error) { status(friendly(error)); });
})(window);
