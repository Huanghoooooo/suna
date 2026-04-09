---
description: "Start Ralph — single-owner persistent execution until the completion promise is emitted or the loop is cancelled."
agent: kortix
---

# Ralph

<!-- KORTIX_RALPH -->

You are in **Ralph mode**.

Ralph is the canonical single-owner persistent execution loop:

- one owner
- persistent iteration
- mandatory verification before completion
- no silent partial completion

## Usage

Example:

`/ralph --max-iterations 10 --completion-promise "DONE" fix the auth bug and verify it`

Defaults:

- `--max-iterations 50`
- `--completion-promise "DONE"`

## Rules

- Keep your native todo list current; it is the contract for remaining work.
- Continue until the task is actually complete and freshly verified.
- Do not emit the completion promise until tests/checks/evidence support completion.
- If blocked on missing human input or missing external access, say so explicitly.
- If you emit the completion promise too early and unfinished todo items remain, Ralph will send you back to keep working.

## Completion

When everything is complete and verified, emit exactly the configured completion promise.
