(function(window, document) {
  'use strict';
  var root = document.getElementById('view-listening');
  if (!root) return;
  var state = { materials: [], selected: '', source: null, draftRevision: 0, enabled: { dictation: true, shadowing: true }, tracks: { dictation: [], shadowing: [] } };
  var list = document.getElementById('teacher-listening-material-list');
  var editor = document.getElementById('teacher-listening-editor');
  var message = document.getElementById('teacher-listening-message');
  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]; }); }
  function call(action, payload) {
    return window.MrCatCloud.callAuthenticatedFunction('teacherAdmin', Object.assign({ action: action }, payload || {})).then(function(result) {
      if (!result || !result.success) { var error = new Error(result && result.message || 'Unable to update Listening.'); error.code = result && result.code; throw error; }
      return result;
    });
  }
  function setMessage(text, kind) { message.textContent = text || ''; message.className = 'teacher-listening-message' + (kind ? ' ' + kind : ''); }
  function setView() {
    document.querySelectorAll('.dashboard-view').forEach(function(view) { view.hidden = view !== root; });
    document.querySelectorAll('.tab-button').forEach(function(button) { button.classList.toggle('active', button.getAttribute('data-view') === 'listening'); });
  }
  function renderList() {
    if (!state.materials.length) { list.innerHTML = '<div class="empty-card"><strong>No Listening materials yet.</strong>Create a reviewed material to begin.</div>'; return; }
    list.innerHTML = state.materials.map(function(item) {
      var tracks = item.tracks || {};
      var dictation = tracks.dictation && tracks.dictation.segment_count || 0;
      var shadowing = tracks.shadowing && tracks.shadowing.segment_count || 0;
      return '<article class="teacher-listening-material-card' + (item.material_id === state.selected ? ' is-active' : '') + '" tabindex="0" role="button" data-listening-material-id="' + escapeHtml(item.material_id) + '"><span class="status">' + escapeHtml(item.publication_status || 'draft') + '</span><h3>' + escapeHtml(item.title || item.material_id) + '</h3><p>' + escapeHtml(item.material_id) + ' · ' + dictation + ' Dictation · ' + shadowing + ' Shadowing</p></article>';
    }).join('');
  }
  function sourceTrack(source, track) {
    var tracks = source && source.tracks || {};
    var current = tracks[track] || {};
    return Array.isArray(current.segments) ? current.segments : [];
  }
  function segmentModeOptions(track, selected) {
    var values = track === 'shadowing' ? [['shadowing', 'Shadowing'], ['context_only', 'Context only'], ['skip', 'Skip']] : [['dictation', 'Dictation'], ['context_only', 'Context only'], ['skip', 'Skip']];
    return values.map(function(option) { return '<option value="' + option[0] + '"' + (option[0] === selected ? ' selected' : '') + '>' + option[1] + '</option>'; }).join('');
  }
  function renderTrackRows(track) {
    var target = document.getElementById('teacher-listening-' + track + '-rows');
    var segments = state.tracks[track] || [];
    if (!segments.length) { target.innerHTML = '<div class="teacher-listening-track-empty">No lines yet. Add the first line when the timing is ready.</div>'; return; }
    target.innerHTML = segments.map(function(segment, index) {
      var mode = String(segment.practice_mode || (track === 'shadowing' ? 'shadowing' : 'dictation'));
      var slots = JSON.stringify(Array.isArray(segment.slots) ? segment.slots : [], null, 2);
      return '<article class="teacher-listening-segment-row" data-listening-row="' + track + '" data-index="' + index + '">' +
        '<header><span>' + String(index + 1).padStart(2, '0') + '</span><strong>' + escapeHtml(segment.speaker || 'Listening line') + '</strong><div><button type="button" data-segment-action="duplicate">Duplicate</button><button type="button" data-segment-action="delete">Delete</button></div></header>' +
        '<div class="teacher-listening-segment-fields"><label>Start (s)<input type="number" min="0" step="0.01" data-segment-field="start_seconds" value="' + escapeHtml(segment.start_seconds == null ? 0 : segment.start_seconds) + '"></label><label>End (s)<input type="number" min="0" step="0.01" data-segment-field="end_seconds" value="' + escapeHtml(segment.end_seconds == null ? 0 : segment.end_seconds) + '"></label><label>Speaker<input data-segment-field="speaker" value="' + escapeHtml(segment.speaker || '') + '" placeholder="Speaker"></label><label>Mode<select data-segment-field="practice_mode">' + segmentModeOptions(track, mode) + '</select></label></div>' +
        '<label class="teacher-listening-transcript">Transcript<textarea data-segment-field="text" rows="3" placeholder="What the learner hears">' + escapeHtml(segment.text || '') + '</textarea></label>' +
        (track === 'dictation' ? '<details class="teacher-listening-answer-details"><summary>Private answer slots</summary><label>Slots JSON<textarea data-segment-field="slots_json" rows="6" spellcheck="false">' + escapeHtml(slots) + '</textarea></label></details>' : '') +
        '</article>';
    }).join('');
  }
  function setTrackSegments(track, segments) {
    state.tracks[track] = (segments || []).map(function(segment) { return JSON.parse(JSON.stringify(segment || {})); });
    renderTrackRows(track);
  }
  function fill(source) {
    state.source = source || {};
    var raw = source && source.source || source || {};
    var id = raw.materialId || raw.material_id || source.material_id || '';
    $('teacher-listening-id').value = id;
    $('teacher-listening-title').value = raw.title || source.title || '';
    $('teacher-listening-source').value = raw.sourceLabel || raw.source_label || source.source_label || '';
    $('teacher-listening-series').value = raw.seriesLabel || raw.series_label || source.series_label || '';
    $('teacher-listening-media').value = raw.audioSrc || raw.audio_src || raw.media && (raw.media.src || raw.media.url) || source.media && source.media.src || '';
    $('teacher-listening-media-kind').value = raw.media && raw.media.kind === 'video' || source.media && source.media.kind === 'video' ? 'video' : 'audio';
    $('teacher-listening-revision').value = raw.transcriptRevision || raw.transcript_revision || source.transcript_revision || '1';
    state.draftRevision = Math.max(0, Number(source.draft_revision) || 0);
    state.enabled.dictation = !(raw.tracks && raw.tracks.dictation && raw.tracks.dictation.enabled === false);
    state.enabled.shadowing = !(raw.tracks && raw.tracks.shadowing && raw.tracks.shadowing.enabled === false);
    $('teacher-listening-dictation-enabled').checked = state.enabled.dictation;
    $('teacher-listening-shadowing-enabled').checked = state.enabled.shadowing;
    setTrackSegments('dictation', sourceTrack(raw, 'dictation').length ? sourceTrack(raw, 'dictation') : (raw.segments || []));
    setTrackSegments('shadowing', sourceTrack(raw, 'shadowing'));
    $('teacher-listening-editor-title').textContent = source.title || id || 'New material';
    $('teacher-listening-status').textContent = source.publication_status || 'Draft';
    $('teacher-listening-hide').hidden = source.has_published !== true && source.publication_status !== 'published';
    editor.hidden = false;
    renderList();
  }
  function blank() {
    state.selected = '';
    fill({ material_id: '', title: '', source: { materialId: '', title: '', segments: [], tracks: { dictation: { segments: [] }, shadowing: { segments: [] } } }, publication_status: 'draft' });
  }
  function segmentsForDraft(track) {
    return (state.tracks[track] || []).map(function(source, index) {
      var segment = Object.assign({}, source, {
        segment_id: String(source.segment_id || (track === 'shadowing' ? 's-' : 'd-') + String(index + 1).padStart(3, '0')),
        start_seconds: Number(source.start_seconds),
        end_seconds: Number(source.end_seconds),
        speaker: String(source.speaker || '').trim(),
        text: String(source.text || '').trim(),
        practice_mode: String(source.practice_mode || (track === 'shadowing' ? 'shadowing' : 'dictation'))
      });
      if (track === 'dictation') {
        if (typeof source.slots_json === 'string') {
          try { segment.slots = JSON.parse(source.slots_json || '[]'); } catch (error) { throw new Error('Dictation line ' + (index + 1) + ' has invalid answer slots JSON.'); }
        }
        if (!Array.isArray(segment.slots)) throw new Error('Dictation line ' + (index + 1) + ' answer slots must be a list.');
      } else {
        delete segment.reference_words;
        delete segment.referenceWords;
      }
      delete segment.slots_json;
      return segment;
    });
  }
  function draft() {
    var id = String($('teacher-listening-id').value || '').trim();
    return {
      material_id: id,
      title: String($('teacher-listening-title').value || '').trim(),
      source_label: String($('teacher-listening-source').value || '').trim(),
      series_label: String($('teacher-listening-series').value || '').trim(),
      audio_src: String($('teacher-listening-media').value || '').trim(),
      media: { kind: $('teacher-listening-media-kind').value === 'video' ? 'video' : 'audio', src: String($('teacher-listening-media').value || '').trim() },
      transcript_revision: String($('teacher-listening-revision').value || '1').trim(),
      tracks: { dictation: { enabled: state.enabled.dictation, revision: '1', segments: segmentsForDraft('dictation') }, shadowing: { enabled: state.enabled.shadowing, revision: '1', segments: segmentsForDraft('shadowing') } }
    };
  }
  function showValidation(result) {
    var validation = result && result.validation || {};
    $('teacher-listening-validation').textContent = (validation.valid ? 'Ready.' : 'Needs attention.') + '\n' + (validation.errors || []).concat(validation.warnings || []).map(function(item) { return '• ' + item; }).join('\n');
  }
  function loadMaterials() {
    return call('listListeningMaterials').then(function(result) { state.materials = result.materials || []; renderList(); }).catch(function(error) { setMessage(error.message, 'error'); });
  }
  function loadMaterial(id) {
    state.selected = id;
    return call('getListeningMaterial', { material_id: id }).then(function(result) { fill(result.material); }).catch(function(error) { setMessage(error.message, 'error'); });
  }
  function save(action, successText) {
    var value;
    try { value = draft(); } catch (error) { showValidation({ validation: { valid: false, errors: [error.message], warnings: [] } }); setMessage(error.message, 'error'); return Promise.reject(error); }
    setMessage('Checking material…');
    return call(action, { material_id: value.material_id, material: value, draft_revision: state.draftRevision }).then(function(result) { showValidation(result); state.selected = value.material_id; state.draftRevision = Math.max(0, Number(result.material && result.material.draft_revision) || state.draftRevision); setMessage(successText, 'success'); return loadMaterials().then(function() { return result; }); }).catch(function(error) { setMessage(error.message, 'error'); throw error; });
  }
  document.querySelectorAll('[data-view="listening"]').forEach(function(button) { button.addEventListener('click', function() { setView(); loadMaterials(); }); });
  document.getElementById('teacher-listening-new').addEventListener('click', function() { setView(); blank(); });
  list.addEventListener('click', function(event) { var card = event.target.closest('[data-listening-material-id]'); if (card) loadMaterial(card.getAttribute('data-listening-material-id')); });
  list.addEventListener('keydown', function(event) { if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('[data-listening-material-id]')) { event.preventDefault(); loadMaterial(event.target.closest('[data-listening-material-id]').getAttribute('data-listening-material-id')); } });
  document.querySelectorAll('[data-listening-add-segment]').forEach(function(button) { button.addEventListener('click', function() {
    var track = button.getAttribute('data-listening-add-segment');
    var segments = state.tracks[track] || [];
    var last = segments[segments.length - 1] || {};
    var start = Number(last.end_seconds) || 0;
    segments.push({ segment_id: (track === 'shadowing' ? 's-' : 'd-') + String(segments.length + 1).padStart(3, '0'), start_seconds: start, end_seconds: start + 3, speaker: '', text: '', practice_mode: track === 'shadowing' ? 'shadowing' : 'dictation', slots: track === 'dictation' ? [{ slot_id: 'w1', answer: '', spelling_requirement: 'required' }] : undefined });
    renderTrackRows(track);
  }); });
  document.querySelectorAll('[data-listening-track-enabled]').forEach(function(input) { input.addEventListener('change', function() {
    var track = input.getAttribute('data-listening-track-enabled');
    state.enabled[track] = input.checked;
  }); });
  document.querySelectorAll('.teacher-listening-segment-list').forEach(function(container) {
    function updateSegmentField(event) {
      var row = event.target.closest('[data-listening-row]');
      var field = event.target.getAttribute('data-segment-field');
      if (!row || !field) return;
      var track = row.getAttribute('data-listening-row');
      var segment = state.tracks[track][Number(row.getAttribute('data-index'))];
      segment[field] = field === 'start_seconds' || field === 'end_seconds' ? Number(event.target.value) : event.target.value;
    }
    container.addEventListener('input', updateSegmentField);
    container.addEventListener('change', updateSegmentField);
    container.addEventListener('click', function(event) {
      var action = event.target.getAttribute('data-segment-action');
      var row = event.target.closest('[data-listening-row]');
      if (!action || !row) return;
      var track = row.getAttribute('data-listening-row');
      var index = Number(row.getAttribute('data-index'));
      if (action === 'delete') state.tracks[track].splice(index, 1);
      if (action === 'duplicate') {
        var clone = JSON.parse(JSON.stringify(state.tracks[track][index]));
        clone.segment_id = (track === 'shadowing' ? 's-' : 'd-') + String(state.tracks[track].length + 1).padStart(3, '0');
        clone.start_seconds = Number(clone.end_seconds) || 0;
        clone.end_seconds = clone.start_seconds + Math.max(1, Number(state.tracks[track][index].end_seconds) - Number(state.tracks[track][index].start_seconds) || 3);
        state.tracks[track].splice(index + 1, 0, clone);
      }
      renderTrackRows(track);
    });
  });
  document.querySelectorAll('[data-listening-editor-tab]').forEach(function(button) { button.addEventListener('click', function() { var tab = button.getAttribute('data-listening-editor-tab'); document.querySelectorAll('[data-listening-editor-tab]').forEach(function(item) { item.classList.toggle('is-active', item === button); }); document.querySelectorAll('[data-listening-editor-panel]').forEach(function(panel) { panel.hidden = panel.getAttribute('data-listening-editor-panel') !== tab; panel.classList.toggle('is-active', panel.getAttribute('data-listening-editor-panel') === tab); }); }); });
  $('teacher-listening-save').addEventListener('click', function() { save('saveListeningDraft', 'Draft saved.'); });
  $('teacher-listening-validate').addEventListener('click', function() { var value; try { value = draft(); } catch (error) { showValidation({ validation: { valid: false, errors: [error.message], warnings: [] } }); return; } call('validateListeningMaterial', { material_id: value.material_id, material: value }).then(showValidation).catch(function(error) { setMessage(error.message, 'error'); }); });
  $('teacher-listening-preview').addEventListener('click', function() { var value; try { value = draft(); } catch (error) { setMessage(error.message, 'error'); return; } call('validateListeningMaterial', { material_id: value.material_id, material: value }).then(function(result) { showValidation(result); setMessage(result.validation && result.validation.valid ? 'Preview validated. Student transcript remains protected.' : 'Preview needs attention.', result.validation && result.validation.valid ? 'success' : 'error'); }); });
  $('teacher-listening-publish').addEventListener('click', function() { save('saveListeningDraft', 'Draft saved.').then(function() { return call('publishListeningMaterial', { material_id: state.selected }); }).then(function(result) { fill(result.material); setMessage('Listening material published.', 'success'); loadMaterials(); }).catch(function() {}); });
  $('teacher-listening-hide').addEventListener('click', function() { call('hideListeningMaterial', { material_id: state.selected }).then(function(result) { fill(result.material); setMessage('Listening material hidden from students.', 'success'); loadMaterials(); }).catch(function(error) { setMessage(error.message, 'error'); }); });
  window.__MRCAT_TEACHER_LISTENING_TEST__ = { draft: draft, sourceTrack: sourceTrack, setView: setView, segmentsForDraft: segmentsForDraft };
  loadMaterials();
})(window, document);
