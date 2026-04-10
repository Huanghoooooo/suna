/**
 * Kortix Tasks API — task-centric project execution.
 *
 * Statuses: planned, in_progress, input_needed, completed, cancelled
 *
 * State machine:
 *   planned → [POST /start] → in_progress → input_needed → [POST /approve] → completed
 *   cancelled is always reachable; can reopen to planned
 *
 * POST /:id/start creates a real worker session via OpenCode and binds it to the task.
 * POST /:id/approve moves input_needed → completed (human decision).
 */

import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { existsSync } from 'fs'
import { join } from 'path'
import { config } from '../config'
import { createOpencodeClient } from '@opencode-ai/sdk/client'

const tasksRouter = new Hono()

// ---------------------------------------------------------------------------
// DB + types
// ---------------------------------------------------------------------------

function getDb(): Database {
  const workspace = process.env.WORKSPACE_DIR || process.env.KORTIX_WORKSPACE || '/workspace'
  const dbPath = join(workspace, '.kortix', 'kortix.db')
  if (!existsSync(dbPath)) throw new Error('kortix.db not found')
  const db = new Database(dbPath)
  db.exec('PRAGMA busy_timeout=5000')
  return db
}

interface TaskRow {
  id: string
  project_id: string
  title: string
  description: string
  verification_condition: string
  status: string
  result: string | null
  verification_summary: string | null
  blocking_question: string | null
  owner_session_id: string | null
  owner_agent: string | null
  parent_session_id: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface ProjectRow {
  id: string
  name: string
  path: string
  description: string
}

const VALID_STATUSES = ['todo', 'in_progress', 'input_needed', 'completed', 'cancelled']
const TERMINAL_STATUSES = ['completed', 'cancelled']

const STATUS_ORDER_SQL = `CASE status
  WHEN 'in_progress' THEN 0
  WHEN 'input_needed'   THEN 1
  WHEN 'todo'     THEN 2
  WHEN 'completed'   THEN 4
  WHEN 'cancelled'   THEN 5
  ELSE 99 END`

const PATCH_TRANSITIONS: Record<string, string[]> = {
  planned: ['cancelled'],
  in_progress: ['input_needed', 'todo', 'cancelled'],
  input_needed: ['todo', 'cancelled'],
  completed: [],
  cancelled: ['todo'],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _ocClient: ReturnType<typeof createOpencodeClient> | null = null
function getOpenCodeClient() {
  if (!_ocClient) {
    _ocClient = createOpencodeClient({
      baseUrl: `http://${config.OPENCODE_HOST}:${config.OPENCODE_PORT}`,
    })
  }
  return _ocClient
}

function buildOwnerPrompt(project: ProjectRow, task: TaskRow): string {
  const verificationFlag = task.verification_condition
    ? ` --verification "${task.verification_condition.replace(/"/g, '\\"')}"`
    : ''
  return [
    `/autowork --completion-promise TASK_COMPLETE --max-iterations 50${verificationFlag}`,
    '',
    `You are the single responsible owner for one task.`,
    '',
    `Project:`,
    `- name: ${project.name}`,
    `- id: ${project.id}`,
    `- path: ${project.path}`,
    '',
    `Task:`,
    `- id: ${task.id}`,
    `- title: ${task.title}`,
    `- description: ${task.description || '(none)'}`,
    `- verification_condition: ${task.verification_condition || '(none)'}`,
    `- status: ${task.status}`,
    '',
    `Execution contract:`,
    `- FIRST: run project_select("${project.name}") to link this session to the project.`,
    `- Keep the native todo list current at all times.`,
    `- Use task_get("${task.id}") to re-read the task details whenever needed.`,
    `- If blocked or missing input, use task_question. That pauses the task for human input.`,
    `- When the task is truly complete and verified, call task_deliver with both result and verification_summary.`,
    `- task_deliver will move the task to input_needed for human approval.`,
    `- Only after task_deliver succeeds, emit exactly TASK_COMPLETE.`,
    `- You own exactly this one task. Stay within scope and satisfy the verification condition.`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// GET /kortix/tasks?project_id=xxx&status=yyy
// ---------------------------------------------------------------------------
tasksRouter.get('/', async (c) => {
  try {
    const db = getDb()
    const projectId = c.req.query('project_id')
    const status = c.req.query('status')
    let q = 'SELECT * FROM tasks WHERE 1=1'
    const params: Record<string, string> = {}
    if (projectId) { q += ' AND project_id=$pid'; params.$pid = projectId }
    if (status) { q += ' AND status=$s'; params.$s = status }
    q += ` ORDER BY ${STATUS_ORDER_SQL}, created_at DESC LIMIT 500`
    const tasks = db.prepare(q).all(params) as TaskRow[]

    // Reconcile: if a task says in_progress but its session is actually idle,
    // the autowork loop has stopped — move task to input_needed
    const inProgressTasks = tasks.filter((t) => t.status === 'in_progress' && t.owner_session_id)
    if (inProgressTasks.length > 0) {
      try {
        const oc = getOpenCodeClient()
        const statusRes = await oc.session.status()
        const sessionStatuses = statusRes.data as Record<string, { type: string }> | undefined
        if (sessionStatuses) {
          const now = new Date().toISOString()
          for (const task of inProgressTasks) {
            const sessionStatus = sessionStatuses[task.owner_session_id!]
            // Session is idle (not busy, not retrying) = worker finished or died
            if (!sessionStatus || sessionStatus.type === 'idle') {
              db.prepare(
                `UPDATE tasks SET status='input_needed', updated_at=$now WHERE id=$id AND status='in_progress'`
              ).run({ $now: now, $id: task.id })
              task.status = 'input_needed' as any
            }
          }
        }
      } catch {
        // Non-fatal — session status check failed, keep DB state as-is
      }
    }

    return c.json(tasks)
  } catch {
    return c.json([])
  }
})

// ---------------------------------------------------------------------------
// GET /kortix/tasks/:id
// ---------------------------------------------------------------------------
tasksRouter.get('/:id', async (c) => {
  try {
    const db = getDb()
    const task = db
      .prepare('SELECT * FROM tasks WHERE id=$id')
      .get({ $id: c.req.param('id') }) as TaskRow | null
    if (!task) return c.json({ error: 'Not found' }, 404)

    // Reconcile: check if session is still alive for in_progress tasks
    if (task.status === 'in_progress' && task.owner_session_id) {
      try {
        const oc = getOpenCodeClient()
        const statusRes = await oc.session.status()
        const sessionStatuses = statusRes.data as Record<string, { type: string }> | undefined
        const sessionStatus = sessionStatuses?.[task.owner_session_id]
        if (!sessionStatus || sessionStatus.type === 'idle') {
          const now = new Date().toISOString()
          db.prepare(
            `UPDATE tasks SET status='input_needed', updated_at=$now WHERE id=$id AND status='in_progress'`
          ).run({ $now: now, $id: task.id })
          task.status = 'input_needed' as any
        }
      } catch {}
    }

    return c.json(task)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /kortix/tasks  — create a new task
// ---------------------------------------------------------------------------
tasksRouter.post('/', async (c) => {
  try {
    const db = getDb()
    const body = await c.req.json<Partial<TaskRow>>()
    if (!body.project_id || !body.title) {
      return c.json({ error: 'project_id and title required' }, 400)
    }
    const id = `task-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const now = new Date().toISOString()
    let status = body.status || 'todo'
    if (status === 'in_progress') status = 'todo'
    if (!VALID_STATUSES.includes(status)) status = 'todo'
    db.prepare(
      `INSERT INTO tasks (
        id, project_id, title, description, verification_condition,
        status, result, verification_summary, blocking_question,
        owner_session_id, owner_agent, parent_session_id,
        started_at, completed_at, created_at, updated_at
      ) VALUES (
        $id, $pid, $t, $d, $vc,
        $s, NULL, NULL, NULL,
        NULL, NULL, NULL,
        NULL, NULL, $now, $now
      )`,
    ).run({
      $id: id,
      $pid: body.project_id,
      $t: body.title,
      $d: body.description || '',
      $vc: body.verification_condition || '',
      $s: status,
      $now: now,
    })
    return c.json(db.prepare('SELECT * FROM tasks WHERE id=$id').get({ $id: id }))
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /kortix/tasks/:id/start — start execution (creates worker session)
// ---------------------------------------------------------------------------
tasksRouter.post('/:id/start', async (c) => {
  try {
    const db = getDb()
    const id = c.req.param('id')
    const task = db.prepare('SELECT * FROM tasks WHERE id=$id').get({ $id: id }) as TaskRow | null
    if (!task) return c.json({ error: 'Not found' }, 404)

    if (TERMINAL_STATUSES.includes(task.status)) {
      return c.json({ error: 'Cannot start a terminal task' }, 400)
    }
    if (task.status === 'in_progress') {
      return c.json({ error: 'Task is already in progress' }, 400)
    }

    // Resolve project
    const project = db.prepare('SELECT * FROM projects WHERE id=$id').get({ $id: task.project_id }) as ProjectRow | null
    if (!project) {
      return c.json({ error: 'Project not found' }, 400)
    }

    const now = new Date().toISOString()
    const oc = getOpenCodeClient()

    // ── Resume existing owner session ─────────────────────────
    if (task.owner_session_id) {
      try {
        const resumePrompt = [
          `/autowork --completion-promise TASK_COMPLETE --max-iterations 50`,
          '',
          `Task ${task.id} has been restarted. Resume ownership now.`,
          `Re-open the task with task_get for fresh details.`,
        ].join('\n')

        await oc.session.promptAsync({
          path: { id: task.owner_session_id },
          body: { agent: 'worker', parts: [{ type: 'text', text: resumePrompt }] },
        })

        db.prepare(
          `UPDATE tasks SET status='in_progress', started_at=COALESCE(started_at, $now), updated_at=$now WHERE id=$id`,
        ).run({ $now: now, $id: id })

        return c.json(db.prepare('SELECT * FROM tasks WHERE id=$id').get({ $id: id }))
      } catch {
        // Session might be dead — fall through to create new one
      }
    }

    // ── Create new worker session ─────────────────────────────
    // 1. Create session
    const sessionResult = await oc.session.create({
      body: { title: `Task ${id}: ${task.title}` },
    })
    const ownerSessionId = sessionResult.data?.id
    if (!ownerSessionId) {
      return c.json({ error: 'Failed to create worker session' }, 503)
    }

    // 2. Bind project to session (ensure table exists)
    db.exec(`CREATE TABLE IF NOT EXISTS session_projects (
      session_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      set_at TEXT NOT NULL
    )`)
    db.prepare(
      `INSERT OR REPLACE INTO session_projects (session_id, project_id, set_at) VALUES ($sid, $pid, $now)`,
    ).run({ $sid: ownerSessionId, $pid: project.id, $now: now })

    // 3. Send autowork prompt to worker
    const prompt = buildOwnerPrompt(project, task)
    await oc.session.promptAsync({
      path: { id: ownerSessionId },
      body: { agent: 'worker', parts: [{ type: 'text', text: prompt }] },
    })

    // 4. Update task
    db.prepare(
      `UPDATE tasks SET
        status='in_progress',
        owner_session_id=$sid,
        owner_agent='worker',
        started_at=COALESCE(started_at, $now),
        updated_at=$now
      WHERE id=$id`,
    ).run({ $sid: ownerSessionId, $now: now, $id: id })

    return c.json(db.prepare('SELECT * FROM tasks WHERE id=$id').get({ $id: id }))
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// ---------------------------------------------------------------------------
// POST /kortix/tasks/:id/approve  — approve a task in review → completed
// ---------------------------------------------------------------------------
tasksRouter.post('/:id/approve', async (c) => {
  try {
    const db = getDb()
    const id = c.req.param('id')
    const task = db.prepare('SELECT * FROM tasks WHERE id=$id').get({ $id: id }) as TaskRow | null
    if (!task) return c.json({ error: 'Not found' }, 404)
    if (task.status !== 'input_needed') {
      return c.json({ error: 'Can only approve tasks in review' }, 400)
    }
    const now = new Date().toISOString()
    db.prepare(
      `UPDATE tasks SET status='completed', completed_at=COALESCE(completed_at, $now), updated_at=$now WHERE id=$id`,
    ).run({ $now: now, $id: id })
    return c.json(db.prepare('SELECT * FROM tasks WHERE id=$id').get({ $id: id }))
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// ---------------------------------------------------------------------------
// PATCH /kortix/tasks/:id
// ---------------------------------------------------------------------------
const PATCHABLE_FIELDS: Array<keyof TaskRow> = [
  'title',
  'description',
  'verification_condition',
  'status',
  'result',
  'verification_summary',
  'blocking_question',
  'owner_session_id',
  'owner_agent',
]

tasksRouter.patch('/:id', async (c) => {
  try {
    const db = getDb()
    const id = c.req.param('id')
    const body = await c.req.json<Partial<TaskRow>>()
    const task = db.prepare('SELECT * FROM tasks WHERE id=$id').get({ $id: id }) as TaskRow | null
    if (!task) return c.json({ error: 'Not found' }, 404)

    if (body.status) {
      // in_progress only via /start, completed only via /approve
      if (body.status === 'in_progress') {
        return c.json({ error: 'Use POST /:id/start' }, 400)
      }
      if (body.status === 'completed') {
        return c.json({ error: 'Use POST /:id/approve' }, 400)
      }

      if (!VALID_STATUSES.includes(body.status)) {
        return c.json({ error: `Invalid status: ${body.status}` }, 400)
      }

      const allowed = PATCH_TRANSITIONS[task.status] || []
      if (!allowed.includes(body.status)) {
        return c.json({ error: `Cannot transition from ${task.status} to ${body.status}` }, 400)
      }
    }

    const now = new Date().toISOString()

    for (const field of PATCHABLE_FIELDS) {
      if (body[field] !== undefined) {
        db.prepare(`UPDATE tasks SET ${field}=$v, updated_at=$now WHERE id=$id`).run({
          $v: body[field] as any,
          $now: now,
          $id: id,
        })
      }
    }

    if (body.status === 'cancelled' && !task.completed_at) {
      db.prepare('UPDATE tasks SET completed_at=$now WHERE id=$id').run({ $now: now, $id: id })
    }

    return c.json(db.prepare('SELECT * FROM tasks WHERE id=$id').get({ $id: id }))
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// ---------------------------------------------------------------------------
// DELETE /kortix/tasks/:id
// ---------------------------------------------------------------------------
tasksRouter.delete('/:id', (c) => {
  try {
    const db = getDb()
    const id = c.req.param('id')
    const task = db.prepare('SELECT * FROM tasks WHERE id=$id').get({ $id: id }) as TaskRow | null
    if (!task) return c.json({ error: 'Not found' }, 404)
    db.prepare('DELETE FROM tasks WHERE id=$id').run({ $id: id })
    return c.json({ deleted: true })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

export { tasksRouter }
