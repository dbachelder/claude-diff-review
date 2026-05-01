# slop-review

A native diff review window for terminal coding agents, powered by [Glimpse](https://github.com/hazat/glimpse) and [Monaco](https://microsoft.github.io/monaco-editor/). Ships for **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)**, **[Codex CLI](https://github.com/openai/codex)**, and **[pi](https://pi.dev)** — review the slop before you ship it.

- In **Claude Code** it adds a `/slop-review` slash command.
- In **Codex CLI** it ships as a `slop-review` skill (auto-invoked when you ask for a review, or explicitly via `@slop-review`).
- In **pi** it registers a `/slop-review` slash command (the upstream this is forked from — see Credit below).

All three:

1. Open a native review window
2. Default to a **PR-style review** of all changes since your branch diverged from the base branch (auto-detected: `origin/HEAD` → `origin/main` → `main` → `origin/master` → `master`), and also support `last-commit` and `uncommitted` modes — see [Scopes](#scopes)
3. Show a collapsible sidebar with fuzzy file search and git status markers
4. Lazy-load file contents on demand as you switch files and scopes
5. Let you draft comments on the original side, modified side, or whole file
6. Write the composed feedback to a temp file when you submit; the agent reads it back, so the review shows up in the chat as a regular tool call and gets addressed item-by-item

![demo placeholder](https://placehold.co/900x500?text=slop-review)

## Credit

This is a fork of **[badlogic/pi-diff-review](https://github.com/badlogic/pi-diff-review)** by [Mario Zechner](https://github.com/badlogic), which provides the same UI for [`pi`](https://pi.dev). All of the heavy lifting — the Glimpse window orchestration, the Monaco-based review UI, the comment-and-prompt pipeline, and the in-terminal Escape-to-cancel waiting overlay (in our pi adapter) — was designed and implemented there. This repo:

- Adds a standalone Node CLI (`bin/slop-review.js`) so the same UI can be driven from any host that can shell out.
- Adds Claude Code (slash command) and Codex CLI (skill) adapters that use a temp-file + `Read` round-trip so the review stays visible in the chat UI.
- Adds a pi extension under `extensions/pi/` that registers `/slop-review` in pi (parallel to the upstream's `/diff-review`) and uses upstream's idiomatic `setEditorText` flow — same UX as the upstream.
- Adds PR-style review (everything since merge-base with the auto-detected base branch) as the default scope, with explicit `last-commit`, `uncommitted`, and `all` modes also available.
- Keeps `web/index.html` and `web/app.js` from the upstream essentially unchanged.

If you only use pi and just want the upstream behavior, install [`badlogic/pi-diff-review`](https://github.com/badlogic/pi-diff-review) instead. Please ⭐ the upstream regardless.

## Requirements

- macOS, Linux, or Windows
- Node.js 20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), **or** [pi](https://pi.dev)
- Internet access at runtime for the Tailwind and Monaco CDNs used by the review window
- **Native build toolchain** — Glimpse compiles a per-platform native helper on first install:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: Rust (https://rustup.rs) + GTK4/WebKit2GTK dev packages
    - Fedora: `dnf install gtk4-devel webkitgtk6.0-devel gtk4-layer-shell-devel`
    - Ubuntu: `apt install libgtk-4-dev libwebkitgtk-6.0-dev libgtk4-layer-shell-dev`
    - Arch: `pacman -S gtk4 webkitgtk-6.0 gtk4-layer-shell`
  - **Windows**: .NET 8 SDK

  Claude Code and some other agents run `npm install --ignore-scripts` when materializing plugins, which suppresses Glimpse's normal postinstall build. `bin/plugin-run.sh` detects this and re-builds the helper explicitly on first invocation, so you'll see a one-time delay (a few seconds for Swift, longer for Rust) before the review window opens.

### Windows notes

Glimpse supports Windows, but the native host build during install requires:

- .NET 8 SDK
- Microsoft Edge WebView2 Runtime

## Install

### Recommended: as an agent plugin (no npm publish required)

The repo doubles as a single-plugin marketplace for both Claude Code and Codex
CLI, served straight from GitHub.

**Claude Code:**

```bash
# inside Claude Code
/plugin marketplace add dbachelder/slop-review
/plugin install slop-review@slop-review
```

This registers the `/slop-review` slash command.

**Codex CLI:**

Codex separates marketplace registration (CLI) from plugin enablement (TUI).
Both steps are required:

```bash
# 1. Register the marketplace
codex plugin marketplace add dbachelder/slop-review
```

```
# 2. Inside `codex`, type:
/plugins
```

In the plugin browser, switch to the `Slop Review` (slop-review) marketplace
tab, select the `slop-review` plugin, and press *Install plugin*. This enables
the `slop-review` skill, which the model auto-loads when you ask it to review
your changes (or which you can invoke explicitly with `@slop-review`).

> **Why a skill instead of a slash command in Codex?** Codex's plugin system
> doesn't expose user-defined slash commands; it uses *skills* (markdown the
> model loads when descriptions match the user's intent) and `@`-invocation.
> The same repo serves the slash command to Claude Code via `commands/` and
> the skill to Codex via `skills/`, both pointing at the same dispatcher.

If you prefer to skip the TUI, you can enable the plugin by editing
`~/.codex/config.toml` directly:

```toml
[plugins."slop-review@slop-review"]
enabled = true
```

Then restart Codex.

**pi:**

pi's package system handles the install end-to-end — `pi install` clones the
repo into pi's package directory, runs `npm install` for `glimpseui`, and
registers the `/slop-review` command:

```bash
# Global install
pi install git:github.com/dbachelder/slop-review

# Or pin to a tag
pi install git:github.com/dbachelder/slop-review@v0.4.0

# Or try without installing (single-run)
pi -e git:github.com/dbachelder/slop-review
```

Then inside pi:

```
/slop-review                       # default: PR-style review
/slop-review last-commit
/slop-review --base origin/develop
```

When you submit feedback, the composed prompt is dropped into pi's input
editor (idiomatic for pi — same UX as the upstream `pi-diff-review`). Press
`Escape` while the window is open to cancel.

To update later: `pi update` or `pi update git:github.com/dbachelder/slop-review`.

**How all three paths work**

Three thin host adapters, one shared core:

| Host | Adapter | How it surfaces in the host | Result delivery |
|---|---|---|---|
| Claude Code | `commands/slop-review.md` → `bin/plugin-run.sh` → `bin/slop-review.js` | `/slop-review` slash command | Temp file path + agent `Read`s it back |
| Codex CLI | `skills/slop-review/SKILL.md` → `bin/plugin-run.sh` → `bin/slop-review.js` | `slop-review` skill (auto-load + `@slop-review`) | Temp file path + agent `Read`s it back |
| pi | `extensions/pi/index.ts` — uses `pi.exec` and `glimpseui` directly, no CLI | `/slop-review` slash command | `ctx.ui.setEditorText(prompt)` — prompt drops into pi's input editor |

All three share `src/git.js` (factory pattern — host injects an `exec`
callable), `src/prompt.js`, `src/ui.js`, and the `web/` Monaco bundle.

For Claude Code and Codex, either install clones this repo into the agent's
plugin cache; `bin/plugin-run.sh` does a one-time `npm install` inside the
plugin directory on first invocation — that's what installs
[`glimpseui`](https://www.npmjs.com/package/glimpseui) and builds its
per-platform native helper. Codex sets `CLAUDE_PLUGIN_ROOT` for plugin shell
calls (confirmed in the codex-cli 0.128 binary), so the same dispatcher works
in both agents with no special-casing.

For pi, `pi install` handles the clone + `npm install` for you.

No npm publish is involved: code updates flow through your agent's update
command — `/plugin update` in Claude Code, `codex plugin marketplace upgrade`
in Codex, `pi update` in pi. A stamp file in `node_modules/` makes
`plugin-run.sh` re-run `npm install` only when `package.json` changes (for
Claude/Codex). pi handles dep refresh on its own.

> **macOS toolchain:** building the Glimpse native helper needs Xcode Command
> Line Tools (`xcode-select --install`). The CLI does a preflight check and
> prints an actionable error if the build was skipped, instead of crashing.

If you'd rather skip the first-run install step, you can also install the CLI
globally — the slash command will prefer a globally-installed binary over the
plugin-local install:

```bash
npm install -g slop-review
```

### Alternative: npm global only (no plugin)

If you don't want to use the plugin system, install the CLI globally and copy
the slash command into `~/.claude/commands/`:

```bash
npm install -g slop-review
# then either:
curl -fsSL https://raw.githubusercontent.com/dbachelder/slop-review/main/commands/slop-review.md \
  -o ~/.claude/commands/slop-review.md
# or, if you cloned the repo:
npm run install-command
```

### Development install

```bash
git clone https://github.com/dbachelder/slop-review.git
cd slop-review
npm install
npm install -g .          # puts `slop-review` on your PATH
npm run install-command   # copies commands/slop-review.md → ~/.claude/commands/
```

## Usage

### From Claude Code

```
/slop-review                       # default: all changes since base branch merge-base
/slop-review last-commit           # only HEAD vs HEAD^
/slop-review uncommitted           # only working-tree changes vs HEAD
/slop-review --base origin/develop # override the base branch
```

The slash command declares an `argument-hint`, so Claude Code's input autocompletes the available forms.

### From pi

```
/slop-review                       # default: all changes since base branch merge-base
/slop-review last-commit
/slop-review uncommitted
/slop-review --base origin/develop
```

The pi adapter also registers an autocomplete for the scope argument, so
tab-complete works in pi's input.

When you submit, the composed feedback is dropped into pi's input editor for
you to review and send. While the window is open, press `Escape` from the
pi terminal to cancel.

### From Codex CLI

Just ask for a review in natural language and the `slop-review` skill auto-loads:

```
> review my changes
> review the slop on this branch against main
> open a PR-style review
```

Or invoke it explicitly:

```
> @slop-review
> @slop-review last-commit
> @slop-review --base origin/develop
```

### What happens

A native window opens. Browse files, leave inline or whole-file comments, then click **Submit feedback**. The CLI writes your feedback to `$TMPDIR/slop-review-<timestamp>.md` and prints the path. The agent then reads the file (visible in the UI as a `Read` / file-read tool call) and addresses each item. Click **Cancel** or close the window to abort.

### Standalone CLI

The binary is a normal Node CLI; nothing about it is agent-specific. You can invoke it directly to drive your own tool integrations:

```
slop-review [base|last-commit|uncommitted|all] [--base <ref>] [--help]
```

Contract:

| Outcome | stdout | exit |
|---|---|---|
| User submits feedback | `FEEDBACK_FILE: <absolute path>\n` | `0` |
| User cancels / closes window / no reviewable files | `REVIEW_CANCELLED\n` | `0` |
| Bad arguments | (nothing; usage on stderr) | `2` |
| Other error | (nothing; error on stderr) | `1` |

Status messages ("Opened review window…", base-ref resolution, etc.) go to **stderr**, so stdout stays clean for piping. Example:

```bash
out=$(slop-review last-commit)
case "$out" in
  FEEDBACK_FILE:*) cat "${out#FEEDBACK_FILE: }" ;;
  REVIEW_CANCELLED) echo "cancelled" ;;
esac
```

### Scopes

| Scope | Compares | Use when |
|---|---|---|
| `base` *(default)* | merge-base of HEAD and base branch → working tree | You want the full PR-style review of everything you've done on this branch, committed or not. Base branch is auto-detected: `origin/HEAD` → `origin/main` → `main` → `origin/master` → `master`. Override with `--base <ref>`. |
| `last-commit` | HEAD^ → HEAD | You just committed and want to review only that commit. |
| `uncommitted` | HEAD → working tree | You want to review only what's still unstaged/staged but not committed. |
| `all` | (no diff; shows working tree) | Browsing the tree without a diff scope. Mostly for debugging. |

In `base` mode, the "git diff" tab in the window is relabelled `vs <base-ref>` so you can tell which ref you're comparing against. If no base branch is found, the CLI falls back to `uncommitted` and logs a warning.

## How it works

```
  Agent                     bash plugin-run.sh                slop-review
  /slop-review        ───────────────────────────────────►    (Node CLI)
  @slop-review                                                     │
                                                                   │ glimpseui
                                                                   ▼
                          "FEEDBACK_FILE: <path>"             Native window
                       ◄──────────────────────────            (Monaco diff)
  Read tool: <path>
        │
        ▼
  feedback rendered in chat, agent addresses each item
```

The two-step (`Bash` → `Read`) flow is what makes the review visible in the
chat UI: the bash output alone gets folded into the prompt as context, but
the subsequent `Read` of the feedback file shows up as a regular tool call
with the full file contents.

- **`bin/slop-review.js`** — CLI entry. Parses arguments, resolves the base ref + merge-base when in `base` mode, opens the Glimpse window, handles file-content requests. On submit, writes the composed prompt to `$TMPDIR/slop-review-<ts>.md` and prints `FEEDBACK_FILE: <path>` to stdout. On cancel, prints `REVIEW_CANCELLED`.
- **`bin/plugin-run.sh`** — Plugin dispatcher. Resolves the plugin root from `$CLAUDE_PLUGIN_ROOT` (set by both Claude Code and Codex), `npm install`s on first run, then exec's the CLI.
- **`src/git.js`** — Git scope/diff loader (ported from `src/git.ts`).
- **`src/prompt.js`** — Feedback prompt composer (ported verbatim from `src/prompt.ts`).
- **`src/ui.js`** — Inlines `web/index.html` + `web/app.js` for the Glimpse window.
- **`web/`** — Static UI assets (Monaco, Tailwind via CDN, app logic). Copied from upstream.
- **`commands/slop-review.md`** — Claude Code slash command. Forwards `$ARGUMENTS` to the dispatcher, then instructs Claude to `Read` the feedback file and address each item.
- **`skills/slop-review/SKILL.md`** — Codex skill. Same instructions, formatted as a skill that the model auto-loads when the user asks for a review.

## Layout

```
slop-review/
├── .claude-plugin/
│   ├── plugin.json               # Claude Code plugin manifest
│   └── marketplace.json          # Marketplace manifest (also read by Codex)
├── .codex-plugin/
│   └── plugin.json               # Codex CLI plugin manifest
├── bin/
│   ├── slop-review.js            # CLI entry point (Claude + Codex)
│   └── plugin-run.sh             # Plugin dispatcher (Claude + Codex)
├── src/                          # SHARED across all three host adapters
│   ├── args.js                   # arg parser (CLI + pi)
│   ├── git.js                    # createGitOps({ exec }) — host injects exec
│   ├── prompt.js                 # composes the feedback prompt
│   └── ui.js                     # inlines web/ into a single HTML doc
├── web/                          # Monaco UI bundle (mostly unchanged from upstream)
│   ├── index.html
│   └── app.js
├── commands/
│   └── slop-review.md            # Claude Code slash command
├── skills/
│   └── slop-review/
│       └── SKILL.md              # Codex skill (auto-loaded; @-invokable)
├── extensions/
│   └── pi/
│       ├── index.ts              # pi extension entry (registers /slop-review)
│       └── types.ts              # wire-format types for the Glimpse ↔ host channel
├── scripts/
│   └── install-command.js
├── package.json                  # bin: slop-review; pi.extensions: extensions/pi/index.ts
├── LICENSE
├── NOTICE
└── README.md
```

## Differences from the upstream pi extension

| Concern | pi-diff-review | slop-review |
|---|---|---|
| Hosts | pi only | pi + Claude Code + Codex CLI |
| pi command name | `/diff-review` | `/slop-review` |
| Default scope | All three tabs visible, no default scope | PR-style: changes since merge-base with auto-detected base branch |
| Args | (none) | `[base\|last-commit\|uncommitted\|all] [--base <ref>]` |
| pi result delivery | `ctx.ui.setEditorText(prompt)` | Same |
| pi waiting UI | pi-tui custom panel + Escape-to-cancel | Same (verbatim port) |
| Claude/Codex result delivery | n/a | Temp file path on stdout → agent `Read`s the file (visible in chat UI) |
| Git execution (pi) | `pi.exec` | Same (host-injected via `createGitOps({ exec: pi.exec })`) |
| Git execution (Claude/Codex) | n/a | `node:child_process` |
| Language | TypeScript | TypeScript for the pi extension; plain ESM JavaScript everywhere else |

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The Monaco Editor and Tailwind assets are loaded from public CDNs; their respective licenses apply.
