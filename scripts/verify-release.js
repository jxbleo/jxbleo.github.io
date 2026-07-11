#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const failures = [];
const warnings = [];

function rel(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function walk(dir, visitor) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(fullPath, visitor);
    } else {
      visitor(fullPath);
    }
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options
  });
}

function addFailure(message) {
  failures.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

function checkRequiredDocs() {
  const docs = [
    "AGENTS.md",
    "README.md",
    "docs/01_PRODUCT_REQUIREMENTS.md",
    "docs/02_ARCHITECTURE.md",
    "docs/03_UI_UX_SPEC.md",
    "docs/04_DATA_MODEL.md",
    "docs/05_CHANGELOG.md",
    "docs/06_DECISIONS.md",
    "docs/07_TESTING_CHECKLIST.md",
    "docs/08_BACKLOG.md",
    "docs/09_CONTENT_WORKFLOW.md",
    "docs/10_DEPLOYMENT.md",
    "docs/11_AGENT_TROUBLESHOOTING.md"
  ];

  for (const doc of docs) {
    if (!fs.existsSync(path.join(root, doc))) {
      addFailure(`Missing required document: ${doc}`);
    }
  }
}

function checkCloudFunctionSyntax() {
  const functionsRoot = path.join(root, "cloudfunctions");
  if (!fs.existsSync(functionsRoot)) return;

  for (const entry of fs.readdirSync(functionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(functionsRoot, entry.name, "index.js");
    if (!fs.existsSync(indexPath)) continue;

    const result = run("node", ["--check", indexPath]);
    if (result.status !== 0) {
      addFailure(`Cloud function syntax failed: ${rel(indexPath)}\n${result.stderr || result.stdout}`);
    }
  }
}

function checkJsonFiles() {
  for (const dir of ["content", "data"]) {
    walk(path.join(root, dir), (filePath) => {
      if (!filePath.endsWith(".json")) return;
      try {
        JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch (error) {
        addFailure(`Invalid JSON: ${rel(filePath)}\n${error.message}`);
      }
    });
  }
}

function checkTrackedSecrets() {
  const result = run("git", ["ls-files"]);
  if (result.status !== 0) {
    addWarning("Could not inspect tracked files with git ls-files.");
    return;
  }

  const forbidden = [
    /^\.cloudbase-private\//,
    /^\.qa-secrets\.local$/,
    /^\.env$/,
    /^\.env\./,
    /(^|\/).*secret.*\.json$/i,
    /(^|\/).*service-account.*\.json$/i,
    /(^|\/).*\.pem$/i,
    /(^|\/).*\.key$/i
  ];

  const allowed = new Set([".env.example"]);
  for (const file of result.stdout.split(/\r?\n/).filter(Boolean)) {
    if (allowed.has(file)) continue;
    if (forbidden.some((pattern) => pattern.test(file))) {
      addFailure(`Forbidden private/secret-looking file is tracked: ${file}`);
    }
  }
}

function checkWorkingTreeAwareness() {
  const result = run("git", ["status", "--porcelain=v1", "-uall"]);
  if (result.status !== 0) {
    addWarning("Could not inspect working tree status.");
    return;
  }

  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  if (lines.length > 0) {
    addWarning(`Working tree is not clean (${lines.length} item(s)). Review unrelated files before deploying.`);
  }

  for (const line of lines) {
    const file = line.slice(3).trim();
    if (file.startsWith(".cloudbase-private/")) {
      addFailure(`Private generated file is visible to git status: ${file}`);
    }
  }
}

function checkBbcPlaceholders() {
  const dataDir = path.join(root, "data");
  if (!fs.existsSync(dataDir)) return;

  for (const fileName of fs.readdirSync(dataDir)) {
    if (!/^BBC-.*\.json$/.test(fileName)) continue;
    const filePath = path.join(dataDir, fileName);
    const text = fs.readFileSync(filePath, "utf8");
    const match = text.match(/_{6,}/);
    if (match) {
      addFailure(`BBC placeholder longer than five underscores found in ${rel(filePath)}.`);
    }
  }
}

function checkVocabularyContent() {
  const vocabularyDir = path.join(root, "content", "vocabulary");
  if (!fs.existsSync(vocabularyDir)) return;

  for (const fileName of fs.readdirSync(vocabularyDir).filter((name) => name.endsWith(".json"))) {
    const jsonPath = path.join(vocabularyDir, fileName);
    const unit = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const version = String(unit.contentVersion == null ? "" : unit.contentVersion).trim();
    if (!version) addFailure(`Vocabulary contentVersion is missing: ${rel(jsonPath)}`);

    const groups = Array.isArray(unit.quizGroups) ? unit.quizGroups : [];
    const seenKeys = new Set();
    groups.forEach((group) => {
      const words = Array.isArray(group.wordList) ? group.wordList : [];
      const questions = Array.isArray(group.questions) ? group.questions : [];
      if (words.length !== questions.length) {
        addFailure(`Vocabulary Word Bank/question count mismatch in ${rel(jsonPath)} group ${group.id}`);
      }
      questions.forEach((question) => {
        const expectedKey = `${group.id}:${question.number}`;
        if (question.questionKey !== expectedKey) {
          addFailure(`Vocabulary questionKey mismatch in ${rel(jsonPath)}: expected ${expectedKey}`);
        }
        if (seenKeys.has(expectedKey)) {
          addFailure(`Duplicate Vocabulary questionKey in ${rel(jsonPath)}: ${expectedKey}`);
        }
        seenKeys.add(expectedKey);
      });
    });

    const jsPath = jsonPath.replace(/\.json$/i, ".js");
    if (!fs.existsSync(jsPath)) {
      addFailure(`Vocabulary JS fallback is missing: ${rel(jsPath)}`);
      continue;
    }
    const jsText = fs.readFileSync(jsPath, "utf8");
    const match = jsText.match(/=\s*(\{[\s\S]*\});\s*$/);
    if (!match) {
      addFailure(`Vocabulary JS fallback cannot be parsed: ${rel(jsPath)}`);
      continue;
    }
    try {
      const fallback = JSON.parse(match[1]);
      if (JSON.stringify(fallback) !== JSON.stringify(unit)) {
        addFailure(`Vocabulary JSON/JS fallback mismatch: ${rel(jsonPath)}`);
      }
    } catch (error) {
      addFailure(`Vocabulary JS fallback is invalid: ${rel(jsPath)}\n${error.message}`);
    }
  }
}

function main() {
  checkRequiredDocs();
  checkCloudFunctionSyntax();
  checkJsonFiles();
  checkTrackedSecrets();
  checkWorkingTreeAwareness();
  checkBbcPlaceholders();
  checkVocabularyContent();

  for (const warning of warnings) {
    console.warn(`WARN: ${warning}`);
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`FAIL: ${failure}`);
    }
    process.exit(1);
  }

  console.log("Release verification passed.");
}

main();
