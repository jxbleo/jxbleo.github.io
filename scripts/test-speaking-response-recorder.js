#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/speaking-lab.js'), 'utf8');
function extract(name) {
  const start = source.indexOf('    function ' + name + '(');
  assert(start >= 0, name);
  const next = source.indexOf('\n    function ', start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}
const functions = ['timerClockText', 'responseElapsedSeconds', 'responseCaptureActive', 'cancelResponseCues', 'prepareResponseCueAudio', 'scheduleResponseCues', 'stopResponseHardware', 'finishResponseRecording', 'bindIndividualResponseRecording', 'responseDialogRecorderMarkup', 'responseSetHeading'];
const flush = () => new Promise(setImmediate);
function harness(options = {}) {
  let now = 1000, sequence = 0, resolvePermission;
  const timers = new Map(), elements = {}, tracks = [], devices = [], cues = [], calls = [];
  const stream = { getTracks: () => tracks };
  tracks.push({ stopped: false, listeners: {}, stop() { this.stopped = true; }, addEventListener(type, fn) { this.listeners[type] = fn; } });
  function node(id) {
    if (elements[id]) return elements[id];
    return elements[id] = { isConnected: true, textContent: '', hidden: false, disabled: false, style: {}, attrs: {}, handlers: {}, files: [],
      querySelector() { return node('label'); }, setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener(type, fn) { this.handlers[type] = fn; } };
  }
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; devices.push(this); }
    start() { this.state = 'recording'; this.started = now; }
    stop() { this.state = 'inactive'; this.stopped = now; if (this.ondataavailable) this.ondataavailable({ data: new Blob(['recorded']) }); if (this.onstop) this.onstop(); }
  }
  class AudioContext {
    constructor() { this.state = 'running'; this.currentTime = now / 1000; this.destination = {}; }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createOscillator() { const cue = {}; return { frequency: { setValueAtTime(hz) { cue.hz = hz; } }, connect() {}, disconnect() {}, start(at) { cue.at = at; cues.push(cue); }, stop(at) { if (at !== undefined) cue.end = at; else cue.cancelled = true; } }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  function schedule(fn, delay, repeat) { const id = ++sequence; timers.set(id, { fn, at: now + delay, delay, repeat }); return id; }
  const context = vm.createContext({ console, Blob, MediaRecorder: Recorder, performance: { now: () => now },
    window: { MediaRecorder: Recorder, AudioContext, confirm: () => true, setInterval: (fn, ms) => schedule(fn, ms, true), clearInterval: id => timers.delete(id), setTimeout: (fn, ms) => schedule(fn, ms, false), clearTimeout: id => timers.delete(id) },
    document: { getElementById: node, createElement: () => node('probe') },
    navigator: { mediaDevices: { getUserMedia: () => options.pending ? new Promise(resolve => { resolvePermission = resolve; }) : options.denied ? Promise.reject({ name: 'NotAllowedError' }) : Promise.resolve(stream) } },
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} },
    responseRecorder: null, responseStream: null, responseChunks: [], responseStartedAt: 0, responseRecordedDurationSeconds: null, responseTimer: 0, responseBlob: null, responseUploadOperationId: '', responseUploadInProgress: false,
    responseCaptureState: 'idle', responseCaptureGeneration: 0, responseDeadline: 0, responseCueContext: null, responseCueNodes: [],
    selectedResponse: null, responseDialog: { open: false }, esc: value => String(value),
    friendlyError: error => error.message,
    ensureIndividualResponseCreated: response => { calls.push('create'); return Promise.resolve(response); },
    call: (action, payload) => { calls.push(action); if (options.uploadFails && action === 'startIndividualResponseAudioUpload') return Promise.reject(new Error('Upload failed')); return Promise.resolve({ upload: { cloud_path: 'private/test' }, asset_id: 'asset' }); },
    api: { uploadCloudFile: () => Promise.resolve({ file_id: 'private/file' }) }, uploadWithTimeout: promise => promise,
    getIndividualResponseAndRender: () => Promise.resolve(), loadIndividualResponses() {}
  });
  functions.forEach(fn => vm.runInContext(extract(fn), context));
  vm.runInContext('bindIndividualResponseRecording({response_session_id: "fixture"})', context);
  function advance(ms) {
    const end = now + ms;
    while (true) {
      let chosen;
      for (const [id, timer] of timers) if (timer.at <= end && (!chosen || timer.at < chosen[1].at)) chosen = [id, timer];
      if (!chosen) break;
      const [id, timer] = chosen; now = timer.at;
      if (timer.repeat) timer.at += timer.delay; else timers.delete(id);
      if (context.responseCueContext) context.responseCueContext.currentTime = now / 1000;
      timer.fn();
    }
    now = end;
  }
  return { context, node, devices, tracks, cues, calls, timers, advance, click: () => node('response-record').handlers.click(), resolvePermission: () => resolvePermission(stream) };
}
async function run() {
  const h = harness(); h.click(); await flush();
  assert.equal(h.devices[0].state, 'inactive', 'opening countdown must not be recorded');
  assert.equal(h.node('response-opening-digit').textContent, '3');
  h.advance(1000); assert.equal(h.node('response-opening-digit').textContent, '2');
  h.advance(1000); assert.equal(h.node('response-opening-digit').textContent, '1');
  h.advance(1000); assert.equal(h.devices[0].state, 'recording'); assert.equal(h.node('response-timer').textContent, '01:00');
  h.advance(60000); assert.equal(h.node('response-recorder').attrs['data-state'], 'ending'); assert.equal(h.node('response-timer').textContent, '00:05');
  h.advance(5000); assert.equal(h.devices[0].stopped - h.devices[0].started, 65000); assert.equal(h.node('label').textContent, 'Finished');
  assert.equal(h.context.responseRecordedDurationSeconds, 65); assert.equal(h.node('response-upload').hidden, false);
  assert.equal(h.context.responseBlob.size > 0, true); assert(h.tracks[0].stopped); assert.equal(h.timers.size, 0);
  assert.deepEqual(h.calls, [], 'completion must never automatically create/upload/analyse');
  assert.equal(h.cues.length, 8); assert.deepEqual(h.cues.map(c=>c.hz), [880,880,1320,880,880,880,880,1320]);
  assert.equal(Math.round((h.cues[2].end-h.cues[2].at)*1000),400); assert.equal(Math.round((h.cues[7].end-h.cues[7].at)*1000),400);
  h.node('response-upload').handlers.click(); h.node('response-upload').handlers.click(); await flush();
  assert.deepEqual(h.calls, ['create','startIndividualResponseAudioUpload','finishIndividualResponseAudioUpload','startIndividualResponseAnalysis']);
  assert.equal(h.context.responseBlob, null);
  const pending = harness({pending:true}); pending.click(); vm.runInContext('stopResponseHardware()',pending.context); pending.resolvePermission(); await flush(); assert(pending.tracks[0].stopped); assert.equal(pending.devices.length,0);
  const cancelled = harness(); cancelled.click(); await flush(); cancelled.advance(1000); cancelled.click(); cancelled.advance(70000); assert.equal(cancelled.devices[0].started,undefined); assert(cancelled.tracks[0].stopped); assert.equal(cancelled.timers.size,0); assert(cancelled.cues.every(c=>c.cancelled));
  const denied = harness({denied:true}); denied.click(); await flush(); assert.equal(denied.node('response-record').disabled,false); assert.equal(denied.node('response-file').disabled,false); assert.match(denied.node('response-status').textContent,/denied/);
  const retry = harness({uploadFails:true}); retry.click(); await flush(); retry.advance(5000); retry.click(); assert.equal(retry.node('label').textContent,'Start Over'); assert.equal(retry.context.responseRecordedDurationSeconds,2); retry.node('response-upload').handlers.click(); await flush(); assert(retry.context.responseBlob); assert.equal(retry.node('response-upload').disabled,false); assert.equal(retry.node('response-record').disabled,false);
  const lost = harness(); lost.click(); await flush(); lost.advance(4000); lost.tracks[0].listeners.ended(); assert.equal(lost.node('label').textContent,'Finished'); assert(lost.context.responseBlob); assert.equal(lost.timers.size,0);
  const broken = harness(); broken.click(); await flush(); broken.advance(4000); broken.devices[0].onerror(); assert.equal(broken.context.responseBlob,null); assert(broken.tracks[0].stopped); assert.equal(broken.node('response-record').disabled,false);
  const file = harness(); file.node('response-file').files=[{type:'audio/mp4',name:'sample.m4a'}]; file.node('response-file').handlers.change(); file.node('probe').duration=66; file.node('probe').onloadedmetadata(); assert.equal(file.context.responseBlob,null); assert.match(file.node('response-status').textContent,/65 seconds/);
  file.node('response-file').files=[{type:'audio/mp4',name:'sample.m4a'}]; file.node('response-file').handlers.change(); file.node('probe').duration=12; file.node('probe').onloadedmetadata(); assert.equal(file.node('response-upload').hidden,false); assert.equal(file.context.responseRecordedDurationSeconds,12); assert.deepEqual(file.calls,[]);
  console.log('Individual Response recorder passed: opening/ending timing and cues, manual Submit, double-submit guard, early stop, cancellation, late permission, denial, file limit and upload retry.');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { harness, extract };
