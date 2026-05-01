#!/usr/bin/env node
// claude-diff-review — Glimpse-powered native diff review window for Claude Code.
// Adapted from pi-diff-review (https://github.com/badlogic/pi-diff-review) by Mario Zechner.
//
// On submit: prints composed feedback prompt to stdout and exits 0.
// On cancel / window close: prints nothing and exits 0.
// On error: prints message to stderr and exits 1.

import { open } from "glimpseui";
import { getReviewWindowData, loadReviewFileContents } from "../src/git.js";
import { composeReviewPrompt } from "../src/prompt.js";
import { buildReviewHtml } from "../src/ui.js";

function escapeForInlineScript(value) {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function log(...args) {
  // Status messages go to stderr so stdout stays clean for the prompt.
  process.stderr.write(args.join(" ") + "\n");
}

async function main() {
  const cwd = process.cwd();

  const { repoRoot, files } = await getReviewWindowData(cwd);
  if (files.length === 0) {
    log("No reviewable files found.");
    return;
  }

  const html = buildReviewHtml({ repoRoot, files });
  const win = open(html, {
    width: 1680,
    height: 1020,
    title: "claude diff review",
  });

  log(`Opened review window for ${repoRoot} (${files.length} files). Submit or close to continue.`);

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
    const pending = loadReviewFileContents(repoRoot, file, scope);
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

    // Allow Ctrl+C in the parent terminal to close the window cleanly.
    process.once("SIGINT", () => {
      try { win.close(); } catch {}
      settle(null);
    });
  });

  try { win.close(); } catch {}

  if (terminalMessage == null || terminalMessage.type === "cancel") {
    log("Review cancelled.");
    return;
  }

  const prompt = composeReviewPrompt(files, terminalMessage);
  process.stdout.write(prompt + "\n");
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`claude-diff-review failed: ${message}\n`);
  process.exit(1);
});
