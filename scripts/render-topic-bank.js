"use strict";
const { synchronize: synchronizeShareHeader } = require("./share-header");

const SOURCE = "dse-core-topics/published.html";
const OUTPUT = "dse-topic-bank.html";
const ORIGIN = "https://www.mrcatenglish.com/" + OUTPUT;
const ASSETS = new Set([
  "assets/css/share-header.css", "assets/js/share-header.js",
  "assets/css/dse-topic-bank.css", "assets/js/dse-topic-bank.js",
]);

function validateTopicBankHtml(html) {
  if (typeof html !== "string" ||
      !html.includes('data-topic-bank-version="content-development-v1"') ||
      !html.includes('data-topic-bank-delivery="direct-static"') ||
      !html.includes('<title>DSE英文核心话题库</title>') ||
      !html.includes('<meta name="robots" content="noindex,nofollow,noarchive">') ||
      !html.includes('<meta name="referrer" content="no-referrer">') ||
      !html.includes('href="' + ORIGIN + '"')) return false;
  if (/data-topic-bank-build-source|<iframe\b|<base\b|<form\b|srcdoc\b|getProtectedResource|cloudbase-client|topic-access|topic-preview|topic-full|auth\.js|login\.html|window\.print\s*\(|data-resource-share|id="(?:copy-lesson|print-lesson|print-guide|print-current|print-all)"/i.test(html)) return false;
  const headers = html.match(/<header\b[^>]*\bdata-share-header="handout"[^>]*>[\s\S]*?<\/header>/g) || [];
  if (headers.length !== 1 || (html.match(/\bdata-share-header=/g) || []).length !== 1) return false;
  // Only the shared toolbar may navigate away from the teaching content.
  const body = html.replace(headers[0], "");
  const hrefs = [...body.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(m => m[1]);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const uniqueIds = new Set(ids);
  if (!hrefs.length || uniqueIds.size !== ids.length ||
      hrefs.some(href => !/^#[A-Za-z0-9_-]+$/.test(href) || !uniqueIds.has(href.slice(1)))) return false;
  if (/<(?:img|video|audio|source|object|embed)\b/i.test(body)) return false;
  const sources = [...html.matchAll(/<(script|link)\b([^>]*)>/g)];
  for (const [, tag, attrs] of sources) {
    const value = attrs.match(/\b(?:src|href)="([^"]+)"/)?.[1];
    if (!value || (!ASSETS.has(value.split("?")[0]) && !(tag === "link" && /\brel="canonical"/.test(attrs) && value === ORIGIN))) return false;
  }
  for (const asset of ASSETS) if (sources.filter(([, , attrs]) => attrs.includes('"' + asset + '?') || attrs.includes('"' + asset + '"')).length !== 1) return false;
  const themes = [...html.matchAll(/<article class="topic" id="(topic-\d{2})"/g)];
  if (themes.length !== 20 || themes.some((m, i) => m[1] !== "topic-" + String(i + 1).padStart(2, "0"))) return false;
  const subtopics = html.split('<section class="subtopic" ').slice(1);
  if (subtopics.length !== 100) return false;
  for (const [index, subtopic] of subtopics.entries()) {
    const id = "topic-" + String(Math.floor(index / 5) + 1).padStart(2, "0") + "-sub-" + (index % 5 + 1);
    const viewpoints = subtopic.match(/<ol class="viewpoints"[^>]*>([\s\S]*?)<\/ol>/);
    const tasks = subtopic.match(/<ol class="transfer-tasks">([\s\S]*?)<\/ol>/);
    if (!subtopic.startsWith('id="' + id + '" ') ||
        !subtopic.includes('class="development" id="' + id + '-development"') ||
        !viewpoints || (viewpoints[1].match(/<li>/g) || []).length !== 8 ||
        (viewpoints[1].match(/<p class="claim">/g) || []).length !== 8 ||
        !tasks || (tasks[1].match(/<li>/g) || []).length !== 3 ||
        (subtopic.match(/<section class="development"/g) || []).length !== 1 ||
        (subtopic.match(/<div class="chain">/g) || []).length !== 2 ||
        (subtopic.match(/<article class="option">/g) || []).length !== 2 ||
        !subtopic.includes('<span class="label">假设情境</span>')) return false;
  }
  return true;
}

function renderTopicBank(files) {
  if (!files || typeof files[SOURCE] !== "string") throw new Error("Complete topic-bank source is missing; publication stopped.");
  const html = synchronizeShareHeader(files[SOURCE]);
  if (!validateTopicBankHtml(html)) throw new Error("Topic-bank content or direct-reader boundaries are invalid; publication stopped.");
  return html;
}

function validateBlueprint(html) {
  return typeof html === "string" && (html.match(/\bdata-topic-bank-build-source\b/g) || []).length === 1 &&
    !/<iframe\b|getProtectedResource|cloudbase-client|auth\.js/.test(html);
}

module.exports = { SOURCE, OUTPUT, renderTopicBank, validateTopicBankHtml, validateBlueprint };
