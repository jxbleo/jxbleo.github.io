#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/screen-wake-lock.js'), 'utf8');
const flush = () => new Promise(setImmediate);
function fixture(mode = 'normal') {
    const handlers = new Set(), locks = [], requests = [];
    let resolve, reject;
    const document = { visibilityState: 'visible', addEventListener(event, fn) { assert.equal(event, 'visibilitychange'); handlers.add(fn); }, removeEventListener(event, fn) { handlers.delete(fn); } };
    function lock() {
        const callbacks = [];
        const item = { released: false, releases: 0, addEventListener(event, fn) { assert.equal(event, 'release'); callbacks.push(fn); }, release() { this.releases++; this.released = true; callbacks.forEach(fn => fn()); return Promise.resolve(); } };
        locks.push(item); return item;
    }
    const navigator = mode === 'unsupported' ? {} : { wakeLock: { request(type) {
        requests.push(type);
        if (mode === 'denied') return Promise.reject(new Error('NotAllowedError'));
        if (mode === 'throws') throw new Error('NotAllowedError');
        if (mode === 'pending') return new Promise((yes, no) => { resolve = () => yes(lock()); reject = no; });
        return Promise.resolve(lock());
    } } };
    const window = {};
    vm.runInNewContext(source, { window, navigator, document });
    return { controller: window.MrCatScreenWakeLock.create(), requests, locks, handlers,
        visibility(value) { document.visibilityState = value; [...handlers].forEach(fn => fn()); }, resolve() { resolve(); }, reject() { reject(new Error('Denied')); } };
}
(async () => {
    const f = fixture();
    assert.equal(f.requests.length, 0);
    f.controller.setActive(true); f.controller.setActive(true); await flush();
    assert.deepEqual(f.requests, ['screen']);
    f.visibility('hidden'); await flush(); assert.equal(f.locks[0].releases, 1);
    f.visibility('visible'); await flush(); assert.equal(f.requests.length, 2);
    f.locks[1].release(); await flush(); assert.equal(f.requests.length, 2, 'no retry loop after system revocation');
    f.visibility('hidden'); f.visibility('visible'); await flush(); assert.equal(f.requests.length, 3);
    f.controller.setActive(false); await flush(); assert.equal(f.locks[2].releases, 1); assert.equal(f.handlers.size, 0);
    f.visibility('visible'); await flush(); assert.equal(f.requests.length, 3);
    f.controller.setActive(true); await flush(); f.controller.destroy(); await flush();
    assert.equal(f.locks[3].releases, 1); assert.equal(f.handlers.size, 0);
    f.controller.setActive(true); await flush(); assert.equal(f.requests.length, 4);
    for (const mode of ['unsupported', 'denied', 'throws']) {
        const g = fixture(mode); g.controller.setActive(true); await flush();
        assert.equal(g.requests.length, mode === 'unsupported' ? 0 : 1);
        g.controller.destroy(); assert.equal(g.handlers.size, 0);
    }
    for (const action of ['stop', 'destroy', 'hide']) {
        const g = fixture('pending'); g.controller.setActive(true); await flush();
        if (action === 'stop') g.controller.setActive(false);
        if (action === 'destroy') g.controller.destroy();
        if (action === 'hide') g.visibility('hidden');
        g.resolve(); await flush(); assert.equal(g.locks[0].releases, 1, 'late grant released after ' + action);
        g.controller.destroy();
    }
    const race = fixture('pending'); race.controller.setActive(true); await flush();
    race.controller.setActive(false); race.controller.setActive(true); race.resolve(); await flush();
    assert.equal(race.locks[0].releases, 1); assert.equal(race.requests.length, 2);
    race.resolve(); await flush(); race.controller.destroy(); await flush(); assert.equal(race.locks[1].releases, 1);
    const background = fixture(); background.visibility('hidden'); background.controller.setActive(true); await flush();
    assert.equal(background.requests.length, 0); background.visibility('visible'); await flush(); assert.equal(background.requests.length, 1); background.controller.destroy();
    for (const name of ['speaking-lab.html', 'teacher.html']) {
        const html = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
        assert(html.indexOf('screen-wake-lock.js') >= 0);
        assert(html.indexOf('screen-wake-lock.js') < html.indexOf('speaking-recorder.js'));
    }
    console.log('Screen wake lock: lifecycle, visibility, denial, system release, pending races, cleanup and script order passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
