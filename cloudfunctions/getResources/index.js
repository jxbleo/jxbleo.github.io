const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

function resourceView(item) {
  return {
    set_id: item.set_id,
    section_id: item.section_id || "",
    title: item.title,
    type: item.type || "",
    course: item.course || "",
    link: item.link,
    difficulty: item.difficulty || "",
    estimated_minutes: item.estimated_minutes || null,
  };
}

function uniqueResources(items) {
  const seen = new Set();
  const resources = [];
  (items || []).forEach((item) => {
    const key = String(item.set_id || item._id || "").trim();
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    resources.push(resourceView(item));
  });
  return resources;
}

exports.main = async () => {
  try {
    const result = await db.collection("sets")
      .where({ visible: true })
      .orderBy("title", "asc")
      .limit(500)
      .get();

    return {
      success: true,
      resources: uniqueResources(result.data || []),
    };
  } catch (error) {
    return { success: false, code: "RESOURCE_ERROR", message: "Unable to load resources.", resources: [] };
  }
};
