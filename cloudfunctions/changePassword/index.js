const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

exports.main = async () => {
  return {
    success: false,
    code: "USE_AUTH_SDK",
    message: "Password changes must use the authenticated CloudBase user password API.",
  };
};
