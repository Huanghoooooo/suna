/**
 * Channel Webhook Handler — receives Telegram/Slack webhook events,
 * verifies them against the channel config in SQLite, parses them
 * into normalized events, and dispatches to OpenCode sessions.
 *
 * Mounted BEFORE the generic /hooks/* proxy to port 8099 so channel
 * webhooks are handled directly by kortix-master.
 */
import { Hono } from 'hono'
import { getChannelByPath, updateChannel, type ChannelConfig } from '../../channels/channel-db'
import {
  parseTelegramUpdate,
  parseSlackEvent,
  verifySlackSignature,
  type NormalizedChannelEvent,
} from '../../triggers/src/channel-webhooks'

const channelWebhooksRouter = new Hono()

const OPENCODE_URL = 'http://localhost:4096'

// ── Session reuse map — keyed by session_key from the normalized event ─────
const sessionMap = new Map<string, string>()
const sessionHistoryMap = new Map<string, string[]>()

function rememberSession(sessionKey: string, sessionId: string): void {
  const history = sessionHistoryMap.get(sessionKey) || []
  const next = [sessionId, ...history.filter(id => id !== sessionId)].slice(0, 10)
  sessionHistoryMap.set(sessionKey, next)
}

function clearSession(sessionKey: string): void {
  sessionMap.delete(sessionKey)
}

async function sendTelegramText(channel: ChannelConfig, chatId: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${channel.bot_token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(15_000),
  })
}

async function sendSlackText(channel: ChannelConfig, targetChannel: string, text: string, threadTs?: string): Promise<void> {
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${channel.bot_token}`,
    },
    body: JSON.stringify({ channel: targetChannel, text, ...(threadTs ? { thread_ts: threadTs } : {}) }),
    signal: AbortSignal.timeout(15_000),
  })
}

async function fetchAvailableModels(): Promise<string[]> {
  try {
    const res = await fetch('http://localhost:8000/kortix/preferences/models', {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const data = await res.json() as { models?: Array<{ id: string }> }
    return (data.models || []).map(m => m.id)
  } catch {
    return []
  }
}

type CommandOutcome = { handled: boolean; text?: string }

async function handleChannelCommand(
  channel: ChannelConfig,
  event: NormalizedChannelEvent,
): Promise<CommandOutcome> {
  const raw = (event.text || '').trim()
  if (!raw) return { handled: false }

  const isTelegram = channel.platform === 'telegram'
  const isCommand = isTelegram ? raw.startsWith('/') : raw.startsWith('!')
  if (!isCommand) return { handled: false }

  const commandText = isTelegram ? raw.slice(1) : raw.slice(1)
  const [rawName, ...rest] = commandText.split(/\s+/)
  const command = (rawName || '').replace(/@.+$/, '').toLowerCase()
  const arg = rest.join(' ').trim()

  const p = isTelegram ? '/' : '!'

  switch (command) {
    case 'new':
    case 'reset': {
      clearSession(event.session_key)
      return { handled: true, text: 'Session reset. Next message starts fresh.' }
    }

    case 'status':
    case 'info': {
      const currentSession = sessionMap.get(event.session_key) || null
      return {
        handled: true,
        text: [
          `${channel.name} (${channel.platform})`,
          `Bot: @${channel.bot_username || '?'}`,
          `Agent: ${channel.default_agent || 'kortix'}`,
          `Model: ${channel.default_model || '(default)'}`,
          `Session: ${currentSession || 'none'}`,
          `Enabled: ${channel.enabled ? 'yes' : 'no'}`,
          channel.instructions ? `Instructions: ${channel.instructions.slice(0, 100)}${channel.instructions.length > 100 ? '…' : ''}` : '',
        ].filter(Boolean).join('\n'),
      }
    }

    case 'agent': {
      if (!arg) {
        return { handled: true, text: `Current agent: ${channel.default_agent || 'kortix'}\nUsage: ${p}agent <name>` }
      }
      const updated = updateChannel(channel.id, { default_agent: arg })
      clearSession(event.session_key)
      return { handled: true, text: `Agent: ${updated?.default_agent || arg}\nSession reset.` }
    }

    case 'model': {
      if (!arg) {
        const models = await fetchAvailableModels()
        const lines = [`Current: ${channel.default_model || '(default)'}`]
        if (models.length > 0) {
          lines.push('', 'Available:')
          models.slice(0, 15).forEach(m => lines.push(`  ${m}`))
          if (models.length > 15) lines.push(`  … and ${models.length - 15} more`)
        }
        lines.push('', `Usage: ${p}model <provider/model>`)
        return { handled: true, text: lines.join('\n') }
      }
      const updated = updateChannel(channel.id, { default_model: arg })
      clearSession(event.session_key)
      return { handled: true, text: `Model: ${updated?.default_model || arg}\nSession reset.` }
    }

    case 'name': {
      if (!arg) {
        return { handled: true, text: `Current name: ${channel.name}\nUsage: ${p}name <new name>` }
      }
      const updated = updateChannel(channel.id, { name: arg })
      return { handled: true, text: `Channel renamed to: ${updated?.name || arg}` }
    }

    case 'instructions':
    case 'prompt': {
      if (!arg) {
        return {
          handled: true,
          text: channel.instructions
            ? `Current instructions:\n${channel.instructions}\n\nUsage: ${p}instructions <text> or ${p}instructions clear`
            : `No custom instructions set.\nUsage: ${p}instructions <text>`,
        }
      }
      if (arg === 'clear' || arg === 'reset' || arg === 'none') {
        updateChannel(channel.id, { instructions: '' as any })
        clearSession(event.session_key)
        return { handled: true, text: 'Instructions cleared. Session reset.' }
      }
      updateChannel(channel.id, { instructions: arg } as any)
      clearSession(event.session_key)
      return { handled: true, text: `Instructions updated. Session reset.` }
    }

    case 'enable': {
      updateChannel(channel.id, { enabled: true })
      return { handled: true, text: 'Channel enabled.' }
    }

    case 'disable': {
      updateChannel(channel.id, { enabled: false })
      return { handled: true, text: 'Channel disabled. Messages will be ignored until re-enabled.' }
    }

    case 'sessions': {
      const history = sessionHistoryMap.get(event.session_key) || []
      return {
        handled: true,
        text: history.length
          ? `Recent sessions:\n${history.map((id, i) => `${i + 1}. ${id}`).join('\n')}`
          : 'No sessions yet.',
      }
    }

    case 'session': {
      if (!arg) {
        const currentSession = sessionMap.get(event.session_key) || 'none'
        return { handled: true, text: `Current: ${currentSession}\nUsage: ${p}session <id>` }
      }
      const history = sessionHistoryMap.get(event.session_key) || []
      if (!history.includes(arg)) {
        return { handled: true, text: `Unknown session: ${arg}` }
      }
      sessionMap.set(event.session_key, arg)
      return { handled: true, text: `Switched to: ${arg}` }
    }

    case 'help': {
      return {
        handled: true,
        text: [
          'Commands:',
          `${p}status — Current config & session`,
          `${p}model <provider/model> — Set model`,
          `${p}agent <name> — Set agent`,
          `${p}name <name> — Rename this channel`,
          `${p}instructions <text> — Set system prompt`,
          `${p}instructions clear — Clear system prompt`,
          `${p}new — Start fresh session`,
          `${p}reset — Same as ${p}new`,
          `${p}sessions — List recent sessions`,
          `${p}session <id> — Switch session`,
          `${p}enable / ${p}disable — Toggle channel`,
          `${p}help — This message`,
        ].join('\n'),
      }
    }

    default:
      return { handled: false }
  }
}

// ── Dispatch to OpenCode ────────────────────────────────────────────────────

async function dispatchToOpenCode(
  channel: ChannelConfig,
  event: NormalizedChannelEvent,
): Promise<{ sessionId: string }> {
  const existingSessionId = sessionMap.get(event.session_key)

  // Parse "provider/model" into the format OpenCode expects
  const modelOverride = channel.default_model
    ? (() => {
        const parts = channel.default_model.split('/')
        return parts.length >= 2
          ? { providerID: parts[0], modelID: parts.slice(1).join('/') }
          : { providerID: 'kortix', modelID: channel.default_model }
      })()
    : undefined

  // Reuse existing session if available
  if (existingSessionId) {
    try {
      const res = await fetch(`${OPENCODE_URL}/session/${existingSessionId}/prompt_async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: [{ type: 'text', text: event.prompt }],
          agent: channel.default_agent || undefined,
          ...(modelOverride ? { model: modelOverride } : {}),
        }),
        signal: AbortSignal.timeout(30_000),
      })
      if (res.ok) {
        rememberSession(event.session_key, existingSessionId)
        return { sessionId: existingSessionId }
      }
      // Session might be gone — fall through to create new one
      sessionMap.delete(event.session_key)
    } catch {
      sessionMap.delete(event.session_key)
    }
  }

  // Create new session
  const createRes = await fetch(`${OPENCODE_URL}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent: channel.default_agent || 'kortix',
      ...(channel.instructions ? { systemPrompt: channel.instructions } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!createRes.ok) {
    throw new Error(`Failed to create OpenCode session: ${createRes.status}`)
  }
  const session = await createRes.json() as { id: string }

  // Send the prompt
  const promptRes = await fetch(`${OPENCODE_URL}/session/${session.id}/prompt_async`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parts: [{ type: 'text', text: event.prompt }],
      agent: channel.default_agent || 'kortix',
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!promptRes.ok) {
    throw new Error(`Failed to send prompt: ${promptRes.status}`)
  }

  // Cache session for reuse
  sessionMap.set(event.session_key, session.id)
  rememberSession(event.session_key, session.id)

  return { sessionId: session.id }
}

// ── Telegram webhook handler ────────────────────────────────────────────────

channelWebhooksRouter.post('/hooks/telegram/:channelId', async (c) => {
  const channelId = c.req.param('channelId')
  const webhookPath = `/hooks/telegram/${channelId}`

  // Look up channel
  let channel = getChannelByPath(webhookPath)
  if (!channel) {
    return c.json({ ok: false, error: 'not_found' }, 404)
  }

  // Verify Telegram secret token
  const secretHeader = c.req.header('x-telegram-bot-api-secret-token') || ''
  if (secretHeader !== channel.webhook_secret) {
    console.warn(`[Channel Webhook] Telegram secret mismatch for ${channel.name} (${channelId})`)
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  // Parse the update
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400)
  }

  const event = parseTelegramUpdate(body, channelId)
  if (!event) {
    return c.json({ ok: true, skipped: true })
  }

  // Handle commands BEFORE the enabled check — so /enable works on disabled channels
  const command = await handleChannelCommand(channel, event)
  if (command.handled) {
    if (command.text) await sendTelegramText(channel, event.chat_id, command.text)
    // Re-read channel in case the command changed it (e.g. /enable, /disable)
    channel = getChannelByPath(webhookPath)!
    return c.json({ ok: true, command: true })
  }

  // Non-command messages require the channel to be enabled
  if (!channel.enabled) {
    return c.json({ ok: false, error: 'channel_disabled' }, 403)
  }

  // Dispatch to OpenCode
  try {
    const result = await dispatchToOpenCode(channel, event)
    console.log(`[Channel Webhook] Telegram ${event.event_type} from @${event.username} → session ${result.sessionId}`)
    return c.json({ ok: true, sessionId: result.sessionId }, 202)
  } catch (err) {
    console.error(`[Channel Webhook] Telegram dispatch error:`, err)
    return c.json({ ok: false, error: 'dispatch_failed' }, 500)
  }
})

// ── Slack webhook handler ───────────────────────────────────────────────────

channelWebhooksRouter.post('/hooks/slack/:channelId', async (c) => {
  const channelId = c.req.param('channelId')
  const webhookPath = `/hooks/slack/${channelId}`

  // Look up channel
  let channel = getChannelByPath(webhookPath)
  if (!channel) {
    return c.json({ ok: false, error: 'not_found' }, 404)
  }

  // Read raw body and parse
  const rawBody = await c.req.text()
  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400)
  }

  // Handle Slack URL verification challenge — even for disabled/unconfigured channels
  const preParseResult = parseSlackEvent(body, channelId, channel.bot_id || '')
  if (preParseResult.is_challenge && preParseResult.challenge) {
    return c.json({ challenge: preParseResult.challenge })
  }

  if (!preParseResult.dispatch_event) {
    return c.json({ ok: true, skipped: true })
  }

  // Handle commands BEFORE enabled check — so !enable works on disabled channels
  const command = await handleChannelCommand(channel, preParseResult.dispatch_event)
  if (command.handled) {
    if (command.text) {
      await sendSlackText(channel, preParseResult.dispatch_event.chat_id, command.text, preParseResult.dispatch_event.thread_ts || preParseResult.dispatch_event.message_id)
    }
    channel = getChannelByPath(webhookPath)!
    return c.json({ ok: true, command: true })
  }

  // Non-command messages require the channel to be enabled
  if (!channel.enabled) {
    return c.json({ ok: false, error: 'channel_disabled' }, 403)
  }

  // Verify Slack signature if signing secret is configured
  if (channel.signing_secret) {
    const timestamp = c.req.header('x-slack-request-timestamp') || ''
    const signature = c.req.header('x-slack-signature') || ''
    if (!verifySlackSignature(rawBody, timestamp, signature, channel.signing_secret)) {
      console.warn(`[Channel Webhook] Slack signature mismatch for ${channel.name} (${channelId})`)
      return c.json({ ok: false, error: 'unauthorized' }, 401)
    }
  }

  // Dispatch to OpenCode
  try {
    const dispatch = await dispatchToOpenCode(channel, result.dispatch_event)
    console.log(`[Channel Webhook] Slack ${result.dispatch_event.event_type} from ${result.dispatch_event.username} → session ${dispatch.sessionId}`)
    return c.json({ ok: true, sessionId: dispatch.sessionId }, 202)
  } catch (err) {
    console.error(`[Channel Webhook] Slack dispatch error:`, err)
    return c.json({ ok: false, error: 'dispatch_failed' }, 500)
  }
})

export default channelWebhooksRouter
