#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const stdoutOnly = args.includes("--stdout");
const outputArgIndex = args.indexOf("--output");
const customOutput = outputArgIndex >= 0 ? args[outputArgIndex + 1] : null;
const defaultOutput = path.join(root, ".cloudbase-private", "deploy-plan.md");
const outputPath = customOutput ? path.resolve(root, customOutput) : defaultOutput;

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, {
    cwd: root,
    encoding: "utf8"
  });
}

function gitOutput(argsForGit, fallback = "") {
  const result = run("git", argsForGit);
  return result.status === 0 ? result.stdout.trim() : fallback;
}

function gitStatus() {
  const result = run("git", ["status", "--porcelain=v1", "-uall"]);
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const rawPath = line.includes(" -> ") ? line.split(" -> ").pop().trim() : line.slice(3).trim();
    return {
      code: line.slice(0, 2),
      file: rawPath
    };
  });
}

function unique(values) {
  return [...new Set(values)].sort();
}

function bulletList(items, emptyText) {
  if (items.length === 0) return `- ${emptyText}`;
  return items.map((item) => `- ${item}`).join("\n");
}

function categorize(statusItems) {
  const functionNames = unique(statusItems
    .map((item) => item.file.match(/^cloudfunctions\/([^/]+)\//))
    .filter(Boolean)
    .map((match) => match[1])
    .filter((name) => !name.startsWith("_")));

  const staticFiles = statusItems
    .filter((item) => {
      return /^(assets\/|data\/|content\/|bbc-audio\/|.*\.html$)/.test(item.file);
    })
    .map((item) => item.file);

  const dataRelated = statusItems
    .filter((item) => {
      return /^(content\/|data\/|scripts\/prepare-cloudbase-data\.js|scripts\/build-home-catalog\.js)/.test(item.file);
    })
    .map((item) => item.file);

  const docs = statusItems
    .filter((item) => /^(docs\/|README\.md|AGENTS\.md|.*CHANGELOG.*\.md|.*REQUIREMENTS.*\.md)/.test(item.file))
    .map((item) => item.file);

  const privateRisk = statusItems
    .filter((item) => {
      return /^\.cloudbase-private\//.test(item.file) ||
        /^\.env/.test(item.file) ||
        /secret|service-account|\.pem$|\.key$/i.test(item.file);
    })
    .map((item) => item.file);

  return {
    functionNames,
    staticFiles: unique(staticFiles),
    dataRelated: unique(dataRelated),
    docs: unique(docs),
    privateRisk: unique(privateRisk)
  };
}

function renderPlan() {
  const statusItems = gitStatus();
  const categories = categorize(statusItems);
  const branch = gitOutput(["branch", "--show-current"], "unknown");
  const commit = gitOutput(["rev-parse", "--short", "HEAD"], "unknown");
  const generatedAt = new Date().toISOString();
  const functionCommand = categories.functionNames.length > 0
    ? `npm run package:functions -- ${categories.functionNames.join(" ")}`
    : "npm run package:functions:all";

  return `# CloudBase Deploy Plan

Generated: ${generatedAt}
Branch: ${branch}
Commit: ${commit}

This file is a review aid. It does not contain secrets and does not deploy
anything. CloudBase login, console upload, CLI execution, environment variables,
and production approval stay with the project owner.

## Permission Boundary

- Agent may run verification, packaging, and this plan generator.
- Agent may not run CloudBase deploy commands unless the owner explicitly asks
  in that session.
- Agent must not receive or write Tencent SecretId, SecretKey, passwords,
  private grading keys, or CloudBase environment secrets.
- The owner performs the final CloudBase console upload or owner-only CLI
  command after reviewing this plan.

## Changed Cloud Functions

${bulletList(categories.functionNames, "No changed cloud function source detected.")}

If these are intentional, package them locally:

\`\`\`bash
npm run verify:release
${functionCommand}
\`\`\`

Generated ZIPs are under \`deploy-packages/\` and are ignored by Git.

## Static Site Changes

${bulletList(categories.staticFiles, "No obvious static site files detected.")}

If these are intentional, publish the static site after review.

## Possible CloudBase Data Import Changes

${bulletList(categories.dataRelated, "No obvious data/catalog import files detected.")}

If sets or grading changed:

\`\`\`bash
node scripts/build-home-catalog.js
node scripts/prepare-cloudbase-data.js
\`\`\`

Then the owner imports the relevant JSON Lines files from:

\`\`\`text
.cloudbase-private/import/
\`\`\`

## Documentation Changes

${bulletList(categories.docs, "No documentation changes detected.")}

## Private File Risk Check

${bulletList(categories.privateRisk, "No secret-looking paths visible in git status.")}

If any item appears here, stop and remove it from Git before release.

## Owner Final Checklist

- Review \`git status --short\` and confirm every changed file belongs to this
  release.
- Confirm required CloudBase collections and indexes exist.
- Confirm \`INITIAL_STUDENT_PASSWORD\` remains configured only in CloudBase
  function settings.
- Upload only the intended function ZIPs, or run owner-only CLI commands from
  your own authenticated terminal.
- Import only the intended JSON Lines files.
- Test student login, dashboard, assignment submit, teacher page, and Argue if
  touched.
`;
}

function main() {
  const plan = renderPlan();

  if (stdoutOnly) {
    process.stdout.write(plan);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, plan);
  console.log(`Wrote ${path.relative(root, outputPath)}`);
}

main();
