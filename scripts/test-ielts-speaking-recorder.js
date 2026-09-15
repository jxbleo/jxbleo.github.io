#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/ielts-speaking-lab.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ielts-speaking-lab.html'), 'utf8');
const flush = () => new Promise(setImmediate);
function harness(options = {}) {
  let now = 1000, sequence = 0, permission, probe;
  const timers = new Map(), nodes = {}, devices = [], tracks = [], released = [], calls = [];
  function node(id) {
    if (nodes[id]) return nodes[id];
    const attrs = {}, classes = new Set();
    return nodes[id] = { id, dataset: {}, style: {}, attrs, hidden: false, open: false, disabled: false, isConnected: true, textContent: '', handlers: {},
      classList: { toggle(c, v) { if (v) classes.add(c); else classes.delete(c); }, contains: c => classes.has(c) },
      setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; },
      pause() {}, load() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
      addEventListener(k, fn) { this.handlers[k] = fn; }, parentElement: { inert: false } };
  }
  const stream = { getTracks: () => tracks };
  tracks.push({ stopped: false, stop() { this.stopped = true; } });
  function schedule(fn, ms, repeat) { const id = ++sequence; timers.set(id, {fn, ms, at: now + ms, repeat}); return id; }
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; devices.push(this); }
    start() { if (options.startFails) throw new Error('start failed'); this.state = 'recording'; this.started = now; }
    stop() { this.state = 'inactive'; this.stopped = now; if (this.ondataavailable) this.ondataavailable({data: new Blob(['audio'])}); if (this.onstop) { if (options.delayedStop) schedule(() => this.onstop && this.onstop(), 500, false); else this.onstop(); } }
  }
  const window = { MediaRecorder: Recorder, MrCatScreenWakeLock: {create: () => ({active: false, setActive(v) {this.active = v;}})}, MrCatAuth: {getSession: () => new Promise(() => {})}, MrCatCloud: {}, crypto: {randomUUID: () => 'id-' + ++sequence},
    setInterval: (f, t) => schedule(f, t, true), clearInterval: id => timers.delete(id), setTimeout: (f, t) => schedule(f, t, false), clearTimeout: id => timers.delete(id), addEventListener() {}, scrollTo() {}, scrollY: 0 };
  const document = { getElementById: node, body: {style: {cssText: ''}}, activeElement: node('trigger'), hidden: false, querySelectorAll: () => [], addEventListener(k, fn) {node('document').handlers[k] = fn;}, createElement() {probe = node('probe'); return probe;} };
  const context = vm.createContext({ window, document, MediaRecorder: Recorder, Blob, URL: {createObjectURL: () => 'blob:fixture', revokeObjectURL: url => released.push(url)}, navigator: {mediaDevices: {getUserMedia: () => {calls.push('microphone'); return options.pending ? new Promise(resolve => {permission = resolve;}) : options.denied ? Promise.reject(new Error('denied')) : Promise.resolve(stream);}}}, performance: {now: () => now}, console });
  // Exercise the real module and its event bindings, without starting authentication/network work.
  vm.runInContext(source.replace('})(window);', 'window.fixture = { openRecorder, startRecording, stopRecording, closeRecorder, chooseFile, captureError, get take() { return take; }, get wakeLock() { return wakeLock; }, setTopic(value) { selectedSet = value; } }; })(window);'), context);
  const api = window.fixture; api.setTopic({set_id: 'fixture'});
  api.openRecorder({part: options.part || 2, text: 'Practice question', question_id: 'p2', bullets: options.part === 3 ? undefined : ['First point', 'Second point']});
  function advance(ms) {
    const end = now + ms;
    while (true) { let next; for (const entry of timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break; const [id, timer] = next; now = timer.at; if (timer.repeat) timer.at += timer.ms; else timers.delete(id); timer.fn(); }
    now = end;
  }
  return {api, node, document, advance, devices, tracks, calls, released, resolvePermission: () => permission(stream), probe: () => probe};
}
async function run() {
  const dse = fs.readFileSync(path.join(root, 'assets/js/speaking-lab.js'), 'utf8').match(/function responseDialogRecorderMarkup\(\) \{\s*return '(.*?)';/s)[1];
  const ielts = html.match(/<div class="speaking-response-dialog-recorder"[\s\S]*?<\/p><\/div>/)[0];
  const normalize = s => s.replace(/ id="[^"]+"/g, '').replace(/ data-response-record-label/g, '').replace(/>0[12]:00</g, '>TIME<');
  assert.equal(normalize(ielts), normalize(dse), 'IELTS dial, icons and footer must use the exact DSE structure/classes');
  assert(html.includes('id="individual-response-dialog"'), 'activate the shared full-screen DSE selectors');
  assert(!html.includes('id="ielts-part-label"') && !html.includes('id="ielts-recorder-title"'), 'remove duplicate recorder headings');
  for (const part of [2, 3]) {
    const h = harness({part}), limit = part === 2 ? 120 : 90;
    assert.equal(h.node('ielts-timer').textContent, part === 2 ? '02:00' : '01:30');
    assert.equal(h.node('ielts-preparation').hidden, part === 3);
    await h.api.startRecording(); assert.equal(h.devices[0].state, 'inactive'); assert.equal(h.node('ielts-recorder-surface').dataset.state, 'countdown');
    assert.equal(h.node('ielts-recording-indicator').hidden, true);
    h.advance(1000); assert.equal(h.node('ielts-opening-digit').textContent, '2'); h.advance(1000); assert.equal(h.node('ielts-opening-digit').textContent, '1');
    h.advance(1000); assert.equal(h.devices[0].state, 'recording'); assert(h.api.wakeLock.active); assert(h.node('individual-response-dialog').classList.contains('is-response-focused'));
    h.advance(limit * 500); assert.equal(h.node('ielts-ring-progress').style.strokeDashoffset, '0.5');
    h.advance((limit / 2 - 3) * 1000); assert.equal(h.node('ielts-recorder-surface').dataset.state, 'ending'); assert.equal(h.node('ielts-opening-digit').textContent, '3');
    h.advance(3000); assert.equal(h.devices[0].state, 'inactive'); assert.equal(h.devices[0].stopped - h.devices[0].started, limit * 1000); assert.equal(h.api.take.seconds, limit);
    assert(!h.api.wakeLock.active && h.tracks[0].stopped); assert.equal(h.node('ielts-recorder-surface').dataset.state, 'finished'); assert(!h.node('ielts-submit').hidden); assert(h.node('ielts-file-label').hidden);
    assert.equal(h.node('ielts-timer').textContent, 'Your recording was successfully saved.'); assert(!h.node('individual-response-dialog').classList.contains('is-response-focused'));
  }
  const prep = harness(); prep.node('ielts-prepare').handlers.click(); prep.advance(60000); assert.equal(prep.calls.length, 0); assert.equal(prep.node('ielts-preparation-time').textContent, '00:00'); assert.equal(prep.node('ielts-timer').textContent, '02:00');
  const cancel = harness(); await cancel.api.startRecording(); cancel.advance(1000); await cancel.api.startRecording(); cancel.advance(5000); assert.equal(cancel.devices[0].state, 'inactive'); assert.equal(cancel.api.take.blob, null); assert(cancel.tracks[0].stopped); assert.equal(cancel.node('ielts-recorder-surface').dataset.state, 'idle');
  const early = harness({delayedStop: true}); await early.api.startRecording(); early.advance(3000 + 12400); early.api.stopRecording(false); early.advance(500); assert.equal(early.api.take.seconds, 12.4); assert.equal(early.node('ielts-recorder-surface').dataset.state, 'stopped');
  const keep = early.api.startRecording(); early.node('ielts-keep').onclick(); await keep; assert(early.api.take.blob); assert.equal(early.devices.length, 1);
  const replace = early.api.startRecording(); early.node('ielts-discard').onclick(); await replace; assert.equal(early.node('ielts-preview-panel').hidden, true); assert.equal(early.node('ielts-timer').textContent, '02:00'); assert.equal(early.devices.length, 2);
  const pending = harness({pending: true}); const starting = pending.api.startRecording(); const closing = pending.api.closeRecorder(); pending.node('ielts-discard').onclick(); await closing; pending.resolvePermission(); await starting; assert(pending.tracks[0].stopped); assert.equal(pending.devices.length, 0);
  const denied = harness({denied: true}); await denied.api.startRecording(); assert.equal(denied.node('ielts-recorder-surface').dataset.state, 'idle'); assert.equal(denied.node('ielts-record').disabled, false);
  const fail = harness({startFails: true}); await fail.api.startRecording(); fail.advance(3000); assert(fail.tracks[0].stopped); assert(!fail.api.wakeLock.active);
  const picker = harness(); let prevented = false; picker.node('individual-response-dialog').handlers.cancel({target: picker.node('ielts-file'), preventDefault() {prevented = true;}}); assert(!prevented); assert(picker.node('individual-response-dialog').open);
  const uploading = picker.api.chooseFile({type: 'audio/mp4', size: 123}); picker.probe().duration = 121; picker.probe().onloadedmetadata(); await uploading; assert.equal(picker.api.take.blob, null); assert(picker.node('ielts-record-status').textContent.includes('120 seconds')); assert(picker.released.length);
  const hidden = harness(); await hidden.api.startRecording(); hidden.document.hidden = true; hidden.node('document').handlers.visibilitychange(); assert(hidden.tracks[0].stopped); assert.equal(hidden.node('ielts-recorder-surface').dataset.state, 'idle');
  await flush(); console.log('IELTS recorder: shared DSE surface, P2/P3 caps, countdown, preparation, early stop, retry/discard, permission races and file cancellation passed.');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
