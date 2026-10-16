'use strict';
const {loadRelease, URL_PATTERN} = require('./handout-store');
const ORIGIN = 'https://www.mrcatenglish.com/';
const READER_VERSION = '20261016-header-1';
const {render: renderShareHeader, assets: shareHeaderAssets} = require('./share-header');
const HANDOUT_HEADER = renderShareHeader('handout');
const HANDOUT_HEADER_STYLE = `<style id="handout-reference-style">
.handout-references { margin: 2rem 0; padding: clamp(1.25rem, 4vw, 2rem); border: 1px solid #dce5e7; border-radius: 18px; background: #fff; color: #354c56; font: 15px/1.85 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; overflow-wrap: anywhere; }
.handout-references h2 { margin: 0 0 1rem; font-size: 1.3rem; }
.handout-references li { margin: 1rem 0; }
.handout-references p { margin: .4rem 0; }
</style>`;
const esc = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Reader copy is distinct from the private research URLs/status/use notes.
function referenceCards(sources) {
  return sources.filter(source => source.readerDescription).map(source =>
    `<article class="source-card" id="source-${esc(source.id)}"><span class="label">${esc(source.kind)}</span><h3>${esc(source.readerTitle || source.title)}</h3><p>${esc(source.readerDescription)}</p></article>`
  ).join('\n');
}

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
    .replace(/<nav class="lesson-pager"[\s\S]*?<\/nav>/g,'')
    .replace(/<aside class="lesson-sources"[\s\S]*?<\/aside>/g,'');
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
  const cards = referenceCards(module.sources.map(id=>{
    const source=sources.find(s=>s.id===id);
    if (!source) throw new Error('Missing module source.');
    return source;
  }));
  return `<!doctype html><html lang="zh-CN"><head>${head}</head><body class="public-resource-page writing-course standalone-writing"><a class="skip-link" href="#module-${module.id}">跳到本讲内容</a><header class="resource-topbar" data-resource-topbar><span class="resource-brand"><img src="assets/icons/mrcat-icon-192.png" alt=""><span>Mr. Cat Academy</span></span><div class="resource-actions"><button class="resource-share" id="copy-lesson" type="button" hidden>复制本讲链接</button><button class="resource-share" id="print-lesson" type="button" hidden>打印本讲</button></div></header><main class="standalone-layout">${section}<section class="source-panel" id="sources" aria-labelledby="sources-title"><h2 id="sources-title">权威资料参考</h2><p>本讲义参考香港考评局评核资料与香港教育局英语学习资源，将相关写作要求融入讲解、示范与练习。范文与练习为原创教学内容。</p><div class="source-grid">${cards}</div><a href="#module-${module.id}">返回本讲开头 ↑</a></section></main><footer class="course-footer"><span>Mr. Cat Academy · DSE Writing</span><span>模块 ${module.id} · 原创教学讲义</span></footer><div class="resource-toast" data-resource-toast role="status" aria-live="polite"></div></body></html>`;
}
function independentPage(html, href, policy) {
  const url=ORIGIN+href;
  html=html.replace(/<a\b[^>]*href="#source-[^"]+"[^>]*>([\s\S]*?)<\/a>/g,'<span>$1</span>');
  // Owner-approved contact controls never expose another handout or the private teacher directory.
  html=html.replace(/<header\b[^>]*\bdata-resource-topbar\b[^>]*>[\s\S]*?<\/header>/g,HANDOUT_HEADER);
  html=html.replace(/<button\b[^>]*\bid="print-guide"[^>]*>[\s\S]*?<\/button>\s*<p class="small-note">打印[^<]*<\/p>/g,'')
    .replace(/<button\b[^>]*\bid="(?:print-current|print-all)"[^>]*>[\s\S]*?<\/button>/g,'')
    .replace(/<div>\s*<\/div>/g,'')
    .replaceAll(' · 可打印','')
    .replace(' · 可直接分享给同学，也可通过浏览器打印整份讲义。','')
    .replace('仍可使用目录锚点和浏览器打印。','仍可使用目录锚点阅读。');
  html=html.replace(/(assets\/js\/dse-(?:writing-(?:course|lesson)|reading-(?:inference|tfng|language-effects))\.js)(?:\?[^"']*)?/g,`$1?v=${READER_VERSION}`);
  html=html.replace(/<div class="lesson-card green"><h3>同系列继续学习<\/h3>[\s\S]*?<\/div>/g,'');
  html=html.replace(/<a class="reading-link"[^>]*>[\s\S]*?<\/a>/g,'');
  // Only the owner-approved branded home entry survives; no lesson directory or peer handout links.
  html=html.replace(/<a\b([^>]*\bhref=["'](?:index\.html|https:\/\/(?:www\.)?mrcatenglish\.com\/?)["'][^>]*)>([\s\S]*?)<\/a>/g,(match,attrs,body)=>
    /class="resource-brand handout-system-entry"/.test(attrs)?match:/resource-brand/.test(attrs)?`<span class="resource-brand">${body}</span>`:'');
  html=html.replace(/<link\b(?=[^>]*rel=["']canonical["'])[^>]*>/gi,`<link rel="canonical" href="${url}">`)
    .replace(/<meta\b(?=[^>]*property=["']og:url["'])[^>]*>/gi,`<meta property="og:url" content="${url}">`)
    .replace(/<meta\b(?=[^>]*name=["'](?:robots|referrer)["'])[^>]*>/gi,'');
  html=html.replace('</head>',HANDOUT_HEADER_STYLE+shareHeaderAssets+'<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"></head>');
  html=html.replace(/(assets\/css\/dse-writing-course\.css)(?:\?[^"']*)?/g, '$1?v=20261016-toc-1');
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
    if ((html.match(/class="resource-topbar handout-topbar share-header"/g)||[]).length!==1 || /data-resource-share|id="(?:copy-lesson|print-lesson|print-guide|print-current|print-all)"/.test(html)) throw new Error('Invalid student handout header or action controls.');
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
module.exports={referenceCards,prepare,renderRelease,independentPage,isolateModule,URL_PATTERN};
