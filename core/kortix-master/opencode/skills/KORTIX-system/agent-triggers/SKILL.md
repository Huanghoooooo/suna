---
name: kortix-triggers
description: "Kortix unified trigger system: cron schedules, webhooks, with prompt/command/http actions. Config in triggers.yaml, runtime in DB. Full CRUD via API, CLI, and agent tool."
---

# Triggers — Unified Cron, Webhook, and Action System

Schedule cron jobs, receive webhooks, run commands, call HTTP endpoints, or send prompts to AI agents — all through one system.

---

## Overview

| Source (when) | Action (what) | Example |
|---|---|---|
| `cron` — time-based schedule | `prompt` — send to AI agent | "Every day at 9am, generate a report" |
| `webhook` — incoming HTTP | `command` — run shell command | "On deploy webhook, run ./deploy.sh" |
| | `http` — outbound HTTP call | "On alert, POST to Slack" |

Config lives in `.kortix/triggers.yaml` (git-versionable). Runtime state lives in `kortix.db`.

---

## triggers.yaml Format

```yaml
triggers:
  - name: "Daily Report"
    source:
      type: cron
      cron_expr: "0 0 9 * * *"
      timezone: "UTC"
    action:
      type: prompt
      prompt: "Generate the daily status report"
      agent: kortix
      session_mode: new

  - name: "Nightly Backup"
    source:
      type: cron
      cron_expr: "0 0 2 * * *"
    action:
      type: command
      command: "bash"
      args: ["-c", "/workspace/scripts/backup.sh"]

  - name: "Deploy Hook"
    source:
      type: webhook
      path: "/hooks/deploy"
      secret: "${DEPLOY_SECRET}"
    action:
      type: prompt
      prompt: "Deploy event: {{ data.body.repository }}"
    context:
      extract:
        repo: "data.body.repository"
      include_raw: true

  - name: "Slack Relay"
    source:
      type: webhook
      path: "/hooks/alert"
    action:
      type: http
      url: "https://hooks.slack.com/services/XXX"
      method: POST
      body_template: '{"text": "Alert: {{ data.body.message }}"}'
```

### Cron (6-field)

```
second minute hour day month weekday
0      */5    *    *   *     *        # Every 5 minutes
0      0      9    *   *     *        # Daily at 9am
0      0      8    *   *     1        # Mondays at 8am
```

---

## `triggers` Tool

One unified tool for all trigger management.

```
triggers action=list [source_type=cron|webhook] [is_active=true|false]
triggers action=create name="..." source_type=cron cron_expr="..." action_type=prompt prompt="..."
triggers action=create name="..." source_type=webhook path="/hooks/x" action_type=command command="bash" args='["-c","./run.sh"]'
triggers action=get trigger_id=xxx
triggers action=update trigger_id=xxx prompt="new prompt"
triggers action=delete trigger_id=xxx
triggers action=pause trigger_id=xxx
triggers action=resume trigger_id=xxx
triggers action=run trigger_id=xxx
triggers action=executions trigger_id=xxx
triggers action=sync
```

### Legacy aliases (still work)

| Old tool | Maps to |
|---|---|
| `cron_triggers action=list` | `triggers action=list source_type=cron` |
| `cron_triggers action=create ...` | `triggers action=create source_type=cron ...` |
| `event_triggers action=setup ...` | `triggers action=create source_type=webhook ...` (+ Pipedream deploy) |
| `agent_triggers` | `triggers action=list` |
| `sync_agent_triggers` | `triggers action=sync` |

---

## REST API

All endpoints on `http://localhost:8000/kortix/triggers`.

```bash
# ─── List ────────────────────────────────────────────────
curl -s http://localhost:8000/kortix/triggers | jq
curl -s 'http://localhost:8000/kortix/triggers?source_type=cron' | jq

# ─── Create cron + prompt ────────────────────────────────
curl -s -X POST http://localhost:8000/kortix/triggers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Daily Report",
    "source": {"type":"cron","cron_expr":"0 0 9 * * *","timezone":"UTC"},
    "action": {"type":"prompt","prompt":"Generate the report","agent":"kortix"}
  }' | jq

# ─── Create cron + command (no LLM) ─────────────────────
curl -s -X POST http://localhost:8000/kortix/triggers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Nightly Backup",
    "source": {"type":"cron","cron_expr":"0 0 2 * * *"},
    "action": {"type":"command","command":"bash","args":["-c","./scripts/backup.sh"]}
  }' | jq

# ─── Create webhook + http ───────────────────────────────
curl -s -X POST http://localhost:8000/kortix/triggers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Slack Alert",
    "source": {"type":"webhook","path":"/hooks/alert"},
    "action": {"type":"http","url":"https://hooks.slack.com/xxx","method":"POST","body_template":"{\"text\":\"alert\"}"}
  }' | jq

# ─── CRUD ────────────────────────────────────────────────
curl -s http://localhost:8000/kortix/triggers/ID | jq
curl -s -X PATCH http://localhost:8000/kortix/triggers/ID \
  -H 'Content-Type: application/json' \
  -d '{"action":{"prompt":"Updated prompt"}}' | jq
curl -s -X DELETE http://localhost:8000/kortix/triggers/ID | jq

# ─── Lifecycle ───────────────────────────────────────────
curl -s -X POST http://localhost:8000/kortix/triggers/ID/pause | jq
curl -s -X POST http://localhost:8000/kortix/triggers/ID/resume | jq
curl -s -X POST http://localhost:8000/kortix/triggers/ID/run | jq

# ─── Executions ──────────────────────────────────────────
curl -s http://localhost:8000/kortix/triggers/ID/executions | jq

# ─── Sync YAML → DB ─────────────────────────────────────
curl -s -X POST http://localhost:8000/kortix/triggers/sync | jq

# ─── Fire a webhook ─────────────────────────────────────
curl -s -X POST http://localhost:8000/hooks/deploy \
  -H 'Content-Type: application/json' \
  -H 'X-Kortix-Trigger-Secret: mysecret' \
  -d '{"repo":"kortix-ai/suna"}'
```

---

## Webhook External Access

Webhooks are accessible externally through the Kortix Master proxy:

```
External caller  →  Kortix API (cloud)  →  Sandbox Proxy  →  Kortix Master (:8000)  →  /hooks/*  →  Trigger Webhook Server (:8099)
```

**Full external URL format:**
```
https://<sandbox-public-url>/hooks/<your-path>
```

For cloud sandboxes, the sandbox public URL is typically:
```
https://<platform-url>/p/<sandbox-external-id>/8000
```

**Auth**: Webhook paths (`/hooks/*`) skip the Kortix Master auth middleware. Per-trigger authentication is done via the `X-Kortix-Trigger-Secret` header. If a trigger has a `secret` configured, callers MUST include this header.

**Example — fire a webhook from outside:**
```bash
# Without secret
curl -X POST "https://<sandbox-url>/hooks/deploy" \
  -H "Content-Type: application/json" \
  -d '{"repo": "kortix-ai/suna", "branch": "main"}'

# With secret
curl -X POST "https://<sandbox-url>/hooks/deploy" \
  -H "Content-Type: application/json" \
  -H "X-Kortix-Trigger-Secret: my-secret-value" \
  -d '{"repo": "kortix-ai/suna", "branch": "main"}'
```

**From inside the sandbox** (e.g. from a script or another trigger), you can hit Kortix Master directly:
```bash
curl -X POST "http://localhost:8000/hooks/deploy" \
  -H "Content-Type: application/json" \
  -d '{"event": "test"}'
```

---

## Architecture

```
triggers.yaml (git)  ←→  kortix.db:triggers (runtime)  ←→  REST API  ←→  Frontend
                                    ↓
                          ActionDispatcher
                      ┌───────┼───────┐
                   prompt  command   http
```

- **Config** (what triggers exist) lives in `.kortix/triggers.yaml` — git-versionable
- **Runtime state** (is_active, last_run, executions) lives in `kortix.db` — not git-tracked
- UI creates/edits write to **both** YAML + DB
- File changes detected by watcher → synced to DB
- Cron scheduling via `croner` library
- Webhook server on port `8099` (internal), proxied through Kortix Master on `:8000/hooks/*` (external)

---

## Action Types

### prompt
Sends a prompt to an OpenCode agent session. Supports `{{ var }}` templates for webhook payloads.

### command
Runs a shell command via `Bun.spawn`. Captures stdout, stderr, and exit code. No LLM involved.

### http
Makes an outbound HTTP request. Captures response status and body. Supports `{{ var }}` templates in body_template and headers.

---

## Pipedream Events

Pipedream events are modeled as webhook triggers with extra metadata. Use `event_triggers action=setup` or the unified `triggers` tool to create them. Pipedream watches the external app and POSTs events to the webhook path.

```
triggers action=create name="New PR" source_type=webhook path="/events/pipedream/github-pr" action_type=prompt prompt="Review new PR"
```

Or via the `event_triggers` tool for the full Pipedream deploy flow:

```
event_triggers action=list_available app=github
event_triggers action=setup name="New PR" app=github component_key=github-new-pull-request prompt="Review this PR"
```
