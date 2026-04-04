/**
 * Unit tests for telegram.ts CLI — all commands with mocked fetch.
 *
 * We test the exported handler functions directly (not subprocess spawn)
 * so we can mock fetch and verify correct API calls.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

// Import the handler functions from the CLI module
import {
  telegramSend,
  telegramEdit,
  telegramDelete,
  telegramTyping,
  telegramMe,
  telegramGetChat,
  telegramSetWebhook,
  telegramDeleteWebhook,
  telegramWebhookInfo,
  telegramGetFile,
} from '../../channels/telegram'

// ─── Fetch mock infrastructure ────────────────────────────────────────────────

type MockResponse = { ok: boolean; result?: any; description?: string }
let fetchCalls: { url: string; init: RequestInit }[] = []
let fetchResponse: MockResponse = { ok: true }

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
  // Set token in env
  process.env.TELEGRAM_BOT_TOKEN = 'test-token-123'
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.TELEGRAM_BOT_TOKEN
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('telegram.ts CLI', () => {
  describe('send', () => {
    it('sends message to correct chat_id', async () => {
      fetchResponse = { ok: true, result: { message_id: 42 } }
      const result = await telegramSend({ chat: '123456', text: 'hello' })
      expect(result.ok).toBe(true)
      expect(result.message_id).toBe(42)

      expect(fetchCalls).toHaveLength(1)
      expect(fetchCalls[0].url).toContain('/bot' + 'test-token-123' + '/sendMessage')
      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.chat_id).toBe('123456')
      expect(body.text).toBe('hello')
    })

    it('includes reply_to_message_id when replyTo is set', async () => {
      fetchResponse = { ok: true, result: { message_id: 43 } }
      await telegramSend({ chat: '123', text: 'reply', replyTo: 10 })

      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.reply_to_message_id).toBe(10)
    })

    it('returns error when API returns error', async () => {
      fetchResponse = { ok: false, description: 'chat not found' }
      const result = await telegramSend({ chat: '999', text: 'hello' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('chat not found')
    })

    it('returns error when token is not set', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN
      const result = await telegramSend({ chat: '123', text: 'hello' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('TELEGRAM_BOT_TOKEN')
    })
  })

  describe('edit', () => {
    it('calls editMessageText with correct params', async () => {
      fetchResponse = { ok: true, result: { message_id: 42 } }
      const result = await telegramEdit({ chat: '123', messageId: 42, text: 'updated' })
      expect(result.ok).toBe(true)

      expect(fetchCalls[0].url).toContain('/editMessageText')
      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.chat_id).toBe('123')
      expect(body.message_id).toBe(42)
      expect(body.text).toBe('updated')
    })
  })

  describe('delete', () => {
    it('calls deleteMessage with correct params', async () => {
      fetchResponse = { ok: true, result: true }
      const result = await telegramDelete({ chat: '123', messageId: 42 })
      expect(result.ok).toBe(true)

      expect(fetchCalls[0].url).toContain('/deleteMessage')
      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.chat_id).toBe('123')
      expect(body.message_id).toBe(42)
    })
  })

  describe('typing', () => {
    it('calls sendChatAction with action=typing', async () => {
      fetchResponse = { ok: true, result: true }
      const result = await telegramTyping({ chat: '123' })
      expect(result.ok).toBe(true)

      expect(fetchCalls[0].url).toContain('/sendChatAction')
      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.chat_id).toBe('123')
      expect(body.action).toBe('typing')
    })
  })

  describe('me', () => {
    it('calls getMe, outputs bot info', async () => {
      fetchResponse = { ok: true, result: { id: 999, is_bot: true, first_name: 'TestBot', username: 'test_bot' } }
      const result = await telegramMe()
      expect(result.ok).toBe(true)
      expect(result.bot.username).toBe('test_bot')

      expect(fetchCalls[0].url).toContain('/getMe')
    })
  })

  describe('get-chat', () => {
    it('calls getChat, outputs chat info', async () => {
      fetchResponse = { ok: true, result: { id: 123, type: 'private', first_name: 'Marko' } }
      const result = await telegramGetChat({ chat: '123' })
      expect(result.ok).toBe(true)
      expect(result.chat.type).toBe('private')

      expect(fetchCalls[0].url).toContain('/getChat')
    })
  })

  describe('set-webhook', () => {
    it('calls setWebhook with URL', async () => {
      fetchResponse = { ok: true, result: true }
      const result = await telegramSetWebhook({ url: 'https://example.com/hooks/tg' })
      expect(result.ok).toBe(true)

      expect(fetchCalls[0].url).toContain('/setWebhook')
      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.url).toBe('https://example.com/hooks/tg')
    })

    it('includes secret_token when provided', async () => {
      fetchResponse = { ok: true, result: true }
      await telegramSetWebhook({ url: 'https://example.com/hooks/tg', secretToken: 'mysecret' })

      const body = JSON.parse(fetchCalls[0].init.body as string)
      expect(body.secret_token).toBe('mysecret')
    })
  })

  describe('delete-webhook', () => {
    it('calls deleteWebhook', async () => {
      fetchResponse = { ok: true, result: true }
      const result = await telegramDeleteWebhook()
      expect(result.ok).toBe(true)
      expect(fetchCalls[0].url).toContain('/deleteWebhook')
    })
  })

  describe('webhook-info', () => {
    it('calls getWebhookInfo, outputs status', async () => {
      fetchResponse = { ok: true, result: { url: 'https://example.com/hooks/tg', has_custom_certificate: false, pending_update_count: 0 } }
      const result = await telegramWebhookInfo()
      expect(result.ok).toBe(true)
      expect(result.webhook.url).toBe('https://example.com/hooks/tg')

      expect(fetchCalls[0].url).toContain('/getWebhookInfo')
    })
  })

  describe('file', () => {
    it('calls getFile with file_id', async () => {
      fetchResponse = { ok: true, result: { file_id: 'abc', file_path: 'photos/file_0.jpg', file_size: 1234 } }
      const result = await telegramGetFile({ fileId: 'abc' })
      expect(result.ok).toBe(true)
      expect(result.file.file_path).toBe('photos/file_0.jpg')

      expect(fetchCalls[0].url).toContain('/getFile')
    })
  })
})
