(function(window, document) {
  'use strict';

  var state = { materials: [], source: '', query: '', sort: 'newest', mode: 'dictation' };
  var root = document.getElementById('intensive-listening-library');
  var list = document.getElementById('ill-material-list');
  var continueList = document.getElementById('ill-continue-list');
  var continueSection = document.getElementById('ill-continue-section');
  var stateBox = document.getElementById('ill-state');
  var count = document.getElementById('ill-count');

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
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
    mode = 'dictation';
    var source = item && (item.modes || item.tracks) || {};
    var value = source[mode] || {};
    var progress = value.progress || item.progress || {};
    var completed = Number(value.completed_count == null ? progress.completed_count : value.completed_count) || 0;
    var total = Number(value.segment_count == null ? item.dictation_unit_count : value.segment_count) || 0;
    var percentage = Number(value.percentage == null ? progress.percentage : value.percentage);
    if (!Number.isFinite(percentage)) percentage = total ? completed / total * 100 : 0;
    return { enabled: value.enabled !== false, completed: Math.max(0, completed), total: Math.max(0, total), percentage: Math.max(0, Math.min(100, percentage)), updated_at: value.updated_at || progress.updated_at || item.updated_at || null };
  }
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
    mode = 'dictation';
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
    var total = progress.total || Number(item.dictation_unit_count || 0);
    var status = actionLabel(item, state.mode);
    var destination = materialHref(item);
    return '<article class="ill-card" data-set-id="' + escapeHtml(materialId(item)) + '" data-mode="' + state.mode + '">' +
      '<a class="ill-card-hit" href="' + escapeHtml(destination) + '" aria-label="' + escapeHtml(status + ' ' + (item.title || materialId(item)) + ' in ' + 'Dictation') + '">' +
      '<span class="ill-card-content"><span class="ill-card-top"><span>' + escapeHtml(source) + '</span><span>' + escapeHtml(item.series_label || '') + '</span></span><h3>' + escapeHtml(item.title || materialId(item)) + '</h3><p class="ill-card-meta">' + escapeHtml(date) + ' · ' + escapeHtml('Dictation') + '</p>' +
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
  function load() {
    return window.MrCatAuth.getSession().then(function(session) {
      if (!session || session.mode !== 'student') { window.location.replace(window.MrCatLoginNavigation.loginHref(window.location.href, 'intensive-listening-library.html')); return null; }
      return window.MrCatCloud.callAuthenticatedFunction('intensiveListening', { action: 'listCatalog' });
    }).then(function(result) {
      if (!result) return;
      if (!result.success) { var error = new Error(result.message || 'Your listening library could not be loaded.'); error.code = result.code; throw error; }
      state.materials = Array.isArray(result.materials) ? result.materials : [];
      root.hidden = false; renderFilters(); render();
    }).catch(function(error) {
      if (error && error.code === 'AUTH_REQUIRED') { window.location.replace(window.MrCatLoginNavigation.loginHref(window.location.href, 'intensive-listening-library.html')); return; }
      root.hidden = false; fail(error);
    });
  }
  document.getElementById('ill-search').addEventListener('input', function(event) { state.query = String(event.target.value || '').trim().toLowerCase(); render(); });
  document.getElementById('ill-sort').addEventListener('change', function(event) { state.sort = event.target.value === 'oldest' ? 'oldest' : 'newest'; render(); });
  document.getElementById('ill-source-filters').addEventListener('click', function(event) { var button = event.target.closest('[data-source]'); if (!button) return; state.source = button.dataset.source || ''; renderFilters(); render(); });
  window.__MRCAT_INTENSIVE_LIBRARY_TEST__ = { safeReturn: safeReturn, matches: matches, sorted: sorted, actionLabel: actionLabel, materialHref: materialHref, card: card, progressFor: progressFor };
  load();
})(window, document);
