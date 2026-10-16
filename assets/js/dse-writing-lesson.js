(function () {
  'use strict';

  var printState = null;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var printMedia = window.matchMedia('print');

  function targetForHash(hash) {
    var id;
    try { id = decodeURIComponent(hash.slice(1)); } catch (_) { return null; }
    return id ? document.getElementById(id) : null;
  }

  function revealTarget(target, focus, smooth) {
    if (!target) return;
    var disclosure = target.closest('details');
    while (disclosure) {
      disclosure.open = true;
      disclosure = disclosure.parentElement && disclosure.parentElement.closest('details');
    }
    if (focus) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
    target.scrollIntoView({
      block: 'start',
      behavior: smooth && !reduceMotion.matches ? 'smooth' : 'instant'
    });
  }

  document.addEventListener('click', function (event) {
    if (!(event.target instanceof Element)) return;
    var link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    var hash = link.getAttribute('href');
    var target = targetForHash(hash);
    if (!target) return;
    event.preventDefault();
    if (location.hash !== hash) history.pushState(null, '', hash);
    revealTarget(target, true, true);
  });

  function followHistory() {
    revealTarget(targetForHash(location.hash), false, false);
  }
  window.addEventListener('hashchange', followHistory);
  window.addEventListener('popstate', followHistory);

  function preparePrint() {
    if (printState) return;
    printState = Array.from(document.querySelectorAll('details')).map(function (item) {
      var state = { item: item, open: item.open };
      item.open = true;
      return state;
    });
  }

  function restorePrint() {
    if (!printState) return;
    printState.forEach(function (state) { state.item.open = state.open; });
    printState = null;
  }

  window.addEventListener('beforeprint', preparePrint);
  window.addEventListener('afterprint', restorePrint);
  printMedia.addEventListener('change', function (event) {
    if (event.matches) preparePrint();
    else restorePrint();
  });

  document.querySelectorAll('.lesson-body > h3').forEach(function (heading) {
    if (heading.textContent.includes('冲 5*')) heading.classList.add('advanced-heading');
  });
  if (location.hash) followHistory();
})();
