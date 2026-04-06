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
import { agentTools, ensureAgentsTable, getAgentSystemPrompt, handleAgentSessionEvent } from "./agent"
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
	// Load sub-modules — each wrapped in try/catch so one failure doesn't kill the whole plugin
	const load = async (name: string, fn: () => Promise<any>) => {
		try { return await fn() } catch (e) { console.warn(`[kortix-system] ${name} init failed:`, (e as Error).message); return null }
	}

	const sessions = await load("sessions", () => import("./sessions").then(m => m.default(ctx)))
	const connectors = await load("connectors", () => import("./connectors").then(m => m.default(ctx)))
	const auth = await load("auth", () => import("./auth").then(m => m.default(ctx)))
	const pty = await load("pty", () => import("./pty-tools").then(m => m.default(ctx)))
	const autowork = await load("autowork", () => import("./autowork/autowork").then(m => m.default(ctx)))
	// todo-enforcer DISABLED — it depends on native todowrite/todoread which are disabled.
	// Will be reimplemented to use our task system instead.
	const todoEnforcer: any = null
	const triggers = await load("triggers", () => import("./triggers").then(m => m.default(ctx)))
	const worktreeModule = await load("worktree", () => import("./worktree/worktree").then(m => m.default(ctx)))
	const btw = await load("btw", async () => {
		const btwRaw = (await import("./btw")).default
		return typeof btwRaw === "object" && "server" in btwRaw ? await btwRaw.server(ctx) : await btwRaw(ctx)
	})
	
	console.log("[kortix-system] Plugin initialized. Tools:", Object.keys(projectTools(mgr, db)).length, "project +", Object.keys(taskTools(db, mgr)).length, "task +", Object.keys(agentTools(client, db, mgr)).length, "agent")

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

		// System prompt transform — chains auth + agent mission prompt
		"experimental.chat.system.transform": async (input: any, output: { system: string[] }) => {
			// Run auth transform first (anthropic prefix)
			if (auth?.["experimental.chat.system.transform"]) {
				await auth["experimental.chat.system.transform"](input, output)
			}
			// Inject agent mission-specific system prompt if this is a worker session
			if (currentSessionId) {
				const missionPrompt = getAgentSystemPrompt(currentSessionId)
				if (missionPrompt) {
					output.system.push(`\n## Mission\n${missionPrompt}`)
				}
			}
		},

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

			// Agent async completion — runs last so autowork has already updated its active set
			if (sid && (
				payload.event.type === "session.idle" ||
				payload.event.type === "session.error" ||
				payload.event.type === "session.aborted"
			)) {
				handleAgentSessionEvent(sid, payload.event.type, client, db).catch(() => {})
			}
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
