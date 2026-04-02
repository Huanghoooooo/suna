---
name: kortix-projects-sessions
description: "Kortix projects + sessions reference: project CRUD, worker session spawning, DONE/VERIFIED protocol, session retrieval, background orchestration, and SQLite inspection."
---

# Kortix Projects + Sessions

Projects are named, path-bound work contexts. Sessions are conversation threads that can be spawned, resumed, searched, and read. This skill covers both systems and how they interact.

---

## Project Selection — The First Thing You Do

Every session requires a project. All file/bash/edit tools are gated until one is selected. The runtime injects `<project_status>` into every message so you always know the current state.

### Decision Flow

When a session starts with no project selected:

1. **`project_list`** — see what exists
2. **Decide** whether the user's request fits an existing project:
   - **Clearly fits an existing project** → `project_select` it directly
   - **Clearly new work** → `project_create` a new project, then `project_select` it
   - **Ambiguous** → **ask the user** with the `question` tool. Show the existing projects as options and include "Create a new project" as a choice. **Do not assume.**
3. **Only then** proceed with the actual work

This is not optional. The `question` tool approach is the correct default when there's any doubt about which project the work belongs to.

---

## Projects

### Project Tools

| Tool | Description |
|---|---|
| `project_create(name, description, path)` | Register a directory. Creates scaffold if new. Idempotent. |
| `project_list()` | List all projects with paths, session counts, descriptions. |
| `project_get(name)` | Get one project. Accepts name (fuzzy) or absolute path. |
| `project_update(project, name, description)` | Update name or description. |
| `project_select(project)` | Select this project for the session. **Required before file/bash/edit tools.** |

### Project Directory Scaffold

`project_create` creates this structure for new projects:

```
<project>/
├── .kortix/
│   ├── project.json        # identity marker { name, description, created }
│   ├── CONTEXT.md          # shared project context — auto-injected for linked sessions
│   ├── plans/              # plans and roadmaps
│   ├── docs/               # shared docs for cross-session context
│   └── sessions/           # persisted session results (auto-written on completion)
├── .opencode/
│   ├── agents/
│   ├── skills/
│   ├── commands/
│   └── opencode.jsonc
└── .gitignore
```

A git repo is initialized automatically if one doesn't exist.

### Project Context (`CONTEXT.md`)

Each project has a `.kortix/CONTEXT.md` file. This is the project's shared memory:

- Auto-injected into normal chat for sessions linked to that project.
- Read by the orchestrator when spawning worker sessions — included in the worker assignment prompt.
- Workers are instructed to update it with discoveries and decisions.

Keep `CONTEXT.md` concise. Put deeper project notes in `.kortix/docs/*.md` and reference them from `CONTEXT.md`.

**Write to CONTEXT.md:** project architecture, conventions, environment setup, discovered facts, cross-session decisions.

**Don't write:** raw tool output, logs, task progress, debugging trails.

### Project Discovery

`project_list()` uses three sources:

1. **Filesystem scan** — walks up to 2 levels from workspace root looking for `.kortix/project.json`
2. **OpenCode project sync** — queries the OpenCode API to register any OC projects missing from Kortix, and link `opencode_id` bidirectionally
3. **Unlinked resolution** — triggers OC registration for projects with `.git` but no `opencode_id`

### Session-Project Link

Every session must be linked to a project via `project_select` before using file/bash/edit tools. The link is stored in the `session_projects` table in the orchestrator DB and cached in-memory per session.

Ungated tools (always allowed without a project): `project_*`, `session_*`, `worktree_*`, `web_search`, `image_search`, `scrape_webpage`, `instance_dispose`, `context7_*`, `todowrite`, `todoread`, `show`, `question`, `skill`, `webfetch`, `apply_patch`.

---

## Session Retrieval Tools

### `session_list`

Browse recent sessions by metadata.

```text
session_list()
session_list({ search: "auth" })
session_list({ limit: 50 })
```

Returns: ID, title, timestamps, file change summary, parent ID.

### `session_search`

Full-text search over session titles, messages, and part payloads.

```text
session_search({ query: "auth redirect" })
session_search({ query: "memory simplification", limit: 3 })
```

Returns: compact session-level hits with reason and snippet.

### `session_get`

Retrieve one session with TTC compression (semantic transcript compression).

```text
session_get({ session_id: "ses_abc123" })
session_get({ session_id: "ses_abc123", aggressiveness: 0.7 })
```

Returns: metadata, todos, lineage summary, conversation transcript.
Requires `TTC_API_KEY` env var; falls back to uncompressed if not set.

### `session_lineage`

Trace parent/child continuation chains via OpenCode's `parentID` links.

```text
session_lineage({ session_id: "ses_abc123" })
```

Use when a conversation continued across compression or resumed sessions.

---

## Background Sessions (Autowork Team Substrate)

Background sessions are the primary mechanism for parallel autonomous work. They are the substrate behind `/autowork-team`, and each worker typically runs the `/autowork` loop before reporting back.

### Primary Tools

| Tool | Scope | Notes |
|---|---|---|
| `session_start_background` | New: project-scoped. Resume: session-scoped | Preferred tool |
| `session_list_background` | Optional project scope | With `project` → filters; without → cross-project |
| `session_read` | Session-scoped | Reads running or completed sessions |
| `session_message` | Session-scoped | Sends message into a running session |

### Compatibility Aliases

- `session_spawn` = `session_start_background`
- `session_list_spawned` = `session_list_background`

### Spawn vs Resume

**New session** — pass `project` (name or path), `prompt`, optionally `agent`, `model`, `command`:

```text
session_start_background({
  project: "my-project",
  description: "Short label",
  prompt: "Implement X feature with tests...",
  agent: "",        // "" = kortix (default)
  model: "",        // "" = agent default
  command: "",      // "" = /autowork (default)
  session_id: "",   // "" = create new
  subagent_type: "" // deprecated, use agent
})
```

**Resume existing session** — pass `session_id` instead of (or alongside) `project`:

```text
session_start_background({
  session_id: "ses_abc123",
  prompt: "Continue from where you left off, now also handle edge case X",
  project: "",  // can be omitted when resuming
  ...
})
```

### Command Variants

- `""` or `"/autowork"` — full autowork loop with DONE/VERIFIED protocol
- `/autowork-team` is the preferred leader-side command for parallel user-facing execution; spawned workers still usually run `/autowork`
- `"none"` — one-shot (no continuation loop)
- Any other command string — that command is prepended to the assignment

### Worker Session Assignment

Every spawned session receives a structured prompt that includes:

```
/autowork  (or the specified command)

## Assignment

**Project:** <name> — `<path>`
**Session:** <session_id>

## Session Work

<the prompt you provided>

## Project Context

<contents of .kortix/CONTEXT.md>

## Other Active Sessions in This Project

<list of sibling sessions and their prompts>

## Rules

1. Working directory: `<project path>` — use workdir on bash commands.
2. Stay in your lane. Only modify files within your task scope.
3. TDD: Write tests FIRST. Implement to pass. Verify after every change.
4. Update `.kortix/CONTEXT.md` with discoveries and decisions.
5. Write docs to `.kortix/docs/` for shared context.
6. Include test results in your final message.
7. When done, emit <promise>DONE</promise> then <promise>VERIFIED</promise>.
```

Sibling session awareness prevents file conflicts when multiple workers run in parallel.

### Reporting Model

On completion or failure, the orchestrator:

1. Waits for 10 seconds of continuous idle (debounced — active autowork resets the timer)
2. Scans assistant messages for `<promise>DONE</promise>` and `<promise>VERIFIED</promise>`
3. Sets status: `complete` (VERIFIED), `failed` (DONE without VERIFIED or no DONE), or `failed` (timed out idle)
4. Persists result to `.kortix/sessions/<session_id_last_12_chars>.md` in the project
5. Sends `<session-report>` back to the parent session

**Session report format:**

```xml
<session-report>
<session-id>ses_abc123</session-id>
<status>COMPLETE</status>
<project>my-project</project>
<prompt>Implement X feature...</prompt>
<result>
Last assistant output (up to 3000 chars)
</result>
</session-report>
```

### Reading Session State

```text
session_read({ session_id: "ses_abc123", mode: "summary" })
session_read({ session_id: "ses_abc123", mode: "tools" })
session_read({ session_id: "ses_abc123", mode: "full" })
session_read({ session_id: "ses_abc123", mode: "search", pattern: "error|TypeError" })
```

Modes:
- `summary` (default) — status, stats, last 3 text outputs. Use this first.
- `tools` — every tool call with truncated I/O. See what the session did.
- `full` — complete transcript. Expensive.
- `search` — filter messages by regex. Find errors, specific output.

Works on any session ID, not just spawned ones.

### Scoping Rules

1. For new background work: pass `project`.
2. For resume: pass `session_id`.
3. `session_read` and `session_message` are always session-scoped.
4. Omitting `project` on `session_list_background` = cross-project orchestration view.

---

## Filesystem Persistence

| What to store | Where |
|---|---|
| Project context, conventions, architecture | `{project}/.kortix/CONTEXT.md` |
| Plans, handoff notes, decisions | Files in `{project}/.kortix/docs/` or `{project}/.kortix/plans/` |
| Conversation history | Session tools (`session_get`, `session_search`) |
| Worker session results | Auto-written to `{project}/.kortix/sessions/` on completion |

Rule of thumb:
- Future session needs exact content → write a file
- It's conversation history → use session tools
- It's project knowledge → `{project}/.kortix/CONTEXT.md`

---

## Orchestrator Database

The orchestrator stores state in SQLite:

```text
<workspace-root>/.kortix/kortix.db
```

Three tables:
- `projects` — id, name, path, description, created_at, opencode_id
- `delegations` — session_id, project_id, prompt, agent, parent_session_id, status, result, created_at, completed_at
- `session_projects` — session_id, project_id, set_at (session↔project link)

### Locate the databases

```bash
# OpenCode session DB
OC_DB=$(find ~ -name "opencode.db" -path "*/opencode/*" 2>/dev/null | head -1)

# Kortix orchestrator DB
KORTIX_DB=$(find ~ -name "kortix.db" -path "*/.kortix/*" 2>/dev/null | head -1)
```

### Common queries

```bash
# Recent delegations
sqlite3 "$KORTIX_DB" \
  "SELECT session_id, status, substr(prompt,1,80) FROM delegations ORDER BY created_at DESC LIMIT 10;"

# All projects
sqlite3 "$KORTIX_DB" \
  "SELECT name, path, description FROM projects;"

# Recent sessions
sqlite3 -readonly "$OC_DB" \
  "SELECT id, title FROM session ORDER BY time_updated DESC LIMIT 10;"

# Search sessions by content
sqlite3 -readonly "$OC_DB" \
  "SELECT s.id, s.title FROM message m JOIN session s ON s.id = m.session_id WHERE m.data LIKE '%auth%';"
```

---

## Decision Guide

```text
No project selected yet?
  → project_list → decide (existing or new?) → ask user if unclear → project_select

Need to create/manage projects?
  → project_create / project_list / project_get / project_update

Need to select a project for this session?
  → project_select

Need one specific session?
  → session_get

Need to browse likely sessions?
  → session_list

Need to search prior work by text?
  → session_search

Need to understand continuation chains?
  → session_lineage

Need substantial parallel work?
  → session_start_background (new: pass project; resume: pass session_id)

Need to check worker status?
  → session_list_background (project name = filter; "" = all)

Need to read worker output?
  → session_read (summary mode first; full only if needed)

Need to steer a running worker?
  → session_message

Need raw DB queries?
  → sqlite3 on kortix.db (orchestrator) or opencode.db (sessions)

Need semantic recall?
  → load lss skill
```
