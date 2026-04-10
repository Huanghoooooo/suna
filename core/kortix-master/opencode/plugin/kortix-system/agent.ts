/**
 * Kortix Agent System — sub-agent delegation, project-scoped.
 *
 * All agent records are persisted in SQLite (kortix.db) per project.
 * Agents are child sessions spawned via the OpenCode REST API.
 *
 * Tools:
 *   - agent_spawn:   Launch a sub-agent (sync or background)
 *   - agent_message:  Send follow-up to a running/stopped agent
 *   - agent_stop:     Kill a running agent

 */

import { Database } from "bun:sqlite"
import { tool, type ToolContext } from "@opencode-ai/plugin"
import type { ProjectManager } from "./projects"
import { ensureSchema } from "./lib/schema"

// ── Async agent tracking ─────────────────────────────────────────────────────

let autoworkActiveSessions: Set<string>
try {
	const mod = require("./ralph/ralph")
	autoworkActiveSessions = mod.ralphActiveSessions ?? new Set<string>()
} catch {
	autoworkActiveSessions = new Set<string>()
}

export const asyncAgentSessions = new Set<string>()

// ── DB ───────────────────────────────────────────────────────────────────────

export function ensureAgentsTable(db: Database): void {
	ensureSchema(db, "agents", [
		{ name: "id",                type: "TEXT", notNull: true,  defaultValue: null,        primaryKey: true },
		{ name: "project_id",       type: "TEXT", notNull: true,  defaultValue: null,        primaryKey: false },
		{ name: "session_id",       type: "TEXT", notNull: true,  defaultValue: null,        primaryKey: false },
		{ name: "parent_session_id", type: "TEXT", notNull: true,  defaultValue: "''",        primaryKey: false },
		{ name: "agent_type",       type: "TEXT", notNull: true,  defaultValue: null,        primaryKey: false },
		{ name: "description",      type: "TEXT", notNull: true,  defaultValue: null,        primaryKey: false },
		{ name: "system_prompt",    type: "TEXT", notNull: false, defaultValue: null,        primaryKey: false },
		{ name: "status",           type: "TEXT", notNull: true,  defaultValue: "'running'", primaryKey: false },
		{ name: "result",           type: "TEXT", notNull: false, defaultValue: null,        primaryKey: false },
		{ name: "created_at",       type: "TEXT", notNull: true,  defaultValue: null,        primaryKey: false },
		{ name: "updated_at",       type: "TEXT", notNull: true,  defaultValue: null,        primaryKey: false },
	])
}

// Map session_id → system_prompt for the system transform hook
const agentSystemPrompts = new Map<string, string>()

export function getAgentSystemPrompt(sessionId: string): string | undefined {
	return agentSystemPrompts.get(sessionId)
}

function genId(): string {
	return `ag-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

interface AgentRow {
	id: string; project_id: string; session_id: string; parent_session_id: string
	agent_type: string; description: string; status: string; result: string | null
	created_at: string; updated_at: string
}

// ── TUI Notifications ────────────────────────────────────────────────────────

/** Fire-and-forget toast + publish to TUI so user can jump to child sessions */
function notifyAgentEvent(
	client: any,
	event: "spawned" | "completed" | "failed" | "stopped",
	agentId: string,
	description: string,
	childSessionId: string,
) {
	const shortSid = childSessionId.length > 16 ? `…${childSessionId.slice(-8)}` : childSessionId
	const variants: Record<string, "info" | "success" | "warning" | "error"> = {
		spawned: "info",
		completed: "success",
		failed: "error",
		stopped: "warning",
	}
	const messages: Record<string, string> = {
		spawned: `⚡ Worker spawned: ${description}\nSession: ${shortSid} — Ctrl+X ↓ to jump in`,
		completed: `✓ Worker done: ${description}\nSession: ${shortSid}`,
		failed: `✗ Worker failed: ${description}`,
		stopped: `⊘ Worker stopped: ${description}`,
	}
	const durations: Record<string, number> = {
		spawned: 15000,
		completed: 10000,
		failed: 10000,
		stopped: 8000,
	}

	// Show toast notification in TUI (non-blocking, best-effort)
	try {
		client.tui?.showToast({
			body: {
				title: `Agent ${event}`,
				message: messages[event] || description,
				variant: variants[event] || "info",
				duration: durations[event] || 10000,
			},
		}).catch(() => {})
	} catch {}

	// Log to structured logs for debugging
	try {
		client.app?.log({
			body: {
				service: "kortix-agent",
				level: "info",
				message: `Agent ${event}: ${description} (session: ${childSessionId})`,
				extra: { agentId, childSessionId, event },
			},
		}).catch(() => {})
	} catch {}
}

// ── Tools ────────────────────────────────────────────────────────────────────

export function agentTools(client: any, db: Database, mgr: ProjectManager) {
	function getProjectId(ctx: ToolContext): string | null {
		if (!ctx?.sessionID) return null
		return mgr.getSessionProject(ctx.sessionID)?.id || null
	}

	// Background polling map (in-memory, just tracks intervals for cleanup)
	const pollers = new Map<string, ReturnType<typeof setInterval>>()

	return {
		agent_spawn: tool({
			description: [
				"Spawn an autonomous worker agent to execute a task. The worker has full tools (bash, read, write, edit, skill, web search, PTY) and can handle any work: research, coding, building, testing, verification.",
				"",
				"Include ALL context in the prompt — the worker knows nothing about your conversation.",
				"Tell it what skill to load, what to build, how to verify.",
				"Add command: '/ralph' for complex tasks that need the persistent single-owner plan/implement/verify loop.",
				"Launch multiple workers in one message for parallel independent tasks.",
				"The worker's output is NOT visible to the user — you must summarize and relay results.",
			].join("\n"),
			args: {
				description: tool.schema.string().describe("Short (3-5 word) task description"),
				prompt: tool.schema.string().describe("Detailed task instructions for the worker. Include ALL context — the worker knows nothing about your conversation."),
				agent_type: tool.schema.string().describe('Agent type — use "worker" for task execution, "orchestrator" for autonomous CEO orchestration'),
				system_prompt: tool.schema.string().optional().describe("Mission-specific system prompt. Defines WHO this worker is. Frames all decisions. E.g. 'You are building an academic AGI presentation. Rigorous academic tone, real citations.'"),
				command: tool.schema.string().optional().describe('Slash command to prepend (e.g. "/ralph" for complex tasks)'),
				async: tool.schema.boolean().optional().describe("If true, spawn in background and return immediately. Result injected back when done. Default: false (blocking)."),
			},
			async execute(args: {
				description: string; prompt: string; agent_type: string; system_prompt?: string; command?: string; async?: boolean
			}, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const id = genId()
				const now = new Date().toISOString()

				try {
					// Create child session
					const sessionResult = await client.session.create({
						body: {
							parentID: ctx.sessionID,
							title: `${args.description} (@${args.agent_type})`,
						},
					})
					const childSessionId = sessionResult.data?.id
					if (!childSessionId) throw new Error("Failed to create child session")

					// Send session ID to UI — both via metadata and title
					try {
						ctx.metadata({
							title: `${args.description} [${childSessionId}]`,
							metadata: { sessionId: childSessionId, agentId: id, agentType: args.agent_type },
						})
					} catch {}

					// Resolve model from parent
					let model: { modelID: string; providerID: string } | undefined
					try {
						const msgs = await client.session.messages({ path: { id: ctx.sessionID } })
						const last = (msgs.data ?? []).filter((m: any) => m.info?.role === "assistant").pop()
						if (last?.info?.modelID) model = { modelID: last.info.modelID, providerID: last.info.providerID || "anthropic" }
					} catch {}

					// Auto-link parent's project to child session
					const parentProject = mgr.getSessionProject(ctx.sessionID)
					if (parentProject) {
						mgr.setSessionProject(childSessionId, parentProject.id)
					}

					// Build prompt with project context + optional command prefix
					let fullPrompt = args.prompt
					if (parentProject) {
						fullPrompt = `Working directory: ${parentProject.path}\nProject: ${parentProject.name}\n\n${fullPrompt}`
					}
					if (args.command) {
						fullPrompt = `${args.command}\n\n${fullPrompt}`
					}

					// Persist agent record
					db.prepare(`INSERT INTO agents (id, project_id, session_id, parent_session_id, agent_type, description, system_prompt, status, created_at, updated_at)
						VALUES ($id, $pid, $sid, $psid, $type, $desc, $sp, 'running', $now, $now)`)
						.run({ $id: id, $pid: pid, $sid: childSessionId, $psid: ctx.sessionID, $type: args.agent_type, $desc: args.description, $sp: args.system_prompt || null, $now: now })

					// Store system prompt for the system transform hook
					if (args.system_prompt) {
						agentSystemPrompts.set(childSessionId, args.system_prompt)
					}

					// Notify TUI — user can jump to the child session
					notifyAgentEvent(client, "spawned", id, args.description, childSessionId)

					if (args.async) {
						// ── ASYNC PATH: fire-and-forget ──
						asyncAgentSessions.add(childSessionId)

						client.session.promptAsync({
							path: { id: childSessionId },
							body: {
								agent: args.agent_type,
								...(model && { model }),
								parts: [{ type: "text", text: fullPrompt }],
							},
						}).catch((err: unknown) => {
							db.prepare("UPDATE agents SET status='failed', result=$r, updated_at=$now WHERE id=$id")
								.run({ $r: `promptAsync failed: ${err}`, $now: new Date().toISOString(), $id: id })
							notifyAgentEvent(client, "failed", id, args.description, childSessionId)
							asyncAgentSessions.delete(childSessionId)
						})

						return JSON.stringify({
							agent_id: id,
							session_id: childSessionId,
							status: "running",
							description: args.description,
							message: "Worker spawned in background. You'll receive an <agent_completed> message when it finishes.",
						})
					}

					// Blocking execution — blocks until worker is done or cancelled.
					// If parent is interrupted, this promise rejects but the worker keeps running.
					let lastText = "(no output)"
					try {
						const result = await client.session.prompt({
							path: { id: childSessionId },
							body: {
								agent: args.agent_type,
								...(model && { model }),
								parts: [{ type: "text", text: fullPrompt }],
							},
						})
						lastText = (result.data?.parts ?? [])
							.filter((p: any) => p.type === "text")
							.pop()?.text || "(no output)"
					} catch (promptErr) {
						// Session was aborted or errored — get whatever output exists
						try {
							const msgs = await client.session.messages({ path: { id: childSessionId } })
							lastText = (msgs.data ?? [])
								.filter((m: any) => m.info?.role === "assistant")
								.flatMap((m: any) => m.parts ?? [])
								.filter((p: any) => p.type === "text")
								.pop()?.text || `Worker stopped: ${promptErr instanceof Error ? promptErr.message : "cancelled"}`
						} catch {
							lastText = `Worker stopped: ${promptErr instanceof Error ? promptErr.message : "cancelled"}`
						}
					}

					// Determine final status
					const finalStatus = lastText.includes("stopped") || lastText.includes("cancelled") ? "stopped" : "completed"
					db.prepare("UPDATE agents SET status=$s, result=$r, updated_at=$now WHERE id=$id")
						.run({ $s: finalStatus, $r: lastText.slice(0, 8000), $now: new Date().toISOString(), $id: id })

					// Notify TUI of completion
					notifyAgentEvent(client, finalStatus as "completed" | "stopped", id, args.description, childSessionId)

					return [
						`## Worker Result`,
						`**Agent:** ${id} (session: ${childSessionId})`,
						`**Task:** ${args.description}`,
						``,
						lastText,
					].join("\n")
				} catch (err) {
					db.prepare("UPDATE agents SET status='failed', result=$r, updated_at=$now WHERE id=$id")
						.run({ $r: String(err), $now: new Date().toISOString(), $id: id })
					// Notify TUI of failure
					notifyAgentEvent(client, "failed", id, args.description, "unknown")
					return `Error: ${err instanceof Error ? err.message : String(err)}`
				}
			},
		}),

		agent_message: tool({
			description: "Send a follow-up message to a running or completed agent. Resumes the agent's session.",
			args: {
				agent_id: tool.schema.string().describe("Agent ID from a previous agent_spawn"),
				message: tool.schema.string().describe("Message to send"),
				async: tool.schema.boolean().optional().describe("If true, send in background and return immediately. Result injected back when done. Default: false (blocking)."),
			},
			async execute(args: { agent_id: string; message: string; async?: boolean }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const agent = db.prepare("SELECT * FROM agents WHERE (id=$id OR id LIKE $like) AND project_id=$pid")
					.get({ $id: args.agent_id, $like: `%${args.agent_id}%`, $pid: pid }) as AgentRow | null
				if (!agent) return `Agent not found: ${args.agent_id}`

				if (args.async) {
					// ── ASYNC PATH ──
					db.prepare("UPDATE agents SET status='running', updated_at=$now WHERE id=$id")
						.run({ $now: new Date().toISOString(), $id: agent.id })

					asyncAgentSessions.add(agent.session_id)

					client.session.promptAsync({
						path: { id: agent.session_id },
						body: { parts: [{ type: "text", text: args.message }] },
					}).catch(() => {})

					return JSON.stringify({
						agent_id: agent.id,
						session_id: agent.session_id,
						status: "running",
						message: "Follow-up sent. You'll receive an <agent_completed> message when the worker finishes.",
					})
				}

				try {
					const result = await client.session.prompt({
						path: { id: agent.session_id },
						body: { parts: [{ type: "text", text: args.message }] },
					})
					const lastText = (result.data?.parts ?? [])
						.filter((p: any) => p.type === "text")
						.pop()?.text || "(no output)"

					db.prepare("UPDATE agents SET status='running', updated_at=$now WHERE id=$id")
						.run({ $now: new Date().toISOString(), $id: agent.id })

					return [
						`agent_id: ${agent.id}`,
						``,
						`<agent_result>`,
						lastText,
						`</agent_result>`,
					].join("\n")
				} catch (err) {
					return `Error: ${err instanceof Error ? err.message : String(err)}`
				}
			},
		}),

		agent_stop: tool({
			description: "Stop a running agent.",
			args: { agent_id: tool.schema.string().describe("Agent ID to stop") },
			async execute(args: { agent_id: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const agent = db.prepare("SELECT * FROM agents WHERE (id=$id OR id LIKE $like) AND project_id=$pid")
					.get({ $id: args.agent_id, $like: `%${args.agent_id}%`, $pid: pid }) as AgentRow | null
				if (!agent) return `Agent not found: ${args.agent_id}`
				if (agent.status !== "running") return `Agent ${agent.id} is already ${agent.status}.`

				try {
					await client.session.abort({ path: { id: agent.session_id } })
					const poll = pollers.get(agent.id)
					if (poll) { clearInterval(poll); pollers.delete(agent.id) }
					db.prepare("UPDATE agents SET status='stopped', updated_at=$now WHERE id=$id")
						.run({ $now: new Date().toISOString(), $id: agent.id })
					notifyAgentEvent(client, "stopped", agent.id, agent.description, agent.session_id)
					return `Agent ${agent.id} stopped.`
				} catch (err) {
					return `Error: ${err instanceof Error ? err.message : String(err)}`
				}
			},
		}),

		agent_status: tool({
			description: "Check on your workers — shows status, elapsed time, and what running workers are currently doing.",
			args: {},
			async execute(_args: {}, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const agents = db.prepare("SELECT * FROM agents WHERE parent_session_id=$psid ORDER BY created_at DESC LIMIT 20")
					.all({ $psid: ctx.sessionID }) as AgentRow[]
				if (!agents.length) return "No workers spawned in this session."
				const icon = (s: string) => s === "completed" ? "✓" : s === "running" ? "⟳" : s === "failed" ? "✗" : s === "stopped" ? "⊘" : "○"
				const lines: string[] = []
				for (const a of agents) {
					const elapsed = Date.now() - new Date(a.created_at).getTime()
					const elapsedStr = elapsed < 60_000 ? `${Math.round(elapsed / 1000)}s` : `${Math.round(elapsed / 60_000)}m`
					let line = `${icon(a.status)} **${a.id}** ${a.description} — ${a.status} (${elapsedStr})`

					if (a.status === "running") {
						// Peek at what the worker is currently doing
						try {
							const msgs = await client.session.messages({ path: { id: a.session_id } })
							const lastAssistant = (msgs.data ?? [])
								.filter((m: any) => m.info?.role === "assistant")
								.pop()
							if (lastAssistant) {
								// Check for active tool calls
								const toolParts = (lastAssistant.parts ?? [])
									.filter((p: any) => p.type === "tool-invocation")
								const lastTool = toolParts.pop()
								if (lastTool) {
									const toolName = lastTool.toolInvocation?.toolName || lastTool.state?.tool || "unknown"
									const toolState = lastTool.toolInvocation?.state || lastTool.state?.status || ""
									line += `\n    └─ ${toolState === "running" ? "executing" : "last"}: ${toolName}`
								} else {
									// Last text snippet
									const snippet = (lastAssistant.parts ?? [])
										.filter((p: any) => p.type === "text")
										.map((p: any) => p.text)
										.join(" ")
										.slice(0, 150)
									if (snippet) line += `\n    └─ ${snippet.trim()}…`
								}
							}
						} catch {}
					} else if (a.status === "completed" && a.result) {
						// Show a snippet of the result
						const snippet = a.result.slice(0, 150).replace(/\n/g, " ").trim()
						if (snippet) line += `\n    └─ ${snippet}…`
					}

					lines.push(line)
				}
				return lines.join("\n")
			},
		}),
	}
}

export async function handleAgentSessionEvent(
	sessionId: string,
	eventType: string,
	client: any,
	db: Database,
): Promise<void> {
	if (!asyncAgentSessions.has(sessionId)) return

	const agent = db.prepare(
		"SELECT * FROM agents WHERE session_id = $sid AND status = 'running'"
	).get({ $sid: sessionId }) as AgentRow | null
	if (!agent) return

	if (eventType === "session.idle") {
		// Don't mark completed if autowork is still driving this session
		if (autoworkActiveSessions.has(sessionId)) return

		let result = "(no output)"
		try {
			const msgs = await client.session.messages({ path: { id: sessionId } })
			result = (msgs.data ?? [])
				.filter((m: any) => m.info?.role === "assistant")
				.flatMap((m: any) => m.parts ?? [])
				.filter((p: any) => p.type === "text")
				.pop()?.text || "(no output)"
		} catch {}

		db.prepare("UPDATE agents SET status='completed', result=$r, updated_at=$now WHERE id=$id")
			.run({ $r: result.slice(0, 8000), $now: new Date().toISOString(), $id: agent.id })

		notifyAgentEvent(client, "completed", agent.id, agent.description, sessionId)
		asyncAgentSessions.delete(sessionId)

		try {
			const message = [
				'<agent_completed>',
				`Agent: ${agent.id}`,
				`Task: ${agent.description}`,
				`Session: ${agent.session_id}`,
				`Status: completed`,
				'',
				result.slice(0, 8000),
				'</agent_completed>',
			].join('\n')

			await client.session.promptAsync({
				path: { id: agent.parent_session_id },
				body: {
					parts: [{ type: 'text', text: message }],
				},
			})
		} catch {}

	} else if (eventType === "session.error" || eventType === "session.aborted") {
		const finalStatus = eventType === "session.aborted" ? "stopped" : "failed"
		let errorMsg = `Worker ${finalStatus}`
		try {
			const msgs = await client.session.messages({ path: { id: sessionId } })
			errorMsg = (msgs.data ?? [])
				.filter((m: any) => m.info?.role === "assistant")
				.flatMap((m: any) => m.parts ?? [])
				.filter((p: any) => p.type === "text")
				.pop()?.text || errorMsg
		} catch {}

		db.prepare("UPDATE agents SET status=$s, result=$r, updated_at=$now WHERE id=$id")
			.run({ $s: finalStatus, $r: errorMsg.slice(0, 8000), $now: new Date().toISOString(), $id: agent.id })

		notifyAgentEvent(client, finalStatus as "failed" | "stopped", agent.id, agent.description, sessionId)
		asyncAgentSessions.delete(sessionId)

		try {
			const tag = finalStatus === "failed" ? "agent_failed" : "agent_stopped"
			const message = [
				`<${tag}>`,
				`Agent: ${agent.id}`,
				`Task: ${agent.description}`,
				`Session: ${agent.session_id}`,
				`Status: ${finalStatus}`,
				`Error: ${errorMsg.slice(0, 2000)}`,
				`</${tag}>`,
			].join('\n')

			await client.session.promptAsync({
				path: { id: agent.parent_session_id },
				body: {
					parts: [{ type: 'text', text: message }],
				},
			})
		} catch {}
	}
}
