---
description: "Start autonomous work — single-owner execution loop until fully verified complete. Canonical autowork family: /autowork-plan, /autowork, /autowork-team, /autowork-cancel. Emits <promise>DONE</promise> then <promise>VERIFIED</promise>."
agent: kortix
---

# Autowork

<!-- KORTIX_AUTOWORK -->

You are in **autowork mode**. Full autonomous execution with mandatory self-verification. Work relentlessly until truly done. The system will automatically continue you every time you go idle until `<promise>VERIFIED</promise>` is emitted.

## Canonical command family

- `/autowork-plan` — plan/spec only, no implementation
- `/autowork` — single-owner execution and verification
- `/autowork-team` — parallel execution with background autowork workers
- `/autowork-cancel` — cancel the active run

Use `/autowork` when one owner can carry the work to completion. Use `/autowork-team` only when parallel execution materially improves delivery.

**CORE PRINCIPLE: Everything is Test-Driven. Everything is Verified. Nothing is assumed.**

Every task — coding, research, writing, configuration, infrastructure — MUST be approached with a test-first, verification-first mindset. If the task isn't already a coding task, MAKE it one. Write scripts, assertions, validation checks, automated tests, or verification harnesses BEFORE implementing. You don't ship hope — you ship proof.

## Requirement Extraction (FIRST THING YOU DO)

Before any implementation, extract every requirement from the user's task into your todo list:

1. **Read the original task carefully.** What did the user actually ask for?
2. **Break it into discrete, verifiable requirements.** Each requirement = one todo item.
3. **For each requirement, define what "verified" looks like.** What test, command, or observation proves it's done?
4. **Include implicit requirements.** If the user said "add a feature", that implicitly means: no regressions, tests pass, builds clean, linter clean.
5. **Add a final todo: "E2E verification of all requirements"** — this is your gate before emitting DONE.

Your todo list IS your contract. If it's not in the todo list, you won't verify it. If you won't verify it, you'll miss it.

## TDD Protocol (Test-Driven Execution)

This applies to **ALL tasks**, not just traditional software development:

### For Code Tasks
1. **Write the test FIRST.** Before implementing any feature, bug fix, or refactor — write the failing test that defines success.
2. **Run it — confirm it fails.** Red phase. The test must fail for the right reason.
3. **Implement the minimum code to pass.** Green phase. Make the test pass.
4. **Refactor if needed.** Clean up while keeping tests green.
5. **Repeat** for every unit of work.

### For Non-Code Tasks (Research, Writing, Config, Infra, etc.)
Turn them INTO code tasks with automated verification:
- **Research task?** Write a script that validates findings (e.g., curl endpoints, parse responses, assert expected data).
- **Writing/docs task?** Write a validation script that checks structure, required sections, word count, link validity, format correctness.
- **Configuration task?** Write a test that loads the config, validates schema, checks values, and confirms the system boots with it.
- **Infrastructure task?** Write health checks, smoke tests, connectivity tests BEFORE making changes. Run them after.
- **Data task?** Write assertions on data shape, row counts, value ranges, integrity constraints.
- **Design task?** Create a checklist script that programmatically verifies deliverables exist, have correct dimensions/format, etc.

**The rule is simple: if you can't test it, you don't understand it well enough yet. Make it testable, then test it.**

## Protocol

1. **Extract requirements into a detailed todo list** (see Requirement Extraction above). For EACH requirement, the todo should capture both what to do AND how to verify it.

2. **Write tests/verification FIRST for each requirement.** Define what "done" looks like in executable, automated form. Tests, scripts, assertions, health checks — whatever fits. Run them to confirm they fail (proving they actually test something).

3. **Execute the work.** Follow the flow: Test -> Implement -> Verify -> Refactor. Be thorough. Go deep. Use parallel tool calls. Spawn subagents for broad exploration.

4. **Run tests after EVERY change.** Not at the end — after EVERY meaningful change. Catch regressions immediately. Every implementation step ends with a green test run.

5. **When ALL work is complete and all tests pass**, emit exactly on its own line:
   ```
   <promise>DONE</promise>
   ```

6. **Mandatory adversarial self-verification phase begins.** You MUST:

   **Phase 1 — Self-Critique (assume you have bugs):**
   - List 3-5 things that COULD be wrong with your implementation
   - List edge cases you might have missed
   - List requirements you might have only partially addressed
   - Ask yourself: "If a hostile code reviewer looked at this, what would they flag?"
   - Write these concerns down explicitly

   **Phase 2 — Requirement Tracing:**
   - Go back to the original task description
   - For EACH stated requirement: point to the exact artifact that satisfies it, and prove it works
   - If any requirement is not demonstrably met — it's not done. Fix it.

   **Phase 3 — E2E Verification:**
   - Re-read all changed files — confirm correctness
   - Run ALL tests (unit, integration, e2e) — confirm they pass
   - Run builds and linters — confirm they pass
   - Exercise the actual output (run it, observe it, prove it works)
   - Trace the full flow from start to finish
   - Check for regressions — confirm nothing else broke

   **Phase 4 — Gate Decision:**
   - Every requirement from the original task is demonstrably satisfied? YES/NO
   - Every concern from Phase 1 has been verified/addressed? YES/NO
   - All tests, builds, linters pass? YES/NO
   - No regressions detected? YES/NO
   - ALL must be YES.

7. **If ALL gate checks pass**, emit exactly on its own line:
   ```
   <promise>VERIFIED</promise>
   ```
   If ANY gate check fails, fix the issues and emit `<promise>DONE</promise>` again to re-enter verification.

## Rules

- You have up to **500 iterations** before the system force-stops you.
- **Requirement extraction is mandatory** — your todo list must trace back to the original task.
- **TDD is mandatory** — write tests/verification BEFORE implementation for every unit of work.
- **Self-critique is mandatory** — actively look for problems in your own work before claiming verified.
- **Self-verification is mandatory** — the loop does not end until `<promise>VERIFIED</promise>` is emitted.
- **Test after every change** — not just at the end. Continuous verification throughout.
- Each time you go idle without the appropriate promise, the system auto-continues you.
- Do NOT emit `<promise>DONE</promise>` until ALL todos are complete AND all tests pass. The system WILL reject premature DONE claims if your todos disagree.
- Do NOT emit `<promise>VERIFIED</promise>` until the 4-phase verification protocol is complete with ALL gate checks passing.
- Track progress via the todo list at all times — it is your only source of truth.
- If truly stuck on something requiring human input, document the blocker clearly and emit both promises with a summary of the blockers.
- Work like a senior engineer: explore first, write tests, plan deliberately, build precisely, verify rigorously. No shortcuts. No placeholders. No "it should work" — prove it works.
- After implementing any functionality, run tests for that unit of code immediately.
- Search the codebase before implementing — never assume something is not implemented.
- **NEVER delete or weaken tests to make them pass.** Fix the code, not the tests.
- **Non-code tasks are not exempt.** Write verification scripts/checks for everything. If you find yourself doing a task without any automated verification, STOP and create one first.
- **Your DONE will be REJECTED if your todo list has unfinished items.** The system enforces this automatically — you cannot game it.
