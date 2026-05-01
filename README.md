# claude-diff-review

A native diff review window for terminal coding agents, powered by [Glimpse](https://github.com/hazat/glimpse) and [Monaco](https://microsoft.github.io/monaco-editor/). Ships as a plugin for both **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** and **[Codex CLI](https://github.com/openai/codex)**.

Adds a `/diff-review` slash command that:

1. Opens a native review window
2. Defaults to a **PR-style review** of all changes since your branch diverged from the base branch (auto-detected: `origin/HEAD` → `origin/main` → `main` → `origin/master` → `master`), and also supports `last-commit` and `uncommitted` modes — see [Scopes](#scopes)
3. Shows a collapsible sidebar with fuzzy file search and git status markers
4. Lazy-loads file contents on demand as you switch files and scopes
5. Lets you draft comments on the original side, modified side, or whole file
6. Writes the composed feedback to a temp file when you submit; the agent reads it back, so the review shows up in the chat as a regular tool call and gets addressed item-by-item

![demo placeholder](https://placehold.co/900x500?text=claude-diff-review)

## Credit

This is a port of **[badlogic/pi-diff-review](https://github.com/badlogic/pi-diff-review)** by [Mario Zechner](https://github.com/badlogic), which provides the same UI for [`pi`](https://pi.dev). All of the heavy lifting — the Glimpse window orchestration, the Monaco-based review UI, the comment-and-prompt pipeline — was designed and implemented there. This repo:

- Replaces pi's `ExtensionAPI` with Node `child_process` + a small CLI wrapper.
- Replaces pi's editor injection with a temp-file + `Read` round-trip so it can be wired into Claude Code's `!`-style slash commands and stay visible in the chat UI.
- Keeps `web/index.html` and `web/app.js` from the upstream essentially unchanged.

If you use `pi`, just install the upstream extension instead. Please ⭐ the upstream.

## Requirements

- macOS, Linux, or Windows
- Node.js 20+
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- Internet access at runtime for the Tailwind and Monaco CDNs used by the review window

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
/plugin marketplace add dbachelder/claude-diff-review
/plugin install claude-diff-review@claude-diff-review
```

**Codex CLI:**

```bash
codex plugin marketplace add dbachelder/claude-diff-review
codex plugin install claude-diff-review@claude-diff-review
```

(Or whichever exact plugin-install incantation your Codex version uses — the
marketplace add is the part that matters; the plugin shows up under the
`claude-diff-review` marketplace name.)

Either path clones this repo into the agent's plugin cache and registers the
`/diff-review` slash command. The command runs the CLI directly out of the
plugin checkout via `${CLAUDE_PLUGIN_ROOT:-${CODEX_PLUGIN_ROOT}}/bin/plugin-run.sh`,
which on first use does a one-time `npm install` inside the plugin directory —
that's what installs [`glimpseui`](https://www.npmjs.com/package/glimpseui) and
builds its per-platform native helper.

No npm publish is involved: code updates flow through your agent's plugin
update command (which pulls fresh commits from GitHub), and a stamp file in
`node_modules/` makes `plugin-run.sh` re-run `npm install` only when
`package.json` changes.

> **macOS toolchain:** building the Glimpse native helper needs Xcode Command
> Line Tools (`xcode-select --install`). The CLI does a preflight check and
> prints an actionable error if the build was skipped, instead of crashing.

If you'd rather skip the first-run install step, you can also install the CLI
globally — the slash command will prefer a globally-installed binary over the
plugin-local install:

```bash
npm install -g claude-diff-review
```

### Alternative: npm global only (no plugin)

If you don't want to use the plugin system, install the CLI globally and copy
the slash command into `~/.claude/commands/`:

```bash
npm install -g claude-diff-review
# then either:
curl -fsSL https://raw.githubusercontent.com/dbachelder/claude-diff-review/main/commands/diff-review.md \
  -o ~/.claude/commands/diff-review.md
# or, if you cloned the repo:
npm run install-command
```

### Development install

```bash
git clone https://github.com/dbachelder/claude-diff-review.git
cd claude-diff-review
npm install
npm install -g .          # puts `claude-diff-review` on your PATH
npm run install-command   # copies commands/diff-review.md → ~/.claude/commands/
```

## Usage

### From Claude Code

```
/diff-review                       # default: all changes since base branch merge-base
/diff-review last-commit           # only HEAD vs HEAD^
/diff-review uncommitted           # only working-tree changes vs HEAD
/diff-review --base origin/develop # override the base branch
```

The slash command declares an `argument-hint`, so Claude Code's input autocompletes the available forms.

A native window opens. Browse files, leave inline or whole-file comments, then click **Submit feedback**. The CLI writes your feedback to `$TMPDIR/claude-diff-review-<timestamp>.md` and prints the path. Claude Code then `Read`s the file (visible in the UI) and addresses each item. Click **Cancel** or close the window to abort.

### Standalone CLI

The binary is a normal Node CLI; nothing about it is Claude-Code specific. You can invoke it directly to drive your own tool integrations:

```
claude-diff-review [base|last-commit|uncommitted|all] [--base <ref>] [--help]
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
out=$(claude-diff-review last-commit)
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
  Claude Code               !`claude-diff-review`            claude-diff-review
  /diff-review        ───────────────────────────────────►   (Node CLI)
                                                                  │
                                                                  │ glimpseui
                                                                  ▼
                          "FEEDBACK_FILE: <path>"            Native window
                       ◄──────────────────────────           (Monaco diff)
  Read tool: <path>
        │
        ▼
  feedback rendered in chat, Claude addresses each item
```

The two-step (`Bash` → `Read`) flow is what makes the review visible in the
Claude Code UI: the `!`-bash output alone gets folded into the prompt as
silent context, but the subsequent `Read` of the feedback file shows up in
the chat as a regular tool call with the full file contents.

- **`bin/claude-diff-review.js`** — CLI entry. Parses arguments, resolves the base ref + merge-base when in `base` mode, opens the Glimpse window, handles file-content requests. On submit, writes the composed prompt to `$TMPDIR/claude-diff-review-<ts>.md` and prints `FEEDBACK_FILE: <path>` to stdout. On cancel, prints `REVIEW_CANCELLED`.
- **`src/git.js`** — Git scope/diff loader (ported from `src/git.ts`).
- **`src/prompt.js`** — Feedback prompt composer (ported verbatim from `src/prompt.ts`).
- **`src/ui.js`** — Inlines `web/index.html` + `web/app.js` for the Glimpse window.
- **`web/`** — Static UI assets (Monaco, Tailwind via CDN, app logic). Copied from upstream.
- **`commands/diff-review.md`** — Claude Code slash command. Forwards `$ARGUMENTS` to `claude-diff-review`, then instructs Claude to `Read` the feedback file and address each item.

## Layout

```
claude-diff-review/
├── .claude-plugin/
│   ├── plugin.json               # Claude Code plugin manifest
│   └── marketplace.json          # Claude Code marketplace manifest
├── .codex-plugin/
│   ├── plugin.json               # Codex CLI plugin manifest
│   └── marketplace.json          # Codex CLI marketplace manifest
├── bin/
│   ├── claude-diff-review.js     # CLI entry point
│   └── plugin-run.sh             # Slash-command dispatcher (plugin install)
├── src/
│   ├── git.js
│   ├── prompt.js
│   └── ui.js
├── web/
│   ├── index.html
│   └── app.js
├── commands/
│   └── diff-review.md            # Claude Code slash command
├── scripts/
│   └── install-command.js
├── package.json
├── LICENSE
├── NOTICE
└── README.md
```

## Differences from the upstream pi extension

| Concern | pi-diff-review | claude-diff-review |
|---|---|---|
| Slash-command host | pi `ExtensionAPI` | Claude Code `!`-bash slash command |
| Git execution | `pi.exec` | `node:child_process` |
| "Waiting…" indicator | pi-tui custom panel | stderr log line |
| Result delivery | `ctx.ui.setEditorText(prompt)` | Temp file path on stdout → Claude `Read`s the file (visible in UI) |
| Language | TypeScript (typed against pi types) | Plain ESM JavaScript |

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The Monaco Editor and Tailwind assets are loaded from public CDNs; their respective licenses apply.
