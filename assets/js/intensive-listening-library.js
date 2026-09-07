(function(window, document) {
  'use strict';

  var state = { materials: [], source: '', query: '', sort: 'newest', mode: 'dictation', preferredMode: 'dictation', switching: false };
  var root = document.getElementById('intensive-listening-library');
  var list = document.getElementById('ill-material-list');
  var continueList = document.getElementById('ill-continue-list');
  var continueSection = document.getElementById('ill-continue-section');
  var stateBox = document.getElementById('ill-state');
  var count = document.getElementById('ill-count');
  var trigger = document.getElementById('ill-mode-trigger');
  var popover = document.getElementById('ill-mode-popover');
  var modeLabel = document.getElementById('ill-mode-label');
  var description = document.getElementById('ill-mode-description');

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
  function safeMode(value) { return value === 'shadowing' ? 'shadowing' : value === 'dictation' ? 'dictation' : ''; }
  function modeName(mode) { return mode === 'shadowing' ? 'Shadowing' : 'Dictation'; }
  function safeReturn(value, fallback) {
    var base = fallback || 'intensive-listening-library.html';
    try {
      var url = new URL(value || base, window.location.href);
      if (url.origin !== window.location.origin || url.username || url.password || !/^\/[^/\\]+\.html$/i.test(url.pathname)) return base;
      return url.href;
    } catch (error) { return base; }
  }
  function libraryReturn() { return safeReturn(window.location.href, 'intensive-listening-library.html'); }
  function append(url, key, value) {
    var parsed = new URL(url, window.location.href);
    parsed.searchParams.set(key, value);
    return parsed.pathname.split('/').pop() + (parsed.search ? parsed.search : '') + (parsed.hash || '');
  }
  function materialId(item) { return String(item && (item.set_id || item.material_id || item.id) || ''); }
  function dateValue(value) { var time = Date.parse(String(value || '')); return Number.isFinite(time) ? time : 0; }
  function progressFor(item, mode) {
    mode = safeMode(mode) || 'dictation';
    var source = item && (item.modes || item.tracks) || {};
    var value = source[mode] || {};
    var progress = value.progress || (mode === 'dictation' ? item.progress : item.shadowing_progress) || {};
    var completed = Number(value.completed_count == null ? progress.completed_count : value.completed_count) || 0;
    var total = Number(value.segment_count == null ? (mode === 'dictation' ? item.dictation_unit_count : item.shadowing_unit_count) : value.segment_count) || 0;
    var percentage = Number(value.percentage == null ? progress.percentage : value.percentage);
    if (!Number.isFinite(percentage)) percentage = total ? completed / total * 100 : 0;
    return { enabled: value.enabled !== false, completed: Math.max(0, completed), total: Math.max(0, total), percentage: Math.max(0, Math.min(100, percentage)), updated_at: value.updated_at || progress.updated_at || item.updated_at || null };
  }
  function progressValue(item, mode) { return progressFor(item, mode).percentage; }
  function searchText(item) {
    return [item.title, item.source_label, item.series_label, item.set_id, item.source_set_id, item.published_on]
      .concat(item.ielts_identifiers || []).filter(Boolean).join(' ').toLowerCase();
  }
  function matches(item, source, query) {
    return (!source || String(item.source_label || '').toLowerCase() === source.toLowerCase()) && (!query || searchText(item).indexOf(query.toLowerCase()) !== -1);
  }
  function compare(a, b, sort) {
    var direction = sort === 'oldest' ? 1 : -1;
    return direction * (dateValue(a.published_on) - dateValue(b.published_on)) || String(a.title || '').localeCompare(String(b.title || '')) || materialId(a).localeCompare(materialId(b));
  }
  function sortModeCompare(a, b) {
    var pa = progressFor(a, state.mode); var pb = progressFor(b, state.mode);
    var rank = function(progress) { return progress.percentage > 0 && progress.percentage < 100 ? 0 : progress.percentage >= 100 ? 2 : 1; };
    return rank(pa) - rank(pb) || dateValue(pb.updated_at) - dateValue(pa.updated_at) || compare(a, b, state.sort);
  }
  function sorted(items, sort) { return items.slice().sort(function(a, b) { return compare(a, b, sort); }); }
  function actionLabel(item, mode) {
    mode = safeMode(mode) || 'dictation';
    var progress = progressFor(item, mode);
    if (progress.percentage >= 100) return 'Completed';
    if (progress.completed > 0) return 'Continue · ' + progress.completed + ' of ' + (progress.total || '?');
    if (progress.percentage > 0) return 'Continue';
    return 'Start';
  }
  function materialHref(item) {
    var href = item.href || 'intensive-listening.html?set=' + encodeURIComponent(materialId(item));
    href = append(href, 'mode', state.mode);
    return append(href, 'return', libraryReturn());
  }
  function card(item) {
    var progress = progressFor(item, state.mode);
    var source = item.source_label || item.source_family || 'Listening';
    var date = item.published_on ? new Date(item.published_on + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : (item.source_set_id || '');
    var total = progress.total || Number(item.dictation_unit_count || item.shadowing_unit_count || 0);
    var status = actionLabel(item, state.mode);
    var destination = materialHref(item);
    return '<article class="ill-card" data-set-id="' + escapeHtml(materialId(item)) + '" data-mode="' + state.mode + '">' +
      '<a class="ill-card-hit" href="' + escapeHtml(destination) + '" aria-label="' + escapeHtml(status + ' ' + (item.title || materialId(item)) + ' in ' + modeName(state.mode)) + '">' +
      '<span class="ill-card-content"><span class="ill-card-top"><span>' + escapeHtml(source) + '</span><span>' + escapeHtml(item.series_label || '') + '</span></span><h3>' + escapeHtml(item.title || materialId(item)) + '</h3><p class="ill-card-meta">' + escapeHtml(date) + ' · ' + escapeHtml(modeName(state.mode)) + '</p>' +
      '<span class="ill-progress-line"><span>Completion</span><strong>' + (progress.completed && total ? escapeHtml(progress.completed + ' of ' + total) : escapeHtml(Math.round(progress.percentage) + '%')) + '</strong></span><span class="ill-progress-track"><span style="width:' + progress.percentage + '%"></span></span></span>' +
      '<span class="ill-card-actions"><span class="ill-primary-action">' + escapeHtml(status) + '</span></span></a></article>';
  }
  function visibleItems() {
    var source = state.query ? '' : state.source;
    return state.materials.filter(function(item) { return matches(item, source, state.query); });
  }
  function renderFilters() {
    var labels = {};
    state.materials.forEach(function(item) { if (item.source_label) labels[item.source_label] = true; });
    var sources = Object.keys(labels).sort(function(a, b) { return a.localeCompare(b); });
    document.getElementById('ill-source-filters').innerHTML = [''].concat(sources).map(function(source) {
      var label = source || 'All';
      return '<button class="ill-source-filter" type="button" data-source="' + escapeHtml(source) + '" aria-pressed="' + (state.source === source ? 'true' : 'false') + '">' + escapeHtml(label) + '</button>';
    }).join('');
  }
  function renderMode() {
    modeLabel.textContent = modeName(state.mode);
    description.textContent = state.mode === 'shadowing' ? 'Listen, record, and improve one canonical unit at a time.' : 'Listen, type, and check one canonical unit at a time.';
    document.querySelectorAll('[data-listening-mode]').forEach(function(button) {
      var selected = button.getAttribute('data-listening-mode') === state.mode;
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
  }
  function render() {
    var items = visibleItems();
    var continuing = items.filter(function(item) { var p = progressFor(item, state.mode); return p.percentage > 0 && p.percentage < 100; }).sort(sortModeCompare);
    continueSection.hidden = continuing.length === 0;
    continueList.innerHTML = continuing.map(card).join('');
    list.innerHTML = items.length ? items.slice().sort(sortModeCompare).map(card).join('') : '';
    count.textContent = items.length ? items.length + (items.length === 1 ? ' material' : ' materials') : '';
    if (state.materials.length && !items.length) { stateBox.className = 'ill-state is-empty'; stateBox.textContent = state.query ? 'No materials match your search.' : 'No materials are available yet.'; stateBox.hidden = false; } else stateBox.hidden = true;
  }
  function fail(error) { stateBox.className = 'ill-state is-error'; stateBox.textContent = error && error.message || 'Your listening library could not be loaded. Please try again.'; stateBox.hidden = false; }
  function setPopover(open) {
    popover.hidden = !open; trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { var selected = popover.querySelector('[aria-checked="true"]'); if (selected) selected.focus(); }
  }
  function persistMode(mode) {
    if (!window.MrCatCloud || !window.MrCatCloud.callAuthenticatedFunction) return Promise.resolve({ success: true });
    return window.MrCatCloud.callAuthenticatedFunction('intensiveListening', { action: 'setModePreference', mode: mode }).then(function(result) {
      if (!result || !result.success) { var error = new Error(result && result.message || 'Mode preference could not be saved.'); error.code = result && result.code; throw error; }
      return result;
    });
  }
  function switchMode(mode, persist) {
    var next = safeMode(mode); if (!next || next === state.mode || state.switching) return Promise.resolve();
    var previous = state.mode; state.mode = next; state.switching = true; setPopover(false); renderMode(); render();
    return (persist ? persistMode(next) : Promise.resolve()).then(function() { state.preferredMode = next; state.switching = false; }).catch(function(error) {
      state.mode = previous; state.switching = false; renderMode(); render(); stateBox.className = 'ill-state is-error'; stateBox.textContent = (error.message || 'Mode preference could not be saved.') + ' Your previous mode is still selected.'; stateBox.hidden = false; throw error;
    });
  }
  function load() {
    return window.MrCatAuth.getSession().then(function(session) {
      if (!session || session.mode !== 'student') { window.location.replace(window.MrCatLoginNavigation.loginHref(window.location.href, 'intensive-listening-library.html')); return null; }
      return window.MrCatCloud.callAuthenticatedFunction('intensiveListening', { action: 'listCatalog' });
    }).then(function(result) {
      if (!result) return;
      if (!result.success) { var error = new Error(result.message || 'Your listening library could not be loaded.'); error.code = result.code; throw error; }
      state.materials = Array.isArray(result.materials) ? result.materials : [];
      var serverMode = safeMode(result.preferred_mode) || 'dictation';
      var requestedMode = safeMode(new URLSearchParams(window.location.search).get('mode'));
      state.mode = requestedMode || serverMode; state.preferredMode = serverMode;
      root.hidden = false; renderMode(); renderFilters(); render();
      return requestedMode && requestedMode !== serverMode ? persistMode(requestedMode).catch(function() {}) : null;
    }).catch(function(error) {
      if (error && error.code === 'AUTH_REQUIRED') { window.location.replace(window.MrCatLoginNavigation.loginHref(window.location.href, 'intensive-listening-library.html')); return; }
      root.hidden = false; fail(error);
    });
  }
  document.getElementById('ill-search').addEventListener('input', function(event) { state.query = String(event.target.value || '').trim().toLowerCase(); render(); });
  document.getElementById('ill-sort').addEventListener('change', function(event) { state.sort = event.target.value === 'oldest' ? 'oldest' : 'newest'; render(); });
  document.getElementById('ill-source-filters').addEventListener('click', function(event) { var button = event.target.closest('[data-source]'); if (!button) return; state.source = button.dataset.source || ''; renderFilters(); render(); });
  trigger.addEventListener('click', function() { setPopover(popover.hidden); });
  popover.addEventListener('click', function(event) { var button = event.target.closest('[data-listening-mode]'); if (!button) return; switchMode(button.getAttribute('data-listening-mode'), true).catch(function() {}); });
  if (document.addEventListener) document.addEventListener('click', function(event) { if (!event.target.closest('.ill-mode-menu')) setPopover(false); });
  if (document.addEventListener) document.addEventListener('keydown', function(event) { if (event.key === 'Escape' && !popover.hidden) { setPopover(false); trigger.focus(); } });
  window.__MRCAT_INTENSIVE_LIBRARY_TEST__ = { safeReturn: safeReturn, matches: matches, sorted: sorted, actionLabel: actionLabel, materialHref: materialHref, card: card, progressFor: progressFor, safeMode: safeMode };
  load();
})(window, document);
