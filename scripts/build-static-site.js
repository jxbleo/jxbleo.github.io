const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const manifest = require("./static-site-manifest.json");
const { loadRelease } = require("./handout-store");
const { renderRelease: renderHandouts } = require("./render-handouts");
const { OUTPUT: topicBankFile, renderTopicBank, validateBlueprint } = require("./render-topic-bank");
const { synchronize: synchronizeShareHeader } = require("./share-header");

function isPublicSource(source) {
  const relative = path.relative(root, source).split(path.sep).join("/");
  return !manifest.excludedPaths.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
}

function copy(source, destination) {
  fs.cpSync(source, destination, { recursive: true, filter: isPublicSource });
}

// Validate the complete source list before replacing the previous artifact.
for (const [entries, type] of [[manifest.directories, "directory"], [manifest.rootFiles, "file"]]) {
  if (new Set(entries).size !== entries.length) throw new Error(`Duplicate public ${type} in static manifest`);
  for (const entry of entries) {
    if (entry !== path.basename(entry) || entry.startsWith(".")) throw new Error(`Invalid public ${type}: ${entry}`);
    const source = path.join(root, entry);
    const stat = fs.existsSync(source) && fs.lstatSync(source);
    if (!stat || (type === "directory" ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Required public ${type} is missing: ${entry}`);
    }
  }
}

// Authenticate all source and validate the complete stable map BEFORE touching dist.
// A missing CI secret must never produce an artifact that retires valid links.
const release = loadRelease(root);
const handouts = renderHandouts(release);
if (!manifest.rootFiles.includes(topicBankFile) || !validateBlueprint(fs.readFileSync(path.join(root, topicBankFile), "utf8"))) {
  throw new Error("Topic-bank build entry is missing or invalid; publication stopped.");
}
const topicBank = renderTopicBank(release.files);
// Render marked public readers before replacing dist; malformed components fail closed.
const sharedReaders = new Map();
for (const file of manifest.rootFiles.filter(file => file.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  if (html.includes("data-share-header=")) sharedReaders.set(file, synchronizeShareHeader(html));
}
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const directory of manifest.directories) {
  const source = path.join(root, directory);
  copy(source, path.join(output, directory));
}

for (const file of manifest.rootFiles) {
  if (file === topicBankFile) fs.writeFileSync(path.join(output, file), topicBank);
  else if (sharedReaders.has(file)) fs.writeFileSync(path.join(output, file), sharedReaders.get(file));
  else copy(path.join(root, file), path.join(output, file));
}
try {
  for (const [file, html] of handouts) fs.writeFileSync(path.join(output, file), html);
} catch (_) {
  // CI logs are public; never include a native error's private object path.
  throw new Error('Unable to write independent handout output; publication stopped.');
}

if (!fs.existsSync(path.join(output, "index.html"))) {
  throw new Error("Static output is missing index.html");
}

console.log(`Static site prepared in ${path.relative(root, output)}/ with ${handouts.size} independent handouts.`);
