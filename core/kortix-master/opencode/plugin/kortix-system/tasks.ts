/**
 * Kortix Task System — per-project task tracking.
 *
 * Replaces OpenCode's native todowrite/todoread with a project-scoped system.
 * Tasks live in SQLite (kortix.db), scoped to the active project.
 *
 * Tools:
 *   - task_create: Create a task in the current project
 *   - task_list:   List tasks (with optional status filter)
 *   - task_update: Update task status, description, or notes
 *   - task_done:   Mark a task as completed with optional result
 *   - task_delete: Remove a task
 */

import { Database } from "bun:sqlite"
import { tool, type ToolContext } from "@opencode-ai/plugin"
import type { ProjectManager } from "./projects"

export type TaskStatus = "pending" | "in_progress" | "done" | "blocked" | "cancelled"

export interface TaskRow {
	id: string
	project_id: string
	title: string
	description: string
	status: TaskStatus
	result: string | null
	priority: string
	created_at: string
	updated_at: string
}

function taskId(): string {
	return `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

export function ensureTasksTable(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS tasks (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			title TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'pending',
			result TEXT,
			priority TEXT NOT NULL DEFAULT 'medium',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)
	`)
}

export function taskTools(db: Database, mgr: ProjectManager) {
	function getProjectId(ctx: ToolContext): string | null {
		if (!ctx?.sessionID) return null
		return mgr.getSessionProject(ctx.sessionID)?.id || null
	}

	return {
		task_create: tool({
			description: "Create a task in the current project. Returns the task ID.",
			args: {
				title: tool.schema.string().describe("Brief title (what needs to be done)"),
				description: tool.schema.string().optional().describe("Detailed description or acceptance criteria"),
				priority: tool.schema.string().optional().describe('"high", "medium" (default), or "low"'),
				status: tool.schema.string().optional().describe('"pending" (default), "in_progress", "blocked"'),
			},
			async execute(args: { title: string; description?: string; priority?: string; status?: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const id = taskId()
				const now = new Date().toISOString()
				db.prepare(`INSERT INTO tasks (id, project_id, title, description, status, priority, created_at, updated_at)
					VALUES ($id, $pid, $title, $desc, $status, $priority, $now, $now)`)
					.run({
						$id: id, $pid: pid, $title: args.title,
						$desc: args.description || "", $status: args.status || "pending",
						$priority: args.priority || "medium", $now: now,
					})
				return `Task **${id}** created: ${args.title}`
			},
		}),

		task_list: tool({
			description: "List tasks in the current project. Shows all by default, or filter by status.",
			args: {
				status: tool.schema.string().optional().describe('Filter: "pending", "in_progress", "done", "blocked", "cancelled", or "" for all'),
			},
			async execute(args: { status?: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				let q = "SELECT * FROM tasks WHERE project_id=$pid"
				const params: Record<string, string> = { $pid: pid }
				if (args.status) { q += " AND status=$s"; params.$s = args.status }
				q += " ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END, created_at DESC LIMIT 50"
				const tasks = db.prepare(q).all(params) as TaskRow[]
				if (!tasks.length) return args.status ? `No ${args.status} tasks.` : "No tasks in this project."
				const icon = (s: string) => s === "done" ? "✓" : s === "in_progress" ? "→" : s === "blocked" ? "⊘" : s === "cancelled" ? "✗" : "○"
				const lines = tasks.map(t => `${icon(t.status)} **${t.id}** [${t.priority}] ${t.title}${t.result ? ` — ${t.result.slice(0, 60)}` : ""}`)
				return lines.join("\n") + `\n\n${tasks.length} task(s).`
			},
		}),

		task_update: tool({
			description: "Update a task's status, title, description, or priority.",
			args: {
				id: tool.schema.string().describe("Task ID"),
				status: tool.schema.string().optional().describe('"pending", "in_progress", "done", "blocked", "cancelled"'),
				title: tool.schema.string().optional().describe("New title"),
				description: tool.schema.string().optional().describe("New description"),
				priority: tool.schema.string().optional().describe('"high", "medium", "low"'),
				result: tool.schema.string().optional().describe("Result or completion notes"),
			},
			async execute(args: { id: string; status?: string; title?: string; description?: string; priority?: string; result?: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const t = db.prepare("SELECT * FROM tasks WHERE (id=$id OR id LIKE $like) AND project_id=$pid")
					.get({ $id: args.id, $like: `%${args.id}%`, $pid: pid }) as TaskRow | null
				if (!t) return `Task not found: "${args.id}"`
				const now = new Date().toISOString()
				const updates: string[] = []
				if (args.status) { db.prepare("UPDATE tasks SET status=$v, updated_at=$now WHERE id=$id").run({ $v: args.status, $now: now, $id: t.id }); updates.push(`status → ${args.status}`) }
				if (args.title) { db.prepare("UPDATE tasks SET title=$v, updated_at=$now WHERE id=$id").run({ $v: args.title, $now: now, $id: t.id }); updates.push(`title updated`) }
				if (args.description) { db.prepare("UPDATE tasks SET description=$v, updated_at=$now WHERE id=$id").run({ $v: args.description, $now: now, $id: t.id }); updates.push(`description updated`) }
				if (args.priority) { db.prepare("UPDATE tasks SET priority=$v, updated_at=$now WHERE id=$id").run({ $v: args.priority, $now: now, $id: t.id }); updates.push(`priority → ${args.priority}`) }
				if (args.result) { db.prepare("UPDATE tasks SET result=$v, updated_at=$now WHERE id=$id").run({ $v: args.result, $now: now, $id: t.id }); updates.push(`result recorded`) }
				return updates.length ? `Task **${t.id}** updated: ${updates.join(", ")}` : "No changes."
			},
		}),

		task_done: tool({
			description: "Mark a task as completed with an optional result summary.",
			args: {
				id: tool.schema.string().describe("Task ID"),
				result: tool.schema.string().optional().describe("What was accomplished"),
			},
			async execute(args: { id: string; result?: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const t = db.prepare("SELECT * FROM tasks WHERE (id=$id OR id LIKE $like) AND project_id=$pid")
					.get({ $id: args.id, $like: `%${args.id}%`, $pid: pid }) as TaskRow | null
				if (!t) return `Task not found: "${args.id}"`
				const now = new Date().toISOString()
				db.prepare("UPDATE tasks SET status='done', result=$r, updated_at=$now WHERE id=$id")
					.run({ $r: args.result || null, $now: now, $id: t.id })
				return `Task **${t.id}** completed: ${t.title}`
			},
		}),

		task_delete: tool({
			description: "Delete a task from the current project.",
			args: { id: tool.schema.string().describe("Task ID") },
			async execute(args: { id: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const t = db.prepare("SELECT * FROM tasks WHERE (id=$id OR id LIKE $like) AND project_id=$pid")
					.get({ $id: args.id, $like: `%${args.id}%`, $pid: pid }) as TaskRow | null
				if (!t) return `Task not found: "${args.id}"`
				db.prepare("DELETE FROM tasks WHERE id=$id").run({ $id: t.id })
				return `Task **${t.id}** deleted: ${t.title}`
			},
		}),
	}
}
