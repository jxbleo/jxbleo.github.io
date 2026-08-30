#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const lab = require("../cloudfunctions/_shared/speaking-lab");

const file = path.join(__dirname, "..", "content", "speaking", "dse-paper4-sets.json");
const staticBuildSource = fs.readFileSync(path.join(__dirname, "build-static-site.js"), "utf8");
const deployWorkflowSource = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "deploy-cos.yml"), "utf8");
const expected = [
  ["dse-p4-mock-2019-screen-time-controls-for-teenagers", 2019, null, "Screen-time Controls for Teenagers", "Apple Screen Control", "Parent–Teacher Association"],
  ["dse-p4-mock-2019-translation-apps-and-language-learning", 2019, null, "Translation Apps and Language Learning", "Translation Apps", "Use Translation Apps Wisely"],
  ["dse-p4-mock-2023-4-1-wearable-smart-devices", 2023, "4.1", "Wearable Smart Devices", "Wearable smart devices", "project on wearable technology"],
  ["dse-p4-mock-2024-1-1-digital-museums", 2024, "1.1", "Digital Museums", "Digital museum", "local museum attract more teenage visitors"],
  ["dse-p4-mock-2025-1-3-smartphones-replacing-personal-computers", 2025, "1.3", "Smartphones Replacing Personal Computers", "As PC ownership declines, smartphones are on the rise", "reviewing its technology budget"],
];

function run() {
  const raw = fs.readFileSync(file, "utf8");
  const sets = JSON.parse(raw);
  assert.equal(sets.length, 5, "the initial seed contains exactly five Sets");
  sets.forEach((set, index) => {
    const normalized = lab.normalizeSpeakingSetInput(set);
    const [id, year, version, title, sourcePhrase, taskPhrase] = expected[index];
    assert.equal(normalized.set_id, id);
    assert.equal(normalized.source_kind, "mock");
    assert.equal(normalized.exam_year, year);
    assert.equal(normalized.paper_version, version);
    assert.equal(normalized.title, title);
    assert.equal(normalized.content_revision, 2);
    assert.match(normalized.source_note, new RegExp(sourcePhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(normalized.part_a.task, new RegExp(taskPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(normalized.part_a.discussion_points.length, 4);
    assert.equal(normalized.part_b.questions.length, 8);
    assert.deepEqual(normalized.part_a.discussion_points.map((row) => row.point_id), ["pa_01", "pa_02", "pa_03", "pa_04"]);
    assert.deepEqual(normalized.part_b.questions.map((row) => row.question_id), ["ir_01", "ir_02", "ir_03", "ir_04", "ir_05", "ir_06", "ir_07", "ir_08"]);
    assert.ok(normalized.context.body.length > 0 && normalized.context.body.every(Boolean));
    assert.ok(normalized.part_b.questions.every((row) => row.text));
    const prompt = lab.partACompatibilityPrompt(normalized);
    assert.ok(prompt.indexOf("TASK " + normalized.part_a.task) > prompt.indexOf(normalized.context.title));
    assert.ok(prompt.indexOf(normalized.part_a.instruction) > prompt.indexOf("TASK " + normalized.part_a.task));
    assert.ok(!/Viewpoint Bank|Useful language|60-second drill|Reusable Framework|Interaction Phrases|Self-check/i.test(raw));
    assert.equal(lab.speakingSetDisplayLabel(normalized), [
      `${year} MOCK`,
      version ? `Set ${version}` : null,
      title,
    ].filter(Boolean).join(" · "));
  });
  assert.match(staticBuildSource, /privateStaticPrefixes\s*=\s*\["content\/speaking"\]/, "Speaking Set source must stay outside the public static build");
  assert.match(deployWorkflowSource, /test ! -e dist\/content\/speaking/, "deployment must fail if private Speaking Set source enters dist");
  console.log("Speaking Set seed contracts passed.");
}

run();
