#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");

const DEFAULT_BRANCH = "main";
const DEFAULT_REMOTE = "origin";
const DEFAULT_PUSH_TIMEOUT_MS = 20000;
const API_MUTATION_DELAY_MS = 1100;
const COMMAND_TIMEOUT_MS = 30000;

function parseArgs(argv) {
  const options = {
    branch: DEFAULT_BRANCH,
    remote: DEFAULT_REMOTE,
    pushTimeoutMs: DEFAULT_PUSH_TIMEOUT_MS,
    apiOnly: false,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--branch") options.branch = requireValue(argv, ++index, arg);
    else if (arg === "--remote") options.remote = requireValue(argv, ++index, arg);
    else if (arg === "--push-timeout-ms") {
      const value = Number(requireValue(argv, ++index, arg));
      if (!Number.isInteger(value) || value < 1000 || value > 120000) {
        throw new Error("--push-timeout-ms must be an integer from 1000 to 120000");
      }
      options.pushTimeoutMs = value;
    } else if (arg === "--api-only") options.apiOnly = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(options.branch) || options.branch.startsWith("/") || options.branch.endsWith("/")) {
    throw new Error("Enter a valid branch name");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(options.remote)) throw new Error("Enter a valid remote name");
  return options;
}

function requireValue(argv, index, optionName) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${optionName} requires a value`);
  return value;
}

function printUsage() {
  console.log(`Usage:
  npm run publish:github -- [options]

Tries a short normal Git push first. If and only if that fails because GitHub
HTTPS is unreachable, publishes the exact local HEAD tree through GitHub's Git
Data API with a non-force reference update.

Options:
  --branch <name>             Target branch, default main
  --remote <name>             Git remote, default origin
  --push-timeout-ms <number>  Normal push timeout, default 20000
  --api-only                  Skip normal Git push
  --dry-run                   Validate and report without publishing
  --help                      Show this help
`);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: options.encoding === null ? null : "utf8",
    input: options.input,
    timeout: options.timeoutMs || COMMAND_TIMEOUT_MS,
    maxBuffer: options.maxBuffer || 32 * 1024 * 1024,
    stdio: options.stdio || ["pipe", "pipe", "pipe"],
    env: options.env || process.env,
  });
}

function commandText(result) {
  return [result.stdout, result.stderr]
    .filter(Boolean)
    .map((value) => Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
    .join("\n")
    .trim();
}

function mustRun(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(commandText(result) || `${command} failed`);
  }
  return options.encoding === null ? result.stdout : String(result.stdout || "").trim();
}

function git(args, options = {}) {
  return mustRun("git", args, options);
}

function parseRepoSlug(remoteUrl) {
  const value = String(remoteUrl || "").trim().replace(/\.git$/, "");
  let match = value.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match) match = value.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/i);
  if (!match) match = value.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
  if (!match) throw new Error("The selected remote is not a supported github.com repository URL");
  return `${match[1]}/${match[2]}`;
}

function isNetworkPushFailure(result) {
  if (result && result.error && ["ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"].includes(result.error.code)) return true;
  const output = commandText(result);
  return /Failed to connect|Could not resolve host|Connection timed out|Operation timed out|Empty reply from server|Connection reset|network is unreachable/i.test(output);
}

function parseNameStatusZero(value) {
  const fields = String(value || "").split("\0");
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) continue;
    const path = fields[index++];
    if (!path) throw new Error(`Invalid git diff entry for ${status}`);
    changes.push({ status, path });
  }
  return changes;
}

function apiPathBranch(branch) {
  return branch.split("/").map(encodeURIComponent).join("/");
}

function ghApi(repoSlug, method, path, body) {
  const args = ["api", "--method", method, `repos/${repoSlug}/${path}`];
  if (body !== undefined) args.push("--input", "-");
  const output = mustRun("gh", args, {
    input: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  return output ? JSON.parse(output) : {};
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertCleanTree() {
  const status = git(["status", "--porcelain=v1", "--untracked-files=normal"]);
  if (status) throw new Error("Working tree is not clean. Publish from a clean release worktree.");
}

function assertRemoteAncestor(remoteSha, headSha) {
  const exists = run("git", ["cat-file", "-e", `${remoteSha}^{commit}`]);
  if (exists.status !== 0) {
    throw new Error("The current remote commit is not available locally. Fetch the target branch before publishing.");
  }
  const ancestor = run("git", ["merge-base", "--is-ancestor", remoteSha, headSha]);
  if (ancestor.status !== 0) {
    throw new Error("Local HEAD is not a fast-forward descendant of the current remote branch.");
  }
}

function localTreeEntry(headSha, filePath) {
  const line = git(["ls-tree", "-z", headSha, "--", filePath]);
  const match = line.match(/^(\d+)\s+(\w+)\s+([0-9a-f]+)\t/);
  if (!match || match[2] !== "blob") throw new Error(`Unsupported Git tree entry: ${filePath}`);
  return { mode: match[1], type: match[2], sha: match[3] };
}

function commitMessage(baseSha, headSha) {
  const count = Number(git(["rev-list", "--count", `${baseSha}..${headSha}`]));
  if (count === 1) return git(["show", "-s", "--format=%B", headSha]);
  const summaries = git(["log", "--reverse", "--format=- %h %s", `${baseSha}..${headSha}`]);
  return `Publish ${count} local commits via Git Data API\n\n${summaries}`;
}

function localCommitIdentity() {
  const configuredName = run("git", ["config", "--get", "user.name"]);
  const configuredEmail = run("git", ["config", "--get", "user.email"]);
  return {
    name: configuredName.status === 0 && String(configuredName.stdout || "").trim()
      ? String(configuredName.stdout).trim()
      : git(["show", "-s", "--format=%an", "HEAD"]),
    email: configuredEmail.status === 0 && String(configuredEmail.stdout || "").trim()
      ? String(configuredEmail.stdout).trim()
      : git(["show", "-s", "--format=%ae", "HEAD"]),
  };
}

function gitObjectDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid Git commit date");
  const offsetMatch = String(value).match(/(Z|([+-])(\d{2}):?(\d{2}))$/i);
  if (!offsetMatch) throw new Error("Git commit date must include a timezone");
  const timezone = offsetMatch[1].toUpperCase() === "Z"
    ? "+0000"
    : `${offsetMatch[2]}${offsetMatch[3]}${offsetMatch[4]}`;
  return { timestamp: Math.floor(date.getTime() / 1000), timezone };
}

function assertCommitIdentity(identity) {
  if (!identity || !identity.name || !identity.email) throw new Error("Git commit identity is incomplete");
  if (/[\r\n<>]/.test(identity.name) || /[\r\n<>]/.test(identity.email)) {
    throw new Error("Git commit identity contains unsupported characters");
  }
}

function createMatchingLocalCommit({ treeSha, parentSha, message, identity, date }) {
  assertCommitIdentity(identity);
  const objectDate = gitObjectDate(date);
  const rawCommit = [
    `tree ${treeSha}`,
    `parent ${parentSha}`,
    `author ${identity.name} <${identity.email}> ${objectDate.timestamp} ${objectDate.timezone}`,
    `committer ${identity.name} <${identity.email}> ${objectDate.timestamp} ${objectDate.timezone}`,
    "",
    String(message),
  ].join("\n");
  return mustRun("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { input: rawCommit });
}

async function publishViaApi({ repoSlug, remote, branch, baseSha, headSha, dryRun }) {
  const refPath = `git/ref/heads/${apiPathBranch(branch)}`;
  const current = ghApi(repoSlug, "GET", refPath);
  if (!current.object || current.object.sha !== baseSha) {
    throw new Error("Remote branch changed before API fallback. Fetch, review, and retry.");
  }
  assertRemoteAncestor(baseSha, headSha);
  const changes = parseNameStatusZero(git([
    "diff", "--name-status", "--no-renames", "-z", `${baseSha}..${headSha}`,
  ]));
  if (!changes.length) return { method: "none", remoteSha: baseSha, changedFiles: 0 };
  if (dryRun) return { method: "dry-run", remoteSha: baseSha, changedFiles: changes.length };

  const treeEntries = [];
  for (const change of changes) {
    if (change.status.startsWith("D")) {
      treeEntries.push({ path: change.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const local = localTreeEntry(headSha, change.path);
    const content = mustRun("git", ["cat-file", "blob", local.sha], { encoding: null });
    const created = ghApi(repoSlug, "POST", "git/blobs", {
      content: Buffer.from(content).toString("base64"),
      encoding: "base64",
    });
    if (created.sha !== local.sha) throw new Error(`GitHub blob SHA mismatch: ${change.path}`);
    treeEntries.push({ path: change.path, mode: local.mode, type: "blob", sha: created.sha });
    await sleep(API_MUTATION_DELAY_MS);
  }

  const baseCommit = ghApi(repoSlug, "GET", `git/commits/${baseSha}`);
  const createdTree = ghApi(repoSlug, "POST", "git/trees", {
    base_tree: baseCommit.tree.sha,
    tree: treeEntries,
  });
  const localTreeSha = git(["rev-parse", `${headSha}^{tree}`]);
  if (createdTree.sha !== localTreeSha) {
    throw new Error(`Final tree SHA mismatch: local ${localTreeSha}, GitHub ${createdTree.sha}`);
  }
  await sleep(API_MUTATION_DELAY_MS);

  const message = commitMessage(baseSha, headSha);
  const identity = localCommitIdentity();
  const commitDate = new Date().toISOString();
  const localApiCommitSha = createMatchingLocalCommit({
    treeSha: createdTree.sha,
    parentSha: baseSha,
    message,
    identity,
    date: commitDate,
  });
  const createdCommit = ghApi(repoSlug, "POST", "git/commits", {
    message,
    tree: createdTree.sha,
    parents: [baseSha],
    author: { ...identity, date: commitDate },
    committer: { ...identity, date: commitDate },
  });
  if (createdCommit.sha !== localApiCommitSha) {
    throw new Error("GitHub commit SHA does not match the locally reconstructed API commit");
  }
  await sleep(API_MUTATION_DELAY_MS);

  const beforeUpdate = ghApi(repoSlug, "GET", refPath);
  if (!beforeUpdate.object || beforeUpdate.object.sha !== baseSha) {
    throw new Error("Remote branch changed before the final reference update. Nothing was overwritten.");
  }
  ghApi(repoSlug, "PATCH", `git/refs/heads/${apiPathBranch(branch)}`, {
    sha: createdCommit.sha,
    force: false,
  });
  const finalRef = ghApi(repoSlug, "GET", refPath);
  if (!finalRef.object || finalRef.object.sha !== createdCommit.sha) {
    throw new Error("GitHub reference verification failed after API publication");
  }
  const finalCommit = ghApi(repoSlug, "GET", `git/commits/${createdCommit.sha}`);
  if (!finalCommit.tree || finalCommit.tree.sha !== localTreeSha) {
    throw new Error("Published GitHub tree does not match local HEAD");
  }
  const currentLocalRef = run("git", ["symbolic-ref", "-q", "HEAD"]);
  if (currentLocalRef.status === 0 && String(currentLocalRef.stdout || "").trim()) {
    git(["update-ref", String(currentLocalRef.stdout).trim(), createdCommit.sha, headSha]);
  }
  const trackingRef = `refs/remotes/${remote}/${branch}`;
  const trackingExists = run("git", ["show-ref", "--verify", "--quiet", trackingRef]);
  if (trackingExists.status === 0) git(["update-ref", trackingRef, createdCommit.sha, baseSha]);
  return {
    method: "git-data-api",
    remoteSha: createdCommit.sha,
    localHead: headSha,
    treeSha: localTreeSha,
    changedFiles: changes.length,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertCleanTree();
  const remoteUrl = git(["remote", "get-url", options.remote]);
  const repoSlug = parseRepoSlug(remoteUrl);
  const headSha = git(["rev-parse", "HEAD"]);
  const refPath = `git/ref/heads/${apiPathBranch(options.branch)}`;
  const startingRef = ghApi(repoSlug, "GET", refPath);
  const baseSha = startingRef.object && startingRef.object.sha;
  if (!baseSha) throw new Error("Could not resolve the remote branch");
  if (baseSha === headSha) {
    console.log(JSON.stringify({ success: true, method: "none", remoteSha: baseSha }, null, 2));
    return;
  }
  assertRemoteAncestor(baseSha, headSha);

  if (options.dryRun) {
    const result = await publishViaApi({ repoSlug, remote: options.remote, branch: options.branch, baseSha, headSha, dryRun: true });
    console.log(JSON.stringify({ success: true, ...result }, null, 2));
    return;
  }

  if (!options.apiOnly) {
    const push = run("git", ["push", options.remote, `HEAD:${options.branch}`], {
      timeoutMs: options.pushTimeoutMs,
    });
    const afterPush = ghApi(repoSlug, "GET", refPath);
    if (afterPush.object && afterPush.object.sha === headSha) {
      console.log(JSON.stringify({ success: true, method: "git-push", remoteSha: headSha }, null, 2));
      return;
    }
    if (!isNetworkPushFailure(push)) {
      throw new Error(commandText(push) || "Normal Git push failed for a non-network reason");
    }
    if (!afterPush.object || afterPush.object.sha !== baseSha) {
      throw new Error("Remote branch changed while normal push was unavailable. Fetch, review, and retry.");
    }
  }

  const result = await publishViaApi({ repoSlug, remote: options.remote, branch: options.branch, baseSha, headSha, dryRun: false });
  console.log(JSON.stringify({ success: true, ...result }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`GitHub publication failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  parseRepoSlug,
  isNetworkPushFailure,
  parseNameStatusZero,
  apiPathBranch,
  commitMessage,
  gitObjectDate,
  createMatchingLocalCommit,
};
