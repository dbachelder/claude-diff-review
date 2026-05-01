#!/usr/bin/env node
// claude-diff-review — Glimpse-powered native diff review window for Claude Code.
// Adapted from pi-diff-review (https://github.com/badlogic/pi-diff-review) by Mario Zechner.
//
// Usage:
//   claude-diff-review [scope] [--base <ref>]
//
// Scopes:
//   base          (default) all changes since the merge-base with the base branch
//                 (auto-detected: origin/HEAD → origin/main → main → origin/master → master)
//                 — includes both commits since base AND uncommitted changes
//   last-commit   only HEAD vs HEAD^
//   uncommitted   only working-tree changes vs HEAD
//   all           include the "all files" scope as the initial tab (debug)
//
// Flags:
//   --base <ref>  override the base branch (only used in `base` mode)
//   --help, -h    show this help
//
// On submit: writes the composed feedback to $TMPDIR/claude-diff-review-<ts>.md and prints
//            "FEEDBACK_FILE: <path>" to stdout.
// On cancel / window close: prints "REVIEW_CANCELLED" to stdout.
// On error: prints message to stderr and exits 1.

import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { open } from "glimpseui";
import {
  getRepoRoot,
  getReviewWindowData,
  loadReviewFileContents,
  resolveBaseRef,
  resolveMergeBase,
} from "../src/git.js";
import { composeReviewPrompt } from "../src/prompt.js";
import { buildReviewHtml } from "../src/ui.js";

const HELP = `claude-diff-review — open a native diff review window for Claude Code.

Usage:
  claude-diff-review [scope] [--base <ref>] [--help]

Scopes (positional or --scope <name>):
  base          (default) all changes since merge-base with base branch
  last-commit   HEAD vs HEAD^
  uncommitted   working tree vs HEAD
  all           initial tab = "all files" (mostly for debugging)

Options:
  --base <ref>  override base branch (default: auto-detect origin/HEAD,
                origin/main, main, origin/master, master)
  -h, --help    show this help and exit
`;

const VALID_SCOPES = new Set(["base", "last-commit", "uncommitted", "all"]);

// CLI scope -> initial tab in the web UI.
const INITIAL_TAB = {
  base: "git-diff",
  uncommitted: "git-diff",
  "last-commit": "last-commit",
  all: "all-files",
};

function parseArgs(argv) {
  const args = { scope: "base", base: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") {
      args.help = true;
    } else if (a === "--scope" || a === "-s") {
      args.scope = argv[++i];
    } else if (a.startsWith("--scope=")) {
      args.scope = a.slice("--scope=".length);
    } else if (a === "--base" || a === "-b") {
      args.base = argv[++i];
    } else if (a.startsWith("--base=")) {
      args.base = a.slice("--base=".length);
    } else if (VALID_SCOPES.has(a)) {
      args.scope = a;
    } else {
      throw new Error(`Unknown argument: ${a}\n\n${HELP}`);
    }
  }
  if (!VALID_SCOPES.has(args.scope)) {
    throw new Error(`Invalid scope "${args.scope}". Must be one of: ${[...VALID_SCOPES].join(", ")}`);
  }
  return args;
}

function escapeForInlineScript(value) {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function log(...args) {
  process.stderr.write(args.join(" ") + "\n");
}

async function resolveScopeContext(repoRoot, args) {
  // Returns { gitDiffOriginalRef, scopeLabels, scopeHints, baseRefName, baseRefShort }
  if (args.scope !== "base") {
    return { gitDiffOriginalRef: "HEAD", scopeLabels: null, scopeHints: null, baseRefName: null };
  }

  const baseRefName = await resolveBaseRef(repoRoot, args.base);
  if (!baseRefName) {
    log(args.base
      ? `Base ref "${args.base}" not found; falling back to "uncommitted" scope.`
      : `Could not auto-detect a base branch (origin/HEAD, origin/main, main, origin/master, master); falling back to "uncommitted" scope.`);
    return { gitDiffOriginalRef: "HEAD", scopeLabels: null, scopeHints: null, baseRefName: null };
  }

  const mergeBase = await resolveMergeBase(repoRoot, baseRefName);
  if (!mergeBase) {
    log(`No merge-base between HEAD and ${baseRefName}; falling back to "uncommitted" scope.`);
    return { gitDiffOriginalRef: "HEAD", scopeLabels: null, scopeHints: null, baseRefName: null };
  }

  log(`Comparing against base ref ${baseRefName} (merge-base ${mergeBase.slice(0, 8)}).`);
  return {
    gitDiffOriginalRef: mergeBase,
    scopeLabels: { "git-diff": `vs ${baseRefName}` },
    scopeHints: {
      "git-diff": `Review all changes since the merge-base with ${baseRefName} (committed and uncommitted). Hover or click line numbers in the gutter to add an inline comment.`,
    },
    baseRefName,
    mergeBase,
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  const cwd = process.cwd();
  const repoRoot = await getRepoRoot(cwd);
  const ctx = await resolveScopeContext(repoRoot, args);

  const { files } = await getReviewWindowData(cwd, { gitDiffOriginalRef: ctx.gitDiffOriginalRef });
  if (files.length === 0) {
    log("No reviewable files found for the requested scope.");
    process.stdout.write("REVIEW_CANCELLED\n");
    return;
  }

  const initialScope = INITIAL_TAB[args.scope];
  const html = buildReviewHtml({
    repoRoot,
    files,
    initialScope,
    scopeLabels: ctx.scopeLabels,
    scopeHints: ctx.scopeHints,
    baseRefName: ctx.baseRefName ?? null,
  });

  const titleSuffix = ctx.baseRefName ? ` (vs ${ctx.baseRefName})` : ` (${args.scope})`;
  const win = open(html, {
    width: 1680,
    height: 1020,
    title: `claude diff review${titleSuffix}`,
  });

  log(`Opened review window for ${repoRoot} (${files.length} files, scope: ${args.scope}${ctx.baseRefName ? `, base: ${ctx.baseRefName}` : ""}).`);

  const fileMap = new Map(files.map((f) => [f.id, f]));
  const contentCache = new Map();

  const sendWindowMessage = (message) => {
    const payload = escapeForInlineScript(JSON.stringify(message));
    try {
      win.send(`window.__reviewReceive(${payload});`);
    } catch {
      /* window already gone */
    }
  };

  const loadContents = (file, scope) => {
    const key = `${scope}:${file.id}`;
    const cached = contentCache.get(key);
    if (cached != null) return cached;
    const pending = loadReviewFileContents(repoRoot, file, scope, { gitDiffOriginalRef: ctx.gitDiffOriginalRef });
    contentCache.set(key, pending);
    return pending;
  };

  const handleRequestFile = async (message) => {
    const file = fileMap.get(message.fileId);
    if (file == null) {
      sendWindowMessage({
        type: "file-error",
        requestId: message.requestId,
        fileId: message.fileId,
        scope: message.scope,
        message: "Unknown file requested.",
      });
      return;
    }
    try {
      const contents = await loadContents(file, message.scope);
      sendWindowMessage({
        type: "file-data",
        requestId: message.requestId,
        fileId: message.fileId,
        scope: message.scope,
        originalContent: contents.originalContent,
        modifiedContent: contents.modifiedContent,
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      sendWindowMessage({
        type: "file-error",
        requestId: message.requestId,
        fileId: message.fileId,
        scope: message.scope,
        message: messageText,
      });
    }
  };

  const terminalMessage = await new Promise((resolve, reject) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      win.removeListener("message", onMessage);
      win.removeListener("closed", onClosed);
      win.removeListener("error", onError);
      resolve(value);
    };
    const onMessage = (data) => {
      const message = data;
      if (message?.type === "request-file") {
        void handleRequestFile(message);
        return;
      }
      if (message?.type === "submit" || message?.type === "cancel") {
        settle(message);
      }
    };
    const onClosed = () => settle(null);
    const onError = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    win.on("message", onMessage);
    win.on("closed", onClosed);
    win.on("error", onError);

    process.once("SIGINT", () => {
      try { win.close(); } catch {}
      settle(null);
    });
  });

  try { win.close(); } catch {}

  if (terminalMessage == null || terminalMessage.type === "cancel") {
    log("Review cancelled.");
    process.stdout.write("REVIEW_CANCELLED\n");
    return;
  }

  const prompt = composeReviewPrompt(files, terminalMessage);
  const outPath = join(tmpdir(), `claude-diff-review-${Date.now()}.md`);
  await writeFile(outPath, prompt + "\n", "utf8");
  process.stdout.write(`FEEDBACK_FILE: ${outPath}\n`);
  log(`Wrote feedback to ${outPath}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`claude-diff-review failed: ${message}\n`);
  process.exit(1);
});
