---
name: kortix-agent-harness
description: "Agent harness engineering reference for OpenCode and Kortix: knowledge, permissions, capabilities, identity, triggers, and composition patterns."
---

# Agent Harness Engineering

Build, configure, and wire up OpenCode/Kortix agents. Covers the complete harness: agent identity (system prompt), control surface (permissions, tools, mode), activation layer (cron/webhook triggers), and composition (skills, commands, plugins).

---

## What is a Harness?

**Agent = Model + Harness.**

A **harness** is every piece of code, configuration, and execution logic that isn't the model itself. A raw model is not an agent. It becomes one when a harness gives it identity, tools, state, feedback loops, and enforceable constraints.

| Layer | What it provides | Examples |
|---|---|---|
| **Framework** | Abstractions + integrations (tool calling, prompting, model connectors) | LangChain, Vercel AI SDK, OpenAI Agents SDK |
| **Runtime** | Durable execution, streaming, persistence, human-in-the-loop | LangGraph, Temporal, Inngest |
| **Harness** | Complete opinionated wrapper — identity + tools + constraints + activation + knowledge | OpenCode, Deep Agents SDK, Claude Agent SDK |

---

## The Five Layers

```
┌──────────────────────────────────────────────────┐
│  5. ACTIVATION                                    │
│     What wakes the agent up                       │
│     user prompt · cron · webhook · pipedream      │
├──────────────────────────────────────────────────┤
│  4. IDENTITY                                      │
│     Who the agent is                              │
│     system prompt · name · description · mode     │
├──────────────────────────────────────────────────┤
│  3. CAPABILITY                                    │
│     What the agent can do                         │
│     tools · MCP servers · custom tools · plugins  │
├──────────────────────────────────────────────────┤
│  2. PERMISSION                                    │
│     What the agent is allowed to do               │
│     tool grants · bash globs · guardrails · steps │
├──────────────────────────────────────────────────┤
│  1. KNOWLEDGE                                     │
│     What the agent knows how to do                │
│     skills · commands · AGENTS.md · rules files   │
└──────────────────────────────────────────────────┘
```

---

## Layer 1: Knowledge

### AGENTS.md — project rules

`AGENTS.md` in the project root gives all agents project-specific rules. Injected into context on every session start.

### Skills — on-demand expertise

`SKILL.md` files loaded when the agent needs domain knowledge. Progressive disclosure — inject knowledge only when needed.

Locations: `.opencode/skills/<name>/SKILL.md` or `~/.config/opencode/skills/<name>/SKILL.md`

### Commands — user-initiated workflows

`/slash`-triggered prompt templates routed to a specific agent:

```markdown
<!-- commands/deploy.md -->
---
description: "Deploy the application"
agent: deploy-agent
---

Deploy with these parameters: $ARGUMENTS
```

---

## Layer 2: Permission

### Tool permissions

```yaml
permission:
  bash: allow        # allow | deny | ask
  edit: allow
  write: allow
  read: allow
  task: allow        # Can spawn subagents
  skill: allow       # Can load skills
  web_search: allow
  todowrite: allow
```

### Granular bash control

```yaml
permission:
  bash:
    "*": ask               # Ask for everything by default
    "git status*": allow
    "git push*": deny
    "rm -rf*": deny
    "grep *": allow
```

### Permission archetypes

```yaml
# Read-only analyst
permission:
  bash: deny
  edit: deny
  write: deny
  read: allow
  web_search: allow

# Code generator — writes but can't execute
permission:
  bash: deny
  read: allow
  edit: allow
  write: allow

# Full autonomy
permission:
  bash: allow
  read: allow
  edit: allow
  write: allow
  task: allow
  skill: allow
```

### Steps limit

```yaml
steps: 10   # Force agent to summarize and stop after N tool calls
```

### Built-in safety

- `.env` file reads denied by default
- External directory writes trigger warnings
- Doom-loop detection stops infinite tool-call cycles

---

## Layer 3: Capability

### Built-in tools

| Tool | What it does |
|---|---|
| `bash` | Execute shell commands |
| `read` | Read files |
| `edit` | Edit files (string replacement) |
| `write` | Create/overwrite files |
| `glob` | File pattern matching |
| `grep` | Content search |
| `task` | Spawn subagent sessions |
| `skill` | Load skills on demand |
| `todowrite` | Track tasks and progress |
| `question` | Ask user questions |

### Custom tools

TypeScript files in `tools/*.ts`:

```typescript
import { Tool } from "opencode/tool"
import z from "zod"

export default Tool.define("my-tool", async (ctx) => {
  return {
    description: "What this tool does",
    parameters: z.object({
      input: z.string().describe("Input parameter"),
    }),
    async execute(params, ctx) {
      return { title: "Result", output: "Output text" }
    },
  }
})
```

### MCP servers

```jsonc
// opencode.jsonc
{
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp",
      "enabled": true
    }
  }
}
```

### Tool name priority

When names collide: **Plugin > Custom > MCP > Built-in**

### Controlling tools per agent

```yaml
tools:
  bash: false       # Disable bash for this agent
  skill: false
  mymcp_*: false    # Wildcard: disable all tools from an MCP server
```

---

## Layer 4: Identity

### Agent file format

An agent is a `.md` file with YAML frontmatter. Filename = agent name.

**Locations:**
- Project: `.opencode/agents/<name>.md`
- Global: `~/.config/opencode/agents/<name>.md`

### Full frontmatter reference

```yaml
---
description: "Required. Shown in UI and Task tool."
mode: primary          # primary | subagent | all
model: anthropic/claude-sonnet-4-6  # optional override
temperature: 0.3       # 0.0–1.0
steps: 20              # max tool iterations
hidden: false          # hide from @ autocomplete
color: "#ff6b6b"       # UI color
permission:
  bash: allow
  edit: allow
triggers:              # see Layer 5
  - name: "My Trigger"
    ...
---

# Agent Name

System prompt body — this entire markdown becomes the system prompt.
```

### Modes

| Mode | User-selectable | Task tool | Use case |
|---|---|---|---|
| `primary` | Yes (Tab) | Hidden, but self-spawnable by name | Main agent |
| `subagent` | No (@ mention) | Listed and spawnable | Specialist |
| `all` | Yes | Yes | Available everywhere |

**Self-spawning:** A `primary` agent can spawn itself via `subagent_type: "agent-name"` — `Agent.get()` has no mode guard.

### The description field is load-bearing

For subagents, `description` is the API contract — it's what the orchestrator reads to decide whether to invoke.

Bad: `"Helper agent"`
Good: `"Reviews code for security vulnerabilities. Use for PR reviews and audits. Do NOT use for writing new code."`

---

## Layer 5: Activation

What wakes the agent up. Load `kortix-triggers` for the full trigger reference.

Triggers are defined in `.kortix/triggers.yaml` (git-versionable). Runtime state lives in `kortix.db`.

### Cron + Prompt

```yaml
# .kortix/triggers.yaml
triggers:
  - name: "Daily Standup"
    source:
      type: cron
      cron_expr: "0 0 9 * * 1-5"
      timezone: "America/New_York"
    action:
      type: prompt
      prompt: "Generate a daily standup summary."
      agent: kortix
      session_mode: new
```

### Webhook + Command

```yaml
  - name: "Deploy Hook"
    source:
      type: webhook
      path: "/hooks/deploy"
      secret: "your-secret"
    action:
      type: command
      command: "bash"
      args: ["-c", "./scripts/deploy.sh"]
```

### Webhook + HTTP relay

```yaml
  - name: "Slack Alert"
    source:
      type: webhook
      path: "/hooks/alert"
    action:
      type: http
      url: "https://hooks.slack.com/services/XXX"
      method: POST
      body_template: '{"text": "Alert: {{ data.body.message }}"}'
```

---

## Composition Patterns

### Pattern 1: Single autonomous agent

One agent, full permissions. Simplest harness.

### Pattern 2: Orchestrator + specialists

Primary delegates to focused subagents with least-privilege permissions.

```
Primary (user-facing, full access)
    ├── @code-reviewer (read-only)
    ├── @test-runner (bash + read, no writes)
    └── @docs-writer (write + read, no bash)
```

### Pattern 3: Scheduled worker

Agent that runs on a timer without human interaction.

### Pattern 4: Event-driven pipeline

Multiple triggers, different events, different prompts.

### Pattern 5: Self-spawning primary

Primary clones itself via Task tool with `subagent_type: "agent-name"` for parallel work.

---

## Design Principles

1. **Start minimal, add capability.** Tightest permissions that work.
2. **Name for role, not mechanism.** `code-reviewer` not `file-reader`.
3. **Permission = trust boundary.** Every `allow` is a surface for mistakes.
4. **Triggers are contracts.** A cron fires whether you're watching or not.
5. **Session mode is a design choice.** `new` = stateless. `reuse` = contextual but risks context rot.
6. **Test before you trust.** Run triggers manually first.
7. **Description is the API.** Precise about when to call and when NOT to.
8. **The model is the least important choice.** Get the harness right first.
9. **Separate concerns.** Focused specialists, orchestrated by a primary.
10. **Observe before you automate.** Understand failure modes before wiring to triggers.

---

## Quick Reference

### Minimum viable agent

```markdown
---
description: "What it does and when to use it"
mode: subagent
permission:
  read: allow
  write: allow
---

# Agent Name

You are [role]. [Core behavior in 2-3 sentences.]

Given a task:
1. [Step]
2. [Step]

Output: [what to produce]
```

### Minimum viable cron trigger

```yaml
triggers:
  - name: "My Trigger"
    enabled: true
    source:
      type: "cron"
      expr: "0 0 9 * * 1-5"
    execution:
      prompt: "Do this thing every weekday morning."
      session_mode: "new"
```

### Minimum viable webhook trigger

```yaml
triggers:
  - name: "My Webhook"
    enabled: true
    source:
      type: "webhook"
      path: "/hooks/my-event"
      secret: "{env:WEBHOOK_SECRET}"
    execution:
      prompt: "Handle the incoming event."
      session_mode: "new"
```
