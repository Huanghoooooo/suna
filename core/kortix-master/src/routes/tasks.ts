/**
 * Kortix Tasks API — per-project task CRUD.
 * Mounted at /kortix/tasks in kortix-master.
 */

import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { existsSync } from 'fs'
import { join } from 'path'

const tasksRouter = new Hono()

function getDb(): Database {
  const workspace = process.env.WORKSPACE_DIR || process.env.KORTIX_WORKSPACE || '/workspace'
  const dbPath = join(workspace, '.kortix', 'kortix.db')
  if (!existsSync(dbPath)) throw new Error('kortix.db not found')
  const db = new Database(dbPath)
  db.exec('PRAGMA busy_timeout=5000')
  return db
}

interface TaskRow {
  id: string; project_id: string; title: string; description: string
  status: string; result: string | null; priority: string
  created_at: string; updated_at: string
}

// GET /kortix/tasks?project_id=xxx&status=yyy
tasksRouter.get('/', (c) => {
  try {
    const db = getDb()
    const projectId = c.req.query('project_id')
    const status = c.req.query('status')
    let q = 'SELECT * FROM tasks WHERE 1=1'
    const params: Record<string, string> = {}
    if (projectId) { q += ' AND project_id=$pid'; params.$pid = projectId }
    if (status) { q += ' AND status=$s'; params.$s = status }
    q += " ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END, created_at DESC LIMIT 100"
    return c.json(db.prepare(q).all(params))
  } catch { return c.json([]) }
})

// GET /kortix/tasks/:id
tasksRouter.get('/:id', (c) => {
  try {
    const db = getDb()
    const task = db.prepare('SELECT * FROM tasks WHERE id=$id').get({ $id: c.req.param('id') }) as TaskRow | null
    if (!task) return c.json({ error: 'Not found' }, 404)
    return c.json(task)
  } catch (e) { return c.json({ error: String(e) }, 500) }
})

// PATCH /kortix/tasks/:id
tasksRouter.patch('/:id', async (c) => {
  try {
    const db = getDb()
    const id = c.req.param('id')
    const body = await c.req.json<Partial<TaskRow>>()
    const task = db.prepare('SELECT * FROM tasks WHERE id=$id').get({ $id: id }) as TaskRow | null
    if (!task) return c.json({ error: 'Not found' }, 404)
    const now = new Date().toISOString()
    if (body.status) db.prepare('UPDATE tasks SET status=$v, updated_at=$now WHERE id=$id').run({ $v: body.status, $now: now, $id: id })
    if (body.title) db.prepare('UPDATE tasks SET title=$v, updated_at=$now WHERE id=$id').run({ $v: body.title, $now: now, $id: id })
    if (body.description) db.prepare('UPDATE tasks SET description=$v, updated_at=$now WHERE id=$id').run({ $v: body.description, $now: now, $id: id })
    if (body.priority) db.prepare('UPDATE tasks SET priority=$v, updated_at=$now WHERE id=$id').run({ $v: body.priority, $now: now, $id: id })
    if (body.result !== undefined) db.prepare('UPDATE tasks SET result=$v, updated_at=$now WHERE id=$id').run({ $v: body.result, $now: now, $id: id })
    return c.json(db.prepare('SELECT * FROM tasks WHERE id=$id').get({ $id: id }))
  } catch (e) { return c.json({ error: String(e) }, 500) }
})

// DELETE /kortix/tasks/:id
tasksRouter.delete('/:id', (c) => {
  try {
    const db = getDb()
    const id = c.req.param('id')
    const task = db.prepare('SELECT * FROM tasks WHERE id=$id').get({ $id: id }) as TaskRow | null
    if (!task) return c.json({ error: 'Not found' }, 404)
    db.prepare('DELETE FROM tasks WHERE id=$id').run({ $id: id })
    return c.json({ deleted: true })
  } catch (e) { return c.json({ error: String(e) }, 500) }
})

export { tasksRouter }
