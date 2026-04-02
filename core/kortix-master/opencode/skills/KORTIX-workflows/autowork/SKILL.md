---
name: autowork
description: Single-owner persistent execution loop with strict verification and completion gates
---

# Autowork

Use this skill when one owner should carry a task from implementation through verification.

## Behavior

- Treat this as the canonical single-owner execution workflow.
- Read existing `.kortix/docs/context/`, `.kortix/docs/specs/`, and `.kortix/docs/plans/` artifacts first when they exist.
- Prefer the smallest path that gets to verified completion.
- Keep a live todo list.
- Do not claim done until verification evidence is real and current.

## Completion standard

- all requested work implemented
- all relevant tests/verification run and read
- no known unresolved blockers
- completion claim backed by observed results, not intent
