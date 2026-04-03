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
			status TEXT NOT NULL DEFAULT 'running',
			result TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)
	`)
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
				"Launch a sub-agent to handle a task. Available agent types:",
				"- worker: General-purpose agent with full tools (coding, debugging, research, implementation)",
				"- explorer: Fast read-only agent for codebase search and analysis (no file modifications)",
				"- planner: Architecture and planning agent (read-only, returns step-by-step plans)",
				"- verifier: Adversarial verification agent (read-only, produces VERDICT: PASS/FAIL/PARTIAL)",
				"",
				"Usage:",
				"- Launch multiple agents concurrently by calling agent_spawn multiple times in one message",
				"- Each agent starts a fresh session. Include all context needed in your prompt.",
				"- Tell the agent whether to write code or just research. Tell it how to verify its work.",
				"- The agent's result is NOT visible to the user — you must relay key findings.",
			].join("\n"),
			args: {
				description: tool.schema.string().describe("Short (3-5 word) task description"),
				prompt: tool.schema.string().describe("Detailed task instructions for the agent"),
				agent_type: tool.schema.string().describe("Agent type: worker, explorer, planner, verifier"),
				background: tool.schema.boolean().optional().describe("Run in background (default: false = sync, blocks until done)"),
			},
			async execute(args: {
				description: string; prompt: string; agent_type: string; background?: boolean
			}, ctx: ToolContext): Promise<string> {
				const pid = getProjectId(ctx)
				if (!pid) return "Error: no project selected."
				const id = genId()
				const now = new Date().toISOString()
				const isBackground = args.background === true

				try {
					// Create child session
					const sessionResult = await client.session.create({
						parentID: ctx.sessionID,
						title: `${args.description} (@${args.agent_type})`,
					})
					const childSessionId = sessionResult.data?.id
					if (!childSessionId) throw new Error("Failed to create child session")

					// Resolve model from parent
					let model: { modelID: string; providerID: string } | undefined
					try {
						const msgs = await client.session.messages({ path: { id: ctx.sessionID } })
						const last = (msgs.data ?? []).filter((m: any) => m.info?.role === "assistant").pop()
						if (last?.info?.modelID) model = { modelID: last.info.modelID, providerID: last.info.providerID || "anthropic" }
					} catch {}

					// Persist agent record
					db.prepare(`INSERT INTO agents (id, project_id, session_id, parent_session_id, agent_type, description, status, created_at, updated_at)
						VALUES ($id, $pid, $sid, $psid, $type, $desc, 'running', $now, $now)`)
						.run({ $id: id, $pid: pid, $sid: childSessionId, $psid: ctx.sessionID, $type: args.agent_type, $desc: args.description, $now: now })

					if (isBackground) {
						// Fire-and-forget
						client.session.prompt_async({
							path: { id: childSessionId },
							body: {
								agent: args.agent_type,
								...(model && { model }),
								parts: [{ type: "text", text: args.prompt }],
							},
						}).catch((err: Error) => {
							db.prepare("UPDATE agents SET status='failed', result=$r, updated_at=$now WHERE id=$id")
								.run({ $r: err.message, $now: new Date().toISOString(), $id: id })
						})

						// Poll for completion
						const poll = setInterval(async () => {
							try {
								const status = await client.session.status()
								const busy = status.data?.[childSessionId]
								if (!busy) {
									clearInterval(poll)
									pollers.delete(id)
									// Get result
									const msgs = await client.session.messages({ path: { id: childSessionId } })
									const lastText = (msgs.data ?? [])
										.filter((m: any) => m.info?.role === "assistant")
										.flatMap((m: any) => m.parts ?? [])
										.filter((p: any) => p.type === "text")
										.pop()?.text || "(no output)"

									db.prepare("UPDATE agents SET status='completed', result=$r, updated_at=$now WHERE id=$id")
										.run({ $r: lastText.slice(0, 8000), $now: new Date().toISOString(), $id: id })

									// Inject report into parent
									const report = [
										`<kortix_system type="agent-report" source="kortix-system">`,
										`<agent-report>`,
										`<agent-id>${id}</agent-id>`,
										`<session-id>${childSessionId}</session-id>`,
										`<status>COMPLETE</status>`,
										`<agent-type>${args.agent_type}</agent-type>`,
										`<description>${args.description}</description>`,
										`<result>`, lastText.slice(0, 4000), `</result>`,
										`</agent-report>`,
										`<!-- KORTIX_INTERNAL -->`,
										`</kortix_system>`,
									].join("\n")
									client.session.prompt_async({
										path: { id: ctx.sessionID },
										body: { parts: [{ type: "text", text: report }] },
									}).catch(() => {})
								}
							} catch { clearInterval(poll); pollers.delete(id) }
						}, 3000)
						pollers.set(id, poll)

						return [
							`Agent launched in background.`,
							`- **ID:** ${id}`,
							`- **Session:** ${childSessionId}`,
							`- **Type:** ${args.agent_type}`,
							`- **Task:** ${args.description}`,
							``,
							`An <agent-report> will arrive on completion. Continue with other work.`,
						].join("\n")
					} else {
						// Sync: prompt and wait
						const result = await client.session.prompt({
							path: { id: childSessionId },
							body: {
								agent: args.agent_type,
								...(model && { model }),
								parts: [{ type: "text", text: args.prompt }],
							},
						})

						const lastText = (result.data?.parts ?? [])
							.filter((p: any) => p.type === "text")
							.pop()?.text || "(no output)"

						db.prepare("UPDATE agents SET status='completed', result=$r, updated_at=$now WHERE id=$id")
							.run({ $r: lastText.slice(0, 8000), $now: new Date().toISOString(), $id: id })

						return [
							`agent_id: ${id} (session: ${childSessionId})`,
							``,
							`<agent_result>`,
							lastText,
							`</agent_result>`,
						].join("\n")
					}
				} catch (err) {
					db.prepare("UPDATE agents SET status='failed', result=$r, updated_at=$now WHERE id=$id")
						.run({ $r: String(err), $now: new Date().toISOString(), $id: id })
					return `Error: ${err instanceof Error ? err.message : String(err)}`
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
