/**
 * Unit tests for ActionDispatcher and action handlers.
 * Tests prompt, command, and http actions with mocked dependencies.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { TriggerStore } from '../../triggers/src/trigger-store'
import { ActionDispatcher } from '../../triggers/src/action-dispatch'
import type { MinimalOpenCodeClient } from '../../triggers/src/types'

function createMockClient(): MinimalOpenCodeClient & { calls: { type: string; args: any }[] } {
  const calls: { type: string; args: any }[] = []
  return {
    calls,
    session: {
      create: async (params) => {
        calls.push({ type: 'create', args: params })
        return { data: { id: 'mock-session-id' } }
      },
      promptAsync: async (params) => {
        calls.push({ type: 'promptAsync', args: params })
        return {}
      },
    },
  }
}

describe('ActionDispatcher', () => {
  let tempDir: string
  let store: TriggerStore
  let mockClient: ReturnType<typeof createMockClient>
  let dispatcher: ActionDispatcher

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'action-dispatch-test-'))
    store = new TriggerStore(join(tempDir, 'test.db'))
    mockClient = createMockClient()
    dispatcher = new ActionDispatcher(store, mockClient, tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('prompt action', () => {
    it('dispatches prompt to OpenCode session', async () => {
      const trigger = store.create({
        name: 'Prompt Test',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_type: 'prompt',
        action_config: { prompt: 'Generate the report' },
        agent_name: 'kortix',
      })

      const result = await dispatcher.dispatch(trigger.id, {
        type: 'cron.tick',
        manual: true,
        timestamp: new Date().toISOString(),
      })

      expect(result.executionId).toBeTruthy()
      expect(result.sessionId).toBe('mock-session-id')

      // Verify session was created and prompt sent
      expect(mockClient.calls).toHaveLength(2)
      expect(mockClient.calls[0].type).toBe('create')
      expect(mockClient.calls[1].type).toBe('promptAsync')

      // Verify prompt includes trigger text
      const promptBody = mockClient.calls[1].args.body.parts[0].text
      expect(promptBody).toContain('Generate the report')

      // Verify execution record
      const exec = store.getExecution(result.executionId)
      expect(exec!.status).toBe('completed')
      expect(exec!.session_id).toBe('mock-session-id')
      expect(exec!.duration_ms).toBeGreaterThanOrEqual(0)
    })

    it('includes trigger_event XML in prompt', async () => {
      const trigger = store.create({
        name: 'XML Test',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_type: 'prompt',
        action_config: { prompt: 'Do the thing' },
      })

      await dispatcher.dispatch(trigger.id, {
        type: 'cron.tick',
        manual: false,
        timestamp: '2026-04-02T09:00:00Z',
      })

      const promptBody = mockClient.calls[1].args.body.parts[0].text
      expect(promptBody).toContain('<trigger_event>')
      expect(promptBody).toContain('"type": "cron.tick"')
      expect(promptBody).toContain('"trigger": "XML Test"')
    })

    it('renders template variables in webhook events', async () => {
      const trigger = store.create({
        name: 'Template Test',
        source_type: 'webhook',
        source_config: { path: '/hooks/test' },
        action_type: 'prompt',
        action_config: { prompt: 'Deploy {{ repo }} on {{ branch }}' },
        context_config: { extract: { repo: 'data.body.repository', branch: 'data.body.ref' } },
      })

      await dispatcher.dispatch(trigger.id, {
        type: 'webhook.request',
        manual: false,
        timestamp: new Date().toISOString(),
        data: {
          body: { repository: 'kortix-ai/suna', ref: 'refs/heads/main' },
        },
      })

      const promptBody = mockClient.calls[1].args.body.parts[0].text
      expect(promptBody).toContain('Deploy')
      // Context extraction creates trigger_context_values
      expect(promptBody).toContain('<trigger_context_values>')
    })

    it('skips duplicate concurrent runs', async () => {
      const trigger = store.create({
        name: 'Concurrent',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_type: 'prompt',
        action_config: { prompt: 'slow task' },
      })

      // Mock a slow session creation
      mockClient.session.create = async () => {
        await Bun.sleep(100)
        return { data: { id: 'slow-session' } }
      }

      // Fire two dispatches simultaneously
      const [result1, result2] = await Promise.all([
        dispatcher.dispatch(trigger.id, { type: 'cron.tick', manual: false, timestamp: new Date().toISOString() }),
        dispatcher.dispatch(trigger.id, { type: 'cron.tick', manual: false, timestamp: new Date().toISOString() }),
      ])

      // One should complete, one should be skipped
      const exec1 = store.getExecution(result1.executionId)!
      const exec2 = store.getExecution(result2.executionId)!
      const statuses = [exec1.status, exec2.status].sort()
      expect(statuses).toContain('skipped')
    })

    it('records failed execution on error', async () => {
      const trigger = store.create({
        name: 'Failing',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_type: 'prompt',
        action_config: { prompt: 'will fail' },
      })

      mockClient.session.create = async () => {
        throw new Error('Connection refused')
      }

      const result = await dispatcher.dispatch(trigger.id, {
        type: 'cron.tick',
        manual: true,
        timestamp: new Date().toISOString(),
      })

      const exec = store.getExecution(result.executionId)!
      expect(exec.status).toBe('failed')
      expect(exec.error_message).toContain('Connection refused')
    })
  })

  describe('command action', () => {
    it('executes a shell command and captures output', async () => {
      const trigger = store.create({
        name: 'Echo Test',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_type: 'command',
        action_config: { command: 'echo', args: ['hello world'] },
      })

      const result = await dispatcher.dispatch(trigger.id, {
        type: 'cron.tick',
        manual: true,
        timestamp: new Date().toISOString(),
      })

      expect(result.exitCode).toBe(0)

      const exec = store.getExecution(result.executionId)!
      expect(exec.status).toBe('completed')
      expect(exec.exit_code).toBe(0)
      expect(exec.stdout).toContain('hello world')
    })

    it('captures non-zero exit code as completed (not failed)', async () => {
      const trigger = store.create({
        name: 'Exit Test',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_type: 'command',
        action_config: { command: 'bash', args: ['-c', 'exit 42'] },
      })

      const result = await dispatcher.dispatch(trigger.id, {
        type: 'cron.tick',
        manual: true,
        timestamp: new Date().toISOString(),
      })

      expect(result.exitCode).toBe(42)
      const exec = store.getExecution(result.executionId)!
      expect(exec.status).toBe('completed')
      expect(exec.exit_code).toBe(42)
    })

    it('captures stderr', async () => {
      const trigger = store.create({
        name: 'Stderr Test',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_type: 'command',
        action_config: { command: 'bash', args: ['-c', 'echo error >&2'] },
      })

      const result = await dispatcher.dispatch(trigger.id, {
        type: 'cron.tick',
        manual: true,
        timestamp: new Date().toISOString(),
      })

      const exec = store.getExecution(result.executionId)!
      expect(exec.stderr).toContain('error')
    })
  })

  describe('http action', () => {
    it('makes an outbound HTTP request', async () => {
      // Start a tiny HTTP server to receive the request
      const server = Bun.serve({
        port: 0, // random port
        fetch(req) {
          return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })

      try {
        const trigger = store.create({
          name: 'HTTP Test',
          source_type: 'cron',
          source_config: { cron_expr: '0 0 9 * * *' },
          action_type: 'http',
          action_config: {
            url: `http://localhost:${server.port}/test`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body_template: '{"message": "hello"}',
          },
        })

        const result = await dispatcher.dispatch(trigger.id, {
          type: 'cron.tick',
          manual: true,
          timestamp: new Date().toISOString(),
        })

        expect(result.httpStatus).toBe(200)

        const exec = store.getExecution(result.executionId)!
        expect(exec.status).toBe('completed')
        expect(exec.http_status).toBe(200)
        expect(exec.http_body).toContain('received')
      } finally {
        server.stop()
      }
    })

    it('handles HTTP errors gracefully', async () => {
      const server = Bun.serve({
        port: 0,
        fetch() {
          return new Response('Internal Server Error', { status: 500 })
        },
      })

      try {
        const trigger = store.create({
          name: 'HTTP Error',
          source_type: 'cron',
          source_config: { cron_expr: '0 0 9 * * *' },
          action_type: 'http',
          action_config: { url: `http://localhost:${server.port}/error`, method: 'GET' },
        })

        const result = await dispatcher.dispatch(trigger.id, {
          type: 'cron.tick',
          manual: true,
          timestamp: new Date().toISOString(),
        })

        // HTTP 500 is still a "completed" execution (the action ran successfully)
        expect(result.httpStatus).toBe(500)
        const exec = store.getExecution(result.executionId)!
        expect(exec.status).toBe('completed')
        expect(exec.http_status).toBe(500)
      } finally {
        server.stop()
      }
    })
  })

  describe('trigger state', () => {
    it('updates last_run_at after dispatch', async () => {
      const trigger = store.create({
        name: 'State Test',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_type: 'command',
        action_config: { command: 'echo', args: ['done'] },
      })

      expect(trigger.last_run_at).toBeNull()

      await dispatcher.dispatch(trigger.id, {
        type: 'cron.tick',
        manual: true,
        timestamp: new Date().toISOString(),
      })

      const updated = store.get(trigger.id)!
      expect(updated.last_run_at).toBeTruthy()
    })
  })
})
