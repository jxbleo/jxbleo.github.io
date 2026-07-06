const crypto = require("crypto");
const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const COLLECTION = "student_vocabulary_items";
const VOCABULARY_TEST_SESSION_COLLECTION = "vocabulary_test_sessions";
const VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS = 30 * 1000;

function compactText(value, limit) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function normalizeVocabularyText(value) {
  return compactText(value, 160).toLowerCase();
}

function hasWordCharacter(value) {
  return /[\p{L}\p{N}]/u.test(value);
}

function validationErrorForText(value) {
  const text = compactText(value, 160);
  if (!text) return "TEXT_REQUIRED";
  if (text.length < 2) return "TEXT_TOO_SHORT";
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

function itemView(item) {
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
  };
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
    return {
      success: true,
      created: false,
      word: itemView({
        ...existing,
        ...update,
        times_added: Number(existing.times_added || 1) + 1,
      }),
    };
  }

  const record = {
    vocab_id: vocabId,
    student_uid: student.auth_uid,
    student_id_snapshot: student.student_id,
    times_added: 1,
    created_at: now,
    ...update,
  };
  await db.collection(COLLECTION).add(record);
  return {
    success: true,
    created: true,
    word: itemView(record),
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
  return {
    success: true,
    words: (result.data || []).map(itemView),
  };
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
  if (code === "TEXT_TOO_SHORT") return "Select a longer word or phrase.";
  if (code === "TEXT_TOO_LONG") return "Please save one word or a short phrase at a time.";
  if (code === "TEXT_INVALID") return "Select a word or phrase with letters or numbers.";
  if (code === "VOCAB_ID_REQUIRED") return "Word ID is required.";
  if (code === "VOCAB_NOT_FOUND") return "This word was not found in your list.";
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
