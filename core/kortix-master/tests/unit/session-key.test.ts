/**
 * Unit tests for the session_key feature in the trigger system.
 *
 * session_key allows dynamic session reuse keys based on extracted webhook values.
 * E.g. "telegram:user:{{ user_id }}" → each Telegram user gets their own persistent session.
 *
 * Tests cover:
 *   - Backward compat: no session_key → falls back to "trigger:{name}"
 *   - Template rendering with extracted values
 *   - Different values → different sessions
 *   - Same values → same session (reuse)
 *   - YAML round-trip
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
        return { data: { id: `sess-${calls.filter(c => c.type === 'create').length}` } }
      },
      promptAsync: async (params) => {
        calls.push({ type: 'promptAsync', args: params })
        return {}
      },
    },
  }
}

describe('session_key in prompt-action', () => {
  let tempDir: string
  let store: TriggerStore
  let mockClient: ReturnType<typeof createMockClient>
  let dispatcher: ActionDispatcher

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-key-test-'))
    store = new TriggerStore(join(tempDir, 'test.db'))
    mockClient = createMockClient()
    dispatcher = new ActionDispatcher(store, mockClient, tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('uses "trigger:<name>" when session_key is not set (backward compat)', async () => {
    const trigger = store.create({
      name: 'no-session-key',
      source_type: 'webhook',
      source_config: { path: '/hooks/test' },
      action_type: 'prompt',
      action_config: { prompt: 'Hello {{ name }}' },
      context_config: { extract: { name: 'data.body.name' } },
      session_mode: 'reuse',
    })

    // Two dispatches with different data → same session (keyed on trigger name)
    await dispatcher.dispatch(trigger.id, {
      type: 'webhook.request', manual: false, timestamp: new Date().toISOString(),
      data: { body: { name: 'Alice' } },
    })
    await dispatcher.dispatch(trigger.id, {
      type: 'webhook.request', manual: false, timestamp: new Date().toISOString(),
      data: { body: { name: 'Bob' } },
    })

    // Only 1 session.create (second reuses)
    const creates = mockClient.calls.filter(c => c.type === 'create')
    expect(creates).toHaveLength(1)

    // Both prompts sent to the same session
    const prompts = mockClient.calls.filter(c => c.type === 'promptAsync')
    expect(prompts).toHaveLength(2)
    expect(prompts[0].args.path.id).toBe(prompts[1].args.path.id)
  })

  it('renders session_key template with extracted values', async () => {
    const trigger = store.create({
      name: 'telegram-inbound',
      source_type: 'webhook',
      source_config: { path: '/hooks/telegram' },
      action_type: 'prompt',
      action_config: { prompt: 'Message from {{ user_name }}: {{ text }}' },
      context_config: {
        extract: {
          user_id: 'data.body.message.from.id',
          user_name: 'data.body.message.from.first_name',
          text: 'data.body.message.text',
        },
        session_key: 'telegram:user:{{ user_id }}',
      },
      session_mode: 'reuse',
    })

    await dispatcher.dispatch(trigger.id, {
      type: 'webhook.request', manual: false, timestamp: new Date().toISOString(),
      data: { body: { message: { from: { id: 123, first_name: 'Marko' }, text: 'hello' } } },
    })

    // Session was created — verify prompt was sent
    const prompts = mockClient.calls.filter(c => c.type === 'promptAsync')
    expect(prompts).toHaveLength(1)
    expect(prompts[0].args.body.parts[0].text).toContain('Message from Marko: hello')
  })

  it('different extracted values produce different reuse keys (different sessions)', async () => {
    const trigger = store.create({
      name: 'telegram-multi-user',
      source_type: 'webhook',
      source_config: { path: '/hooks/tg' },
      action_type: 'prompt',
      action_config: { prompt: '{{ text }}' },
      context_config: {
        extract: { user_id: 'data.body.from_id', text: 'data.body.text' },
        session_key: 'tg:user:{{ user_id }}',
      },
      session_mode: 'reuse',
    })

    // User A
    await dispatcher.dispatch(trigger.id, {
      type: 'webhook.request', manual: false, timestamp: new Date().toISOString(),
      data: { body: { from_id: '111', text: 'hi from A' } },
    })
    // User B
    await dispatcher.dispatch(trigger.id, {
      type: 'webhook.request', manual: false, timestamp: new Date().toISOString(),
      data: { body: { from_id: '222', text: 'hi from B' } },
    })

    // 2 creates (different users → different sessions)
    const creates = mockClient.calls.filter(c => c.type === 'create')
    expect(creates).toHaveLength(2)

    // Verify prompts sent to different sessions
    const prompts = mockClient.calls.filter(c => c.type === 'promptAsync')
    expect(prompts[0].args.path.id).not.toBe(prompts[1].args.path.id)
  })

  it('same extracted values reuse the same session', async () => {
    const trigger = store.create({
      name: 'telegram-same-user',
      source_type: 'webhook',
      source_config: { path: '/hooks/tg2' },
      action_type: 'prompt',
      action_config: { prompt: '{{ text }}' },
      context_config: {
        extract: { user_id: 'data.body.from_id', text: 'data.body.text' },
        session_key: 'tg:user:{{ user_id }}',
      },
      session_mode: 'reuse',
    })

    // Same user, two messages
    await dispatcher.dispatch(trigger.id, {
      type: 'webhook.request', manual: false, timestamp: new Date().toISOString(),
      data: { body: { from_id: '111', text: 'first message' } },
    })
    await dispatcher.dispatch(trigger.id, {
      type: 'webhook.request', manual: false, timestamp: new Date().toISOString(),
      data: { body: { from_id: '111', text: 'second message' } },
    })

    // Only 1 create (reused)
    const creates = mockClient.calls.filter(c => c.type === 'create')
    expect(creates).toHaveLength(1)

    // Both go to same session
    const prompts = mockClient.calls.filter(c => c.type === 'promptAsync')
    expect(prompts[0].args.path.id).toBe(prompts[1].args.path.id)
  })

  it('ignores session_key when session_mode is "new"', async () => {
    const trigger = store.create({
      name: 'always-new',
      source_type: 'webhook',
      source_config: { path: '/hooks/new' },
      action_type: 'prompt',
      action_config: { prompt: '{{ text }}' },
      context_config: {
        extract: { user_id: 'data.body.from_id', text: 'data.body.text' },
        session_key: 'tg:user:{{ user_id }}',
      },
      session_mode: 'new',
    })

    // Same user, two messages, but session_mode=new
    await dispatcher.dispatch(trigger.id, {
      type: 'webhook.request', manual: false, timestamp: new Date().toISOString(),
      data: { body: { from_id: '111', text: 'msg 1' } },
    })
    await dispatcher.dispatch(trigger.id, {
      type: 'webhook.request', manual: false, timestamp: new Date().toISOString(),
      data: { body: { from_id: '111', text: 'msg 2' } },
    })

    // 2 creates (new session each time)
    const creates = mockClient.calls.filter(c => c.type === 'create')
    expect(creates).toHaveLength(2)
  })
})

describe('session_key in trigger-yaml', () => {
  let tempDir: string
  let store: TriggerStore

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-key-yaml-'))
    store = new TriggerStore(join(tempDir, 'test.db'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('stores and retrieves session_key from context_config', () => {
    const trigger = store.create({
      name: 'yaml-session-key',
      source_type: 'webhook',
      source_config: { path: '/hooks/test' },
      action_type: 'prompt',
      action_config: { prompt: 'test' },
      context_config: {
        extract: { user_id: 'data.body.user' },
        session_key: 'custom:{{ user_id }}',
      },
    })

    const retrieved = store.get(trigger.id)
    expect(retrieved).toBeTruthy()
    const ctx = JSON.parse(retrieved!.context_config || '{}')
    expect(ctx.session_key).toBe('custom:{{ user_id }}')
  })

  it('omits session_key when not set', () => {
    const trigger = store.create({
      name: 'no-sk',
      source_type: 'webhook',
      source_config: { path: '/hooks/test2' },
      action_type: 'prompt',
      action_config: { prompt: 'test' },
      context_config: { extract: { x: 'data.body.x' } },
    })

    const retrieved = store.get(trigger.id)
    const ctx = JSON.parse(retrieved!.context_config || '{}')
    expect(ctx.session_key).toBeUndefined()
  })
})
