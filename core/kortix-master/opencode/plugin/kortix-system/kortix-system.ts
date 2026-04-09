/**
 * Kortix System Plugin — THE single plugin for the entire Kortix environment.
 *
 * Projects, agents, tasks, sessions, connectors, autowork, todo-enforcer,
 * triggers, auth, PTY, worktree, and /btw.
 *
 * Native OpenCode task is disabled, but native todowrite/todoread can be used
 * alongside Kortix project tasks to support Ralph-style persistent worker loops.
 * Kortix also provides its own: agent_spawn/message/stop/status + task_create/list/update/done/delete.
 *
 * opencode.jsonc: "./plugin/kortix-system/kortix-system.ts"
 */

import * as path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

import { initProjectsDb, ProjectManager, projectTools, projectGateHook, projectStatusTransform } from "./projects"
import { taskTools, ensureTasksTable, handleTaskSessionEvent } from "./tasks"
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
	const ralph = await load("ralph", () => import("./ralph/ralph").then(m => m.default(ctx)))
	const todoEnforcer = await load("todo-enforcer", () => import("./todo-enforcer/todo-enforcer").then(m => m.default(ctx)))
	const triggers = await load("triggers", () => import("./triggers").then(m => m.default(ctx)))
	const worktreeModule = await load("worktree", () => import("./worktree/worktree").then(m => m.default(ctx)))
	const btw = await load("btw", async () => {
		const btwRaw = (await import("./btw")).default
		return typeof btwRaw === "object" && "server" in btwRaw ? await btwRaw.server(ctx) : await btwRaw(ctx)
	})
	
	console.log("[kortix-system] Plugin initialized. Tools:", Object.keys(projectTools(mgr, db)).length, "project +", Object.keys(taskTools(db, mgr, client)).length, "task +", Object.keys(agentTools(client, db, mgr)).length, "agent")

	// ── Merge all tools ──
	return {
		tool: {
			...projectTools(mgr, db),
			...taskTools(db, mgr, client),
			...agentTools(client, db, mgr),
			...(sessions?.tool || {}),
			...(connectors?.tool || {}),
			...(triggers?.tool || {}),
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
		"command.execute.before": async (input: any, output: any) => {
			if (ralph?.["command.execute.before"]) {
				await ralph["command.execute.before"](input, output).catch(() => {})
			}
			if (btw?.["command.execute.before"]) {
				await btw["command.execute.before"](input, output).catch(() => {})
			}
		},

		"chat.message": async (input: any, output: any) => {
			if (ralph?.["chat.message"]) {
				await ralph["chat.message"](input, output).catch(() => {})
			}
			if (todoEnforcer?.["chat.message"]) {
				await todoEnforcer["chat.message"](input, output).catch(() => {})
			}
		},

		// Events
		event: async (payload: any) => {
			const sid = payload?.event?.properties?.sessionID
			if (sid && payload.event.type === "session.created") currentSessionId = sid
			if (pty?.event) await pty.event(payload).catch(() => {})
			if (ralph?.event) await ralph.event(payload).catch(() => {})
			if (todoEnforcer?.event) await todoEnforcer.event(payload).catch(() => {})
			if (worktreeModule?.event) await worktreeModule.event(payload).catch(() => {})

			// Agent async completion — runs last so autowork has already updated its active set
			if (sid && (
				payload.event.type === "session.idle" ||
				payload.event.type === "session.error" ||
				payload.event.type === "session.aborted"
			)) {
				handleTaskSessionEvent(sid, payload.event.type, client, db).catch(() => {})
				handleAgentSessionEvent(sid, payload.event.type, client, db).catch(() => {})
			}
		},

		// Compaction: inject active tasks
		"experimental.session.compacting": async (_input: any, output: { context: string[] }) => {
			try {
				if (!currentSessionId) return
				const project = mgr.getSessionProject(currentSessionId)
				if (!project) return
				const tasks = db.prepare("SELECT * FROM tasks WHERE project_id=$pid AND status IN ('todo','in_progress','in_review') ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'in_review' THEN 1 WHEN 'todo' THEN 2 ELSE 3 END, created_at")
					.all({ $pid: project.id }) as Array<{ id: string; title: string; status: string }>
				if (!tasks.length) return
				const icon = (s: string) => s === "in_progress" ? "→" : s === "in_review" ? "◐" : "○"
				output.context.push([
					`<kortix_system type="tasks" source="kortix-system">`,
					`Active tasks for project ${project.name}:`,
					...tasks.map(t => `${icon(t.status)} ${t.id}: ${t.title}`),
					`</kortix_system>`,
				].join("\n"))
			} catch {}
		},
	}
}

export default KortixSystemPlugin
