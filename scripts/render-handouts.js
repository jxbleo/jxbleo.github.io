'use strict';
const {loadRelease, URL_PATTERN} = require('./handout-store');
const ORIGIN = 'https://www.mrcatenglish.com/';
const READER_VERSION = '20261016-header-1';
const XHS_PROFILE = 'https://xhslink.cn/o/aYLtaYWoBd';
const DOUYIN_PROFILE = 'https://v.douyin.com/rjLsjpFg0as/';
// Small, locally drawn platform cues; no third-party image/script requests.
const XHS_ICON = '<span class="handout-icon handout-xhs" aria-hidden="true">小红书</span>';
const DOUYIN_ICON = '<span class="handout-icon handout-douyin" aria-hidden="true"><svg viewBox="2 .5 24 24" focusable="false"><path fill="#25f4ee" transform="translate(-1 1)" d="M14 3h3c.3 2.3 1.7 3.8 4 4v3c-1.5 0-2.8-.5-4-1.3V16a5 5 0 1 1-5-5v3a2 2 0 1 0 2 2Z"/><path fill="#fe2c55" transform="translate(1 0)" d="M14 3h3c.3 2.3 1.7 3.8 4 4v3c-1.5 0-2.8-.5-4-1.3V16a5 5 0 1 1-5-5v3a2 2 0 1 0 2 2Z"/><path fill="#fff" d="M14 3h3c.3 2.3 1.7 3.8 4 4v3c-1.5 0-2.8-.5-4-1.3V16a5 5 0 1 1-5-5v3a2 2 0 1 0 2 2Z"/></svg></span>';
const WECHAT_ICON = '<span class="handout-icon handout-wechat" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="#fff" d="M9 3C4.6 3 1 5.8 1 9.3c0 1.9 1.1 3.6 2.8 4.8l-.7 2.4 2.8-1.4c.7.2 1.4.4 2.1.4a6.4 6.4 0 0 1-.3-1.9c0-3.6 3.5-6.5 7.9-6.5h.8C15.2 4.7 12.4 3 9 3Z"/><path fill="#fff" d="M16 8.5c-3.6 0-6.5 2.3-6.5 5.2s2.9 5.2 6.5 5.2c.9 0 1.7-.1 2.5-.4l2.4 1.2-.6-2.1c1.4-1 2.2-2.3 2.2-3.9 0-2.9-2.9-5.2-6.5-5.2Z"/><g fill="#07a84d"><circle cx="6" cy="7.8" r="1"/><circle cx="11.5" cy="7.8" r="1"/><circle cx="13.7" cy="12.5" r=".9"/><circle cx="18.2" cy="12.5" r=".9"/></g></svg></span>';
const MAIL_ICON = '<svg class="handout-mail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>';
const HANDOUT_HEADER = `<header class="resource-topbar handout-topbar" data-resource-topbar>
<div class="resource-brand"><img src="assets/icons/mrcat-icon-192.png" alt="" width="32" height="32"><span class="handout-name">猫先生英语</span></div>
<nav class="handout-socials" aria-label="关注与联系猫先生英语">
<a class="handout-social" data-handout-app="xiaohongshu" href="${XHS_PROFILE}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="查看猫先生英语的小红书主页" title="小红书 · 猫先生英语主页">${XHS_ICON}</a>
<a class="handout-social" href="${DOUYIN_PROFILE}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="查看猫先生英语的抖音主页" title="抖音 · 猫先生英语主页">${DOUYIN_ICON}</a>
<div class="handout-copy-help handout-wechat-help"><button class="handout-social" type="button" data-handout-wechat="jxbleo_" aria-label="复制微信号 jxbleo_" title="点击复制微信号 jxbleo_">${WECHAT_ICON}</button><div class="handout-contact-tip handout-wechat-tip" data-handout-wechat-status role="status" aria-live="polite" hidden><span data-handout-wechat-message></span><code>jxbleo_</code><p>请打开微信，搜索该微信号添加好友即可。</p></div></div>
<a class="handout-social" href="mailto:jxbleo@foxmail.com" aria-label="发送邮件至 jxbleo@foxmail.com" title="jxbleo@foxmail.com">${MAIL_ICON}</a>
</nav></header>`;
const HANDOUT_HEADER_STYLE = `<style id="handout-header-style">
.resource-topbar.handout-topbar { gap: .75rem 1.5rem; padding: .65rem 0; flex-wrap: wrap; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; }
.handout-topbar .resource-brand { display: inline-flex; flex: 0 0 auto; gap: .65rem; line-height: 1.4; letter-spacing: .02em; }
.handout-topbar .resource-brand img { width: 2rem; height: 2rem; border-radius: .6rem; }
.handout-topbar .resource-brand span { display: inline; }
.handout-topbar .handout-name { font-size: 1rem; font-weight: 600; }
.handout-topbar .handout-socials { position: relative; display: flex; align-items: center; flex-wrap: wrap; gap: .35rem; margin-left: auto; }
.handout-topbar .handout-social { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; min-height: 44px; padding: 0; flex: 0 0 44px; border: 1px solid transparent; border-radius: 12px; color: #4c5b62; background: transparent; text-decoration: none; font-family: inherit; font-size: .82rem; font-weight: 500; line-height: 1.4; letter-spacing: 0; white-space: nowrap; cursor: pointer; transition: background .15s ease, border-color .15s ease; }
.handout-topbar .handout-social:hover { background: #ffffffb8; border-color: #dce5e7; color: #192b35; }
.handout-topbar .handout-social:focus-visible { outline: 2px solid #2867a0; outline-offset: 2px; }
.handout-topbar .handout-icon { display: inline-flex; align-items: center; justify-content: center; width: 25px; height: 25px; flex: 0 0 25px; border-radius: 7px; }
.handout-topbar .handout-xhs { background: #f22d4e; color: #fff; font-size: 7px; font-weight: 700; letter-spacing: -.3px; }
.handout-topbar .handout-douyin { background: #20212b; }
.handout-topbar .handout-wechat { background: #07a84d; }
.handout-topbar .handout-copy-help { position: relative; }
.handout-topbar .handout-icon svg { width: 20px; height: 20px; }
.handout-topbar .handout-mail { width: 22px; height: 22px; }
.handout-topbar .handout-contact-tip { position: absolute; top: calc(100% + .45rem); right: 0; z-index: 60; box-sizing: border-box; width: 288px; max-height: min(480px, 65vh); overflow-y: auto; padding: 1rem 1.1rem; border: 1px solid #e0e7e9; border-radius: 16px; background: #fff; box-shadow: 0 12px 36px #273b4b20; color: #495c67; font-size: .82rem; line-height: 1.8; }
.handout-topbar .handout-contact-tip p { margin: 0 0 .5rem; white-space: pre-line; }
.handout-topbar .handout-contact-tip a { display: inline-flex; align-items: center; min-height: 44px; color: #2867a0; text-underline-offset: 3px; }
.handout-topbar .handout-contact-tip[hidden] { display: none; }
.handout-topbar .handout-wechat-tip p { margin: .4rem 0 0; }
.handout-topbar .handout-wechat-tip code { display: block; margin-top: .2rem; color: #173d2b; font-size: 1rem; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; user-select: all; -webkit-user-select: all; }
@media (max-width: 620px) {
  .resource-topbar.handout-topbar { position: relative; gap: .25rem; padding: .7rem 0 .45rem; }
  .handout-topbar .handout-socials { flex-wrap: nowrap; gap: .15rem; }
  .handout-topbar .handout-copy-help { position: static; }
  .handout-topbar .handout-contact-tip { width: min(288px, calc(100vw - 2.5rem)); }
}
@media (prefers-reduced-motion: reduce) { .handout-topbar .handout-social { transition: none; } }
</style>`;
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
  // A handout is a destination, not an entry into the site's material collection.
  html=html.replace(/<a\b([^>]*\bhref=["'](?:index\.html|https:\/\/(?:www\.)?mrcatenglish\.com\/?)["'][^>]*)>([\s\S]*?)<\/a>/g,(_,attrs,body)=>
    /resource-brand/.test(attrs)?`<span class="resource-brand">${body}</span>`:'');
  html=html.replace(/<link\b(?=[^>]*rel=["']canonical["'])[^>]*>/gi,`<link rel="canonical" href="${url}">`)
    .replace(/<meta\b(?=[^>]*property=["']og:url["'])[^>]*>/gi,`<meta property="og:url" content="${url}">`)
    .replace(/<meta\b(?=[^>]*name=["'](?:robots|referrer)["'])[^>]*>/gi,'');
  html=html.replace('</head>',HANDOUT_HEADER_STYLE+'<script src="assets/js/dse-handout-header.js?v=20261016-douyin-direct-1" defer></script><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"></head>');
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
    if ((html.match(/class="resource-topbar handout-topbar"/g)||[]).length!==1 || /data-resource-share|id="(?:copy-lesson|print-lesson|print-guide|print-current|print-all)"/.test(html)) throw new Error('Invalid student handout header or action controls.');
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
