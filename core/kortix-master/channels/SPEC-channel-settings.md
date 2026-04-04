# Channel Settings & Setup — Spec

## Overview

Two ways to set up channels:
1. **Chat-based**: User says "set up Telegram" in any session → agent walks them through it
2. **Web UI**: Settings page with forms for credentials, default agent/model, etc.

Both write to the same underlying data store. Both create connectors + webhook triggers.

## Data Model: Channel Configs

Stored in `.kortix/channels.json` (or SQLite `channels` table in `kortix.db`).

```typescript
interface ChannelConfig {
  id: string                  // uuid
  platform: "telegram" | "slack"
  name: string                // "Kortix Atlas (by Marko)" — unique, auto-generated
  enabled: boolean
  
  // Credentials
  credentials: {
    bot_token: string         // Telegram: bot token / Slack: xoxb- token
    signing_secret?: string   // Slack only
  }
  
  // Bot info (resolved from API on setup)
  bot_info: {
    bot_id: string            // Telegram bot user ID / Slack bot user ID
    bot_username: string      // @MarkosTestBot12_bot / @kortix_dev_04
  }
  
  // Webhook
  webhook_path: string        // /hooks/telegram/<id> or /hooks/slack/<id>
  webhook_url?: string        // Full public URL (ngrok, domain, etc.)
  
  // Defaults
  default_agent: string       // "kortix"
  default_model: string       // "anthropic/claude-sonnet-4-20250514"
  instructions?: string       // Custom system prompt for this bot
  
  // Metadata
  created_by: string          // User who set it up
  created_at: string
  updated_at: string
}
```

## Settings — What's Configurable

### Per-Channel Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `name` | Display name for this bot | Auto: "Kortix {adjective} (by {user})" |
| `enabled` | Whether the bot is active | true |
| `default_agent` | Agent that handles messages | "kortix" |
| `default_model` | Model for the agent | "anthropic/claude-sonnet-4-20250514" |
| `instructions` | Custom system prompt injected into every message | none |
| `credentials.bot_token` | Platform bot token | required |
| `credentials.signing_secret` | Slack signing secret | required for Slack |

### Global Channel Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `public_url` | Base URL for webhooks | auto-detected (ngrok) |
| `default_agent` | Default agent for new channels | "kortix" |
| `default_model` | Default model for new channels | "anthropic/claude-sonnet-4-20250514" |
| `auto_transcribe` | Auto-transcribe voice/video messages | false |

## Setup Flow — Chat-Based

### Telegram

```
User: "Set up Telegram"
Agent: Setting up Telegram bot! 

1. Open @BotFather on Telegram
2. Send /newbot and follow the prompts
3. Copy the bot token and paste it here

User: 8626043116:AAH7VUoX98qbH...

Agent: ✓ Token verified — bot: @MarkosTestBot12_bot
       ✓ Channel created: "Kortix Spark (by Marko)"
       ✓ Webhook registered
       ✓ Connector registered
       
       Send a message to @MarkosTestBot12_bot to test!
```

What happens under the hood:
1. Agent calls `ktelegram me` with the token → verifies, gets bot info
2. Generates unique name (random adjective + "by {user}")
3. Saves to channels.json
4. Sets TELEGRAM_BOT_TOKEN in env
5. Calls `ktelegram set-webhook --url <public_url>/hooks/telegram/<id>`
6. Creates connector entry via `connector_setup`
7. Restarts the Telegram bridge to pick up new config

### Slack

```
User: "Set up Slack"
Agent: Setting up Slack bot!

I'll generate a manifest for you. What's your public URL?
(Or I can auto-detect if you have ngrok running)

User: Use ngrok

Agent: Got it — https://abc123.ngrok.app

Here's your Slack app manifest:
[writes to /tmp/slack-manifest.json]
[sends as --file attachment]

Steps:
1. Go to https://api.slack.com/apps
2. "Create New App" → "From a manifest" 
3. Select your workspace
4. Paste the manifest
5. Install to workspace
6. Copy Bot Token (xoxb-...) from "OAuth & Permissions"
7. Copy Signing Secret from "Basic Information"

Paste both here:

User: xoxb-123... and d71b4aaf...

Agent: ✓ Bot verified — @kortix_dev_04 in Kortix workspace
       ✓ Channel created: "Kortix Wave (by Marko)"
       ✓ Connector registered
       
       @mention the bot in any channel or DM it!
```

## Setup Flow — Web UI (API Routes)

### New API Routes on Kortix Master

```
GET    /kortix/channels                    — List all channel configs
GET    /kortix/channels/:id               — Get channel config
POST   /kortix/channels                    — Create channel config
PATCH  /kortix/channels/:id               — Update channel config
DELETE /kortix/channels/:id               — Delete channel config
POST   /kortix/channels/:id/enable        — Enable
POST   /kortix/channels/:id/disable       — Disable
POST   /kortix/channels/:id/test          — Test connectivity
GET    /kortix/channels/settings           — Global channel settings
PATCH  /kortix/channels/settings           — Update global settings
POST   /kortix/channels/detect-url         — Auto-detect public URL (ngrok)
POST   /kortix/channels/slack-manifest     — Generate Slack manifest for a URL
```

### Web UI Settings Page

```
Channels Settings
═══════════════════════════════

Global
──────
Public URL:     [https://abc123.ngrok.app  ] [Auto-detect]
Default Agent:  [kortix         ▾]
Default Model:  [anthropic/claude-sonnet-4-20250514 ▾]

Active Channels
───────────────
┌──────────────────────────────────────────────────────────┐
│ 📱 Kortix Spark (by Marko)          Telegram  ● Active  │
│    @MarkosTestBot12_bot                                  │
│    Agent: kortix | Model: claude-sonnet-4                │
│    [Edit] [Disable] [Delete]                             │
├──────────────────────────────────────────────────────────┤
│ 💬 Kortix Wave (by Marko)           Slack     ● Active  │
│    @kortix_dev_04 in Kortix workspace                    │
│    Agent: kortix | Model: claude-sonnet-4                │
│    [Edit] [Disable] [Delete]                             │
└──────────────────────────────────────────────────────────┘

[+ Add Telegram Bot]  [+ Add Slack Bot]
```

## Naming Convention

Auto-generated names: `Kortix {Adjective} (by {User})`

Adjective pool: Atlas, Spark, Wave, Pulse, Nova, Echo, Bolt, Flux, Apex, Edge, Core, Drift, Haze, Peak, Rift, Vibe, Zeal, Glow, Dash, Fuse

Example: "Kortix Pulse (by Marko)", "Kortix Nova (by Ino)"

## Connector Registration

Each channel auto-creates a connector entry:

```json
{
  "name": "telegram-kortix-spark",
  "description": "Telegram bot @MarkosTestBot12_bot — Kortix Spark (by Marko)",
  "source": "channel",
  "notes": "Channel ID: abc-123, Platform: telegram"
}
```

## Multi-Bot Support

Multiple bots per platform. Each has:
- Its own credentials (different bot tokens)
- Its own webhook path (`/hooks/telegram/<config_id>`)
- Its own default agent/model
- Its own session state

The bridges need to support multi-config: instead of reading one token from env, they read from the channels config and route to the right token per webhook path.

## Implementation Plan

### Phase 1: Channel config store + CLI setup
1. `channels.json` config store (read/write)
2. `ktelegram setup` interactive command
3. `kslack setup` interactive command  
4. Auto-register connectors on setup
5. Update bridge to read from channels config (multi-bot)

### Phase 2: API routes
6. `/kortix/channels` CRUD routes on master
7. Global settings endpoint

### Phase 3: Web UI
8. Settings page component
9. Telegram setup wizard (adapted from existing)
10. Slack setup wizard (adapted from existing)
