# Channels v2 — Spec

## Mental Model

The agent is a team member who has Telegram and Slack installed on their laptop. They can read messages, send messages, join channels, decide whether to respond or ignore. They are NOT a chatbot that echoes a session. They're a person with a chat app.

**Scope: Telegram + Slack only.** No Discord, no others. Each future platform follows the same pattern: a CLI + a webhook handler.

## Two Halves

### 1. Outbound: Platform CLIs

One CLI per platform. Thin wrapper around the raw API. The agent calls them via bash. JSON output always.

```
bun run telegram.ts <command> [args...]
bun run slack.ts <command> [args...]
```

#### telegram.ts

Auth: `TELEGRAM_BOT_TOKEN`

| Command | What it does | Telegram API |
|---------|-------------|--------------|
| `setup` | Interactive: paste token → verify → set webhook → create trigger → register connector | getMe, setWebhook |
| `send --chat <id> --text "..."` | Send a message | sendMessage |
| `send --chat <id> --text "..." --reply-to <msg_id>` | Reply to a specific message | sendMessage (reply_to_message_id) |
| `edit --chat <id> --message-id <id> --text "..."` | Edit a sent message | editMessageText |
| `delete --chat <id> --message-id <id>` | Delete a message | deleteMessage |
| `typing --chat <id>` | Send typing indicator (5 sec) | sendChatAction |
| `me` | Get bot info | getMe |
| `get-chat --chat <id>` | Get chat info (title, type, member count) | getChat |
| `set-webhook --url <url>` | Register webhook URL with Telegram | setWebhook |
| `delete-webhook` | Remove webhook | deleteWebhook |
| `webhook-info` | Get current webhook status | getWebhookInfo |
| `file --file-id <id> --out <path>` | Download a file the user sent | getFile |

No `history` command — the session IS the history (every inbound message lands in the agent's session, OpenCode stores it).

#### slack.ts

Auth: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`

| Command | What it does | Slack API |
|---------|-------------|-----------|
| `setup` | Interactive: detect URL → generate manifest → paste tokens → create trigger → register connector | auth.test |
| `send --channel <id> --text "..."` | Post a message | chat.postMessage |
| `send --channel <id> --text "..." --thread <ts>` | Reply in a thread | chat.postMessage (thread_ts) |
| `edit --channel <id> --ts <ts> --text "..."` | Edit a message | chat.update |
| `delete --channel <id> --ts <ts>` | Delete a message | chat.delete |
| `react --channel <id> --ts <ts> --emoji "check"` | Add a reaction | reactions.add |
| `history --channel <id> [--limit 20]` | Channel message history | conversations.history |
| `thread --channel <id> --ts <ts> [--limit 20]` | Thread replies | conversations.replies |
| `channels [--limit 100]` | List channels the bot is in | conversations.list |
| `join --channel <id or #name>` | Join a channel | conversations.join |
| `users [--limit 100]` | List workspace users | users.list |
| `user --id <id>` | Get user info | users.info |
| `me` | Bot identity | auth.test |
| `search --query "..."` | Search messages | search.messages |
| `upload --channel <id> --file <path> [--title "..."]` | Upload a file | files.uploadV2 |

#### CLI output format

Always JSON. Always exit 0 on success, 1 on failure.

```json
{"ok": true, "message_id": 42, "chat_id": "123456789"}
{"ok": false, "error": "TELEGRAM_BOT_TOKEN not set"}
```

#### Where CLIs live

```
kortix-master/channels/telegram.ts
kortix-master/channels/slack.ts
```

Keep the `channels/` dir, gut the old code, replace with these two files plus the webhook module. Agent finds them via known path (injected in system prompt or discoverable from config dir).

---

### 2. Inbound: Webhook Triggers

When a message arrives on Telegram/Slack, it hits a webhook → gets processed → dispatched to an agent session.

#### The channel-webhooks module

```
triggers/src/channel-webhooks.ts  (~200 lines)
```

This module registers platform-specific handlers on the existing webhook server (:8099), following the same pattern as `setPipedreamHandler`. Two handlers: Telegram + Slack.

**What it does for Telegram:**

```
POST /hooks/telegram/<channel_config_id>
  Body: Telegram Update JSON

1. Validate X-Telegram-Bot-Api-Secret-Token header
2. Parse update.message → extract chat_id, user_id, user_name, text, message_id
3. Handle special cases:
   - Edited messages (update.edited_message)
   - Reactions (update.message_reaction) 
   - Bot added/removed (update.my_chat_member)
   - Photos/docs (update.message.photo, update.message.document)
4. Compute session key: "telegram:<channel_config_id>:user:<user_id>"
5. Build prompt with full context
6. Dispatch to trigger system (promptAsync — fire and forget)
7. Respond 200 immediately
```

**What it does for Slack:**

```
POST /hooks/slack/<channel_config_id>
  Body: Slack Event JSON
  Headers: X-Slack-Signature, X-Slack-Request-Timestamp

1. If type === "url_verification" → respond {"challenge": ...} immediately (one-time setup)
2. Verify HMAC-SHA256 signature using SLACK_SIGNING_SECRET
3. Dedup: check event_id against LRU cache (~100 entries). If seen → respond 200, skip.
4. Parse event payload based on event type:
   - app_mention → someone @mentioned the bot
   - message.im → DM to the bot
   - message.channels / message.groups → message in a channel the bot is in
   - reaction_added → someone reacted to a message
   - reaction_removed → reaction removed
   - message_changed → message was edited
   - message_deleted → message was deleted
   - member_joined_channel → someone joined
   - file_shared → file uploaded
5. Strip bot mention from text: "<@U_BOT_ID> hey" → "hey"
6. Compute session key:
   - DM: "slack:<channel_config_id>:dm:<user_id>"
   - Channel thread: "slack:<channel_config_id>:thread:<channel>:<thread_ts>"
   - Channel top-level: "slack:<channel_config_id>:thread:<channel>:<event_ts>" (new thread)
7. Build prompt with full context (including event type so agent knows what happened)
8. Dispatch to trigger system
9. Respond 200 immediately
```

#### What the agent sees

**Telegram message:**
```
[Telegram · DM from Marko (@markokraemer)]
Message: "hey can you check the CI?"

Chat ID: 123456789 | Message ID: 42
Reply: bun run telegram.ts send --chat 123456789 --text "your reply"
```

**Slack @mention:**
```
[Slack · #engineering · @mention from marko]
Message: "can someone review PR #42?"
Channel: C0AG3PJLCHH | Thread: 1712160000.000100

Reply: bun run slack.ts send --channel C0AG3PJLCHH --thread 1712160000.000100 --text "your reply"
Thread history: bun run slack.ts thread --channel C0AG3PJLCHH --ts 1712160000.000100
```

**Slack reaction:**
```
[Slack · #engineering · reaction from marko]
Reaction: 👀 added to message "can someone review PR #42?"
Channel: C0AG3PJLCHH | Message TS: 1712160000.000100

(No response needed unless you want to act on this signal)
```

**Slack message edit:**
```
[Slack · #engineering · message edited by marko]
Old: "can someone review PR #42?"
New: "can someone review PR #42? it's urgent"
Channel: C0AG3PJLCHH | TS: 1712160000.000100
```

---

## Slack Event Types — Full Scope

Events we subscribe to in the Slack app manifest (bot_events):

| Event | When | Agent sees | Agent should |
|-------|------|-----------|--------------|
| `app_mention` | @mentioned in channel | Message text + channel + user | Respond (in thread) |
| `message.im` | DM to bot | Message text + user | Respond |
| `message.channels` | Message in public channel bot is in | Message text + channel + user | Decide (usually ignore unless relevant) |
| `message.groups` | Message in private channel bot is in | Message text + channel + user | Decide |
| `message.mpim` | Message in multi-party DM | Message text + channel + user | Decide |
| `reaction_added` | Someone reacted to any message | Emoji + message + user | Optional — might act on 👀 or ✅ |
| `reaction_removed` | Reaction removed | Emoji + message + user | Usually ignore |
| `message_changed` | Message edited (subtypes in event) | Old + new text | Optional — note the edit |
| `message_deleted` | Message deleted | Deleted message ref | Usually ignore |
| `member_joined_channel` | Someone joined a channel | User + channel | Optional — welcome message? |
| `file_shared` | File uploaded | File info + channel | Optional — process the file |

**Not subscribed (v2):** `channel_created`, `team_join`, `app_home_opened`, `link_shared`

OAuth scopes needed:
```
app_mentions:read, channels:history, channels:read, channels:join,
chat:write, chat:write.public, commands, files:read, files:write,
groups:history, groups:read, im:history, im:read, im:write,
mpim:history, mpim:read, reactions:read, reactions:write,
search:read, users:read
```

---

## Telegram Update Types — Full Scope

Telegram sends these in the webhook Update object:

| Field | When | Agent sees | Agent should |
|-------|------|-----------|--------------|
| `message` | New message | Text + user + chat | Respond |
| `edited_message` | Message edited | New text + user + chat | Note the edit |
| `message_reaction` | Reaction on a message | Emoji + user + message_id | Optional |
| `my_chat_member` | Bot added/removed from chat | Status change + chat | Note it, maybe greet |
| `callback_query` | Inline button clicked | Button data + user | Act on it |
| `message.photo` | Photo sent | File ID + caption | Process if relevant |
| `message.document` | Document sent | File ID + filename | Process if relevant |
| `message.voice` | Voice message | File ID + duration | Could transcribe |
| `message.sticker` | Sticker sent | Sticker emoji | Usually ignore |

---

## Session Strategy

### Telegram
- **DMs**: Session key = `telegram:<config_id>:user:<user_id>` → one persistent session per user
- **Groups**: Session key = `telegram:<config_id>:chat:<chat_id>` → one session per group
- **Reset**: User sends `/new` → agent sees it in prompt → creates new session

### Slack
- **DMs**: Session key = `slack:<config_id>:dm:<user_id>` → one persistent session per user
- **Channel @mention**: Session key = `slack:<config_id>:thread:<channel_id>:<thread_ts>` → one session per thread
  - First mention in channel (no existing thread) → agent replies in new thread → that thread's ts becomes the session key
  - Already in a thread → same session
- **Reset**: User sends `/new` or `!new` → agent sees it, creates new session

### Commands (recognized by agent in prompt, not platform-level)

Both platforms:
- `/new` or `!new` — start fresh session
- `/model <name>` — switch model
- `/agent <name>` — switch agent  
- `/status` — what's the agent doing
- `/help` — what can the agent do

These are NOT platform slash commands (except `/oc` on Slack which is a real slash command for convenience). They're just text that the agent recognizes and acts on.

---

## Multi-Bot Support

**Answer: Yes, multiple bots per platform.**

The `channel_configs` table in Postgres already supports this:
```sql
channel_configs (
  channel_config_id  uuid PK,
  account_id         uuid,
  sandbox_id         uuid,          -- which sandbox runs this bot
  channel_type       channel_type,  -- 'telegram' | 'slack'
  name               varchar,       -- "Support Bot" | "Dev Bot"
  enabled            boolean,
  platform_config    jsonb,         -- platform-specific settings
  instructions       text,          -- custom system prompt for this bot
  agent_name         varchar,       -- which agent handles messages
  metadata           jsonb,
)
```

Each channel config = one bot instance:
- Different token (stored as env var in the sandbox)
- Different webhook path: `/hooks/telegram/<channel_config_id>`, `/hooks/slack/<channel_config_id>`
- Different agent/model
- Different instructions (system prompt injected into every message)
- Can be enabled/disabled independently

**Example:**
| Config | Platform | Name | Agent | Webhook |
|--------|----------|------|-------|---------|
| `abc-123` | telegram | Support Bot | support-agent | `/hooks/telegram/abc-123` |
| `def-456` | telegram | Dev Bot | kortix | `/hooks/telegram/def-456` |
| `ghi-789` | slack | Engineering | kortix | `/hooks/slack/ghi-789` |

This means:
- `setup` in the CLI creates a channel_config entry (via API) AND sets up the webhook
- Multiple Telegram bots = multiple tokens = multiple env vars: `TELEGRAM_BOT_TOKEN_abc123`, `TELEGRAM_BOT_TOKEN_def456` (or stored in platform_config)
- The webhook handler reads the config_id from the URL path, looks up the corresponding token, and uses it

### Credential Storage

Option A: Env vars with config ID suffix → `TELEGRAM_BOT_TOKEN_{config_id}`
Option B: Store encrypted in `platform_config` jsonb column (already exists in the DB schema)
Option C: Single token per platform in env, multi-bot via platform_config

**Recommendation: Option B** — store tokens in `platform_config`. The env var approach (`TELEGRAM_BOT_TOKEN`) works for single-bot. For multi-bot, the config_id-specific token lives in `platform_config.bot_token`. The webhook handler reads it from the channel config, not from env.

The CLI `setup` command:
1. Creates channel_config via API (gets back config_id)
2. Stores token in platform_config
3. Also sets TELEGRAM_BOT_TOKEN env var as convenience (for single-bot use / CLI access)
4. Registers webhook URL: `<public_url>/hooks/telegram/<config_id>`

---

## Setup Flow

### CLI Setup (for devs)

```
$ bun run telegram.ts setup

Telegram Bot Setup
──────────────────
1. Open @BotFather on Telegram → /newbot → copy token

Paste bot token: 7123456789:AAF...

✓ Bot verified: @MyKortixBot
✓ Channel config created: "MyKortixBot" (abc-123)
✓ Token stored in platform config
✓ TELEGRAM_BOT_TOKEN set in env (convenience)
✓ Webhook registered: https://your-url/hooks/telegram/abc-123
✓ Trigger created: telegram-abc-123
✓ Connector registered: telegram-mykortixbot

Done! Send a message to @MyKortixBot — the agent will respond.
```

```
$ bun run slack.ts setup

Slack Bot Setup
───────────────
Detecting public URL... ✓ https://your-url

1. Go to https://api.slack.com/apps → "Create New App" → "From a manifest"
2. Select your workspace
3. Paste this manifest:

{manifest JSON with correct URLs}

(Copied to clipboard)

4. Install to workspace
5. Copy Bot Token (xoxb-...) from "OAuth & Permissions"
6. Copy Signing Secret from "Basic Information"

Bot Token (xoxb-...): xoxb-1234...
Signing Secret: abc...

✓ Bot verified: @kortix-agent
✓ Channel config created: "Kortix Agent" (ghi-789)  
✓ Tokens stored in platform config
✓ SLACK_BOT_TOKEN set in env
✓ Trigger created: slack-ghi-789
✓ Connector registered: slack-kortix-agent

Done! @mention the bot or DM it.
```

### Frontend Setup (for non-devs)

The existing frontend wizards (`telegram-setup-wizard.tsx`, `slack-setup-wizard.tsx`) stay. They already do:

1. **Telegram**: Paste token → verify → detect/set public URL → connect
2. **Slack**: Detect URL → generate manifest → paste tokens → connect

What changes:
- The frontend creates the channel_config via `/v1/channels` API (already works)
- Instead of starting the old channels service, it tells the sandbox to set up the webhook trigger
- The "connect" step now calls the CLI's `setup` command internally (or duplicates the logic via API)
- The channels list page stays as-is — it reads from the same `channel_configs` table

### API Contract (frontend → backend)

**Stays the same:**
- `GET /v1/channels` — list configs
- `POST /v1/channels` — create config
- `GET /v1/channels/:id` — get config
- `PATCH /v1/channels/:id` — update config  
- `DELETE /v1/channels/:id` — delete config
- `POST /v1/channels/:id/enable` — enable
- `POST /v1/channels/:id/disable` — disable
- `GET /v1/channels/slack-wizard/detect-url` — detect ngrok/public URL
- `POST /v1/channels/slack-wizard/generate-manifest` — generate Slack manifest

**New:**
- `POST /v1/channels/:id/connect` — activate: register webhook with platform + create trigger
- `POST /v1/channels/:id/disconnect` — deactivate: remove webhook + delete trigger

**Removed:**
- All the old `opencode-channels` service internal routes
- `/v1/channels/internal/sessions/:id` (session persistence was for the old streaming model)
- `/v1/channels/:id/link` / `/v1/channels/:id/unlink` (sandbox linking — now implicit)

---

## Trigger System Changes

### New: `session_key` in ContextConfig

```typescript
export interface ContextConfig {
  extract?: Record<string, string>
  include_raw?: boolean
  session_key?: string  // NEW — template for dynamic session reuse key
}
```

In `prompt-action.ts`:
```typescript
// Before:
const reuseKey = `trigger:${trigger.name}`

// After:
const reuseKey = contextConfig.session_key
  ? renderPrompt(contextConfig.session_key, { ...flatData, ...extracted })
  : `trigger:${trigger.name}`
```

In `trigger-yaml.ts` normalizer: pass `session_key` through.

**That's it. ~20 lines total across 3 files.**

---

## What Gets Deleted

### Sandbox side (kortix-master)

```
channels/src/           — ENTIRE directory (~3,300 lines)
  bot.ts               (1006 lines)
  service.ts           (238 lines)
  server.ts            (214 lines)
  opencode.ts          (649 lines)
  sessions.ts          (143 lines)
  telegram-api.ts      (463 lines) — salvage markdownToTelegramV2()
  channel-output.ts    (41 lines)
  cli.ts               (307 lines) — salvage send functions
  types.ts, index.ts   (67 lines)
  adapters/*           (218 lines)
  tests/*

channels/package.json, README.md
```

From `src/index.ts`:
- `/channels/*` proxy route
- Channel webhook auth bypass

From `s6-services/`:
- `opencode-channels` service definition

### Keep / Adapt

```
apps/api/src/channels/          — API routes (KEEP, adapt)
  index.ts                      — CRUD stays, add connect/disconnect
  slack-wizard.ts               — KEEP as-is

apps/web/src/components/channels/  — Frontend (KEEP, adapt)
  channels-page.tsx             — KEEP as-is
  channel-config-dialog.tsx     — KEEP as-is
  channel-detail-panel.tsx      — KEEP, remove streaming status indicators
  telegram-setup-wizard.tsx     — KEEP, adapt connect step
  slack-setup-wizard.tsx        — KEEP, adapt connect step

apps/web/src/hooks/channels/    — Frontend hooks (KEEP, adapt)
  use-channels.ts               — KEEP as-is
  use-telegram-wizard.ts        — KEEP, adapt connect mutation
  use-slack-wizard.ts           — KEEP as-is
  use-ngrok.ts                  — KEEP as-is

supabase/migrations/            — DB schema
  channel_tables.sql            — KEEP as-is (schema is fine)
```

## What Gets Created

| File | Lines (est) | Description |
|------|-------------|-------------|
| `channels/telegram.ts` | ~300 | Full Telegram Bot API CLI (setup + all commands) |
| `channels/slack.ts` | ~400 | Full Slack Web API CLI (setup + all commands) |
| `triggers/src/channel-webhooks.ts` | ~200 | Telegram + Slack webhook pre-processors |
| `triggers/src/types.ts` | +3 | Add `session_key` to ContextConfig |
| `triggers/src/actions/prompt-action.ts` | +5 | Dynamic session reuse key |
| `triggers/src/trigger-yaml.ts` | +1 | Pass `session_key` through |
| `apps/api/src/channels/index.ts` | +40 | Add connect/disconnect endpoints |
| `src/index.ts` (master) | -50 | Remove old proxy routes |

**Summary:**
- **Deleted**: ~3,300 lines (old channels service) + s6 service + port
- **Created**: ~950 lines (CLIs + webhook module + trigger changes + API additions)
- **Modified**: ~100 lines (trigger system, master index, API routes, frontend wizards)
- **Net**: ~2,250 lines removed
