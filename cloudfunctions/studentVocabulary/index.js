const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const COLLECTION = "student_vocabulary_items";
const LEXICON_COLLECTION = "vocabulary_lexicon";
const DICTIONARY_REPORT_COLLECTION = "vocabulary_dictionary_reports";
const VOCABULARY_TEST_SESSION_COLLECTION = "vocabulary_test_sessions";
const VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS = 60 * 1000;
const DICTIONARY_LOOKUP_TIMEOUT_MS = 4000;
const AI_LOOKUP_TIMEOUT_MS = 15000;
const AI_DAILY_LIMIT = 10;
const MERGE_UNDO_WINDOW_MS = 10 * 1000;

function compactText(value, limit) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function normalizeVocabularyText(value) {
  return compactText(value, 160).normalize("NFKC").toLowerCase();
}

function hasWordCharacter(value) {
  return /[\p{L}\p{N}]/u.test(value);
}

function validationErrorForText(value) {
  const text = compactText(value, 160);
  if (!text) return "TEXT_REQUIRED";
  if (!hasWordCharacter(text)) return "TEXT_INVALID";
  if (text.length > 120) return "TEXT_TOO_LONG";
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 16) return "TEXT_TOO_LONG";
  return "";
}

function vocabularyId(studentUid, normalizedText) {
  const hash = crypto
    .createHash("sha256")
    .update(`${studentUid}\n${normalizedText}`)
    .digest("hex")
    .slice(0, 32);
  return `vocab_${hash}`;
}

function shanghaiDayKey(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function savedExampleFromEvent(event, text, now) {
  const sourceTitle = compactText(event.source_title, 160);
  const sourcePath = compactText(event.source_path, 300);
  const context = compactText(event.context, 320);
  if (!sourceTitle && !sourcePath && !context) return null;
  return {
    form: text,
    source_set_id: compactText(event.source_set_id, 80) || null,
    source_title: sourceTitle,
    source_path: sourcePath,
    context,
    saved_at: now,
    count: 1,
  };
}

function mergeSavedExamples(current, nextExample) {
  const examples = Array.isArray(current) ? current.slice(0, 39) : [];
  if (!nextExample) return examples;
  const key = [nextExample.form, nextExample.source_set_id, nextExample.source_path, nextExample.context]
    .map((value) => String(value || "")).join("\n");
  const index = examples.findIndex((item) => [item.form, item.source_set_id, item.source_path, item.context]
    .map((value) => String(value || "")).join("\n") === key);
  if (index >= 0) {
    examples[index] = {
      ...examples[index],
      saved_at: nextExample.saved_at,
      count: Number(examples[index].count || 1) + 1,
    };
    return examples;
  }
  examples.unshift(nextExample);
  return examples.slice(0, 40);
}

function uniqueSavedExamples(items) {
  return (items || []).reduce((output, item) => mergeSavedExamples(output, item), []);
}

function lexiconId(normalizedText) {
  const hash = crypto.createHash("sha256").update(normalizedText).digest("hex").slice(0, 32);
  return `lex_${hash}`;
}

async function getAuthenticatedStudent() {
  const userInfo = await app.auth().getUserInfo();
  const uid = userInfo && (userInfo.uid || userInfo.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");

  const authUid = String(uid);
  const result = await db.collection("students").where({
    auth_uid: authUid,
    active: true,
  }).limit(1).get();
  const student = result.data && result.data[0];
  if (!student || String(student.auth_uid || "") !== authUid) {
    throw new Error("STUDENT_NOT_LINKED");
  }
  if ((student.role || "student") !== "student") {
    throw new Error("STUDENT_REQUIRED");
  }
  return student;
}

function dateValue(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function clientInstanceId(event) {
  return String(event && event._client_instance_id || "").trim().slice(0, 128);
}

function isSameInstance(session, instanceId) {
  return Boolean(instanceId && session && session.client_instance_id && String(session.client_instance_id) === instanceId);
}

function appendIntegrityFlag(session, flag) {
  const flags = Array.isArray(session && session.integrity_flags)
    ? session.integrity_flags.map((item) => String(item || "")).filter(Boolean)
    : [];
  if (flag && !flags.includes(flag)) flags.push(flag);
  return flags;
}

function isMissingCollectionError(error) {
  const message = String(error && (error.message || error.code || error.errMsg || error) || "");
  return /COLLECTION.*NOT.*EXIST|collection.*not.*exist|collection.*not.*found/i.test(message);
}

async function markVocabularySessionAbandoned(session, reason) {
  if (!session || !session._id) return;
  const now = new Date();
  await db.collection(VOCABULARY_TEST_SESSION_COLLECTION).doc(session._id).update({
    status: "abandoned",
    abandoned_at: now,
    abandoned_reason: reason,
    integrity_flags: appendIntegrityFlag(session, reason),
    updated_at: now,
  });
}

async function activeVocabularySessions(studentUid) {
  const now = new Date();
  let result;
  try {
    result = await db.collection(VOCABULARY_TEST_SESSION_COLLECTION).where({
      student_uid: studentUid,
      status: "active",
    }).limit(100).get();
  } catch (error) {
    if (isMissingCollectionError(error)) return [];
    throw error;
  }
  const active = [];
  for (const session of result.data || []) {
    const expiresAt = dateValue(session.expires_at);
    const lastSeen = dateValue(session.last_heartbeat_at || session.started_at || session.created_at);
    if (expiresAt && now.getTime() > expiresAt) {
      await markVocabularySessionAbandoned(session, "time_expired");
      continue;
    }
    if (lastSeen && now.getTime() - lastSeen > VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS) {
      await markVocabularySessionAbandoned(session, "heartbeat_timeout");
      continue;
    }
    active.push(session);
  }
  return active;
}

async function assertNoOtherActiveVocabularyTest(student, event) {
  const instanceId = clientInstanceId(event);
  const active = await activeVocabularySessions(student.auth_uid);
  const other = active.find((session) => !isSameInstance(session, instanceId));
  if (other) throw new Error("VOCABULARY_TEST_DEVICE_BLOCKED");
}

async function getOwnedItem(student, vocabId) {
  const result = await db.collection(COLLECTION).where({
    vocab_id: vocabId,
    student_uid: student.auth_uid,
  }).limit(1).get();
  return result.data && result.data[0];
}

function lexiconView(item) {
  if (!item) return null;
  return {
    lexicon_id: item.lexicon_id || "",
    word: item.word || "",
    normalized_word: item.normalized_word || "",
    phonetic: item.phonetic || "",
    audio_url: item.audio_url || "",
    part_of_speech: item.part_of_speech || "",
    english_definition: item.english_definition || "",
    chinese_meaning: item.chinese_meaning || "",
    word_forms: item.word_forms || "",
    emoji: item.emoji || "",
    senses: Array.isArray(item.senses) ? item.senses.slice(0, 8) : [],
    source_type: item.source_type || "",
    source_name: item.source_name || (Array.isArray(item.sources) ? item.sources.join(" / ") : ""),
    source_url: item.source_url || "",
    verified: item.verified === true,
    review_status: item.review_status || (item.verified === true ? "reviewed" : "external"),
    updated_at: item.updated_at || null,
  };
}

function itemView(item, lexiconItem) {
  const dictionary = lexiconView(lexiconItem);
  return {
    vocab_id: item.vocab_id,
    text: item.text || "",
    normalized_text: item.normalized_text || "",
    status: item.status || "active",
    source_set_id: item.source_set_id || null,
    source_title: item.source_title || "",
    source_path: item.source_path || "",
    context: item.context || "",
    personal_note: item.personal_note || "",
    saved_examples: Array.isArray(item.saved_examples) ? item.saved_examples.slice(0, 40) : [],
    times_added: Number(item.times_added || 1),
    created_at: item.created_at || null,
    updated_at: item.updated_at || null,
    last_added_at: item.last_added_at || null,
    activity_updated_at: item.activity_updated_at || item.last_added_at || item.created_at || null,
    lookup_status: dictionary ? "ready" : (item.lookup_status || "pending"),
    lookup_error: item.lookup_error || "",
    lookup_retry_after: item.lookup_retry_after || null,
    learning_status: item.learning_status || "new",
    review_due_at: item.review_due_at || item.created_at || null,
    review_interval_days: Math.max(0, Number(item.review_interval_days || 0)),
    review_streak: Math.max(0, Number(item.review_streak || 0)),
    last_reviewed_at: item.last_reviewed_at || null,
    dictionary,
  };
}

async function getLexiconItem(normalizedWord) {
  if (!normalizedWord) return null;
  try {
    const result = await db.collection(LEXICON_COLLECTION).where({
      normalized_word: normalizedWord,
    }).limit(1).get();
    return result.data && result.data[0] || null;
  } catch (error) {
    if (isMissingCollectionError(error)) return null;
    throw error;
  }
}

async function getLexiconItemOrNull(normalizedWord) {
  try {
    return await getLexiconItem(normalizedWord);
  } catch (_error) {
    return null;
  }
}

async function lexiconMapForItems(items) {
  const values = Array.from(new Set((items || []).map((item) => item.normalized_text).filter(Boolean)));
  const map = {};
  const command = db.command;
  for (let index = 0; index < values.length; index += 10) {
    const batch = values.slice(index, index + 10);
    try {
      const result = await db.collection(LEXICON_COLLECTION).where({
        normalized_word: command.in(batch),
      }).limit(100).get();
      (result.data || []).forEach((item) => { map[item.normalized_word] = item; });
    } catch (error) {
      console.error("VOCABULARY_LEXICON_BATCH_LOOKUP_FAILED", {
        words: batch,
        message: String(error && error.message || error || "unknown error").slice(0, 240),
      });
      for (const normalizedWord of batch) {
        const item = await getLexiconItemOrNull(normalizedWord);
        if (item) map[normalizedWord] = item;
      }
    }
  }
  return map;
}

function regularHeadwordCandidates(value) {
  const word = normalizeVocabularyText(value);
  if (!word || word.includes(" ") || !/^[a-z]+(?:'[a-z]+)?$/.test(word)) return [];
  const output = [];
  const add = (candidate) => {
    if (candidate && candidate.length >= 2 && candidate !== word && !output.includes(candidate)) output.push(candidate);
  };
  if (word.endsWith("ied") && word.length > 4) add(`${word.slice(0, -3)}y`);
  if (word.endsWith("ed") && word.length > 4) {
    const stem = word.slice(0, -2);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1));
    add(stem);
    add(word.slice(0, -1));
  }
  if (word.endsWith("ing") && word.length > 5) {
    const stem = word.slice(0, -3);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1));
    add(stem);
    add(`${stem}e`);
  }
  if (word.endsWith("ies") && word.length > 4) add(`${word.slice(0, -3)}y`);
  if (word.endsWith("es") && word.length > 4) {
    add(word.slice(0, -2));
    add(word.slice(0, -1));
  } else if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
    add(word.slice(0, -1));
  }
  return output;
}

async function recommendationMapForItems(items, currentLexicon) {
  const active = (items || []).filter((item) => (item.status || "active") === "active");
  const existing = new Set(active.map((item) => item.normalized_text));
  const candidates = Array.from(new Set(active.flatMap((item) => regularHeadwordCandidates(item.normalized_text))));
  const candidateRows = candidates.map((normalized_text) => ({ normalized_text }));
  const candidateLexicon = await lexiconMapForItems(candidateRows);
  const available = new Set([...existing, ...Object.keys(currentLexicon || {}), ...Object.keys(candidateLexicon || {})]);
  return active.reduce((map, item) => {
    const match = regularHeadwordCandidates(item.normalized_text).find((candidate) => available.has(candidate));
    if (match) map[item.vocab_id] = match;
    return map;
  }, {});
}

async function addWord(student, event) {
  const error = validationErrorForText(event.text);
  if (error) throw new Error(error);

  const text = compactText(event.text, 120);
  const normalizedText = normalizeVocabularyText(text);
  const vocabId = vocabularyId(student.auth_uid, normalizedText);
  const now = new Date();
  const sourceSetId = compactText(event.source_set_id, 80) || null;
  const savedExample = savedExampleFromEvent(event, text, now);
  const update = {
    text,
    normalized_text: normalizedText,
    status: "active",
    source_set_id: sourceSetId,
    source_title: compactText(event.source_title, 160),
    source_path: compactText(event.source_path, 300),
    context: compactText(event.context, 320),
    last_added_at: now,
    activity_updated_at: now,
    updated_at: now,
  };

  const existing = await getOwnedItem(student, vocabId);
  if (existing) {
    await db.collection(COLLECTION).doc(existing._id).update({
      ...update,
      saved_examples: mergeSavedExamples(existing.saved_examples, savedExample),
      times_added: Number(existing.times_added || 1) + 1,
    });
    const nextItem = {
      ...existing,
      ...update,
      lookup_status: existing.lookup_status || "pending",
      saved_examples: mergeSavedExamples(existing.saved_examples, savedExample),
      times_added: Number(existing.times_added || 1) + 1,
    };
    const lexiconItem = await getLexiconItemOrNull(normalizedText);
    return {
      success: true,
      created: false,
      word: itemView(nextItem, lexiconItem),
    };
  }

  const record = {
    vocab_id: vocabId,
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    times_added: 1,
    created_at: now,
    lookup_status: "pending",
    learning_status: "new",
    review_due_at: now,
    review_interval_days: 0,
    review_streak: 0,
    personal_note: "",
    saved_examples: savedExample ? [savedExample] : [],
    ...update,
  };
  await db.collection(COLLECTION).add(record);
  const lexiconItem = await getLexiconItemOrNull(normalizedText);
  return {
    success: true,
    created: true,
    word: itemView(record, lexiconItem),
  };
}

async function listWords(student, event) {
  const status = compactText(event.status || "active", 32);
  const limit = Math.max(1, Math.min(Number(event.limit || 100), 200));
  let query = db.collection(COLLECTION).where({
    student_uid: student.auth_uid,
  });
  if (status !== "all") {
    query = db.collection(COLLECTION).where({
      student_uid: student.auth_uid,
      status,
    });
  }
  const result = await query.orderBy("updated_at", "desc").limit(limit).get();
  const rows = result.data || [];
  const lexicon = await lexiconMapForItems(rows);
  const recommendations = await recommendationMapForItems(rows, lexicon);
  return {
    success: true,
    words: rows.map((item) => ({
      ...itemView(item, lexicon[item.normalized_text]),
      recommended_headword: recommendations[item.vocab_id] || "",
      merge_candidate_ids: rows
        .filter((other) => other.vocab_id !== item.vocab_id && (recommendations[other.vocab_id] || other.normalized_text) === (recommendations[item.vocab_id] || item.normalized_text))
        .map((other) => other.vocab_id),
    })),
  };
}

function compactDefinitions(definitions) {
  return (definitions || []).map((item) => compactText(item, 500)).filter(Boolean).slice(0, 3);
}

async function requestFreeDictionary(normalizedWord) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DICTIONARY_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalizedWord)}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 404) return { status: "not_found" };
    if (!response.ok) throw new Error(`DICTIONARY_HTTP_${response.status}`);
    const payload = await response.json();
    const entries = Array.isArray(payload) ? payload : [];
    const senses = [];
    entries.forEach((entry) => {
      (entry.meanings || []).forEach((meaning) => {
        const definitions = compactDefinitions((meaning.definitions || []).map((item) => item.definition));
        if (!definitions.length) return;
        const exampleItem = (meaning.definitions || []).find((item) => item && item.example);
        senses.push({
          part_of_speech: compactText(meaning.partOfSpeech, 80),
          definitions,
          example: compactText(exampleItem && exampleItem.example, 320),
        });
      });
    });
    if (!senses.length) return { status: "not_found" };
    const firstEntry = entries[0] || {};
    const phoneticItem = (firstEntry.phonetics || []).find((item) => item && (item.text || item.audio)) || {};
    const audioUrl = String(phoneticItem.audio || "").trim();
    const record = {
      lexicon_id: lexiconId(normalizedWord),
      normalized_word: normalizedWord,
      word: compactText(firstEntry.word || normalizedWord, 120),
      phonetic: compactText(firstEntry.phonetic || phoneticItem.text, 120),
      audio_url: /^https:\/\//i.test(audioUrl) ? audioUrl : (/^\/\//.test(audioUrl) ? `https:${audioUrl}` : ""),
      part_of_speech: Array.from(new Set(senses.map((item) => item.part_of_speech).filter(Boolean))).join(" / "),
      english_definition: senses[0].definitions[0],
      chinese_meaning: "",
      word_forms: "",
      emoji: "",
      senses: senses.slice(0, 8),
      sources: ["Free Dictionary API"],
      source_name: "Free Dictionary API",
      source_type: "dictionaryapi.dev",
      source_url: `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalizedWord)}`,
      verified: false,
      lexicon_version: "dictionaryapi.dev-v2",
      created_at: new Date(),
      updated_at: new Date(),
    };
    return { status: "ready", record };
  } finally {
    clearTimeout(timer);
  }
}

async function cacheLexiconRecord(record) {
  const existing = await getLexiconItem(record.normalized_word);
  if (existing) return existing;
  try {
    await db.collection(LEXICON_COLLECTION).add(record);
    return record;
  } catch (error) {
    const raced = await getLexiconItem(record.normalized_word);
    if (raced) return raced;
    throw error;
  }
}

async function enrichWord(student, event) {
  const vocabId = compactText(event.vocab_id, 80);
  if (!vocabId) throw new Error("VOCAB_ID_REQUIRED");
  const item = await getOwnedItem(student, vocabId);
  if (!item) throw new Error("VOCAB_NOT_FOUND");
  let lexiconItem = await getLexiconItem(item.normalized_text);
  if (lexiconItem) {
    await db.collection(COLLECTION).doc(item._id).update({
      lookup_status: "ready",
      lookup_error: "",
      lookup_retry_after: null,
      updated_at: new Date(),
    });
    return { success: true, lookup_status: "ready", word: itemView({ ...item, lookup_status: "ready" }, lexiconItem) };
  }

  const retryAt = dateValue(item.lookup_retry_after);
  if (!event.force && retryAt && retryAt > Date.now()) {
    return { success: true, lookup_status: item.lookup_status || "pending", word: itemView(item, null) };
  }

  try {
    const lookup = await requestFreeDictionary(item.normalized_text);
    if (lookup.status === "ready") {
      lexiconItem = await cacheLexiconRecord(lookup.record);
      await db.collection(COLLECTION).doc(item._id).update({
        lookup_status: "ready",
        lookup_error: "",
        lookup_retry_after: null,
        updated_at: new Date(),
      });
      return { success: true, lookup_status: "ready", word: itemView({ ...item, lookup_status: "ready" }, lexiconItem) };
    }
    const retryAfter = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.collection(COLLECTION).doc(item._id).update({
      lookup_status: "not_found",
      lookup_error: "No dictionary entry found",
      lookup_retry_after: retryAfter,
      updated_at: new Date(),
    });
    const next = { ...item, lookup_status: "not_found", lookup_error: "No dictionary entry found", lookup_retry_after: retryAfter };
    return { success: true, lookup_status: "not_found", word: itemView(next, null) };
  } catch (error) {
    const retryAfter = new Date(Date.now() + 6 * 60 * 60 * 1000);
    await db.collection(COLLECTION).doc(item._id).update({
      lookup_status: "pending",
      lookup_error: String(error && error.message || "Dictionary lookup unavailable").slice(0, 160),
      lookup_retry_after: retryAfter,
      updated_at: new Date(),
    });
    const next = { ...item, lookup_status: "pending", lookup_error: "Dictionary lookup will retry later", lookup_retry_after: retryAfter };
    return { success: true, lookup_status: "pending", word: itemView(next, null) };
  }
}

async function setStatus(student, event, status) {
  const vocabId = compactText(event.vocab_id, 80);
  if (!vocabId) throw new Error("VOCAB_ID_REQUIRED");
  const item = await getOwnedItem(student, vocabId);
  if (!item) throw new Error("VOCAB_NOT_FOUND");
  const now = new Date();
  await db.collection(COLLECTION).doc(item._id).update({
    status,
    updated_at: now,
  });
  return {
    success: true,
    word: itemView({
      ...item,
      status,
      updated_at: now,
    }),
  };
}

async function updateNote(student, event) {
  const vocabId = compactText(event.vocab_id, 80);
  const item = await getOwnedItem(student, vocabId);
  if (!item) throw new Error("VOCAB_NOT_FOUND");
  const note = String(event.personal_note == null ? "" : event.personal_note).trim().slice(0, 500);
  const now = new Date();
  const update = { personal_note: note, activity_updated_at: now, updated_at: now };
  await db.collection(COLLECTION).doc(item._id).update(update);
  return { success: true, word: itemView({ ...item, ...update }, await getLexiconItemOrNull(item.normalized_text)) };
}

function editableDetailUpdates(item, event) {
  const update = {};
  if (Object.prototype.hasOwnProperty.call(event, "personal_note")) {
    update.personal_note = String(event.personal_note == null ? "" : event.personal_note).trim().slice(0, 500);
  }
  if (Array.isArray(event.source_contexts)) {
    const contexts = event.source_contexts.slice(0, 8).map((value) => compactText(value, 320));
    update.context = contexts[0] || "";
    if (Array.isArray(item.saved_examples) && item.saved_examples.length) {
      update.saved_examples = item.saved_examples.slice(0, 40).map((example, index) => (
        index < contexts.length ? { ...example, context: contexts[index] } : example
      ));
    }
  } else if (Object.prototype.hasOwnProperty.call(event, "context")) {
    const context = compactText(event.context, 320);
    update.context = context;
    if (Array.isArray(item.saved_examples) && item.saved_examples.length) {
      update.saved_examples = item.saved_examples.slice(0, 40).map((example, index) => (
        index === 0 ? { ...example, context } : example
      ));
    }
  }
  return update;
}

async function updateWord(student, event) {
  const vocabId = compactText(event.vocab_id, 80);
  const item = await getOwnedItem(student, vocabId);
  if (!item) throw new Error("VOCAB_NOT_FOUND");
  const error = validationErrorForText(event.text);
  if (error) throw new Error(error);
  const nextText = compactText(event.text, 120);
  const nextNormalized = normalizeVocabularyText(nextText);
  const detailUpdates = editableDetailUpdates(item, event);
  if (nextNormalized === item.normalized_text) {
    const now = new Date();
    const update = { ...detailUpdates, text: nextText, activity_updated_at: now, updated_at: now };
    await db.collection(COLLECTION).doc(item._id).update(update);
    return { success: true, word: itemView({ ...item, ...update }, await getLexiconItemOrNull(nextNormalized)) };
  }
  const nextVocabId = vocabularyId(student.auth_uid, nextNormalized);
  const existing = await getOwnedItem(student, nextVocabId);
  if (existing && existing._id !== item._id && (existing.status || "active") === "active") {
    return {
      success: false,
      code: "MERGE_REQUIRED",
      message: "This word already exists in My Words. Review the merge before continuing.",
      merge_vocab_ids: [item.vocab_id, existing.vocab_id],
      recommended_headword: nextNormalized,
    };
  }
  const now = new Date();
  const update = {
    ...detailUpdates,
    vocab_id: nextVocabId,
    text: nextText,
    normalized_text: nextNormalized,
    lookup_status: "pending",
    lookup_error: "",
    lookup_retry_after: null,
    activity_updated_at: now,
    updated_at: now,
  };
  await db.collection(COLLECTION).doc(item._id).update(update);
  return { success: true, word: itemView({ ...item, ...update }, await getLexiconItemOrNull(nextNormalized)) };
}

function mergeNotes(items) {
  const notes = (items || []).filter((item) => compactText(item.personal_note, 500));
  if (!notes.length) return "";
  if (notes.length === 1) return compactText(notes[0].personal_note, 500);
  return notes.map((item) => `[${compactText(item.text, 80)}]\n${String(item.personal_note || "").trim()}`).join("\n\n").slice(0, 500);
}

function itemSnapshot(item) {
  const snapshot = { ...item };
  delete snapshot._id;
  delete snapshot.merge_undo;
  return snapshot;
}

async function mergeWords(student, event) {
  const vocabIds = Array.from(new Set((Array.isArray(event.vocab_ids) ? event.vocab_ids : [])
    .map((value) => compactText(value, 80)).filter(Boolean)));
  if (vocabIds.length < 2 || vocabIds.length > 12) throw new Error("MERGE_SELECTION_INVALID");
  const error = validationErrorForText(event.headword);
  if (error) throw new Error(error);
  const headword = compactText(event.headword, 120);
  const normalizedHeadword = normalizeVocabularyText(headword);
  const items = [];
  for (const vocabId of vocabIds) {
    const item = await getOwnedItem(student, vocabId);
    if (!item || (item.status || "active") !== "active") throw new Error("VOCAB_NOT_FOUND");
    if (item.normalized_text !== normalizedHeadword && !regularHeadwordCandidates(item.normalized_text).includes(normalizedHeadword)) {
      throw new Error("MERGE_SELECTION_INVALID");
    }
    items.push(item);
  }
  const targetVocabId = vocabularyId(student.auth_uid, normalizedHeadword);
  let target = items.find((item) => item.vocab_id === targetVocabId) || items[0];
  const now = new Date();
  const snapshots = items.map((item) => ({ doc_id: item._id, data: itemSnapshot(item) }));
  const mergedExamples = uniqueSavedExamples(items.flatMap((item) => {
    const examples = Array.isArray(item.saved_examples) ? item.saved_examples : [];
    if (examples.length) return examples;
    const fallback = savedExampleFromEvent(item, item.text, item.last_added_at || item.created_at || now);
    return fallback ? [fallback] : [];
  }));
  const statusRank = { new: 0, learning: 1, mastered: 2 };
  const learningStatus = items.reduce((best, item) => (statusRank[item.learning_status] || 0) > (statusRank[best] || 0) ? item.learning_status : best, "new");
  const update = {
    vocab_id: targetVocabId,
    text: headword,
    normalized_text: normalizedHeadword,
    status: "active",
    personal_note: mergeNotes(items),
    saved_examples: mergedExamples,
    times_added: items.reduce((sum, item) => sum + Number(item.times_added || 1), 0),
    learning_status: learningStatus,
    lookup_status: "pending",
    lookup_error: "",
    lookup_retry_after: null,
    activity_updated_at: now,
    updated_at: now,
    merge_undo: {
      expires_at: new Date(now.getTime() + MERGE_UNDO_WINDOW_MS),
      snapshots,
    },
  };
  await db.collection(COLLECTION).doc(target._id).update(update);
  for (const item of items) {
    if (item._id === target._id) continue;
    await db.collection(COLLECTION).doc(item._id).update({
      status: "archived",
      merged_into_vocab_id: targetVocabId,
      updated_at: now,
    });
  }
  return {
    success: true,
    undo_until: update.merge_undo.expires_at,
    word: itemView({ ...target, ...update }, await getLexiconItemOrNull(normalizedHeadword)),
  };
}

async function undoMerge(student, event) {
  const item = await getOwnedItem(student, compactText(event.vocab_id, 80));
  if (!item || !item.merge_undo || !Array.isArray(item.merge_undo.snapshots)) throw new Error("MERGE_UNDO_UNAVAILABLE");
  if (dateValue(item.merge_undo.expires_at) < Date.now()) throw new Error("MERGE_UNDO_EXPIRED");
  for (const snapshot of item.merge_undo.snapshots) {
    if (!snapshot.doc_id || !snapshot.data) continue;
    await db.collection(COLLECTION).doc(snapshot.doc_id).update({
      ...snapshot.data,
      merge_undo: null,
      merged_into_vocab_id: null,
    });
  }
  return { success: true };
}

function aiConfiguration() {
  const url = String(process.env.VOCAB_AI_API_URL || "").trim();
  const key = String(process.env.VOCAB_AI_API_KEY || "").trim();
  const model = String(process.env.VOCAB_AI_MODEL || "").trim();
  if (!url || !key || !model || !/^https:\/\//i.test(url)) throw new Error("AI_NOT_CONFIGURED");
  return { url, key, model };
}

function jsonFromAiText(value) {
  const source = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI_RESPONSE_INVALID");
  return JSON.parse(source.slice(start, end + 1));
}

function normalizeAiDraft(payload, normalizedWord) {
  const senses = (Array.isArray(payload.senses) ? payload.senses : []).slice(0, 3).map((sense) => ({
    part_of_speech: compactText(sense.part_of_speech || sense.type, 80),
    english_definition: compactText(sense.english_definition || sense.definition, 500),
    chinese_meaning: compactText(sense.chinese_meaning, 300),
  })).filter((sense) => sense.english_definition || sense.chinese_meaning);
  const first = senses[0] || {};
  const record = {
    word: compactText(payload.word || normalizedWord, 120),
    normalized_word: normalizedWord,
    phonetic: compactText(payload.phonetic, 120),
    part_of_speech: compactText(payload.part_of_speech || first.part_of_speech, 120),
    english_definition: compactText(payload.english_definition || first.english_definition, 500),
    chinese_meaning: compactText(payload.chinese_meaning || first.chinese_meaning, 300),
    word_forms: compactText(payload.word_forms, 300),
    senses,
  };
  if (!record.english_definition || !record.chinese_meaning) throw new Error("AI_RESPONSE_INVALID");
  return record;
}

function currentAiAllowance(student) {
  const day = shanghaiDayKey();
  const current = student.vocab_ai_day === day ? Number(student.vocab_ai_count || 0) : 0;
  if (current >= AI_DAILY_LIMIT) throw new Error("AI_DAILY_LIMIT");
  return { day, current };
}

async function useAiAllowance(student) {
  const { day, current } = currentAiAllowance(student);
  await db.collection("students").doc(student._id).update({
    vocab_ai_day: day,
    vocab_ai_count: current + 1,
    updated_at: new Date(),
  });
  return AI_DAILY_LIMIT - current - 1;
}

async function requestAiDraft(student, event) {
  const item = await getOwnedItem(student, compactText(event.vocab_id, 80));
  if (!item) throw new Error("VOCAB_NOT_FOUND");
  const existing = await getLexiconItemOrNull(item.normalized_text);
  if (existing) return { success: true, already_available: true, word: itemView(item, existing) };
  currentAiAllowance(student);
  const config = aiConfiguration();
  const context = compactText((Array.isArray(item.saved_examples) && item.saved_examples[0] && item.saved_examples[0].context) || item.context, 320);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_LOOKUP_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: "You create concise learner dictionary entries. Return JSON only, with word, phonetic, part_of_speech, english_definition, chinese_meaning, word_forms, and senses (up to 3 objects with part_of_speech, english_definition, chinese_meaning). Put the context-relevant sense first, then other common senses. Never include markdown." },
          { role: "user", content: `Word or phrase: ${item.text}\nSaved example: ${context || "(none)"}` },
        ],
      }),
    });
  } catch (_error) {
    throw new Error("AI_LOOKUP_FAILED");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`AI_HTTP_${response.status}`);
  const payload = await response.json();
  const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
  const draft = normalizeAiDraft(jsonFromAiText(content), item.normalized_text);
  const remaining = await useAiAllowance(student);
  const token = crypto.randomBytes(18).toString("hex");
  const pending = { token, draft, expires_at: new Date(Date.now() + 15 * 60 * 1000) };
  await db.collection(COLLECTION).doc(item._id).update({ pending_ai_draft: pending, updated_at: new Date() });
  return { success: true, draft_token: token, draft: lexiconView({ ...draft, source_type: "ai_draft", review_status: "ai_draft" }), remaining_today: remaining };
}

async function confirmAiDraft(student, event) {
  const item = await getOwnedItem(student, compactText(event.vocab_id, 80));
  if (!item) throw new Error("VOCAB_NOT_FOUND");
  const existing = await getLexiconItemOrNull(item.normalized_text);
  if (existing) return { success: true, already_available: true, word: itemView(item, existing) };
  const pending = item.pending_ai_draft;
  if (!pending || pending.token !== compactText(event.draft_token, 80) || dateValue(pending.expires_at) < Date.now()) {
    throw new Error("AI_DRAFT_EXPIRED");
  }
  const now = new Date();
  const record = {
    ...pending.draft,
    lexicon_id: lexiconId(item.normalized_text),
    normalized_word: item.normalized_text,
    source_type: "ai_draft",
    source_name: "AI-generated",
    sources: ["AI-generated"],
    source_url: "",
    verified: false,
    review_status: "ai_draft",
    generated_by_student_uid: student.auth_uid,
    created_at: now,
    updated_at: now,
  };
  const lexiconItem = await cacheLexiconRecord(record);
  await db.collection(COLLECTION).doc(item._id).update({
    pending_ai_draft: null,
    lookup_status: "ready",
    lookup_error: "",
    lookup_retry_after: null,
    updated_at: now,
  });
  return { success: true, word: itemView({ ...item, lookup_status: "ready" }, lexiconItem) };
}

async function reportDictionaryIssue(student, event) {
  const item = await getOwnedItem(student, compactText(event.vocab_id, 80));
  if (!item) throw new Error("VOCAB_NOT_FOUND");
  const lexiconItem = await getLexiconItemOrNull(item.normalized_text);
  if (!lexiconItem) throw new Error("DICTIONARY_NOT_AVAILABLE");
  const existing = await db.collection(DICTIONARY_REPORT_COLLECTION).where({
    student_uid: student.auth_uid,
    normalized_word: item.normalized_text,
    status: "open",
  }).limit(1).get();
  if (existing.data && existing.data[0]) return { success: true, already_reported: true };
  const now = new Date();
  await db.collection(DICTIONARY_REPORT_COLLECTION).add({
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    vocab_id: item.vocab_id,
    lexicon_id: lexiconItem.lexicon_id,
    normalized_word: item.normalized_text,
    reason: compactText(event.reason, 500),
    status: "open",
    created_at: now,
    updated_at: now,
  });
  return { success: true };
}

function reviewUpdate(item, rating) {
  const now = new Date();
  const currentStreak = Math.max(0, Number(item.review_streak || 0));
  let intervalDays;
  let reviewStreak;
  let learningStatus;
  if (rating === "forgot") {
    intervalDays = 1;
    reviewStreak = 0;
    learningStatus = "learning";
  } else if (rating === "fuzzy") {
    intervalDays = 3;
    reviewStreak = 0;
    learningStatus = "learning";
  } else if (rating === "know") {
    reviewStreak = currentStreak + 1;
    intervalDays = reviewStreak >= 3 ? 30 : (reviewStreak === 2 ? 14 : 7);
    learningStatus = reviewStreak >= 3 ? "mastered" : "learning";
  } else {
    throw new Error("REVIEW_RATING_INVALID");
  }
  return {
    learning_status: learningStatus,
    review_interval_days: intervalDays,
    review_streak: reviewStreak,
    last_reviewed_at: now,
    review_due_at: new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000),
    updated_at: now,
  };
}

async function reviewWord(student, event) {
  const vocabId = compactText(event.vocab_id, 80);
  if (!vocabId) throw new Error("VOCAB_ID_REQUIRED");
  const item = await getOwnedItem(student, vocabId);
  if (!item) throw new Error("VOCAB_NOT_FOUND");
  const update = reviewUpdate(item, compactText(event.rating, 20));
  await db.collection(COLLECTION).doc(item._id).update(update);
  const lexiconItem = await getLexiconItemOrNull(item.normalized_text);
  return { success: true, word: itemView({ ...item, ...update }, lexiconItem) };
}

async function setLearningStatus(student, event) {
  const vocabId = compactText(event.vocab_id, 80);
  if (!vocabId) throw new Error("VOCAB_ID_REQUIRED");
  const learningStatus = compactText(event.learning_status, 20);
  if (!["new", "learning", "mastered"].includes(learningStatus)) throw new Error("LEARNING_STATUS_INVALID");
  const item = await getOwnedItem(student, vocabId);
  if (!item) throw new Error("VOCAB_NOT_FOUND");
  const now = new Date();
  const update = {
    learning_status: learningStatus,
    review_due_at: learningStatus === "mastered" ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) : now,
    review_interval_days: learningStatus === "mastered" ? 30 : 0,
    review_streak: learningStatus === "mastered" ? Math.max(3, Number(item.review_streak || 0)) : 0,
    updated_at: now,
  };
  await db.collection(COLLECTION).doc(item._id).update(update);
  const lexiconItem = await getLexiconItemOrNull(item.normalized_text);
  return { success: true, word: itemView({ ...item, ...update }, lexiconItem) };
}

async function deleteWord(student, event) {
  const vocabId = compactText(event.vocab_id, 80);
  if (!vocabId) throw new Error("VOCAB_ID_REQUIRED");
  const item = await getOwnedItem(student, vocabId);
  if (!item) throw new Error("VOCAB_NOT_FOUND");
  await db.collection(COLLECTION).doc(item._id).remove();
  return { success: true, vocab_id: vocabId };
}

function errorMessage(code) {
  if (code === "AUTH_REQUIRED") return "Please log in to save words.";
  if (code === "STUDENT_REQUIRED") return "Only student accounts can save personal words.";
  if (code === "STUDENT_NOT_LINKED") return "This login is not linked to an active student.";
  if (code === "VOCABULARY_TEST_DEVICE_BLOCKED") return "This account is taking a vocabulary test on another device or browser tab. Please finish that test first.";
  if (code === "TEXT_REQUIRED") return "Select a word or short phrase first.";
  if (code === "TEXT_TOO_LONG") return "Please save one word or a short phrase at a time.";
  if (code === "TEXT_INVALID") return "Select a word or phrase with letters or numbers.";
  if (code === "VOCAB_ID_REQUIRED") return "Word ID is required.";
  if (code === "VOCAB_NOT_FOUND") return "This word was not found in your list.";
  if (code === "MERGE_REQUIRED") return "Review the matching word before merging.";
  if (code === "MERGE_SELECTION_INVALID") return "Choose related word forms from the same merge group.";
  if (code === "MERGE_UNDO_UNAVAILABLE" || code === "MERGE_UNDO_EXPIRED") return "This merge can no longer be undone.";
  if (code === "AI_NOT_CONFIGURED") return "AI dictionary help is not configured yet.";
  if (code === "AI_DAILY_LIMIT") return "You have reached today's AI dictionary limit.";
  if (code === "AI_DRAFT_EXPIRED") return "This AI preview expired. Please create a new one.";
  if (code === "AI_LOOKUP_FAILED" || code === "AI_RESPONSE_INVALID" || /^AI_HTTP_/.test(code)) return "AI dictionary help is unavailable right now.";
  if (code === "DICTIONARY_NOT_AVAILABLE") return "Dictionary details are not available to report.";
  if (code === "REVIEW_RATING_INVALID") return "Choose Forgot, A little, or Know.";
  if (code === "LEARNING_STATUS_INVALID") return "Choose a valid learning status.";
  return `Unable to update your word list (${code || "VOCAB_ERROR"}).`;
}

exports.main = async (event = {}) => {
  try {
    const student = await getAuthenticatedStudent();
    await assertNoOtherActiveVocabularyTest(student, event);
    const action = compactText(event.action || "list", 40);
    if (action === "add") return await addWord(student, event);
    if (action === "list") return await listWords(student, event);
    if (action === "archive") return await setStatus(student, event, "archived");
    if (action === "restore") return await setStatus(student, event, "active");
    if (action === "delete") return await deleteWord(student, event);
    if (action === "enrich") return await enrichWord(student, event);
    if (action === "review") return await reviewWord(student, event);
    if (action === "setLearningStatus") return await setLearningStatus(student, event);
    if (action === "updateNote") return await updateNote(student, event);
    if (action === "updateWord") return await updateWord(student, event);
    if (action === "mergeWords") return await mergeWords(student, event);
    if (action === "undoMerge") return await undoMerge(student, event);
    if (action === "requestAiDraft") return await requestAiDraft(student, event);
    if (action === "confirmAiDraft") return await confirmAiDraft(student, event);
    if (action === "reportDictionaryIssue") return await reportDictionaryIssue(student, event);
    throw new Error("UNKNOWN_ACTION");
  } catch (error) {
    const code = String(error && error.message || "VOCAB_ERROR");
    return {
      success: false,
      code,
      message: errorMessage(code),
      words: [],
    };
  }
};
