const assert = require("assert");
const editions = require("../assets/js/content-editions.js");

const original = {
  set_id: "BBC-250904",
  title: "The Joys of Writing Lists",
  edition_family: "BBC-250904",
  edition_number: 1,
  edition_label: "V1",
  is_latest_edition: false,
};
const revision = {
  set_id: "BBC-250904-V2",
  title: "The Joys of Writing Lists",
  edition_family: "BBC-250904",
  edition_number: 2,
  edition_label: "V2",
  is_latest_edition: true,
};
const unrelated = { set_id: "BBC-250911", title: "Another lesson" };

const groups = editions.group([original, unrelated, revision]);
assert.strictEqual(groups.length, 2);
const versioned = groups.find((group) => group.family === "BBC-250904");
assert(versioned);
assert.strictEqual(versioned.versioned, true);
assert.deepStrictEqual(versioned.editions.map((item) => item.set_id), ["BBC-250904-V2", "BBC-250904"]);
assert.strictEqual(versioned.representative.set_id, "BBC-250904-V2");
assert.strictEqual(editions.tag(revision), "V2 (latest)");
assert.strictEqual(editions.tag(original), "V1 (previous)");

const single = groups.find((group) => group.family === "BBC-250911");
assert(single);
assert.strictEqual(single.versioned, false);
assert.strictEqual(single.representative, unrelated);

console.log("Content edition tests passed.");
