#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const esbuild = require("esbuild");

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
  const outputPath = path.join(outputRoot, `${functionName}.zip`);

  const check = run("node", ["--check", indexPath]);
  if (check.status !== 0) {
    console.error(`Syntax check failed for ${functionName}:`);
    console.error(check.stderr || check.stdout);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`[dry-run] Would bundle ${functionName}/index.js into ${path.relative(root, outputPath)}`);
    return;
  }

  fs.mkdirSync(outputRoot, { recursive: true });
  fs.rmSync(outputPath, { force: true });
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `mrcat-${functionName}-`));
  const bundledIndexPath = path.join(stagingDir, "index.js");
  const bundledPackagePath = path.join(stagingDir, "package.json");

  try {
    esbuild.buildSync({
      entryPoints: [indexPath],
      outfile: bundledIndexPath,
      bundle: true,
      platform: "node",
      target: "node18",
      format: "cjs",
      minify: true,
      external: ["@aws-sdk/client-s3"],
      logLevel: "silent"
    });
    fs.writeFileSync(bundledPackagePath, `${JSON.stringify({
      name: functionName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(),
      version: "1.0.0",
      private: true,
      main: "index.js",
      dependencies: {}
    }, null, 2)}\n`);

    const bundledCheck = run("node", ["--check", bundledIndexPath]);
    if (bundledCheck.status !== 0) {
      console.error(`Bundled syntax check failed for ${functionName}:`);
      console.error(bundledCheck.stderr || bundledCheck.stdout);
      process.exit(1);
    }

    const zip = run("zip", ["-q", "-j", outputPath, bundledIndexPath, bundledPackagePath]);
    if (zip.status !== 0) {
      console.error(`Failed to package ${functionName}:`);
      console.error(zip.stderr || zip.stdout);
      process.exit(1);
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
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
