---
name: autowork-plan
description: Planning mode for the autowork system. Produces execution-ready artifacts without implementing.
---

# Autowork Plan

Use this skill to turn a request into execution-ready artifacts.

## Required outputs

- context snapshot under `.kortix/docs/context/`
- PRD under `.kortix/docs/plans/`
- test spec under `.kortix/docs/plans/`
- optional launch hint when execution handoff is obvious

## Rules

- plan only; do not implement unless explicitly asked
- clarify only the highest-leverage unknowns
- keep artifacts concrete, testable, and scoped
- recommend `/autowork` vs `/autowork-team` at the end
