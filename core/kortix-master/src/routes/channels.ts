/**
 * Channel management routes — thin wrapper over SQLite channel DB.
 *
 * GET    /kortix/channels              — list all channels
 * GET    /kortix/channels/:id          — get channel details
 * POST   /kortix/channels/:id/enable   — enable channel
 * POST   /kortix/channels/:id/disable  — disable channel
 * DELETE /kortix/channels/:id          — remove channel
 * PATCH  /kortix/channels/:id          — update settings
 */

import { Hono } from 'hono'

const channelsRouter = new Hono()

// Dynamic import to avoid loading bun:sqlite at module scope in test environments
async function loadDb() {
  const mod = await import('../../channels/channel-db')
  return mod
}

channelsRouter.get('/', async (c) => {
  try {
    const { listChannels } = await loadDb()
    const platform = c.req.query('platform')
    const channels = listChannels(platform || undefined)
    return c.json({
      ok: true,
      channels: channels.map(ch => ({
        id: ch.id,
        platform: ch.platform,
        name: ch.name,
        enabled: ch.enabled,
        bot_username: ch.bot_username,
        default_agent: ch.default_agent,
        default_model: ch.default_model,
        webhook_path: ch.webhook_path,
        created_by: ch.created_by,
        created_at: ch.created_at,
        updated_at: ch.updated_at,
      })),
    })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

channelsRouter.get('/:id', async (c) => {
  try {
    const { getChannel } = await loadDb()
    const ch = getChannel(c.req.param('id'))
    if (!ch) return c.json({ ok: false, error: 'Not found' }, 404)
    return c.json({
      ok: true,
      channel: {
        id: ch.id,
        platform: ch.platform,
        name: ch.name,
        enabled: ch.enabled,
        bot_username: ch.bot_username,
        default_agent: ch.default_agent,
        default_model: ch.default_model,
        instructions: ch.instructions,
        webhook_path: ch.webhook_path,
        created_by: ch.created_by,
        created_at: ch.created_at,
        updated_at: ch.updated_at,
      },
    })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

channelsRouter.post('/:id/enable', async (c) => {
  try {
    const { enableChannel } = await loadDb()
    const ch = enableChannel(c.req.param('id'))
    if (!ch) return c.json({ ok: false, error: 'Not found' }, 404)
    return c.json({ ok: true, message: `${ch.name} enabled` })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

channelsRouter.post('/:id/disable', async (c) => {
  try {
    const { disableChannel } = await loadDb()
    const ch = disableChannel(c.req.param('id'))
    if (!ch) return c.json({ ok: false, error: 'Not found' }, 404)
    return c.json({ ok: true, message: `${ch.name} disabled` })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

channelsRouter.delete('/:id', async (c) => {
  try {
    const { deleteChannel, getChannel } = await loadDb()
    const ch = getChannel(c.req.param('id'))
    if (!ch) return c.json({ ok: false, error: 'Not found' }, 404)
    deleteChannel(c.req.param('id'))
    return c.json({ ok: true, message: `${ch.name} removed` })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

channelsRouter.patch('/:id', async (c) => {
  try {
    const { updateChannel } = await loadDb()
    const body = await c.req.json()
    const updates: Record<string, any> = {}
    if (body.default_agent !== undefined) updates.default_agent = body.default_agent
    if (body.default_model !== undefined) updates.default_model = body.default_model
    if (body.instructions !== undefined) updates.instructions = body.instructions
    if (body.name !== undefined) updates.name = body.name
    if (body.enabled !== undefined) updates.enabled = body.enabled

    const ch = updateChannel(c.req.param('id'), updates)
    if (!ch) return c.json({ ok: false, error: 'Not found' }, 404)
    return c.json({ ok: true, message: `${ch.name} updated` })
  } catch (e) {
    return c.json({ ok: false, error: String(e) }, 500)
  }
})

export { channelsRouter }
