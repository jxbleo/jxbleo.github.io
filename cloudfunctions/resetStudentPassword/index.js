const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

exports.main = async () => {
  return {
    success: false,
    code: "TEACHER_ADMIN_REQUIRED",
    message: "Password reset is disabled until a server-side teacher authorization policy is configured.",
  };
};
