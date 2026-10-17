(function () {
  'use strict';
  const topics = [...document.querySelectorAll('article.topic')];
  const subs = [...document.querySelectorAll('section.subtopic')];
  const search = document.getElementById('idea-search');
  const status = document.getElementById('idea-status');
  const topicPicker = document.getElementById('topic-picker');
  const subPicker = document.getElementById('subtopic-picker');
  const mobile = document.querySelector('.mobile-navigation');
  let activeTopic = topics[0].id;
  let activeSub = '';
  let searching = false;
  let scrollQueued = false;

  function elementFromHash() {
    try { return document.getElementById(decodeURIComponent(location.hash.slice(1))); }
    catch (_) { return null; }
  }
  function pushHash(id) {
    const hash = '#' + encodeURIComponent(id);
    if (location.hash === hash) return;
    try { history.pushState(null, '', hash); }
    catch (_) { location.hash = hash; }
  }
  function updateSubLocation(id) {
    activeSub = id;
    subPicker.value = id || activeTopic;
    const developmentLink = document.getElementById('current-development-link');
    developmentLink.hidden = false;
    developmentLink.textContent = '进入内容拓展 ↗';
    developmentLink.href = '#' + (id || activeTopic+'-sub-1') + '-development';
    document.querySelectorAll('.sidebar-subs a').forEach(a => {
      if (a.hash === '#' + id) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  }
  function syncReadingPosition() {
    if (searching) return;
    const edge = innerWidth <= 800 ? 160 : 100;
    const passed = [...document.getElementById(activeTopic).querySelectorAll('.subtopic')].filter(s => s.getBoundingClientRect().top <= edge);
    const next = passed.length ? passed[passed.length-1].id : '';
    if (next !== activeSub) updateSubLocation(next);
  }
  window.addEventListener('scroll', () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { scrollQueued = false; syncReadingPosition(); });
  }, {passive:true});
  window.addEventListener('resize', () => requestAnimationFrame(syncReadingPosition));
  function navigationState() {
    topicPicker.value = activeTopic;
    subPicker.replaceChildren();
    const overview = new Option('本主题概览', activeTopic);
    subPicker.add(overview);
    document.getElementById(activeTopic).querySelectorAll('.subtopic').forEach(s => {
      subPicker.add(new Option(s.dataset.label, s.id));
    });
    document.querySelectorAll('.topic-link').forEach(a => {
      if (a.hash === '#' + activeTopic) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.querySelectorAll('.sidebar-subs').forEach(n => n.hidden = n.dataset.topic !== activeTopic);
    updateSubLocation(activeSub);
  }
  function scrollToContent(node, focus) {
    requestAnimationFrame(() => {
      node.scrollIntoView({block:'start',behavior:'instant'});
      syncReadingPosition();
      if (focus) {
        const heading = node.matches('article.topic') ? node.querySelector('h2') :
          node.closest('article.topic') ? node.querySelector('h3,h4') || node : node;
        heading.tabIndex = -1;
        heading.focus({preventScroll:true});
      }
    });
  }
  function showTopic(node, options = {}) {
    const topic = node.matches('article.topic') ? node : node.closest('article.topic');
    if (!topic) return;
    activeTopic = topic.id;
    activeSub = node.closest('.subtopic')?.id || '';
    searching = false;
    search.value = '';
    document.body.classList.remove('searching');
    topics.forEach(t => t.hidden = t !== topic);
    subs.forEach(s => s.hidden = false);
    document.getElementById('idea-empty').hidden = true;
    navigationState();
    status.textContent = '当前主题 · ' + topic.querySelectorAll('.subtopic').length + ' 个子话题 · ' + topic.querySelectorAll('.viewpoints > li').length + ' 条观点 · ' + topic.querySelectorAll('.development').length + ' 份拓展';
    const sidebar = document.querySelector('.sidebar');
    const selected = sidebar.querySelector('.topic-link[aria-current]');
    if (selected && innerWidth > 800) {
      const offset = selected.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
      if (offset < 0 || offset > sidebar.clientHeight - 170) sidebar.scrollTop += offset - 100;
    }
    if (options.push) pushHash(node.id);
    if (options.scroll) scrollToContent(node, options.focus);
  }
  function runSearch() {
    const q = search.value.trim().toLowerCase();
    if (!q) {
      showTopic(document.getElementById(activeSub || activeTopic));
      return;
    }
    searching = true;
    document.body.classList.add('searching');
    let count = 0, opinions = 0;
    subs.forEach(s => {
      const match = s.dataset.search.includes(q);
      s.hidden = !match;
      if (match) { count++; opinions += s.querySelectorAll('.viewpoints > li').length; }
    });
    topics.forEach(t => t.hidden = ![...t.querySelectorAll('.subtopic')].some(s => !s.hidden));
    document.getElementById('idea-empty').hidden = count > 0;
    const first = subs.find(s=>!s.hidden);
    const link = document.getElementById('current-development-link');
    link.hidden = !first;
    if (first) {link.href = '#'+first.id+'-development';link.textContent = '查看首项内容拓展 ↗';}
    status.textContent = '全库找到 ' + count + ' 个子话题 · ' + opinions + ' 条观点 · ' + count + ' 份拓展';
  }
  document.addEventListener('click', event => {
    const a = event.target.closest('a[href^="#"]');
    if (!a || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    let target;
    try { target = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))); }
    catch (_) { return; }
    if (!target) return;
    event.preventDefault();
    if (target.closest('article.topic')) showTopic(target, {push:true,scroll:true,focus:true});
    else { pushHash(target.id); scrollToContent(target, true); }
  });
  topicPicker.addEventListener('change', () => showTopic(document.getElementById(topicPicker.value), {push:true,scroll:true,focus:true}));
  subPicker.addEventListener('change', () => showTopic(document.getElementById(subPicker.value), {push:true,scroll:true,focus:true}));
  search.addEventListener('input', runSearch);
  document.getElementById('idea-clear').addEventListener('click', () => {search.value='';runSearch();search.focus();});
  window.addEventListener('hashchange', () => {
    const node = elementFromHash();
    if (node && node.closest('article.topic')) showTopic(node, {scroll:true});
    else if (node) scrollToContent(node, false);
    else if (!location.hash) showTopic(topics[0], {scroll:true});
  });
  document.documentElement.classList.add('js-reader');
  mobile.hidden = false;
  const initial = elementFromHash();
  showTopic(initial?.closest('article.topic') ? initial : topics[0]);
  if (initial?.closest('article.topic')) requestAnimationFrame(() => scrollToContent(initial, false));
})();
