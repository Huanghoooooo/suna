/**
 * E2E test: Telegram webhook → channel-webhooks parser → trigger dispatch → session.
 *
 * Real HTTP server, real SQLite, real webhook dispatch.
 * Mocked OpenCode client (no real agent).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { TriggerStore } from '../../triggers/src/trigger-store'
import { ActionDispatcher } from '../../triggers/src/action-dispatch'
import { WebhookTriggerServer } from '../../triggers/src/webhook-server'
import { parseTelegramUpdate, type NormalizedChannelEvent } from '../../triggers/src/channel-webhooks'
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

describe('Telegram Webhook E2E', () => {
  let tempDir: string
  let store: TriggerStore
  let mockClient: ReturnType<typeof createMockClient>
  let dispatcher: ActionDispatcher
  let webhookServer: WebhookTriggerServer
  let webhookPort: number
  let baseUrl: string

  const CONFIG_ID = 'test-cfg-tg'
  const WEBHOOK_PATH = `/hooks/telegram/${CONFIG_ID}`
  const SECRET_TOKEN = 'test-secret-123'

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'tg-webhook-e2e-'))
    store = new TriggerStore(join(tempDir, 'test.db'))
    mockClient = createMockClient()
    dispatcher = new ActionDispatcher(store, mockClient, tempDir)

    // Create a telegram inbound trigger
    store.create({
      name: `telegram-${CONFIG_ID}`,
      source_type: 'webhook',
      source_config: { path: WEBHOOK_PATH, secret: SECRET_TOKEN },
      action_type: 'prompt',
      action_config: { prompt: '{{ prompt }}' },
      context_config: {
        extract: { prompt: '_channel_prompt' },
        session_key: '{{ _session_key }}',
      },
      session_mode: 'reuse',
    })

    // Start webhook server on random port
    webhookServer = new WebhookTriggerServer('127.0.0.1', 0, async (route, payload) => {
      // Parse the Telegram update
      const parsedBody = (() => { try { return JSON.parse(payload.body) } catch { return payload.body } })()

      // Use channel-webhooks to normalize
      const normalized = parseTelegramUpdate(parsedBody, CONFIG_ID)
      if (!normalized) throw new Error('Unrecognized Telegram update')

      // Find trigger by path
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
          _channel_prompt: normalized.prompt,
          _session_key: normalized.session_key,
        },
      })
      return { sessionId: result.sessionId ?? 'no-session' }
    })

    await webhookServer.start()
    const server = (webhookServer as any).server
    const addr = server.address()
    webhookPort = typeof addr === 'object' ? addr.port : 8099
    baseUrl = `http://127.0.0.1:${webhookPort}`

    // Register the route
    webhookServer.setRoutes([{
      agentName: 'kortix',
      trigger: {
        name: `telegram-${CONFIG_ID}`,
        source: { type: 'webhook', path: WEBHOOK_PATH, secret: SECRET_TOKEN },
        execution: { prompt: '', sessionMode: 'reuse' },
      },
    }])
  })

  afterEach(async () => {
    await webhookServer.stop()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('receives Telegram Update → dispatches → creates session → returns 202', async () => {
    const update = fixture('telegram-update-message.json')
    const res = await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kortix-Trigger-Secret': SECRET_TOKEN,
      },
      body: JSON.stringify(update),
    })

    expect(res.status).toBe(202)
    const data = await res.json() as { ok: boolean; sessionId: string }
    expect(data.ok).toBe(true)
    expect(data.sessionId).toBeTruthy()

    // Verify OpenCode client was called
    expect(mockClient.calls.filter(c => c.type === 'create')).toHaveLength(1)
    expect(mockClient.calls.filter(c => c.type === 'promptAsync')).toHaveLength(1)
  })

  it('per-user session reuse: two messages from same user → same session', async () => {
    const msg1 = fixture('telegram-update-message.json')
    const msg2 = { ...msg1 as any, update_id: 100099 }
    ;(msg2 as any).message = { ...(msg1 as any).message, message_id: 99, text: 'second msg' }

    await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kortix-Trigger-Secret': SECRET_TOKEN },
      body: JSON.stringify(msg1),
    })
    await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kortix-Trigger-Secret': SECRET_TOKEN },
      body: JSON.stringify(msg2),
    })

    // Only 1 session create (reused)
    const creates = mockClient.calls.filter(c => c.type === 'create')
    expect(creates).toHaveLength(1)

    // 2 prompts, both to same session
    const prompts = mockClient.calls.filter(c => c.type === 'promptAsync')
    expect(prompts).toHaveLength(2)
    expect(prompts[0].args.path.id).toBe(prompts[1].args.path.id)
  })

  it('per-user session isolation: different users → different sessions', async () => {
    const msg1 = fixture('telegram-update-message.json')
    const msg2 = {
      update_id: 200001,
      message: {
        message_id: 200,
        from: { id: 999999, first_name: 'OtherUser', username: 'other' },
        chat: { id: 999999, type: 'private' },
        date: 1712170000,
        text: 'different user',
      },
    }

    await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kortix-Trigger-Secret': SECRET_TOKEN },
      body: JSON.stringify(msg1),
    })
    await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kortix-Trigger-Secret': SECRET_TOKEN },
      body: JSON.stringify(msg2),
    })

    // 2 session creates (different users)
    const creates = mockClient.calls.filter(c => c.type === 'create')
    expect(creates).toHaveLength(2)

    // Prompts sent to different sessions
    const prompts = mockClient.calls.filter(c => c.type === 'promptAsync')
    expect(prompts[0].args.path.id).not.toBe(prompts[1].args.path.id)
  })

  it('rejects invalid secret token → 401', async () => {
    const update = fixture('telegram-update-message.json')
    const res = await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kortix-Trigger-Secret': 'wrong-secret',
      },
      body: JSON.stringify(update),
    })
    expect(res.status).toBe(401)
  })

  it('returns 404 for unknown webhook path', async () => {
    const res = await fetch(`${baseUrl}/hooks/telegram/unknown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(404)
  })

  it('execution record is stored in DB', async () => {
    const update = fixture('telegram-update-message.json')
    await fetch(`${baseUrl}${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Kortix-Trigger-Secret': SECRET_TOKEN },
      body: JSON.stringify(update),
    })

    // Check execution record
    const triggers = store.list()
    expect(triggers).toHaveLength(1)
    const executions = store.listExecutions({ triggerId: triggers[0].id })
    expect(executions.data.length).toBeGreaterThanOrEqual(1)
    expect(executions.data[0].status).toBe('completed')
  })
})
