#!/usr/bin/env bash
# slop-review — plugin entrypoint.
#
# Invoked by commands/slop-review.md (Claude Code) and skills/slop-review/SKILL.md
# (Codex CLI) when the plugin is installed via the agent's plugin system.
# Runs slop-review directly out of the plugin's git checkout, doing a one-time
# `npm install` on first use (which would normally also build glimpseui's
# per-platform native helper via its postinstall hook).
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
#
# Native helper handling:
#   Claude Code (and likely other agents) run `npm install --ignore-scripts`
#   when materializing plugins, which suppresses glimpseui's postinstall and
#   leaves the Swift/Rust/.NET helper unbuilt. Even our explicit `npm install`
#   below typically reports "up to date" and does NOT re-trigger postinstall
#   in that case. So we always check for the platform-specific helper binary
#   directly and rebuild it if missing.
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

# -----------------------------------------------------------------------------
# Step 1: install plugin-local deps (glimpseui) on first run.
# Stamp file lets us skip this on every invocation while still re-running it
# after a plugin update bumps package.json.
# -----------------------------------------------------------------------------
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
  echo "slop-review: installing plugin dependencies (first run)..." >&2
  (cd "$ROOT" && npm install --omit=dev --no-audit --no-fund) >&2
  touch "$STAMP"
fi

# -----------------------------------------------------------------------------
# Step 2: ensure the platform-specific Glimpse native helper binary exists.
# Build it explicitly if it's missing — npm postinstall scripts may have been
# suppressed by the host agent (e.g. Claude Code runs `npm install
# --ignore-scripts` for plugin sandboxing).
# -----------------------------------------------------------------------------
GLIMPSEUI_DIR="$ROOT/node_modules/glimpseui"
HOST_BIN=""
BUILD_TARGET=""
HOST_DEPS_HINT=""

case "$(uname -s)" in
  Darwin)
    HOST_BIN="$GLIMPSEUI_DIR/src/glimpse"
    BUILD_TARGET="build:macos"
    HOST_DEPS_HINT="macOS requires Xcode Command Line Tools (provides swiftc). Install with: xcode-select --install"
    ;;
  Linux)
    HOST_BIN="$GLIMPSEUI_DIR/src/glimpse"
    BUILD_TARGET="build:linux"
    HOST_DEPS_HINT="Linux requires Rust (https://rustup.rs) and GTK4/WebKit2GTK dev packages. See: https://github.com/badlogic/glimpseui#linux"
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    # glimpseui's Windows host builds via dotnet; let `npm run build:windows`
    # report the resolved binary path. We just trigger the build if any of the
    # expected output locations are missing.
    HOST_BIN="$GLIMPSEUI_DIR/native/windows/bin/Glimpse.Windows.exe"
    BUILD_TARGET="build:windows"
    HOST_DEPS_HINT="Windows requires the .NET 8 SDK. Install from: https://dotnet.microsoft.com/download/dotnet/8.0"
    ;;
esac

if [[ -n "$HOST_BIN" && -d "$GLIMPSEUI_DIR" && ! -x "$HOST_BIN" ]]; then
  echo "slop-review: Glimpse native helper not found at '$HOST_BIN'." >&2
  echo "slop-review: this usually means the host agent ran 'npm install --ignore-scripts'." >&2

  # If glimpseui's postinstall ran but bailed early (e.g. swiftc missing),
  # surface its reason verbatim — it's more actionable than a generic message.
  if [[ -f "$GLIMPSEUI_DIR/.glimpse-build-skipped" ]]; then
    echo "slop-review: glimpseui's postinstall reported:" >&2
    sed 's/^/  /' "$GLIMPSEUI_DIR/.glimpse-build-skipped" >&2
  fi

  echo "slop-review: building Glimpse native helper now..." >&2
  if ! command -v npm >/dev/null 2>&1; then
    echo "slop-review: npm is required to build the Glimpse native helper. Install Node.js 20+ and retry." >&2
    exit 1
  fi

  build_status=0
  (cd "$GLIMPSEUI_DIR" && npm run "$BUILD_TARGET") >&2 || build_status=$?

  if [[ "$build_status" -ne 0 || ! -x "$HOST_BIN" ]]; then
    echo "" >&2
    echo "slop-review: failed to build Glimpse native helper." >&2
    if [[ -n "$HOST_DEPS_HINT" ]]; then
      echo "slop-review: $HOST_DEPS_HINT" >&2
    fi
    echo "slop-review: after fixing the build prerequisites, you can retry by running:" >&2
    echo "  (cd '$GLIMPSEUI_DIR' && npm run $BUILD_TARGET)" >&2
    echo "  …or just re-run /slop-review and this script will retry the build." >&2
    exit 1
  fi
fi

exec node "$ROOT/bin/slop-review.js" "$@"
