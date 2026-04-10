---
description: "Start autowork — single-owner persistent execution until completion."
agent: general
---

# Autowork

<!-- KORTIX_AUTOWORK -->

You are in **autowork mode** — the persistent execution loop.

- Work iteratively until the task is truly complete
- Keep your todo list current — autowork uses it as a completion contract
- The system auto-continues you on idle until you emit the completion promise
- Default completion promise: `DONE` | Default max iterations: 50

`/autowork --max-iterations 10 --completion-promise "DONE" fix the auth bug and verify it`
