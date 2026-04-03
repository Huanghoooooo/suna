/**
 * Kortix System Plugin — THE unified plugin for the entire Kortix environment.
 *
 * Combines: projects, tasks, sessions, connectors, autowork, continuation,
 * triggers, auth, PTY, and /btw into a single plugin entry point.
 *
 * opencode.jsonc: "./plugin/kortix-system/kortix-system.ts"
 */

import * as path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

// ── Modules ──────────────────────────────────────────────────────────────────

import { initProjectsDb, ProjectManager, projectTools, projectGateHook, projectStatusTransform } from "./projects"
import { taskTools } from "./tasks"
import { resolveKortixWorkspaceRoot, ensureKortixDir } from "./lib/paths"

// ── Plugin ───────────────────────────────────────────────────────────────────

const KortixSystemPlugin: Plugin = async (ctx) => {
	const { client } = ctx

	// ── Core infra ──
	const workspaceRoot = resolveKortixWorkspaceRoot(import.meta.dir)
	const kortixDir = ensureKortixDir(import.meta.dir)
	const db = initProjectsDb(path.join(kortixDir, "kortix.db"))
	const mgr = new ProjectManager(client, workspaceRoot, db)
	let currentSessionId: string | null = null

	// ── Load sub-plugins (each returns hooks/tools to merge) ──
	// Sessions (session_list, session_get, session_search, session_lineage)
	const sessionsModule = (await import("./sessions")).default
	const sessionsResult = await sessionsModule(ctx)

	// Connectors (connector_list, connector_get, connector_setup, connector_remove)
	const connectorsModule = (await import("./connectors")).default
	const connectorsResult = await connectorsModule(ctx)

	// Auth (anthropic OAuth)
	const authModule = (await import("./auth")).default
	const authResult = await authModule(ctx)

	// PTY tools (pty_spawn, pty_read, pty_write, pty_list, pty_kill)
	const ptyModule = (await import("./pty-tools")).default
	const ptyResult = await ptyModule(ctx)

	// Autowork loop (DONE/VERIFIED protocol)
	const autoworkModule = (await import("./autowork/autowork")).default
	const autoworkResult = await autoworkModule(ctx)

	// Passive continuation (todo enforcing)
	const continuationModule = (await import("./continuation/continuation")).default
	const continuationResult = await continuationModule(ctx)

	// Triggers (cron, webhooks)
	const triggersModule = (await import("./triggers")).default
	const triggersResult = await triggersModule(ctx)

	// BTW command
	const btwModule = (await import("./btw")).default
	const btwResult = typeof btwModule === "object" && "server" in btwModule
		? await btwModule.server(ctx)
		: await btwModule(ctx)

	// ── Merge all tools ──
	const allTools = {
		...projectTools(mgr, db),
		...taskTools(db, mgr),
		...(sessionsResult?.tool || {}),
		...(connectorsResult?.tool || {}),
		...(ptyResult?.tool || {}),
	}

	// ── Merge all hooks ──
	return {
		tool: allTools,

		// Auth (anthropic OAuth)
		...(authResult?.auth ? { auth: authResult.auth } : {}),

		// Tool execution gate (project required for file writes)
		"tool.execute.before": projectGateHook(mgr),

		// Project status injection into every message
		"experimental.chat.messages.transform": projectStatusTransform(mgr, () => currentSessionId),

		// System prompt transform (anthropic auth injects Claude Code prefix)
		...(authResult?.["experimental.chat.system.transform"]
			? { "experimental.chat.system.transform": authResult["experimental.chat.system.transform"] }
			: {}),

		// Autowork hooks
		...(autoworkResult?.event ? {} : {}), // autowork registers its own event handler internally

		// BTW command hook
		...(btwResult?.["command.execute.before"]
			? { "command.execute.before": btwResult["command.execute.before"] }
			: {}),

		// Events: session tracking + PTY cleanup + autowork + continuation
		event: async (payload: any) => {
			const sid = payload?.event?.properties?.sessionID
			if (sid && payload.event.type === "session.created") {
				currentSessionId = sid
			}
			// Delegate to sub-plugins that need events
			if (ptyResult?.event) await ptyResult.event(payload).catch(() => {})
			if (autoworkResult?.event) await autoworkResult.event(payload).catch(() => {})
			if (continuationResult?.event) await continuationResult.event(payload).catch(() => {})
		},

		// Compaction context
		"experimental.session.compacting": async (_input: any, output: { context: string[] }) => {
			// Add active tasks to compaction context
			try {
				if (!currentSessionId) return
				const project = mgr.getSessionProject(currentSessionId)
				if (!project) return
				const tasks = db.prepare("SELECT * FROM tasks WHERE project_id=$pid AND status IN ('pending','in_progress') ORDER BY created_at")
					.all({ $pid: project.id }) as Array<{ id: string; subject: string; status: string }>
				if (!tasks.length) return
				const inner = [
					"<kortix-tasks>",
					`Project: ${project.name}`,
					...tasks.map(t => `- [${t.status}] #${t.id.slice(-8)}: ${t.subject}`),
					"</kortix-tasks>",
				].join("\n")
				output.context.push(`<kortix_system type="tasks" source="kortix-system">${inner}</kortix_system>`)
			} catch {}
		},
	}
}

export default KortixSystemPlugin
