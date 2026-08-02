const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const VOCABULARY_TEST_SESSION_COLLECTION = "vocabulary_test_sessions";
const VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS = 60 * 1000;

async function getAuthenticatedUid() {
  const userInfo = await app.auth().getUserInfo();
  const uid = userInfo && (userInfo.uid || userInfo.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");
  return String(uid);
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

async function markSessionAbandoned(session, reason) {
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
      await markSessionAbandoned(session, "time_expired");
      continue;
    }
    if (lastSeen && now.getTime() - lastSeen > VOCABULARY_TEST_HEARTBEAT_TIMEOUT_MS) {
      await markSessionAbandoned(session, "heartbeat_timeout");
      continue;
    }
    active.push(session);
  }
  return active;
}

async function assertNoOtherActiveVocabularyTest(student, event) {
  if ((student.role || "student") !== "student") return;
  const instanceId = clientInstanceId(event);
  const active = await activeVocabularySessions(student.auth_uid);
  const other = active.find((session) => !isSameInstance(session, instanceId));
  if (other) throw new Error("VOCABULARY_TEST_DEVICE_BLOCKED");
}

exports.main = async (event = {}) => {
  try {
    const uid = await getAuthenticatedUid();
    const result = await db.collection("students").where({
      auth_uid: uid,
      active: true,
    }).limit(1).get();
    const student = result.data && result.data[0];

    if (!student) {
      return { success: false, code: "STUDENT_NOT_LINKED", message: "This login is not linked to an active student." };
    }
    await assertNoOtherActiveVocabularyTest(student, event);

    return {
      success: true,
      student: {
        student_id: student.student_id,
        name: student.name,
        class_group: student.class_group || "",
        curriculum_track: student.curriculum_track || "",
        must_change_password: student.must_change_password === true,
        role: student.role || "student",
      },
    };
  } catch (error) {
    if (error.message === "VOCABULARY_TEST_DEVICE_BLOCKED") {
      return {
        success: false,
        code: "VOCABULARY_TEST_DEVICE_BLOCKED",
        message: "This account is taking a vocabulary test on another device or browser tab. Please finish that test first.",
      };
    }
    return {
      success: false,
      code: error.message === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : "PROFILE_ERROR",
      message: error.message === "AUTH_REQUIRED" ? "Please log in." : "Unable to load the student profile.",
    };
  }
};
