import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHmac } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const FIXTURES = join(import.meta.dir, '../fixtures/channels')

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf-8'))
}

function signSlackRequest(body: string, secret: string): { signature: string; timestamp: string } {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const sigBase = `v0:${timestamp}:${body}`
  const signature = 'v0=' + createHmac('sha256', secret).update(sigBase).digest('hex')
  return { signature, timestamp }
}

describe('Slack channel webhook route', () => {
  const originalWorkspace = process.env.KORTIX_WORKSPACE
  const originalFetch = globalThis.fetch
  let workspace = ''

  beforeEach(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'slack-route-e2e-'))
    process.env.KORTIX_WORKSPACE = workspace
    process.env.INTERNAL_SERVICE_KEY = 'kortix_sb_test'
    process.env.KORTIX_TOKEN = 'kortix_sb_test'

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === 'http://localhost:4096/session') {
        return new Response(JSON.stringify({ id: 'sess-slack-route' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url === 'http://localhost:4096/session/sess-slack-route/prompt_async') {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }) as typeof fetch
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    process.env.KORTIX_WORKSPACE = originalWorkspace
    rmSync(workspace, { recursive: true, force: true })
  })

  it('accepts a signed Slack event and returns 202 instead of crashing', async () => {
    const { createChannel } = await import('../../channels/channel-db')
    const { default: channelWebhooksRouter } = await import('../../src/routes/channel-webhooks')

    const channel = createChannel({
      platform: 'slack',
      name: 'Slack Route Test',
      bot_token: 'xoxb-test',
      signing_secret: 'signing-secret',
      bot_id: 'U0LAN0Z89',
      bot_username: 'kortix-bot',
      enabled: true,
    })

    const payload = fixture('slack-event-app-mention.json') as Record<string, unknown>
    const body = JSON.stringify(payload)
    const { signature, timestamp } = signSlackRequest(body, 'signing-secret')

    const res = await channelWebhooksRouter.request(`http://localhost${channel.webhook_path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-slack-signature': signature,
        'x-slack-request-timestamp': timestamp,
      },
      body,
    })

    expect(res.status).toBe(202)
    const json = await res.json() as { ok: boolean; sessionId: string }
    expect(json.ok).toBe(true)
    expect(json.sessionId).toBe('sess-slack-route')
  })
})
