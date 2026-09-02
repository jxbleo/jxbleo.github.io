"use strict";

const crypto = require("crypto");

function compactText(value, limit) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeVocabularyText(value) {
  return compactText(value, 160).normalize("NFKC").toLowerCase();
}

function vocabularyId(studentUid, normalizedText) {
  const hash = crypto.createHash("sha256").update(`${studentUid}\n${normalizedText}`).digest("hex").slice(0, 32);
  return `vocab_${hash}`;
}

function savedExampleFromEvent(event, text, now) {
  const sourceTitle = compactText(event.source_title, 160);
  const sourcePath = compactText(event.source_path, 300);
  const context = compactText(event.context, 320);
  if (!sourceTitle && !sourcePath && !context) return null;
  const contextTokenRanges = Array.isArray(event.context_token_ranges)
    ? event.context_token_ranges.slice(0, 16).flatMap((range) => {
      const start = Number(range && range.start);
      const end = Number(range && range.end);
      return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= context.length
        ? [{ start, end }]
        : [];
    })
    : [];
  return { form: text, source_set_id: compactText(event.source_set_id, 80) || null, source_title: sourceTitle, source_path: sourcePath, context, context_token_ranges: contextTokenRanges, saved_at: now, count: 1 };
}

function mergeSavedExamples(current, nextExample) {
  const examples = Array.isArray(current) ? current.slice(0, 39) : [];
  if (!nextExample) return examples;
  const key = (item) => [item.form, item.source_set_id, item.source_path, item.context].map((value) => String(value || "")).join("\n");
  const index = examples.findIndex((item) => key(item) === key(nextExample));
  if (index >= 0) examples[index] = { ...examples[index], saved_at: nextExample.saved_at, count: Number(examples[index].count || 1) + 1 };
  else examples.unshift(nextExample);
  return examples.slice(0, 40);
}

function validationErrorForText(value) {
  const text = compactText(value, 160);
  if (!text) return "TEXT_REQUIRED";
  if (!/[\p{L}\p{N}]/u.test(text)) return "TEXT_INVALID";
  if (text.length > 120 || text.split(/\s+/).filter(Boolean).length > 16) return "TEXT_TOO_LONG";
  return "";
}

async function upsertPersonalVocabularyItem({ db, student, event, getLexiconItem }) {
  const error = validationErrorForText(event.text);
  if (error) throw new Error(error);
  const text = compactText(event.text, 120);
  const normalizedText = normalizeVocabularyText(text);
  const vocabId = vocabularyId(student.auth_uid, normalizedText);
  const now = new Date();
  const savedExample = savedExampleFromEvent(event, text, now);
  const update = {
    text, normalized_text: normalizedText, status: "active",
    source_set_id: compactText(event.source_set_id, 80) || null,
    source_title: compactText(event.source_title, 160), source_path: compactText(event.source_path, 300),
    context: compactText(event.context, 320), last_added_at: now, activity_updated_at: now, updated_at: now,
  };
  const collection = db.collection("student_vocabulary_items");
  const existingResult = await collection.where({ vocab_id: vocabId, student_uid: student.auth_uid }).limit(1).get();
  const existing = existingResult.data && existingResult.data[0];
  const examples = mergeSavedExamples(existing && existing.saved_examples, savedExample);
  const timesAdded = Number(existing && existing.times_added || (existing ? 1 : 0)) + 1;
  if (existing) {
    await collection.doc(existing._id).update({ ...update, saved_examples: examples, times_added: timesAdded });
    return { record: { ...existing, ...update, saved_examples: examples, times_added: timesAdded }, created: false, normalized_text: normalizedText };
  }
  const record = {
    vocab_id: vocabId, student_uid: student.auth_uid, student_id_snapshot: student.student_id,
    times_added: 1, created_at: now, lookup_status: "pending", learning_status: "new",
    review_due_at: now, review_interval_days: 0, review_streak: 0, personal_note: "",
    saved_examples: savedExample ? [savedExample] : [], ...update,
  };
  await collection.add(record);
  return { record, created: true, normalized_text: normalizedText };
}

module.exports = { compactText, normalizeVocabularyText, vocabularyId, mergeSavedExamples, validationErrorForText, upsertPersonalVocabularyItem };
