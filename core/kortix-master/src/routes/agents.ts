/**
 * Kortix Agents API — per-project agent records.
 * Mounted at /kortix/agents in kortix-master.
 */

import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { existsSync } from 'fs'
import { join } from 'path'

const agentsRouter = new Hono()

function getDb(): Database {
  const workspace = process.env.WORKSPACE_DIR || process.env.KORTIX_WORKSPACE || '/workspace'
  const dbPath = join(workspace, '.kortix', 'kortix.db')
  if (!existsSync(dbPath)) throw new Error('kortix.db not found')
  const db = new Database(dbPath)
  db.exec('PRAGMA busy_timeout=5000')
  return db
}

// GET /kortix/agents?project_id=xxx&status=yyy
agentsRouter.get('/', (c) => {
  try {
    const db = getDb()
    const projectId = c.req.query('project_id')
    const status = c.req.query('status')
    let q = 'SELECT * FROM agents WHERE 1=1'
    const params: Record<string, string> = {}
    if (projectId) { q += ' AND project_id=$pid'; params.$pid = projectId }
    if (status) { q += ' AND status=$s'; params.$s = status }
    q += ' ORDER BY created_at DESC LIMIT 50'
    return c.json(db.prepare(q).all(params))
  } catch (e) { console.error('[agents route] Error:', e); return c.json([]) }
})

// GET /kortix/agents/by-session/:sessionId — agents spawned FROM this session
agentsRouter.get('/by-session/:sessionId', (c) => {
  try {
    const db = getDb()
    const sid = c.req.param('sessionId')
    return c.json(db.prepare('SELECT * FROM agents WHERE parent_session_id=$sid ORDER BY created_at DESC').all({ $sid: sid }))
  } catch { return c.json([]) }
})

// GET /kortix/agents/by-child/:sessionId — agent record FOR this child session
agentsRouter.get('/by-child/:sessionId', (c) => {
  try {
    const db = getDb()
    const sid = c.req.param('sessionId')
    const agent = db.prepare('SELECT * FROM agents WHERE session_id=$sid').get({ $sid: sid })
    if (!agent) return c.json({ error: 'Not found' }, 404)
    return c.json(agent)
  } catch { return c.json([]) }
})

// GET /kortix/agents/:id
agentsRouter.get('/:id', (c) => {
  try {
    const db = getDb()
    const agent = db.prepare('SELECT * FROM agents WHERE id=$id').get({ $id: c.req.param('id') })
    if (!agent) return c.json({ error: 'Not found' }, 404)
    return c.json(agent)
  } catch (e) { return c.json({ error: String(e) }, 500) }
})

export { agentsRouter }
