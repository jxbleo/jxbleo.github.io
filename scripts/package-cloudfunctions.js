#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const functionsRoot = path.join(root, "cloudfunctions");
const outputRoot = path.join(root, "deploy-packages");

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const requested = args.filter((arg) => !arg.startsWith("--"));
const dryRun = flags.has("--dry-run");
const packageAll = flags.has("--all");

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8",
    ...options
  });
}

function listFunctions() {
  if (!fs.existsSync(functionsRoot)) return [];

  return fs.readdirSync(functionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      return fs.existsSync(path.join(functionsRoot, name, "index.js")) &&
        fs.existsSync(path.join(functionsRoot, name, "package.json"));
    })
    .sort();
}

function changedFunctions(allFunctions) {
  const result = run("git", ["status", "--porcelain=v1", "-uall", "--", "cloudfunctions"]);
  if (result.status !== 0) return [];

  const names = new Set();
  for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
    const file = line.includes(" -> ") ? line.split(" -> ").pop().trim() : line.slice(3).trim();
    const match = file.match(/^cloudfunctions\/([^/]+)\//);
    if (match && allFunctions.includes(match[1])) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

function selectFunctions(allFunctions) {
  if (packageAll) return allFunctions;
  if (requested.length > 0) return requested;
  return changedFunctions(allFunctions);
}

function assertZipAvailable() {
  const result = run("zip", ["-v"]);
  if (result.status !== 0) {
    console.error("The zip command is required to package CloudBase functions.");
    process.exit(1);
  }
}

function packageFunction(functionName) {
  const sourceDir = path.join(functionsRoot, functionName);
  const indexPath = path.join(sourceDir, "index.js");
  const packagePath = path.join(sourceDir, "package.json");
  const outputPath = path.join(outputRoot, `${functionName}.zip`);

  const check = run("node", ["--check", indexPath]);
  if (check.status !== 0) {
    console.error(`Syntax check failed for ${functionName}:`);
    console.error(check.stderr || check.stdout);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`[dry-run] Would create ${path.relative(root, outputPath)} from ${functionName}/index.js + package.json`);
    return;
  }

  fs.mkdirSync(outputRoot, { recursive: true });
  fs.rmSync(outputPath, { force: true });

  const zip = run("zip", ["-q", "-j", outputPath, indexPath, packagePath]);
  if (zip.status !== 0) {
    console.error(`Failed to package ${functionName}:`);
    console.error(zip.stderr || zip.stdout);
    process.exit(1);
  }

  console.log(`Created ${path.relative(root, outputPath)}`);
}

function main() {
  const allFunctions = listFunctions();
  const selected = selectFunctions(allFunctions);
  const invalid = selected.filter((name) => !allFunctions.includes(name));

  if (invalid.length > 0) {
    console.error(`Unknown function(s): ${invalid.join(", ")}`);
    console.error(`Known functions: ${allFunctions.join(", ")}`);
    process.exit(1);
  }

  if (selected.length === 0) {
    console.log("No changed cloud functions detected. Use --all or pass function names to package explicitly.");
    return;
  }

  if (!dryRun) {
    assertZipAvailable();
  }

  for (const functionName of selected) {
    packageFunction(functionName);
  }
}

main();
