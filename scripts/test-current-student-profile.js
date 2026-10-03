'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'cloudfunctions/getCurrentStudent/index.js'), 'utf8');

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

(async () => {
    const student = { auth_uid: 'trusted-uid', student_id: 'qa', name: '李Emily', chinese_name: ' 李 ', english_name: ' Emily ', role: 'student', internal_metadata: 'private' };
    const response = await getProfile(student);
    assert.equal(response.student.english_name, 'Emily');
    assert.equal(response.student.chinese_name, '李');
    assert.equal(response.student.internal_metadata, undefined);
    assert.equal((await getProfile({ student_id: 'qa', name: 'Legacy Emily' })).student.english_name, '');
    assert.equal((await getProfile(null)).success, false);
    assert.equal((await getProfile(student, '')).code, 'AUTH_REQUIRED');

    console.log('Current student profile projection: names, private fields, missing profile and trusted authentication passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
