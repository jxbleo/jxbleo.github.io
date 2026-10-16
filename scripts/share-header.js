"use strict";
// One static template for all shared readers. No report tokens or handout map input.
const VERSION = "20261016-shared-1";
const assets = `<link rel="stylesheet" href="assets/css/share-header.css?v=${VERSION}" data-share-header-style>
<script src="assets/js/share-header.js?v=${VERSION}" data-share-header-script defer></script>`;
const XHS_PROFILE = 'https://xhslink.cn/o/aYLtaYWoBd';
const XHS_APP = 'xhsdiscover://user/5fbbbaf800000000010081af';
const WECHAT_ID = 'jxbleo_';
const EMAIL = 'jxbleo@foxmail.com';
const DOUYIN_PROFILE = 'https://v.douyin.com/rjLsjpFg0as/';
// Small, locally drawn platform cues; no third-party image/script requests.
const XHS_ICON = '<span class="handout-icon handout-xhs" aria-hidden="true">小红书</span>';
const DOUYIN_ICON = '<span class="handout-icon handout-douyin" aria-hidden="true"><svg viewBox="2 .5 24 24" focusable="false"><path fill="#25f4ee" transform="translate(-1 1)" d="M14 3h3c.3 2.3 1.7 3.8 4 4v3c-1.5 0-2.8-.5-4-1.3V16a5 5 0 1 1-5-5v3a2 2 0 1 0 2 2Z"/><path fill="#fe2c55" transform="translate(1 0)" d="M14 3h3c.3 2.3 1.7 3.8 4 4v3c-1.5 0-2.8-.5-4-1.3V16a5 5 0 1 1-5-5v3a2 2 0 1 0 2 2Z"/><path fill="#fff" d="M14 3h3c.3 2.3 1.7 3.8 4 4v3c-1.5 0-2.8-.5-4-1.3V16a5 5 0 1 1-5-5v3a2 2 0 1 0 2 2Z"/></svg></span>';
const WECHAT_ICON = '<span class="handout-icon handout-wechat" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path fill="#fff" d="M9 3C4.6 3 1 5.8 1 9.3c0 1.9 1.1 3.6 2.8 4.8l-.7 2.4 2.8-1.4c.7.2 1.4.4 2.1.4a6.4 6.4 0 0 1-.3-1.9c0-3.6 3.5-6.5 7.9-6.5h.8C15.2 4.7 12.4 3 9 3Z"/><path fill="#fff" d="M16 8.5c-3.6 0-6.5 2.3-6.5 5.2s2.9 5.2 6.5 5.2c.9 0 1.7-.1 2.5-.4l2.4 1.2-.6-2.1c1.4-1 2.2-2.3 2.2-3.9 0-2.9-2.9-5.2-6.5-5.2Z"/><g fill="#07a84d"><circle cx="6" cy="7.8" r="1"/><circle cx="11.5" cy="7.8" r="1"/><circle cx="13.7" cy="12.5" r=".9"/><circle cx="18.2" cy="12.5" r=".9"/></g></svg></span>';
const MAIL_ICON = '<svg class="handout-mail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>';
function render(kind = "handout") {
  const classes = {handout: "resource-topbar", paper: "paper-topbar", report: "speaking-report-toolbar", resource: "resource-share-toolbar"};
  if (!Object.hasOwn(classes, kind)) throw new Error("Unknown share header layout");
  return `<header class="${classes[kind]} handout-topbar share-header" data-share-header="${kind}"${kind === "handout" ? " data-resource-topbar" : ""}>
<a class="resource-brand handout-system-entry" href="index.html" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="进入猫先生英语主页" title="进入主页"><img src="assets/icons/mrcat-icon-192.png" alt="" width="32" height="32"><span class="handout-name">进入主页</span></a>
<nav class="handout-socials" aria-label="关注与联系猫先生英语">
<a class="handout-social" data-handout-app="xiaohongshu" data-handout-app-url="${XHS_APP}" href="${XHS_PROFILE}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="查看猫先生英语的小红书主页" title="小红书 · 猫先生英语主页">${XHS_ICON}</a>
<a class="handout-social" href="${DOUYIN_PROFILE}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="查看猫先生英语的抖音主页" title="抖音 · 猫先生英语主页">${DOUYIN_ICON}</a>
<div class="handout-copy-help handout-wechat-help"><button class="handout-social" type="button" data-handout-wechat="${WECHAT_ID}" aria-label="复制微信号 ${WECHAT_ID}" title="点击复制微信号 ${WECHAT_ID}">${WECHAT_ICON}</button><div class="handout-contact-tip handout-wechat-tip" data-handout-wechat-status role="status" aria-live="polite" hidden><span data-handout-wechat-message></span><code>${WECHAT_ID}</code><p>请打开微信，搜索该微信号添加好友即可。</p></div></div>
<a class="handout-social" href="mailto:${EMAIL}" aria-label="发送邮件至 ${EMAIL}" title="${EMAIL}">${MAIL_ICON}</a>
</nav></header>`;
}

function synchronize(html) {
  if (!html.includes("data-share-header=")) return html;
  let count = 0;
  html = html.replace(/<header\b[^>]*\bdata-share-header="([^"]+)"[^>]*>[\s\S]*?<\/header>/g, (_, kind) => {
    count += 1;
    return render(kind);
  });
  if (count !== 1 || !html.includes("</head>")) throw new Error("A shared reader requires one marked header and a head");
  html = html.replace(/<link\b[^>]*\bdata-share-header-style[^>]*>\s*/g, "")
    .replace(/<script\b[^>]*\bdata-share-header-script[^>]*><\/script>\s*/g, "");
  return html.replace("</head>", assets + "\n</head>");
}
module.exports = {render, synchronize, assets, VERSION};
if (require.main === module && process.argv.includes("--document")) {
  process.stdout.write(synchronize(require("node:fs").readFileSync(0, "utf8")));
}
