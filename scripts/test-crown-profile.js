'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'cloudfunctions/getCurrentStudent/index.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'vocabulary.html'), 'utf8');
const client = html.slice(html.indexOf('function masteryCrownStudentId()'), html.indexOf('function showResultOverlay('));

async function getProfile(student, uid = 'trusted-uid') {
    const db = { collection(name) {
        return { where(query) {
            if (name === 'students') {
                assert.equal(query.auth_uid, uid);
                assert.equal(query.active, true);
            }
            return { limit() { return { get: async () => ({ data: name === 'students' && student ? [student] : [] }) }; } };
        } };
    } };
    const sdk = { init: () => ({ database: () => db, auth: () => ({ getUserInfo: async () => ({ uid }) }) }) };
    const context = { exports: {}, require(name) { assert.equal(name, '@cloudbase/node-sdk'); return sdk; } };
    vm.runInNewContext(backend, context);
    return context.exports.main({ auth_uid: 'untrusted-uid', student_id: 'someone-else' });
}

function crownClient(profileResponse, cached = { student_id: 'qa', name: 'Legacy whole name' }) {
    const storage = new Map([['mrcat_student_profile', JSON.stringify(cached)]]);
    const calls = [];
    const context = {
        teacherMode: false, params: new URLSearchParams(), identity: 'qa',
        currentUserId() { return context.identity; },
        localStorage: {
            getItem(key) { return storage.get(key) || null; },
            setItem(key, value) { storage.set(key, value); }
        },
        window: { MrCatCloud: { callAuthenticatedFunction(name) {
            calls.push(name); return typeof profileResponse === 'function' ? profileResponse() : Promise.resolve(profileResponse);
        } } }
    };
    vm.createContext(context); vm.runInContext(client, context);
    return { context, calls, storage };
}

(async () => {
    const student = { auth_uid: 'trusted-uid', student_id: 'qa', name: '李Emily', chinese_name: ' 李 ', english_name: ' Emily ', role: 'student', internal_metadata: 'private' };
    const response = await getProfile(student);
    assert.equal(response.student.english_name, 'Emily');
    assert.equal(response.student.chinese_name, '李');
    assert.equal(response.student.internal_metadata, undefined);
    assert.equal((await getProfile({ student_id: 'qa', name: 'Legacy Emily' })).student.english_name, '');
    assert.equal((await getProfile(null)).success, false);
    assert.equal((await getProfile(student, '')).code, 'AUTH_REQUIRED');

    const rendered = crownClient(response);
    const labels = {};
    const texts = [0, 1].map(() => ({ textContent: '', setAttribute() {}, getComputedTextLength() { return this.textContent.length * 60; } }));
    const svg = { isConnected: true, setAttribute(key, value) { labels[key] = value; }, querySelectorAll() { return texts; } };
    const overlay = { querySelector() { return { innerHTML: '', querySelector() { return svg; } }; } };
    rendered.context.document = {};
    rendered.context.addMasteryCrown(overlay);
    assert.equal(texts[1].textContent, '');
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.equal(texts[1].textContent, 'Emily');
    assert.equal(labels['aria-label'], 'Mastery crown for Emily');
    assert.deepEqual(rendered.calls, ['getCurrentStudent']);

    const closed = crownClient(response);
    closed.context.document = {};
    svg.isConnected = false;
    closed.context.addMasteryCrown(overlay);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.equal(texts[1].textContent, '');

    const oldCache = crownClient(response);
    assert.equal(oldCache.context.masteryCrownName(), '');
    assert.equal(await oldCache.context.refreshMasteryCrownName(), 'Emily');
    assert.equal(oldCache.context.masteryCrownName(), 'Emily');
    assert.deepEqual(oldCache.calls, ['getCurrentStudent']);

    const changedName = crownClient(response, { student_id: 'qa', english_name: 'Old' });
    assert.equal(await changedName.context.refreshMasteryCrownName(), 'Emily');
    const removedName = crownClient({ success: true, student: { student_id: 'qa', english_name: '' } }, { student_id: 'qa', english_name: 'Old' });
    assert.equal(await removedName.context.refreshMasteryCrownName(), '');
    assert.equal(removedName.context.masteryCrownName(), '');

    const networkFailure = crownClient(() => Promise.reject(new Error('offline')));
    assert.equal(await networkFailure.context.refreshMasteryCrownName(), null);
    const wrongAccount = crownClient({ success: true, student: { student_id: 'other', english_name: 'Other' } });
    assert.equal(await wrongAccount.context.refreshMasteryCrownName(), null);
    assert.equal(wrongAccount.context.masteryCrownName(), '');
    const oldServer = crownClient({ success: true, student: { student_id: 'qa', name: 'Legacy Emily' } });
    assert.equal(await oldServer.context.refreshMasteryCrownName(), null);
    for (const mode of ['teacher', 'visitor']) {
        const denied = crownClient(response);
        if (mode === 'teacher') denied.context.teacherMode = true;
        else denied.storage.set('mrcat_visitor', 'true');
        assert.equal(await denied.context.refreshMasteryCrownName(), null);
        assert.equal(denied.calls.length, 0);
    }
    let resolve;
    const raced = crownClient(() => new Promise(done => { resolve = done; }));
    const pending = raced.context.refreshMasteryCrownName();
    await Promise.resolve();
    raced.context.identity = 'another-login'; resolve(response);
    assert.equal(await pending, null);
    assert.equal(JSON.parse(raced.storage.get('mrcat_student_profile')).english_name, undefined);

    const blockedStorage = crownClient(response);
    blockedStorage.context.localStorage.setItem = () => { throw new Error('storage blocked'); };
    assert.equal(await blockedStorage.context.refreshMasteryCrownName(), 'Emily');
    console.log('Crown profile regression tests passed: real projection, old cache, renamed/missing names, auth, errors and identity race.');
})().catch(error => { console.error(error); process.exitCode = 1; });
