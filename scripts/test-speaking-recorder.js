#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/speaking-recorder.js'), 'utf8');
function fixture(options = {}) {
  let now = 0, nextId = 1, requestCount = 0, starts = 0, uploadCount = 0, micResolve;
  const timers = new Map(), audioEvents = [], speeches = [], states = [];
  const classes = () => ({ values: new Set(), toggle(name, on) { if (on) this.values.add(name); else this.values.delete(name); }, remove(...names) { names.forEach(name => this.values.delete(name)); }, contains(name) { return this.values.has(name); } });
  class Element {
    constructor(id) { this.id = id; this.hidden = false; this.value = ''; this.style = {}; this.classList = classes(); this.events = {}; this.open = false; this.isConnected = true; }
    addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
    removeEventListener(type, handler) { this.events[type] = (this.events[type] || []).filter(row => row !== handler); }
    fire(type, extra = {}) { for (const handler of this.events[type] || []) handler({ preventDefault() {}, ...extra }); }
    setAttribute(key, value) { this[key] = value; }
    removeAttribute(key) { delete this[key]; }
    focus() { document.activeElement = this; }
    showModal() { assert(!this.open); this.open = true; }
    close() { this.open = false; }
    querySelector() { return this.paragraph ||= new Element('paragraph'); }
  }
  const document = { activeElement: new Element('initial-focus') };
  function schedule(fn, delay, repeat = false) { const id = nextId++; timers.set(id, { fn, due: now + delay, delay, repeat }); return id; }
  const track = { stopped: false, readyState: 'live', muted: false, events: {}, stop() { this.stopped = true; this.readyState = 'ended'; }, addEventListener(type, fn) { this.events[type] = fn; } };
  const stream = { getTracks: () => [track] };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { if (options.constructorFailure) throw Error('unsupported'); this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { starts++; this.state = 'recording'; }
    requestData() {}
    stop() { if (this.state === 'inactive') return; this.state = 'inactive'; schedule(() => { this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }, 0); }
  }
  class AudioContext {
    constructor() { this.state = 'running'; this.destination = {}; }
    get currentTime() { return now / 1000; }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    createOscillator() { const event = {}; audioEvents.push(event); return { frequency: { setValueAtTime(value) { event.frequency = value; } }, connect(gain) { return gain; }, disconnect() {}, start(value) { event.start = value; }, stop(value) { event.stop = value; } }; }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(samples) { samples.fill(.03); } }; }
    createMediaStreamSource() { return { connect() {} }; }
  }
  const navigator = { mediaDevices: { getUserMedia() { requestCount++; if (options.denied) return Promise.reject({ name: 'NotAllowedError' }); if (options.pendingMic) return new Promise(resolve => { micResolve = resolve; }); return Promise.resolve(stream); } } };
  const window = {
    MediaRecorder: Recorder, AudioContext: options.noAudioContext ? undefined : AudioContext,
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: id => timers.delete(id),
    requestAnimationFrame: () => nextId++, cancelAnimationFrame() {}, matchMedia: () => ({ matches: false }), confirm: () => true,
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    speechSynthesis: { getVoices: () => [{ lang: 'zh-CN' }, { lang: 'en-GB' }], speak(speech) { speeches.push(speech); schedule(() => speech.onend(), 1000); }, cancel() {} },
    Audio: class { constructor() { this.paused = true; } addEventListener() {} play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } removeAttribute() {} load() {} }
  };
  vm.runInNewContext(source, { window, document, navigator, performance: { now: () => now }, Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, Intl, Date, Math, Number, Promise });
  const lib = window.MrCatSpeakingRecorder, nodes = {};
  for (const match of lib.markup({ targetSeconds: 180, date: '2026-09-01' }).matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = nodes[match[1]] = new Element(match[1]);
    element.hidden = /\bhidden\b/.test(match[0]);
    element.value = /\bvalue="([^"]*)"/.exec(match[0])?.[1] || '';
  }
  const root = new Element('root'); root.querySelector = selector => nodes[selector.slice(1)]; root.querySelectorAll = () => Array.from({ length: 36 }, () => new Element('bar'));
  const controller = lib.create(root, { onStateChange: snapshot => states.push(snapshot.state), onUpload: () => { uploadCount++; controller.setState('uploading'); } });
  async function flush() { for (let i = 0; i < 6; i++) await Promise.resolve(); }
  async function advance(ms) {
    const end = now + ms;
    await flush();
    while (true) {
      let chosen;
      for (const [id, task] of timers) if (task.due <= end && (!chosen || task.due < chosen[1].due)) chosen = [id, task];
      if (!chosen) break;
      const [id, task] = chosen; now = task.due;
      if (task.repeat) task.due += task.delay; else timers.delete(id);
      task.fn(); await flush();
    }
    now = end; await flush();
  }
  return { lib, controller, nodes, track, states, speeches, audioEvents, advance, flush, timers,
    resolveMic() { micResolve(stream); }, counts: () => ({ requestCount, starts, uploadCount }) };
}
async function run() {
  const f = fixture();
  assert.equal(f.lib.normaliseTarget(undefined), 480);
  assert.equal(f.lib.normaliseTarget(null), 480);
  assert.equal(f.lib.normaliseTarget(195), 210);
  assert.equal(f.lib.normaliseTarget(2), 180);
  assert.equal(f.lib.normaliseTarget(2000), 1800);
  assert.equal(f.lib.timeline(120, 180).minute, true);
  for (const target of [180, 480, 510, 1800]) {
    assert.equal(f.lib.timeline(target - 61, target).fraction, 61 / target);
    assert.equal(f.lib.timeline(target - 60, target).fraction, 1, 'last minute restarts at a full ring');
    assert.equal(f.lib.timeline(target - 30, target).fraction, .5);
    assert.equal(f.lib.timeline(target - 1, target).fraction, 1 / 60);
  }
  assert.equal(f.lib.timeline(180, 180).tick, 5);
  assert.equal(f.lib.timeline(184, 180).tick, 1);
  assert.equal(f.lib.timeline(185, 180).finished, true);
  assert.equal(f.lib.timeText(60), '01:00');
  assert(!f.nodes['recording-caption'], 'recorder has no visible remaining/last-minute caption');
  f.controller.start(); f.controller.start(); await f.flush();
  assert.equal(f.counts().requestCount, 1, 'double taps must not open a second mic');
  assert.equal(f.counts().starts, 0, 'do not record the opening cue');
  assert.equal(f.speeches[0].text, 'The discussion will begin in five seconds.');
  assert.equal(f.speeches[0].lang, 'en-GB');
  assert.equal(f.speeches[0].voice.lang, 'en-GB');
  await f.advance(1000);
  assert.equal(f.controller.snapshot().state, 'countdown');
  await f.advance(4999); assert.equal(f.counts().starts, 0);
  await f.advance(1); assert.equal(f.counts().starts, 1);
  assert.equal(f.audioEvents.length, 5, 'five opening beeps');
  assert.equal(f.nodes['recording-time'].textContent, '03:00');
  await f.advance(120000);
  const minuteCues = f.audioEvents.slice(5);
  assert.equal(minuteCues.length, 3, 'one-minute warning schedules exactly three sounds');
  minuteCues.forEach((cue, index) => {
    assert(Math.abs(cue.stop - cue.start - .36) < 1e-8, 'each cue retains its double duration');
    assert.equal(cue.frequency, 784);
    assert(Math.abs(cue.start - minuteCues[0].start - index * .55) < 1e-8, 'cues have short non-overlapping gaps');
  });
  assert.equal(f.nodes['recording-time'].textContent, '01:00');
  assert(f.nodes['recording-live'].classList.contains('is-minute'), 'whole live surface enters last-minute colours');
  assert.equal(f.nodes['recording-ring-progress'].style.strokeDashoffset, '0');
  await f.advance(30000);
  assert.equal(f.nodes['recording-time'].textContent, '00:30');
  assert.equal(f.nodes['recording-ring-progress'].style.strokeDashoffset, '0.5');
  await f.advance(29999); assert.equal(f.audioEvents.length, 8, 'three-cue warning does not repeat');
  await f.advance(1); assert.equal(f.controller.snapshot().state, 'ending');
  assert(f.nodes['recording-dial'].classList.contains('is-ending'));
  assert(f.nodes['recording-live'].classList.contains('is-ending'));
  assert(!f.nodes['recording-live'].classList.contains('is-minute'));
  assert.equal(f.nodes['recording-countdown'].textContent, '5');
  await f.advance(4000);
  assert.equal(f.audioEvents.length, 13, 'five final beeps, one per second');
  assert.equal(f.nodes['recording-countdown'].textContent, '1');
  assert.equal(f.audioEvents.at(-1).frequency, 1046);
  await f.advance(1000);
  assert.equal(f.controller.snapshot().state, 'review');
  assert(f.controller.snapshot().blob.size > 0);
  assert(f.track.stopped);
  assert(!f.nodes['recording-live'].open);
  assert(!f.nodes['recording-live'].classList.contains('is-ending'), 'ending colour clears when leaving the take');
  const saved = f.controller.snapshot();
  f.nodes['upload-recording'].fire('click'); f.nodes['upload-recording'].fire('click');
  assert.equal(f.counts().uploadCount, 1, 'upload double taps are ignored');
  f.controller.setState('review', 'Upload failed. Please retry.');
  assert.equal(f.controller.snapshot().blob, saved.blob);
  assert.equal(f.controller.snapshot().operationId, saved.operationId, 'retry must reuse the same audio operation');
  f.nodes['replace-recording'].fire('click'); assert.equal(f.controller.snapshot().blob, null);
  assert.equal(f.controller.snapshot().state, 'idle');
  f.controller.destroy();
  const pending = fixture({ pendingMic: true });
  pending.controller.start(); pending.controller.finish(); pending.resolveMic(); await pending.flush();
  assert(pending.track.stopped, 'late permission must release its microphone');
  assert.equal(pending.counts().starts, 0); assert.equal(pending.controller.snapshot().state, 'idle');
  const cancel = fixture(); cancel.controller.start(); await cancel.flush(); cancel.controller.finish(); await cancel.advance(7000);
  assert.equal(cancel.counts().starts, 0, 'cancelled speech/countdown must never start recording');
  assert.equal(cancel.controller.snapshot().state, 'idle');
  for (const option of [{ denied: true }, { constructorFailure: true }]) {
    const failed = fixture(option); failed.controller.start(); await failed.flush();
    assert.equal(failed.controller.snapshot().state, 'idle');
    assert(failed.nodes['recording-message'].textContent.length > 10);
    failed.controller.destroy();
  }
  const restart = fixture();
  restart.controller.start(); await restart.flush(); await restart.advance(500);
  restart.controller.finish(); restart.controller.start(); await restart.flush();
  await restart.advance(500); // the cancelled first utterance emits its late onend
  assert.equal(restart.audioEvents.length, 0, 'stale speech callbacks must not start the new countdown');
  await restart.advance(5500); assert.equal(restart.counts().starts, 1);
  restart.controller.discard();
  const noAudio = fixture({ noAudioContext: true }); noAudio.controller.start(); await noAudio.advance(6000);
  assert.equal(noAudio.controller.snapshot().state, 'recording', 'recording still works without waveform/audio APIs');
  noAudio.controller.finish(); await noAudio.advance(0); assert.equal(noAudio.controller.snapshot().state, 'review');
  const file = fixture(); const audioFile = new Blob(['file'], { type: 'audio/mp4' });
  file.controller.prepareFile(audioFile); assert.equal(file.controller.snapshot().date, '2026-09-01');
  file.controller.setState('analysis_retry', 'Retry analysis');
  assert.equal(file.nodes['upload-recording'].textContent, 'Retry analysis');
  assert(file.nodes['replace-recording'].hidden); file.controller.destroy();
  console.log('Speaking recorder: English opening, countdown timing, minute cue, final red state/beeps, auto-stop, cancellation, file dates and retry lifecycle passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
