/**
 * Unit tests for TriggerYaml — YAML ↔ DB reconciler.
 * Tests read, write, sync, write-through, self-trigger suppression.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { TriggerStore } from '../../triggers/src/trigger-store'
import { TriggerYaml } from '../../triggers/src/trigger-yaml'

describe('TriggerYaml', () => {
  let tempDir: string
  let store: TriggerStore
  let yamlSync: TriggerYaml

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'trigger-yaml-test-'))
    mkdirSync(join(tempDir, '.kortix'), { recursive: true })
    store = new TriggerStore(join(tempDir, '.kortix', 'test.db'))
    yamlSync = new TriggerYaml(store, tempDir)
  })

  afterEach(() => {
    yamlSync.stopWatching()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ─── Read ───────────────────────────────────────────────────────────────

  describe('read', () => {
    it('returns empty when no file exists', () => {
      const result = yamlSync.read()
      expect(result.triggers).toHaveLength(0)
    })

    it('parses a valid YAML file', () => {
      writeFileSync(join(tempDir, '.kortix', 'triggers.yaml'), `
triggers:
  - name: "Daily Report"
    source:
      type: cron
      cron_expr: "0 0 9 * * *"
      timezone: UTC
    action:
      type: prompt
      prompt: "Generate the daily report"
      agent: kortix

  - name: "Deploy Hook"
    source:
      type: webhook
      path: "/hooks/deploy"
      method: POST
      secret: mysecret
    action:
      type: command
      command: "bash"
      args: ["-c", "./deploy.sh"]
`)

      const result = yamlSync.read()
      expect(result.triggers).toHaveLength(2)

      expect(result.triggers[0].name).toBe('Daily Report')
      expect(result.triggers[0].source.type).toBe('cron')
      expect(result.triggers[0].source.cron_expr).toBe('0 0 9 * * *')
      expect(result.triggers[0].action.type).toBe('prompt')
      expect(result.triggers[0].action.prompt).toBe('Generate the daily report')
      expect(result.triggers[0].action.agent).toBe('kortix')

      expect(result.triggers[1].name).toBe('Deploy Hook')
      expect(result.triggers[1].source.type).toBe('webhook')
      expect(result.triggers[1].source.path).toBe('/hooks/deploy')
      expect(result.triggers[1].source.secret).toBe('mysecret')
      expect(result.triggers[1].action.type).toBe('command')
      expect(result.triggers[1].action.command).toBe('bash')
    })

    it('skips invalid entries (missing name)', () => {
      writeFileSync(join(tempDir, '.kortix', 'triggers.yaml'), `
triggers:
  - source:
      type: cron
      cron_expr: "0 0 9 * * *"
    action:
      type: prompt
      prompt: "No name"
  - name: "Valid"
    source:
      type: cron
      cron_expr: "0 0 9 * * *"
    action:
      type: prompt
      prompt: "Has name"
`)

      const result = yamlSync.read()
      expect(result.triggers).toHaveLength(1)
      expect(result.triggers[0].name).toBe('Valid')
    })

    it('handles malformed YAML gracefully', () => {
      writeFileSync(join(tempDir, '.kortix', 'triggers.yaml'), '{{{{invalid yaml')
      const result = yamlSync.read()
      expect(result.triggers).toHaveLength(0)
    })
  })

  // ─── Write ──────────────────────────────────────────────────────────────

  describe('write', () => {
    it('writes a YAML file', () => {
      yamlSync.write({
        triggers: [
          {
            name: 'Test',
            source: { type: 'cron', cron_expr: '0 0 9 * * *', timezone: 'UTC' },
            action: { type: 'prompt', prompt: 'test prompt' },
          },
        ],
      })

      const content = readFileSync(join(tempDir, '.kortix', 'triggers.yaml'), 'utf8')
      expect(content).toContain('Test')
      expect(content).toContain('cron_expr')
      expect(content).toContain('test prompt')
    })

    it('writes header comments', () => {
      yamlSync.write({ triggers: [] })
      const content = readFileSync(join(tempDir, '.kortix', 'triggers.yaml'), 'utf8')
      expect(content).toContain('source of truth')
      expect(content).toContain('git commit')
    })
  })

  // ─── Sync: YAML → DB ──────────────────────────────────────────────────

  describe('syncFromYaml', () => {
    it('creates DB entries from YAML', () => {
      writeFileSync(join(tempDir, '.kortix', 'triggers.yaml'), `
triggers:
  - name: "From YAML"
    source:
      type: cron
      cron_expr: "0 0 9 * * *"
    action:
      type: prompt
      prompt: "test"
`)

      const result = yamlSync.syncFromYaml()
      expect(result.created).toBe(1)
      expect(result.updated).toBe(0)
      expect(result.removed).toBe(0)

      const dbTrigger = store.getByName('From YAML')
      expect(dbTrigger).not.toBeNull()
      expect(dbTrigger!.source_type).toBe('cron')
    })

    it('updates existing DB entries from YAML', () => {
      // Create in DB first
      store.create({
        name: 'Existing',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_config: { prompt: 'old prompt' },
      })

      // Write YAML with updated prompt
      writeFileSync(join(tempDir, '.kortix', 'triggers.yaml'), `
triggers:
  - name: "Existing"
    source:
      type: cron
      cron_expr: "0 0 10 * * *"
    action:
      type: prompt
      prompt: "new prompt"
`)

      const result = yamlSync.syncFromYaml()
      expect(result.created).toBe(0)
      expect(result.updated).toBe(1)

      const dbTrigger = store.getByName('Existing')!
      const ac = JSON.parse(dbTrigger.action_config)
      expect(ac.prompt).toBe('new prompt')
    })

    it('preserves runtime state on update', () => {
      // Create and set runtime state
      const created = store.create({
        name: 'Runtime',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_config: { prompt: 'test' },
      })
      store.update(created.id, { is_active: false, last_run_at: '2026-01-01T00:00:00Z' })

      // Sync from YAML (config change only)
      writeFileSync(join(tempDir, '.kortix', 'triggers.yaml'), `
triggers:
  - name: "Runtime"
    source:
      type: cron
      cron_expr: "0 0 10 * * *"
    action:
      type: prompt
      prompt: "updated"
`)

      yamlSync.syncFromYaml()

      const dbTrigger = store.getByName('Runtime')!
      // Config updated
      const sc = JSON.parse(dbTrigger.source_config)
      expect(sc.cron_expr).toBe('0 0 10 * * *')
      // Runtime state PRESERVED
      expect(dbTrigger.is_active).toBe(0) // still paused
      expect(dbTrigger.last_run_at).toBe('2026-01-01T00:00:00Z')
    })

    it('removes DB entries not in YAML', () => {
      store.create({
        name: 'Orphan',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *' },
        action_config: { prompt: 'test' },
      })

      writeFileSync(join(tempDir, '.kortix', 'triggers.yaml'), `triggers: []`)

      const result = yamlSync.syncFromYaml()
      expect(result.removed).toBe(1)
      expect(store.getByName('Orphan')).toBeNull()
    })

    it('handles multiple triggers in one sync', () => {
      writeFileSync(join(tempDir, '.kortix', 'triggers.yaml'), `
triggers:
  - name: "A"
    source: { type: cron, cron_expr: "0 0 9 * * *" }
    action: { type: prompt, prompt: "a" }
  - name: "B"
    source: { type: webhook, path: "/hooks/b" }
    action: { type: command, command: "echo", args: ["hello"] }
  - name: "C"
    source: { type: cron, cron_expr: "0 0 2 * * *" }
    action: { type: http, url: "https://example.com", method: POST }
`)

      const result = yamlSync.syncFromYaml()
      expect(result.created).toBe(3)
      expect(store.list()).toHaveLength(3)

      const b = store.getByName('B')!
      expect(b.source_type).toBe('webhook')
      expect(b.action_type).toBe('command')

      const c = store.getByName('C')!
      expect(c.action_type).toBe('http')
    })
  })

  // ─── Write-through: DB → YAML ─────────────────────────────────────────

  describe('writeThrough / flushToYaml', () => {
    it('flushes current DB state to YAML', () => {
      store.create({
        name: 'DB Trigger',
        source_type: 'cron',
        source_config: { cron_expr: '0 0 9 * * *', timezone: 'UTC' },
        action_type: 'prompt',
        action_config: { prompt: 'from DB' },
        agent_name: 'kortix',
      })

      yamlSync.flushToYaml()

      const content = readFileSync(join(tempDir, '.kortix', 'triggers.yaml'), 'utf8')
      expect(content).toContain('DB Trigger')
      expect(content).toContain('from DB')
    })

    it('round-trips: DB → YAML → DB', () => {
      // Create in DB
      store.create({
        name: 'Roundtrip',
        source_type: 'webhook',
        source_config: { path: '/hooks/rt', method: 'POST', secret: 'sec' },
        action_type: 'command',
        action_config: { command: 'bash', args: ['-c', 'echo hi'] },
      })

      // Flush to YAML
      yamlSync.flushToYaml()

      // Clear DB
      store.deleteByName('Roundtrip')
      expect(store.getByName('Roundtrip')).toBeNull()

      // Create a fresh TriggerYaml instance to reset the hash
      // (simulates: different process / reboot reading the same YAML)
      const freshSync = new TriggerYaml(store, tempDir)

      // Sync back from YAML
      const result = freshSync.syncFromYaml()
      expect(result.created).toBe(1)

      const rt = store.getByName('Roundtrip')!
      expect(rt.source_type).toBe('webhook')
      expect(rt.action_type).toBe('command')
      const sc = JSON.parse(rt.source_config)
      expect(sc.path).toBe('/hooks/rt')
    })
  })

  // ─── Self-trigger suppression ─────────────────────────────────────────

  describe('self-trigger suppression', () => {
    it('skips sync when hash matches (our own write)', () => {
      writeFileSync(join(tempDir, '.kortix', 'triggers.yaml'), `
triggers:
  - name: "First"
    source: { type: cron, cron_expr: "0 0 9 * * *" }
    action: { type: prompt, prompt: "first" }
`)

      // First sync
      const result1 = yamlSync.syncFromYaml()
      expect(result1.created).toBe(1)

      // Second sync (same file) — should skip
      const result2 = yamlSync.syncFromYaml()
      expect(result2.created).toBe(0)
      expect(result2.updated).toBe(0)
      expect(result2.removed).toBe(0)
    })

    it('syncs when file actually changes', () => {
      writeFileSync(join(tempDir, '.kortix', 'triggers.yaml'), `
triggers:
  - name: "Original"
    source: { type: cron, cron_expr: "0 0 9 * * *" }
    action: { type: prompt, prompt: "original" }
`)

      yamlSync.syncFromYaml()

      // Change the file
      writeFileSync(join(tempDir, '.kortix', 'triggers.yaml'), `
triggers:
  - name: "Changed"
    source: { type: cron, cron_expr: "0 0 10 * * *" }
    action: { type: prompt, prompt: "changed" }
`)

      const result = yamlSync.syncFromYaml()
      expect(result.created).toBe(1) // "Changed" created
      expect(result.removed).toBe(1) // "Original" removed
    })
  })
})
