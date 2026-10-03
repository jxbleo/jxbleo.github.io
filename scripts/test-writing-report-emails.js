#!/usr/bin/env node
"use strict";
const assert = require("assert");
const reports = require("../cloudfunctions/_shared/writing-report-email");

async function main() {
  const rows = new Map();
  const db = { collection(name) {
    assert.strictEqual(name, "writing_teacher_email_events");
    return { doc(id) { return { async create(row) {
      if (rows.has(id)) throw new Error("DUPLICATE");
      rows.set(id, row);
    } }; } };
  } };
  const student = { auth_uid: "private-uid", student_id: "student-1", name: "Student" };
  const composition = {
    composition_id: "essay-1", title: "<Draft>", prompt_text: "Write about trees",
    confirmed_text: "Trees <grow>.", revision: 1, word_count: 2,
    standardized_review: { overall_score: "7", score_scale: "9", summary: "Strong opening",
      criteria: [{ name: "Content", score: "7", max_score: "9", rationale: "Clear ideas" }],
      strengths: ["Good idea"], priorities: [{ title: "Detail", evidence: "Short", action: "Expand" }] },
    language_review: { overview: "语言总评", cefr_estimate: { level: "B2", position: "upper", commentary_zh: "继续提高" },
      sentences: [{ sentence_id: "s1", original: "Trees <grow>.", rewrite_required: true,
        coaching_summary: "句子评语", issues: [{ category: "语法", span: "grow", explanation: "解释", suggestion: "建议" }],
        reference_revision: "Trees grow tall." }] },
  };
  await reports.enqueue(db, student, composition, "first", { usage_id: "u1" }, "general_language");
  await reports.enqueue(db, student, composition, "first", { usage_id: "u1" }, "general_language");
  assert.strictEqual(rows.size, 1);
  const first = [...rows.values()][0];
  const renderedFirst = reports.render(first);
  for (const phrase of ["Trees &lt;grow&gt;.", "语言总评", "句子评语", "参考表达", "Strong opening"]) {
    assert(renderedFirst.html.includes(phrase), phrase);
  }
  assert(!renderedFirst.html.includes("Trees <grow>."));
  composition.rewrite_results = { overall_feedback: "全部完成", results: [
    { sentence_id: "s1", student_rewrite: "Trees grow tall.", accepted: true, feedback: "已修复" },
  ] };
  composition.completed_at = new Date();
  await reports.enqueue(db, student, composition, "complete", { usage_id: "u2" }, "general_language");
  assert.strictEqual(rows.size, 2);
  const final = reports.render(rows.get(reports.eventId("essay-1", "complete")));
  assert(final.html.includes("作文订正完成报告"));
  assert(final.html.includes("Trees grow tall."));
  assert(final.html.includes("已修复"));
  assert(!renderedFirst.html.includes("已修复"), "first report must remain a snapshot");
  console.log("Writing report email snapshots and rendering passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
