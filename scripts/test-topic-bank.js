"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {SOURCE, renderTopicBank, validateTopicBankHtml, validateBlueprint} = require("./render-topic-bank");
const {topicBankFixture} = require("./handout-test-fixture");
const {render: renderShareHeader} = require("./share-header");

const fixture = topicBankFixture();
const html = renderTopicBank({[SOURCE]: fixture});
assert(html.includes(renderShareHeader("handout")), "The direct reader must reuse the canonical toolbar.");
assert(validateTopicBankHtml(html));
assert.throws(() => renderTopicBank({}), /source is missing/);
for (const [label, mutate] of [
  ["missing viewpoint", value => value.replace('<p class="claim">', '<p>')],
  ["missing development", value => value.replace('class="development"', 'class="missing"')],
  ["missing task", value => value.replace('<li>Task one.</li>', '')],
  ["missing theme", value => value.replace('id="topic-20"', 'id="topic-21"')],
  ["broken local anchor", value => value.replace('href="#topic-01-sub-1-development"', 'href="#missing"')],
  ["external reference", value => value.replace('href="#topic-01-sub-1-development"', 'href="https://example.invalid/"')],
  ["legacy authentication", value => value.replace('</body>', '<script src="assets/js/auth.js"></script></body>')],
  ["legacy iframe", value => value.replace('</body>', '<iframe></iframe></body>')],
  ["print control", value => value.replace('</body>', '<button id="print-all">Print</button></body>')],
  ["wrong delivery", value => value.replace('direct-static', 'protected-srcdoc')],
  ["duplicate toolbar", value => value.replace('</body>', renderShareHeader('handout')+'</body>')],
]) {
  assert(!validateTopicBankHtml(mutate(html)), label + " must fail validation.");
}
assert(validateBlueprint('<main data-topic-bank-build-source></main>'));
assert(!validateBlueprint('<main>No marker</main>'));
assert(!validateBlueprint('<main data-topic-bank-build-source></main><iframe></iframe>'));

if (process.argv.includes("--source") || process.argv.includes("--artifact")) {
  const root=path.resolve(__dirname,"..");
  const release=require('./handout-store').loadRelease(root);
  const actual=renderTopicBank(release.files);
  assert(validateTopicBankHtml(actual));
  const base=process.argv.includes("--artifact")?path.join(root,'dist'):root;
  if (process.argv.includes("--artifact")) assert.equal(fs.readFileSync(path.join(base,'dse-topic-bank.html'),'utf8'),actual);
  else assert(validateBlueprint(fs.readFileSync(path.join(root,'dse-topic-bank.html'),'utf8')));
  const runtime=fs.readFileSync(path.join(base,'assets/js/dse-topic-bank.js'),'utf8');
  assert(!/getProtectedResource|cloudbase|MrcatAuth|sessionStorage|localStorage|indexedDB|fetch\s*\(/i.test(runtime), 'The direct topic reader must not fetch or cache an authenticated resource.');
}
console.log("Direct topic bank passed: complete 20/100/800/100 coverage, shared toolbar and no legacy access shell.");
