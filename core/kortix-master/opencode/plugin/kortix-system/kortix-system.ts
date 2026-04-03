/**
 * Kortix System Plugin — THE single plugin for the entire Kortix environment.
 *
 * Everything: projects, tasks, sessions, connectors, autowork, todo-enforcer,
 * triggers, auth, PTY, worktree, and /btw.
 *
 * opencode.jsonc: "./plugin/kortix-system/kortix-system.ts"
 */

import * as path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

import { initProjectsDb, ProjectManager, projectTools, projectGateHook, projectStatusTransform } from "./projects"
import { taskTools } from "./tasks"
import { resolveKortixWorkspaceRoot, ensureKortixDir } from "./lib/paths"

const KortixSystemPlugin: Plugin = async (ctx) => {
	const { client } = ctx

	// ── Core infra ──
	const workspaceRoot = resolveKortixWorkspaceRoot(import.meta.dir)
	const kortixDir = ensureKortixDir(import.meta.dir)
	const db = initProjectsDb(path.join(kortixDir, "kortix.db"))
	const mgr = new ProjectManager(client, workspaceRoot, db)
	let currentSessionId: string | null = null

	// ── Load all sub-modules ──
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
			...(sessions?.tool || {}),
			...(connectors?.tool || {}),
			...(pty?.tool || {}),
			...(worktreeModule?.tool || {}),
		},

		// Auth
		...(auth?.auth ? { auth: auth.auth } : {}),

		// Project gate (file writes require project)
		"tool.execute.before": projectGateHook(mgr),

		// Project status injection
		"experimental.chat.messages.transform": projectStatusTransform(mgr, () => currentSessionId),

		// System prompt transform (anthropic auth)
		...(auth?.["experimental.chat.system.transform"]
			? { "experimental.chat.system.transform": auth["experimental.chat.system.transform"] }
			: {}),

		// BTW command
		...(btw?.["command.execute.before"]
			? { "command.execute.before": btw["command.execute.before"] }
			: {}),

		// Events — fan out to all sub-modules that need them
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
				const tasks = db.prepare("SELECT * FROM tasks WHERE project_id=$pid AND status IN ('pending','in_progress') ORDER BY created_at")
					.all({ $pid: project.id }) as Array<{ id: string; subject: string; status: string }>
				if (!tasks.length) return
				output.context.push(`<kortix_system type="tasks" source="kortix-system">\n${tasks.map(t => `- [${t.status}] #${t.id.slice(-8)}: ${t.subject}`).join("\n")}\n</kortix_system>`)
			} catch {}
		},
	}
}

export default KortixSystemPlugin
