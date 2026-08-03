const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const READ_PAGE_LIMIT = 500;

async function getAll(collection, options = {}) {
  const pageSize = Number(options.pageSize || READ_PAGE_LIMIT);
  let offset = 0;
  const output = [];
  while (true) {
    let query = db.collection(collection);
    if (options.where) query = query.where(options.where);
    if (options.orderBy) query = query.orderBy(options.orderBy.field, options.orderBy.direction || "asc");
    const result = await query.skip(offset).limit(pageSize).get();
    const rows = result.data || [];
    output.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return output;
}

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
    edition_family: item.edition_family || "",
    edition_number: item.edition_number == null ? null : Number(item.edition_number),
    edition_label: item.edition_label || "",
    is_latest_edition: item.is_latest_edition === true,
    content_version: item.content_version == null ? null : String(item.content_version),
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
    const resources = await getAll("sets", {
      where: { visible: true },
      orderBy: { field: "title", direction: "asc" },
    });

    return {
      success: true,
      resources: uniqueResources(resources),
    };
  } catch (error) {
    return { success: false, code: "RESOURCE_ERROR", message: "Unable to load resources.", resources: [] };
  }
};
