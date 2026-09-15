#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const rules = require("../cloudfunctions/_shared/ielts-speaking");
const root = path.resolve(__dirname, "..");
const output = path.join(root, ".cloudbase-private/import/ielts-speaking-sets-cloudbase.json");
function prepare(raw) {
  if (!Array.isArray(raw) || raw.length > 5000) throw new Error("Expected an array of reviewed topic cards (maximum 5000).");
  const rows = raw.map(rules.normalizeSet);
  if (new Set(rows.map(row => row.set_id)).size !== rows.length) throw new Error("Duplicate IELTS Set ID.");
  return rows;
}
function main(args) {
  const flags = new Set(["--source", "--write"]);
  for (let i = 0; i < args.length; i++) { if (!flags.has(args[i])) throw new Error("Use --source <reviewed-private-json> [--write]."); if (args[i] === "--source") i++; }
  const index = args.indexOf("--source");
  const source = index >= 0 ? args[index + 1] : path.join(root, ".cloudbase-private/sources/ielts-speaking.json");
  if (!source || !fs.existsSync(source)) {
    console.log("IELTS source not supplied: 0 topic cards prepared. The source index is content/speaking/ielts-source-index.json. Existing import files were not changed.");
    if (index >= 0 || args.includes("--write")) process.exitCode = 1;
    return;
  }
  const rows = prepare(JSON.parse(fs.readFileSync(source, "utf8")));
  if (!rows.length) throw new Error("No reviewed topic cards. Refusing to replace the prepared import with an empty file.");
  if (args.includes("--write")) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const temporary = `${output}.tmp`;
    fs.writeFileSync(temporary, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    fs.renameSync(temporary, output);
  }
  console.log(JSON.stringify({ mode: args.includes("--write") ? "prepared-local-only" : "dry-run", topic_cards: rows.length, part_2: rows.length, part_3: rows.reduce((count, row) => count + row.part_3.length, 0), set_ids: rows.map(row => row.set_id) }));
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { prepare };
