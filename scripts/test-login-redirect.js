#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const loginSource = fs.readFileSync(path.join(root, 'assets/js/login.js'), 'utf8');

function makeElement() {
  return {
    addEventListener() {},
    disabled: false,
    textContent: '',
    value: ''
  };
}

async function runLogin(sessionResult, query = '?return=hk8-dse-jupas-weighting-report-2026-27.html') {
  const elements = {
    'login-form': makeElement(),
    'student-id': makeElement(),
    password: makeElement(),
    'login-message': makeElement(),
    'login-button': makeElement(),
    'visitor-button': makeElement(),
    'login-motivational-quote': makeElement()
  };
  const redirects = [];
  const location = {
    href: `https://jxbleo.github.io/index.html${query}`,
    origin: 'https://jxbleo.github.io',
    search: query,
    replace(target) {
      redirects.push(target);
    }
  };
  const window = {
    location,
    MrCatAuth: {
      getSession() {
        return sessionResult instanceof Error
          ? Promise.reject(sessionResult)
          : Promise.resolve(sessionResult);
      },
      clearLocalIdentity() {},
      saveProfile() {},
      setVisitor() {}
    },
    MrCatCloud: {
      signIn() { return Promise.resolve(); },
      signOut() { return Promise.resolve(); },
      callFunction() { return Promise.resolve(); }
    }
  };
  window.window = window;

  vm.runInNewContext(loginSource, {
    window,
    document: { getElementById(id) { return elements[id]; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    URL,
    URLSearchParams,
    Math,
    Promise,
    Error
  }, { filename: 'assets/js/login.js' });

  await new Promise((resolve) => setImmediate(resolve));
  return redirects;
}

async function main() {
  assert.deepStrictEqual(await runLogin({ mode: 'none', profile: null }), [], 'Signed-out visitors must remain on the login form.');
  assert.deepStrictEqual(await runLogin({ mode: 'visitor', profile: null }), [], 'Visitor sessions must remain on the login form.');
  assert.deepStrictEqual(await runLogin(new Error('Stale CloudBase session')), [], 'Invalid sessions must not bounce away from the login form.');
  assert.deepStrictEqual(
    await runLogin({ mode: 'student', profile: { role: 'student' } }),
    ['hk8-dse-jupas-weighting-report-2026-27.html'],
    'Verified students should return to the requested report.'
  );
  assert.deepStrictEqual(
    await runLogin({ mode: 'teacher', profile: { role: 'teacher' } }, ''),
    ['teacher.html'],
    'Verified teachers should return to the teacher page by default.'
  );
  console.log('Login redirect checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
