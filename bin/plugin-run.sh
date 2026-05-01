#!/usr/bin/env bash
# slop-review — plugin entrypoint.
#
# Invoked by commands/slop-review.md (Claude Code) and skills/slop-review/SKILL.md
# (Codex CLI) when the plugin is installed via the agent's plugin system.
# Runs slop-review directly out of the plugin's git checkout, doing a one-time
# `npm install` on first use (which also builds glimpseui's per-platform
# native helper via its postinstall hook).
#
# Resolution order:
#   1. Use $CLAUDE_PLUGIN_ROOT if set and valid. Both Claude Code AND Codex CLI
#      set this env var for plugin shell calls (confirmed in the codex-cli 0.128
#      binary). Codex stores plugin checkouts under
#      ~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/ and exposes
#      that path via CLAUDE_PLUGIN_ROOT.
#   2. Fall back to $CODEX_PLUGIN_ROOT if a future Codex version uses that name.
#   3. Otherwise resolve the script's own directory (covers `npm i -g .`
#      and direct `bash bin/plugin-run.sh` invocations during dev).
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

if [[ ! -f "$ROOT/bin/slop-review.js" ]]; then
  echo "slop-review: could not locate plugin root (looked in '$ROOT')." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "slop-review: node is not on PATH. Install Node.js 20+ and retry." >&2
  exit 1
fi

# Install plugin-local deps on first run, or after a plugin update bumps
# package.json. We use a stamp file to skip the (otherwise idempotent but
# slow-ish) `npm install` on every invocation.
STAMP="$ROOT/node_modules/.slop-review-installed"
needs_install=0
if [[ ! -d "$ROOT/node_modules/glimpseui" ]]; then
  needs_install=1
elif [[ ! -f "$STAMP" ]] || [[ "$ROOT/package.json" -nt "$STAMP" ]]; then
  needs_install=1
fi

if [[ "$needs_install" == "1" ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "slop-review: npm is not on PATH. Install Node.js 20+ (which ships npm) and retry." >&2
    exit 1
  fi
  echo "slop-review: installing plugin dependencies (first run; this also builds the Glimpse native helper)..." >&2
  (cd "$ROOT" && npm install --omit=dev --no-audit --no-fund) >&2
  touch "$STAMP"
fi

exec node "$ROOT/bin/slop-review.js" "$@"
