/**
 * Unified agent_task system.
 *
 * 4 tools, 1 table, 1 event handler:
 *   agent_task        — create (+ optionally auto-run)
 *   agent_task_update — start / approve / cancel / message
 *   agent_task_list   — list tasks
 *   agent_task_get    — get task details
 *
 * Statuses: planned, in_progress, input_needed, completed, cancelled
 *
 * Workers have ZERO task tools. They work, finish, system captures output
 * → task moves to input_needed → <agent_task_completed> injected into parent.
 */

import { Database } from "bun:sqlite"
import { tool, type ToolContext } from "@opencode-ai/plugin"
import type { ProjectManager, ProjectRow } from "./projects"
import { ensureSchema } from "./lib/schema"

// ── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus =
	| "todo"
	| "in_progress"
	| "input_needed"
	| "completed"
	| "cancelled"

export interface TaskRow {
	id: string
	project_id: string
	title: string
	description: string
	verification_condition: string
	status: TaskStatus
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

// ── Session tracking ─────────────────────────────────────────────────────────

let autoworkActiveSessions: Set<string>
try {
	const mod = require("./autowork/autowork")
	autoworkActiveSessions = mod.autoworkActiveSessions ?? new Set<string>()
} catch {
	autoworkActiveSessions = new Set<string>()
}

export const activeTaskSessions = new Set<string>()

const taskSystemPrompts = new Map<string, string>()

export function getTaskSystemPrompt(sessionId: string): string | undefined {
	return taskSystemPrompts.get(sessionId)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
	return `task-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function nowIso(): string {
	return new Date().toISOString()
}

function isTerminal(status: TaskStatus): boolean {
	return status === "completed" || status === "cancelled"
}

// ── DB Schema ────────────────────────────────────────────────────────────────

export function ensureAgentTasksTable(db: Database): void {
	ensureSchema(db, "tasks", [
		{ name: "id", type: "TEXT", notNull: true, defaultValue: null, primaryKey: true },
		{ name: "project_id", type: "TEXT", notNull: true, defaultValue: null, primaryKey: false },
		{ name: "title", type: "TEXT", notNull: true, defaultValue: null, primaryKey: false },
		{ name: "description", type: "TEXT", notNull: true, defaultValue: "''", primaryKey: false },
		{ name: "verification_condition", type: "TEXT", notNull: true, defaultValue: "''", primaryKey: false },
		{ name: "status", type: "TEXT", notNull: true, defaultValue: "'todo'", primaryKey: false },
		{ name: "result", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "verification_summary", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "blocking_question", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "owner_session_id", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "owner_agent", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "parent_session_id", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "started_at", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "completed_at", type: "TEXT", notNull: false, defaultValue: null, primaryKey: false },
		{ name: "created_at", type: "TEXT", notNull: true, defaultValue: null, primaryKey: false },
		{ name: "updated_at", type: "TEXT", notNull: true, defaultValue: null, primaryKey: false },
	])
}

// ── Core: spawn worker for a task ────────────────────────────────────────────

async function spawnWorkerForTask(
	client: any,
	db: Database,
	mgr: ProjectManager,
	task: TaskRow,
	parentSessionId: string,
): Promise<TaskRow> {
	const project = db.prepare("SELECT * FROM projects WHERE id=$id").get({ $id: task.project_id }) as ProjectRow | null
	if (!project) throw new Error(`Project not found for task ${task.id}`)

	const sessionResult = await client.session.create({
		body: {
			parentID: parentSessionId,
			title: `${task.title} [${task.id}]`,
		},
	})
	const childSessionId = sessionResult.data?.id
	if (!childSessionId) throw new Error("Failed to create worker session")

	mgr.setSessionProject(childSessionId, project.id)

	let model: { modelID: string; providerID: string } | undefined
	try {
		const msgs = await client.session.messages({ path: { id: parentSessionId } })
		const last = (msgs.data ?? []).filter((m: any) => m.info?.role === "assistant").pop()
		if (last?.info?.modelID) model = { modelID: last.info.modelID, providerID: last.info.providerID || "anthropic" }
	} catch {}

	const verificationFlag = task.verification_condition
		? ` --verification "${task.verification_condition.replace(/"/g, '\\"')}"`
		: ""
	const prompt = [
		`/autowork --completion-promise TASK_COMPLETE --max-iterations 50${verificationFlag}`,
		"",
		`You are executing a task. Work autonomously until done.`,
		"",
		`Project: ${project.name} (${project.path})`,
		"",
		`Task: ${task.title}`,
		task.description ? `Description: ${task.description}` : "",
		task.verification_condition ? `Verification: ${task.verification_condition}` : "",
		"",
		`FIRST: run project_select("${project.name}")`,
		`Then do the work. When done, emit TASK_COMPLETE.`,
	].filter(Boolean).join("\n")

	activeTaskSessions.add(childSessionId)

	try {
		await client.session.promptAsync({
			path: { id: childSessionId },
			body: {
				agent: "worker",
				...(model && { model }),
				parts: [{ type: "text", text: prompt }],
			},
		})
	} catch (err: unknown) {
		activeTaskSessions.delete(childSessionId)
		db.prepare("UPDATE tasks SET status='cancelled', result=$r, updated_at=$now WHERE id=$id")
			.run({ $r: `Failed to start worker: ${err}`, $now: nowIso(), $id: task.id })
		throw new Error(`Failed to start worker for task ${task.id}: ${err}`)
	}

	const now = nowIso()
	return db.prepare(`UPDATE tasks SET
		status='in_progress', owner_session_id=$sid, owner_agent='worker',
		parent_session_id=$psid, started_at=COALESCE(started_at, $now), updated_at=$now
		WHERE id=$id RETURNING *`)
		.get({ $sid: childSessionId, $psid: parentSessionId, $now: now, $id: task.id }) as TaskRow
}

// ── Tools ────────────────────────────────────────────────────────────────────

export function agentTaskTools(db: Database, mgr: ProjectManager, client: any) {
	function getProjectId(ctx: ToolContext): string | null {
		if (!ctx?.sessionID) return null
		return mgr.getSessionProject(ctx.sessionID)?.id || null
	}

	return {
		// ── agent_task: create (+ optionally auto-run) ───────────
		agent_task: tool({
			description: [
				"Create a task. By default, immediately spawns a worker to execute it.",
				"Set autostart=false to create without running (stays in planned for later).",
				"Worker runs autonomously in a autowork loop. Result comes back as <agent_task_completed>.",
			].join(" "),
			args: {
				title: tool.schema.string().describe("What needs to be done"),
				description: tool.schema.string().optional().describe("Detailed scope and instructions for the worker"),
				verification_condition: tool.schema.string().optional().describe("How to verify the task is done"),
				autostart: tool.schema.boolean().optional().describe("Auto-spawn worker (default: true). Set false to plan without running."),
				status: tool.schema.string().optional().describe('Only used with autostart=false. Default: "todo".'),
			},
			async execute(args: { title: string; description?: string; verification_condition?: string; autostart?: boolean; status?: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."

				const shouldStart = args.autostart !== false
				const initialStatus = "todo"
				const id = genId()
				const now = nowIso()

				db.prepare(`INSERT INTO tasks (id, project_id, title, description, verification_condition, status, created_at, updated_at)
					VALUES ($id, $pid, $title, $desc, $vc, $status, $now, $now)`).run({
					$id: id, $pid: pid, $title: args.title, $desc: args.description || "",
					$vc: args.verification_condition || "", $status: initialStatus, $now: now,
				})

				if (!shouldStart) {
					return `Task **${id}** created: ${args.title} [${initialStatus}]`
				}

				const task = db.prepare("SELECT * FROM tasks WHERE id=$id").get({ $id: id }) as TaskRow
				try {
					const started = await spawnWorkerForTask(client, db, mgr, task, ctx.sessionID!)
					return `Task **${id}** created and started. Worker session: ${started.owner_session_id}`
				} catch (err) {
					return `Task **${id}** created but failed to start worker: ${err}`
				}
			},
		}),

		// ── agent_task_update: start / approve / cancel / message ─
		agent_task_update: tool({
			description: [
				"Update a task. Actions:",
				'  "start" — spawn a worker for a planned task',
				'  "approve" — approve an input_needed task → completed',
				'  "cancel" — cancel task + abort worker session if running',
				'  "message" — send a follow-up message to the running worker',
			].join("\n"),
			args: {
				id: tool.schema.string().describe("Task ID"),
				action: tool.schema.string().describe('"start", "approve", "cancel", or "message"'),
				message: tool.schema.string().optional().describe("Message to send (required for action=message)"),
			},
			async execute(args: { id: string; action: string; message?: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const task = db.prepare("SELECT * FROM tasks WHERE id=$id AND project_id=$pid").get({ $id: args.id, $pid: pid }) as TaskRow | null
				if (!task) return `Task not found: ${args.id}`

				const now = nowIso()

				switch (args.action) {
					case "start": {
						if (task.status === "in_progress") return "Task is already running."
						if (isTerminal(task.status)) return `Cannot start a ${task.status} task.`
						try {
							const started = await spawnWorkerForTask(client, db, mgr, task, ctx.sessionID!)
							return `Task **${task.id}** started. Worker session: ${started.owner_session_id}`
						} catch (err) {
							return `Task **${task.id}** failed to start: ${err}`
						}
					}

					case "approve": {
						if (task.status !== "input_needed") return `Can only approve input_needed tasks (current: ${task.status}).`
						db.prepare("UPDATE tasks SET status='completed', completed_at=$now, updated_at=$now WHERE id=$id")
							.run({ $now: now, $id: task.id })
						return `Task **${task.id}** approved and completed.`
					}

					case "cancel": {
						if (task.status === "completed") return "Cannot cancel a completed task."
						if (task.owner_session_id && task.status === "in_progress") {
							try { await client.session.abort({ path: { id: task.owner_session_id } }) } catch {}
							activeTaskSessions.delete(task.owner_session_id)
						}
						db.prepare("UPDATE tasks SET status='cancelled', completed_at=COALESCE(completed_at, $now), updated_at=$now WHERE id=$id")
							.run({ $now: now, $id: task.id })
						return `Task **${task.id}** cancelled.`
					}

					case "message": {
						if (!args.message) return "Error: message is required for action=message."
						if (!task.owner_session_id) return "Task has no active session."
						activeTaskSessions.add(task.owner_session_id)
						if (task.status !== "in_progress") {
							db.prepare("UPDATE tasks SET status='in_progress', updated_at=$now WHERE id=$id")
								.run({ $now: now, $id: task.id })
						}
						client.session.promptAsync({
							path: { id: task.owner_session_id },
							body: { parts: [{ type: "text", text: args.message }] },
						}).catch(() => {})
						return `Message sent to task **${task.id}** worker.`
					}

					default:
						return `Unknown action: ${args.action}. Use "start", "approve", "cancel", or "message".`
				}
			},
		}),

		// ── agent_task_list ──────────────────────────────────────
		agent_task_list: tool({
			description: "List all tasks in the current project.",
			args: {
				status: tool.schema.string().optional().describe("Filter by status"),
			},
			async execute(args: { status?: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				let q = "SELECT * FROM tasks WHERE project_id=$pid"
				const params: Record<string, string> = { $pid: pid }
				if (args.status) { q += " AND status=$s"; params.$s = args.status }
				q += " ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'input_needed' THEN 1 WHEN 'todo' THEN 2 WHEN 'completed' THEN 3 WHEN 'cancelled' THEN 4 ELSE 9 END, created_at DESC LIMIT 100"
				const tasks = db.prepare(q).all(params) as TaskRow[]
				if (!tasks.length) return args.status ? `No ${args.status} tasks.` : "No tasks in this project."
				const icon = (s: string) => s === "in_progress" ? "→" : s === "input_needed" ? "◐" : s === "completed" ? "✓" : s === "cancelled" ? "✗" : "○"
				return tasks.map((t) => `${icon(t.status)} **${t.id}** ${t.title} — ${t.status}${t.owner_session_id ? ` [session: ${t.owner_session_id}]` : ""}`).join("\n")
			},
		}),

		// ── agent_task_get ───────────────────────────────────────
		agent_task_get: tool({
			description: "Get full details of a task including result.",
			args: {
				id: tool.schema.string().describe("Task ID"),
			},
			async execute(args: { id: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const task = db.prepare("SELECT * FROM tasks WHERE id=$id AND project_id=$pid").get({ $id: args.id, $pid: pid }) as TaskRow | null
				if (!task) return `Task not found: ${args.id}`
				const lines = [
					`## ${task.title}`,
					"",
					`**ID:** ${task.id}`,
					`**Status:** ${task.status}`,
					`**Session:** ${task.owner_session_id || "—"}`,
					`**Description:** ${task.description || "—"}`,
					`**Verification:** ${task.verification_condition || "—"}`,
				]
				if (task.result) lines.push(`**Result:** ${task.result}`)
				if (task.verification_summary) lines.push(`**Verification Summary:** ${task.verification_summary}`)
				if (task.blocking_question) lines.push(`**Blocking Question:** ${task.blocking_question}`)
				return lines.join("\n")
			},
		}),
	}
}

// ── Session event handler ────────────────────────────────────────────────────

export async function handleAgentTaskSessionEvent(
	sessionId: string,
	eventType: string,
	client: any,
	db: Database,
): Promise<void> {
	if (!activeTaskSessions.has(sessionId)) return

	const task = db.prepare("SELECT * FROM tasks WHERE owner_session_id=$sid AND status='in_progress'")
		.get({ $sid: sessionId }) as TaskRow | null
	if (!task) return

	if (eventType === "session.idle") {
		if (autoworkActiveSessions.has(sessionId)) return

		let result = "(no output)"
		try {
			const msgs = await client.session.messages({ path: { id: sessionId } })
			result = (msgs.data ?? [])
				.filter((m: any) => m.info?.role === "assistant")
				.flatMap((m: any) => m.parts ?? [])
				.filter((p: any) => p.type === "text")
				.pop()?.text || result
		} catch {}

		const now = nowIso()
		db.prepare("UPDATE tasks SET status='input_needed', result=$r, updated_at=$now WHERE id=$id")
			.run({ $r: result.slice(0, 8000), $now: now, $id: task.id })

		activeTaskSessions.delete(sessionId)

		if (task.parent_session_id) {
			try {
				await client.session.promptAsync({
					path: { id: task.parent_session_id },
					body: { parts: [{ type: "text", text: [
						"<agent_task_completed>",
						`Task: ${task.id}`,
						`Title: ${task.title}`,
						`Session: ${task.owner_session_id}`,
						"",
						result.slice(0, 8000),
						"</agent_task_completed>",
					].join("\n") }] },
				})
			} catch {}
		}
		return
	}

	if (eventType === "session.error" || eventType === "session.aborted") {
		let errorMsg = `Worker ${eventType === "session.aborted" ? "aborted" : "errored"}`
		try {
			const msgs = await client.session.messages({ path: { id: sessionId } })
			errorMsg = (msgs.data ?? [])
				.filter((m: any) => m.info?.role === "assistant")
				.flatMap((m: any) => m.parts ?? [])
				.filter((p: any) => p.type === "text")
				.pop()?.text || errorMsg
		} catch {}

		const now = nowIso()
		db.prepare("UPDATE tasks SET status='cancelled', result=$r, completed_at=COALESCE(completed_at, $now), updated_at=$now WHERE id=$id")
			.run({ $r: errorMsg.slice(0, 8000), $now: now, $id: task.id })

		activeTaskSessions.delete(sessionId)

		if (task.parent_session_id) {
			try {
				await client.session.promptAsync({
					path: { id: task.parent_session_id },
					body: { parts: [{ type: "text", text: [
						"<agent_task_failed>",
						`Task: ${task.id}`,
						`Title: ${task.title}`,
						`Error: ${errorMsg.slice(0, 2000)}`,
						"</agent_task_failed>",
					].join("\n") }] },
				})
			} catch {}
		}
	}
}
