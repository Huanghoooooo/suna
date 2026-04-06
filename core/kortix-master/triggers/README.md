# @kortix/triggers

Unified trigger system: cron schedules and webhooks with prompt, command, or HTTP actions.

```
.kortix/triggers.yaml → TriggerStore (DB) → CronScheduler / WebhookServer → ActionDispatcher → prompt | command | http
```

## Architecture

- **Config** lives in `.kortix/triggers.yaml` (git-versionable)
- **Runtime state** lives in `kortix.db` (is_active, last_run, executions)
- **API** at `/kortix/triggers/*` — full CRUD
- **Agent tool** `triggers` — unified CLI for all trigger management

## Source types

| Source | Description |
|---|---|
| `cron` | Time-based schedule (6-field cron expression) |
| `webhook` | Incoming HTTP request on port 8099 |

## Action types

| Action | Description |
|---|---|
| `prompt` | Send prompt to AI agent session |
| `command` | Run shell command (no LLM) |
| `http` | Outbound HTTP request |

## triggers.yaml example

```yaml
triggers:
  - name: "Daily Report"
    source:
      type: cron
      cron_expr: "0 0 9 * * *"
      timezone: UTC
    action:
      type: prompt
      prompt: "Generate the daily report"
      agent: kortix

  - name: "Nightly Backup"
    source:
      type: cron
      cron_expr: "0 0 2 * * *"
    action:
      type: command
      command: "bash"
      args: ["-c", "./scripts/backup.sh"]

  - name: "Deploy Hook"
    source:
      type: webhook
      path: "/hooks/deploy"
    action:
      type: http
      url: "https://hooks.slack.com/xxx"
      body_template: '{"text": "Deployed"}'
```

See `docs/TRIGGER-SYSTEM-REFACTOR-SPEC.md` for the full design specification.
