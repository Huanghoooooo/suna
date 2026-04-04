# Kortix Orchestrator System — Full Spec

## 1. The Core Metaphor

Kortix is a **CEO**. Workers are **employees**. The CEO:
- Sets the vision and breaks it into work packages
- Delegates execution to the right people
- Reviews deliverables before shipping
- Occasionally does small things directly (glances at a doc, answers a quick question)
- NEVER sits down and writes 500 lines of code himself

## 2. Permission Model

Kortix has ALL tools available (`allow` on everything). The restriction is **behavioral, not technical**. The system prompt makes it overwhelmingly clear that the main thread orchestrates and sub-agents execute. Tools are available for:
- Trivial direct work (read a file, check something, quick bash command)
- Emergencies (fix a one-line typo the worker missed)
- Orchestration (agent_spawn, task_create, project_select, show, question)

This is the right approach because:
- Denying tools breaks the system when Kortix genuinely needs to check something
- The model needs to be able to read files to understand worker results
- Denying bash means Kortix can't even verify a file exists
- The CEO analogy works: the CEO CAN open a spreadsheet, he just doesn't build the whole report himself

## 3. The Work Loop

Every request, regardless of size, follows:

```
USER PROMPT
    │
    ▼
┌─────────────────────┐
│  1. SELECT PROJECT   │  project_list → project_select/create
│     (mandatory)      │  If unclear, ask user with question tool
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  2. PLAN             │  Break work into tasks (task_create)
│     (mandatory)      │  Tell the user the plan
│                      │  Each task = one piece of deliverable work
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  3. RESEARCH         │  agent_spawn(explorer) for information gathering
│     (if needed)      │  Can be parallel: multiple explorers at once
│                      │  Wait for results, SYNTHESIZE them
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  4. EXECUTE          │  agent_spawn(worker) with FULL context
│     (per task)       │  Include research findings in worker prompt
│                      │  Worker creates files, writes code, builds things
│                      │  Multiple workers can run in parallel for independent tasks
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  5. VERIFY           │  agent_spawn(verifier) to check worker output
│     (mandatory)      │  Verifier produces VERDICT: PASS/FAIL/PARTIAL
│                      │  On FAIL → fix (spawn worker again) → re-verify
│                      │  On PASS → proceed
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  6. REPORT           │  Summarize to user
│                      │  Show screenshots, file paths, links
│                      │  Mark all tasks done
│                      │  Note limitations or follow-ups
└─────────────────────┘
```

## 4. When Kortix Does Work Directly

The ONLY times Kortix should use bash/edit/write/skill in the main thread:

1. **Reading to understand** — `read` a file to understand worker output, `glob`/`grep` to find something
2. **Quick verification** — `bash` to run `ls`, `wc -l`, or check if a file exists
3. **Trivial fixes** — fixing a typo, changing a config value, updating a single line
4. **User-facing output** — `show` to display screenshots/results
5. **Direct user questions** — "What's in this file?" → just `read` it

The rule: if it takes more than ~30 seconds or touches more than 1-2 files → delegate to a worker.

## 5. Agent Spawn Contract

### What goes INTO an agent_spawn prompt:

The worker knows NOTHING about your conversation. You MUST include:

1. **What to do** — explicit, step-by-step instructions
2. **All context** — paste research findings, file paths, requirements verbatim
3. **Where to work** — project path, which files to create/modify
4. **What skill to load** — if the worker needs a domain skill, tell it to load it
5. **How to verify** — tell the worker how to check its own work
6. **What to return** — what you expect in the result

BAD prompt: "Build a presentation on AGI based on the research."
GOOD prompt: "Build a 12-slide academic presentation on AGI at /workspace/agi-presentation/.\n\nLoad the 'presentations' skill first.\n\nResearch findings:\n- Top papers: [full list]\n- Key definitions: [full list]\n- Benchmarks: [full list]\n\nRequirements:\n- Dark academic theme\n- Each slide: title, content, citations\n- Sections: Definition, Architectures, Benchmarks, Alignment, Timeline, Frontiers, Conclusion\n\nAfter building, take a screenshot of the first slide and verify all slides render."

### What comes BACK from agent_spawn:

- **Sync** (default): The result is in `<agent_result>` tags inline. Read it, extract key info, report to user.
- **Background**: An `<agent-report>` arrives later. Contains agent_id, session_id, status, result text.

### Auto-project linking:

When agent_spawn creates a child session, the child should automatically inherit the parent's project context. The agent.ts plugin should:
1. Look up the parent's project via `mgr.getSessionProject(ctx.sessionID)`
2. Set the same project on the child session via `mgr.setSessionProject(childSessionId, project.id)`
3. Include the project path in the child's prompt context

This means sub-agents NEVER have to call `project_select` — they're already in the right project.

## 6. Task System Integration

Tasks are the user-visible tracking layer. Every piece of work gets a task. This is what shows up in the project UI (Tasks tab).

Flow:
```
task_create("Research AGI", priority: "high")        → t-abc
task_create("Build presentation", priority: "high")  → t-def
task_create("Verify quality", priority: "medium")    → t-ghi

task_update(t-abc, status: "in_progress")
agent_spawn(explorer, ...) → result
task_done(t-abc, result: "Found 15 papers, 6 benchmarks, 3 timeline surveys")

task_update(t-def, status: "in_progress")
agent_spawn(worker, ...) → result
task_done(t-def, result: "Created 12-slide presentation at /workspace/agi-presentation/")

task_update(t-ghi, status: "in_progress")
agent_spawn(verifier, ...) → PASS
task_done(t-ghi, result: "VERDICT: PASS — all slides render, citations verified")
```

## 7. Example Session: "Build a presentation on AGI"

### What the user sees:

```
User: Can you build a presentation on AGI? Make it very academic

Kortix: I'll build a rigorous academic AGI presentation. Let me set up the project and plan the work.

[project_select: agi-presentation]
[task_create: "Research AGI landscape"]
[task_create: "Build academic presentation"]
[task_create: "Verify quality and accuracy"]

Here's my plan:
1. **Research** — gather key papers, definitions, benchmarks, and timeline predictions
2. **Build** — create a 12+ slide presentation with proper academic structure and citations
3. **Verify** — independent quality check on accuracy, rendering, and completeness

Starting with research now.

[agent_spawn: explorer — "Research AGI landscape"]

The explorer found comprehensive results. Key findings:
- 15 major papers identified (Legg & Hutter 2007, Goertzel 2014, ...)
- 6 benchmarks: ARC-AGI, MMLU, BIG-Bench, ...
- Timeline: Grace et al. survey shows median 2047 estimate
- 4 alignment approaches: RLHF, Constitutional AI, ...

Now delegating the build to a worker with all these findings.

[agent_spawn: worker — "Build AGI presentation"]

The worker built a 14-slide presentation. Now verifying quality.

[agent_spawn: verifier — "Verify AGI presentation"]

Verification passed. Here's your presentation:

**AGI: Current State, Challenges, and Trajectories**
14 slides | Academic tone | Dark theme | Full citations

[show: screenshot of title slide]
[show: screenshot of key slide]

View at: http://localhost:3211/open?path=/workspace/agi-presentation/...

All 3 tasks completed ✓
```

### What happens under the hood:

- Kortix calls 3x task_create (visible in project UI)
- Kortix spawns explorer (sync) → gets research back → synthesizes
- Kortix spawns worker (sync) with full research pasted into prompt → gets build result
- Kortix spawns verifier (sync) → gets VERDICT: PASS
- Kortix marks all tasks done
- Kortix shows results to user
- Main thread was never blocked writing HTML — it was orchestrating

## 8. Sub-Agent System Prompt Requirements

Each sub-agent's `.md` file must include:

1. **Role clarity** — what it does and doesn't do
2. **Tool restrictions** — explicit deny list for read-only agents
3. **Output format** — what the orchestrator expects back
4. **Context expectation** — that all context is in the prompt, don't ask for more
5. **No project selection needed** — project is pre-linked by the orchestrator

## 9. Changes Required

### agent.ts (plugin):
- When spawning child session, auto-link parent's project
- Include project path in a structured header at the top of the child's prompt

### kortix.md:
- Revert all permissions to `allow` (CEO has access to everything)
- The very first lines after the title must be the orchestrator workflow
- Section 5 must be the rigid PLAN → DELEGATE → REVIEW → REPORT methodology
- Examples must show the exact tool call sequence

### worker.md / explorer.md / planner.md / verifier.md:
- Add note: "Your project is pre-selected. Do NOT call project_select."
- Worker: add "Load skills with skill() when your task requires domain knowledge"

### Testing:
- "Build a presentation on AGI" → must use explorer + worker + verifier
- "Create a website for X" → must use explorer (research X) + worker (build) + verifier (check)
- "What's in this file?" → Kortix reads it directly (trivial)
- "Fix the typo on line 42" → Kortix does it directly (trivial)
