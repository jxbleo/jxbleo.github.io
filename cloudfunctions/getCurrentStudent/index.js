const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

async function getAuthenticatedUid() {
  const userInfo = await app.auth().getUserInfo();
  const uid = userInfo && (userInfo.uid || userInfo.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");
  return String(uid);
}

exports.main = async () => {
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
    return {
      success: false,
      code: error.message === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : "PROFILE_ERROR",
      message: error.message === "AUTH_REQUIRED" ? "Please log in." : "Unable to load the student profile.",
    };
  }
};
