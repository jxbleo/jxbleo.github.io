(function () {
  'use strict';
  var links = Array.from(document.querySelectorAll('[data-panel]'));
  var panels = Array.from(document.querySelectorAll('.study-panel'));
  function activateHash() {
    var id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (_) { id = ''; }
    var target = document.getElementById(id);
    var panel = target && (target.classList.contains('study-panel') ? target : target.closest('.study-panel'));
    var selected = panel ? panel.id : 'foundation';
    panels.forEach(function (item) { item.hidden = item.id !== selected; });
    links.forEach(function (link) {
      var active = link.dataset.panel === selected;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    return target;
  }
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      var hash = link.getAttribute('href');
      var target = document.getElementById(hash.slice(1));
      if (!target) return;
      event.preventDefault();
      if (location.hash !== hash) history.pushState(null, '', hash);
      activateHash();
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
  });
  function restore() { var target = activateHash(); if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' }); }
  window.addEventListener('hashchange', restore);
  window.addEventListener('popstate', restore);
  var openBeforePrint = [];
  window.addEventListener('beforeprint', function () {
    openBeforePrint = Array.from(document.querySelectorAll('details[open]'));
    document.querySelectorAll('details').forEach(function (detail) { detail.open = true; });
  });
  window.addEventListener('afterprint', function () {
    document.querySelectorAll('details').forEach(function (detail) { detail.open = openBeforePrint.includes(detail); });
  });
  restore();
})();
