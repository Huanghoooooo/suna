/**
 * Kortix System Plugin — THE single plugin for the entire Kortix environment.
 *
 * Projects, agents, tasks, sessions, connectors, autowork, todo-enforcer,
 * triggers, auth, PTY, worktree, and /btw.
 *
 * All native OpenCode tools (task, todowrite, todoread) are disabled.
 * Kortix provides its own: agent_spawn/message/stop/status + task_create/list/update/done/delete.
 *
 * opencode.jsonc: "./plugin/kortix-system/kortix-system.ts"
 */

import * as path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

import { initProjectsDb, ProjectManager, projectTools, projectGateHook, projectStatusTransform } from "./projects"
import { taskTools, ensureTasksTable } from "./tasks"
import { agentTools, ensureAgentsTable } from "./agent"
import { resolveKortixWorkspaceRoot, ensureKortixDir } from "./lib/paths"

const KortixSystemPlugin: Plugin = async (ctx) => {
	const { client } = ctx

	// ── Core infra ──
	const workspaceRoot = resolveKortixWorkspaceRoot(import.meta.dir)
	const kortixDir = ensureKortixDir(import.meta.dir)
	const db = initProjectsDb(path.join(kortixDir, "kortix.db"))
	ensureTasksTable(db)
	ensureAgentsTable(db)
	const mgr = new ProjectManager(client, workspaceRoot, db)
	let currentSessionId: string | null = null

	// ── Load sub-modules ──
	const sessions = await (await import("./sessions")).default(ctx)
	const connectors = await (await import("./connectors")).default(ctx)
	const auth = await (await import("./auth")).default(ctx)
	const pty = await (await import("./pty-tools")).default(ctx)
	const autowork = await (await import("./autowork/autowork")).default(ctx)
	const todoEnforcer = await (await import("./todo-enforcer/todo-enforcer")).default(ctx)
	const triggers = await (await import("./triggers")).default(ctx)
	const worktreeModule = await (await import("./worktree/worktree")).default(ctx)

	const btwRaw = (await import("./btw")).default
	const btw = typeof btwRaw === "object" && "server" in btwRaw
		? await btwRaw.server(ctx)
		: await btwRaw(ctx)

	// ── Merge all tools ──
	return {
		tool: {
			...projectTools(mgr, db),
			...taskTools(db, mgr),
			...agentTools(client, db, mgr),
			...(sessions?.tool || {}),
			...(connectors?.tool || {}),
			...(pty?.tool || {}),
			...(worktreeModule?.tool || {}),
		},

		// Auth
		...(auth?.auth ? { auth: auth.auth } : {}),

		// Project gate (file writes require project)
		"tool.execute.before": projectGateHook(mgr),

		// Project status + active tasks injection
		"experimental.chat.messages.transform": projectStatusTransform(mgr, () => currentSessionId),

		// System prompt transform (anthropic auth)
		...(auth?.["experimental.chat.system.transform"]
			? { "experimental.chat.system.transform": auth["experimental.chat.system.transform"] }
			: {}),

		// BTW command
		...(btw?.["command.execute.before"]
			? { "command.execute.before": btw["command.execute.before"] }
			: {}),

		// Events
		event: async (payload: any) => {
			const sid = payload?.event?.properties?.sessionID
			if (sid && payload.event.type === "session.created") currentSessionId = sid
			if (pty?.event) await pty.event(payload).catch(() => {})
			if (autowork?.event) await autowork.event(payload).catch(() => {})
			if (todoEnforcer?.event) await todoEnforcer.event(payload).catch(() => {})
			if (worktreeModule?.event) await worktreeModule.event(payload).catch(() => {})
		},

		// Compaction: inject active tasks
		"experimental.session.compacting": async (_input: any, output: { context: string[] }) => {
			try {
				if (!currentSessionId) return
				const project = mgr.getSessionProject(currentSessionId)
				if (!project) return
				const tasks = db.prepare("SELECT * FROM tasks WHERE project_id=$pid AND status IN ('pending','in_progress','blocked') ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END, created_at")
					.all({ $pid: project.id }) as Array<{ id: string; title: string; status: string; priority: string }>
				if (!tasks.length) return
				const icon = (s: string) => s === "in_progress" ? "→" : s === "blocked" ? "⊘" : "○"
				output.context.push([
					`<kortix_system type="tasks" source="kortix-system">`,
					`Active tasks for project ${project.name}:`,
					...tasks.map(t => `${icon(t.status)} [${t.priority}] ${t.id}: ${t.title}`),
					`</kortix_system>`,
				].join("\n"))
			} catch {}
		},
	}
}

export default KortixSystemPlugin
