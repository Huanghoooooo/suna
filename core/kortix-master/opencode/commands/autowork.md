---
description: "Compatibility alias for Ralph single-owner persistent execution."
agent: kortix
---

# Autowork

Autowork now uses **Ralph** semantics.

Use `/autowork ...` exactly like `/ralph ...`.

Recommended modern surface:

- `/ralph`
- `/ralph-loop`
- `/cancel-ralph`

Compatibility aliases:

- `/autowork` → `/ralph`
- `/autowork-cancel` → `/cancel-ralph`

Accepted flags:

- `--max-iterations <n>`
- `--completion-promise "TEXT"`

Emit the configured completion promise only after verified completion.
