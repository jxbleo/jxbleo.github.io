(function(window, document) {
  'use strict';

  var state = { materials: [], source: '', query: '', sort: 'newest' };
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
  function progressValue(item) { return Math.max(0, Math.min(100, Number(item && item.progress && item.progress.percentage) || 0)); }
  function searchText(item) {
    return [item.title, item.source_label, item.series_label, item.set_id, item.source_set_id, item.published_on]
      .concat(item.ielts_identifiers || []).filter(Boolean).join(' ').toLowerCase();
  }
  function matches(item, source, query) {
    return (!source || String(item.source_label || '').toLowerCase() === source.toLowerCase()) &&
      (!query || searchText(item).indexOf(query.toLowerCase()) !== -1);
  }
  function compare(a, b, sort) {
    var direction = sort === 'oldest' ? 1 : -1;
    return direction * (dateValue(a.published_on) - dateValue(b.published_on)) ||
      String(a.title || '').localeCompare(String(b.title || '')) ||
      materialId(a).localeCompare(materialId(b));
  }
  function sorted(items, sort) { return items.slice().sort(function(a, b) { return compare(a, b, sort); }); }
  function continueCompare(a, b) {
    return dateValue(b.progress && b.progress.updated_at) - dateValue(a.progress && a.progress.updated_at) ||
      dateValue(b.published_on) - dateValue(a.published_on) ||
      String(a.title || '').localeCompare(String(b.title || ''));
  }
  function actionLabel(item) {
    var percentage = progressValue(item);
    if (percentage >= 100) return 'Review';
    if (percentage > 0) return 'Continue';
    return 'Start';
  }
  function materialHref(item) {
    var href = item.href || 'intensive-listening.html?set=' + encodeURIComponent(materialId(item));
    href = append(href, 'return', libraryReturn());
    if (item.open_assignment && item.open_assignment.assignment_id) {
      href = append(href, 'assignment', String(item.open_assignment.assignment_id));
    }
    return href;
  }
  function card(item) {
    var progress = item.progress || {};
    var percent = progressValue(item);
    var source = item.source_label || item.source_family || 'Listening';
    var date = item.published_on ? new Date(item.published_on + 'T00:00:00').toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric'
    }) : (item.source_set_id || '');
    var meta = [date, item.dictation_unit_count + ' dictation units'].filter(Boolean).join(' · ');
    var completed = percent > 0
      ? '<span class="ill-card-progress-copy">' + escapeHtml(Number(progress.independent_count) || 0) +
        ' independent · ' + escapeHtml(Number(progress.assisted_count) || 0) + ' with answers</span>'
      : '';
    var linked = item.linked_practice && item.linked_practice.href
      ? '<a class="ill-secondary-action" href="' + escapeHtml(append(item.linked_practice.href, 'return', materialHref(item))) + '">Listening Practice</a>'
      : '';
    return '<article class="ill-card" data-set-id="' + escapeHtml(materialId(item)) + '">' +
      '<div><div class="ill-card-top"><span>' + escapeHtml(source) + '</span><span>' +
      escapeHtml(item.series_label || '') + '</span></div><h3>' + escapeHtml(item.title || materialId(item)) +
      '</h3><p class="ill-card-meta">' + escapeHtml(meta) + '</p>' +
      '<div class="ill-progress-line"><span>Completion</span><strong>' + percent +
      '%</strong></div><div class="ill-progress-track" aria-label="' + percent +
      '% complete"><span style="width:' + percent + '%"></span></div>' + completed + '</div>' +
      '<div class="ill-card-actions"><a class="ill-primary-action" href="' +
      escapeHtml(materialHref(item)) + '">' + actionLabel(item) + '</a>' + linked + '</div></article>';
  }
  function visibleItems() {
    // A search is global even when the last source filter was narrowed. This
    // keeps a cross-source query discoverable without requiring filter resets.
    var source = state.query ? '' : state.source;
    return state.materials.filter(function(item) { return matches(item, source, state.query); });
  }
  function renderFilters() {
    var labels = {};
    state.materials.forEach(function(item) { if (item.source_label) labels[item.source_label] = true; });
    var sources = Object.keys(labels).sort(function(a, b) { return a.localeCompare(b); });
    document.getElementById('ill-source-filters').innerHTML = [''].concat(sources).map(function(source) {
      var label = source || 'All';
      return '<button class="ill-source-filter" type="button" data-source="' + escapeHtml(source) +
        '" aria-pressed="' + (state.source === source ? 'true' : 'false') + '">' + escapeHtml(label) + '</button>';
    }).join('');
  }
  function render() {
    var items = visibleItems();
    var continuing = items.filter(function(item) {
      var p = progressValue(item);
      return p > 0 && p < 100;
    }).sort(continueCompare);
    continueSection.hidden = continuing.length === 0;
    continueList.innerHTML = continuing.map(card).join('');
    list.innerHTML = items.length ? sorted(items, state.sort).map(card).join('') : '';
    count.textContent = items.length ? items.length + (items.length === 1 ? ' material' : ' materials') : '';
    if (state.materials.length && !items.length) {
      stateBox.className = 'ill-state is-empty';
      stateBox.textContent = state.query ? 'No materials match your search.' : 'No materials are available yet.';
      stateBox.hidden = false;
    } else {
      stateBox.hidden = true;
    }
  }
  function fail(error) {
    stateBox.className = 'ill-state is-error';
    stateBox.textContent = error && error.message || 'Your listening library could not be loaded. Please try again.';
    stateBox.hidden = false;
  }
  function load() {
    return window.MrCatAuth.getSession().then(function(session) {
      if (!session || session.mode !== 'student') {
        window.location.replace(window.MrCatLoginNavigation.loginHref(window.location.href, 'intensive-listening-library.html'));
        return null;
      }
      return window.MrCatCloud.callAuthenticatedFunction('intensiveListening', { action: 'listCatalog' });
    }).then(function(result) {
      if (!result) return;
      if (!result.success) {
        var error = new Error(result.message || 'Your listening library could not be loaded.');
        error.code = result.code;
        throw error;
      }
      state.materials = Array.isArray(result.materials) ? result.materials : [];
      root.hidden = false;
      renderFilters();
      render();
    }).catch(function(error) {
      if (error && error.code === 'AUTH_REQUIRED') {
        window.location.replace(window.MrCatLoginNavigation.loginHref(window.location.href, 'intensive-listening-library.html'));
        return;
      }
      root.hidden = false;
      fail(error);
    });
  }
  document.getElementById('ill-search').addEventListener('input', function(event) {
    state.query = String(event.target.value || '').trim().toLowerCase();
    render();
  });
  document.getElementById('ill-sort').addEventListener('change', function(event) {
    state.sort = event.target.value === 'oldest' ? 'oldest' : 'newest';
    render();
  });
  document.getElementById('ill-source-filters').addEventListener('click', function(event) {
    var button = event.target.closest('[data-source]');
    if (!button) return;
    state.source = button.dataset.source || '';
    renderFilters();
    render();
  });
  window.__MRCAT_INTENSIVE_LIBRARY_TEST__ = {
    safeReturn: safeReturn, matches: matches, sorted: sorted, actionLabel: actionLabel,
    materialHref: materialHref, card: card
  };
  load();
})(window, document);
