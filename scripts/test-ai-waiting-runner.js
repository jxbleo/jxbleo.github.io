#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/ai-waiting-runner.js'), 'utf8');
const failures = [];

function check(label, callback) {
  try {
    callback();
    process.stdout.write(`✓ ${label}\n`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    process.stdout.write(`✗ ${label}\n`);
  }
}

function makeHarness(reduceMotion = false) {
  const rafs = new Map();
  const listeners = new Map();
  let nextRaf = 1;
  const context = {
    setTransform() {}, scale() {}, clearRect() {}, fillRect() {}, fill() {}, stroke() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {},
    quadraticCurveTo() {}, save() {}, restore() {}, translate() {},
  };
  const canvasListeners = new Map();
  const canvas = {
    width: 0,
    height: 0,
    clientWidth: 640,
    clientHeight: 280,
    style: {},
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 640, height: 280 }),
    addEventListener(type, handler) { canvasListeners.set(type, handler); },
    removeEventListener(type) { canvasListeners.delete(type); },
    setPointerCapture() {},
    focus() { document.activeElement = canvas; },
    closest() { return null; },
  };
  const document = {
    hidden: false,
    activeElement: canvas,
    createElement: () => ({ getContext: () => context }),
    addEventListener(type, handler) { listeners.set(`document:${type}`, handler); },
    removeEventListener(type) { listeners.delete(`document:${type}`); },
  };
  const window = {
    devicePixelRatio: 1,
    document,
    matchMedia: () => ({ matches: reduceMotion }),
    requestAnimationFrame(callback) { const id = nextRaf++; rafs.set(id, callback); return id; },
    cancelAnimationFrame(id) { rafs.delete(id); },
    setTimeout,
    clearTimeout,
    addEventListener(type, handler) { listeners.set(`window:${type}`, handler); },
    removeEventListener(type) { listeners.delete(`window:${type}`); },
    ResizeObserver: undefined,
  };
  const contextObject = { window, document, Math, Date, console, setTimeout, clearTimeout };
  vm.runInNewContext(source, contextObject, { filename: 'ai-waiting-runner.js' });
  return {
    canvas,
    document,
    window,
    runnerApi: window.MrCatWaitingRunner,
    pendingRafCount: () => rafs.size,
    frame(timestamp) {
      const pending = Array.from(rafs.values());
      rafs.clear();
      pending.forEach((callback) => callback(timestamp));
    },
    pointerDown() { const handler = canvasListeners.get('pointerdown'); if (handler) handler({ pointerId: 1 }); },
    visibility(handlerType, hidden) { document.hidden = hidden; const handler = listeners.get(`document:${handlerType}`); if (handler) handler(); },
  };
}

check('public Runner interface is exposed', () => {
  const harness = makeHarness();
  assert.strictEqual(typeof harness.runnerApi.mount, 'function');
  assert.strictEqual(typeof harness.runnerApi.isSupported, 'function');
  const runner = harness.runnerApi.mount(harness.canvas);
  ['jump', 'setTaskState', 'finish', 'pause', 'resume', 'destroy', 'snapshot'].forEach((name) => {
    assert.strictEqual(typeof runner[name], 'function', `${name} missing`);
  });
  runner.destroy();
});

check('destroy is idempotent', () => {
  const harness = makeHarness();
  const runner = harness.runnerApi.mount(harness.canvas);
  runner.destroy();
  runner.destroy();
  assert.strictEqual(runner.snapshot().destroyed, true);
});

check('finish callback runs once', () => {
  const harness = makeHarness();
  const runner = harness.runnerApi.mount(harness.canvas);
  let callbacks = 0;
  runner.finish(() => { callbacks += 1; });
  runner.finish(() => { callbacks += 1; });
  for (let time = 0; time < 800; time += 16) harness.frame(time);
  assert.strictEqual(callbacks, 1);
  runner.destroy();
});

check('reduced motion does not start a continuous animation', () => {
  const harness = makeHarness(true);
  const runner = harness.runnerApi.mount(harness.canvas);
  assert.strictEqual(harness.pendingRafCount(), 0);
  let callbacks = 0;
  runner.finish(() => { callbacks += 1; });
  assert.strictEqual(callbacks, 1);
  runner.destroy();
});

check('pause freezes simulation and resume discards hidden delta', () => {
  const harness = makeHarness();
  const runner = harness.runnerApi.mount(harness.canvas);
  harness.frame(0);
  harness.frame(100);
  const beforePause = runner.snapshot();
  runner.pause();
  harness.frame(10000);
  assert.deepStrictEqual(runner.snapshot().player, beforePause.player);
  runner.resume();
  harness.frame(10001);
  const afterResume = runner.snapshot();
  assert(afterResume.distance - beforePause.distance < 20, 'resume used a hidden-tab-sized delta');
  runner.destroy();
});

check('pointer jump is immediate and collisions stumble without game over', () => {
  const harness = makeHarness();
  const runner = harness.runnerApi.mount(harness.canvas);
  harness.pointerDown();
  harness.frame(0);
  harness.frame(16);
  assert(runner.snapshot().player.vy < 0, 'pointerdown did not jump');
  for (let time = 32; time < 20000; time += 16) harness.frame(time);
  const snapshot = runner.snapshot();
  assert(snapshot.stumbleCount >= 1, 'expected at least one obstacle collision');
  assert(snapshot.obstacles.length >= 1, 'obstacles stopped regenerating after the first screen');
  assert(!Object.prototype.hasOwnProperty.call(snapshot, 'gameOver'), 'formal failure state leaked into snapshot');
  runner.destroy();
});

check('finish timing is independent from time already spent waiting', () => {
  const harness = makeHarness();
  const runner = harness.runnerApi.mount(harness.canvas);
  for (let time = 0; time < 2400; time += 16) harness.frame(time);
  let callbacks = 0;
  runner.finish(() => { callbacks += 1; });
  const gateStart = runner.snapshot().finishGateX;
  assert.strictEqual(callbacks, 0, 'finish ended immediately after a long wait');
  for (let time = 2400; time < 2560; time += 16) harness.frame(time);
  assert(runner.snapshot().finishGateX < gateStart, 'finish gate did not move toward the player');
  for (let time = 2400; time < 2800; time += 16) harness.frame(time);
  assert.strictEqual(callbacks, 1, 'finish did not complete within the bounded handoff');
  runner.destroy();
});

check('distance and ink are temporary in-memory state', () => {
  assert(!/fetch\s*\(|CloudBase|localStorage|indexedDB|document\.cookie/i.test(source));
  const harness = makeHarness();
  const runner = harness.runnerApi.mount(harness.canvas);
  harness.frame(0);
  harness.frame(1000);
  const snapshot = runner.snapshot();
  assert(Number.isFinite(snapshot.distance));
  assert(Number.isFinite(snapshot.ink));
  assert(!/Mario|Chrome\s+Dino|\bcoin\b|\bstar\b/i.test(source));
  runner.destroy();
});

if (failures.length) {
  process.stderr.write(`\nWaiting Runner contract failures (${failures.length}):\n`);
  failures.forEach((failure) => process.stderr.write(`- ${failure}\n`));
  process.exitCode = 1;
} else {
  console.log('\nAI Waiting Runner contracts passed.');
}
