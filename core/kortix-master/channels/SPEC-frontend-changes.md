# Frontend /channels — Changes Spec

## Current State (Legacy)

The frontend `/channels` page is entirely built on the old system:
- **Data source**: Postgres `channel_configs` table via `/v1/channels` API on kortix-api
- **Types**: `ChannelConfig` with `channelConfigId`, `sandboxId`, `channelType`, `platformConfig`
- **Setup wizards**: `telegram-setup-wizard.tsx`, `slack-setup-wizard.tsx` — multi-step UI flows that create Postgres records and push env vars to the sandbox
- **Management**: enable/disable/delete via Postgres CRUD

## New System (Channels v2)

- **Data source**: SQLite `channels` table in sandbox `.kortix/kortix.db` via `kchannel` CLI
- **Setup**: CLI-driven (`ktelegram setup`, `kslack setup`) — the agent can do it conversationally
- **Management**: `kchannel list/enable/disable/remove/set` CLI commands

## What Needs to Change

### Option A: Thin wrapper over CLI (Recommended)

The frontend `/channels` page becomes a thin UI that calls the sandbox CLI via the existing proxy. No new REST API needed.

**How it works:**
1. Frontend calls sandbox proxy: `POST /v1/p/{sandboxId}/8000/proxy/exec` (or similar) to run `kchannel list`
2. Parses JSON output
3. Displays channels with enable/disable/remove actions
4. Setup wizard calls `ktelegram setup --token X --url Y` and `kslack setup --token X --signing-secret Y`

Actually even simpler — the frontend just needs to read from the sandbox's master API. We add a thin route on kortix-master:

```
GET  /kortix/channels          → runs kchannel list, returns JSON
GET  /kortix/channels/:id      → runs kchannel info <id>
POST /kortix/channels/:id/enable  → runs kchannel enable <id>
POST /kortix/channels/:id/disable → runs kchannel disable <id>
DELETE /kortix/channels/:id    → runs kchannel remove <id>
PATCH /kortix/channels/:id     → runs kchannel set <id> --agent X --model Y
POST /kortix/channels/setup/telegram → runs ktelegram setup --token X --url Y --created-by Z
POST /kortix/channels/setup/slack    → runs kslack setup --token X --signing-secret Y --url Y
```

These are just thin wrappers calling the CLIs. The CLI is still the source of truth.

### Frontend Files to Update

| File | Change |
|------|--------|
| `hooks/channels/use-channels.ts` | Rewrite: call sandbox proxy `/kortix/channels` instead of `/v1/channels` |
| `components/channels/channels-page.tsx` | Adapt: new `ChannelConfig` type, remove sandbox linking |
| `components/channels/channel-config-dialog.tsx` | Simplify: just collect token + platform, call setup endpoint |
| `components/channels/telegram-setup-wizard.tsx` | Simplify: paste token → call `ktelegram setup` via API → done |
| `components/channels/slack-setup-wizard.tsx` | Simplify: generate manifest → paste tokens → call `kslack setup` → done |
| `components/channels/channel-detail-panel.tsx` | Adapt: show new fields (agent, model, webhook path, created_by) |
| `components/channels/channel-defaults.ts` | Remove or adapt |
| `hooks/channels/use-telegram-wizard.ts` | Simplify |
| `hooks/channels/use-slack-wizard.ts` | Simplify |
| `hooks/channels/use-ngrok.ts` | Replace with share URL detection |

### New ChannelConfig Type (Frontend)

```typescript
interface ChannelConfig {
  id: string
  platform: 'telegram' | 'slack'
  name: string           // "Kortix Bloom (by Marko)"
  enabled: boolean
  bot: string            // "@MarkosTestBot12_bot"
  agent: string          // "kortix"
  model: string          // "anthropic/claude-sonnet-4-20250514"
  webhook: string        // "/hooks/telegram/<id>"
  created: string        // "2026-04-04"
  created_by: string     // "Marko"
}
```

### What Gets Removed (Frontend)

- All references to `channelConfigId`, `sandboxId`, `channelType`, `platformConfig`
- The `sandbox` linking logic (channels are now per-sandbox, managed inside)
- The ngrok detection hook (replaced by share system)
- The complex multi-step wizards (replaced by simple token input + CLI call)

### What Gets Removed (API)

- `apps/api/src/channels/index.ts` — old Postgres CRUD routes
- `apps/api/src/channels/webhooks.ts` — old webhook forwarding to `opencode-channels`
- `apps/api/src/channels/slack-wizard.ts` — old Slack wizard API

### What Gets Added (Kortix Master)

```
src/routes/channels.ts (~100 lines)
```

Thin route that reads from SQLite and calls CLIs. No business logic — just JSON wrapper.

## Implementation Priority

1. Add `/kortix/channels` routes on master (thin CLI wrappers)
2. Update frontend hooks to call new endpoints
3. Simplify setup wizards (just token input)
4. Remove old API routes + Postgres schema references
5. Clean up frontend types
