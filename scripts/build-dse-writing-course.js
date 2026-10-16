/* Canonical content stays in ignored private authoring storage. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const authoringRoot = require('./handout-store').privatePath(root, 'source');
const dir = path.join(authoringRoot, 'content/study-guides/dse-writing-course');
const course = JSON.parse(fs.readFileSync(path.join(dir, 'course.json'), 'utf8'));
const sources = JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8'));
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const strip = value => value.replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ');
const countWords = value => (strip(value).match(/[A-Za-z]+(?:['’–-][A-Za-z]+)*/g) || []).length;
const stageName = stage => stage === 'deepen' ? '深化 · 从 Level 4 走向 5' : '体裁应用 · 巩固 Level 4–5';
const contents = new Map();
let totalExercises = 0, totalModels = 0;
const modelCounts = [];
for (const module of course.modules) {
  let text = fs.readFileSync(path.join(dir, `${module.id}.html`), 'utf8');
  const headings = [];
  text = text.replace(/<h3>([\s\S]*?)<\/h3>/g, (_, title) => {
    const id = `module-${module.id}-section-${headings.length + 1}`;
    headings.push({id, title:strip(title)});
    return `<h3 id="${id}">${title}</h3>`;
  });
  text = text.replace(/<div class="model" lang="en" data-model="([^"]+)">([\s\S]*?)<\/div>/g, (_, label, body) => {
    const words = countWords(body);
    modelCounts.push({module:module.id, label, words});
    totalModels += 1;
    return `<p class="model-count">原创完整示范 · 约 ${words} 个英文词（按词粗计，含标题／称呼）</p><div class="model" lang="en" data-model="${esc(label)}">${body}</div>`;
  });
  const exercises = (text.match(/class="exercise"/g) || []).length;
  totalExercises += exercises;
  contents.set(module.id, {text, headings, exercises});
}
const navLinks = stage => course.modules.filter(m => m.stage === stage).map(m => `<a href="#module-${m.id}" data-route="module-${m.id}"><span>${m.id}</span><span>${esc(m.title)}</span></a>`).join('\n');
const cards = stage => course.modules.filter(m => m.stage === stage).map(m => `<a class="module-card" data-search="${esc(`${m.id} ${m.title} ${m.english} ${m.tags} ${m.summary}`.toLowerCase())}" href="#module-${m.id}"><span class="card-number">${m.id}</span><div><h4>${esc(m.title)}</h4><p>${esc(m.summary)}</p><span class="card-meta">${contents.get(m.id).exercises} 组训练 · 含冲星挑战 <span aria-hidden="true">↗</span></span></div></a>`).join('\n');
const sourceRows = sources.map(s => `<article class="source-card" id="source-${s.id}"><span class="label">${s.id} · ${esc(s.kind)}</span><h3><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a></h3><p><strong>读取情况：</strong>${esc(s.status)}</p><p><strong>用途与边界：</strong>${esc(s.use)}</p></article>`).join('\n');
const lessons = course.modules.map((m,i) => {
 const c=contents.get(m.id);
 const previous = course.modules[i-1], next = course.modules[i+1];
 return `<section class="course-panel lesson" id="module-${m.id}" aria-labelledby="title-${m.id}">
 <header class="lesson-heading"><p class="eyebrow">${stageName(m.stage)}</p><div class="lesson-title"><span class="lesson-number">${m.id}</span><div><h2 id="title-${m.id}">${esc(m.title)}</h2><p>${esc(m.english)}</p></div></div><p class="lesson-summary">${esc(m.summary)}</p><div class="lesson-badges"><span>${c.exercises} 组训练</span><span>Level 4 → 5</span><span>末段 5*／5** 挑战</span></div></header>
 <details class="lesson-toc"><summary>本讲目录 · ${c.headings.length} 节</summary><ol>${c.headings.map(h=>`<li><a href="#${h.id}">${esc(h.title)}</a></li>`).join('')}</ol></details>
 <div class="lesson-body">${c.text}</div>
 <aside class="lesson-sources"><h3>本讲官方依据与延伸阅读</h3><p>下列链接对应可核查来源；步骤、题目、范文、参考答案、课时与进阶挑战由本课程原创设计。5*／5** 为训练目标，不作得分保证。</p><ul>${m.sources.map(id=>{const s=sources.find(x=>x.id===id);if(!s)throw Error(`Unknown source ${id}`);return `<li><a href="#source-${id}">${id} · ${esc(s.title)}</a></li>`;}).join('')}</ul></aside>
 <nav class="lesson-pager" aria-label="模块 ${m.id} 的前后讲">${previous?`<a href="#module-${previous.id}"><small>上一讲</small>${previous.id} · ${esc(previous.title)}</a>`:'<a href="#overview"><small>返回</small>课程总览</a>'}${next?`<a href="#module-${next.id}"><small>下一讲</small>${next.id} · ${esc(next.title)}</a>`:'<a href="#module-16"><small>阶段复测</small>16 · 回到诊断与反馈</a>'}</nav>
 </section>`;
}).join('\n');
const html=`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#edf5f5"><meta name="description" content="DSE 英文 Paper 2 写作模块09–24：全文计划、论证深化、八类体裁应用、原创范文、分层训练与参考解析。"><meta name="robots" content="noindex,follow"><meta property="og:type" content="article"><meta property="og:site_name" content="Mr. Cat Academy"><meta property="og:title" content="DSE Paper 2 写作技能与体裁 · 模块09–24"><meta property="og:description" content="从 Level 4 走向5：16个详细模块，原创范文、逐步拆解与分层训练。"><meta property="og:url" content="https://www.mrcatenglish.com/dse-writing-course.html"><meta property="og:image" content="https://www.mrcatenglish.com/assets/icons/mrcat-icon-1024.png"><link rel="canonical" href="https://www.mrcatenglish.com/dse-writing-course.html"><link rel="icon" type="image/png" href="assets/icons/mrcat-favicon-32.png"><link rel="stylesheet" href="assets/css/touch-behavior.css?v=20260723-1"><link rel="stylesheet" href="assets/css/public-resource.css?v=20260820-1"><link rel="stylesheet" href="assets/css/dse-writing-course.css?v=${course.version}"><script src="assets/js/public-resource.js?v=20260820-1" defer></script><script src="assets/js/dse-writing-course.js?v=${course.version}" defer></script><title>${esc(course.title)} · 模块09–24｜Mr. Cat Academy</title></head>
<body class="public-resource-page writing-course"><a class="skip-link" href="#overview">跳到课程内容</a>
<header class="resource-topbar" data-resource-topbar><a class="resource-brand" href="index.html"><img src="assets/icons/mrcat-icon-192.png" alt=""><span>Mr. Cat Academy</span></a><div class="resource-actions"><button class="resource-share" id="copy-lesson" type="button" hidden>复制完整版链接</button><a class="resource-home" href="index.html">进入学习平台 ↗</a></div></header>
<main class="course-layout"><aside class="course-sidebar"><a class="course-home" href="#overview" data-route="overview">写作课程总览</a><nav aria-label="全部写作模块"><p>深化 <span>09—16</span></p>${navLinks('deepen')}<p>体裁应用 <span>17—24</span></p>${navLinks('genre')}<a href="#sources" data-route="sources"><span>↗</span><span>官方资料与使用说明</span></a></nav></aside>
<div class="course-content"><div class="mobile-navigation"><label for="module-picker">选择模块</label><select id="module-picker"><option value="overview">课程总览</option><optgroup label="深化 · 从 Level 4 走向 5">${course.modules.filter(m=>m.stage==='deepen').map(m=>`<option value="module-${m.id}">${m.id} · ${esc(m.title)}</option>`).join('')}</optgroup><optgroup label="体裁应用 · 巩固 Level 4–5">${course.modules.filter(m=>m.stage==='genre').map(m=>`<option value="module-${m.id}">${m.id} · ${esc(m.title)}</option>`).join('')}</optgroup><option value="sources">官方资料与使用说明</option></select></div>
<div class="course-toolbar" hidden><a href="#overview">← 总目录</a><div><button type="button" id="print-current">打印本讲</button><button type="button" id="print-all">打印全套</button></div></div>
<section class="course-panel" id="overview" aria-labelledby="course-title"><div class="course-hero"><p class="eyebrow">HKDSE ENGLISH · PAPER 2 · MODULES 09—24</p><h1 id="course-title">把想法写深，<br>把文章写对。</h1><p class="hero-subtitle">写作技能与体裁应用</p><p class="hero-description">先建立全文方向、论证深度与表达控制，再把这些能力用进不同读者、目的和体裁。每一讲都从问题出发，经过示范、拆解、练习，回到自己的稿件。</p><div class="hero-stats"><span><b>16</b>详细模块</span><span><b>${totalExercises}</b>组分层训练</span><span><b>${totalModels}</b>篇完整示范</span><span><b>${sources.length}</b>项官方资料</span></div><a class="start-button" href="#module-09">从模块 09 开始 <span aria-hidden="true">→</span></a></div>
<div class="overview-body"><div class="orientation"><p class="label">LEVEL 4 → 5 · WITH ADVANCED CHALLENGES</p><h2>沿着一条能力线，逐讲深入</h2><p>本套覆盖原课程的两个阶段，保留 09–24 编号。09–16 练通用写作能力；17–24 学会按体裁和读者调整。每讲后段明确标注冲 5*／5** 的挑战，先把主体任务做稳，再练更深的判断和控制。</p><p>推荐每讲分为讲解与练习、独立写作与修订两次学习；模块 16 单独安排两小时诊断。标注课时、技巧步骤和参考答案是教学建议，不是考评局强制格式或等级保证。</p></div>
<div class="official-note"><h3>先对齐考试要求</h3><p>Paper 2 共两小时。Part A 约 200 词，Part B 从四题中选一题写约 400 词；卷内权重为 40%／60%。内容、语言与风格、组织共同构成写作表现。<a href="#source-S01">评核框架</a> · <a href="#source-S02">等级描述</a></p><p>“从 Level 4 走向 5”是教学路线；原创范文不冒充官方某等级脚本。超过 400 词并不会自动扣分，也不等于更高分，应留时间校对。<a href="#source-S03">2026 官方问答</a></p></div>
<div class="orientation"><details class="lesson-toc"><summary>Level 4 → 5：这一阶段具体练什么？</summary><p>依据官方写作等级描述，进步应同时体现在内容发展、语言的准确适切和整体组织。本表把这些方向转成课堂可观察的动作，右栏是本课程练法，并非官方逐项扣分表。<a href="#source-S02">查看官方描述与读取说明</a></p><div class="table-wrap"><table><thead><tr><th>维度</th><th>这一阶段要加强什么</th><th>怎样在稿件中检查</th></tr></thead><tbody><tr><td>内容</td><td>从部分内容有细节，走向更充分、围绕目的的发展。</td><td>让同伴指出每段的新信息和关键解释；例子要支持本段主张，结论范围不能超过支持。</td></tr><tr><td>语言与风格</td><td>扩大可准确使用的表达范围，持续符合体裁、读者和目的。</td><td>换一种句式后意思是否仍准确？词语是否自然？写给校长和写给同学是否有真正的语气差别？</td></tr><tr><td>组织</td><td>让全文的结构、段落分工和衔接更稳定有效。</td><td>把每段功能写在旁边，检查关系、重复和信息先后；不靠堆连接词假装连贯。</td></tr></tbody></table></div><p>先做核心任务，再按需要选延伸；5*／5** 挑战要求更精细的判断与表达控制，但完成挑战本身不等于官方授予该等级。短练习字数和课堂时长都是训练安排，不替代试卷指示。</p></details>
<details class="lesson-toc"><summary>从自己的作文选练：问题 → 模块 → 应交成果</summary><div class="table-wrap"><table><thead><tr><th>现在最明显的问题</th><th>先练哪里</th><th>做完应留下什么</th></tr></thead><tbody><tr><td>漏任务、换话题、段落重复</td><td><a href="#module-09">09 全文计划</a> → <a href="#module-16">16 诊断</a></td><td>一张任务覆盖卡、改过的功能提纲。</td></tr><tr><td>有观点却解释不下去</td><td><a href="#module-10">10 解释举例</a> → <a href="#module-12">12 因果方案</a></td><td>初稿、补足关键关系的改稿、改动理由。</td></tr><tr><td>比较不公平、反驳没有回应对方</td><td><a href="#module-11">11 比较评价</a> → <a href="#module-13">13 让步反驳</a></td><td>同标准比较和一段针对真实异议的回应。</td></tr><tr><td>句子看似高级却含义不清</td><td><a href="#module-14">14 衔接表达</a> → <a href="#module-15">15 删改</a></td><td>保留原意的改写，指出指代和句间逻辑。</td></tr><tr><td>每种体裁都写成同一种议论文</td><td><a href="#module-17">17–24 体裁应用</a></td><td>一份有角色、读者和目的的任务卡，以及相应体裁稿件。</td></tr></tbody></table></div><p>每次反馈只选一个最影响任务的内容问题和一个可处理的语言问题。写下原句、读者为什么难理解、改了什么，再换题独立写一次；不要只抄参考答案。详细记录与复测在 <a href="#module-16">模块 16</a>。这种聚焦反馈与修订取向参考 <a href="#source-S24">教育局教师培训资料</a>，具体任务和练习顺序由本课程设计。</p></details></div>
<div class="catalog-tools"><label for="course-search">查找模块</label><input id="course-search" type="search" placeholder="输入编号、技能或体裁，如 13、反驳、report" autocomplete="off"><p id="search-status" role="status" aria-live="polite">16 个模块</p></div>
<section class="stage-group" data-stage="deepen"><div class="stage-heading"><p class="label">STAGE 02 · MODULES 09—16</p><h2>深化：从 Level 4 走向 5</h2><p>从“写得到”走向“写充分、写连贯、写有分寸”。</p></div><div class="module-grid">${cards('deepen')}</div></section>
<section class="stage-group" data-stage="genre"><div class="stage-heading"><p class="label">STAGE 03 · MODULES 17—24</p><h2>体裁应用：巩固 Level 4–5</h2><p>同一套能力，适配不同任务、载体与读者。</p></div><div class="module-grid">${cards('genre')}</div></section>
<p id="no-results" class="callout" hidden>没有匹配模块。试试“开头”“故事”“提案”等关键词，或清空搜索查看全部。</p>
<section class="learning-cycle"><h2>一讲怎样学到自己的作文里？</h2><ol><li><b>先试</b><span>不看答案完成起点诊断。</span></li><li><b>看懂</b><span>指出示范每一步的作用。</span></li><li><b>迁移</b><span>换题材、读者或目的再写。</span></li><li><b>修订</b><span>保留初稿，说明改了什么。</span></li></ol><p>提示与参考答案默认收起；开放写作允许不同合理答案。所有题目、人物、范文和教学数据均为原创或明确标示的虚构情境。练习用于自查，不提交、不记录成绩。</p><a href="#sources">查看研究范围、来源与证据边界 →</a></section></div></section>
${lessons}
<section class="course-panel source-panel" id="sources" aria-labelledby="sources-title"><p class="eyebrow">RESEARCH NOTES · ${course.researchDate}</p><h2 id="sources-title">官方资料与使用说明</h2><p class="lead">以考评局的评核文件为考试依据，以教育局资源作为教学参考。下面逐项记录实际读取范围，区分全文、重点章节、索引节选和仅确认入口。</p><div class="official-note"><h3>这套讲义的证据边界</h3><p>已检索评核框架、等级描述、样卷、官方简报、2026 问答、考生表现入口，以及教育局学术／创意英语、体裁活动和教学案例。它不是全部历年试卷的逐题统计，不提供体裁频率、押题或保分结论。</p><p>2026 考生示例入口已确认，但 Paper 2 脚本正文未成功读取；部分 HKEAA 直链返回 403，使用可核读的官方检索正文，并明确标注。EDB 个别 DOCX 附件本次无法读取。未将这些未读取内容当作证据。</p><p>本套步骤、课堂安排、任务、范文、错例、答案与进阶挑战均为原创教学设计。既有网页中的五段模板可作支架，但不是所有任务的统一格式。引用只指向官方原件，不转载完整真题、考生脚本或教材。</p></div>
<div class="source-grid">${sourceRows}</div><div class="official-note"><h3>怎样使用官方考生示例校准？</h3><p>先独立读题并列任务，再阅读整篇脚本和官方评语；分别找内容、语言与风格、组织的具体证据。保留文件原有等级标记，不把 Level 5 自动改写成 5**，也不凭单个句式决定整篇等级。旧题可训练技能，题量与安排以现行框架为准。</p><p>本课程的自查记录是“独立做到／提示后做到／尚未做到”，没有自动官方评分换算。</p></div><a class="back-link" href="#overview">← 返回课程总览</a></section>
</div></main><footer class="course-footer"><span>Mr. Cat Academy · DSE Writing</span><span>原创教学讲义 · 模块 09–24 · 2026.10</span></footer><div class="resource-toast" data-resource-toast role="status" aria-live="polite"></div><noscript><p class="noscript-note">JavaScript 未启用，所有模块完整显示；仍可使用目录锚点和浏览器打印。</p></noscript></body></html>`;
const destination = path.join(authoringRoot, 'dse-writing-course.html');
if (process.argv.includes('--check')) {
 if (!fs.existsSync(destination) || fs.readFileSync(destination,'utf8') !== html) throw Error('Generated course is stale. Run node scripts/build-dse-writing-course.js');
} else fs.writeFileSync(destination, html);
console.log(JSON.stringify({modules:course.modules.length, exercises:totalExercises, completeModels:totalModels, officialSources:sources.length, bytes:Buffer.byteLength(html), modelCounts},null,2));
