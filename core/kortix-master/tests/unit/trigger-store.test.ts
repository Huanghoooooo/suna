/**
 * Unit tests for TriggerStore — the unified SQLite storage layer.
 * Tests CRUD, filtering, execution records, runtime state helpers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { TriggerStore } from '../../triggers/src/trigger-store'

describe('TriggerStore', () => {
  let tempDir: string
  let store: TriggerStore

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'trigger-store-test-'))
    store = new TriggerStore(join(tempDir, 'test.db'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── Trigger CRUD ───────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a cron trigger with all fields', () => {
      const trigger = store.create({
        name: 'Daily Report',
        description: 'Generates daily report',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *', timezone: 'UTC' },
        action_type: 'prompt',
        action_config: { prompt: 'Generate the daily report' },
        agent_name: 'kortix',
        model_id: 'anthropic/claude-sonnet-4-20250514',
        session_mode: 'new',
      })

      expect(trigger.id).toBeTruthy()
      expect(trigger.name).toBe('Daily Report')
      expect(trigger.source_type).toBe('cron')
      expect(trigger.action_type).toBe('prompt')
      expect(trigger.is_active).toBe(1)
      expect(trigger.next_run_at).toBeTruthy()
      expect(trigger.created_at).toBeTruthy()
    })

    it('creates a webhook trigger', () => {
      const trigger = store.create({
        name: 'Deploy Hook',
        source_type: 'webhook',
        source_config: { path: '/hooks/deploy', method: 'POST', secret: 'mysecret' },
        action_type: 'prompt',
        action_config: { prompt: 'Handle deploy' },
      })

      expect(trigger.source_type).toBe('webhook')
      expect(trigger.next_run_at).toBeNull()
      const sc = JSON.parse(trigger.source_config)
      expect(sc.path).toBe('/hooks/deploy')
      expect(sc.secret).toBe('mysecret')
    })

    it('creates a command action trigger', () => {
      const trigger = store.create({
        name: 'Backup',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 2 * * *' },
        action_type: 'command',
        action_config: { command: 'bash', args: ['-c', './backup.sh'] },
      })

      expect(trigger.action_type).toBe('command')
      const ac = JSON.parse(trigger.action_config)
      expect(ac.command).toBe('bash')
      expect(ac.args).toEqual(['-c', './backup.sh'])
    })

    it('creates an http action trigger', () => {
      const trigger = store.create({
        name: 'Slack Notify',
        source_type: 'webhook',
        source_config: { path: '/hooks/alert' },
        action_type: 'http',
        action_config: { url: 'https://hooks.slack.com/xxx', method: 'POST', body_template: '{"text":"alert"}' },
      })

      expect(trigger.action_type).toBe('http')
      const ac = JSON.parse(trigger.action_config)
      expect(ac.url).toBe('https://hooks.slack.com/xxx')
    })

    it('rejects duplicate names', () => {
      store.create({
        name: 'Unique',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_config: { prompt: 'test' },
      })

      expect(() => store.create({
        name: 'Unique',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 10 * * *' },
        action_config: { prompt: 'duplicate' },
      })).toThrow()
    })

    it('creates trigger with Pipedream metadata', () => {
      const trigger = store.create({
        name: 'GitHub PR',
        source_type: 'webhook',
        source_config: { path: '/events/pipedream/github-pr' },
        action_config: { prompt: 'New PR' },
        pipedream_app: 'github',
        pipedream_component: 'github-new-pull-request',
        pipedream_props: { repo: 'kortix-ai/computer' },
      })

      expect(trigger.pipedream_app).toBe('github')
      expect(trigger.pipedream_component).toBe('github-new-pull-request')
      const props = JSON.parse(trigger.pipedream_props)
      expect(props.repo).toBe('kortix-ai/computer')
    })
  })

  describe('get / getByName', () => {
    it('retrieves by ID', () => {
      const created = store.create({
        name: 'Test',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_config: { prompt: 'test' },
      })

      const fetched = store.get(created.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.name).toBe('Test')
    })

    it('retrieves by name', () => {
      store.create({
        name: 'By Name',
        source_type: 'webhook',
        source_config: { path: '/test' },
        action_config: { prompt: 'test' },
      })

      const fetched = store.getByName('By Name')
      expect(fetched).not.toBeNull()
      expect(fetched!.source_type).toBe('webhook')
    })

    it('returns null for missing', () => {
      expect(store.get('nonexistent')).toBeNull()
      expect(store.getByName('nonexistent')).toBeNull()
    })
  })

  describe('list', () => {
    beforeEach(() => {
      store.create({ name: 'Cron1', source_type: 'cron', source_config: { cron_expr: '0 0 9 * * *' }, action_config: { prompt: 'a' } })
      store.create({ name: 'Cron2', source_type: 'cron', source_config: { cron_expr: '0 0 10 * * *' }, action_config: { prompt: 'b' } })
      store.create({ name: 'Webhook1', source_type: 'webhook', source_config: { path: '/hooks/a' }, action_config: { prompt: 'c' } })
    })

    it('lists all triggers', () => {
      expect(store.list()).toHaveLength(3)
    })

    it('filters by source_type', () => {
      expect(store.list({ source_type: 'cron' })).toHaveLength(2)
      expect(store.list({ source_type: 'webhook' })).toHaveLength(1)
    })

    it('filters by is_active', () => {
      const webhook = store.getByName('Webhook1')!
      store.update(webhook.id, { is_active: false })

      expect(store.list({ is_active: true })).toHaveLength(2)
      expect(store.list({ is_active: false })).toHaveLength(1)
    })

    it('combines filters', () => {
      expect(store.list({ source_type: 'cron', is_active: true })).toHaveLength(2)
    })
  })

  describe('update', () => {
    it('updates config fields', () => {
      const trigger = store.create({
        name: 'Update Me',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_config: { prompt: 'original' },
      })

      const updated = store.update(trigger.id, {
        name: 'Updated',
        source_config: { cron_expr: '0 0 10 * * *', timezone: 'America/New_York' },
        action_config: { prompt: 'updated prompt' },
      })

      expect(updated!.name).toBe('Updated')
      const sc = JSON.parse(updated!.source_config)
      expect(sc.cron_expr).toBe('0 0 10 * * *')
      const ac = JSON.parse(updated!.action_config)
      expect(ac.prompt).toBe('updated prompt')
    })

    it('updates is_active (pause/resume)', () => {
      const trigger = store.create({
        name: 'Pausable',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_config: { prompt: 'test' },
      })

      const paused = store.update(trigger.id, { is_active: false })
      expect(paused!.is_active).toBe(0)

      const resumed = store.update(trigger.id, { is_active: true })
      expect(resumed!.is_active).toBe(1)
    })

    it('returns null for missing trigger', () => {
      expect(store.update('nonexistent', { name: 'x' })).toBeNull()
    })
  })

  describe('delete', () => {
    it('deletes a trigger', () => {
      const trigger = store.create({
        name: 'Delete Me',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_config: { prompt: 'test' },
      })

      expect(store.delete(trigger.id)).toBe(true)
      expect(store.get(trigger.id)).toBeNull()
    })

    it('returns false for missing', () => {
      expect(store.delete('nonexistent')).toBe(false)
    })

    it('cascade deletes executions', () => {
      const trigger = store.create({
        name: 'Cascade',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_config: { prompt: 'test' },
      })

      const exec = store.createExecution(trigger.id, { status: 'completed' })
      expect(store.getExecution(exec.id)).not.toBeNull()

      store.delete(trigger.id)
      expect(store.getExecution(exec.id)).toBeNull()
    })
  })

  describe('deleteByName', () => {
    it('deletes by name', () => {
      store.create({
        name: 'Named',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_config: { prompt: 'test' },
      })

      expect(store.deleteByName('Named')).toBe(true)
      expect(store.getByName('Named')).toBeNull()
    })
  })

  // ─── Runtime state helpers ──────────────────────────────────────────────

  describe('markRun', () => {
    it('updates last_run_at and next_run_at', () => {
      const trigger = store.create({
        name: 'Markable',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *', timezone: 'UTC' },
        action_config: { prompt: 'test' },
      })

      const marked = store.markRun(trigger.id, 'sess-123')
      expect(marked!.last_run_at).toBeTruthy()
      expect(marked!.next_run_at).toBeTruthy()
    })
  })

  describe('recordEvent', () => {
    it('increments event_count and sets last_event_at', () => {
      const trigger = store.create({
        name: 'Eventful',
        source_type: 'webhook',
        source_config: { path: '/test' },
        action_config: { prompt: 'test' },
      })

      expect(trigger.event_count).toBe(0)

      const updated1 = store.recordEvent(trigger.id)
      expect(updated1!.event_count).toBe(1)
      expect(updated1!.last_event_at).toBeTruthy()

      const updated2 = store.recordEvent(trigger.id)
      expect(updated2!.event_count).toBe(2)
    })
  })

  // ─── Execution CRUD ─────────────────────────────────────────────────────

  describe('executions', () => {
    let triggerId: string

    beforeEach(() => {
      const trigger = store.create({
        name: 'Exec Test',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_config: { prompt: 'test' },
      })
      triggerId = trigger.id
    })

    it('creates an execution record', () => {
      const exec = store.createExecution(triggerId, { status: 'running', metadata: { manual: true } })

      expect(exec.id).toBeTruthy()
      expect(exec.trigger_id).toBe(triggerId)
      expect(exec.status).toBe('running')
      expect(exec.started_at).toBeTruthy()
    })

    it('updates an execution record', () => {
      const exec = store.createExecution(triggerId, { status: 'running' })

      const updated = store.updateExecution(exec.id, {
        status: 'completed',
        session_id: 'sess-456',
        completed_at: new Date().toISOString(),
        duration_ms: 1234,
      })

      expect(updated!.status).toBe('completed')
      expect(updated!.session_id).toBe('sess-456')
      expect(updated!.duration_ms).toBe(1234)
    })

    it('updates execution with command action fields', () => {
      const exec = store.createExecution(triggerId)

      const updated = store.updateExecution(exec.id, {
        status: 'completed',
        stdout: 'hello world\n',
        stderr: '',
        exit_code: 0,
        completed_at: new Date().toISOString(),
        duration_ms: 50,
      })

      expect(updated!.stdout).toBe('hello world\n')
      expect(updated!.exit_code).toBe(0)
    })

    it('updates execution with http action fields', () => {
      const exec = store.createExecution(triggerId)

      const updated = store.updateExecution(exec.id, {
        status: 'completed',
        http_status: 200,
        http_body: '{"ok": true}',
        completed_at: new Date().toISOString(),
        duration_ms: 100,
      })

      expect(updated!.http_status).toBe(200)
      expect(updated!.http_body).toBe('{"ok": true}')
    })

    it('lists executions with pagination', () => {
      for (let i = 0; i < 5; i++) {
        store.createExecution(triggerId, { status: 'completed' })
      }

      const page1 = store.listExecutions({ triggerId, limit: 2, offset: 0 })
      expect(page1.data).toHaveLength(2)
      expect(page1.total).toBe(5)

      const page2 = store.listExecutions({ triggerId, limit: 2, offset: 2 })
      expect(page2.data).toHaveLength(2)

      const page3 = store.listExecutions({ triggerId, limit: 2, offset: 4 })
      expect(page3.data).toHaveLength(1)
    })
  })
})
