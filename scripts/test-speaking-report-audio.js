#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function main() {
  const events = {}, calls = [], pending = [];
  let observe;
  const window = { addEventListener(name, fn) { events[name] = fn; }, MrCatCloud: { callFunction(name, args) { calls.push({ name, ...args }); return new Promise(resolve => pending.push(resolve)); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/speaking-report-audio.js'), 'utf8'), {
    window, document: { body: {}, addEventListener(name, fn) { events[name] = fn; } }, URL,
    MutationObserver: class { constructor(fn) { observe = fn; } observe() {} },
  });
  function player(id) {
    const status = { textContent: '' };
    const audio = { paused: true, hidden: true, src: '', error: null, plays: 0,
      play() { this.paused = false; this.plays++; if (this.onplay) this.onplay(); return Promise.resolve(); },
      pause() { this.paused = true; if (this.onpause) this.onpause(); }, removeAttribute() { this.src = ''; }, load() {} };
    const root = { isConnected: true, hidden: false, closest(selector) { return selector === '[hidden]' && this.hidden ? this : null; }, getAttribute() { return id; }, querySelector(selector) { return selector === 'audio' ? audio : status; } };
    const button = { disabled: false, textContent: '', setAttribute() {}, closest() { return root; } };
    return { root, button, audio, status, click() { events.click({ target: { closest: () => button }, preventDefault() {}, stopPropagation() {} }); } };
  }
  const first = player('original-report'), second = player('second-report');
  assert(window.MrCatSpeakingReportAudio.markup('x"<').includes('x&quot;&lt;'));
  const compact = window.MrCatSpeakingReportAudio.markup('ir-report', true);
  assert.match(compact, /speaking-report-audio-compact/);
  assert.match(compact, /aria-label="Play original recording" title="Play recording">▶<\/button>/);
  assert.doesNotMatch(compact, /<audio controls/);
  assert.equal(calls.length, 0);
  first.click(); assert.equal(first.button.disabled, true);
  assert.equal(calls[0].action, 'getSpeakingReportAudio'); assert.equal(calls[0].report_id, 'original-report');
  pending.shift()({ success: true, audio_url: 'https://audio.example.test/original' }); await tick();
  assert.equal(first.audio.plays, 1); assert.equal(first.audio.hidden, false);
  first.click(); assert.equal(first.audio.paused, true);
  first.click(); assert.equal(first.audio.plays, 2); assert.equal(calls.length, 1);
  second.click(); assert.equal(first.audio.src, ''); assert.equal(first.audio.paused, true);
  second.root.isConnected = false; observe();
  pending.shift()({ success: true, audio_url: 'https://audio.example.test/stale' }); await tick();
  assert.equal(second.audio.plays, 0, 'navigation must discard late private URL responses');
  first.click(); pending.shift()({ success: false }); await tick();
  assert.match(first.status.textContent, /unavailable/); assert.equal(first.button.disabled, false);
  first.click(); pending.shift()({ success: true, audio_url: 'javascript:bad()' }); await tick();
  assert.equal(first.audio.src, ''); assert.match(first.status.textContent, /unavailable/);
  first.click(); pending.shift()({ success: true, audio_url: 'https://audio.example.test/retry' }); await tick();
  first.root.hidden = true; observe(); assert.equal(first.audio.src, '');
  first.root.hidden = false; first.click(); pending.shift()({ success: true, audio_url: 'https://audio.example.test/final' }); await tick();
  events.pagehide(); assert.equal(first.audio.paused, true); assert.equal(first.audio.src, '');
  console.log('Speaking report audio: lazy private playback, pause/resume, retry, URL validation, stale requests and navigation cleanup passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
