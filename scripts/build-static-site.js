const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const manifest = require("./static-site-manifest.json");

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

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const directory of manifest.directories) {
  const source = path.join(root, directory);
  copy(source, path.join(output, directory));
}

for (const file of manifest.rootFiles) {
  copy(path.join(root, file), path.join(output, file));
}

if (!fs.existsSync(path.join(output, "index.html"))) {
  throw new Error("Static output is missing index.html");
}

console.log(`Static site prepared in ${path.relative(root, output)}/`);
