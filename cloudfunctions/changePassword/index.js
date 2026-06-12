const cloudbase = require("@cloudbase/node-sdk");
const CloudBaseManager = require("@cloudbase/manager-node");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const envId = process.env.TENCENTCLOUD_TCB_ENVID || "mrcat-dev-d9gwy2v1icdfdf597";
const manager = CloudBaseManager.init({ envId });

function text(value) {
  return String(value == null ? "" : value).trim();
}

exports.main = async (event = {}) => {
  try {
    const userInfo = await app.auth().getUserInfo();
    const uid = userInfo && (userInfo.uid || userInfo.userId);
    if (!uid) throw new Error("AUTH_REQUIRED");
    const password = text(event.new_password);
    if (password.length < 6) throw new Error("PASSWORD_TOO_SHORT");

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
    return {
      success: false,
      code: error.message || "CHANGE_PASSWORD_FAILED",
      message: error.message === "PASSWORD_TOO_SHORT"
        ? "Password must be at least 6 characters."
        : `Unable to change password (${error.message || "CHANGE_PASSWORD_FAILED"}).`,
    };
  }
};
