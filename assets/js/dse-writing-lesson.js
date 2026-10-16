(function () {
  'use strict';

  var copyButton = document.getElementById('copy-lesson');
  var printButton = document.getElementById('print-lesson');
  var printState = null;
  var messageTimer = null;
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

  function announce(message) {
    var toast = document.querySelector('[data-resource-toast]');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'resource-toast';
      toast.setAttribute('data-resource-toast', '');
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(function () { toast.classList.remove('is-visible'); }, 2400);
  }

  if (printButton) {
    printButton.hidden = false;
    printButton.addEventListener('click', function () {
      preparePrint();
      try { window.print(); }
      catch (_) {
        restorePrint();
        announce('请使用浏览器的打印功能');
      }
    });
  }

  function canonicalUrl() {
    var canonical = document.querySelector('link[rel="canonical"]');
    var url = new URL(canonical ? canonical.href : location.href, location.href);
    url.hash = '';
    return url.href;
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    var activeElement = document.activeElement;
    var input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    try {
      if (!document.execCommand('copy')) throw new Error('Copy unavailable');
    } finally {
      input.remove();
      if (activeElement && typeof activeElement.focus === 'function') activeElement.focus({ preventScroll: true });
    }
  }

  if (copyButton) {
    copyButton.hidden = false;
    copyButton.addEventListener('click', async function () {
      try {
        await copyText(canonicalUrl());
        announce('本讲链接已复制');
      } catch (_) {
        announce('请复制浏览器地址栏中的链接');
      }
    });
  }

  document.querySelectorAll('.lesson-body > h3').forEach(function (heading) {
    if (heading.textContent.includes('冲 5*')) heading.classList.add('advanced-heading');
  });
  if (location.hash) followHistory();
})();
