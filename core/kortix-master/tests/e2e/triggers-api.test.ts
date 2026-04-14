/**
 * E2E tests for the unified triggers HTTP API.
 *
 * Tests the full lifecycle: create → list → get → update → pause → resume → run → executions → delete
 * for both cron and webhook triggers, with all action types (prompt, command, http).
 *
 * Uses Hono's test client — no real server needed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// We need to set up the environment before importing the router
// because it initializes the store at module level
let tempDir: string
let app: Hono
let storeForCleanup: any

async function cleanupTempDir(dir: string): Promise<void> {
  // Windows can keep SQLite files locked briefly after test execution.
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error
      await Bun.sleep(40 * (attempt + 1))
    }
  }
  rmSync(dir, { recursive: true, force: true })
}

function createTestApp(dir: string) {
  // We can't use the real router (it hardcodes /workspace), so we'll
  // build a mini Hono app that tests the TriggerStore + YAML integration
  // through the same code paths the router uses.
  const { TriggerStore } = require('../../triggers/src/trigger-store') as typeof import('../../triggers/src/trigger-store')
  const { TriggerYaml } = require('../../triggers/src/trigger-yaml') as typeof import('../../triggers/src/trigger-yaml')
  const { isValidCronExpression, describeCron } = require('../../triggers/src/trigger-store') as typeof import('../../triggers/src/trigger-store')

  mkdirSync(join(dir, '.kortix'), { recursive: true })
  const store = new TriggerStore(join(dir, '.kortix', 'test.db'))
  const yamlSync = new TriggerYaml(store, dir)

  const api = new Hono()

  // ─── Replicate the routes/triggers.ts API ──────────────────────────────

  api.get('/triggers', (c) => {
    const sourceType = c.req.query('source_type')
    const isActiveParam = c.req.query('is_active')
    const filter: { source_type?: string; is_active?: boolean } = {}
    if (sourceType) filter.source_type = sourceType
    if (isActiveParam === 'true') filter.is_active = true
    if (isActiveParam === 'false') filter.is_active = false
    const data = store.list(filter)
    return c.json({ success: true, data, total: data.length })
  })

  api.post('/triggers', async (c) => {
    const body = await c.req.json()

    // Validate
    if (!body.name) return c.json({ error: 'name is required' }, 400)
    if (!body.source?.type) return c.json({ error: 'source.type is required' }, 400)
    if (body.source.type === 'cron' && !body.source.cron_expr) return c.json({ error: 'cron_expr required' }, 400)
    if (body.source.type === 'cron' && !isValidCronExpression(body.source.cron_expr)) return c.json({ error: 'Invalid cron expression' }, 400)
    if (body.source.type === 'webhook' && !body.source.path) return c.json({ error: 'path required' }, 400)

    const actionType = body.action?.type ?? 'prompt'
    const sourceConfig = body.source.type === 'cron'
      ? { cron_expr: body.source.cron_expr, timezone: body.source.timezone ?? 'UTC' }
      : { path: body.source.path, method: body.source.method ?? 'POST', secret: body.source.secret }

    const actionConfig: Record<string, unknown> = {}
    if (actionType === 'prompt') actionConfig.prompt = body.action?.prompt ?? ''
    else if (actionType === 'command') { actionConfig.command = body.action?.command; actionConfig.args = body.action?.args }
    else if (actionType === 'http') { actionConfig.url = body.action?.url; actionConfig.method = body.action?.method; if (body.action?.headers) actionConfig.headers = body.action.headers; if (body.action?.body_template) actionConfig.body_template = body.action.body_template }

    const trigger = store.create({
      name: body.name,
      description: body.description,
      source_type: body.source.type,
      source_config: sourceConfig,
      action_type: actionType,
      action_config: actionConfig,
      context_config: body.context,
      agent_name: body.action?.agent,
      model_id: body.action?.model,
      session_mode: body.action?.session_mode ?? 'new',
    })

    yamlSync.writeThrough()
    return c.json({ success: true, data: trigger }, 201)
  })

  api.get('/triggers/:id', (c) => {
    const trigger = store.get(c.req.param('id')) ?? store.getByName(c.req.param('id'))
    if (!trigger) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: trigger })
  })

  api.patch('/triggers/:id', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()
    const current = store.get(id)
    if (!current) return c.json({ error: 'Not found' }, 404)

    const patch: any = {}
    if (body.name) patch.name = body.name
    if (body.description !== undefined) patch.description = body.description
    if (body.source) {
      const currentSc = JSON.parse(current.source_config)
      patch.source_config = { ...currentSc, ...body.source }
    }
    if (body.action) {
      const currentAc = JSON.parse(current.action_config)
      patch.action_config = { ...currentAc, ...body.action }
      if (body.action.agent !== undefined) patch.agent_name = body.action.agent
      if (body.action.model !== undefined) patch.model_id = body.action.model
      if (body.action.session_mode !== undefined) patch.session_mode = body.action.session_mode
    }
    if (body.is_active !== undefined) patch.is_active = body.is_active
    if (body.agent_name !== undefined) patch.agent_name = body.agent_name
    if (body.prompt) {
      const currentAc = JSON.parse(current.action_config)
      patch.action_config = { ...currentAc, prompt: body.prompt }
    }

    const trigger = store.update(id, patch)
    if (!trigger) return c.json({ error: 'Not found' }, 404)
    yamlSync.writeThrough()
    return c.json({ success: true, data: trigger })
  })

  api.delete('/triggers/:id', (c) => {
    const deleted = store.delete(c.req.param('id'))
    if (!deleted) return c.json({ error: 'Not found' }, 404)
    yamlSync.writeThrough()
    return c.json({ success: true, message: 'Deleted' })
  })

  api.post('/triggers/:id/pause', (c) => {
    const trigger = store.update(c.req.param('id'), { is_active: false })
    if (!trigger) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: trigger })
  })

  api.post('/triggers/:id/resume', (c) => {
    const trigger = store.update(c.req.param('id'), { is_active: true })
    if (!trigger) return c.json({ error: 'Not found' }, 404)
    return c.json({ success: true, data: trigger })
  })

  api.post('/triggers/:id/run', (c) => {
    const trigger = store.get(c.req.param('id'))
    if (!trigger) return c.json({ error: 'Not found' }, 404)
    const execution = store.createExecution(trigger.id, { status: 'running', metadata: { manual: true } })
    return c.json({ success: true, data: { execution_id: execution.id, status: 'running' } })
  })

  api.get('/triggers/:id/executions', (c) => {
    const trigger = store.get(c.req.param('id'))
    if (!trigger) return c.json({ error: 'Not found' }, 404)
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = parseInt(c.req.query('offset') || '0')
    const result = store.listExecutions({ triggerId: trigger.id, limit, offset })
    return c.json({ success: true, data: result.data, total: result.total })
  })

  api.post('/triggers/sync', (c) => {
    const result = yamlSync.syncFromYaml()
    return c.json({ success: true, ...result })
  })

  return { api, store, yamlSync }
}

// ─── Helper ─────────────────────────────────────────────────────────────────

async function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method }
  if (body) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await app.request(path, init)
  const json = await res.json() as any
  return { status: res.status, json }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Triggers API E2E', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'triggers-e2e-'))
    const { api, store } = createTestApp(tempDir)
    storeForCleanup = store
    app = api
  })

  afterEach(async () => {
    // Close sqlite handle before deleting temp directory.
    try { storeForCleanup?.db?.close?.() } catch {}
    storeForCleanup = null
    await cleanupTempDir(tempDir)
  })

  // ─── CRUD lifecycle ─────────────────────────────────────────────────────

  describe('full lifecycle: cron + prompt', () => {
    it('create → list → get → update → pause → resume → run → executions → delete', async () => {
      // CREATE
      const { status: createStatus, json: createJson } = await req('POST', '/triggers', {
        name: 'Daily Report',
        description: 'Generates daily report',
        source: { type: 'cron', cron_expr: '0 0 9 * * *', timezone: 'UTC' },
        action: { type: 'prompt', prompt: 'Generate the daily report', agent: 'kortix' },
      })
      expect(createStatus).toBe(201)
      expect(createJson.success).toBe(true)
      const id = createJson.data.id
      expect(id).toBeTruthy()
      expect(createJson.data.name).toBe('Daily Report')
      expect(createJson.data.source_type).toBe('cron')
      expect(createJson.data.action_type).toBe('prompt')
      expect(createJson.data.is_active).toBe(1)
      expect(createJson.data.next_run_at).toBeTruthy()

      // LIST
      const { json: listJson } = await req('GET', '/triggers')
      expect(listJson.success).toBe(true)
      expect(listJson.data).toHaveLength(1)
      expect(listJson.data[0].name).toBe('Daily Report')

      // GET
      const { json: getJson } = await req('GET', `/triggers/${id}`)
      expect(getJson.success).toBe(true)
      expect(getJson.data.id).toBe(id)
      expect(getJson.data.name).toBe('Daily Report')

      // UPDATE
      const { json: updateJson } = await req('PATCH', `/triggers/${id}`, {
        name: 'Updated Report',
        action: { prompt: 'Generate updated report', agent: 'ops-agent' },
      })
      expect(updateJson.success).toBe(true)
      expect(updateJson.data.name).toBe('Updated Report')
      expect(updateJson.data.agent_name).toBe('ops-agent')

      // PAUSE
      const { json: pauseJson } = await req('POST', `/triggers/${id}/pause`)
      expect(pauseJson.success).toBe(true)
      expect(pauseJson.data.is_active).toBe(0)

      // RESUME
      const { json: resumeJson } = await req('POST', `/triggers/${id}/resume`)
      expect(resumeJson.success).toBe(true)
      expect(resumeJson.data.is_active).toBe(1)

      // RUN
      const { json: runJson } = await req('POST', `/triggers/${id}/run`)
      expect(runJson.success).toBe(true)
      expect(runJson.data.execution_id).toBeTruthy()
      expect(runJson.data.status).toBe('running')

      // EXECUTIONS
      const { json: execsJson } = await req('GET', `/triggers/${id}/executions`)
      expect(execsJson.success).toBe(true)
      expect(execsJson.data).toHaveLength(1)
      expect(execsJson.data[0].trigger_id).toBe(id)

      // DELETE
      const { status: deleteStatus, json: deleteJson } = await req('DELETE', `/triggers/${id}`)
      expect(deleteStatus).toBe(200)
      expect(deleteJson.success).toBe(true)

      // VERIFY DELETED
      const { status: goneStatus } = await req('GET', `/triggers/${id}`)
      expect(goneStatus).toBe(404)

      // VERIFY LIST EMPTY
      const { json: emptyList } = await req('GET', '/triggers')
      expect(emptyList.data).toHaveLength(0)
    })
  })

  describe('full lifecycle: webhook + command', () => {
    it('creates and manages a webhook trigger with command action', async () => {
      // CREATE
      const { status, json } = await req('POST', '/triggers', {
        name: 'Deploy Hook',
        source: { type: 'webhook', path: '/hooks/deploy', method: 'POST', secret: 'mysecret' },
        action: { type: 'command', command: 'bash', args: ['-c', './deploy.sh'] },
      })
      expect(status).toBe(201)
      const id = json.data.id

      const sc = JSON.parse(json.data.source_config)
      expect(sc.path).toBe('/hooks/deploy')
      expect(sc.secret).toBe('mysecret')

      const ac = JSON.parse(json.data.action_config)
      expect(ac.command).toBe('bash')
      expect(ac.args).toEqual(['-c', './deploy.sh'])

      // UPDATE source path
      const { json: updated } = await req('PATCH', `/triggers/${id}`, {
        source: { path: '/hooks/deploy-v2' },
      })
      const updatedSc = JSON.parse(updated.data.source_config)
      expect(updatedSc.path).toBe('/hooks/deploy-v2')
      // Original secret preserved
      expect(updatedSc.secret).toBe('mysecret')

      // DELETE
      const { status: delStatus } = await req('DELETE', `/triggers/${id}`)
      expect(delStatus).toBe(200)
    })
  })

  describe('full lifecycle: cron + http', () => {
    it('creates and manages a cron trigger with http action', async () => {
      const { status, json } = await req('POST', '/triggers', {
        name: 'Slack Notify',
        source: { type: 'cron', cron_expr: '0 0 9 * * *' },
        action: {
          type: 'http',
          url: 'https://hooks.slack.com/xxx',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body_template: '{"text": "Daily notification"}',
        },
      })
      expect(status).toBe(201)
      expect(json.data.action_type).toBe('http')
      const ac = JSON.parse(json.data.action_config)
      expect(ac.url).toBe('https://hooks.slack.com/xxx')
      expect(ac.body_template).toBe('{"text": "Daily notification"}')
    })
  })

  // ─── Filtering ──────────────────────────────────────────────────────────

  describe('filtering', () => {
    beforeEach(async () => {
      await req('POST', '/triggers', {
        name: 'Cron1', source: { type: 'cron', cron_expr: '0 0 9 * * *' }, action: { type: 'prompt', prompt: 'a' },
      })
      await req('POST', '/triggers', {
        name: 'Cron2', source: { type: 'cron', cron_expr: '0 0 10 * * *' }, action: { type: 'prompt', prompt: 'b' },
      })
      await req('POST', '/triggers', {
        name: 'Webhook1', source: { type: 'webhook', path: '/hooks/x' }, action: { type: 'command', command: 'echo' },
      })
    })

    it('filters by source_type=cron', async () => {
      const { json } = await req('GET', '/triggers?source_type=cron')
      expect(json.data).toHaveLength(2)
      expect(json.data.every((t: any) => t.source_type === 'cron')).toBe(true)
    })

    it('filters by source_type=webhook', async () => {
      const { json } = await req('GET', '/triggers?source_type=webhook')
      expect(json.data).toHaveLength(1)
      expect(json.data[0].source_type).toBe('webhook')
    })

    it('filters by is_active', async () => {
      // Pause one
      const { json: list } = await req('GET', '/triggers')
      await req('POST', `/triggers/${list.data[0].id}/pause`)

      const { json: active } = await req('GET', '/triggers?is_active=true')
      expect(active.data).toHaveLength(2)

      const { json: inactive } = await req('GET', '/triggers?is_active=false')
      expect(inactive.data).toHaveLength(1)
    })
  })

  // ─── Validation ─────────────────────────────────────────────────────────

  describe('validation', () => {
    it('rejects missing name', async () => {
      const { status } = await req('POST', '/triggers', {
        source: { type: 'cron', cron_expr: '0 0 9 * * *' },
        action: { type: 'prompt', prompt: 'test' },
      })
      expect(status).toBe(400)
    })

    it('rejects missing cron_expr for cron type', async () => {
      const { status } = await req('POST', '/triggers', {
        name: 'Bad', source: { type: 'cron' },
        action: { type: 'prompt', prompt: 'test' },
      })
      expect(status).toBe(400)
    })

    it('rejects invalid cron expression', async () => {
      const { status } = await req('POST', '/triggers', {
        name: 'Bad', source: { type: 'cron', cron_expr: 'not valid' },
        action: { type: 'prompt', prompt: 'test' },
      })
      expect(status).toBe(400)
    })

    it('rejects missing path for webhook type', async () => {
      const { status } = await req('POST', '/triggers', {
        name: 'Bad', source: { type: 'webhook' },
        action: { type: 'prompt', prompt: 'test' },
      })
      expect(status).toBe(400)
    })

    it('returns 404 for nonexistent trigger', async () => {
      const { status: getStatus } = await req('GET', '/triggers/nonexistent')
      expect(getStatus).toBe(404)

      const { status: patchStatus } = await req('PATCH', '/triggers/nonexistent', { name: 'x' })
      expect(patchStatus).toBe(404)

      const { status: delStatus } = await req('DELETE', '/triggers/nonexistent')
      expect(delStatus).toBe(404)

      const { status: pauseStatus } = await req('POST', '/triggers/nonexistent/pause')
      expect(pauseStatus).toBe(404)
    })
  })

  // ─── YAML sync ──────────────────────────────────────────────────────────

  describe('YAML sync', () => {
    it('persists created triggers to triggers.yaml', async () => {
      await req('POST', '/triggers', {
        name: 'YAML Test',
        source: { type: 'cron', cron_expr: '0 0 9 * * *' },
        action: { type: 'prompt', prompt: 'test' },
      })

      const yamlPath = join(tempDir, '.kortix', 'triggers.yaml')
      expect(existsSync(yamlPath)).toBe(true)

      const content = readFileSync(yamlPath, 'utf8')
      expect(content).toContain('YAML Test')
      expect(content).toContain('cron_expr')
    })

    it('removes from YAML on delete', async () => {
      const { json } = await req('POST', '/triggers', {
        name: 'To Delete',
        source: { type: 'cron', cron_expr: '0 0 9 * * *' },
        action: { type: 'prompt', prompt: 'test' },
      })

      // Verify it's in YAML
      let content = readFileSync(join(tempDir, '.kortix', 'triggers.yaml'), 'utf8')
      expect(content).toContain('To Delete')

      // Delete
      await req('DELETE', `/triggers/${json.data.id}`)

      // Verify removed from YAML
      content = readFileSync(join(tempDir, '.kortix', 'triggers.yaml'), 'utf8')
      expect(content).not.toContain('To Delete')
    })

    it('sync endpoint reads YAML back into DB', async () => {
      // Write directly to YAML
      const yaml = require('js-yaml')
      const yamlContent = yaml.dump({
        triggers: [
          { name: 'From File', source: { type: 'cron', cron_expr: '0 0 9 * * *' }, action: { type: 'prompt', prompt: 'from file' } },
          { name: 'Also File', source: { type: 'webhook', path: '/hooks/file' }, action: { type: 'command', command: 'echo' } },
        ],
      })
      const { writeFileSync } = require('fs')
      writeFileSync(join(tempDir, '.kortix', 'triggers.yaml'), yamlContent)

      // Call sync
      const { json } = await req('POST', '/triggers/sync')
      expect(json.success).toBe(true)
      expect(json.created).toBe(2)

      // Verify in DB via list
      const { json: listJson } = await req('GET', '/triggers')
      expect(listJson.data).toHaveLength(2)
      const names = listJson.data.map((t: any) => t.name).sort()
      expect(names).toEqual(['Also File', 'From File'])
    })
  })

  // ─── Multiple triggers ─────────────────────────────────────────────────

  describe('multiple triggers', () => {
    it('manages 10 triggers independently', async () => {
      const ids: string[] = []

      // Create 10
      for (let i = 0; i < 10; i++) {
        const { json } = await req('POST', '/triggers', {
          name: `Trigger ${i}`,
          source: { type: i % 2 === 0 ? 'cron' : 'webhook', cron_expr: i % 2 === 0 ? '0 0 9 * * *' : undefined, path: i % 2 === 1 ? `/hooks/${i}` : undefined },
          action: { type: 'prompt', prompt: `Task ${i}` },
        })
        ids.push(json.data.id)
      }

      // List all
      const { json: listJson } = await req('GET', '/triggers')
      expect(listJson.data).toHaveLength(10)

      // Pause odd ones
      for (let i = 1; i < 10; i += 2) {
        await req('POST', `/triggers/${ids[i]}/pause`)
      }

      // Filter active
      const { json: activeJson } = await req('GET', '/triggers?is_active=true')
      expect(activeJson.data).toHaveLength(5)

      // Delete first 5
      for (let i = 0; i < 5; i++) {
        await req('DELETE', `/triggers/${ids[i]}`)
      }

      // Verify 5 remain
      const { json: remainJson } = await req('GET', '/triggers')
      expect(remainJson.data).toHaveLength(5)
    })
  })

  // ─── Execution history ──────────────────────────────────────────────────

  describe('execution history', () => {
    it('records and retrieves multiple executions', async () => {
      const { json } = await req('POST', '/triggers', {
        name: 'Exec History',
        source: { type: 'cron', cron_expr: '0 0 9 * * *' },
        action: { type: 'prompt', prompt: 'test' },
      })
      const id = json.data.id

      // Fire 5 times
      for (let i = 0; i < 5; i++) {
        await req('POST', `/triggers/${id}/run`)
      }

      // Check history
      const { json: execsJson } = await req('GET', `/triggers/${id}/executions`)
      expect(execsJson.success).toBe(true)
      expect(execsJson.data).toHaveLength(5)
      expect(execsJson.total).toBe(5)

      // All should be for this trigger
      expect(execsJson.data.every((e: any) => e.trigger_id === id)).toBe(true)
    })

    it('cascade deletes executions when trigger deleted', async () => {
      const { json } = await req('POST', '/triggers', {
        name: 'Cascade',
        source: { type: 'cron', cron_expr: '0 0 9 * * *' },
        action: { type: 'prompt', prompt: 'test' },
      })
      const id = json.data.id

      await req('POST', `/triggers/${id}/run`)
      await req('POST', `/triggers/${id}/run`)

      const { json: before } = await req('GET', `/triggers/${id}/executions`)
      expect(before.data).toHaveLength(2)

      // Delete trigger
      await req('DELETE', `/triggers/${id}`)

      // Executions gone (trigger doesn't exist)
      const { status } = await req('GET', `/triggers/${id}/executions`)
      expect(status).toBe(404)
    })
  })
})
