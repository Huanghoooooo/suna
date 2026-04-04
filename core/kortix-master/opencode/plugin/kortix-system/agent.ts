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
 *   - agent_status:   List agents in the current project
 */

import { Database } from "bun:sqlite"
import { tool, type ToolContext } from "@opencode-ai/plugin"
import type { ProjectManager } from "./projects"

// ── DB ───────────────────────────────────────────────────────────────────────

export function ensureAgentsTable(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS agents (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			session_id TEXT NOT NULL,
			parent_session_id TEXT NOT NULL,
			agent_type TEXT NOT NULL,
			description TEXT NOT NULL,
			system_prompt TEXT,
			status TEXT NOT NULL DEFAULT 'running',
			result TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)
	`)
	try { db.exec("ALTER TABLE agents ADD COLUMN system_prompt TEXT") } catch {}
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
				"Add command: '/autowork' for complex tasks that need the plan/implement/verify loop.",
				"Launch multiple workers in one message for parallel independent tasks.",
				"The worker's output is NOT visible to the user — you must summarize and relay results.",
			].join("\n"),
			args: {
				description: tool.schema.string().describe("Short (3-5 word) task description"),
				prompt: tool.schema.string().describe("Detailed task instructions for the worker. Include ALL context — the worker knows nothing about your conversation."),
				agent_type: tool.schema.string().describe('Agent type — use "worker"'),
				system_prompt: tool.schema.string().optional().describe("Mission-specific system prompt. Defines WHO this worker is. Frames all decisions. E.g. 'You are building an academic AGI presentation. Rigorous academic tone, real citations.'"),
				command: tool.schema.string().optional().describe('Slash command to prepend (e.g. "/autowork" for complex tasks)'),
			},
			async execute(args: {
				description: string; prompt: string; agent_type: string; system_prompt?: string; command?: string
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
					return `Error: ${err instanceof Error ? err.message : String(err)}`
				}
			},
		}),

		agent_wait: tool({
			description: "Wait for a spawned worker to complete and return its result. Blocks until done. Call this IMMEDIATELY after agent_spawn — do NOT generate any text between spawning and waiting.",
			args: {
				agent_id: tool.schema.string().describe("Agent ID from agent_spawn"),
			},
			async execute(args: { agent_id: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const agent = db.prepare("SELECT * FROM agents WHERE (id=$id OR id LIKE $like) AND project_id=$pid")
					.get({ $id: args.agent_id, $like: `%${args.agent_id}%`, $pid: pid }) as AgentRow | null
				if (!agent) return `Agent not found: ${args.agent_id}`

				// If already completed, return immediately
				if (agent.status === "completed" || agent.status === "failed") {
					return [
						`## Worker Result (${agent.status})`,
						`**Agent:** ${agent.id}`,
						`**Task:** ${agent.description}`,
						``,
						agent.result || "(no output)",
					].join("\n")
				}

				// Poll until the worker session is no longer busy
				const maxWait = 600_000 // 10 min max
				const start = Date.now()
				while (Date.now() - start < maxWait) {
					await new Promise(r => setTimeout(r, 2000))
					try {
						const statusRes = await client.session.status()
						const busy = statusRes.data?.[agent.session_id]
						if (!busy) break
					} catch { break }
				}

				// Get the result
				try {
					const msgs = await client.session.messages({ path: { id: agent.session_id } })
					const lastText = (msgs.data ?? [])
						.filter((m: any) => m.info?.role === "assistant")
						.flatMap((m: any) => m.parts ?? [])
						.filter((p: any) => p.type === "text")
						.pop()?.text || "(no output)"

					db.prepare("UPDATE agents SET status='completed', result=$r, updated_at=$now WHERE id=$id")
						.run({ $r: lastText.slice(0, 8000), $now: new Date().toISOString(), $id: agent.id })

					return [
						`## Worker Result`,
						`**Agent:** ${agent.id}`,
						`**Task:** ${agent.description}`,
						``,
						lastText,
					].join("\n")
				} catch (err) {
					return `Error reading agent result: ${err instanceof Error ? err.message : String(err)}`
				}
			},
		}),

		agent_message: tool({
			description: "Send a follow-up message to a running or completed agent. Resumes the agent's session.",
			args: {
				agent_id: tool.schema.string().describe("Agent ID from a previous agent_spawn"),
				message: tool.schema.string().describe("Message to send"),
			},
			async execute(args: { agent_id: string; message: string }, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const agent = db.prepare("SELECT * FROM agents WHERE (id=$id OR id LIKE $like) AND project_id=$pid")
					.get({ $id: args.agent_id, $like: `%${args.agent_id}%`, $pid: pid }) as AgentRow | null
				if (!agent) return `Agent not found: ${args.agent_id}`

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
					return `Agent ${agent.id} stopped.`
				} catch (err) {
					return `Error: ${err instanceof Error ? err.message : String(err)}`
				}
			},
		}),

		agent_status: tool({
			description: "List all agents in the current project with their status.",
			args: {},
			async execute(_args: {}, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const agents = db.prepare("SELECT * FROM agents WHERE project_id=$pid ORDER BY created_at DESC LIMIT 20")
					.all({ $pid: pid }) as AgentRow[]
				if (!agents.length) return "No agents spawned in this project."
				const icon = (s: string) => s === "completed" ? "✓" : s === "running" ? "→" : s === "failed" ? "✗" : s === "stopped" ? "⊘" : "○"
				const lines = agents.map(a => `${icon(a.status)} **${a.id}** [${a.agent_type}] ${a.description} — ${a.status}`)
				return lines.join("\n")
			},
		}),
	}
}
