#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const navigationSource = fs.readFileSync(path.join(root, 'assets/js/login-navigation.js'), 'utf8');
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
  let currentHref = `https://jxbleo.github.io/index.html${query}`;
  const location = {
    origin: 'https://jxbleo.github.io',
    search: query,
    replace(target) {
      redirects.push(target);
    }
  };
  Object.defineProperty(location, 'href', {
    configurable: true,
    get() { return currentHref; },
    set(target) {
      currentHref = target;
      redirects.push(target);
    }
  });
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

  const sandbox = {
    window,
    document: { getElementById(id) { return elements[id]; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    URL,
    URLSearchParams,
    Math,
    Promise,
    Error
  };
  vm.createContext(sandbox);
  vm.runInContext(navigationSource, sandbox, { filename: 'assets/js/login-navigation.js' });
  vm.runInContext(loginSource, sandbox, { filename: 'assets/js/login.js' });

  await new Promise((resolve) => setImmediate(resolve));
  return redirects;
}

function loadNavigation(query = '', page = 'index.html') {
  const location = {
    href: `https://jxbleo.github.io/${page}${query}`,
    origin: 'https://jxbleo.github.io',
    pathname: `/${page}`,
    search: query,
    hash: ''
  };
  const window = { location };
  window.window = window;
  const sandbox = {
    window,
    URL,
    URLSearchParams
  };
  vm.createContext(sandbox);
  vm.runInContext(navigationSource, sandbox, { filename: 'assets/js/login-navigation.js' });
  return window.MrCatLoginNavigation;
}

async function main() {
  const navigation = loadNavigation();
  const preservedTarget = 'bbc.html?set=BBC-260813&assignment=assignment-1&return=dashboard.html%3Fview%3Dassignments&history=attempt-2&history_score=88&prefill=attempt-3&focus=Question_24&status=failed&entry=learn&report=report-1&teacher=1&user=legacy-user&visitor=1#Question_24';
  assert.strictEqual(
    navigation.safeTarget(preservedTarget, 'dashboard.html'),
    'bbc.html?set=BBC-260813&assignment=assignment-1&return=dashboard.html%3Fview%3Dassignments&history=attempt-2&history_score=88&prefill=attempt-3&focus=Question_24&status=failed&entry=learn&report=report-1&teacher=1#Question_24',
    'Redirect normalization must preserve exercise/report state and hashes while removing legacy identity parameters.'
  );
  assert.strictEqual(
    navigation.safeTarget('https://evil.example/lesson.html', 'dashboard.html'),
    'dashboard.html',
    'External redirect targets must fall back to the safe destination.'
  );
  assert.strictEqual(
    navigation.safeTarget('//evil.example/lesson.html', 'dashboard.html'),
    'dashboard.html',
    'Protocol-relative external targets must be rejected.'
  );
  assert.strictEqual(
    navigation.safeTarget('javascript:alert(1)', 'dashboard.html'),
    'dashboard.html',
    'Protocol tricks must be rejected.'
  );
  assert.strictEqual(
    navigation.safeTarget('nested/lesson.html', 'dashboard.html'),
    'dashboard.html',
    'Nested paths are not valid login destinations.'
  );
  assert.strictEqual(
    navigation.safeTarget('index.html?return=dashboard.html', 'dashboard.html'),
    'dashboard.html',
    'The login page must not redirect back to itself.'
  );

  const nestedNavigation = loadNavigation(
    '?return=' + encodeURIComponent('reports.html?report=lr-weekly-2026-W31-class-a&focus=summary') + '&user=legacy&visitor=1'
  );
  assert.strictEqual(
    nestedNavigation.requestedTarget('dashboard.html'),
    'reports.html?report=lr-weekly-2026-W31-class-a&focus=summary',
    'Nested return values must preserve their inner query and hash-safe destination.'
  );
  assert.strictEqual(
    nestedNavigation.loginHref('reports.html?report=private&user=legacy#summary', 'dashboard.html'),
    'index.html?return=' + encodeURIComponent('reports.html?report=private#summary'),
    'loginHref must create one normalized login return link.'
  );

  const currentNavigation = loadNavigation('?set=BBC-260813&user=legacy&visitor=1#Question_24', 'bbc.html');
  assert.strictEqual(
    currentNavigation.currentTarget('dashboard.html'),
    'bbc.html?set=BBC-260813#Question_24',
    'currentTarget must normalize the current page without legacy identity parameters.'
  );

  assert.deepStrictEqual(await runLogin({ mode: 'none', profile: null }), [], 'Signed-out visitors must remain on the login form.');
  assert.deepStrictEqual(await runLogin({ mode: 'visitor', profile: null }), [], 'Visitor sessions must remain on the login form.');
  assert.deepStrictEqual(await runLogin(new Error('Stale CloudBase session')), [], 'Invalid sessions must not bounce away from the login form.');
  assert.deepStrictEqual(
    await runLogin({ mode: 'student', profile: { role: 'student' } }),
    ['hk8-dse-jupas-weighting-report-2026-27.html'],
    'Verified students should return to the requested report.'
  );
  assert.deepStrictEqual(
    await runLogin(
      { mode: 'student', profile: { role: 'student' } },
      '?return=reports.html%3Freport%3Dlr-weekly-2026-W31-class-a'
    ),
    ['reports.html?report=lr-weekly-2026-W31-class-a'],
    'Learning-report links must preserve their report locator after sign-in.'
  );
  assert.deepStrictEqual(
    await runLogin({ mode: 'teacher', profile: { role: 'teacher' } }, ''),
    ['teacher.html'],
    'Verified teachers should return to the teacher page by default.'
  );

  const scriptOrderChecks = [
    ['index.html', 'assets/js/login.js'],
    ['dashboard.html', 'assets/js/dashboard.js'],
    ['my-words.html', 'assets/js/my-words.js'],
    ['attempt-review.html', 'assets/js/attempt-review.js'],
    ['bbc.html', 'assets/js/practice-session.js'],
    ['ielts-reading.html', 'assets/js/practice-session.js'],
    ['ielts-listening.html', 'assets/js/practice-session.js'],
    ['vocabulary.html', 'assets/js/practice-session.js']
  ];
  scriptOrderChecks.forEach(([page, dependentScript]) => {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    const helperIndex = source.indexOf('assets/js/login-navigation.js?v=20260819-1');
    const dependentIndex = source.indexOf(dependentScript);
    assert(helperIndex >= 0, page + ' must load the shared login navigation helper.');
    assert(dependentIndex > helperIndex, page + ' must load the helper before ' + dependentScript + '.');
  });

  const librarySource = fs.readFileSync(path.join(root, 'library.html'), 'utf8');
  assert(
    librarySource.includes('assets/js/login-navigation.js?v=20260819-1'),
    'Public Library must load the shared login navigation helper.'
  );
  [
    ['bbc.html', /bbc-custom-id-input|bbc-custom-login-btn|bbc-saved-identity-btn/],
    ['ielts-reading.html', /ielts-custom-id-input|ielts-custom-login-btn|ielts-saved-identity-btn/],
    ['library.html', /custom-id-input|custom-login-btn|saved-identity-btn/]
  ].forEach(([page, legacyPattern]) => {
    const source = fs.readFileSync(path.join(root, page), 'utf8');
    assert(!legacyPattern.test(source), page + ' must not retain a second Student ID login surface.');
  });

  console.log('Login redirect checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
