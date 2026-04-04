/**
 * Unit tests for slack.ts CLI — all commands with mocked fetch.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  slackSend,
  slackEdit,
  slackDelete,
  slackReact,
  slackHistory,
  slackThread,
  slackChannels,
  slackJoin,
  slackUsers,
  slackUser,
  slackMe,
  slackSearch,
} from '../../channels/slack'

let fetchCalls: { url: string; init: RequestInit }[] = []
let fetchResponse: any = { ok: true }
const originalFetch = globalThis.fetch

beforeEach(() => {
  fetchCalls = []
  fetchResponse = { ok: true }
  // @ts-ignore
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
    fetchCalls.push({ url: urlStr, init: init ?? {} })
    return new Response(JSON.stringify(fetchResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  process.env.SLACK_BOT_TOKEN = 'xoxb-test-token'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.SLACK_BOT_TOKEN
})

describe('slack.ts CLI', () => {
  describe('send', () => {
    it('posts to chat.postMessage with channel and text', async () => {
      fetchResponse = { ok: true, ts: '1712160000.000100', channel: 'C0AG3PJLCHH' }
      const result = await slackSend({ channel: 'C0AG3PJLCHH', text: 'hello' })
      expect(result.ok).toBe(true)
      expect(result.ts).toBe('1712160000.000100')

      expect(fetchCalls[0].url).toContain('chat.postMessage')
      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.channel).toBe('C0AG3PJLCHH')
      expect(body.text).toBe('hello')
    })

    it('includes thread_ts when set', async () => {
      fetchResponse = { ok: true, ts: '1712160050.000200' }
      await slackSend({ channel: 'C123', text: 'reply', threadTs: '1712160000.000100' })

      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.thread_ts).toBe('1712160000.000100')
    })

    it('returns error when token not set', async () => {
      delete process.env.SLACK_BOT_TOKEN
      const result = await slackSend({ channel: 'C123', text: 'hello' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('SLACK_BOT_TOKEN')
    })
  })

  describe('edit', () => {
    it('calls chat.update with correct params', async () => {
      fetchResponse = { ok: true, ts: '1712160000.000100' }
      const result = await slackEdit({ channel: 'C123', ts: '1712160000.000100', text: 'updated' })
      expect(result.ok).toBe(true)

      expect(fetchCalls[0].url).toContain('chat.update')
      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.channel).toBe('C123')
      expect(body.ts).toBe('1712160000.000100')
      expect(body.text).toBe('updated')
    })
  })

  describe('delete', () => {
    it('calls chat.delete with correct params', async () => {
      fetchResponse = { ok: true }
      const result = await slackDelete({ channel: 'C123', ts: '1712160000.000100' })
      expect(result.ok).toBe(true)

      expect(fetchCalls[0].url).toContain('chat.delete')
    })
  })

  describe('react', () => {
    it('calls reactions.add with correct emoji', async () => {
      fetchResponse = { ok: true }
      const result = await slackReact({ channel: 'C123', ts: '1712160000.000100', emoji: 'thumbsup' })
      expect(result.ok).toBe(true)

      expect(fetchCalls[0].url).toContain('reactions.add')
      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.name).toBe('thumbsup')
    })
  })

  describe('history', () => {
    it('calls conversations.history with channel and limit', async () => {
      fetchResponse = { ok: true, messages: [{ text: 'hello', ts: '123', user: 'U1' }] }
      const result = await slackHistory({ channel: 'C123', limit: 10 })
      expect(result.ok).toBe(true)
      expect(result.messages).toHaveLength(1)

      expect(fetchCalls[0].url).toContain('conversations.history')
      expect(fetchCalls[0].url).toContain('channel=C123')
      expect(fetchCalls[0].url).toContain('limit=10')
    })
  })

  describe('thread', () => {
    it('calls conversations.replies with channel and ts', async () => {
      fetchResponse = { ok: true, messages: [{ text: 'reply', ts: '456', user: 'U2' }] }
      const result = await slackThread({ channel: 'C123', ts: '1712160000.000100', limit: 5 })
      expect(result.ok).toBe(true)

      expect(fetchCalls[0].url).toContain('conversations.replies')
      expect(fetchCalls[0].url).toContain('ts=1712160000.000100')
    })
  })

  describe('channels', () => {
    it('calls conversations.list', async () => {
      fetchResponse = { ok: true, channels: [{ id: 'C123', name: 'general' }] }
      const result = await slackChannels({ limit: 50 })
      expect(result.ok).toBe(true)
      expect(result.channels).toHaveLength(1)

      expect(fetchCalls[0].url).toContain('conversations.list')
    })
  })

  describe('join', () => {
    it('calls conversations.join', async () => {
      fetchResponse = { ok: true, channel: { id: 'C123' } }
      const result = await slackJoin({ channel: 'C123' })
      expect(result.ok).toBe(true)

      expect(fetchCalls[0].url).toContain('conversations.join')
    })
  })

  describe('users', () => {
    it('calls users.list', async () => {
      fetchResponse = { ok: true, members: [{ id: 'U1', name: 'marko' }] }
      const result = await slackUsers({ limit: 50 })
      expect(result.ok).toBe(true)
      expect(result.members).toHaveLength(1)
    })
  })

  describe('user', () => {
    it('calls users.info', async () => {
      fetchResponse = { ok: true, user: { id: 'U1', name: 'marko', real_name: 'Marko' } }
      const result = await slackUser({ id: 'U1' })
      expect(result.ok).toBe(true)
      expect(result.user.name).toBe('marko')
    })
  })

  describe('me', () => {
    it('calls auth.test', async () => {
      fetchResponse = { ok: true, user_id: 'U0LAN0Z89', team: 'T1', user: 'kortix-bot' }
      const result = await slackMe()
      expect(result.ok).toBe(true)
      expect(result.user).toBe('kortix-bot')

      expect(fetchCalls[0].url).toContain('auth.test')
    })
  })

  describe('search', () => {
    it('calls search.messages with query', async () => {
      fetchResponse = { ok: true, messages: { matches: [{ text: 'found', ts: '123' }] } }
      const result = await slackSearch({ query: 'deploy' })
      expect(result.ok).toBe(true)

      expect(fetchCalls[0].url).toContain('search.messages')
      expect(fetchCalls[0].url).toContain('query=deploy')
    })
  })
})
