(function () {
  'use strict';
  var panels = Array.from(document.querySelectorAll('.course-panel'));
  var picker = document.getElementById('module-picker');
  var routes = Array.from(document.querySelectorAll('[data-route]'));
  var toolbar = document.querySelector('.course-toolbar');
  var current = 'overview';
  var printState = null;
  var baseTitle = document.title;

  function targetForHash() {
    var id = '';
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (_) { /* Invalid hash opens overview. */ }
    return document.getElementById(id);
  }
  function activate(scroll, focus) {
    var target = targetForHash();
    var panel = target && (target.classList.contains('course-panel') ? target : target.closest('.course-panel'));
    current = panel ? panel.id : 'overview';
    panel = document.getElementById(current);
    panels.forEach(function (item) { item.hidden = item !== panel; });
    picker.value = current;
    routes.forEach(function (link) {
      if (link.dataset.route === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    var title = panel.querySelector('h2, h1');
    document.title = current === 'overview' ? baseTitle : (title ? title.textContent : '') + '｜DSE Writing · Mr. Cat Academy';
    if (target) {
      var disclosure = target.closest('details');
      while (disclosure) { disclosure.open = true; disclosure = disclosure.parentElement.closest('details'); }
    }
    if (scroll) (target || panel).scrollIntoView({block:'start', behavior:'instant'});
    if (focus) {
      var destination = target || panel;
      destination.setAttribute('tabindex','-1');
      destination.focus({preventScroll:true});
    }
  }
  function navigate(hash) {
    if (location.hash !== hash) history.pushState(null,'',hash);
    activate(true,true);
  }
  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    var hash = link.getAttribute('href');
    if (!document.getElementById(hash.slice(1))) return;
    event.preventDefault();
    navigate(hash);
  });
  picker.addEventListener('change', function () { navigate('#' + picker.value); });
  window.addEventListener('hashchange', function () { activate(true,false); });
  window.addEventListener('popstate', function () { activate(true,false); });

  var search = document.getElementById('course-search');
  search.addEventListener('input', function () {
    var terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var count = 0;
    document.querySelectorAll('.module-card').forEach(function (card) {
      card.hidden = !terms.every(function (term) { return card.dataset.search.includes(term); });
      if (!card.hidden) count += 1;
    });
    document.querySelectorAll('.stage-group').forEach(function (group) {
      group.hidden = !Array.from(group.querySelectorAll('.module-card')).some(function (card) { return !card.hidden; });
    });
    document.getElementById('search-status').textContent = count + ' 个模块';
    document.getElementById('no-results').hidden = count !== 0;
  });

  function preparePrint() {
    if (printState) return;
    printState = Array.from(document.querySelectorAll('details')).map(function (item) { return {item:item,open:item.open}; });
    document.body.dataset.printScope = document.body.dataset.printScope || (current === 'overview' ? 'all' : 'current');
    document.querySelectorAll('details').forEach(function (item) { item.open = true; });
  }
  function restorePrint() {
    if (printState) printState.forEach(function (state) { state.item.open = state.open; });
    printState = null;
    delete document.body.dataset.printScope;
  }
  window.addEventListener('beforeprint',preparePrint);
  window.addEventListener('afterprint',restorePrint);
  document.querySelectorAll('.lesson-body > h3').forEach(function (h) {
    if (h.textContent.includes('冲 5*')) h.classList.add('advanced-heading');
  });
  toolbar.hidden = false;
  activate(Boolean(location.hash),false);
})();
