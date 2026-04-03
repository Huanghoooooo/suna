/**
 * Kortix Tasks — CC-style per-project task management.
 *
 * Tasks are structured work items scoped to the active project.
 * Status lifecycle: pending → in_progress → completed | failed
 *
 * Tools: task_create, task_get, task_list, task_update, task_stop
 */

import { Database } from "bun:sqlite"
import { tool, type ToolContext } from "@opencode-ai/plugin"
import type { ProjectManager } from "./projects"

// ── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed"

export interface TaskRow {
	id: string
	project_id: string
	subject: string
	description: string
	status: TaskStatus
	active_form: string | null
	metadata: string | null
	created_at: string
	updated_at: string
}

function taskId(): string {
	return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Tools ────────────────────────────────────────────────────────────────────

export function taskTools(db: Database, mgr: ProjectManager) {
	function getProjectId(toolCtx: ToolContext): string | null {
		if (!toolCtx?.sessionID) return null
		const p = mgr.getSessionProject(toolCtx.sessionID)
		return p?.id || null
	}

	return {
		task_create: tool({
			description: "Create a task in the current project. Returns the task ID.",
			args: {
				subject: tool.schema.string().describe("Brief title for the task"),
				description: tool.schema.string().describe("What needs to be done"),
				active_form: tool.schema.string().optional().describe('Present continuous shown in spinner when in_progress (e.g. "Running tests")'),
				metadata: tool.schema.string().optional().describe("JSON metadata to attach"),
			},
			async execute(args: { subject: string; description: string; active_form?: string; metadata?: string }, toolCtx: ToolContext): Promise<string> {
				const pid = getProjectId(toolCtx)
				if (!pid) return "Error: no project selected. Use project_select first."
				const id = taskId()
				const now = new Date().toISOString()
				db.prepare(`INSERT INTO tasks (id, project_id, subject, description, status, active_form, metadata, created_at, updated_at)
					VALUES ($id, $pid, $subj, $desc, 'pending', $af, $meta, $now, $now)`)
					.run({ $id: id, $pid: pid, $subj: args.subject, $desc: args.description, $af: args.active_form || null, $meta: args.metadata || null, $now: now, })
				return `Task **#${id}** created: ${args.subject}`
			},
		}),

		task_list: tool({
			description: "List tasks in the current project. Shows all by default, or filter by status.",
			args: {
				status: tool.schema.string().optional().describe('Filter: "pending", "in_progress", "completed", "failed", or "" for all'),
			},
			async execute(args: { status?: string }, toolCtx: ToolContext): Promise<string> {
				const pid = getProjectId(toolCtx)
				if (!pid) return "Error: no project selected."
				let q = "SELECT * FROM tasks WHERE project_id=$pid"
				const params: Record<string, string> = { $pid: pid }
				if (args.status) { q += " AND status=$s"; params.$s = args.status }
				q += " ORDER BY created_at DESC LIMIT 50"
				const tasks = db.prepare(q).all(params) as TaskRow[]
				if (!tasks.length) return args.status ? `No ${args.status} tasks.` : "No tasks in this project."
				const lines = tasks.map(t => `| ${t.id.slice(-8)} | ${t.status} | ${t.subject} | ${t.active_form || ""} |`)
				return `| ID | Status | Subject | Active Form |\n|---|---|---|---|\n${lines.join("\n")}\n\n${tasks.length} task(s).`
			},
		}),

		task_get: tool({
			description: "Get full details of a task by ID (or partial ID match).",
			args: { id: tool.schema.string().describe("Task ID or partial ID") },
			async execute(args: { id: string }, toolCtx: ToolContext): Promise<string> {
				const pid = getProjectId(toolCtx)
				if (!pid) return "Error: no project selected."
				const t = (db.prepare("SELECT * FROM tasks WHERE id=$id AND project_id=$pid").get({ $id: args.id, $pid: pid })
					|| db.prepare("SELECT * FROM tasks WHERE id LIKE $like AND project_id=$pid").get({ $like: `%${args.id}%`, $pid: pid })
				) as TaskRow | null
				if (!t) return `Task not found: "${args.id}"`
				const meta = t.metadata ? `\n**Metadata:** ${t.metadata}` : ""
				return [
					`## ${t.subject}`, ``,
					`**ID:** \`${t.id}\``,
					`**Status:** ${t.status}`,
					t.active_form ? `**Active Form:** ${t.active_form}` : null,
					`**Description:** ${t.description}`,
					`**Created:** ${t.created_at}`,
					`**Updated:** ${t.updated_at}`,
					meta || null,
				].filter(Boolean).join("\n")
			},
		}),

		task_update: tool({
			description: "Update a task's status, subject, description, or active form.",
			args: {
				id: tool.schema.string().describe("Task ID"),
				status: tool.schema.string().optional().describe('"pending", "in_progress", "completed", or "failed"'),
				subject: tool.schema.string().optional().describe("New subject (empty to keep)"),
				description: tool.schema.string().optional().describe("New description (empty to keep)"),
				active_form: tool.schema.string().optional().describe("New active form (empty to keep)"),
			},
			async execute(args: { id: string; status?: string; subject?: string; description?: string; active_form?: string }, toolCtx: ToolContext): Promise<string> {
				const pid = getProjectId(toolCtx)
				if (!pid) return "Error: no project selected."
				const t = (db.prepare("SELECT * FROM tasks WHERE id=$id AND project_id=$pid").get({ $id: args.id, $pid: pid })
					|| db.prepare("SELECT * FROM tasks WHERE id LIKE $like AND project_id=$pid").get({ $like: `%${args.id}%`, $pid: pid })
				) as TaskRow | null
				if (!t) return `Task not found: "${args.id}"`
				const now = new Date().toISOString()
				const updates: string[] = []
				if (args.status) { db.prepare("UPDATE tasks SET status=$s, updated_at=$now WHERE id=$id").run({ $s: args.status, $now: now, $id: t.id }); updates.push(`status → ${args.status}`) }
				if (args.subject) { db.prepare("UPDATE tasks SET subject=$v, updated_at=$now WHERE id=$id").run({ $v: args.subject, $now: now, $id: t.id }); updates.push(`subject updated`) }
				if (args.description) { db.prepare("UPDATE tasks SET description=$v, updated_at=$now WHERE id=$id").run({ $v: args.description, $now: now, $id: t.id }); updates.push(`description updated`) }
				if (args.active_form) { db.prepare("UPDATE tasks SET active_form=$v, updated_at=$now WHERE id=$id").run({ $v: args.active_form, $now: now, $id: t.id }); updates.push(`active form updated`) }
				return updates.length ? `Task **#${t.id.slice(-8)}** updated: ${updates.join(", ")}` : "No changes."
			},
		}),

		task_stop: tool({
			description: "Stop/cancel a task (sets status to failed with reason).",
			args: {
				id: tool.schema.string().describe("Task ID"),
				reason: tool.schema.string().optional().describe("Why the task was stopped"),
			},
			async execute(args: { id: string; reason?: string }, toolCtx: ToolContext): Promise<string> {
				const pid = getProjectId(toolCtx)
				if (!pid) return "Error: no project selected."
				const t = (db.prepare("SELECT * FROM tasks WHERE id=$id AND project_id=$pid").get({ $id: args.id, $pid: pid })
					|| db.prepare("SELECT * FROM tasks WHERE id LIKE $like AND project_id=$pid").get({ $like: `%${args.id}%`, $pid: pid })
				) as TaskRow | null
				if (!t) return `Task not found: "${args.id}"`
				const now = new Date().toISOString()
				const desc = args.reason ? `${t.description}\n\n**Stopped:** ${args.reason}` : t.description
				db.prepare("UPDATE tasks SET status='failed', description=$d, updated_at=$now WHERE id=$id")
					.run({ $d: desc, $now: now, $id: t.id })
				return `Task **#${t.id.slice(-8)}** stopped: ${t.subject}`
			},
		}),
	}
}
