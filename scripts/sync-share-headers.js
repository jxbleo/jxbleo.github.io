"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { synchronize } = require("./share-header");
const root = path.resolve(__dirname, "..");
const { rootFiles } = require("./static-site-manifest.json");
let count = 0;
let stale = 0;
for (const file of rootFiles.filter(file => file.endsWith(".html"))) {
  const fullPath = path.join(root, file);
  const html = fs.readFileSync(fullPath, "utf8");
  if (!html.includes("data-share-header=")) continue;
  count += 1;
  const next = synchronize(html);
  if (next === html) continue;
  stale += 1;
  if (!process.argv.includes("--check")) fs.writeFileSync(fullPath, next);
}
if (stale && process.argv.includes("--check")) {
  throw new Error(`${stale} shared readers need node scripts/sync-share-headers.js`);
}
console.log(`Shared toolbar checked across ${count} source readers.`);
