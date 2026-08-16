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
  if (section.sortType === "date_desc" || section.sortType === "date_asc") {
    return item.publishedOn || item.displayValue || item.id;
  }
  return item.displayValue || item.id;
}

function buildSortValue(item, section) {
  if (section.sortType === "date_desc" || section.sortType === "date_asc") {
    return item.publishedOn || item.sortValue || "";
  }
  if (section.sortType === "number_asc" || section.sortType === "number_desc") {
    return item.sortOrder != null ? item.sortOrder : 0;
  }
  return item.sortValue || item.id;
}

function buildCatalogItem(item, section) {
  const catalogItem = {
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
  if (item.access && item.access !== "public") catalogItem.access = item.access;
  if (item.edition_family) {
    catalogItem.edition_family = item.edition_family;
    catalogItem.edition_number = Number(item.edition_number || 1);
    catalogItem.edition_label = item.edition_label || `V${catalogItem.edition_number}`;
    catalogItem.is_latest_edition = item.is_latest_edition === true;
  }
  return catalogItem;
}

function validateEditionFamilies(items) {
  const families = new Map();
  items.filter((item) => item.edition_family).forEach((item) => {
    const familyItems = families.get(item.edition_family) || [];
    familyItems.push(item);
    families.set(item.edition_family, familyItems);
  });
  families.forEach((familyItems, family) => {
    const versionNumbers = new Set();
    familyItems.forEach((item) => {
      if (!Number.isInteger(item.edition_number) || item.edition_number < 1) {
        throw new Error(`Edition family ${family} has an invalid edition_number on ${item.id}`);
      }
      if (versionNumbers.has(item.edition_number)) {
        throw new Error(`Edition family ${family} repeats edition_number ${item.edition_number}`);
      }
      versionNumbers.add(item.edition_number);
    });
    if (familyItems.length > 1) {
      const latest = familyItems.filter((item) => item.is_latest_edition === true);
      if (latest.length !== 1) {
        throw new Error(`Edition family ${family} must have exactly one latest edition; found ${latest.length}`);
      }
    }
  });
}

function main() {
  const { sections, map } = getSectionMap();
  const itemFiles = listItemFiles();
  const items = itemFiles.filter((filePath) => {
    const item = readJson(filePath);
    return item.catalogVisible !== false;
  }).map((filePath) => {
    const item = readJson(filePath);
    const section = map.get(item.sectionId);
    if (!section) {
      throw new Error(`Unknown sectionId "${item.sectionId}" in ${filePath}`);
    }
    return buildCatalogItem(item, section);
  });
  validateEditionFamilies(items);

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
