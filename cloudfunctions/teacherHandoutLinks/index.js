"use strict";

const fs = require("fs");
const path = require("path");
const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const LINK_PATTERN = /^h-[a-f0-9]{48}\.html$/;

async function requireTeacher() {
  const userInfo = await app.auth().getUserInfo();
  const uid = userInfo && (userInfo.uid || userInfo.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");
  const result = await db.collection("students").where({
    auth_uid: String(uid), active: true, role: "teacher",
  }).limit(1).get();
  const profile = result.data && result.data[0];
  if (!profile || profile.auth_uid !== String(uid) || profile.active !== true || profile.role !== "teacher") {
    throw new Error("TEACHER_REQUIRED");
  }
}

function readDirectory() {
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "handout-links.private.json"), "utf8"));
  } catch (_) {
    throw new Error("LINKS_UNAVAILABLE");
  }
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.items) || catalog.items.length > 256) {
    throw new Error("LINKS_UNAVAILABLE");
  }
  const ids = new Set();
  const links = new Set();
  return catalog.items.map(item => {
    if (!item || item.category !== "study" || typeof item.href !== "string" || !LINK_PATTERN.test(item.href) || ids.has(item.id) || links.has(item.href)) {
      throw new Error("LINKS_UNAVAILABLE");
    }
    for (const field of ["id", "title", "topic", "description", "access"]) {
      if (typeof item[field] !== "string" || !item[field].trim() || item[field].length > 1000) {
        throw new Error("LINKS_UNAVAILABLE");
      }
    }
    ids.add(item.id);
    links.add(item.href);
    return { id: item.id, category: "study", title: item.title, topic: item.topic,
      description: item.description, access: item.access, href: item.href };
  });
}

exports.main = async (event = {}) => {
  try {
    await requireTeacher();
    if (!event || event.action !== "list") throw new Error("INVALID_ACTION");
    return { success: true, schemaVersion: 1, items: readDirectory() };
  } catch (error) {
    const messages = {
      AUTH_REQUIRED: "请先登录教师账号。",
      TEACHER_REQUIRED: "仅在用教师账号可以查看独立讲义链接。",
      INVALID_ACTION: "不支持此操作。",
      LINKS_UNAVAILABLE: "独立讲义链接暂时不可用，请稍后重试。",
    };
    const code = Object.prototype.hasOwnProperty.call(messages, error && error.message) ? error.message : "LINKS_UNAVAILABLE";
    return { success: false, code, message: messages[code] };
  }
};
