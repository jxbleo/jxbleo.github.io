const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const COLLECTION = "student_vocabulary_items";
const LEXICON_COLLECTION = "vocabulary_lexicon";
const VOCABULARY_TEST_SESSION_COLLECTION = "vocabulary_test_sessions";
const VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS = 30 * 1000;
const DICTIONARY_LOOKUP_TIMEOUT_MS = 4000;

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
    times_added: Number(item.times_added || 1),
    created_at: item.created_at || null,
    updated_at: item.updated_at || null,
    last_added_at: item.last_added_at || null,
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

async function addWord(student, event) {
  const error = validationErrorForText(event.text);
  if (error) throw new Error(error);

  const text = compactText(event.text, 120);
  const normalizedText = normalizeVocabularyText(text);
  const vocabId = vocabularyId(student.auth_uid, normalizedText);
  const now = new Date();
  const sourceSetId = compactText(event.source_set_id, 80) || null;
  const update = {
    text,
    normalized_text: normalizedText,
    status: "active",
    source_set_id: sourceSetId,
    source_title: compactText(event.source_title, 160),
    source_path: compactText(event.source_path, 300),
    context: compactText(event.context, 320),
    last_added_at: now,
    updated_at: now,
  };

  const existing = await getOwnedItem(student, vocabId);
  if (existing) {
    await db.collection(COLLECTION).doc(existing._id).update({
      ...update,
      times_added: Number(existing.times_added || 1) + 1,
    });
    const nextItem = {
      ...existing,
      ...update,
      lookup_status: existing.lookup_status || "pending",
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
  const lexicon = await lexiconMapForItems(result.data || []);
  return {
    success: true,
    words: (result.data || []).map((item) => itemView(item, lexicon[item.normalized_text])),
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
