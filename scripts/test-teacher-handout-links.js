'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const functionDirectory = path.resolve(__dirname, '../cloudfunctions/teacherHandoutLinks');
const source = fs.readFileSync(path.join(functionDirectory, 'index.js'), 'utf8');
const fixtureLink = 'h-' + 'a'.repeat(48) + '.html';
const fixtureItem = { id: 'writing-module-09', category: 'study', title: 'Test handout', topic: 'Writing', description: 'Synthetic fixture only', access: '链接持有人可阅读', href: fixtureLink };
const fixtureCatalog = { schemaVersion: 1, items: [fixtureItem] };

function harness(options = {}) {
    const state = { authCalls: 0, queryCalls: 0, fileReads: 0, query: null };
    const uid = Object.prototype.hasOwnProperty.call(options, 'uid') ? options.uid : 'teacher-fixture';
    const profiles = options.profiles || [{ auth_uid: 'teacher-fixture', role: 'teacher', active: true }];
    const app = {
        auth: () => ({ getUserInfo: async () => { state.authCalls++; return { uid }; } }),
        database: () => ({ collection(name) {
            assert.equal(name, 'students');
            return { where(query) {
                state.query = JSON.parse(JSON.stringify(query));
                assert.deepEqual(state.query, { auth_uid: String(uid), active: true, role: 'teacher' });
                return { limit(n) {
                    assert.equal(n, 1);
                    return { get: async () => {
                        state.queryCalls++;
                        if (options.databaseError) throw new Error(options.databaseError);
                        return { data: profiles.filter(profile => Object.entries(query).every(([key, value]) => profile[key] === value)).slice(0, n) };
                    } };
                } };
            } };
        } }),
    };
    const exports = {};
    const fakeFs = { readFileSync(file, encoding) {
        state.fileReads++;
        assert.equal(state.authCalls, state.fileReads, 'Every private catalog read follows a fresh authentication check');
        assert.equal(state.queryCalls, state.fileReads, 'Every private catalog read follows a fresh teacher profile check');
        assert.equal(file, path.join(functionDirectory, 'handout-links.private.json'));
        assert.equal(encoding, 'utf8');
        if (options.missing) throw new Error('ENOENT private-config-path ' + fixtureLink);
        if (options.raw !== undefined) return options.raw;
        return JSON.stringify(options.catalog || fixtureCatalog);
    } };
    vm.runInNewContext(source, { exports, __dirname: functionDirectory, require(name) {
        if (name === 'fs') return fakeFs;
        if (name === 'path') return path;
        if (name === '@cloudbase/node-sdk') return { SYMBOL_CURRENT_ENV: 'current', init: () => app };
        throw new Error('Unexpected dependency: ' + name);
    } }, { filename: 'teacherHandoutLinks/index.js' });
    return { state, main: async event => JSON.parse(JSON.stringify(await exports.main(event))) };
}

function assertDenied(response, code) {
    assert.equal(response.success, false);
    assert.equal(response.code, code);
    assert.equal(Object.prototype.hasOwnProperty.call(response, 'items'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(response, 'href'), false);
    const serialized = JSON.stringify(response);
    assert.ok(!serialized.includes(fixtureLink));
    assert.ok(!serialized.includes('private-config-path'));
    assert.ok(!serialized.includes('handout-links.private.json'));
}

async function main() {
    const teacherProfiles = [{ auth_uid: 'teacher-fixture', role: 'teacher', active: true }];
    const activeTeacher = harness({ profiles: teacherProfiles });
    assert.deepEqual(await activeTeacher.main({ action: 'list' }), { success: true, schemaVersion: 1, items: [fixtureItem] });
    assert.equal(activeTeacher.state.fileReads, 1);
    assert.equal((await activeTeacher.main({ action: 'list' })).success, true);
    teacherProfiles[0].active = false;
    assertDenied(await activeTeacher.main({ action: 'list' }), 'TEACHER_REQUIRED');
    assert.equal(activeTeacher.state.authCalls, 3, 'Authentication is checked again on every invocation');
    assert.equal(activeTeacher.state.fileReads, 2, 'Disabling a teacher prevents subsequent directory reads');

    for (const options of [
        { uid: null },
        { uid: 'student-fixture', profiles: [{ auth_uid: 'student-fixture', role: 'student', active: true }] },
        { profiles: [{ auth_uid: 'teacher-fixture', role: 'teacher', active: false }] },
        { profiles: [] },
    ]) {
        const run = harness(options);
        assertDenied(await run.main({ action: 'list', role: 'teacher', active: true, auth_uid: 'teacher-fixture', uid: 'teacher-fixture' }), options.uid === null ? 'AUTH_REQUIRED' : 'TEACHER_REQUIRED');
        assert.equal(run.state.fileReads, 0, 'Unauthorized callers must not read the private catalog');
    }
    for (const action of [undefined, 'manifest', 'get', 'LIST', 'list ']) {
        const run = harness();
        assertDenied(await run.main({ action }), 'INVALID_ACTION');
        assert.equal(run.state.fileReads, 0, 'Unsupported actions must not read the private catalog');
    }
    const anonymousUnknown = harness({ uid: null });
    assertDenied(await anonymousUnknown.main({ action: 'unknown', role: 'teacher' }), 'AUTH_REQUIRED');
    assert.equal(anonymousUnknown.state.queryCalls, 0);

    for (const options of [
        { missing: true },
        { raw: '{invalid json' },
        { catalog: { schemaVersion: 2, items: [] } },
        { catalog: { schemaVersion: 1, items: [fixtureItem, fixtureItem] } },
        { catalog: { schemaVersion: 1, items: [{ ...fixtureItem, href: 'dse-writing-course.html' }] } },
        { catalog: { schemaVersion: 1, items: [{ ...fixtureItem, href: 'https://example.com/' + fixtureLink }] } },
        { catalog: { schemaVersion: 1, items: [{ ...fixtureItem, href: fixtureLink + '?token=bad' }] } },
        { catalog: { schemaVersion: 1, items: [{ ...fixtureItem, category: 'information' }] } },
        { catalog: { schemaVersion: 1, items: [{ ...fixtureItem, title: '' }] } },
        { databaseError: 'private-config-path ' + fixtureLink },
    ]) {
        assertDenied(await harness(options).main({ action: 'list' }), 'LINKS_UNAVAILABLE');
    }
    const extraFields = harness({ catalog: { schemaVersion: 1, items: [{ ...fixtureItem, private_notes: 'not for clients', source: 'internal/source.html' }] } });
    assert.deepEqual((await extraFields.main({ action: 'list' })).items, [fixtureItem], 'Only the documented teacher directory fields are returned');
    console.log('Teacher handout links passed: authenticated active teacher only, spoof resistance, read-only profile lookup, strict action and opaque URL validation, private-config failure redaction.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
