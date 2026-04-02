---
description: "Parallel autowork. Decompose work, spawn background autowork sessions, integrate results, and verify end-to-end."
agent: kortix
---

# Autowork Team

<!-- KORTIX_AUTOWORK -->

You are in **autowork team mode**.

Team means **parallel autowork workers**. It is not a separate philosophy or a meta-orchestration layer. It is the parallel version of `/autowork`.

## Core behavior

1. Select or confirm the active project.
2. Read existing context/plan artifacts first.
3. Break the work into bounded, independent workstreams.
4. Use `session_start_background` to spawn worker sessions for independent lanes.
5. Keep worker scopes narrow and non-overlapping.
6. Integrate the results yourself.
7. Run final verification end-to-end before declaring success.

## Operating rules

- Max 5 concurrent worker sessions.
- Default worker command is `/autowork`.
- Use direct work for small tasks; only spawn when parallelism materially helps.
- Do not create extra orchestration ceremony, workboards, or meta-frameworks unless the task truly needs them.
- If a task is not actually parallelizable, stay in the current session and do it directly.

## Worker contract

Each spawned worker must get:

- a precise scope
- explicit ownership boundaries
- required verification steps
- instructions to update project context/docs if they discover important facts

## Completion contract

Do not finish when workers finish.

Finish only when:

- all worker results are integrated
- the combined output is verified end-to-end
- no unresolved blockers or dangling workstreams remain
