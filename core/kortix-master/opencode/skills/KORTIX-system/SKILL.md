---
name: kortix-system
description: Canonical deep system reference for the Kortix runtime, covering roles, projects, tasks, memory, and subsystems.
---

# Kortix System

This skill is the **canonical deep system reference** for the Kortix runtime.

Purpose:
- keep the full historical system knowledge
- centralize the architecture in one place
- let `general.md`, `orchestrator.md`, and `worker.md` stay relatively small

Rule:
- role-specific persona/behavior belongs in the agent files
- deep system/runtime knowledge belongs here

What follows is the restored historical Kortix system reference, kept mostly verbatim so the system knowledge is not lost.

---

# Kortix System Reference

Kortix is a runtime with three main active roles: `general`, `orchestrator`, and `worker`.

- `general` = hands-on direct worker for regular sessions
- `orchestrator` = project CEO / context owner / planner
- `worker` = focused task-run executor

The system supports both regular session work and project-manager orchestration. The exact operating style for each role lives in the agent prompts.

---

## 1. IDENTITY & RUNTIME

Kortix operates inside a Docker sandbox with terminal, filesystem, browser, and network access. The runtime exposes projects, tasks, task runs, task events, sessions, connectors, triggers, PTY, and worktree surfaces.

Every session operates within:
- **A Project** — named, path-bound work context. Almost all tools are gated until one is selected.
- **A Session** — conversation thread with unique ID.
- **Tasks** — delegated work units. Each spawns a worker that runs autonomously.

The runtime injects `<project_status>` into every message. If it says `selected="false"`, select a project FIRST.

---

## 2. PROJECTS

Almost all tools are blocked until you select a project. Only `project_*`, `question`, and `show` work without one.

| Tool | What |
|---|---|
| `project_create(name, description, path)` | Register directory. Creates `.kortix/` scaffold. |
| `project_list()` | List all projects. |
| `project_get(name)` | Get details. |
| `project_update(project, name, description)` | Update metadata. |
| `project_delete(project)` | Remove from registry (keeps files). |
| `project_select(project)` | **Required.** Links session to project, unlocks tools. |

Each project has `.kortix/CONTEXT.md` — auto-injected into sessions. Update it with discoveries.

---

## 3. TASKS — DELEGATING WORK

Each task spawns a worker that runs autonomously in an autowork loop. Workers should report progress, blockers, evidence, verification, and final completion through structured task lifecycle tools. `task_deliver` is the authoritative completion path.

### Tools

| Tool | What |
|---|---|
| `task_create(title, description, verification_condition, autostart?, status?)` | Create + run a task. |
| `task_update(id, action, message?)` | `"start"` / `"approve"` / `"cancel"` / `"message"` |
| `task_list(status?)` | List tasks. |
| `task_get(id)` | Get task details + result. |
| `task_status(id)` | Get live task/run status after reconciliation. |

### How to Think About Tasks

**Think like you're assigning work to a human team.** The core principle is **single ownership with clear boundaries**.

**Conflict-based splitting:** Can two workers touch the same files or systems? If yes → one task. If no → separate tasks that can run in parallel.

**Prefer large, well-scoped tasks over many small ones.** A single task that says "build the entire auth system" is better than 5 tasks for login, signup, middleware, tokens, and password reset — because those all touch the same code and would conflict.

**Good task decomposition:**
- ✅ "Build the REST API + database layer" (one ownership domain)
- ✅ "Build the frontend dashboard" (separate ownership domain — can run parallel)
- ✅ "Write the SDK + documentation" (separate concern — can run parallel)
- ❌ "Build the login endpoint" + "Build the signup endpoint" + "Build the auth middleware" (all touch auth — will conflict)

### Writing Descriptions

The description is the worker's **entire context**. Write it like you're briefing a capable engineer who knows nothing about your conversation.

Include:
1. **What to build** — specific, concrete deliverables
2. **Where to work** — file paths, project structure
3. **What to read first** — "Read /workspace/project/.kortix/CONTEXT.md and /workspace/project/src/server.ts"
4. **Constraints** — "Use the existing Express app", "Don't modify the database schema"
5. **What NOT to do** — boundaries matter as much as scope

### Writing Verification Conditions

**The verification condition is a CONTRACT.** The autowork system forces the worker to actually execute it and show evidence before accepting completion. Don't write vague conditions.

**Bad (unverifiable):**
- "The API works"
- "Tests pass"
- "It's properly implemented"

**Good (deterministic, executable):**
- "Running `curl -X POST http://localhost:8080/users -d '{\"name\":\"test\"}' ` returns HTTP 201 with a JSON body containing an `id` field"
- "Running `go test ./...` passes with 0 failures. Running `curl http://localhost:8080/health` returns 200"
- "File `/workspace/project/src/auth/middleware.ts` exists, exports `authMiddleware` function, and `npm test -- --grep auth` passes"
- "Docker compose up succeeds, `docker compose ps` shows both services running, `curl localhost:8080/health` returns 200"

**The more specific and executable the verification, the better the worker performs.** If you can express it as a bash command that returns 0 on success, do that.

### Example

```
task_create(
  title: "Build the complete auth system",
  description: "Build JWT auth for the AgentVault API in /workspace/AgentVault.\n\nRead first:\n- /workspace/AgentVault/.kortix/CONTEXT.md\n- /workspace/AgentVault/internal/api/server.go\n\nImplement:\n1. Token hashing utilities in internal/auth/\n2. Bearer token middleware that parses Authorization header\n3. Token creation endpoint POST /auth/tokens\n4. Protected route middleware\n5. Integration tests\n\nConstraints:\n- Use existing Go module and chi router\n- Store tokens in Postgres via existing db package\n- Follow project conventions from CONTEXT.md",
  verification_condition: "go test ./... passes with 0 failures. curl -X POST localhost:8080/auth/tokens with valid credentials returns 201 with token. curl localhost:8080/agents with Bearer token returns 200. curl without token returns 401."
)
```

### Sending Follow-ups

Workers receive your messages mid-execution:

```
task_update(id: "task-xyz", action: "message", message: "Also add rate limiting — max 100 requests per minute per token")
```

### System Notes

- Prefer large, well-scoped tasks over fragmented conflicting decomposition.
- Task descriptions should contain the full worker context.
- Verification should be executable and concrete.
- Delivered tasks go to human review before completion.

---

## 4. FILESYSTEM AS SOURCE OF TRUTH

ALL intermediate artifacts, research, and handoff documents must be saved to the filesystem. Agents reference file paths — not inline content.

### Standard Locations

| Type | Path | Purpose |
|---|---|---|
| Research findings | `{project}/.kortix/research/{topic}.md` | Structured research output |
| Handoff briefs | `{project}/.kortix/handoffs/{task-description}.md` | Context documents for workers |
| Verification reports | `{project}/.kortix/verification/{task}.md` | QA verdicts and findings |
| Project context | `{project}/.kortix/CONTEXT.md` | Updated with key discoveries after each major task |

### How It Works

1. **You or workers WRITE results to files.** Research goes to `.kortix/research/topic.md`.
2. **You READ files to review.** Check output quality, decide next steps.
3. **Workers READ files for context.** Instead of pasting 3000 tokens into the prompt, tell the worker: "Read the research at `/workspace/project/.kortix/research/topic.md`"

### Why This Matters

- **NEVER paste large content blocks into worker prompts.** This causes triple-token duplication.
- Small context under ~200 tokens can be inline. Anything larger MUST be a file reference.
- If a session dies, all research is preserved on disk — nothing is lost.
- CONTEXT.md should be updated with key discoveries after every significant task.

---

## 5. COMMUNICATION

- Lead with action, not reasoning. Do things, then tell the user what you did.
- Before complex work, briefly tell the user your plan.
- After each major step, give a short update.
- Don't restate what the user said.
- Match tone to the user's expertise.
- Use absolute paths starting with `/workspace/`.

---

## 6. SESSIONS

| Tool | Purpose |
|---|---|
| `session_list()` | Browse recent sessions. |
| `session_search({ query })` | Full-text search. |
| `session_get({ session_id })` | Retrieve session. |
| `session_lineage({ session_id })` | Parent/child chains. |
| `session_stats({ session_id? })` | Token usage, cost, message counts, model. Defaults to current session. |

---

## 7. MEMORY

| File | Scope | Purpose |
|---|---|---|
| `.kortix/USER.md` | Global | User identity, preferences |
| `.kortix/MEMORY.md` | Global | Stack, accounts, tools |
| `{project}/.kortix/CONTEXT.md` | Per-project | Architecture, conventions, key discoveries |
| `{project}/.kortix/research/` | Per-project | Inter-agent research artifacts |
| `{project}/.kortix/handoffs/` | Per-project | Inter-agent handoff briefs |

Write memory as you go. Use `read`, `edit`, `write`.

**CONTEXT.md must be updated after every significant task** with key learnings, architectural decisions, and discoveries. This is the persistent project memory — if it's not in CONTEXT.md, it's lost between sessions.

### CONTEXT.md discipline

`CONTEXT.md` should be:
- minimal
- token-efficient
- high-signal
- shared by every worker on the project
- reference-heavy rather than bloated with full raw detail

Use it for the most important:
- mission / direction
- architecture / conventions
- current priorities
- key discoveries
- key decisions
- links to deeper docs, verification, research, handoffs, and task artifacts

Do **not** turn `CONTEXT.md` into a giant append-only dump. Summarize the important memory and point to deeper files where needed.

Use `project_context_sync` to refresh the generated task snapshot section while preserving the manual high-signal content you maintain above it.

---

## 8. CONNECTORS

Connectors track what external services are connected and how (OAuth, API key, CLI, custom).

**Important:** Connectors do **not** represent Telegram/Slack channels anymore.
Messaging channels live in the separate `channels` system and must be checked via `kchannel` or `/kortix/channels` — never via `connector_list`.

**Tools:**

| Tool | Purpose |
|---|---|
| `connector_list` | List connectors |
| `connector_get` | Get details |
| `connector_setup` | Create/update connector |
| `connector_remove` | Delete connector |

**CLI (via bash):**
```bash
kconnectors list [--filter <text>]     # List all connectors
kconnectors get <name>                 # Get connector details
kconnectors add <json>                 # Create/update (JSON array or single object)
kconnectors remove <name> [<name>...]  # Delete by name
```

Output is always JSON. Examples:
```bash
kconnectors list                           # All connectors
kconnectors list --filter api-key          # Filter by source
kconnectors get stripe                     # Get one
kconnectors add '{"name":"github","description":"kortix-ai org","source":"cli"}'
kconnectors remove github
```

**Pipedream CLI (via bash — OAuth integrations):**
```bash
kpipedream search [--query <text>]              # Search 2000+ Pipedream apps
kpipedream connect --app <slug>                 # Get OAuth connect URL
kpipedream list                                 # List connected integrations
kpipedream actions --app <slug> [--query <text>] # List available actions for an app
kpipedream run --app <slug> --action <key> [--props <json>]  # Run an action
kpipedream request --app <slug> --url <url> [--method GET]   # Proxy API request
kpipedream exec --app <slug> --code <code>      # Execute custom code with proxyFetch
```

---

## 9. TRIGGERS

The trigger system is a **unified scheduler + webhook dispatcher + action runner** built around four pieces:

1. **Config file** → `.kortix/triggers.yaml`
2. **Runtime state DB** → `.kortix/kortix.db` tables `triggers` + `trigger_executions`
3. **Runtime manager** → `TriggerManager`
4. **Execution surfaces** → cron jobs, webhook routes, and the `triggers` tool

### What is the actual source of truth?

- **`triggers.yaml` is the source of truth for trigger definitions/config**: what triggers exist, their source, action, prompt/command/http config, context extraction, etc.
- **`kortix.db` is the source of truth for runtime state**: `is_active`, `last_run_at`, `next_run_at`, `session_id`, `event_count`, and execution history.

That split is intentional:

- YAML is declarative and git-friendly.
- SQLite stores mutable runtime state that should not live in git.

### Boot sequence

The triggers plugin is loaded from `opencode/plugin/kortix-system/triggers.ts` with:

- `directory: resolveKortixWorkspaceRoot(import.meta.dir)`
- `webhookHost: "0.0.0.0"`
- `webhookPort: KORTIX_TRIGGER_WEBHOOK_PORT || 8099`
- `publicBaseUrl: SANDBOX_PUBLIC_URL || "http://localhost:8000"`

On startup, `TriggerManager.start()` does this:

1. Opens `.kortix/kortix.db`
2. Creates/migrates the `triggers` and `trigger_executions` tables
3. Runs one-time migration code from older trigger systems
4. Syncs `.kortix/triggers.yaml` into the DB
5. Rebuilds runtime state:
   - schedules active cron jobs
   - rebuilds active webhook routes
6. Starts the internal webhook server on port `8099`
7. Starts watching `.kortix/triggers.yaml` for changes

### How trigger creation works end-to-end

For agent-driven work, the intended control plane is the **`triggers` tool**.

If a user asks you to create, inspect, pause, resume, run, or sync triggers, start with the `triggers` tool — not bash, not `curl`, and not an invented CLI.

`triggers action=create ...` flows like this:

1. Tool call enters `triggers/src/plugin.ts`
2. Plugin calls `TriggerManager.createTrigger(...)`
3. `TriggerStore.create(...)` writes the trigger row to SQLite
4. For cron triggers, `next_run_at` is computed immediately
5. `TriggerYaml.writeThrough()` flushes current DB config back to `.kortix/triggers.yaml`
6. `TriggerManager.rebuildRuntime()` applies the new config live
   - new cron jobs are scheduled immediately
   - new webhook routes become active immediately

So the tool path is the cleanest path because it updates **DB + YAML + live runtime** in one flow.

### How to use trigger tools

If the user asks for trigger work, use the unified `triggers` tool with one of these patterns:

```text
triggers action=list
triggers action=create name="Daily Report" source_type=cron cron_expr="0 0 9 * * *" timezone="UTC" action_type=prompt prompt="Generate the daily report"
triggers action=create name="Deploy Hook" source_type=webhook path="/hooks/deploy" method="POST" secret="mysecret" action_type=command command="bash" args='["-c","./deploy.sh"]'
triggers action=get trigger_id="<id-or-name>"
triggers action=update trigger_id="<id>" prompt="Updated prompt"
triggers action=pause trigger_id="<id>"
triggers action=resume trigger_id="<id>"
triggers action=run trigger_id="<id>"
triggers action=executions trigger_id="<id>"
triggers action=delete trigger_id="<id>"
triggers action=sync
```

Rules:

- `get` accepts id or name.
- `run`, `pause`, `resume`, `update`, `delete`, and `executions` should use the real trigger **id**.
- Prefer `triggers` over alias tools.
- Do not use bash or `curl` when the goal is to manage triggers from the agent.

### Trigger shape

Each trigger has:

- a **source**: `cron` or `webhook`
- an **action**: `prompt`, `command`, or `http`
- optional **context extraction** rules
- optional **session reuse** behavior for prompt actions

#### Source types

- `source_type=cron`
  - required: `cron_expr`
  - optional: `timezone`
- `source_type=webhook`
  - required: `path`
  - optional: `method`, `secret`

#### Action types

- `action_type=prompt`
  - sends a rendered prompt into an OpenCode session
  - required: `prompt`
  - optional: `agent_name`, `model_id`, `session_mode`
- `action_type=command`
  - runs a shell command via `Bun.spawn`
  - required: `command`
  - optional: `args`, `workdir`, `env`, `timeout_ms`
- `action_type=http`
  - performs an outbound HTTP request
  - required: `url`
  - optional: `method`, `headers`, `body_template`, `timeout_ms`

### Cron execution flow

For each active cron trigger, `TriggerManager.scheduleCron()` creates a `Croner` job.

When the schedule fires:

1. Croner invokes the callback
2. `ActionDispatcher.dispatch(trigger.id, { type: "cron.tick", ... })` runs
3. A row is inserted into `trigger_executions` with `status=running`
4. Overlap is prevented: if the same trigger is already running, a `skipped` execution is recorded instead
5. The configured action executes
6. On success:
   - execution row is marked `completed`
   - `last_run_at` is updated
   - `next_run_at` is recomputed
   - `session_id` is persisted when the action created/reused a session
7. On failure:
   - execution row is marked `failed`
   - `error_message` is stored

### Webhook execution flow

There are **two HTTP layers** for webhooks:

1. **Kortix Master HTTP layer** on port `8000`
2. **Internal trigger webhook server** on port `8099`

External requests hit `/hooks/*` on the master server. The master server:

- skips normal auth for `/hooks/*`
- forwards the request to `http://localhost:8099{pathname}`
- forwards `x-kortix-trigger-secret` / `x-kortix-opencode-trigger-secret`

The internal webhook server then:

1. Matches `METHOD + PATH` against the active route map
2. Verifies the per-trigger secret header if configured
3. Reads request body + headers
4. Hands the payload to `TriggerManager.dispatchWebhook(...)`
5. `dispatchWebhook(...)` finds the matching trigger row
6. The payload is normalized into an event and sent to `ActionDispatcher.dispatch(...)`

So the external webhook URL is effectively:

`http://localhost:8000/hooks/...`

but the actual route matching and trigger dispatch happens on the internal `8099` server.

### Channel-specific webhook handling

`TriggerManager.dispatchWebhook()` has special preprocessing for:

- `/hooks/telegram/<configId>`
- `/hooks/slack/<configId>`

Those payloads are normalized before action dispatch. The system injects channel-specific fields like:

- `_channel_prompt`
- `_session_key`
- `_channel_platform`
- `_channel_user_id`
- `_channel_chat_id`

Slack challenge requests are short-circuited, and Slack event IDs are deduplicated for 5 minutes.

### Prompt action flow

Prompt actions render text from:

- the configured `prompt` template
- flattened top-level event data
- optional extracted values from `context.extract`
- optional raw event JSON inside `<trigger_event>...</trigger_event>`

Session handling works like this:

- `session_mode="new"` → always create a new session
- `session_mode="reuse"` → reuse prior session
- if `context.session_key` is set, the reuse key is dynamically rendered from event data, enabling patterns like “one persistent session per chat/user”

The final prompt is sent with `client.session.promptAsync(...)` to the selected agent/model.

### Command action flow

Command actions:

1. parse `command`, `args`, `workdir`, `env`, `timeout_ms`
2. run via `Bun.spawn(...)`
3. capture `stdout`, `stderr`, and exit code
4. truncate large output at 50k chars
5. store results on the execution row

### HTTP action flow

HTTP actions:

1. render request headers/body from event data
2. `fetch(url, ...)`
3. capture response status + body
4. truncate large bodies at 50k chars
5. store results on the execution row

### YAML sync behavior

`TriggerYaml` watches `.kortix/triggers.yaml` and reconciles it into SQLite.

Important behavior:

- If the file does not exist, an empty file is created
- YAML changes are debounced and synced
- There is also a 30-second periodic reconcile fallback
- Sync is **name-based**:
  - YAML entries are upserted by `name`
  - DB triggers missing from YAML are removed
- Config fields are overwritten from YAML
- Runtime fields are preserved in DB

### The actual interfaces you may see

There are two real interfaces in the codebase:

1. **Agent/tool interface** → the `triggers` tool in the OpenCode plugin
2. **HTTP API** → `/kortix/triggers` in `src/routes/triggers.ts`

Use the **tool** when you are acting as the agent and want immediate runtime changes.

### Important implementation notes

- Do **not** assume `curl http://localhost:8000/triggers` is the trigger API. The master HTTP API is mounted at **`/kortix/triggers`**, while webhook delivery is at **`/hooks/*`**.
- Do **not** invent a `ktriggers` CLI. The codebase defines a tool plugin and an HTTP router, not that CLI.
- Manual runs through the **tool** call the dispatcher immediately.
- The HTTP router currently operates more directly on `TriggerStore` + `TriggerYaml` than on `TriggerManager`, so it is not the cleanest mental model for runtime behavior.

### Current sharp edges in the implementation

Be aware of these real code-level nuances:

- `POST /kortix/triggers/:id/run` currently creates an execution row but does **not** dispatch the action itself.
- `POST /kortix/triggers/:id/pause` and `/resume` update DB state directly, but do not call `TriggerManager.rebuildRuntime()`, so live scheduling/route changes are not applied through the same direct path as the tool interface.
- The clean end-to-end path is therefore: **`triggers` tool → TriggerManager → Store/YAML → runtime rebuild → execution**.

### Minimal examples

```text
triggers action=list
triggers action=create name="Daily Report" source_type=cron cron_expr="0 0 9 * * *" action_type=prompt prompt="Generate the daily report" agent_name=general
triggers action=create name="Backup" source_type=cron cron_expr="0 0 2 * * *" action_type=command command="bash" args='["-c","./scripts/backup.sh"]'
triggers action=create name="Deploy Hook" source_type=webhook path="/hooks/deploy" action_type=prompt prompt="Handle deploy" secret=mysecret
triggers action=run trigger_id=xxx
triggers action=executions trigger_id=xxx
triggers action=sync
```

---

## 10. AGENT HARNESS

Agents are `.md` files with YAML frontmatter. Canonical roles: `general` (hands-on direct worker), `orchestrator` (project CEO / context owner), `worker` (task-run executor).

Skills loaded on demand: `skill("name")`. Commands: `/autowork`, `/autowork-plan`, `/autowork-cancel`, `/btw`, `/onboarding`.

Single plugin: `./plugin/kortix-system/kortix-system.ts`.

---

## 11. SERVICES

```bash
curl http://localhost:8000/kortix/services?all=true | jq     # List
curl -X POST http://localhost:8000/kortix/services/{id}/restart  # Restart
curl -X POST http://localhost:8000/kortix/services/system/reload -d '{"mode":"full"}'  # Full restart
```

---

## 12. ENVIRONMENT (Secrets Manager)

All secrets are stored encrypted and exposed via the s6 env directory. Tools pick up values instantly via `getEnv()` — **no restart needed** for normal set/delete operations.

**List all secrets:**
```bash
curl -s http://localhost:8000/env | jq
```
Returns: `{ "secrets": { "KEY": "value", ... } }`

**Get a single secret:**
```bash
curl -s http://localhost:8000/env/KEY | jq
```
Returns: `{ "KEY": "value" }` (value is `null` if key doesn't exist — no 404)

**Set a single secret:**
```bash
curl -s -X POST http://localhost:8000/env/KEY -d '{"value":"secret"}'
```
Returns: `{ "ok": true, "key": "KEY", "restarted": false }`
PUT is also accepted as an alias.

**Set multiple secrets (bulk):**
```bash
curl -s -X POST http://localhost:8000/env -d '{"keys":{"KEY1":"val1","KEY2":"val2"}}'
```
Returns: `{ "ok": true, "updated": 2, "restarted": false }`

**Delete a secret:**
```bash
curl -s -X DELETE http://localhost:8000/env/KEY
```
Returns: `{ "ok": true, "key": "KEY" }`

**Important notes:**
- Normal set/delete NEVER restart services — values are picked up live via s6 env dir
- The old `"restart": true` parameter does NOT exist — ignore any references to it
- Provider API keys (e.g. ANTHROPIC_API_KEY) are auto-synced to auth.json
- Core vars (KORTIX_TOKEN) are persisted to bootstrap for container restart survival

---

## 13. SHELL & PTY

Use bash for non-interactive. Use PTY (`pty_spawn/read/write/kill`) for interactive CLIs.

**Ports:** NEVER use common ports (3000, 8080, 5000, 4000, etc.) — they're always taken. Generate a random one: `shuf -i 10000-59999 -n 1`.

**URLs:** When showing a website or file to the user, ALWAYS use the static server URL: `http://localhost:3211/open?path=/workspace/project/file.html`. NEVER use `/kortix/share/` URLs — those are only for when the user explicitly asks for a publicly shareable link. The default preview is always localhost.

---

## 14. BROWSER & SEARCH

- `agent-browser` skill for web automation
- `agent-tunnel` skill for local machine
- `glob`/`grep` for codebase search
- `web_search`/`scrape_webpage` for web
- `context7` for library docs

---

## 15. PUBLIC URL SHARING

When you build a website, API, or any service on a port inside the sandbox, **never send `localhost` URLs to external users** (e.g. on Telegram/Slack). Instead, create a short-lived share link:

```bash
curl -s http://localhost:8000/kortix/share/3000
```

Returns:
```json
{
  "url": "https://8000--abc123.kortix.cloud/s/AbCdEf123.../",
  "port": 3000,
  "token": "AbCdEf123...",
  "expiresAt": "2026-04-04T01:00:00.000Z",
  "ttl": "1h"
}
```

Send the `url` to users — it's publicly accessible, no auth needed. It **expires after 1 hour** by default.

**Custom TTL:**
```bash
curl -s 'http://localhost:8000/kortix/share/3000?ttl=30m'   # 30 minutes
curl -s 'http://localhost:8000/kortix/share/3000?ttl=4h'    # 4 hours
curl -s 'http://localhost:8000/kortix/share/3000?ttl=1d'    # 1 day
```

- **Min TTL:** 5 minutes  |  **Max TTL:** 7 days  |  **Default:** 1 hour
- For TTL > 24 hours, consider deploying to a CDN or hosting platform instead.

**Manage shares:**
```bash
curl -s http://localhost:8000/kortix/share                            # list all active shares
curl -s -X DELETE http://localhost:8000/kortix/share/{token}          # revoke a share
```

 **Example workflow** (Telegram):
```bash
# 1. Build a website on port 3000
# 2. Get a share link (default 1h)
URL=$(curl -s http://localhost:8000/kortix/share/3000 | jq -r .url)
# 3. Send to user via channel CLI
ktelegram send --chat 123 --text "Here's your site (link valid for 1 hour): $URL"
```

**When to use `show` instead:** If the user is in the web UI (not Telegram/Slack), use `show(type='url', url=<share_url>)` to display the link inline.

---

## 16. CHANNELS (Telegram, Slack)

Channel CLIs let you manage and communicate via Telegram and Slack bots.

**Source of truth:** Channels are stored in the `channels` SQLite table and exposed via `kchannel` / `/kortix/channels`.
Do **not** use `connector_list` to answer channel questions. Old connector shadow rows may exist transiently during migration, but they are not authoritative.

**If a user asks whether they have channels configured:**
1. Check with `kchannel list` (bash) or `GET /kortix/channels`
2. Report Telegram/Slack channels only from that data
3. Do not infer channel state from connectors

**Management:**
```bash
kchannel list                          # List all connected channels
kchannel info <id>                     # Channel details
kchannel enable|disable <id>           # Toggle on/off
kchannel remove <id>                   # Delete channel
kchannel set <id> --agent X --model Y  # Update settings
```

**Telegram:**
```bash
ktelegram setup --token <BOT_TOKEN> --url <PUBLIC_URL> --created-by <name>  # Set up new bot
ktelegram send --config-id <CHANNEL_ID> --chat <id> --text "msg"              # Send message
ktelegram send --config-id <CHANNEL_ID> --chat <id> --text-file /tmp/msg.txt   # Send complex message
ktelegram send --config-id <CHANNEL_ID> --chat <id> --file /tmp/img.png        # Send file
ktelegram typing --config-id <CHANNEL_ID> --chat <id>                          # Typing indicator
ktelegram me --config-id <CHANNEL_ID>                                          # Bot info
```

**Slack:**
```bash
kslack setup --token <xoxb-TOKEN> --signing-secret <SECRET> --url <PUBLIC_URL>  # Set up new bot
kslack send --config-id <CHANNEL_ID> --channel <id> --text "msg" --thread <ts>   # Send in thread
kslack send --config-id <CHANNEL_ID> --channel <id> --text-file /tmp/msg.txt       # Send complex message
kslack send --config-id <CHANNEL_ID> --channel <id> --file /tmp/report.csv         # Send file
kslack history --config-id <CHANNEL_ID> --channel <id>                              # Read channel history
kslack channels --config-id <CHANNEL_ID>                                            # List channels
kslack users --config-id <CHANNEL_ID>                                               # List users
kslack react --config-id <CHANNEL_ID> --channel <id> --ts <ts> --emoji thumbsup    # Add reaction
kslack manifest --url <PUBLIC_URL>                                                  # Generate Slack app manifest
```

**Channel replies:** Telegram and Slack runtime instructions are provided inline in the inbound message prompt.

**Channel control commands:** `Telegram /...` and `Slack !...` control commands are handled by the channel bridge before messages reach the agent for these commands:
- new / reset
- status
- help
- sessions / session <id>
- agent <name>
- model <provider/model>

**API:** `GET /kortix/channels` returns all configured channels from SQLite.

---

## 17. TECHNICAL

Docker sandbox. `/workspace` persists. Ports: 8000 (Master), 4096 (OpenCode), 3211 (Static), 3456 (Channels), 9224 (Browser).

---

## 18. AUTOWORK & COMMANDS

| Command | What |
|---|---|
| `/autowork` | Autonomous loop until `<promise>VERIFIED</promise>`. |
| `/autowork-plan` | Planning only. |
| `/autowork-cancel` | Stop. |

---

## 19. DOMAIN SKILLS

Load with `skill("name")` — or tell workers to load them:

| Category | Skills |
|---|---|
| **Interaction** | `agent-browser`, `agent-tunnel`, `computer-use` |
| **Documents** | `pdf`, `docx`, `xlsx`, `presentations`, `pptx`, `media`, `remotion`, `elevenlabs`, `logo-creator`, `document-review`, `design-foundations`, `theme-factory` |
| **Research** | `deep-research`, `research-assistant`, `research-report`, `openalex-paper-search`, `paper-creator`, `hyper-fast-youtube-transcript`, `exploration`, `statistical-analysis`, `visualization`, `validation` |
| **Engineering** | `fastapi-sdk`, `sql-queries`, `website-building`, `webapp`, `replicate`, `coding-and-data`, `domain-research` |
| **Sales/Marketing** | `account-research`, `call-prep`, `draft-outreach`, `create-an-asset`, `competitive-analysis`, `competitive-intelligence`, `campaign-planning`, `content-creation`, `brand-voice`, `performance-analytics` |
| **Product** | `feature-spec`, `roadmap-management`, `metrics-tracking`, `stakeholder-comms`, `user-research-synthesis`, `daily-briefinging` |
| **Legal** | `legal-writer`, `contract-review`, `nda-triage`, `compliance`, `risk-assessment`, `canned-responses`, `meeting-briefinging` |
| **Support** | `ticket-triage`, `escalation`, `response-drafting`, `customer-research`, `knowledge-management` |
| **Finance** | `financial-statements`, `journal-entry-prep`, `reconciliation`, `close-management`, `audit-support`, `variance-analysis` |
