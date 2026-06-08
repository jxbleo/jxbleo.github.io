const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const contentRoot = path.join(projectRoot, "content");
const sectionsPath = path.join(contentRoot, "sections.json");
const outputPath = path.join(projectRoot, "data", "home-catalog.json");
const fallbackOutputPath = path.join(projectRoot, "data", "home-catalog.js");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function getSectionMap() {
  const sectionData = readJson(sectionsPath);
  const sections = sectionData.sections || [];
  const map = new Map();
  sections.forEach((section) => map.set(section.id, section));
  return { sections, map };
}

function listItemFiles() {
  const sectionDirs = fs
    .readdirSync(contentRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "templates")
    .map((entry) => path.join(contentRoot, entry.name));

  const files = [];
  sectionDirs.forEach((dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(path.join(dir, entry.name));
      }
    });
  });
  return files.sort();
}

function buildTitle(item, section) {
  if (section.titleMode === "id_title") {
    return `${item.id} · ${item.title}`;
  }
  if (section.titleMode === "id") {
    return item.id;
  }
  return item.title;
}

function buildDisplayValue(item, section) {
  if (section.sortType === "date_desc") {
    return item.publishedOn || item.displayValue || item.id;
  }
  return item.displayValue || item.id;
}

function buildSortValue(item, section) {
  if (section.sortType === "date_desc") {
    return item.publishedOn || item.sortValue || "";
  }
  if (section.sortType === "number_asc" || section.sortType === "number_desc") {
    return item.sortOrder != null ? item.sortOrder : 0;
  }
  return item.sortValue || item.id;
}

function buildCatalogItem(item, section) {
  return {
    id: item.id,
    sectionId: item.sectionId,
    title: buildTitle(item, section),
    href: item.href,
    displayValue: buildDisplayValue(item, section),
    sortValue: buildSortValue(item, section),
    topic: item.topic || "",
    tags: item.tags || [],
    note: item.note || "",
    visible: item.visible !== false,
  };
}

function main() {
  const { sections, map } = getSectionMap();
  const itemFiles = listItemFiles();
  const items = itemFiles.map((filePath) => {
    const item = readJson(filePath);
    const section = map.get(item.sectionId);
    if (!section) {
      throw new Error(`Unknown sectionId "${item.sectionId}" in ${filePath}`);
    }
    return buildCatalogItem(item, section);
  });

  const catalog = { sections, items };
  fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + "\n");
  fs.writeFileSync(
    fallbackOutputPath,
    "window.__HOME_CATALOG__ = " + JSON.stringify(catalog, null, 2) + ";\n"
  );
  console.log(`Updated ${path.relative(projectRoot, outputPath)}`);
  console.log(`Updated ${path.relative(projectRoot, fallbackOutputPath)}`);
}

main();
