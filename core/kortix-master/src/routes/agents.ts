/**
 * Kortix Agents API
 *
 * Per-project agent (sub-agent) records. Reads from .kortix/kortix.db.
 * Mounted at /kortix/agents in kortix-master.
 */

import { Hono } from 'hono'
import { getDb } from '../db'

const agentsRouter = new Hono()

// GET /kortix/agents?project_id=xxx&status=yyy
agentsRouter.get('/', (c) => {
  const db = getDb()
  const projectId = c.req.query('project_id')
  const status = c.req.query('status')
  
  let q = 'SELECT * FROM agents WHERE 1=1'
  const params: Record<string, string> = {}
  
  if (projectId) { q += ' AND project_id=$pid'; params.$pid = projectId }
  if (status) { q += ' AND status=$s'; params.$s = status }
  q += ' ORDER BY created_at DESC LIMIT 50'
  
  try {
    const agents = db.prepare(q).all(params)
    return c.json(agents)
  } catch {
    return c.json([])
  }
})

// GET /kortix/agents/:id
agentsRouter.get('/:id', (c) => {
  const db = getDb()
  const id = c.req.param('id')
  const agent = db.prepare('SELECT * FROM agents WHERE id=$id').get({ $id: id })
  if (!agent) return c.json({ error: 'Not found' }, 404)
  return c.json(agent)
})

export { agentsRouter }
