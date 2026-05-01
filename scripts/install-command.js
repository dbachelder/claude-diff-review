#!/usr/bin/env node
// Installs the /diff-review slash command into ~/.claude/commands/.
// Re-run after upgrades to pick up command changes.

import { copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, "..", "commands", "diff-review.md");
const targetDir = join(homedir(), ".claude", "commands");
const target = join(targetDir, "diff-review.md");

mkdirSync(targetDir, { recursive: true });
copyFileSync(src, target);
console.log(`Installed slash command -> ${target}`);
console.log("Use it inside Claude Code with:  /diff-review");
