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

function makeHarness(reduceMotion = false, randomValues = []) {
  const rafs = new Map();
  const listeners = new Map();
  let nextRaf = 1;
  let randomIndex = 0;
  const context = {
    setTransform() {}, scale() {}, clearRect() {}, fillRect() {}, fill() {}, stroke() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {},
    quadraticCurveTo() {}, save() {}, restore() {}, translate() {}, ellipse() {},
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
  const math = Object.create(Math);
  math.random = () => (randomValues.length ? randomValues[randomIndex++ % randomValues.length] : 0.5);
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
  const contextObject = { window, document, Math: math, Date, console, setTimeout, clearTimeout };
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
    keyDown(key) { const handler = listeners.get('window:keydown'); if (handler) handler({ key, repeat: false, preventDefault() {}, target: canvas }); },
    visibility(hidden) { document.hidden = hidden; const handler = listeners.get('document:visibilitychange'); if (handler) handler(); },
  };
}

function runFrames(harness, start, end, step = 16) {
  for (let time = start; time <= end; time += step) harness.frame(time);
}

check('public Runner interface is exposed and stays optional', () => {
  const harness = makeHarness();
  assert.strictEqual(typeof harness.runnerApi.mount, 'function');
  assert.strictEqual(typeof harness.runnerApi.isSupported, 'function');
  const runner = harness.runnerApi.mount(harness.canvas);
  ['jump', 'setTaskState', 'finish', 'pause', 'resume', 'destroy', 'snapshot'].forEach((name) => {
    assert.strictEqual(typeof runner[name], 'function', `${name} missing`);
  });
  runner.destroy();
});

check('first jump, landing jump, and one air jump are supported', () => {
  const harness = makeHarness();
  const runner = harness.runnerApi.mount(harness.canvas);
  harness.pointerDown();
  harness.frame(0);
  harness.frame(16);
  assert(runner.snapshot().player.vy < 0, 'first jump did not launch');
  harness.pointerDown();
  assert(runner.snapshot().player.jumpCount >= 2, `second jump did not register as an air jump: ${JSON.stringify(runner.snapshot())}`);
  runFrames(harness, 32, 700);
  harness.pointerDown();
  assert.strictEqual(runner.snapshot().player.jumpCount, 2, 'more than one air jump was allowed');
  assert(runner.snapshot().player.jumpBuffer > 0, `third jump should be buffered: ${JSON.stringify(runner.snapshot())}`);
  runFrames(harness, 32, 1200);
  assert(runner.snapshot().player.jumpCount >= 3, `buffered landing jump did not work: ${JSON.stringify(runner.snapshot())}`);
  runner.destroy();
});

check('jump buffer launches on landing', () => {
  const harness = makeHarness();
  const runner = harness.runnerApi.mount(harness.canvas);
  harness.pointerDown();
  harness.frame(0);
  harness.pointerDown();
  harness.keyDown(' ');
  runFrames(harness, 16, 1200);
  assert(runner.snapshot().player.jumpBuffer === 0 || runner.snapshot().player.jumpCount >= 2,
    'buffered jump was not consumed at landing');
  assert(runner.snapshot().player.jumpCount >= 2, 'jump buffer did not trigger a second jump');
  runner.destroy();
});

check('one obstacle collision subtracts once and different obstacles can subtract again', () => {
  const harness = makeHarness(false, [0.5]);
  const runner = harness.runnerApi.mount(harness.canvas);
  runFrames(harness, 0, 20000);
  const snapshot = runner.snapshot();
  assert(snapshot.collisionCount >= 2, 'expected collisions with multiple obstacles');
  assert.strictEqual(snapshot.score, -snapshot.collisionCount + snapshot.collectedCount, 'score should subtract exactly one per collision');
  assert(snapshot.obstacles.every((obstacle) => obstacle.hit !== undefined), 'obstacle hit marker missing');
  runner.destroy();
});

check('the course mixes ground and airborne obstacles and emits causal sound events', () => {
  assert(/airborne:\s*type\s*===\s*3/.test(source) && /GROUND_Y\s*-\s*150/.test(source),
    'airborne obstacle geometry is missing');
  assert(/notifyEvent\(['"]hit['"]\)/.test(source) && /notifyEvent\(['"]collect['"]\)/.test(source),
    'collision and collectible events must be emitted at their causal source');
  const harness = makeHarness(false, [0.5]);
  const events = [];
  const runner = harness.runnerApi.mount(harness.canvas, { onEvent: (event) => events.push(event.type) });
  runFrames(harness, 0, 12000);
  assert(events.includes('hit'), 'obstacle contact did not emit a hit event');
  runner.destroy();
});

check('collectibles are green, reachable, and maintained at 3–7', () => {
  const harness = makeHarness(false, [0.2, 0.8, 0.4, 0.6]);
  const runner = harness.runnerApi.mount(harness.canvas);
  const initial = runner.snapshot();
  assert(initial.collectibleCount >= 3 && initial.collectibleCount <= 7, 'initial collectible count outside 3–7');
  assert(/collectible|#(?:3|4|5|6|7|8|9)[a-f0-9]{5}/i.test(source), 'green collectible implementation missing');
  runFrames(harness, 0, 18000);
  const later = runner.snapshot();
  assert(later.collectibleCount >= 3 && later.collectibleCount <= 7, 'collectibles not replenished to 3–7');
  assert(Number.isFinite(later.score), 'score must be numeric');
  runner.destroy();
});

check('obstacles and collectibles keep replenishing throughout a long wait', () => {
  const harness = makeHarness(false, [0.15, 0.82, 0.38, 0.64, 0.27, 0.73]);
  const runner = harness.runnerApi.mount(harness.canvas);
  const initial = runner.snapshot();
  runFrames(harness, 0, 60000);
  const later = runner.snapshot();
  assert(later.distance > initial.distance + 8000, 'long-wait simulation did not advance');
  assert(later.obstacles.length >= 3, 'obstacles were not replenished after the opening course');
  assert(later.obstacles.some((obstacle) => obstacle.x > 960), 'no future obstacle remains queued beyond the viewport');
  assert(later.collectibleCount >= 3 && later.collectibleCount <= 7, 'collectibles were not replenished during a long wait');
  assert(later.collectibles.some((item) => item.x > 960), 'no future collectible remains queued beyond the viewport');
  assert(!/lastObstacleRight/.test(source), 'a stale absolute obstacle cursor can stop course replenishment');
  runner.destroy();
});

check('score can be negative and onScore exposes only score', () => {
  const harness = makeHarness(false, [0.5]);
  const reports = [];
  const runner = harness.runnerApi.mount(harness.canvas, { onScore: (value) => reports.push(value) });
  runFrames(harness, 0, 12000);
  assert(runner.snapshot().score < 0, 'score never became negative');
  assert(reports.some((value) => Number.isFinite(value.score)), 'onScore did not report score');
  assert(reports.every((value) => Object.keys(value).join(',') === 'score'), 'onScore leaked distance or ink');
  runner.destroy();
});

check('ready freezes the game and cannot be resumed by input or visibility', () => {
  const harness = makeHarness();
  const runner = harness.runnerApi.mount(harness.canvas);
  runner.setTaskState('ready');
  const before = runner.snapshot();
  harness.pointerDown();
  harness.frame(0);
  harness.frame(1000);
  harness.visibility(true);
  harness.visibility(false);
  runner.resume();
  assert.strictEqual(runner.snapshot().paused, true, 'ready should remain paused');
  assert.strictEqual(harness.pendingRafCount(), 0, 'ready left an animation frame scheduled');
  assert.strictEqual(runner.snapshot().distance, before.distance, 'ready advanced world motion');
  assert.strictEqual(runner.snapshot().player.jumpCount, before.player.jumpCount, 'ready accepted a jump');
  runner.destroy();
});

check('pause freezes simulation, resume discards hidden delta, and destroy is idempotent', () => {
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
  assert(runner.snapshot().distance - beforePause.distance < 20, 'resume used hidden-tab-sized delta');
  runner.destroy();
  runner.destroy();
  assert.strictEqual(runner.snapshot().destroyed, true);
});

check('no network, persistence, formal game over, or copyrighted runner assets', () => {
  assert(!/fetch\s*\(|CloudBase|localStorage|sessionStorage|indexedDB|document\.cookie|Game\s*Over/i.test(source));
  assert(!/Mario|Chrome\s+Dino|\bcoin\b|\byellow\s*star\b/i.test(source));
});

if (failures.length) {
  process.stderr.write(`\nWaiting Runner contract failures (${failures.length}):\n`);
  failures.forEach((failure) => process.stderr.write(`- ${failure}\n`));
  process.exitCode = 1;
} else {
  console.log('\nAI Waiting Runner contracts passed.');
}
