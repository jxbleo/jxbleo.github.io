"use strict";
const crypto = require("crypto");

function text(value) { return String(value == null ? "" : value).trim(); }
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
function paragraph(value) {
  return text(value) ? `<p style="white-space:pre-wrap;margin:8px 0">${escapeHtml(value)}</p>` : "";
}
function list(items) {
  if (!Array.isArray(items) || !items.length) return "";
  return `<ul>${items.map((item) => `<li>${escapeHtml(typeof item === "string" ? item : [item.title, item.evidence, item.action].filter(Boolean).join(" — "))}</li>`).join("")}</ul>`;
}
function section(title, body) { return body ? `<section style="margin:22px 0"><h3>${escapeHtml(title)}</h3>${body}</section>` : ""; }
function snapshot(composition) {
  return {
    title: text(composition.title) || "Student Writing",
    prompt_text: text(composition.prompt_text),
    confirmed_text: text(composition.confirmed_text),
    revision: Number(composition.revision || 1),
    word_count: Number(composition.word_count || 0),
    standardized_review: composition.standardized_review || null,
    language_review: composition.language_review || null,
    rewrite_results: composition.rewrite_results || null,
    completed_at: composition.completed_at || null,
  };
}
function eventId(compositionId, phase) {
  return "writing_report_email_" + crypto.createHash("sha256")
    .update([compositionId, phase].join("\n")).digest("hex").slice(0, 40);
}
async function enqueue(db, student, composition, phase, usage = {}, mode = "") {
  const now = new Date();
  try {
    await db.collection("writing_teacher_email_events").doc(eventId(composition.composition_id, phase)).create({
      event_id: eventId(composition.composition_id, phase),
      event_type: "writing_report", report_phase: phase,
      completion_watch: phase === "first" && !composition.completed_at,
      report_snapshot: snapshot(composition),
      usage_id: usage.usage_id || null, student_uid: student.auth_uid || student.student_uid,
      student_id: student.student_id || "", student_name: student.name || "",
      composition_id: composition.composition_id, mode,
      rubric_id: composition.rubric_id || null,
      word_count: Number(usage.word_count || composition.word_count || 0),
      day_key: usage.day_key || null,
      status: "pending", created_at: now, updated_at: now,
    });
  } catch (_) {
    // A duplicate or unavailable outbox must never invalidate the report.
  }
}
function render(event) {
  const report = event.report_snapshot;
  if (!report) throw new Error("WRITING_REPORT_SNAPSHOT_MISSING");
  const first = event.report_phase === "first";
  const heading = first ? "首次作文批改报告" : "作文订正完成报告";
  const standardized = report.standardized_review || {};
  const language = report.language_review || {};
  const rewrites = report.rewrite_results || {};
  const results = new Map((rewrites.results || []).map((item) => [item.sentence_id, item]));
  const standardHtml = report.standardized_review
    ? section("内容与评分", paragraph(standardized.summary)
      + paragraph([standardized.overall_score, standardized.score_scale].filter(Boolean).join(" / "))
      + section("评分维度", (standardized.criteria || []).map((item) =>
        `<p><strong>${escapeHtml(item.name)}</strong> ${escapeHtml(item.score)} / ${escapeHtml(item.max_score)}<br>${escapeHtml(item.rationale)}</p>`).join(""))
      + section("做得好的地方", list(standardized.strengths))
      + section("优先改进", list(standardized.priorities)))
    : "";
  const level = language.cefr_estimate || {};
  const languageHtml = report.language_review
    ? section("语言总评", paragraph(language.overview || language.summary)
      + paragraph(level.level ? `CEFR ${level.level}${{ lower: "-", middle: "", upper: "+" }[level.position] || ""} · ${text(level.commentary_zh)}` : ""))
    + section("逐句分析与订正", (language.sentences || []).map((sentence, index) => {
      const result = results.get(sentence.sentence_id);
      const issues = (sentence.issues || []).map((issue) =>
        `<li>${escapeHtml([issue.category, issue.span, issue.explanation, issue.suggestion].filter(Boolean).join(" · "))}</li>`).join("");
      const history = (rewrites.feedback_history || []).map((batch, round) => {
        const entry = (batch.results || []).find((item) => item.sentence_id === sentence.sentence_id);
        return entry ? paragraph(`第 ${Number(batch.round || round + 1)} 轮：${text(entry.feedback)}`) : "";
      }).join("");
      return `<article style="border-top:1px solid #dce5df;padding:12px 0"><strong>${index + 1}. ${escapeHtml(sentence.original)}</strong>`
        + paragraph(sentence.coaching_summary)
        + (issues ? `<ul>${issues}</ul>` : "")
        + (sentence.rewrite_required ? paragraph(`参考表达：${text(sentence.reference_revision)}`) : "")
        + (result ? paragraph(`学生订正：${text(result.student_rewrite)}`)
          + paragraph(`结果：${result.accepted ? "已通过" : "需继续订正"}${result.teacher_approved ? "（教师批准）" : ""} · ${text(result.feedback)}`) + history : "")
        + "</article>";
    }).join(""))
    + section("订正总结", paragraph(rewrites.overall_feedback))
    : "";
  const title = `${heading} · ${text(event.student_name || event.student_id || "Student")} · ${report.title}`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;line-height:1.65;color:#20362c"><h1>${escapeHtml(heading)}</h1><p><strong>${escapeHtml(event.student_name || event.student_id || "Student")}</strong> · ${escapeHtml(report.title)} · 第 ${report.revision} 稿 · ${report.word_count} 字</p>`
    + section("写作题目", paragraph(report.prompt_text))
    + section("学生原文", paragraph(report.confirmed_text))
    + standardHtml + languageHtml + "</div>";
  const plain = html.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/(?:p|li|h[1-6]|article|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  return { subject: title.replace(/[\r\n]+/g, " ").slice(0, 240), html, text: plain };
}
module.exports = { eventId, enqueue, snapshot, render };
