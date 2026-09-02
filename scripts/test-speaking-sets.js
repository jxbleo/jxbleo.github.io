#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const lab = require("../cloudfunctions/_shared/speaking-lab");

const root = path.join(__dirname, "..");
const file = path.join(root, "content", "speaking", "dse-paper4-sets.json");
const staticBuildSource = fs.readFileSync(path.join(__dirname, "build-static-site.js"), "utf8");
const deployWorkflowSource = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-cos.yml"), "utf8");
const frontendSource = fs.readFileSync(path.join(root, "assets", "js", "speaking-lab.js"), "utf8");
const teacherSource = fs.readFileSync(path.join(root, "assets", "js", "teacher-speaking.js"), "utf8");
const serviceSource = fs.readFileSync(path.join(root, "cloudfunctions", "speakingLab", "index.js"), "utf8");

function wordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function run() {
  const raw = fs.readFileSync(file, "utf8");
  const sets = JSON.parse(raw);
  const pp = sets.filter((set) => set.source_kind === "pp");
  const mocks = sets.filter((set) => set.source_kind === "mock");
  const visible = sets.filter((set) => set.visible_to_students === true);
  const identities = new Set(pp.map((set) => `${set.exam_year}:${set.paper_version}`));
  const ids = new Set(sets.map((set) => set.set_id));

  assert.equal(sets.length, 311, "the canonical source contains 306 PP Sets plus five retained MOCK Sets");
  assert.equal(pp.length, 306, "all 306 past-paper identities are present");
  assert.equal(mocks.length, 5, "the original five MOCK Sets remain available for historical snapshots");
  assert.equal(visible.length, 306, "only the 306 PP Sets are visible to students");
  assert.ok(mocks.every((set) => set.visible_to_students === false), "overlapping MOCK seeds are hidden, not deleted");
  assert.equal(identities.size, 306, "each year and paper version is unique");
  assert.equal(ids.size, sets.length, "every Speaking Set ID is unique");

  const yearCounts = pp.reduce((counts, set) => Object.assign(counts, { [set.exam_year]: (counts[set.exam_year] || 0) + 1 }), {});
  assert.deepEqual(yearCounts, { 2012: 24, 2013: 30, 2014: 30, 2015: 27, 2016: 27, 2017: 24, 2018: 24, 2019: 24, 2023: 24, 2024: 24, 2025: 24, 2026: 24 });

  const paragraphSet = new Set();
  const partBSignatures = new Set();
  sets.forEach((set) => {
    const normalized = lab.normalizeSpeakingSetInput(set);
    assert.equal(normalized.part_a.discussion_points.length, 4);
    assert.equal(normalized.part_b.questions.length, 8);
    assert.deepEqual(normalized.part_a.discussion_points.map((row) => row.point_id), ["pa_01", "pa_02", "pa_03", "pa_04"]);
    assert.deepEqual(normalized.part_b.questions.map((row) => row.question_id), ["ir_01", "ir_02", "ir_03", "ir_04", "ir_05", "ir_06", "ir_07", "ir_08"]);
    assert.ok(normalized.context.body.length > 0 && normalized.context.body.every(Boolean));
    assert.ok(normalized.part_b.questions.every((row) => row.text));
    assert.equal(lab.speakingSetDisplayLabel(normalized), [
      `${normalized.exam_year} ${normalized.source_kind.toUpperCase()}`,
      normalized.paper_version ? `Set ${normalized.paper_version}` : null,
      normalized.title,
    ].filter(Boolean).join(" · "));
    if (normalized.source_kind === "pp") {
      assert.match(normalized.set_id, /^dse-p4-pp-\d{4}-\d+-\d+-[a-z0-9-]+$/);
      assert.ok(wordCount(normalized.context.body.join(" ")) >= 115, `${normalized.set_id} has a substantive Context`);
      assert.match(normalized.source_note, /original|adapt/i);
      assert.doesNotMatch(JSON.stringify(normalized.part_b.questions), /in your (?:view|opinion)/i);
      assert.doesNotMatch(JSON.stringify(normalized), /,\s*\?|\s+\?/);
      normalized.context.body.forEach((paragraph) => {
        assert.ok(!paragraphSet.has(paragraph), `${normalized.set_id} does not reuse an identical Context paragraph`);
        paragraphSet.add(paragraph);
      });
      const signature = normalized.part_b.questions.map((row) => row.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).join("|");
      assert.ok(!partBSignatures.has(signature), `${normalized.set_id} has a unique Part B question list`);
      partBSignatures.add(signature);
    }
  });

  const sample2015 = pp.find((set) => set.exam_year === 2015 && set.paper_version === "9.1");
  const sample2016 = pp.find((set) => set.exam_year === 2016 && set.paper_version === "9.3");
  const sample2026 = pp.find((set) => set.exam_year === 2026 && set.paper_version === "4.2");
  const corrected2017 = pp.find((set) => set.exam_year === 2017 && set.paper_version === "4.1");
  assert.equal(sample2015.title, "YouTube Stars");
  assert.equal(sample2016.title, "Texting Lanes");
  assert.match(sample2026.source_note, /candidate-recall/i, "2026 carries an explicit recall-source warning");
  assert.equal(corrected2017.part_b.questions[0].text, "Do older people in your family enjoy singing?");
  assert.equal(corrected2017.part_b.questions[7].text, "Should retirement be something to look forward to or to worry about?");
  assert.ok(!/Viewpoint Bank|Useful language|60-second drill|Reusable Framework|Interaction Phrases|Self-check\b/i.test(raw));

  assert.match(staticBuildSource, /privateStaticPrefixes\s*=\s*\["content\/speaking"\]/, "Speaking Set source stays outside the public static build");
  assert.match(deployWorkflowSource, /test ! -e dist\/content\/speaking/, "deployment fails if private Speaking Set source enters dist");
  assert.match(serviceSource, /speakingSetSummaryView/, "Set lists return metadata summaries instead of 306 complete Contexts");
  assert.match(frontendSource, /speakingSetRenderLimit = 48/, "student Set cards render in bounded batches");
  assert.match(teacherSource, /teacherGetSpeakingSet/, "teacher editing fetches one complete Set on demand");
  console.log("Speaking Set library contracts passed: 306 PP visible, five historical MOCK Sets hidden.");
}

run();
