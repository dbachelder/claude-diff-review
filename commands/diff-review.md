---
description: Open a native diff review window (Monaco-powered) and address the resulting feedback
allowed-tools: Bash(claude-diff-review:*), Read
---

## Native review tool output

!`claude-diff-review`

## Your task

The block above is the stdout of `claude-diff-review`. Interpret it as follows:

- If it contains a line `FEEDBACK_FILE: <path>`, use the **Read** tool to load that file. Its contents are the user's review feedback (numbered items, possibly with an overall comment). Address each numbered item carefully. After you finish, briefly summarize what you changed.
- If it contains `REVIEW_CANCELLED`, reply with a single short line confirming the review was cancelled and do nothing else.
- If it contains neither (e.g. an error), reply with the error and do nothing else.
