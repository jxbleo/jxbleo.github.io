'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const ROOT = path.resolve(__dirname, '..');
const PRIVATE = '.cloudbase-private/handouts';
const URL_PATTERN = /^h-[a-f0-9]{48}\.html$/;
const SEALED = 'scripts/handouts.sealed.json';

function privatePath(root, name) { return path.join(root, PRIVATE, name); }
function contentKey(root = ROOT, env = process.env) {
  const file = privatePath(root, 'content-key.txt');
  const value = String(env.MRCAT_HANDOUT_CONTENT_KEY || (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')).trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Handout content key is missing or invalid; publication stopped.');
  return Buffer.from(value, 'hex');
}
function unseal(root = ROOT, env = process.env) {
  const key = contentKey(root, env);
  try {
    const sealed = JSON.parse(fs.readFileSync(path.join(root, SEALED), 'utf8'));
    if (sealed.schemaVersion !== 1 || sealed.algorithm !== 'aes-256-gcm') throw new Error();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(Buffer.from('mrcat-independent-handouts-v1'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const payload = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]);
    const files = JSON.parse(zlib.gunzipSync(payload, {maxOutputLength: 12 * 1024 * 1024}));
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error();
    for (const [name, value] of Object.entries(files)) {
      if (name.includes('..') || path.isAbsolute(name) || typeof value !== 'string') throw new Error();
    }
    return files;
  } catch (_) { throw new Error('Handout source could not be authenticated or decrypted; publication stopped.'); }
}
function itemsFor(policy, files) {
  const course = JSON.parse(files['content/study-guides/dse-writing-course/course.json']);
  if (course.modules.length !== 16 || course.modules.some((m,i)=>m.id !== String(i+9).padStart(2,'0'))) throw new Error('Incomplete writing course.');
  return [...policy.guides, policy.writingCourse, ...course.modules.map(m=>({
    id: 'dse-writing-module-' + m.id, module: m.id, source: policy.writingCourse.source,
    title: '写作 ' + m.id + ' · ' + m.title, topic: '写作 · 单讲', description: m.summary
  }))];
}
function linkMap(root = ROOT, env = process.env) {
  const file = privatePath(root, 'links.json');
  try {
    const raw = env.MRCAT_HANDOUT_LINKS_JSON || fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    if (data.schemaVersion !== 1 || !data.links || Array.isArray(data.links)) throw new Error();
    return data;
  } catch (_) { throw new Error('Private handout links are missing or invalid; publication stopped.'); }
}
function validateLinks(data, items) {
  const names = Object.keys(data.links);
  if (names.length !== items.length || items.some(i=>!Object.hasOwn(data.links,i.id))) throw new Error('Private handout links do not cover the complete release.');
  const urls = Object.values(data.links);
  if (urls.some(u=>typeof u !== 'string' || !URL_PATTERN.test(u)) || new Set(urls).size !== urls.length) throw new Error('Private handout links must be unique random paths.');
}
function loadRelease(root = ROOT, env = process.env) {
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'scripts/handout-policy.json'), 'utf8'));
  if (policy.retiredPaths.some(name=>fs.existsSync(path.join(root,name))) ||
      fs.existsSync(path.join(root,'content/study-guides/dse-writing-course/course.json')) ||
      fs.existsSync(path.join(root,'content/study-guides/dse-reading-tones.json'))) {
    throw new Error('Public plaintext handout sources or retired aliases remain; migrate them to private authoring storage.');
  }
  const files = unseal(root, env), items = itemsFor(policy, files), map = linkMap(root, env);
  validateLinks(map, items);
  for (const item of items) if (!files[item.source]) throw new Error('A required handout source is missing.');
  return {policy, files, items, map};
}
module.exports = {ROOT, PRIVATE, SEALED, URL_PATTERN, privatePath, contentKey, unseal, itemsFor, linkMap, validateLinks, loadRelease};
