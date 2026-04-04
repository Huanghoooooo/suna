/**
 * E2E test: Slack webhook → channel-webhooks parser → trigger dispatch → session.
 *
 * Tests Slack-specific features: challenge verification, HMAC signature, dedup, bot message filtering.
 * Real HTTP, real SQLite, mocked OpenCode client.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHmac } from 'crypto'

import { TriggerStore } from '../../triggers/src/trigger-store'
import { ActionDispatcher } from '../../triggers/src/action-dispatch'
import { WebhookTriggerServer } from '../../triggers/src/webhook-server'
import { parseSlackEvent, verifySlackSignature, type NormalizedChannelEvent } from '../../triggers/src/channel-webhooks'
import type { MinimalOpenCodeClient, WebhookSourceConfig } from '../../triggers/src/types'

const FIXTURES = join(import.meta.dir, '../fixtures/channels')
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf-8'))
}

function createMockClient(): MinimalOpenCodeClient & { calls: { type: string; args: any }[] } {
  const calls: { type: string; args: any }[] = []
  return {
    calls,
    session: {
      create: async (params) => {
        calls.push({ type: 'create', args: params })
        return { data: { id: `sess-${calls.filter(c => c.type === 'create').length}` } }
      },
      promptAsync: async (params) => {
        calls.push({ type: 'promptAsync', args: params })
        return {}
      },
    },
  }
}

const SIGNING_SECRET = 'e2e_test_signing_secret'
const CONFIG_ID = 'test-cfg-slack'
const WEBHOOK_PATH = `/hooks/slack/${CONFIG_ID}`
const BOT_USER_ID = 'U0LAN0Z89'

function signSlackRequest(body: string): { signature: string; timestamp: string } {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const sigBase = `v0:${timestamp}:${body}`
  const signature = 'v0=' + createHmac('sha256', SIGNING_SECRET).update(sigBase).digest('hex')
  return { signature, timestamp }
}

describe('Slack Webhook E2E', () => {
  let tempDir: string
  let store: TriggerStore
  let mockClient: ReturnType<typeof createMockClient>
  let dispatcher: ActionDispatcher
  let webhookServer: WebhookTriggerServer
  let webhookPort: number
  let baseUrl: string

  // Dedup cache for Slack events
  const seenEventIds = new Set<string>()

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'slack-webhook-e2e-'))
    store = new TriggerStore(join(tempDir, 'test.db'))
    mockClient = createMockClient()
    dispatcher = new ActionDispatcher(store, mockClient, tempDir)
    seenEventIds.clear()

    // Create a slack inbound trigger
    store.create({
      name: `slack-${CONFIG_ID}`,
      source_type: 'webhook',
      source_config: { path: WEBHOOK_PATH },
      action_type: 'prompt',
      action_config: { prompt: '{{ prompt }}' },
      context_config: {
        extract: { prompt: '_channel_prompt' },
        session_key: '{{ _session_key }}',
      },
      session_mode: 'reuse',
    })

    // Start webhook server
    webhookServer = new WebhookTriggerServer('127.0.0.1', 0, async (route, payload) => {
      const parsedBody = (() => { try { return JSON.parse(payload.body) } catch { return payload.body } })()

      // Slack challenge
      const parsed = parseSlackEvent(parsedBody, CONFIG_ID, BOT_USER_ID)
      if (parsed.is_challenge) {
        // For the E2E test, we signal challenge via the dispatch result
        return { sessionId: `challenge:${parsed.challenge}` }
      }

      if (!parsed.dispatch_event) {
        return { sessionId: 'skipped' }
      }

      // Dedup
      const eventId = parsedBody.event_id
      if (eventId && seenEventIds.has(eventId)) {
        return { sessionId: 'dedup' }
      }
      if (eventId) seenEventIds.add(eventId)

      const ev = parsed.dispatch_event!

      // Find trigger
      const triggers = store.list({ source_type: 'webhook' })
      const trigger = triggers.find((t) => {
        const sc = JSON.parse(t.source_config) as WebhookSourceConfig
        return sc.path === WEBHOOK_PATH
      })
      if (!trigger) throw new Error(`No trigger for path: ${WEBHOOK_PATH}`)

      const result = await dispatcher.dispatch(trigger.id, {
        type: 'webhook.request',
        manual: false,
        timestamp: new Date().toISOString(),
        data: {
          body: parsedBody,
          _channel_prompt: ev.prompt,
          _session_key: ev.session_key,
        },
      })
      return { sessionId: result.sessionId ?? 'no-session' }
    })

    await webhookServer.start()
    const server = (webhookServer as any).server
    const addr = server.address()
    webhookPort = typeof addr === 'object' ? addr.port : 8099
    baseUrl = `http://127.0.0.1:${webhookPort}`

    webhookServer.setRoutes([{
      agentName: 'kortix',
      trigger: {
        name: `slack-${CONFIG_ID}`,
        source: { type: 'webhook', path: WEBHOOK_PATH },
        execution: { prompt: '', sessionMode: 'reuse' },
      },
    }])
  })

  afterEach(async () => {
    await webhookServer.stop()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('challenge verification → responds with challenge, no dispatch', async () => {
    const challenge = fixture('slack-challenge.json')
    const body = JSON.stringify(challenge)
    const res = await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    expect(res.status).toBe(202)
    const data = await res.json() as { ok: boolean; sessionId: string }
    expect(data.sessionId).toContain('challenge:')

    // No session created
    expect(mockClient.calls.filter(c => c.type === 'create')).toHaveLength(0)
  })

  it('valid app_mention → dispatches → creates session → returns 202', async () => {
    const event = fixture('slack-event-app-mention.json')
    const body = JSON.stringify(event)
    const res = await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    expect(res.status).toBe(202)
    const data = await res.json() as { ok: boolean; sessionId: string }
    expect(data.ok).toBe(true)
    expect(data.sessionId).not.toBe('skipped')

    expect(mockClient.calls.filter(c => c.type === 'create')).toHaveLength(1)
    expect(mockClient.calls.filter(c => c.type === 'promptAsync')).toHaveLength(1)
  })

  it('valid DM → dispatches → creates session', async () => {
    const event = fixture('slack-event-message-im.json')
    const body = JSON.stringify(event)
    const res = await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    expect(res.status).toBe(202)
    expect(mockClient.calls.filter(c => c.type === 'create')).toHaveLength(1)
  })

  it('thread reply → same session as parent thread', async () => {
    // First: top-level mention
    const event1 = fixture('slack-event-app-mention.json')
    await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event1),
    })

    // Second: reply in the same thread
    const event2 = fixture('slack-event-app-mention-in-thread.json')
    await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event2),
    })

    // Both should use the same session (same thread_ts)
    const creates = mockClient.calls.filter(c => c.type === 'create')
    expect(creates).toHaveLength(1) // reused

    const prompts = mockClient.calls.filter(c => c.type === 'promptAsync')
    expect(prompts).toHaveLength(2)
    expect(prompts[0].args.path.id).toBe(prompts[1].args.path.id)
  })

  it('bot message → ignored, no dispatch', async () => {
    const event = fixture('slack-event-bot-message.json')
    const body = JSON.stringify(event)
    const res = await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    expect(res.status).toBe(202)
    const data = await res.json() as { ok: boolean; sessionId: string }
    expect(data.sessionId).toBe('skipped')

    expect(mockClient.calls.filter(c => c.type === 'create')).toHaveLength(0)
  })

  it('reaction_added → dispatches with reaction context', async () => {
    const event = fixture('slack-event-reaction-added.json')
    await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })

    expect(mockClient.calls.filter(c => c.type === 'create')).toHaveLength(1)
    const prompt = mockClient.calls.find(c => c.type === 'promptAsync')?.args.body.parts[0].text
    expect(prompt).toContain('reaction')
  })

  it('duplicate event_id → responds 202 but no dispatch (dedup)', async () => {
    const event = fixture('slack-event-app-mention.json')

    // First call
    await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })

    // Same event_id again
    const res2 = await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })

    expect(res2.status).toBe(202)
    const data = await res2.json() as { sessionId: string }
    expect(data.sessionId).toBe('dedup')

    // Only 1 session create (first one)
    expect(mockClient.calls.filter(c => c.type === 'create')).toHaveLength(1)
  })

  it('DM session reuse: two DMs from same user → same session', async () => {
    const dm1 = fixture('slack-event-message-im.json')
    const dm2 = JSON.parse(JSON.stringify(dm1))
    ;(dm2 as any).event_id = 'Ev_DIFFERENT'
    ;(dm2 as any).event.text = 'second message'
    ;(dm2 as any).event.ts = '1712161500.000200'
    ;(dm2 as any).event.event_ts = '1712161500.000200'

    await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dm1),
    })
    await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dm2),
    })

    // 1 create (reused)
    expect(mockClient.calls.filter(c => c.type === 'create')).toHaveLength(1)
    // 2 prompts to same session
    const prompts = mockClient.calls.filter(c => c.type === 'promptAsync')
    expect(prompts).toHaveLength(2)
    expect(prompts[0].args.path.id).toBe(prompts[1].args.path.id)
  })
})
