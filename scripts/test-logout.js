#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const authSource = fs.readFileSync(path.join(root, 'assets/js/auth.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(root, 'assets/js/dashboard.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(options = {}) {
  let now = 0, timerId = 0, sdkCalls = 0, click;
  let signedIn = options.signedIn !== false;
  const timers = new Map();
  const redirects = [];
  const removed = [];
  const elements = {};
  function element(id) {
    return elements[id] ||= {
      hidden: false, disabled: false, textContent: '', attributes: {},
      addEventListener(type, handler) { if (id === 'logout-confirm-submit') click = handler; },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; }, focus() {}
    };
  }
  const window = {
    setTimeout(fn, delay) { timers.set(++timerId, { fn, at: now + delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { fn(); },
    location: { replace(url) { redirects.push(url); } },
    MrCatCloud: {
      getLoginState() {
        return options.getLoginState ? options.getLoginState() : Promise.resolve(signedIn ? { user: {} } : null);
      },
      signOut() {
        sdkCalls++;
        const operation = options.signOut ? options.signOut() : Promise.resolve({ error: null });
        return operation.then(result => {
          if (!result || !result.error) signedIn = false;
          return result;
        });
      }
    },
    indexedDB: {
      deleteDatabase(name) {
        assert.equal(name, 'mrcat-student-dashboard-v1');
        if (options.cache === 'throws') throw new Error('Storage denied');
        const request = {};
        if (options.cache !== 'pending') Promise.resolve().then(() => {
          request[options.cache === 'blocked' ? 'onblocked' : options.cache === 'error' ? 'onerror' : 'onsuccess']();
        });
        return request;
      }
    }
  };
  if (options.cache === 'getter-throws') Object.defineProperty(window, 'indexedDB', { get() { throw new Error('Access denied'); } });
  if (options.cache === 'absent') delete window.indexedDB;
  const context = vm.createContext({
    window,
    document: { getElementById: element },
    localStorage: { removeItem(key) { removed.push(key); if (options.storageThrows) throw new Error('Storage denied'); } },
    sessionStorage: { removeItem(key) { removed.push(key); if (options.storageThrows) throw new Error('Storage denied'); } },
    logoutPending: false,
    logoutConfirmOverlay: element('logout-confirm-overlay'),
    logoutConfirmSubmit: element('logout-confirm-submit'),
    logoutConfirmCancel: element('logout-confirm-cancel'),
    accountPanel: element('account-panel'), identityChip: element('identity-chip'),
    setAccountPanel() {}
  });
  vm.runInContext(authSource, context);
  // Execute the shipped modal functions and event handler, not a test copy.
  const openStart = dashboardSource.indexOf('    function setLogoutConfirmOpen(');
  const openEnd = dashboardSource.indexOf('    function taskCard(', openStart);
  vm.runInContext(dashboardSource.slice(openStart, openEnd), context);
  const clickStart = dashboardSource.indexOf('    if (logoutConfirmSubmit) {\n');
  const clickEnd = dashboardSource.indexOf('    if (messageButton)', clickStart);
  vm.runInContext(dashboardSource.slice(clickStart, clickEnd), context);
  context.openLogoutConfirmDialog();
  return {
    window, context, elements, redirects, removed,
    click: () => click(), sdkCalls: () => sdkCalls,
    async advance(ms) {
      await flush();
      now += ms;
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await flush();
    }
  };
}

function assertReady(f) {
  assert.equal(f.context.logoutPending, false);
  assert.equal(f.elements['logout-confirm-submit'].disabled, false);
  assert.equal(f.elements['logout-confirm-cancel'].disabled, false);
  assert.equal(f.elements['logout-confirm-submit'].textContent, 'Log out');
  assert.equal(f.elements['logout-confirm-overlay'].attributes['aria-busy'], undefined);
}

(async () => {
  for (const cache of ['normal', 'blocked', 'error', 'throws', 'getter-throws', 'absent', 'pending']) {
    const f = fixture({ cache, storageThrows: cache === 'throws' });
    f.click();
    await flush();
    if (cache === 'pending') {
      assert.deepEqual(f.redirects, []);
      await f.advance(1000);
    }
    assert.deepEqual(f.redirects, ['index.html'], cache);
    assert(f.removed.includes('mrcat_student_profile'));
    assert(f.removed.includes('mrcat_my_words_first_page_v1'));
    assertReady(f);
  }

  for (const failure of ['throws', 'rejects', 'result-error']) {
    let fail = true;
    const f = fixture({ signOut() {
      if (!fail) return Promise.resolve({ error: null });
      if (failure === 'throws') throw new Error('SDK failed');
      if (failure === 'rejects') return Promise.reject(new Error('Network failed'));
      return Promise.resolve({ data: {}, error: { message: 'SDK reported failure' } });
    } });
    f.click();
    await flush();
    assertReady(f);
    assert.deepEqual(f.redirects, [], failure + ' must not masquerade as a completed logout');
    assert.deepEqual(f.removed, [], 'Keep identity until SDK confirms sign-out');
    assert.match(f.elements['logout-confirm-message'].textContent, /Unable to log out/);
    f.context.setLogoutConfirmOpen(false, false);
    f.context.openLogoutConfirmDialog();
    assertReady(f);
    assert.match(f.elements['logout-confirm-message'].textContent, /Your progress is saved/);
    fail = false;
    f.click();
    await flush();
    assert.deepEqual(f.redirects, ['index.html'], 'Retry succeeds');
  }

  const pending = deferred();
  const f = fixture({ signOut: () => pending.promise });
  f.click(); f.click();
  await flush();
  assert.equal(f.sdkCalls(), 1);
  assert.equal(f.elements['logout-confirm-cancel'].disabled, true);
  f.context.setLogoutConfirmOpen(false, false);
  assert.equal(f.elements['logout-confirm-overlay'].hidden, false, 'Do not dismiss a running logout');
  await f.advance(6999);
  assert.equal(f.context.logoutPending, true);
  await f.advance(1);
  assertReady(f);
  assert.match(f.elements['logout-confirm-message'].textContent, /taking too long/);
  assert.deepEqual(f.redirects, []);
  f.click();
  await flush();
  assert.equal(f.sdkCalls(), 1, 'A retry reuses the still-running SDK operation');
  await f.advance(7000);
  assertReady(f);
  pending.resolve({ error: null });
  await flush();
  assert.deepEqual(f.redirects, [], 'A late response must not navigate after the timeout');
  f.click();
  await flush();
  assert.deepEqual(f.redirects, ['index.html'], 'Retry recognizes the late completed sign-out');
  assert.equal(f.sdkCalls(), 1);

  const alreadyOut = fixture({ signedIn: false });
  alreadyOut.click();
  await flush();
  assert.deepEqual(alreadyOut.redirects, ['index.html']);
  assert.equal(alreadyOut.sdkCalls(), 0);

  const preflight = fixture({ getLoginState: () => new Promise(() => {}) });
  preflight.click();
  await preflight.advance(7000);
  assertReady(preflight);
  assert.equal(preflight.sdkCalls(), 0);
  assert.deepEqual(preflight.redirects, []);

  const direct = fixture();
  const first = direct.window.MrCatAuth.logout();
  assert.strictEqual(first, direct.window.MrCatAuth.logout(), 'Concurrent callers share a logout');
  await first;
  assert.equal(direct.sdkCalls(), 1);
  assert.deepEqual(direct.redirects, ['index.html']);

  const broken = fixture();
  broken.window.MrCatAuth.logout = () => { throw new Error('Unexpected synchronous failure'); };
  broken.click();
  await flush();
  assertReady(broken);
  assert.match(broken.elements['logout-confirm-message'].textContent, /Unexpected synchronous failure/);

  console.log('Logout tests passed: SDK errors/timeouts, storage failures, modal recovery, retries, concurrency and late responses.');
})().catch(error => { console.error(error); process.exitCode = 1; });
