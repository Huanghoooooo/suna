/**
 * Kortix Task System — task-centric project execution.
 *
 * User-facing primitive: Project + Task.
 * Internal execution primitive: a task may own a single worker session.
 *
 * Core opinionated shape:
 * - title                  → what we are trying to achieve
 * - description            → scope / outcome details
 * - verification_condition → how we prove the task is actually done
 * - comments               → durable collaboration thread on the task
 * - status                 → lifecycle state; setting in_progress binds execution
 */

import { Database } from "bun:sqlite"
import { tool, type ToolContext } from "@opencode-ai/plugin"
import type { ProjectManager, ProjectRow } from "./projects"
import { ensureSchema } from "./lib/schema"

export type TaskStatus =
	| "backlog"
	| "todo"
	| "in_progress"
	| "in_review"
	| "completed"
	| "cancelled"

type TaskTerminalStatus = Extract<TaskStatus, "completed" | "cancelled">

export interface TaskRow {
	id: string
	project_id: string
	title: string
	description: string
	verification_condition: string
	status: TaskStatus
	priority: string
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

let ralphActiveSessions: Set<string>
try {
	const mod = require("./ralph/ralph")
	ralphActiveSessions = mod.ralphActiveSessions ?? new Set<string>()
} catch {
	ralphActiveSessions = new Set<string>()
}

function genTaskId(): string {
	return `task-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}


function terminalTaskStatuses(): TaskTerminalStatus[] {
	return ["completed", "cancelled"]
}

function isTerminalTaskStatus(status: TaskStatus): status is TaskTerminalStatus {
	return terminalTaskStatuses().includes(status as TaskTerminalStatus)
}

function statusIcon(status: TaskStatus): string {
	return status === "completed"
		? "✓"
		: status === "in_progress"
		? "→"
		: status === "in_review"
		? "◐"
		: status === "cancelled"
		? "✗"
		: status === "backlog"
		? "⋯"
		: "○"
}

function nowIso(): string {
	return new Date().toISOString()
}


export function ensureTasksTable(db: Database): void {
	ensureSchema(db, "tasks", [
		{ name: "id", type: "TEXT", notNull: true, defaultValue: null, primaryKey: true },
		{ name: "project_id", type: "TEXT", notNull: true, defaultValue: null, primaryKey: false },
		{ name: "title", type: "TEXT", notNull: true, defaultValue: "''", primaryKey: false },
		{ name: "description", type: "TEXT", notNull: true, defaultValue: "''", primaryKey: false },
		{ name: "verification_condition", type: "TEXT", notNull: true, defaultValue: "''", primaryKey: false },
		{ name: "status", type: "TEXT", notNull: true, defaultValue: "'todo'", primaryKey: false },
		{ name: "priority", type: "TEXT", notNull: true, defaultValue: "'medium'", primaryKey: false },
		{ name: "result", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "verification_summary", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "blocking_question", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "owner_session_id", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "owner_agent", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "requested_by_session_id", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "started_at", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "completed_at", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "created_at", type: "TEXT", notNull: true, defaultValue: null, primaryKey: false },
		{ name: "updated_at", type: "TEXT", notNull: true, defaultValue: null, primaryKey: false },
	])

}

function getTaskForSession(db: Database, sessionId: string, projectId: string | null): TaskRow | null {
	if (!sessionId) return null
	if (projectId) {
		return db.prepare("SELECT * FROM tasks WHERE owner_session_id=$sid AND project_id=$pid ORDER BY updated_at DESC LIMIT 1")
			.get({ $sid: sessionId, $pid: projectId }) as TaskRow | null
	}
	return db.prepare("SELECT * FROM tasks WHERE owner_session_id=$sid ORDER BY updated_at DESC LIMIT 1")
		.get({ $sid: sessionId }) as TaskRow | null
}

function resolveTask(db: Database, projectId: string, idOrNull: string | undefined, sessionId: string | undefined): TaskRow | null {
	if (idOrNull && idOrNull.trim()) {
		return db.prepare("SELECT * FROM tasks WHERE project_id=$pid AND (id=$id OR id LIKE $like)")
			.get({ $pid: projectId, $id: idOrNull, $like: `%${idOrNull}%` }) as TaskRow | null
	}
	if (!sessionId) return null
	return getTaskForSession(db, sessionId, projectId)
}

/**
 * Start a task via the REST API (single source of truth).
 * The REST handler at POST /kortix/tasks/:id/start handles all session
 * creation, prompt building, and DB updates. No duplication.
 */
async function startTaskViaRest(taskId: string): Promise<{ ok: boolean; message: string }> {
	const port = process.env.KORTIX_MASTER_PORT || '8000'
	try {
		const res = await fetch(`http://localhost:${port}/kortix/tasks/${encodeURIComponent(taskId)}/start`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
			signal: AbortSignal.timeout(30_000),
		})
		const data = await res.json() as any
		if (!res.ok) return { ok: false, message: data?.error || `Start failed (${res.status})` }
		return { ok: true, message: `Task **${taskId}** started in worker session ${data.owner_session_id || '(unknown)'}.` }
	} catch (err) {
		return { ok: false, message: `Failed to reach task API: ${err}` }
	}
}

function formatTask(task: TaskRow): string {
	const lines = [
		`## ${task.title}`,
		"",
		`**ID:** ${task.id}`,
		`**Status:** ${task.status}`,
		`**Owner Session:** ${task.owner_session_id || "—"}`,
		`**Description:** ${task.description || "—"}`,
		`**Verification Condition:** ${task.verification_condition || "—"}`,
	]
	if (task.blocking_question) lines.push(`**Blocking Question:** ${task.blocking_question}`)
	if (task.result) lines.push(`**Result:** ${task.result}`)
	if (task.verification_summary) lines.push(`**Verification Summary:** ${task.verification_summary}`)
	return lines.join("\n")
}

export function taskTools(db: Database, mgr: ProjectManager, _client?: any) {
	function getProjectId(ctx: ToolContext): string | null {
		if (!ctx?.sessionID) return null
		return mgr.getSessionProject(ctx.sessionID)?.id || null
	}

	return {
		task_create: tool({
			description: "Create a task in the current project. Opinionated fields: title, description, verification_condition. Returns the task ID.",
			args: {
				title: tool.schema.string().describe("Task title — the concrete outcome to achieve"),
				description: tool.schema.string().describe("Task description — scope, outcome, and implementation context"),
				verification_condition: tool.schema.string().describe("How this task will be proven complete"),
				priority: tool.schema.string().optional().describe('"high", "medium" (default), or "low"'),
				status: tool.schema.string().optional().describe('"todo" (default), "backlog", or "in_progress"'),
			},
			async execute(args: { title: string; description: string; verification_condition: string; priority?: string; status?: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const id = genTaskId()
				const now = nowIso()
				db.prepare(`INSERT INTO tasks (id, project_id, title, description, verification_condition, status, priority, created_at, updated_at)
					VALUES ($id, $pid, $title, $desc, $vc, $status, $priority, $now, $now)`).run({
					$id: id,
					$pid: pid,
					$title: args.title,
					$desc: args.description || "",
					$vc: args.verification_condition || "",
					$status: args.status || "todo",
					$priority: args.priority || "medium",
					$now: now,
				})
				const task = db.prepare("SELECT * FROM tasks WHERE id=$id").get({ $id: id }) as TaskRow
		return `Task **${id}** created: ${args.title}`
			},
		}),

		task_list: tool({
			description: "List tasks in the current project. Shows all by default, or filter by status.",
			args: {
				status: tool.schema.string().optional().describe('Filter by status: backlog, todo, in_progress, in_review, completed, cancelled'),
			},
			async execute(args: { status?: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				let q = "SELECT * FROM tasks WHERE project_id=$pid"
				const params: Record<string, string> = { $pid: pid }
				if (args.status) {
					q += " AND status=$s"
					params.$s = args.status
				}
				q += " ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'in_review' THEN 1 WHEN 'todo' THEN 2 WHEN 'backlog' THEN 3 WHEN 'completed' THEN 4 WHEN 'cancelled' THEN 5 ELSE 9 END, created_at DESC LIMIT 100"
				const tasks = db.prepare(q).all(params) as TaskRow[]
				if (!tasks.length) return args.status ? `No ${args.status} tasks.` : "No tasks in this project."
				return tasks.map((t) => `${statusIcon(t.status)} **${t.id}** ${t.title} — ${t.status}${t.owner_session_id ? ` — owner ${t.owner_session_id}` : ""}`).join("\n")
			},
		}),

		task_get: tool({
			description: "Get the full task record and comment thread. If id is omitted, resolves the task currently owned by this session.",
			args: { id: tool.schema.string().optional().describe("Task ID. Optional when called from the owner session.") },
			async execute(args: { id?: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const task = resolveTask(db, pid, args.id, ctx.sessionID)
				if (!task) return args.id ? `Task not found: ${args.id}` : "No task is bound to this session."
				return formatTask(task)
			},
		}),

		task_question: tool({
			description: "Ask for missing input on a task. Records the question as a blocking_question and pauses the task back to todo for human input.",
			args: {
				id: tool.schema.string().optional().describe("Task ID. Optional for owner session."),
				question: tool.schema.string().describe("Exact question or missing information"),
			},
			async execute(args: { id?: string; question: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const task = resolveTask(db, pid, args.id, ctx.sessionID)
				if (!task) return args.id ? `Task not found: ${args.id}` : "No task is bound to this session."
		db.prepare("UPDATE tasks SET status='in_review', blocking_question=$q, updated_at=$now WHERE id=$id")
					.run({ $q: args.question, $now: nowIso(), $id: task.id })
				return `Task **${task.id}** paused with blocking question. Moved to in_review for human input.`
			},
		}),

		task_deliver: tool({
			description: "Deliver the final verified result for a task. Records result + verification summary and moves the task to in_review for human approval.",
			args: {
				id: tool.schema.string().optional().describe("Task ID. Optional for owner session."),
				result: tool.schema.string().describe("What was delivered"),
				verification_summary: tool.schema.string().describe("How completion was verified"),
			},
			async execute(args: { id?: string; result: string; verification_summary: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const task = resolveTask(db, pid, args.id, ctx.sessionID)
				if (!task) return args.id ? `Task not found: ${args.id}` : "No task is bound to this session."
		db.prepare(`UPDATE tasks
					SET status='in_review', result=$result, verification_summary=$verification, blocking_question=NULL, updated_at=$now
					WHERE id=$id`).run({
					$result: args.result,
					$verification: args.verification_summary,
					$now: nowIso(),
					$id: task.id,
				})
				return `Task **${task.id}** delivered and moved to **in_review** for human approval.`
			},
		}),

		task_update: tool({
			description: "Update a task's metadata. Cannot set status to in_progress (use task start) or completed (use approve). Moving to in_progress happens via the start action.",
			args: {
				id: tool.schema.string().describe("Task ID"),
				title: tool.schema.string().optional().describe("New title"),
				description: tool.schema.string().optional().describe("New description"),
				verification_condition: tool.schema.string().optional().describe("New verification condition"),
				status: tool.schema.string().optional().describe('backlog, todo, in_review, cancelled'),
				result: tool.schema.string().optional().describe("Optional result summary"),
			},
			async execute(args: { id: string; title?: string; description?: string; verification_condition?: string; status?: string; result?: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const task = resolveTask(db, pid, args.id, ctx.sessionID)
				if (!task) return `Task not found: ${args.id}`

				const now = nowIso()
				const updates: string[] = []
				if (args.title !== undefined) { db.prepare("UPDATE tasks SET title=$v, updated_at=$now WHERE id=$id").run({ $v: args.title, $now: now, $id: task.id }); updates.push("title updated") }
				if (args.description !== undefined) { db.prepare("UPDATE tasks SET description=$v, updated_at=$now WHERE id=$id").run({ $v: args.description, $now: now, $id: task.id }); updates.push("description updated") }
				if (args.verification_condition !== undefined) { db.prepare("UPDATE tasks SET verification_condition=$v, updated_at=$now WHERE id=$id").run({ $v: args.verification_condition, $now: now, $id: task.id }); updates.push("verification condition updated") }
				if (args.result !== undefined) { db.prepare("UPDATE tasks SET result=$v, updated_at=$now WHERE id=$id").run({ $v: args.result, $now: now, $id: task.id }); updates.push("result recorded") }

				if (args.status !== undefined) {
					if (args.status === "in_progress") return "Error: use the start action to move a task to in_progress."
					if (args.status === "completed") return "Error: use the approve action to mark a task completed."
					db.prepare("UPDATE tasks SET status=$v, updated_at=$now WHERE id=$id").run({
						$v: args.status,
						$now: now,
						$id: task.id,
					})
					updates.push(`status → ${args.status}`)
					if (args.status === "cancelled") {
						db.prepare("UPDATE tasks SET completed_at=COALESCE(completed_at, $now) WHERE id=$id").run({ $now: now, $id: task.id })
					}
				}

				return `Task **${task.id}** updated: ${updates.join(", ") || "no changes"}`
			},
		}),

		task_start: tool({
			description: "Start a task — creates a dedicated worker session running in a Ralph persistence loop. The task moves to in_progress and is bound to the worker.",
			args: {
				id: tool.schema.string().describe("Task ID to start"),
			},
			async execute(args: { id: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const task = db.prepare("SELECT * FROM tasks WHERE id=$id AND project_id=$pid").get({ $id: args.id, $pid: pid }) as TaskRow | null
				if (!task) return `Task not found: ${args.id}`
				if (task.status === "completed" || task.status === "cancelled") return `Cannot start a ${task.status} task.`
				if (task.status === "in_progress") return `Task is already in progress.`

				const result = await startTaskViaRest(task.id)
				return result.message
			},
		}),

		task_done: tool({
			description: "Mark a task as delivered and move to in_review for human approval.",
			args: {
				id: tool.schema.string().describe("Task ID"),
				result: tool.schema.string().optional().describe("What was accomplished"),
			},
			async execute(args: { id: string; result?: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const task = resolveTask(db, pid, args.id, ctx.sessionID)
				if (!task) return `Task not found: ${args.id}`
		db.prepare("UPDATE tasks SET status='in_review', result=$r, updated_at=$now WHERE id=$id")
					.run({ $r: args.result || task.result, $now: nowIso(), $id: task.id })
				return `Task **${task.id}** moved to **in_review** for human approval.`
			},
		}),

		task_delete: tool({
			description: "Delete a task and its comments from the current project.",
			args: { id: tool.schema.string().describe("Task ID") },
			async execute(args: { id: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const task = resolveTask(db, pid, args.id, ctx.sessionID)
				if (!task) return `Task not found: ${args.id}`
				db.prepare("DELETE FROM tasks WHERE id=$id").run({ $id: task.id })
				return `Task **${task.id}** deleted: ${task.title}`
			},
		}),
	}
}

export async function handleTaskSessionEvent(sessionId: string, eventType: string, client: any, db: Database): Promise<void> {
	const task = db.prepare("SELECT * FROM tasks WHERE owner_session_id=$sid ORDER BY updated_at DESC LIMIT 1").get({ $sid: sessionId }) as TaskRow | null
	if (!task) return

	if (eventType === "session.idle") {
		if (ralphActiveSessions.has(sessionId)) return
		const refreshed = db.prepare("SELECT * FROM tasks WHERE id=$id").get({ $id: task.id }) as TaskRow | null
		if (!refreshed || isTerminalTaskStatus(refreshed.status)) return

		let lastText = "Owner session stopped before reaching a terminal task status."
		try {
			const msgs = await client.session.messages({ path: { id: sessionId } })
			lastText = (msgs.data ?? [])
				.filter((m: any) => m.info?.role === "assistant")
				.flatMap((m: any) => m.parts ?? [])
				.filter((p: any) => p.type === "text")
				.pop()?.text || lastText
		} catch {}

		db.prepare("UPDATE tasks SET status='cancelled', result=$r, updated_at=$now, completed_at=COALESCE(completed_at, $now) WHERE id=$id")
			.run({ $r: lastText.slice(0, 8000), $now: nowIso(), $id: refreshed.id })
		return
	}

	if (eventType === "session.error" || eventType === "session.aborted") {
		const refreshed = db.prepare("SELECT * FROM tasks WHERE id=$id").get({ $id: task.id }) as TaskRow | null
		if (!refreshed || isTerminalTaskStatus(refreshed.status)) return
		db.prepare("UPDATE tasks SET status='cancelled', updated_at=$now, completed_at=COALESCE(completed_at, $now) WHERE id=$id")
			.run({ $now: nowIso(), $id: refreshed.id })
	}
}
