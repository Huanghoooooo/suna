---
name: autowork-team
description: Parallel autowork using bounded background sessions with explicit integration and verification.
---

# Autowork Team

Team means the parallel version of autowork.

## Use this when

- the task has multiple independent lanes
- integration is still owned by one lead session
- parallel execution materially improves speed or safety

## Rules

- use `session_start_background` for worker lanes
- keep scopes narrow and non-overlapping
- use no more than 5 concurrent workers
- integrate and verify results in the lead session
- do not build orchestration theater when direct execution is enough
