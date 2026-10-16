'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { privateHandoutItems, loadPrivateHandouts, visibleItems } = require('../assets/js/teacher-material-links');
const href = 'h-' + 'a'.repeat(48) + '.html';
const item = { id: 'fixture-module', category: 'study', title: 'Synthetic handout', topic: 'Writing', description: 'Fixture', access: 'Link holders', href };
const catalog = { success: true, schemaVersion: 1, items: [item] };
async function main() {
  const items = privateHandoutItems(catalog);
  assert.equal(items[0].links[0].href, 'https://www.mrcatenglish.com/' + href);
  assert.equal(visibleItems(items, 'study', 'Synthetic', '').length, 1);
  for (const invalid of ['dse-writing-course.html', '../' + href, 'https://example.com/' + href, href + '?module=09', href + '#module-09']) {
    assert.throws(() => privateHandoutItems({ ...catalog, items: [{ ...item, href: invalid }] }));
  }
  assert.throws(() => privateHandoutItems({ ...catalog, items: [item, item] }));
  assert.throws(() => privateHandoutItems({ ...catalog, success: false }));
  const calls = [];
  assert.deepEqual(await loadPrivateHandouts({ callAuthenticatedFunction: async (name, event) => { calls.push({ name, event }); return catalog; } }), items);
  assert.deepEqual(calls, [{ name: 'teacherHandoutLinks', event: { action: 'list' } }]);
  await assert.rejects(loadPrivateHandouts(null));
  await assert.rejects(loadPrivateHandouts({ callAuthenticatedFunction: async () => ({ success: false, code: 'TEACHER_REQUIRED' }) }));
  await assert.rejects(loadPrivateHandouts({ callAuthenticatedFunction: async () => { throw new Error('offline'); } }));
  const publicCatalog = fs.readFileSync('content/share-materials.json', 'utf8');
  assert(!/h-[a-f0-9]{48}\.html|dse-reading-(?:tones|inference|tfng|language-effects)\.html|dse-writing-(?:course|guide|formats)\.html/.test(publicCatalog));
  const teacher = fs.readFileSync('teacher.html', 'utf8');
  assert.equal((teacher.match(/id="teacher-material-links-button"/g) || []).length, 1);
  assert(teacher.includes('teacher-material-links.js?v=20261016-isolated-1'));
  console.log('Handout Teacher UI passed: authenticated directory, isolated URLs, denied/offline failures and public catalog exclusion.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
