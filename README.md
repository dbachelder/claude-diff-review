# claude-diff-review

A native diff review window for **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)**, powered by [Glimpse](https://github.com/hazat/glimpse) and [Monaco](https://microsoft.github.io/monaco-editor/).

Adds a `/diff-review` slash command that:

1. Opens a native review window
2. Lets you switch between `git diff`, `last commit`, and `all files` scopes
3. Shows a collapsible sidebar with fuzzy file search and git status markers
4. Lazy-loads file contents on demand as you switch files and scopes
5. Lets you draft comments on the original side, modified side, or whole file
6. Writes the composed feedback to a temp file when you submit, and Claude Code's `Read` tool loads it into the conversation so it's fully visible in the UI

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

```bash
git clone https://github.com/dbachelder/claude-diff-review.git
cd claude-diff-review
npm install
npm install -g .          # puts `claude-diff-review` on your PATH
npm run install-command   # copies commands/diff-review.md → ~/.claude/commands/
```

Then inside Claude Code:

```
/diff-review
```

A native window opens. Browse files, leave inline or whole-file comments, then click **Submit feedback**. The CLI writes your feedback to `$TMPDIR/claude-diff-review-<timestamp>.md` and prints the path. Claude Code then `Read`s the file (visible in the UI) and addresses each item. Click **Cancel** or close the window to abort.

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

- **`bin/claude-diff-review.js`** — CLI entry. Reads git state, opens the Glimpse window, handles file-content requests. On submit, writes the composed prompt to `$TMPDIR/claude-diff-review-<ts>.md` and prints `FEEDBACK_FILE: <path>` to stdout. On cancel, prints `REVIEW_CANCELLED`.
- **`src/git.js`** — Git scope/diff loader (ported from `src/git.ts`).
- **`src/prompt.js`** — Feedback prompt composer (ported verbatim from `src/prompt.ts`).
- **`src/ui.js`** — Inlines `web/index.html` + `web/app.js` for the Glimpse window.
- **`web/`** — Static UI assets (Monaco, Tailwind via CDN, app logic). Copied from upstream.
- **`commands/diff-review.md`** — Claude Code slash command. Runs `!claude-diff-review`, then instructs Claude to `Read` the feedback file and address each item.

## Layout

```
claude-diff-review/
├── bin/
│   └── claude-diff-review.js     # CLI entry point
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
