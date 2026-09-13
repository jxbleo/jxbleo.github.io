#!/usr/bin/env node
'use strict';
const assert = require('assert');
const vm = require('vm');
const { extract } = require('./test-speaking-response-recorder');
function style(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, [value, '']]));
  return { getPropertyValue: key => (values.get(key) || [''])[0], getPropertyPriority: key => (values.get(key) || ['', ''])[1],
    setProperty(key, value, priority = '') { values.set(key, [String(value), priority]); }, removeProperty(key) { values.delete(key); } };
}
function harness(options = {}) {
  let now = 100, sequence = 0, amplitude = 0, failure = false;
  const frames = new Map(), listeners = new Map(), reduced = { matches: false }, voiceStyle = style();
  const body = { style: style({ position: 'relative', 'padding-right': '12px' }) };
  const root = { clientWidth: 980, style: style({ 'scroll-behavior': 'smooth' }) };
  const document = { body, documentElement: root,
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); },
    createElement() { return { sheet: { cssRules: [{ style: voiceStyle }] } }; }, head: { appendChild() {} } };
  const window = { scrollX: 4, scrollY: 217, innerWidth: 1000, matchMedia: () => reduced,
    getComputedStyle: () => ({ paddingRight: '12px' }), scrollTo(x, y) { this.scrollX = x; this.scrollY = y; },
    requestAnimationFrame(fn) { frames.set(++sequence, fn); return sequence; }, cancelAnimationFrame(id) { frames.delete(id); } };
  const inside = {}, dialog = { open: true, contains: node => node === inside };
  const source = { connected: [], disconnected: 0, connect(node) { this.connected.push(node); }, disconnect() { this.disconnected++; } };
  const analyser = { fftSize: 1024, frequencyBinCount: 512, disconnected: 0,
    getFloatTimeDomainData(data) { if (failure) throw Error('device gone'); data.fill(amplitude); }, getByteFrequencyData(data) { data.fill(150); }, disconnect() { this.disconnected++; } };
  const stream = { stop() { throw Error('The decorator must not stop shared capture'); } };
  const audio = { destination: {}, createMediaStreamSource(input) { assert.strictEqual(input, stream); return source; }, createAnalyser() { if (options.failSetup) throw Error('unsupported'); return analyser; } };
  const context = vm.createContext({ window, document, Float32Array, Uint8Array });
  vm.runInContext(extract('createResponseFocus'), context);
  const focus = context.createResponseFocus(dialog);
  function advance(count) { for (let i = 0; i < count; i++) { now += 16; const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(now)); } }
  return { focus, frames, listeners, window, root, body, inside, dialog, audio, stream, source, analyser, voiceStyle, reduced, advance,
    amplitude(value) { amplitude = value; }, failRead() { failure = true; } };
}
const h = harness();
h.focus.lock(); h.focus.lock();
assert.equal(h.body.style.getPropertyValue('position'), 'fixed');
assert.equal(h.body.style.getPropertyValue('top'), '-217px');
assert.equal(h.body.style.getPropertyValue('padding-right'), '32px');
assert.equal(h.listeners.size, 2);
let prevented = 0;
for (const handler of h.listeners.values()) {
  handler({ target: {}, preventDefault() { prevented++; } });
  handler({ target: h.dialog, preventDefault() { prevented++; } });
  handler({ target: h.inside, preventDefault() { throw Error('Dialog scrolling must remain available'); } });
}
assert.equal(prevented, 4);
h.window.scrollY = 0; h.body.style.setProperty('color', 'green');
h.focus.unlock(); h.focus.unlock();
assert.equal(h.window.scrollY, 217); assert.equal(h.window.scrollX, 4);
assert.equal(h.body.style.getPropertyValue('position'), 'relative');
assert.equal(h.body.style.getPropertyValue('padding-right'), '12px');
assert.equal(h.body.style.getPropertyValue('color'), 'green', 'unrelated runtime style changes survive unlocking');
assert.equal(h.root.style.getPropertyValue('scroll-behavior'), 'smooth'); assert.equal(h.listeners.size, 0);
h.focus.start(h.stream, h.audio); h.advance(50);
assert.equal(Number(h.voiceStyle.getPropertyValue('--response-voice')), 0, 'silence does not fabricate voice movement');
assert.deepEqual(h.source.connected, [h.analyser], 'microphone input connects only to the analyser, never speakers');
h.amplitude(.04); h.advance(60); const quiet = Number(h.voiceStyle.getPropertyValue('--response-voice'));
h.amplitude(.09); h.advance(60); const loud = Number(h.voiceStyle.getPropertyValue('--response-voice'));
assert(loud > quiet && quiet > 0, 'actual sample amplitude controls brightness');
h.reduced.matches = true; h.advance(1);
assert.equal(h.voiceStyle.getPropertyValue('--response-spread'), '1');
assert.equal(h.voiceStyle.getPropertyValue('--response-rise'), '50%');
assert(Number(h.voiceStyle.getPropertyValue('--response-voice')) < loud);
h.focus.stop(false); assert(h.source.disconnected); assert(h.analyser.disconnected);
h.advance(300); assert.equal(h.voiceStyle.getPropertyValue('--response-voice'), '0'); assert.equal(h.frames.size, 0);
h.focus.start(h.stream, h.audio); h.advance(10); h.focus.stop(true);
assert.equal(h.frames.size, 0); assert.equal(h.voiceStyle.getPropertyValue('--response-air'), '0');
h.focus.start(h.stream, h.audio); h.failRead(); h.advance(300); assert.equal(h.frames.size, 0, 'analysis failure settles without interrupting capture');
const unavailable = harness({ failSetup: true }); assert.doesNotThrow(() => unavailable.focus.start(unavailable.stream, unavailable.audio)); assert.equal(unavailable.frames.size, 0);
console.log('Response focus passed: scroll locking/restoration, gesture isolation, real sample response, silence, shared-stream isolation, reduced motion and cleanup.');
