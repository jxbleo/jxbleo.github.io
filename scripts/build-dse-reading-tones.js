'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const authoringRoot = require('./handout-store').privatePath(root, 'source');
const source = JSON.parse(fs.readFileSync(path.join(authoringRoot, 'content/study-guides/dse-reading-tones.json'), 'utf8'));
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ids = new Set();
const wordNames = new Set();
const groups = source.groups.map((group, index) => {
  if (!/^[a-z]+$/.test(group.id) || ids.has(group.id)) throw new Error('Invalid category ID');
  ids.add(group.id);
  const words = group.words.map(word => {
    for (const key of ['word','meaning','definition','cue']) if (!word[key]?.trim()) throw new Error('Missing word field: ' + key);
    if (wordNames.has(word.word)) throw new Error('Duplicate word: ' + word.word);
    wordNames.add(word.word);
    return `<article class="word-card" data-priority="${word.priority ? 'true' : 'false'}"><div class="word-heading"><h4 lang="en">${escape(word.word)}</h4>${word.priority ? '<span class="priority-badge">★ 优先掌握</span>' : ''}</div><p class="word-meaning">${escape(word.meaning)}</p><p class="word-definition" lang="en">${escape(word.definition)}</p><p class="word-cue"><span>判断重点</span>${escape(word.cue)}</p></article>`;
  }).join('\n');
  return `<section class="word-group" data-category="${group.id}" aria-labelledby="category-${group.id}"><div class="category-heading"><span class="category-number">${String(index + 1).padStart(2,'0')}</span><div><h3 id="category-${group.id}">${escape(group.title)}</h3><p>${escape(group.description)}</p></div></div><div class="word-grid">${words}</div></section>`;
}).join('\n');
const target = path.join(authoringRoot, 'dse-reading-tones.html');
let html = fs.readFileSync(target, 'utf8');
for (const [marker, content] of [['WORD_BANK',groups],['CATEGORY_OPTIONS',source.groups.map(g=>`<option value="${g.id}">${escape(g.title)}</option>`).join('')]]) {
  const pattern = new RegExp(`<!-- ${marker}_START -->[\\s\\S]*?<!-- ${marker}_END -->`);
  if (!pattern.test(html)) throw new Error('Missing marker: ' + marker);
  html = html.replace(pattern, `<!-- ${marker}_START -->\n${content}\n<!-- ${marker}_END -->`);
}
if (wordNames.size !== 105) throw new Error('Update the visible entry count when changing the word bank');
fs.writeFileSync(target, html);
console.log(`Built ${wordNames.size} entries in ${ids.size} categories.`);
