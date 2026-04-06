/**
 * E2E test: Create a webhook trigger → fire it via HTTP → verify execution.
 *
 * This test spins up the REAL webhook server (port 0 = random),
 * creates a trigger with a `command` action, fires the webhook via fetch,
 * and verifies the full chain: HTTP in → dispatch → command exec → execution record.
 *
 * No mocks. Real HTTP. Real SQLite. Real Bun.spawn.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { TriggerStore } from '../../triggers/src/trigger-store'
import { TriggerYaml } from '../../triggers/src/trigger-yaml'
import { ActionDispatcher } from '../../triggers/src/action-dispatch'
import { WebhookTriggerServer } from '../../triggers/src/webhook-server'
import type { MinimalOpenCodeClient, WebhookSourceConfig } from '../../triggers/src/types'

function createMockClient(): MinimalOpenCodeClient {
  return {
    session: {
      create: async () => ({ data: { id: `mock-sess-${crypto.randomUUID().slice(0, 8)}` } }),
      promptAsync: async () => ({}),
    },
  }
}

describe('Webhook Fire E2E', () => {
  let tempDir: string
  let store: TriggerStore
  let yamlSync: TriggerYaml
  let dispatcher: ActionDispatcher
  let webhookServer: WebhookTriggerServer
  let webhookPort: number

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'webhook-e2e-'))
    mkdirSync(join(tempDir, '.kortix'), { recursive: true })

    store = new TriggerStore(join(tempDir, '.kortix', 'test.db'))
    yamlSync = new TriggerYaml(store, tempDir)
    const client = createMockClient()
    dispatcher = new ActionDispatcher(store, client, tempDir)

    // Start webhook server on a random port
    webhookPort = 0
    webhookServer = new WebhookTriggerServer('127.0.0.1', 0, async (route, payload) => {
      // Find trigger by path
      const triggers = store.list({ source_type: 'webhook' })
      const trigger = triggers.find((t) => {
        const sc = JSON.parse(t.source_config) as WebhookSourceConfig
        return sc.path === payload.path
      })
      if (!trigger) throw new Error(`No trigger for path: ${payload.path}`)

      const parsedBody = (() => {
        try { return JSON.parse(payload.body) } catch { return payload.body }
      })()

      const result = await dispatcher.dispatch(trigger.id, {
        type: 'webhook.request',
        manual: false,
        timestamp: new Date().toISOString(),
        data: {
          method: payload.method,
          path: payload.path,
          headers: payload.headers,
          body: parsedBody,
        },
      })
      return { sessionId: result.sessionId ?? 'no-session' }
    })
    await webhookServer.start()

    // Get the actual port
    const server = (webhookServer as any).server
    const addr = server.address()
    webhookPort = typeof addr === 'object' ? addr.port : 8099
  })

  afterEach(async () => {
    await webhookServer.stop()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── Test 1: Webhook + Command action ─────────────────────────────────

  it('creates a webhook trigger with command action, fires it, verifies execution', async () => {
    // 1. Create a webhook trigger that runs `echo` when fired
    const trigger = store.create({
      name: 'Test Deploy Hook',
      source_type: 'webhook',
      source_config: { path: '/hooks/deploy', method: 'POST' },
      action_type: 'command',
      action_config: { command: 'echo', args: ['webhook-received'] },
    })

    // Register the route in the webhook server
    webhookServer.setRoutes([{
      agentName: 'test',
      trigger: {
        name: trigger.name,
        source: { type: 'webhook', path: '/hooks/deploy', method: 'POST' },
        execution: { prompt: '', sessionMode: 'new' },
      },
    }])

    // 2. Fire the webhook via real HTTP
    const response = await fetch(`http://127.0.0.1:${webhookPort}/hooks/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repository: 'kortix-ai/suna', branch: 'main' }),
    })

    expect(response.status).toBe(202)
    const body = await response.json() as { ok: boolean; sessionId: string }
    expect(body.ok).toBe(true)

    // 3. Verify execution was recorded
    const executions = store.listExecutions({ triggerId: trigger.id })
    expect(executions.total).toBe(1)
    expect(executions.data[0].status).toBe('completed')
    expect(executions.data[0].exit_code).toBe(0)
    expect(executions.data[0].stdout).toContain('webhook-received')

    // 4. Verify trigger runtime state was updated
    const updated = store.get(trigger.id)!
    expect(updated.last_run_at).toBeTruthy()
  })

  // ─── Test 2: Webhook + Prompt action ──────────────────────────────────

  it('creates a webhook trigger with prompt action, fires it, verifies session creation', async () => {
    const trigger = store.create({
      name: 'PR Review',
      source_type: 'webhook',
      source_config: { path: '/hooks/pr', method: 'POST' },
      action_type: 'prompt',
      action_config: { prompt: 'Review PR #{{ number }}: {{ title }}' },
      agent_name: 'kortix',
    })

    webhookServer.setRoutes([{
      agentName: 'kortix',
      trigger: {
        name: trigger.name,
        source: { type: 'webhook', path: '/hooks/pr', method: 'POST' },
        execution: { prompt: 'Review PR', agentName: 'kortix', sessionMode: 'new' },
      },
    }])

    const response = await fetch(`http://127.0.0.1:${webhookPort}/hooks/pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: 42, title: 'Add triggers' }),
    })

    expect(response.status).toBe(202)
    const body = await response.json() as { ok: boolean; sessionId: string }
    expect(body.ok).toBe(true)
    expect(body.sessionId).toMatch(/^mock-sess-/)

    // Verify execution
    const executions = store.listExecutions({ triggerId: trigger.id })
    expect(executions.total).toBe(1)
    expect(executions.data[0].status).toBe('completed')
    expect(executions.data[0].session_id).toMatch(/^mock-sess-/)
  })

  // ─── Test 3: Webhook with secret ──────────────────────────────────────

  it('rejects webhook without correct secret', async () => {
    const trigger = store.create({
      name: 'Protected Hook',
      source_type: 'webhook',
      source_config: { path: '/hooks/secret', method: 'POST', secret: 'my-secret-123' },
      action_type: 'command',
      action_config: { command: 'echo', args: ['should-not-run'] },
    })

    webhookServer.setRoutes([{
      agentName: 'test',
      trigger: {
        name: trigger.name,
        source: { type: 'webhook', path: '/hooks/secret', method: 'POST', secret: 'my-secret-123' },
        execution: { prompt: '', sessionMode: 'new' },
      },
    }])

    // Fire WITHOUT secret → should be rejected
    const badResponse = await fetch(`http://127.0.0.1:${webhookPort}/hooks/secret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'test' }),
    })
    expect(badResponse.status).toBe(401)
    const badBody = await badResponse.json() as { ok: boolean; error: string }
    expect(badBody.ok).toBe(false)
    expect(badBody.error).toBe('invalid_secret')

    // Fire WITH wrong secret → should be rejected
    const wrongResponse = await fetch(`http://127.0.0.1:${webhookPort}/hooks/secret`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kortix-Trigger-Secret': 'wrong-secret',
      },
      body: JSON.stringify({ data: 'test' }),
    })
    expect(wrongResponse.status).toBe(401)

    // Fire WITH correct secret → should succeed
    const goodResponse = await fetch(`http://127.0.0.1:${webhookPort}/hooks/secret`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Kortix-Trigger-Secret': 'my-secret-123',
      },
      body: JSON.stringify({ data: 'test' }),
    })
    expect(goodResponse.status).toBe(202)
    const goodBody = await goodResponse.json() as { ok: boolean }
    expect(goodBody.ok).toBe(true)

    // Only the successful one should have an execution
    const executions = store.listExecutions({ triggerId: trigger.id })
    expect(executions.total).toBe(1)
    expect(executions.data[0].status).toBe('completed')
    expect(executions.data[0].stdout).toContain('should-not-run') // ironic name but it DID run with correct secret
  })

  // ─── Test 4: Webhook + HTTP action (outbound call) ────────────────────

  it('fires webhook that triggers an outbound HTTP call', async () => {
    // Start a tiny receiver server to catch the outbound HTTP
    let receivedBody: string | null = null
    const receiver = Bun.serve({
      port: 0,
      fetch(req) {
        return (async () => {
          receivedBody = await req.text()
          return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        })()
      },
    })

    try {
      const trigger = store.create({
        name: 'Alert Relay',
        source_type: 'webhook',
        source_config: { path: '/hooks/alert', method: 'POST' },
        action_type: 'http',
        action_config: {
          url: `http://localhost:${receiver.port}/receive`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body_template: '{"alert": "fired", "source": "webhook"}',
        },
      })

      webhookServer.setRoutes([{
        agentName: 'test',
        trigger: {
          name: trigger.name,
          source: { type: 'webhook', path: '/hooks/alert', method: 'POST' },
          execution: { prompt: '', sessionMode: 'new' },
        },
      }])

      // Fire the webhook
      const response = await fetch(`http://127.0.0.1:${webhookPort}/hooks/alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'server down' }),
      })

      expect(response.status).toBe(202)

      // Verify the outbound HTTP was made
      expect(receivedBody).not.toBeNull()
      const parsed = JSON.parse(receivedBody!)
      expect(parsed.alert).toBe('fired')

      // Verify execution record
      const executions = store.listExecutions({ triggerId: trigger.id })
      expect(executions.total).toBe(1)
      expect(executions.data[0].status).toBe('completed')
      expect(executions.data[0].http_status).toBe(200)
    } finally {
      receiver.stop()
    }
  })

  // ─── Test 5: 404 for unknown webhook path ─────────────────────────────

  it('returns 404 for unregistered webhook path', async () => {
    const response = await fetch(`http://127.0.0.1:${webhookPort}/hooks/nonexistent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    expect(response.status).toBe(404)
    const body = await response.json() as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toBe('not_found')
  })

  // ─── Test 6: YAML persistence ─────────────────────────────────────────

  it('webhook trigger persists to triggers.yaml after creation + flush', async () => {
    store.create({
      name: 'Persistent Hook',
      source_type: 'webhook',
      source_config: { path: '/hooks/persist', method: 'POST', secret: 'sec' },
      action_type: 'command',
      action_config: { command: 'echo', args: ['persisted'] },
    })

    // Flush DB state to YAML
    yamlSync.flushToYaml()

    // Verify YAML file exists and contains the trigger
    const yamlPath = join(tempDir, '.kortix', 'triggers.yaml')
    expect(existsSync(yamlPath)).toBe(true)

    const content = readFileSync(yamlPath, 'utf8')
    expect(content).toContain('Persistent Hook')
    expect(content).toContain('/hooks/persist')
    expect(content).toContain('command')

    // Verify round-trip: clear DB, re-read from YAML
    store.deleteByName('Persistent Hook')
    expect(store.getByName('Persistent Hook')).toBeNull()

    const freshSync = new TriggerYaml(store, tempDir)
    const result = freshSync.syncFromYaml()
    expect(result.created).toBe(1)

    const restored = store.getByName('Persistent Hook')!
    expect(restored.source_type).toBe('webhook')
    expect(restored.action_type).toBe('command')
    const sc = JSON.parse(restored.source_config)
    expect(sc.path).toBe('/hooks/persist')
  })

  // ─── Test 7: Multiple webhooks on different paths ─────────────────────

  it('routes to correct trigger based on path', async () => {
    const trigger1 = store.create({
      name: 'Hook A',
      source_type: 'webhook',
      source_config: { path: '/hooks/alpha', method: 'POST' },
      action_type: 'command',
      action_config: { command: 'echo', args: ['alpha-fired'] },
    })
    const trigger2 = store.create({
      name: 'Hook B',
      source_type: 'webhook',
      source_config: { path: '/hooks/beta', method: 'POST' },
      action_type: 'command',
      action_config: { command: 'echo', args: ['beta-fired'] },
    })

    webhookServer.setRoutes([
      {
        agentName: 'test',
        trigger: { name: 'Hook A', source: { type: 'webhook', path: '/hooks/alpha', method: 'POST' }, execution: { prompt: '', sessionMode: 'new' } },
      },
      {
        agentName: 'test',
        trigger: { name: 'Hook B', source: { type: 'webhook', path: '/hooks/beta', method: 'POST' }, execution: { prompt: '', sessionMode: 'new' } },
      },
    ])

    // Fire alpha
    const res1 = await fetch(`http://127.0.0.1:${webhookPort}/hooks/alpha`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res1.status).toBe(202)

    // Fire beta
    const res2 = await fetch(`http://127.0.0.1:${webhookPort}/hooks/beta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res2.status).toBe(202)

    // Verify each trigger has exactly 1 execution
    const execs1 = store.listExecutions({ triggerId: trigger1.id })
    expect(execs1.total).toBe(1)
    expect(execs1.data[0].stdout).toContain('alpha-fired')

    const execs2 = store.listExecutions({ triggerId: trigger2.id })
    expect(execs2.total).toBe(1)
    expect(execs2.data[0].stdout).toContain('beta-fired')
  })
})
