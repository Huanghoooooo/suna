# kortix-opencode

Kortix OpenCode config directory — agents, tools, skills, commands, and plugins.

This directory lives inside `core/kortix-master/opencode/` and is the OpenCode config dir. In the container it's at `/ephemeral/kortix-master/opencode/` (set via `OPENCODE_CONFIG_DIR`).

## Structure

```
opencode.jsonc          <- OpenCode config (plugins, model, MCP servers)
package.json            <- minimal (deps managed by parent kortix-master/package.json)
agents/kortix.md        <- the Kortix agent (natively discovered by OpenCode)
commands/*.md           <- slash commands (natively discovered)
tools/*.ts              <- custom tools (natively discovered)
skills/                 <- built-in skills (natively discovered)
plugin/                 <- plugins loaded individually via opencode.jsonc
  kortix-orchestrator/  <- project + session management (SQLite)
  kortix-sessions/      <- session list/get/search tools
  kortix-autowork/      <- autowork execution loop (DONE/VERIFIED protocol)
  kortix-todo-enforcing/ <- passive todo continuation (nudges on idle)
  opencode-pty/         <- PTY spawn/read/write tools
  worktree/             <- git worktree plugin
  connectors/           <- connector CRUD tools
  btw/                  <- /btw quick question command
  agent-triggers.ts     <- cron/webhook trigger plugin
  anthropic-auth.ts     <- auth token plugin
  pty-tools.ts          <- PTY tool shim
  static-file-server.ts <- HTML file serving (port 3211)
patches/                <- post-install patches for opencode binary + deps
```

## Local development

Symlink to `.opencode` in your project root:

```bash
ln -s computer/core/kortix-master/opencode .opencode
```

## Sandbox

```bash
# Build and run
pnpm dev:sandbox:build

# Run without rebuilding (uses bind-mounts for live code changes)
pnpm dev:sandbox
```
