const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.join(projectRoot, "data");
const contentDir = path.join(projectRoot, "content", "bbc-six-minute-english");

const BBC_LUMINOUS_MILK_THEMES = [
  "milk-sage",
  "milk-blue",
  "milk-pink",
  "milk-purple",
];

// Keep this seed stable: changing it would recolor already published lessons.
const ASSIGNMENT_SEED = "mrcat-bbc-milk-v1-26:";

function renderThemeForBbcSetId(setId) {
  const normalized = String(setId || "").trim().toUpperCase();
  if (!/^BBC-\d{6}(?:-.+)?$/.test(normalized)) {
    throw new Error(`Invalid BBC set id: ${setId}`);
  }
  const digest = crypto.createHash("sha256").update(`${ASSIGNMENT_SEED}${normalized}`).digest();
  return BBC_LUMINOUS_MILK_THEMES[digest[0] % BBC_LUMINOUS_MILK_THEMES.length];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function withRenderTheme(record, renderTheme, insertAfter) {
  const output = {};
  let inserted = false;
  Object.entries(record).forEach(([key, value]) => {
    if (key === "renderTheme") return;
    output[key] = value;
    if (key === insertAfter) {
      output.renderTheme = renderTheme;
      inserted = true;
    }
  });
  if (!inserted) output.renderTheme = renderTheme;
  return output;
}

function listYearSetIds(dirPath, shortYear) {
  const pattern = new RegExp(`^BBC-${shortYear}\\d{4}\\.json$`);
  return fs.readdirSync(dirPath)
    .filter((fileName) => pattern.test(fileName))
    .map((fileName) => fileName.replace(/\.json$/, ""))
    .sort();
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assignYear(year, options = {}) {
  const fullYear = String(year || "2026");
  if (!/^20\d{2}$/.test(fullYear)) throw new Error(`Expected a four-digit year, received ${year}`);
  const shortYear = fullYear.slice(2);
  const runtimeIds = listYearSetIds(dataDir, shortYear);
  const metadataIds = listYearSetIds(contentDir, shortYear);
  if (!sameValues(runtimeIds, metadataIds)) {
    const runtimeOnly = runtimeIds.filter((id) => !metadataIds.includes(id));
    const metadataOnly = metadataIds.filter((id) => !runtimeIds.includes(id));
    throw new Error(`BBC ${fullYear} runtime/metadata mismatch; runtime only: ${runtimeOnly.join(", ") || "none"}; metadata only: ${metadataOnly.join(", ") || "none"}`);
  }
  if (!runtimeIds.length) throw new Error(`No BBC ${fullYear} lessons found`);

  const rows = runtimeIds.map((id) => {
    const renderTheme = renderThemeForBbcSetId(id);
    const runtimePath = path.join(dataDir, `${id}.json`);
    const metadataPath = path.join(contentDir, `${id}.json`);
    const runtime = readJson(runtimePath);
    const metadata = readJson(metadataPath);
    const matches = runtime.renderTheme === renderTheme && metadata.renderTheme === renderTheme;
    if (!options.checkOnly) {
      fs.writeFileSync(runtimePath, `${JSON.stringify(withRenderTheme(runtime, renderTheme, "title"), null, 2)}\n`);
      fs.writeFileSync(metadataPath, `${JSON.stringify(withRenderTheme(metadata, renderTheme, "href"), null, 2)}\n`);
    }
    return { id, renderTheme, matches };
  });

  if (options.checkOnly) {
    const mismatches = rows.filter((row) => !row.matches);
    if (mismatches.length) {
      throw new Error(`Theme assignment mismatch: ${mismatches.map((row) => row.id).join(", ")}`);
    }
  }
  return rows;
}

function summarize(rows) {
  const counts = Object.fromEntries(BBC_LUMINOUS_MILK_THEMES.map((theme) => [theme, 0]));
  rows.forEach((row) => { counts[row.renderTheme] += 1; });
  return BBC_LUMINOUS_MILK_THEMES.map((theme) => `${theme}=${counts[theme]}`).join(", ");
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const year = args.find((arg) => /^20\d{2}$/.test(arg)) || "2026";
  const rows = assignYear(year, { checkOnly });
  console.log(`${checkOnly ? "Verified" : "Assigned"} ${rows.length} BBC ${year} lessons: ${summarize(rows)}`);
  rows.forEach((row) => console.log(`${row.id} ${row.renderTheme}`));
}

if (require.main === module) main();

module.exports = {
  ASSIGNMENT_SEED,
  BBC_LUMINOUS_MILK_THEMES,
  assignYear,
  renderThemeForBbcSetId,
};
