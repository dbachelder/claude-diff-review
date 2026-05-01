#!/usr/bin/env bash
# claude-diff-review — plugin entrypoint.
#
# Invoked by commands/diff-review.md when the plugin is installed via
# Claude Code's plugin system. Runs claude-diff-review directly out of
# the plugin's git checkout, doing a one-time `npm install` on first use
# (which also builds glimpseui's per-platform native helper via its
# postinstall hook).
#
# Resolution order:
#   1. Use $CLAUDE_PLUGIN_ROOT (Claude Code) or $CODEX_PLUGIN_ROOT (Codex CLI)
#      if set and valid (the plugin install path).
#   2. Otherwise resolve the script's own directory (covers `--plugin-dir`
#      installs and direct `bash bin/plugin-run.sh` invocations).
set -euo pipefail

ROOT=""
for candidate in "${CLAUDE_PLUGIN_ROOT:-}" "${CODEX_PLUGIN_ROOT:-}"; do
  if [[ -n "$candidate" && -f "$candidate/package.json" ]]; then
    ROOT="$candidate"
    break
  fi
done
if [[ -z "$ROOT" ]]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi

if [[ ! -f "$ROOT/bin/claude-diff-review.js" ]]; then
  echo "claude-diff-review: could not locate plugin root (looked in '$ROOT')." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "claude-diff-review: node is not on PATH. Install Node.js 20+ and retry." >&2
  exit 1
fi

# Install plugin-local deps on first run, or after a plugin update bumps
# package.json. We use a stamp file to skip the (otherwise idempotent but
# slow-ish) `npm install` on every invocation.
STAMP="$ROOT/node_modules/.claude-diff-review-installed"
needs_install=0
if [[ ! -d "$ROOT/node_modules/glimpseui" ]]; then
  needs_install=1
elif [[ ! -f "$STAMP" ]] || [[ "$ROOT/package.json" -nt "$STAMP" ]]; then
  needs_install=1
fi

if [[ "$needs_install" == "1" ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "claude-diff-review: npm is not on PATH. Install Node.js 20+ (which ships npm) and retry." >&2
    exit 1
  fi
  echo "claude-diff-review: installing plugin dependencies (first run; this also builds the Glimpse native helper)..." >&2
  (cd "$ROOT" && npm install --omit=dev --no-audit --no-fund) >&2
  touch "$STAMP"
fi

exec node "$ROOT/bin/claude-diff-review.js" "$@"
