#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/speaking-recorder.js'), 'utf8');
function fixture(options = {}) {
  let sampleLevel = .03;
  let now = 0, nextId = 1, requestCount = 0, starts = 0, uploadCount = 0, micResolve;
  const timers = new Map(), frames = new Map(), audioEvents = [], wheelEvents = [], speeches = [], states = [];
  const classes = () => ({ values: new Set(), toggle(name, on) { if (on) this.values.add(name); else this.values.delete(name); }, remove(...names) { names.forEach(name => this.values.delete(name)); }, contains(name) { return this.values.has(name); } });
  class Element {
    constructor(id) { this.id = id; this.hidden = false; this.value = ''; this.style = {}; this.classList = classes(); this.events = {}; this.open = false; this.isConnected = true; this.scrollTop = 0; }
    addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
    removeEventListener(type, handler) { this.events[type] = (this.events[type] || []).filter(row => row !== handler); }
    fire(type, extra = {}) { if (type === 'click' && this.disabled) return; for (const handler of this.events[type] || []) handler({ target: this, preventDefault() {}, ...extra }); }
    setAttribute(key, value) { this[key] = value; }
    removeAttribute(key) { delete this[key]; }
    getAttribute(key) { return this[key]; }
    scrollTo({top}) { this.scrollTop = top; this.fire('scroll'); }
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
    constructor() { this.state = 'running'; this.destination = {}; this.sampleRate = 48000; }
    get currentTime() { return now / 1000; }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect(next) { return next; }, disconnect() {} }; }
    createOscillator() { const event = {}; audioEvents.push(event); return { frequency: { setValueAtTime(value) { event.frequency = value; } }, connect(gain) { return gain; }, disconnect() {}, start(value) { event.start = value; }, stop(value) { if (value != null) event.stop = value; else event.cancelled = true; } }; }
    createBuffer(_, size) { return { getChannelData: () => new Float32Array(size) }; }
    createBufferSource() { return { connect(next) { return next; }, start() { wheelEvents.push(now); }, disconnect() {} }; }
    createBiquadFilter() { return { frequency: {}, Q: {}, connect(next) { return next; }, disconnect() {} }; }
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(samples) { samples.fill(sampleLevel); } }; }
    createMediaStreamSource() { return { connect() {} }; }
  }
  const navigator = { mediaDevices: { getUserMedia() { requestCount++; if (options.denied) return Promise.reject({ name: 'NotAllowedError' }); if (options.pendingMic) return new Promise(resolve => { micResolve = resolve; }); return Promise.resolve(stream); } } };
  const window = {
    MediaRecorder: Recorder, AudioContext: options.noAudioContext ? undefined : AudioContext,
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: id => timers.delete(id),
    requestAnimationFrame: fn => { const id = nextId++; frames.set(id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id), matchMedia: () => ({ matches: false }), confirm: () => true,
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
  const root = new Element('root'); root.querySelector = selector => nodes[selector.slice(1)];
  const rows = Array.from({ length: 55 }, (_, index) => { const row = new Element('duration-' + index); row.setAttribute('data-duration-index', String(index)); return row; });
  root.querySelectorAll = selector => selector === '[data-duration-index]' ? rows : [];
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
  return { lib, controller, nodes, track, states, speeches, audioEvents, wheelEvents, advance, flush, timers,
    begin() { controller.start(); nodes['stop-recording'].fire('click'); },
    setLevel(value) { sampleLevel = value; },
    drawFrame() { const pending = [...frames]; frames.clear(); pending.forEach(([,fn]) => fn(now)); },
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
  assert.equal(f.lib.timeline(180, 180).tick, 3);
  assert.equal(f.lib.timeline(182, 180).tick, 1);
  assert.equal(f.lib.timeline(183, 180).finished, true);
  assert.equal(f.lib.timeText(60), '01:00');
  assert(!f.nodes['recording-waveform'], 'no inner waveform');
  f.controller.start(); f.controller.start();
  assert.equal(f.controller.snapshot().state, 'ready');
  assert.equal(f.counts().requestCount, 0, 'entry must not acquire microphone or start recording');
  assert(f.nodes['recording-live'].open);
  assert(f.nodes['recording-time'].hidden);
  assert(!f.nodes['recording-adjust-duration'].hidden);
  assert(f.controller.locked(), 'ready dialog blocks host navigation/rerender');
  assert.equal(f.nodes['recording-live-status'].textContent, '');
  assert(!f.nodes['recording-upload-option'].hidden);
  assert(!f.nodes['recording-duration-title']); assert(!f.nodes['recording-wheel-help']);
  f.nodes['stop-recording'].fire('click'); f.nodes['stop-recording'].fire('click'); await f.flush();
  assert.equal(f.counts().requestCount, 1, 'double tap while permission is pending is ignored');
  assert.equal(f.counts().starts, 0);
  assert.equal(f.speeches.length, 0, 'no old five-second speech before the approved three cues');
  assert.equal(f.controller.snapshot().state, 'countdown');
  assert(f.nodes['recording-start-hint'].hidden);
  assert.deepEqual(f.audioEvents.map(cue => cue.frequency), [880,880,1320], 'same pitches as IR');
  assert(Math.abs(f.audioEvents[2].stop - f.audioEvents[2].start - .4) < 1e-8);
  await f.advance(2999); assert.equal(f.counts().starts, 0, 'opening does not consume discussion time');
  await f.advance(1); assert.equal(f.counts().starts, 1);
  assert.equal(f.nodes['recording-time'].textContent, '03:00');
  assert(!f.nodes['recording-time'].hidden);
  f.drawFrame();
  assert(f.nodes['recording-outer-line'].getAttribute('d').startsWith('M'), 'real samples feed the outer wave');
  await f.advance(119000);
  assert.equal(f.nodes['recording-time'].textContent, '01:01');
  await f.advance(1000);
  const minuteCues = f.audioEvents.slice(3);
  assert.equal(minuteCues.length, 3);
  minuteCues.forEach((cue, index) => {
    assert(Math.abs(cue.stop - cue.start - .36) < 1e-8);
    assert.equal(cue.frequency, 784);
    assert(Math.abs(cue.start - minuteCues[0].start - index * .55) < 1e-8);
  });
  assert.equal(f.nodes['recording-time'].textContent, '60');
  assert(f.nodes['recording-live'].classList.contains('is-minute'));
  assert.equal(f.nodes['recording-ring-progress'].style.strokeDashoffset, '0');
  await f.advance(1000);
  assert.equal(f.nodes['recording-time'].textContent, '59');
  await f.advance(29000);
  assert.equal(f.nodes['recording-time'].textContent, '30');
  assert.equal(f.nodes['recording-ring-progress'].style.strokeDashoffset, '0.5');
  await f.advance(21000);
  assert.equal(f.nodes['recording-time'].textContent, '09');
  await f.advance(8000);
  assert.equal(f.nodes['recording-time'].textContent, '01', 'last-minute seconds keep two digits');
  assert.equal(f.nodes['recording-time'].getAttribute('aria-label'), 'Seconds remaining: 1');
  await f.advance(999); assert.equal(f.audioEvents.length, 6, 'minute warning does not repeat');
  const lastProgress = f.nodes['recording-ring-progress'].style.strokeDashoffset;
  await f.advance(1);
  assert.equal(f.controller.snapshot().state, 'ending');
  assert(f.nodes['recording-live'].classList.contains('is-ending'));
  assert.equal(f.nodes['recording-countdown'].textContent, '3');
  assert.deepEqual(f.audioEvents.slice(6).map(cue => cue.frequency), [880,880,1320]);
  await f.advance(2000);
  assert.equal(f.nodes['recording-countdown'].textContent, '1');
  assert.equal(f.nodes['recording-ring-progress'].style.strokeDashoffset, lastProgress, 'ending does not advance ring progress');
  await f.advance(999); assert.equal(f.controller.snapshot().state, 'ending');
  await f.advance(1);
  assert.equal(f.controller.snapshot().state, 'review');
  assert(f.controller.snapshot().blob.size > 0); assert(f.track.stopped);
  assert(f.nodes['recording-live'].open, 'finished recording stays in the circle surface');
  assert.equal(f.nodes['upload-recording'].textContent, 'Submit');
  assert.equal(f.nodes['recording-time'].textContent, '03:03');
  assert(f.nodes['recording-upload-option'].hidden);
  const saved = f.controller.snapshot();
  f.nodes['upload-recording'].fire('click'); f.nodes['upload-recording'].fire('click');
  assert.equal(f.counts().uploadCount, 1);
  f.controller.setState('review', 'Upload failed. Please retry.');
  assert.equal(f.controller.snapshot().blob, saved.blob);
  assert.equal(f.controller.snapshot().operationId, saved.operationId);
  f.nodes['replace-recording'].fire('click'); assert.equal(f.controller.snapshot().blob, null);
  assert.equal(f.controller.snapshot().state, 'ready'); f.controller.destroy();

  for (const phase of ['ready', 'requesting', 'countdown']) {
    const back = fixture({ pendingMic: phase === 'requesting' });
    let returns = 0;
    back.controller.start({ onBack() {
      returns++;
      assert.equal(back.controller.snapshot().state, 'idle', 'restore only after recorder unlocks');
      assert(!back.nodes['recording-live'].open);
    } });
    if (phase !== 'ready') { back.nodes['stop-recording'].fire('click'); await back.flush(); }
    assert.equal(back.controller.snapshot().state, phase);
    back.nodes['recording-back'].fire('click');
    back.nodes['recording-back'].fire('click');
    if (phase === 'requesting') back.resolveMic();
    await back.advance(4000);
    assert.equal(returns, 1, 'Back restores the entry once');
    assert.equal(back.counts().starts, 0, 'late permission/countdown cannot start a discarded take');
    assert.equal(back.counts().uploadCount, 0);
    if (phase !== 'ready') assert(back.track.stopped);
    back.controller.start(); back.nodes['recording-live'].fire('cancel');
    assert.equal(returns, 1, 'ordinary recording entry never inherits the Set return callback');
    back.controller.destroy();
  }
  const escape = fixture(); let escapeReturns = 0;
  escape.controller.start({ onBack() { escapeReturns++; } });
  escape.nodes['recording-live'].fire('cancel');
  assert.equal(escapeReturns, 1, 'Escape follows the same Set return route');
  escape.controller.destroy();

  // Exercise the real Set-entry host function as well as the shared recorder.
  const app = fs.readFileSync(require('node:path').join(__dirname, '../assets/js/speaking-lab.js'), 'utf8');
  const createFromSet = app.slice(app.indexOf('    function createDiscussionFromSet('), app.indexOf('    function discussionSetIdentity('));
  const set = { set_id: 'set-fixture', title: 'Fixture task' };
  let entry, restoredSet, restoredUrl, restoredScroll, focused = false, destroyed = false;
  const hostRecorder = { start(value) { entry = value; }, destroy() { destroyed = true; } };
  const button = { querySelector: () => ({}), focus(options) { focused = options.preventScroll; } };
  const host = {
    window: { scrollX: 0, scrollY: 740, location: { href: 'https://example.test/speaking-lab.html' },
      history: { replaceState(_state, _title, url) { restoredUrl = url; } }, scrollTo(value) { restoredScroll = value; } },
    document: { getElementById: () => button }, formalRecorder: hostRecorder,
    allowRecordingNavigation: () => true, closeSidebar() {}, setStatus() {}, shanghaiToday: () => '2026-09-13',
    call: async () => ({ discussion: { discussion_id: 'new-discussion' } }),
    openDiscussion: async () => ({ discussion_id: 'new-discussion' }), loadSidebarLists() {},
    renderSpeakingSetDetail(value) { restoredSet = value; host.selectedId = ''; }, syncDiscussionSidebarSelection() {}
  };
  vm.createContext(host); vm.runInContext(createFromSet, host);
  await host.createDiscussionFromSet(set);
  assert.equal(restoredSet, undefined, 'entry opens the recorder first');
  entry.onBack();
  assert.equal(restoredSet, set, 'Back restores the exact original Set without fetching a report');
  assert.equal(host.formalRecorder, null); assert(destroyed); assert(focused);
  assert.equal(restoredUrl, host.window.location.href);
  assert.equal(restoredScroll.top, 740); assert.equal(restoredScroll.behavior, 'instant');

  const uploadSource = app.slice(app.indexOf('    function uploadPreparedRecording('), app.indexOf('    function bindRecording('));
  function uploadHost(failure) {
    let uploads = 0, analyses = 0, opened = 0;
    const state = { recordingState: 'review', recordingBlob: new Blob(['audio']), recordingUploadOperationId: 'stable-upload', selectedId: 'discussion',
      document: { getElementById: () => ({}) }, stopRecordingPreview() {}, persistRecordingTarget() {}, setStatus() {},
      setRecordingState(next) { state.recordingState = next; }, friendlyError: error => error.message,
      uploadBlob: async () => { uploads++; if (failure === 'upload') throw Error('network'); },
      call: async () => { analyses++; if (failure === 'analysis') { failure = null; throw Error('analysis'); } },
      openDiscussion: async (_id, afterUpload) => { assert.equal(afterUpload, true); assert.equal(state.recordingState, 'uploading', 'keep circle open until next page is ready'); opened++; return {}; }
    };
    vm.createContext(state); vm.runInContext(uploadSource, state);
    return { state, counts: () => ({ uploads, analyses, opened }), async submit() { state.uploadPreparedRecording(); for (let i=0;i<20;i++) await Promise.resolve(); } };
  }
  const submitted = uploadHost(); await submitted.submit();
  assert.deepEqual(submitted.counts(), { uploads: 1, analyses: 1, opened: 1 });
  const uploadFailure = uploadHost('upload'); await uploadFailure.submit();
  assert.equal(uploadFailure.state.recordingState, 'review'); assert(uploadFailure.state.recordingBlob.size);
  assert.equal(uploadFailure.state.recordingUploadOperationId, 'stable-upload');
  const analysisFailure = uploadHost('analysis'); await analysisFailure.submit();
  assert.equal(analysisFailure.state.recordingState, 'analysis_retry'); await analysisFailure.submit();
  assert.deepEqual(analysisFailure.counts(), { uploads: 1, analyses: 2, opened: 1 }, 'analysis retry never uploads accepted audio twice');

  const quiet = fixture(); quiet.setLevel(.01); quiet.begin(); await quiet.advance(3000); quiet.drawFrame();
  const waveRadius = () => Number(/^M([0-9.]+)/.exec(quiet.nodes['recording-outer-line'].getAttribute('d'))[1]) - 100;
  assert(waveRadius() > 102.5, 'quiet speech expands the outer arc on its first frame');
  quiet.setLevel(0);
  for (let i=0;i<24;i++) { await quiet.advance(17); quiet.drawFrame(); }
  assert(waveRadius() < 101.3, 'silence smoothly settles back instead of continuing decorative motion');
  quiet.controller.destroy();

  const imported = fixture(); imported.controller.start();
  imported.controller.prepareFile(null);
  assert.equal(imported.controller.snapshot().state, 'ready', 'cancelling file picker keeps ready surface');
  imported.controller.prepareFile({ type: 'text/plain', size: 12 });
  assert.equal(imported.controller.snapshot().state, 'ready');
  imported.controller.prepareFile(new Blob(['audio'], { type: 'audio/wav' }));
  assert(imported.nodes['recording-live'].open); assert(!imported.nodes['recording-file-date'].hidden);
  assert.equal(imported.nodes['upload-recording'].textContent, 'Submit');
  assert.equal(imported.counts().uploadCount, 0, 'Upload selects only; Submit is required');
  imported.nodes['upload-recording'].fire('click');
  assert.equal(imported.counts().uploadCount, 1); assert(imported.nodes['recording-live'].open);
  imported.controller.destroy();
  const early = fixture(); early.begin(); await early.advance(83000); early.controller.finish(); await early.flush(); await early.advance(0);
  assert.equal(early.controller.snapshot().state, 'review'); assert(early.nodes['recording-live'].open);
  assert.equal(early.nodes['recording-time'].textContent, '01:20'); assert.equal(early.counts().uploadCount, 0);
  early.controller.destroy();

  const wheel = fixture(); wheel.controller.start(); wheel.nodes['recording-adjust-duration'].fire('click'); wheel.drawFrame();
  assert.equal(wheel.wheelEvents.length, 0, 'opening the wheel is silent');
  wheel.nodes['recording-duration-wheel'].scrollTo({top: 10 * 44});
  assert.equal(wheel.wheelEvents.length, 1);
  wheel.nodes['recording-duration-wheel'].fire('scroll'); assert.equal(wheel.wheelEvents.length, 1, 'no repeated tick on same value');
  wheel.nodes['recording-duration-done'].fire('click');
  assert.equal(wheel.controller.snapshot().targetSeconds, 480);
  assert.equal(wheel.nodes['recording-duration-label'].textContent, '8 min');
  assert.equal(wheel.counts().requestCount, 0, 'time selection cannot start recording');
  wheel.nodes['recording-adjust-duration'].fire('click'); wheel.drawFrame();
  wheel.nodes['recording-duration-wheel'].scrollTo({top: 14 * 44});
  wheel.nodes['recording-duration-dialog'].fire('cancel');
  assert.equal(wheel.controller.snapshot().targetSeconds, 480, 'Escape cancels the tentative wheel value');
  wheel.nodes['recording-duration-wheel'].scrollTo({top: 15 * 44});
  assert.equal(wheel.wheelEvents.length, 2, 'closed picker cannot emit ticks');
  wheel.nodes['recording-live'].fire('cancel'); assert.equal(wheel.controller.snapshot().state, 'idle');
  wheel.controller.destroy();

  const pending = fixture({ pendingMic: true }); pending.begin(); pending.controller.finish(); pending.resolveMic(); await pending.flush();
  assert(pending.track.stopped); assert.equal(pending.counts().starts, 0); assert.equal(pending.controller.snapshot().state, 'ready');
  pending.controller.destroy();
  const cancel = fixture(); cancel.begin(); await cancel.flush(); cancel.controller.finish(); await cancel.advance(4000);
  assert.equal(cancel.counts().starts, 0, 'cancelled countdown cannot start recording');
  assert.equal(cancel.controller.snapshot().state, 'ready'); assert(cancel.audioEvents.every(cue => cue.cancelled)); cancel.controller.destroy();
  for (const option of [{ denied: true }, { constructorFailure: true }]) {
    const failed = fixture(option); failed.begin(); await failed.flush();
    assert.equal(failed.controller.snapshot().state, 'ready'); assert(failed.nodes['quality-warning'].textContent.length > 10);
    failed.nodes['recording-back'].fire('click'); assert.equal(failed.controller.snapshot().state, 'idle', 'Back restores file upload after recording failure'); failed.controller.destroy();
  }
  const restart = fixture(); restart.begin(); await restart.flush(); await restart.advance(500);
  restart.controller.finish(); restart.begin(); await restart.advance(2999); assert.equal(restart.counts().starts, 0);
  await restart.advance(1); assert.equal(restart.counts().starts, 1); restart.controller.discard();
  const noAudio = fixture({ noAudioContext: true }); noAudio.begin(); await noAudio.advance(3000);
  assert.equal(noAudio.controller.snapshot().state, 'recording');
  noAudio.controller.finish(); await noAudio.advance(0); assert.equal(noAudio.controller.snapshot().state, 'review');
  const file = fixture(); const audioFile = new Blob(['file'], { type: 'audio/mp4' });
  file.controller.prepareFile(audioFile); assert.equal(file.controller.snapshot().date, '2026-09-01');
  file.controller.setState('analysis_retry', 'Retry analysis'); assert.equal(file.nodes['upload-recording'].textContent, 'Retry');
  assert(file.nodes['replace-recording'].hidden); file.controller.destroy();
  console.log('Speaking recorder: ready entry, wheel sounds, three-second cues, real outer wave, minute reminder, auto-stop, permission/cancellation, files and retry lifecycle passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
