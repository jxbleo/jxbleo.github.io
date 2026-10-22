"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const shared = require("../cloudfunctions/_shared/personal-vocabulary-items");

// Exercise the authenticated function entry point against isolated in-memory rows.
const rows = {
  students: [
    { auth_uid: "student-a", student_id: "a", active: true, role: "student" },
    { auth_uid: "student-b", student_id: "b", active: true, role: "student" },
    { auth_uid: "teacher", active: true, role: "teacher" },
    { auth_uid: "inactive", active: false, role: "student" },
  ],
  student_vocabulary_items: [],
  vocabulary_lexicon: [],
  vocabulary_test_sessions: [],
};
let uid = "student-a";
let failWrite = false;
const writes = [];
const db = {
  collection(name) {
    assert(name in rows, `unexpected collection: ${name}`);
    const collection = {
      where(filter) {
        return {
          limit() { return this; },
          async get() { return { data: rows[name].filter(row => Object.entries(filter).every(([key, value]) => row[key] === value)).map(row => ({ ...row })) }; },
        };
      },
      doc(id) {
        return {
          async update(update) {
            if (failWrite) throw new Error("SIMULATED_WRITE_FAILURE");
            const row = rows[name].find(item => item._id === id);
            assert(row, "update must target an existing row");
            Object.assign(row, update);
            writes.push(name);
          },
        };
      },
      async add(record) {
        if (failWrite) throw new Error("SIMULATED_WRITE_FAILURE");
        assert(!record.data, "database fields must be top-level");
        rows[name].push({ ...record, _id: `row-${rows[name].length + 1}` });
        writes.push(name);
      },
    };
    return collection;
  },
};
const sandbox = {
  exports: {},
  require(name) {
    if (name === "@cloudbase/node-sdk") return { init: () => ({ database: () => db, auth: () => ({ getUserInfo: async () => ({ uid }) }) }) };
    if (name === "../_shared/personal-vocabulary-items") return shared;
    if (name === "crypto") return require("node:crypto");
    throw new Error(`Unexpected dependency: ${name}`);
  },
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../cloudfunctions/studentVocabulary/index.js"), "utf8"), sandbox);
const call = sandbox.exports.main;
const add = (personal_note, extra = {}) => call({ action: "add", text: "remarkable", context: "A remarkable result.", personal_note, ...extra });

async function main() {
  let result = await add("  我的联想\nkeep  two spaces  ", { student_uid: "student-b", auth_uid: "student-b" });
  assert(result.success && result.created);
  assert.equal(result.word.personal_note, "我的联想\nkeep  two spaces");
  assert.equal(rows.student_vocabulary_items[0].student_uid, "student-a", "ownership must come from authentication");
  assert.equal(result.word.dictionary, null, "notes save before dictionary enrichment");

  result = await add("搭配：remarkable progress");
  const combined = "我的联想\nkeep  two spaces\n\n搭配：remarkable progress";
  assert.equal(result.word.personal_note, combined);
  assert.equal(rows.student_vocabulary_items.length, 1);
  assert.equal(result.word.times_added, 2);
  for (const note of ["搭配：remarkable progress", undefined, "", " \n "]) {
    result = await add(note);
    assert.equal(result.word.personal_note, combined, "retries and empty notes must preserve existing text");
  }
  result = await call({ action: "updateNote", vocab_id: result.word.vocab_id, personal_note: "edited later" });
  assert.equal(result.word.personal_note, "edited later", "the existing detail editor must remain usable");

  result = await add("x".repeat(500), { text: "limit" });
  assert.equal(result.word.personal_note.length, 500);
  const before = JSON.stringify(rows.student_vocabulary_items);
  result = await add("another note", { text: "limit", context: "must not overwrite context" });
  assert.equal(result.code, "NOTE_LIMIT_REACHED");
  assert.match(result.message, /500/);
  assert.equal(JSON.stringify(rows.student_vocabulary_items), before, "overflow must not partially change the word, note, source or counters");
  result = await add("x".repeat(501), { text: "too long" });
  assert.equal(result.code, "NOTE_TOO_LONG");
  assert.equal(JSON.stringify(rows.student_vocabulary_items), before);
  result = await add(undefined, { text: "legacy" });
  assert.equal(result.word.personal_note, "", "legacy and Scan callers may omit notes");

  failWrite = true;
  result = await add("retry me", { text: "retry" });
  assert.equal(result.success, false);
  assert(!rows.student_vocabulary_items.some(row => row.text === "retry"));
  failWrite = false;
  result = await add("retry me", { text: "retry" });
  assert.equal(result.word.personal_note, "retry me");

  uid = "student-b";
  result = await add("another student's note");
  assert.equal(result.word.personal_note, "another student's note");
  assert.equal(rows.student_vocabulary_items.find(row => row.student_uid === "student-a").personal_note, "edited later");
  for (const [identity, expected] of [["", "AUTH_REQUIRED"], ["teacher", "STUDENT_REQUIRED"], ["inactive", "STUDENT_NOT_LINKED"]]) {
    uid = identity;
    const count = writes.length;
    assert.equal((await add("blocked")).code, expected);
    assert.equal(writes.length, count);
  }
  assert(writes.every(name => name === "student_vocabulary_items"), "personal notes must never write to shared dictionaries or other collections");
  console.log("My Words note persistence, limits, retry and ownership tests passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
