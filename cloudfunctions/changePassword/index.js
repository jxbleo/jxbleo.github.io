const cloudbase = require("@cloudbase/node-sdk");
const CloudBaseManager = require("@cloudbase/manager-node");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const envId = process.env.TENCENTCLOUD_TCB_ENVID || "mrcat-dev-d9gwy2v1icdfdf597";
const manager = CloudBaseManager.init({ envId });

function text(value) {
  return String(value == null ? "" : value).trim();
}

function passwordValidationMessage(password) {
  if (password.length < 6) {
    return "Password must be at least 6 characters.";
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return "Use uppercase and lowercase letters, a number, and a symbol. A short example is Aa_888.";
  }
  if (/^(.)\1+$/.test(password)) {
    return "Please avoid passwords made from one repeated character.";
  }
  return "";
}

function passwordErrorMessage(error) {
  const raw = String((error && error.message) || error || "");
  if (raw === "PASSWORD_TOO_WEAK" || /pwd is weak/i.test(raw)) {
    return "This password is too weak. Use uppercase and lowercase letters, a number, and a symbol. A short example is Aa_888.";
  }
  return `Unable to change password (${raw || "CHANGE_PASSWORD_FAILED"}).`;
}

exports.main = async (event = {}) => {
  try {
    const userInfo = await app.auth().getUserInfo();
    const uid = userInfo && (userInfo.uid || userInfo.userId);
    if (!uid) throw new Error("AUTH_REQUIRED");
    const password = text(event.new_password);
    if (passwordValidationMessage(password)) throw new Error("PASSWORD_TOO_WEAK");

    const result = await db.collection("students").where({
      auth_uid: String(uid),
      active: true,
    }).limit(1).get();
    const profile = result.data && result.data[0];
    if (!profile) throw new Error("PROFILE_NOT_FOUND");

    await manager.user.modifyEndUser({
      uuid: String(uid),
      password,
    });
    await db.collection("students").doc(profile._id).update({
      must_change_password: false,
      updated_at: new Date(),
    });
    return { success: true };
  } catch (error) {
    const raw = String((error && error.message) || error || "");
    return {
      success: false,
      code: raw || "CHANGE_PASSWORD_FAILED",
      message: raw === "PASSWORD_TOO_WEAK"
        ? passwordValidationMessage(text(event.new_password)) || passwordErrorMessage(error)
        : passwordErrorMessage(error),
    };
  }
};
