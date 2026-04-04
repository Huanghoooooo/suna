/**
 * Live integration tests for telegram.ts CLI against real Telegram Bot API.
 *
 * Gated: only runs when TELEGRAM_BOT_TOKEN is set.
 * Uses real network calls — not mocked.
 *
 * To get a test chat_id:
 *   1. Message the bot on Telegram
 *   2. The test auto-discovers your chat_id via getUpdates (if webhook isn't set)
 *      or uses TELEGRAM_TEST_CHAT_ID env var.
 */
import { describe, expect, it } from 'bun:test'
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
} from '../../channels/telegram'

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT_ID = process.env.TELEGRAM_TEST_CHAT_ID

describe.skipIf(!TOKEN)('Telegram Live Integration', () => {
  let testChatId: string
  let sentMessageId: number | undefined

  it('getMe returns valid bot info', async () => {
    const result = await telegramMe()
    expect(result.ok).toBe(true)
    expect(result.bot.is_bot).toBe(true)
    expect(result.bot.username).toBeTruthy()
    console.log(`  Bot: @${result.bot.username} (id: ${result.bot.id})`)
  })

  it('discovers test chat_id', async () => {
    if (CHAT_ID) {
      testChatId = CHAT_ID
      console.log(`  Using provided TELEGRAM_TEST_CHAT_ID: ${testChatId}`)
      return
    }

    // Try to get chat_id from recent updates (only works if webhook is NOT set)
    // First delete webhook temporarily
    await telegramDeleteWebhook()

    // Get recent updates
    const token = process.env.TELEGRAM_BOT_TOKEN!
    const apiBase = process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org'
    const res = await fetch(`${apiBase}/bot${token}/getUpdates?limit=1&timeout=5`, {
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json() as { ok: boolean; result?: Array<{ message?: { chat: { id: number } } }> }

    if (data.ok && data.result?.[0]?.message?.chat?.id) {
      testChatId = String(data.result[0].message.chat.id)
      console.log(`  Discovered chat_id from getUpdates: ${testChatId}`)
    } else {
      console.log(`  No chat_id found. Send a message to the bot first, then re-run.`)
      console.log(`  Or set TELEGRAM_TEST_CHAT_ID env var.`)
      testChatId = '' // Will cause subsequent tests to fail gracefully
    }
  })

  it('sends message and receives message_id', async () => {
    if (!testChatId) return
    const result = await telegramSend({
      chat: testChatId,
      text: `🧪 Live test at ${new Date().toISOString()}`,
    })
    expect(result.ok).toBe(true)
    expect(result.message_id).toBeGreaterThan(0)
    sentMessageId = result.message_id
    console.log(`  Sent message_id: ${sentMessageId}`)
  })

  it('edits the sent message', async () => {
    if (!testChatId || !sentMessageId) return
    const result = await telegramEdit({
      chat: testChatId,
      messageId: sentMessageId,
      text: `🧪 Live test (edited) at ${new Date().toISOString()}`,
    })
    expect(result.ok).toBe(true)
  })

  it('sends typing indicator', async () => {
    if (!testChatId) return
    const result = await telegramTyping({ chat: testChatId })
    expect(result.ok).toBe(true)
  })

  it('getChat returns chat info', async () => {
    if (!testChatId) return
    const result = await telegramGetChat({ chat: testChatId })
    expect(result.ok).toBe(true)
    expect(result.chat.id).toBe(parseInt(testChatId, 10))
  })

  it('deletes the sent message', async () => {
    if (!testChatId || !sentMessageId) return
    const result = await telegramDelete({
      chat: testChatId,
      messageId: sentMessageId,
    })
    expect(result.ok).toBe(true)
  })

  it('set-webhook + webhook-info round-trip', async () => {
    const testUrl = 'https://example.com/test-webhook-' + Date.now()
    const setResult = await telegramSetWebhook({ url: testUrl })
    expect(setResult.ok).toBe(true)

    const infoResult = await telegramWebhookInfo()
    expect(infoResult.ok).toBe(true)
    expect(infoResult.webhook.url).toBe(testUrl)

    // Clean up: delete webhook
    const deleteResult = await telegramDeleteWebhook()
    expect(deleteResult.ok).toBe(true)
  })
})
