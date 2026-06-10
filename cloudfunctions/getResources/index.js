const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

exports.main = async () => {
  try {
    const result = await db.collection("sets")
      .where({ visible: true })
      .orderBy("title", "asc")
      .limit(500)
      .get();

    return {
      success: true,
      resources: (result.data || []).map((item) => ({
        set_id: item.set_id,
        section_id: item.section_id || "",
        title: item.title,
        type: item.type || "",
        course: item.course || "",
        link: item.link,
        difficulty: item.difficulty || "",
        estimated_minutes: item.estimated_minutes || null,
      })),
    };
  } catch (error) {
    return { success: false, code: "RESOURCE_ERROR", message: "Unable to load resources.", resources: [] };
  }
};
