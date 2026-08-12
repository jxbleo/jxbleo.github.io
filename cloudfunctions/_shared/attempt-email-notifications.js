"use strict";

const EVENT_COLLECTION = "teacher_attempt_email_events";
const BBC_BATCH_WINDOW_MS = 7 * 60 * 1000;
const EMAIL_POLICIES = Object.freeze({
  BBC_BATCH: "bbc_batch_7m",
  VOCABULARY_IMMEDIATE: "vocabulary_immediate",
});

function text(value) {
  return String(value == null ? "" : value).trim();
}

function dateValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function effectivePercentage(attempt) {
  return Number(attempt && (attempt.adjusted_percentage == null
    ? attempt.display_percentage == null
      ? attempt.percentage || 0
      : attempt.display_percentage
    : attempt.adjusted_percentage) || 0);
}

function effectivePassed(attempt) {
  return Boolean(attempt && (attempt.adjusted_passed == null
    ? attempt.passed === true
    : attempt.adjusted_passed === true));
}

function effectiveMastered(attempt) {
  return Boolean(attempt && (attempt.adjusted_mastered == null
    ? attempt.mastered === true
    : attempt.adjusted_mastered === true));
}

function effectiveQuestionResults(attempt) {
  if (!attempt) return [];
  return Array.isArray(attempt.adjusted_question_results)
    ? attempt.adjusted_question_results
    : Array.isArray(attempt.question_results) ? attempt.question_results : [];
}

function activityThreadKey(attempt) {
  const studentKey = text(attempt && (attempt.student_uid || attempt.student_id)) || "unknown-student";
  if (attempt && attempt.assignment_id) {
    return `${studentKey}::assignment::${text(attempt.assignment_id)}`;
  }
  return `${studentKey}::self-study::${text(attempt && attempt.set_id) || "unknown-set"}`;
}

function emailPolicyForAttempt(attempt) {
  const mode = text(attempt && attempt.mode);
  if (mode === "bbc") return EMAIL_POLICIES.BBC_BATCH;
  if (mode === "vocabulary_test" || mode === "vocabulary_practice_timed") {
    return EMAIL_POLICIES.VOCABULARY_IMMEDIATE;
  }
  return "";
}

function eventForAttempt(attempt, now = new Date()) {
  const policy = emailPolicyForAttempt(attempt);
  if (!policy || !attempt || !attempt.attempt_id || !attempt.student_uid || !attempt.set_id) return null;
  const submittedAt = new Date(attempt.submitted_at || now);
  const windowEndsAt = policy === EMAIL_POLICIES.BBC_BATCH
    ? new Date(submittedAt.getTime() + BBC_BATCH_WINDOW_MS)
    : submittedAt;
  return {
    event_id: text(attempt.attempt_id),
    attempt_id: text(attempt.attempt_id),
    thread_key: activityThreadKey(attempt),
    student_uid: text(attempt.student_uid),
    set_id: text(attempt.set_id),
    assignment_id: attempt.assignment_id ? text(attempt.assignment_id) : null,
    mode: text(attempt.mode),
    delivery_policy: policy,
    status: "pending",
    retry_count: 0,
    submitted_at: submittedAt,
    window_started_at: submittedAt,
    window_ends_at: windowEndsAt,
    due_at: windowEndsAt,
    created_at: now,
    updated_at: now,
  };
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${Math.round(number * 100) / 100}%`;
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace(/\//g, "-");
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value)));
  if (!Number.isFinite(seconds)) return "";
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatAnswer(value, fallback = "blank") {
  if (value == null || value === "") return fallback;
  if (Array.isArray(value)) return value.map((item) => formatAnswer(item, "")).filter(Boolean).join(" / ") || fallback;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function questionNumber(questionId) {
  const raw = text(questionId) || "?";
  const match = raw.match(/(\d+)\D*$/);
  if (match) return String(Number(match[1]));
  return raw.replace(/^q(?:uestion)?[\s_:-]*/i, "") || "?";
}

function questionLabel(questionId, mode) {
  return text(mode) === "bbc" ? `Q${questionNumber(questionId)}` : `Q${text(questionId) || "?"}`;
}

function attemptDetail(attempt, gradingKey) {
  const answers = gradingKey && gradingKey.answers && typeof gradingKey.answers === "object"
    ? gradingKey.answers : {};
  const explanations = gradingKey && gradingKey.explanations && typeof gradingKey.explanations === "object"
    ? gradingKey.explanations : {};
  return {
    ...attempt,
    percentage: effectivePercentage(attempt),
    passed: effectivePassed(attempt),
    mastered: effectiveMastered(attempt),
    question_results: effectiveQuestionResults(attempt).map((result) => {
      const questionId = text(result && (result.question_id || result.id));
      return {
        question_id: questionId,
        question_text_snapshot: text(result && result.question_text_snapshot),
        submitted_answer: result && result.submitted_answer,
        correct: Boolean(result && result.correct === true),
        correct_answer: result && result.correct_answer != null
          ? result.correct_answer : Object.prototype.hasOwnProperty.call(answers, questionId) ? answers[questionId] : null,
        explanation: result && result.explanation != null
          ? text(result.explanation) : Object.prototype.hasOwnProperty.call(explanations, questionId) ? text(explanations[questionId]) : "",
      };
    }),
  };
}

function studentDisplayName(student) {
  const chinese = text(student && student.chinese_name);
  const english = text(student && student.english_name);
  return chinese || english ? `${chinese}${english}` : text(student && student.name) || text(student && student.student_id) || "Student";
}

function attemptStatus(attempt) {
  if (attempt.mastered) return { label: "STAR", color: "#d39b12" };
  if (attempt.passed) return { label: "Passed", color: "#26845b" };
  return { label: "Not passed", color: "#c84d55" };
}

function vocabularyContext(attempt) {
  const mode = attempt.mode === "vocabulary_practice_timed" ? "Practice" : "Quiz";
  const ids = Array.isArray(attempt.selected_group_ids) ? attempt.selected_group_ids : [];
  const groups = ids.map((id) => {
    const match = text(id).match(/(?:^|\D)(\d+)$/);
    return match ? String(Number(match[1])) : text(id);
  }).filter(Boolean).sort((left, right) => Number(left) - Number(right));
  const count = Number(attempt.selected_group_count || groups.length || 0);
  return `${mode}${count ? ` · ${count} sets` : ""}${groups.length ? ` · Groups ${groups.join(", ")}` : ""}`;
}

function chartHtml(attempts, assignment, newAttemptIds) {
  const latestAttempt = attempts.slice().sort((left, right) => dateValue(left.submitted_at) - dateValue(right.submitted_at)).at(-1);
  const passing = Number(assignment && assignment.passing_percentage != null
    ? assignment.passing_percentage : latestAttempt && latestAttempt.passing_percentage);
  const mastery = Number(assignment && assignment.mastery_percentage != null
    ? assignment.mastery_percentage : latestAttempt && latestAttempt.mastery_percentage);
  const masteryEnabled = assignment && typeof assignment.mastery_enabled === "boolean"
    ? assignment.mastery_enabled : attempts.some((attempt) => attempt.mastery_enabled === true);
  const width = Math.max(58, Math.min(108, Math.floor(640 / Math.max(attempts.length, 1))));
  const bars = attempts.map((attempt, index) => {
    const percentage = Math.max(0, Math.min(100, effectivePercentage(attempt)));
    const barHeight = Math.max(5, Math.round(percentage * 1.2));
    const status = attemptStatus(attempt);
    const fresh = newAttemptIds.has(text(attempt.attempt_id));
    const outline = fresh ? "border:3px solid #236c54;" : "border:1px solid #d5dcd8;";
    return `<td width="${width}" valign="bottom" style="padding:0 6px;text-align:center;vertical-align:bottom;">`
      + `<div style="font:700 12px Arial,sans-serif;color:#17362c;margin-bottom:5px;">${escapeHtml(formatPercent(percentage))}</div>`
      + `<table role="presentation" width="100%" height="120" cellspacing="0" cellpadding="0" border="0" style="height:120px;background:#f2f5f3;border-radius:11px 11px 5px 5px;${outline}"><tr>`
      + `<td valign="bottom" align="center" style="height:120px;vertical-align:bottom;"><div style="width:24px;height:${barHeight}px;background:${status.color};border-radius:7px 7px 2px 2px;"></div></td></tr></table>`
      + `<div style="font:800 11px Arial,sans-serif;color:#17362c;margin-top:6px;">#${escapeHtml(attempt.attempt_number || attempts.length - index)}</div>`
      + `${fresh ? '<div style="font:700 9px Arial,sans-serif;color:#236c54;margin-top:2px;">NEW</div>' : ""}</td>`;
  }).join("");
  return `<div style="margin:0 0 15px;padding:18px;border:1px solid #dce4e0;border-radius:17px;background:#ffffff;">`
    + `<div style="font:800 15px Arial,sans-serif;color:#17362c;margin-bottom:15px;text-transform:uppercase;letter-spacing:.04em;">Attempt history</div>`
    + `<div style="overflow-x:auto;padding-bottom:3px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="min-width:${Math.max(320, attempts.length * width)}px;width:100%;table-layout:fixed;"><tr>${bars}</tr></table></div></div>`;
}

function wrongRowsHtml(attempt) {
  const wrong = (attempt.question_results || []).filter((result) => result.correct !== true);
  if (!wrong.length) return '<div style="padding:12px 14px;background:#eef7f1;border-radius:10px;color:#246447;font:13px Arial,sans-serif;">No wrong answers in this attempt.</div>';
  return wrong.map((result) => `<div style="border-top:1px solid #e1e6e3;padding:12px 0;">`
    + `<div style="font:700 13px Arial,sans-serif;color:#17362c;">${escapeHtml(questionLabel(result.question_id, attempt.mode))}`
    + `${result.question_text_snapshot ? ` · ${escapeHtml(result.question_text_snapshot)}` : ""}</div>`
    + `<div style="margin-top:9px;padding:10px 11px;border-radius:11px;background:#fff2f3;color:#923c43;font:13px/1.4 Arial,sans-serif;"><strong>Submitted</strong><br>${escapeHtml(formatAnswer(result.submitted_answer))}</div>`
    + `<div style="margin-top:7px;padding:10px 11px;border-radius:11px;background:#eef7f1;color:#246447;font:13px/1.4 Arial,sans-serif;"><strong>Expected</strong><br>${escapeHtml(formatAnswer(result.correct_answer, "not available"))}</div>`
    + `${result.explanation ? `<div style="margin-top:8px;padding:11px;border-left:3px solid #7c3aed;border-radius:4px 11px 11px 4px;background:#f6f2ff;color:#4e4760;font:12px/1.55 Arial,sans-serif;"><strong>Explanation</strong><br>${escapeHtml(result.explanation)}</div>` : ""}`
    + `</div>`).join("");
}

function attemptCardHtml(attempt, index, isNew, total) {
  const status = attemptStatus(attempt);
  const durations = [
    attempt.duration_seconds == null ? "" : `Page ${formatDuration(attempt.duration_seconds)}`,
    attempt.audio_to_submit_seconds == null ? "" : `Audio ${formatDuration(attempt.audio_to_submit_seconds)}`,
  ].filter(Boolean);
  const vocab = text(attempt.mode).startsWith("vocabulary_") ? vocabularyContext(attempt) : "";
  const number = attempt.attempt_number || total - index;
  return `<section style="margin-top:15px;overflow:hidden;border:1px solid ${isNew ? "#75a794" : "#dce4e0"};border-radius:17px;background:#ffffff;">`
    + `<div style="padding:14px 16px;background:${isNew ? "#edf5f1" : "#f4f6f5"};">`
    + `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>`
    + `<td><strong style="font:800 16px Arial,sans-serif;color:#17362c;">#${escapeHtml(number)}</strong>${isNew ? ' <span style="margin-left:7px;color:#267158;font:800 10px Arial,sans-serif;">NEW</span>' : ""}</td>`
    + `<td align="right" style="color:#53665f;font:11px Arial,sans-serif;">${escapeHtml(formatDateTime(attempt.submitted_at))}</td></tr></table>`
    + `<div style="margin-top:5px;color:#53665f;font:12px Arial,sans-serif;">${escapeHtml(formatPercent(attempt.percentage))} · <span style="color:${status.color};font-weight:700;">${status.label}</span>${durations.length ? ` · ${escapeHtml(durations.join(" · "))}` : ""}</div>`
    + `${vocab ? `<div style="margin-top:6px;color:#4f645c;font:700 11px Arial,sans-serif;">${escapeHtml(vocab)}</div>` : ""}</div>`
    + `<div style="padding:16px;"><div style="margin-bottom:10px;color:#53665f;font:800 11px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Wrong questions</div>`
    + wrongRowsHtml(attempt) + `</div></section>`;
}

function emailSubject(context) {
  const attempts = context.attempts || [];
  const latest = attempts.slice().sort((left, right) => dateValue(left.submitted_at) - dateValue(right.submitted_at)).at(-1) || {};
  const studentName = studentDisplayName(context.student);
  const title = text(context.set && context.set.title) || text(latest.set_id) || "Learning task";
  const best = attempts.length
    ? Math.max(...attempts.map((attempt) => effectivePercentage(attempt)))
    : effectivePercentage(latest);
  return `${studentName} | ${title} | Best ${formatPercent(best)}`;
}

function renderAttemptEmail(context) {
  const attempts = (context.attempts || []).slice().sort((left, right) => dateValue(left.submitted_at) - dateValue(right.submitted_at));
  const displayAttempts = attempts.slice().reverse();
  const newIds = new Set((context.newAttemptIds || []).map(text));
  const latest = attempts.at(-1) || {};
  const studentName = studentDisplayName(context.student);
  const title = text(context.set && context.set.title) || text(latest.set_id) || "Learning task";
  const source = latest.assignment_id ? "Assigned" : "Self study";
  const best = attempts.length ? Math.max(...attempts.map((attempt) => effectivePercentage(attempt))) : 0;
  const passing = Number(context.assignment && context.assignment.passing_percentage != null
    ? context.assignment.passing_percentage : latest.passing_percentage);
  const mastery = Number(context.assignment && context.assignment.mastery_percentage != null
    ? context.assignment.mastery_percentage : latest.mastery_percentage);
  const masteryEnabled = context.assignment && typeof context.assignment.mastery_enabled === "boolean"
    ? context.assignment.mastery_enabled : attempts.some((attempt) => attempt.mastery_enabled === true);
  const cards = displayAttempts.map((attempt, index) => attemptCardHtml(attempt, index, newIds.has(text(attempt.attempt_id)), attempts.length)).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#edf2ef;padding:24px 12px;color:#17362c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">`
    + `<div style="max-width:720px;margin:0 auto;overflow:hidden;border:1px solid #d7e0dc;border-radius:22px;background:#f9fbfa;">`
    + `<div style="padding:24px;background:#eef4f1;border-bottom:1px solid #dce5e1;">`
    + `<h1 style="margin:0;color:#17362c;font:700 25px/1.18 Arial,sans-serif;letter-spacing:-.02em;">${escapeHtml(studentName)}</h1>`
    + `<div style="margin-top:6px;color:#53665f;font:700 15px/1.35 Arial,sans-serif;">${escapeHtml(title)}</div>`
    + `<div style="margin-top:15px;">`
    + `<span style="display:inline-block;margin:0 5px 5px 0;padding:7px 11px;border-radius:999px;background:#ffffff;color:#246447;font:800 12px Arial,sans-serif;">Best ${escapeHtml(formatPercent(best))}</span>`
    + `<span style="display:inline-block;margin:0 5px 5px 0;padding:7px 11px;border-radius:999px;background:#ffffff;color:#53665f;font:800 12px Arial,sans-serif;">PASS ${escapeHtml(formatPercent(passing))}</span>`
    + `${masteryEnabled && Number.isFinite(mastery) ? `<span style="display:inline-block;margin:0 5px 5px 0;padding:7px 11px;border-radius:999px;background:#fff7df;color:#9a6b08;font:800 12px Arial,sans-serif;">STAR ${escapeHtml(formatPercent(mastery))}</span>` : ""}`
    + `</div></div><div style="padding:22px 18px 24px;">`
    + chartHtml(displayAttempts, context.assignment, newIds) + cards
    + `<div style="margin:20px 5px 0;color:#73817c;font:11px/1.55 Arial,sans-serif;">Private teacher notification · ${escapeHtml(source)} · Latest ${escapeHtml(formatDateTime(latest.submitted_at))}</div>`
    + `</div></div></body></html>`;
  const plain = [
    `${studentName} · ${title}`,
    `${source} · Latest ${formatDateTime(latest.submitted_at)}`,
    `New attempts: ${context.newAttemptIds.length}`,
    `History: ${displayAttempts.map((attempt, index) => `#${attempt.attempt_number || attempts.length - index} ${formatPercent(attempt.percentage)} ${formatDateTime(attempt.submitted_at)}`).join(" | ")}`,
    ...displayAttempts.map((attempt, index) => {
      const wrong = (attempt.question_results || []).filter((result) => result.correct !== true);
      return [`Attempt #${attempt.attempt_number || attempts.length - index}`, ...wrong.map((result) => `${questionLabel(result.question_id, attempt.mode)} Submitted: ${formatAnswer(result.submitted_answer)} Expected: ${formatAnswer(result.correct_answer, "not available")}${result.explanation ? ` Explanation: ${result.explanation}` : ""}`)].join("\n");
    }),
  ].filter(Boolean).join("\n\n");
  return { subject: emailSubject({ ...context, attempts }), html, text: plain };
}

module.exports = {
  BBC_BATCH_WINDOW_MS,
  EMAIL_POLICIES,
  EVENT_COLLECTION,
  activityThreadKey,
  attemptDetail,
  emailPolicyForAttempt,
  eventForAttempt,
  renderAttemptEmail,
};
