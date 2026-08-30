const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const publicDirectories = ["assets", "bbc-audio", "content", "data"];
const publicRootExtensions = new Set([".html", ".webmanifest"]);
const privateStaticPrefixes = ["content/speaking"];

function isPublicSource(source) {
  const relative = path.relative(root, source).split(path.sep).join("/");
  return !privateStaticPrefixes.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
}

function copy(source, destination) {
  fs.cpSync(source, destination, { recursive: true, filter: isPublicSource });
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const directory of publicDirectories) {
  const source = path.join(root, directory);
  if (!fs.existsSync(source)) {
    throw new Error(`Required public directory is missing: ${directory}`);
  }
  copy(source, path.join(output, directory));
}

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isFile() || !publicRootExtensions.has(path.extname(entry.name))) {
    continue;
  }
  copy(path.join(root, entry.name), path.join(output, entry.name));
}

if (!fs.existsSync(path.join(output, "index.html"))) {
  throw new Error("Static output is missing index.html");
}

console.log(`Static site prepared in ${path.relative(root, output)}/`);
