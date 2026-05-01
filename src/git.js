// Ported from pi-diff-review (https://github.com/badlogic/pi-diff-review)
// Original: src/git.ts. Replaces pi.exec() with node:child_process.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

function execGit(repoRoot, args) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: repoRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: err.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function runGit(repoRoot, args) {
  const result = await execGit(repoRoot, args);
  if (result.code !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`;
    throw new Error(message);
  }
  return result.stdout;
}

async function runGitAllowFailure(repoRoot, args) {
  const result = await execGit(repoRoot, args);
  if (result.code !== 0) return "";
  return result.stdout;
}

export async function getRepoRoot(cwd) {
  const result = await execGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.code !== 0) {
    throw new Error("Not inside a git repository.");
  }
  return result.stdout.trim();
}

async function hasHead(repoRoot) {
  const result = await execGit(repoRoot, ["rev-parse", "--verify", "HEAD"]);
  return result.code === 0;
}

function parseNameStatus(output) {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const changes = [];
  for (const line of lines) {
    const parts = line.split("\t");
    const rawStatus = parts[0] ?? "";
    const code = rawStatus[0];
    if (code === "R") {
      const oldPath = parts[1] ?? null;
      const newPath = parts[2] ?? null;
      if (oldPath != null && newPath != null) changes.push({ status: "renamed", oldPath, newPath });
      continue;
    }
    if (code === "M") {
      const path = parts[1] ?? null;
      if (path != null) changes.push({ status: "modified", oldPath: path, newPath: path });
      continue;
    }
    if (code === "A") {
      const path = parts[1] ?? null;
      if (path != null) changes.push({ status: "added", oldPath: null, newPath: path });
      continue;
    }
    if (code === "D") {
      const path = parts[1] ?? null;
      if (path != null) changes.push({ status: "deleted", oldPath: path, newPath: null });
    }
  }
  return changes;
}

function parseUntrackedPaths(output) {
  return output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
    .map((path) => ({ status: "added", oldPath: null, newPath: path }));
}

function parseTrackedPaths(output) {
  return output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
}

function mergeChangedPaths(tracked, untracked) {
  const seen = new Set(tracked.map((c) => `${c.status}:${c.oldPath ?? ""}:${c.newPath ?? ""}`));
  const merged = [...tracked];
  for (const change of untracked) {
    const key = `${change.status}:${change.oldPath ?? ""}:${change.newPath ?? ""}`;
    if (seen.has(key)) continue;
    merged.push(change);
    seen.add(key);
  }
  return merged;
}

const uniquePaths = (paths) => [...new Set(paths)];

function toDisplayPath(change) {
  if (change.status === "renamed") return `${change.oldPath ?? ""} -> ${change.newPath ?? ""}`;
  return change.newPath ?? change.oldPath ?? "(unknown)";
}

function toComparison(change) {
  return {
    status: change.status,
    oldPath: change.oldPath,
    newPath: change.newPath,
    displayPath: toDisplayPath(change),
    hasOriginal: change.oldPath != null,
    hasModified: change.newPath != null,
  };
}

function buildReviewFileId(path, hasWorkingTreeFile, gitDiff, lastCommit) {
  return [
    path,
    hasWorkingTreeFile ? "working" : "gone",
    gitDiff?.displayPath ?? "",
    lastCommit?.displayPath ?? "",
  ].join("::");
}

function createReviewFile(seed) {
  return {
    id: buildReviewFileId(seed.path, seed.hasWorkingTreeFile, seed.gitDiff, seed.lastCommit),
    path: seed.path,
    worktreeStatus: seed.worktreeStatus,
    hasWorkingTreeFile: seed.hasWorkingTreeFile,
    inGitDiff: seed.inGitDiff,
    inLastCommit: seed.inLastCommit,
    gitDiff: seed.gitDiff,
    lastCommit: seed.lastCommit,
  };
}

async function getRevisionContent(repoRoot, revision, path) {
  const result = await execGit(repoRoot, ["show", `${revision}:${path}`]);
  if (result.code !== 0) return "";
  return result.stdout;
}

async function getWorkingTreeContent(repoRoot, path) {
  try {
    return await readFile(join(repoRoot, path), "utf8");
  } catch {
    return "";
  }
}

const BINARY_EXTENSIONS = new Set([
  ".7z", ".a", ".avi", ".avif", ".bin", ".bmp", ".class", ".dll", ".dylib",
  ".eot", ".exe", ".gif", ".gz", ".ico", ".jar", ".jpeg", ".jpg", ".lockb",
  ".map", ".mov", ".mp3", ".mp4", ".o", ".otf", ".pdf", ".png", ".pyc",
  ".so", ".svgz", ".tar", ".ttf", ".wasm", ".webm", ".webp", ".woff",
  ".woff2", ".zip",
]);

function isReviewableFilePath(path) {
  const lowerPath = path.toLowerCase();
  const fileName = lowerPath.split("/").pop() ?? lowerPath;
  const extension = extname(fileName);
  if (fileName.length === 0) return false;
  if (BINARY_EXTENSIONS.has(extension)) return false;
  if (fileName.endsWith(".min.js") || fileName.endsWith(".min.css")) return false;
  return true;
}

const compareReviewFiles = (a, b) => a.path.localeCompare(b.path);

function upsertSeed(seeds, key, create) {
  const existing = seeds.get(key);
  if (existing != null) return existing;
  const seed = create();
  seeds.set(key, seed);
  return seed;
}

export async function getReviewWindowData(cwd) {
  const repoRoot = await getRepoRoot(cwd);
  const repositoryHasHead = await hasHead(repoRoot);

  const trackedDiffOutput = repositoryHasHead
    ? await runGit(repoRoot, ["diff", "--find-renames", "-M", "--name-status", "HEAD", "--"])
    : "";
  const untrackedOutput = await runGitAllowFailure(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
  const trackedFilesOutput = await runGitAllowFailure(repoRoot, ["ls-files", "--cached"]);
  const deletedFilesOutput = await runGitAllowFailure(repoRoot, ["ls-files", "--deleted"]);
  const lastCommitOutput = repositoryHasHead
    ? await runGitAllowFailure(repoRoot, ["diff-tree", "--root", "--find-renames", "-M", "--name-status", "--no-commit-id", "-r", "HEAD"])
    : "";

  const worktreeChanges = mergeChangedPaths(parseNameStatus(trackedDiffOutput), parseUntrackedPaths(untrackedOutput))
    .filter((c) => isReviewableFilePath(c.newPath ?? c.oldPath ?? ""));
  const deletedPaths = new Set(parseTrackedPaths(deletedFilesOutput));
  const currentPaths = uniquePaths([...parseTrackedPaths(trackedFilesOutput), ...parseTrackedPaths(untrackedOutput)])
    .filter((p) => !deletedPaths.has(p))
    .filter(isReviewableFilePath);
  const lastCommitChanges = parseNameStatus(lastCommitOutput)
    .filter((c) => isReviewableFilePath(c.newPath ?? c.oldPath ?? ""));

  const seeds = new Map();

  for (const path of currentPaths) {
    seeds.set(path, {
      path, worktreeStatus: null, hasWorkingTreeFile: true,
      inGitDiff: false, inLastCommit: false, gitDiff: null, lastCommit: null,
    });
  }

  for (const change of worktreeChanges) {
    const key = change.newPath ?? change.oldPath ?? toDisplayPath(change);
    const seed = upsertSeed(seeds, key, () => ({
      path: key, worktreeStatus: null,
      hasWorkingTreeFile: change.newPath != null,
      inGitDiff: false, inLastCommit: false, gitDiff: null, lastCommit: null,
    }));
    seed.worktreeStatus = change.status;
    seed.hasWorkingTreeFile = change.newPath != null;
    seed.inGitDiff = true;
    seed.gitDiff = toComparison(change);
  }

  for (const change of lastCommitChanges) {
    const key = change.newPath ?? change.oldPath ?? toDisplayPath(change);
    const seed = upsertSeed(seeds, key, () => ({
      path: key, worktreeStatus: null,
      hasWorkingTreeFile: change.newPath != null && currentPaths.includes(change.newPath),
      inGitDiff: false, inLastCommit: false, gitDiff: null, lastCommit: null,
    }));
    seed.inLastCommit = true;
    seed.lastCommit = toComparison(change);
  }

  const files = [...seeds.values()].map(createReviewFile).sort(compareReviewFiles);
  return { repoRoot, files };
}

export async function loadReviewFileContents(repoRoot, file, scope) {
  if (scope === "all-files") {
    const content = file.hasWorkingTreeFile ? await getWorkingTreeContent(repoRoot, file.path) : "";
    return { originalContent: content, modifiedContent: content };
  }

  const comparison = scope === "git-diff" ? file.gitDiff : file.lastCommit;
  if (comparison == null) return { originalContent: "", modifiedContent: "" };

  const originalRevision = scope === "git-diff" ? "HEAD" : "HEAD^";
  const modifiedRevision = scope === "git-diff" ? null : "HEAD";

  const originalContent = comparison.oldPath == null
    ? ""
    : await getRevisionContent(repoRoot, originalRevision, comparison.oldPath);
  const modifiedContent = comparison.newPath == null
    ? ""
    : modifiedRevision == null
      ? await getWorkingTreeContent(repoRoot, comparison.newPath)
      : await getRevisionContent(repoRoot, modifiedRevision, comparison.newPath);

  return { originalContent, modifiedContent };
}
