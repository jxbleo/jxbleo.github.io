'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { privateHandoutItems, loadPrivateHandouts, visibleItems, curatedItems, classroomItems, readingItems, subjectsFor, subjectCounts } = require('../assets/js/teacher-material-links');
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
  assert(teacher.includes('teacher-material-links.js?v=20261016-subjects-1'));
  assert(teacher.includes('teacher-material-links.css?v=20261016-subjects-1'));

  // Use synthetic locators; never read or print the real private directory.
  const guide = (id, number, title = id) => ({ ...item, id, title, href: 'h-' + String(number).padStart(48, '0') + '.html' });
  const privateRows = privateHandoutItems({ ...catalog, items: [guide('dse-reading-inference', 1, '推断 Inference'), guide('dse-reading-tfng', 2), guide('dse-writing-course', 3), guide('dse-writing-module-09', 4)] });
  const publicRows = curatedItems({ schemaVersion: 1, items: [
    { ...item, id: 'dse-paper-3-foundation', href: 'fixture-listening.html' },
    { ...item, id: 'dse-topic-bank', href: 'fixture-topic.html' },
    { ...item, id: 'new-guide', subjects: ['ielts-reading'], href: 'fixture-reading.html' },
    { ...item, id: 'misc-guide', href: 'fixture-other.html' },
    { ...item, id: 'news', category: 'information', href: 'fixture-news.html' }
  ] });
  const students = classroomItems({ courses: [{ id: 'course-999', studentName: 'Fixture', lessons: [{ id: 'lesson-001', number: 1, title: 'Inference practice' }] }] });
  const re = readingItems({ lessons: [{ id: 'RE-F-99A', title: 'Fixture RE', label: 'Fixture' }] });
  const all = [...privateRows, ...publicRows, ...students, ...re];
  const pick = (subject, query = '') => visibleItems(all, 'study', query, '', subject).map(row => row.id);
  assert.deepEqual(pick('dse-listening'), ['dse-paper-3-foundation']);
  assert.deepEqual(pick('dse-reading'), ['dse-reading-inference', 'dse-reading-tfng']);
  assert.deepEqual(pick('dse-reading', 'INFERENCE'), ['dse-reading-inference']);
  assert.deepEqual(pick('dse-writing', 'INFERENCE'), []);
  assert.deepEqual(pick('dse-writing'), ['dse-writing-course', 'dse-writing-module-09', 'dse-topic-bank']);
  assert.deepEqual(pick('dse-speaking'), ['dse-topic-bank']);
  assert.deepEqual(pick('ielts-reading'), ['new-guide']);
  assert.deepEqual(pick('reading-explorer'), ['RE-F-99A']);
  assert.deepEqual(pick('other'), ['misc-guide']);
  assert.deepEqual(pick('ielts-listening'), []);
  assert.deepEqual(subjectsFor({ ...item, id: 'ielts-listening-foundation' }), ['ielts-listening']);
  assert.deepEqual(pick('', '雅思阅读'), ['new-guide']);
  const counts = subjectCounts(all);
  assert.equal(counts.all, 9, 'All counts unique study rows, not summed multi-subject memberships');
  assert.equal(counts['dse-reading'], 2);
  assert.equal(counts['dse-writing'], 3);
  assert.equal(counts['dse-speaking'], 1);
  assert.equal(subjectCounts(publicRows)['dse-reading'], 0, 'A failed private source creates no fallback or phantom handouts');
  assert.equal(visibleItems(all, 'classroom', '', '', 'dse-reading').length, 1);
  assert.equal(visibleItems(all, 'classroom', 'Inference', '', 'dse-reading').length, 1);
  assert.equal(visibleItems(all, 'information', '', '', 'dse-reading').length, 1);
  assert.deepEqual(subjectsFor({ ...item, subjects: ['ielts-reading', 'ielts-reading'] }), ['ielts-reading']);
  for (const invalid of [[], 'ielts-reading', ['unknown'], ['toString'], ['__proto__']]) assert.throws(() => subjectsFor({ ...item, subjects: invalid }));
  assert.equal(privateRows[0].links[0].href, 'https://www.mrcatenglish.com/' + 'h-' + '1'.padStart(48, '0') + '.html', 'Filtering preserves link identity');
  console.log('Material subject filters passed: exact families, scoped search, overlapping subjects, unique counts, empty/partial sources and unchanged classroom drilldown.');
  console.log('Handout Teacher UI passed: authenticated directory, isolated URLs, denied/offline failures and public catalog exclusion.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
