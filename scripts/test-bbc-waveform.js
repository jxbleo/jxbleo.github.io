#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/bbc-waveform.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'bbc.html'), 'utf8');
const sandbox = {
  window: {},
  Float32Array,
  Math,
  String,
  isFinite
};
vm.runInNewContext(source, sandbox, { filename: 'bbc-waveform.js' });

async function main() {
  const api = sandbox.window.MrCatBbcWaveform;
  assert(api, 'BBC waveform API should be exported');
  assert.deepStrictEqual(Array.from(api.DEFAULT_ZOOM_LEVELS), [1, 2, 4, 8, 16, 32, 64]);

  assert.strictEqual(api.waveformTimeFromClientX(150, { left: 100, width: 200 }, 360), 90);
  assert.strictEqual(api.waveformTimeFromClientX(50, { left: 100, width: 200 }, 360), 0);
  assert.strictEqual(api.waveformTimeFromClientX(400, { left: 100, width: 200 }, 360), 360);

  const channel = new Float32Array([0, 0.2, -0.8, 0.1, 0.4, -0.3, 1, 0]);
  const peaks = api.makePeaks({
    length: channel.length,
    numberOfChannels: 1,
    getChannelData() { return channel; }
  }, 4);
  assert.deepStrictEqual(Array.from(peaks).map(value => Number(value.toFixed(2))), [0.2, 0.8, 0.4, 1]);

  sandbox.window.fetch = () => Promise.reject(new Error('blocked for fallback test'));
  const status = { textContent: '', hidden: true };
  const fallback = new api.BbcWaveform({ status });
  fallback.scheduleRender = () => {};
  assert.strictEqual(await fallback.load('/unavailable.mp3'), false);
  assert.strictEqual(status.textContent, 'Waveform unavailable — timeline still works');
  assert.strictEqual(status.hidden, false);

  assert(page.includes('assets/js/bbc-waveform.js?v=20260830-2'), 'BBC page should load the waveform controller');
  assert(page.includes('id="waveform-viewport"'), 'BBC page should contain the accessible waveform timeline');
  assert(page.includes('id="waveform-zoom-in"') && page.includes('id="waveform-zoom-out"'), 'BBC page should expose zoom controls');
  assert(!page.includes('id="identity-status"'), 'BBC player should not render a student-name field');
  assert(page.includes('has-two-tools'), 'Mobile lesson tools should expose a stable two-capsule layout hook');
  assert(!page.includes("progressWrap.addEventListener('mousedown'"), 'Legacy viewport-relative seeking should be removed');
  assert(page.includes('bbcWaveform.load(data.audioSrc)'), 'Waveform should decode the same audio source used by the player');

  console.log('BBC waveform contract checks passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
