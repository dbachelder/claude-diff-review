---
description: Open a native diff review window (Monaco-powered) and address the resulting feedback
allowed-tools: Bash(claude-diff-review:*), Bash(npx:*), Read
argument-hint: "[base|last-commit|uncommitted|all] [--base <ref>]"
---

## Native review tool output

!`command -v claude-diff-review >/dev/null 2>&1 && claude-diff-review $ARGUMENTS || npx -y claude-diff-review@latest $ARGUMENTS`

## Your task

The block above is the stdout of `claude-diff-review`. Interpret it as follows:

- If it contains a line `FEEDBACK_FILE: <path>`, use the **Read** tool to load that file. Its contents are the user's review feedback (numbered items, possibly with an overall comment). Address each numbered item carefully. After you finish, briefly summarize what you changed.
- If it contains `REVIEW_CANCELLED`, reply with a single short line confirming the review was cancelled and do nothing else.
- If it contains neither (e.g. an error), reply with the error and do nothing else.

Defaults: if the user invoked `/diff-review` with no arguments, the review covers all changes since the merge-base with the auto-detected base branch (`origin/HEAD` → `origin/main` → `main` → `origin/master` → `master`). Other valid first arguments are `last-commit` (HEAD vs HEAD^), `uncommitted` (working tree vs HEAD), or `all`. Pass `--base <ref>` to override the base branch.
