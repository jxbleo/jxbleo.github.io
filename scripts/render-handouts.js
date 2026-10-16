'use strict';
const {loadRelease, URL_PATTERN} = require('./handout-store');
const ORIGIN = 'https://www.mrcatenglish.com/';
const esc = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function extractSection(html, id) {
  const start = html.indexOf(`<section class="course-panel lesson" id="${id}"`);
  if (start < 0) throw new Error('Missing writing module section.');
  const tags = /<\/?section\b[^>]*>/g;
  tags.lastIndex = start;
  let depth = 0, match;
  while ((match = tags.exec(html))) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start,tags.lastIndex);
  }
  throw new Error('Unclosed writing module section.');
}
function isolateModule(full, module, sources, overrides = []) {
  let section = extractSection(full,'module-'+module.id)
    .replace('class="course-panel lesson"','class="lesson"')
    .replace(/<h2 id="title-(\d+)">([^<]+)<\/h2>/,'<h1 id="title-$1">$2</h1>')
    .replace(/<nav class="lesson-pager"[\s\S]*?<\/nav>/g,'');
  for (const [from,to] of overrides) {
    if (!from || section.split(from).length !== 2) throw new Error('Standalone teaching context override needs review.');
    section=section.replace(from,to);
  }
  let head = full.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<script[^>]+dse-writing-course\.js[^>]*><\/script>/,'<script src="assets/js/dse-writing-lesson.js?v=20261016-1" defer></script>')
    .replace('</title>','</title><link rel="stylesheet" href="assets/css/dse-writing-lesson.css?v=20261016-1">');
  head = head.replace(/<title>[\s\S]*?<\/title>/,`<title>${esc(module.id+' · '+module.title)}｜Mr. Cat Academy</title>`)
    .replace(/<meta name="description"[^>]*>/,`<meta name="description" content="${esc(module.summary)}">`)
    .replace(/<meta property="og:title"[^>]*>/,`<meta property="og:title" content="${esc(module.id+' · '+module.title)}">`)
    .replace(/<meta property="og:description"[^>]*>/,`<meta property="og:description" content="${esc(module.summary)}">`);
  const cards = module.sources.map(id=>{
    const source=sources.find(s=>s.id===id);
    if (!source) throw new Error('Missing module source.');
    return `<article class="source-card" id="source-${esc(id)}"><span class="label">${esc(id+' · '+source.kind)}</span><h3><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a></h3><p><strong>读取情况：</strong>${esc(source.status)}</p><p><strong>用途与边界：</strong>${esc(source.use)}</p></article>`;
  }).join('\n');
  return `<!doctype html><html lang="zh-CN"><head>${head}</head><body class="public-resource-page writing-course standalone-writing"><a class="skip-link" href="#module-${module.id}">跳到本讲内容</a><header class="resource-topbar" data-resource-topbar><span class="resource-brand"><img src="assets/icons/mrcat-icon-192.png" alt=""><span>Mr. Cat Academy</span></span><div class="resource-actions"><button class="resource-share" id="copy-lesson" type="button" hidden>复制本讲链接</button><button class="resource-share" id="print-lesson" type="button" hidden>打印本讲</button></div></header><main class="standalone-layout">${section}<section class="source-panel" id="sources" aria-labelledby="sources-title"><h2 id="sources-title">本讲官方资料与读取说明</h2><p>以下为本讲相关的官方参考。教学步骤、任务、示范、答案及冲星挑战均由本讲原创设计，训练完成情况不换算官方等级。</p><div class="source-grid">${cards}</div><a href="#module-${module.id}">返回本讲开头 ↑</a></section></main><footer class="course-footer"><span>Mr. Cat Academy · DSE Writing</span><span>模块 ${module.id} · 原创教学讲义</span></footer><div class="resource-toast" data-resource-toast role="status" aria-live="polite"></div></body></html>`;
}
function independentPage(html, href, policy) {
  const url=ORIGIN+href;
  html=html.replace(/<div class="lesson-card green"><h3>同系列继续学习<\/h3>[\s\S]*?<\/div>/g,'');
  html=html.replace(/<a class="reading-link"[^>]*>[\s\S]*?<\/a>/g,'');
  // A handout is a destination, not an entry into the site's material collection.
  html=html.replace(/<a\b([^>]*\bhref=["'](?:index\.html|https:\/\/(?:www\.)?mrcatenglish\.com\/?)["'][^>]*)>([\s\S]*?)<\/a>/g,(_,attrs,body)=>
    /resource-brand/.test(attrs)?`<span class="resource-brand">${body}</span>`:'');
  html=html.replace(/<link\b(?=[^>]*rel=["']canonical["'])[^>]*>/gi,`<link rel="canonical" href="${url}">`)
    .replace(/<meta\b(?=[^>]*property=["']og:url["'])[^>]*>/gi,`<meta property="og:url" content="${url}">`)
    .replace(/<meta\b(?=[^>]*name=["'](?:robots|referrer)["'])[^>]*>/gi,'');
  html=html.replace('</head>','<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"></head>');
  // Fail, rather than silently publish a forgotten cross-guide address.
  for (const old of policy.retiredPaths) if (html.includes(old)) throw new Error('A handout still exposes a retired address.');
  if (/同系列继续学习|class="reading-link"/.test(html)) throw new Error('A cross-handout promotion remains.');
  return html;
}
function renderRelease(release) {
  const {files,policy,items,map}=release;
  const course=JSON.parse(files['content/study-guides/dse-writing-course/course.json']);
  const sources=JSON.parse(files['content/study-guides/dse-writing-course/sources.json']);
  const overrides=JSON.parse(files['content/study-guides/dse-writing-course/standalone-overrides.json'] || '{}');
  const pages=new Map();
  for (const item of items) {
    const raw=item.module ? isolateModule(files[item.source],course.modules.find(m=>m.id===item.module),sources,overrides[item.module] || []) : files[item.source];
    const html=independentPage(raw,map.links[item.id],policy);
    const opaque=[...new Set(html.match(/h-[a-f0-9]{48}\.html/g)||[])];
    if (opaque.length!==1 || opaque[0]!==map.links[item.id]) throw new Error('A handout exposes another share identity.');
    if (item.module) {
      const lessonIds=html.match(/class="lesson" id="module-\d+"/g)||[];
      if (lessonIds.length!==1) throw new Error('Invalid single-module content.');
      for (const m of course.modules) if (m.id!==item.module && new RegExp(`(?:id|href)="(?:#)?module-${m.id}(?:["-])`).test(html)) throw new Error('A single module exposes another module.');
      if (/course-sidebar|module-picker|lesson-pager|id="overview"|print-all/.test(html)) throw new Error('A single module includes full-course controls.');
    }
    pages.set(map.links[item.id],html);
  }
  return pages;
}
function prepare(root,env) { return renderRelease(loadRelease(root,env)); }
module.exports={prepare,renderRelease,independentPage,isolateModule,URL_PATTERN};
