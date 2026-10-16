(function () {
  'use strict';
  var links = Array.from(document.querySelectorAll('[data-panel]'));
  var panels = Array.from(document.querySelectorAll('.study-panel'));
  var groups = Array.from(document.querySelectorAll('.word-group'));
  var cards = Array.from(document.querySelectorAll('.word-card'));
  var search = document.getElementById('word-search');
  var category = document.getElementById('word-category');
  var priority = document.getElementById('priority-only');
  var normalize = function (value) { return value.normalize('NFKC').toLowerCase().replace(/[\u2010-\u2015]/g, '-').trim(); };
  var entries = cards.map(function (card) { return { card: card, text: normalize(card.textContent) }; });
  function selectPanel(id) {
    if (!panels.some(function (panel) { return panel.id === id; })) id = 'method';
    panels.forEach(function (panel) { panel.hidden = panel.id !== id; });
    links.forEach(function (link) {
      var selected = link.dataset.panel === id;
      link.classList.toggle('active', selected);
      if (selected) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }
  links.forEach(function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      var id = link.dataset.panel;
      if (window.location.hash !== '#' + id) history.pushState(null, '', '#' + id);
      selectPanel(id);
      document.getElementById(id).scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  });
  function restorePanel() { selectPanel(window.location.hash.slice(1)); }
  window.addEventListener('hashchange', restorePanel);
  window.addEventListener('popstate', restorePanel);
  function filterWords() {
    var query = normalize(search.value);
    var count = 0;
    entries.forEach(function (entry) {
      var matches = (!query || entry.text.includes(query)) && (!priority.checked || entry.card.dataset.priority === 'true');
      entry.card.hidden = !matches;
    });
    groups.forEach(function (group) {
      var matchingCategory = category.value === 'all' || group.dataset.category === category.value;
      var visible = Array.from(group.querySelectorAll('.word-card')).filter(function (card) { return !card.hidden; }).length;
      group.hidden = !matchingCategory || !visible;
      if (!group.hidden) count += visible;
    });
    document.getElementById('word-count').textContent = '显示 ' + count + ' / ' + cards.length + ' 个词语与表达';
    document.getElementById('no-words').hidden = count !== 0;
  }
  search.addEventListener('input', filterWords);
  category.addEventListener('change', filterWords);
  priority.addEventListener('change', filterWords);
  document.getElementById('clear-filters').addEventListener('click', function () {
    search.value = ''; category.value = 'all'; priority.checked = false; filterWords(); search.focus();
  });
  var openBeforePrint = [];
  window.addEventListener('beforeprint', function () {
    openBeforePrint = Array.from(document.querySelectorAll('details')).filter(function (detail) { return detail.open; });
    document.querySelectorAll('details').forEach(function (detail) { detail.open = true; });
  });
  window.addEventListener('afterprint', function () {
    document.querySelectorAll('details').forEach(function (detail) { detail.open = openBeforePrint.includes(detail); });
  });
  document.querySelector('.word-tools').hidden = false;
  restorePanel();
  filterWords();
})();
