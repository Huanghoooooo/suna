/**
 * Kortix Tasks API — task-centric project execution.
 *
 * Statuses: backlog, todo, in_progress, in_review, completed, cancelled
 *
 * State machine:
 *   backlog ↔ todo → [POST /start] → in_progress → in_review → [POST /approve] → completed
 *   cancelled is always reachable; can reopen to backlog/todo
 *
 * POST /:id/start creates a real worker session via OpenCode and binds it to the task.
 * POST /:id/approve moves in_review → completed (human decision).
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
  requested_by_session_id: string | null
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

interface TaskCommentRow {
  id: string
  task_id: string
  project_id: string
  author_session_id: string | null
  author_role: string
  body: string
  created_at: string
}

const VALID_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'completed', 'cancelled']
const TERMINAL_STATUSES = ['completed', 'cancelled']

const STATUS_ORDER_SQL = `CASE status
  WHEN 'in_progress' THEN 0
  WHEN 'in_review'   THEN 1
  WHEN 'todo'        THEN 2
  WHEN 'backlog'     THEN 3
  WHEN 'completed'   THEN 4
  WHEN 'cancelled'   THEN 5
  ELSE 99 END`

const PATCH_TRANSITIONS: Record<string, string[]> = {
  backlog: ['todo', 'cancelled'],
  todo: ['backlog', 'cancelled'],
  in_progress: ['in_review', 'todo', 'cancelled'],
  in_review: ['todo', 'cancelled'],
  completed: [],
  cancelled: ['backlog', 'todo'],
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

function addComment(db: Database, taskId: string, projectId: string, body: string, authorRole: string = 'system') {
  const id = `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO task_comments (id, task_id, project_id, author_session_id, author_role, body, created_at)
     VALUES ($id, $tid, $pid, NULL, $role, $body, $now)`,
  ).run({ $id: id, $tid: taskId, $pid: projectId, $role: authorRole, $body: body, $now: now })
}

function buildOwnerPrompt(project: ProjectRow, task: TaskRow): string {
  return [
    `/ralph --completion-promise TASK_COMPLETE --max-iterations 50`,
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
    `- Keep the native todo list current at all times.`,
    `- Use task_get to re-read the task details and comments whenever needed.`,
    `- Use task_comment to leave meaningful progress updates on the task.`,
    `- If blocked or missing input, use task_question. That pauses the task for human input.`,
    `- The human can comment on the task at any time. Their messages arrive as <task_comment> in your session. Use task_get for full context.`,
    `- When the task is truly complete and verified, call task_deliver with both result and verification_summary.`,
    `- task_deliver will move the task to in_review for human approval.`,
    `- Only after task_deliver succeeds, emit exactly TASK_COMPLETE.`,
    `- You own exactly this one task. Stay within scope and satisfy the verification condition.`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// GET /kortix/tasks?project_id=xxx&status=yyy
// ---------------------------------------------------------------------------
tasksRouter.get('/', (c) => {
  try {
    const db = getDb()
    const projectId = c.req.query('project_id')
    const status = c.req.query('status')
    let q = 'SELECT * FROM tasks WHERE 1=1'
    const params: Record<string, string> = {}
    if (projectId) { q += ' AND project_id=$pid'; params.$pid = projectId }
    if (status) { q += ' AND status=$s'; params.$s = status }
    q += ` ORDER BY ${STATUS_ORDER_SQL}, created_at DESC LIMIT 500`
    return c.json(db.prepare(q).all(params))
  } catch {
    return c.json([])
  }
})

// ---------------------------------------------------------------------------
// GET /kortix/tasks/:id
// ---------------------------------------------------------------------------
tasksRouter.get('/:id', (c) => {
  try {
    const db = getDb()
    const task = db
      .prepare('SELECT * FROM tasks WHERE id=$id')
      .get({ $id: c.req.param('id') }) as TaskRow | null
    if (!task) return c.json({ error: 'Not found' }, 404)
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
        owner_session_id, owner_agent, requested_by_session_id,
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
          `/ralph --completion-promise TASK_COMPLETE --max-iterations 50`,
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

        addComment(db, id, task.project_id, `Execution resumed in existing session ${task.owner_session_id}.`)
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

    // 2. Bind project to session
    try {
      db.prepare(
        `INSERT OR REPLACE INTO session_projects (session_id, project_id, set_at) VALUES ($sid, $pid, $now)`,
      ).run({ $sid: ownerSessionId, $pid: project.id, $now: now })
    } catch {
      // session_projects table might not exist yet — non-fatal
    }

    // 3. Send Ralph prompt to worker
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

    addComment(db, id, task.project_id, `Execution started in worker session ${ownerSessionId}.`)
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
    if (task.status !== 'in_review') {
      return c.json({ error: 'Can only approve tasks in review' }, 400)
    }
    const now = new Date().toISOString()
    db.prepare(
      `UPDATE tasks SET status='completed', completed_at=COALESCE(completed_at, $now), updated_at=$now WHERE id=$id`,
    ).run({ $now: now, $id: id })
    addComment(db, id, task.project_id, 'Task approved and completed.')
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
      // Normalize removed statuses
      if (body.status === 'info_needed') body.status = 'todo'
      if (body.status === 'failed') body.status = 'cancelled'

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
    db.prepare('DELETE FROM task_comments WHERE task_id=$id').run({ $id: id })
    db.prepare('DELETE FROM tasks WHERE id=$id').run({ $id: id })
    return c.json({ deleted: true })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// ---------------------------------------------------------------------------
// GET /kortix/tasks/:id/comments
// ---------------------------------------------------------------------------
tasksRouter.get('/:id/comments', (c) => {
  try {
    const db = getDb()
    const id = c.req.param('id')
    const rows = db
      .prepare('SELECT * FROM task_comments WHERE task_id=$id ORDER BY created_at ASC')
      .all({ $id: id }) as TaskCommentRow[]
    return c.json(rows)
  } catch {
    return c.json([])
  }
})

// ---------------------------------------------------------------------------
// POST /kortix/tasks/:id/comments
// ---------------------------------------------------------------------------
tasksRouter.post('/:id/comments', async (c) => {
  try {
    const db = getDb()
    const taskId = c.req.param('id')
    const body = await c.req.json<Partial<TaskCommentRow>>()
    if (!body.body || !body.body.trim()) {
      return c.json({ error: 'body required' }, 400)
    }
    const task = db
      .prepare('SELECT * FROM tasks WHERE id=$id')
      .get({ $id: taskId }) as TaskRow | null
    if (!task) return c.json({ error: 'Task not found' }, 404)

    const role = body.author_role || 'user'
    const text = body.body.trim()
    const id = `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO task_comments (
        id, task_id, project_id, author_session_id, author_role, body, created_at
      ) VALUES ($id, $tid, $pid, $sid, $role, $body, $now)`,
    ).run({
      $id: id,
      $tid: taskId,
      $pid: task.project_id,
      $sid: body.author_session_id || null,
      $role: role,
      $body: text,
      $now: now,
    })
    db.prepare('UPDATE tasks SET updated_at=$now WHERE id=$id').run({ $now: now, $id: taskId })

    // If task has an active owner session and comment is from a human,
    // inject the message into the worker session (like channel webhooks do)
    if (task.owner_session_id && task.status === 'in_progress' && role === 'user') {
      const oc = getOpenCodeClient()
      oc.session.promptAsync({
        path: { id: task.owner_session_id },
        body: { parts: [{ type: 'text', text: `<task_comment from="human" task="${taskId}">\n${text}\n</task_comment>` }] },
      }).catch(() => {}) // fire-and-forget — don't block comment creation
    }

    return c.json(
      db.prepare('SELECT * FROM task_comments WHERE id=$id').get({ $id: id }),
    )
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// ---------------------------------------------------------------------------
// DELETE /kortix/tasks/:id/comments/:commentId
// ---------------------------------------------------------------------------
tasksRouter.delete('/:id/comments/:commentId', (c) => {
  try {
    const db = getDb()
    db.prepare('DELETE FROM task_comments WHERE id=$id').run({ $id: c.req.param('commentId') })
    return c.json({ deleted: true })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

export { tasksRouter }
