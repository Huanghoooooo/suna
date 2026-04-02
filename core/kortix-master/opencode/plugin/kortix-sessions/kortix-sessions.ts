import { type Plugin, tool } from "@opencode-ai/plugin"
import type { Session, Todo } from "@opencode-ai/sdk"
import { Database } from "bun:sqlite"
import { ensureGlobalMemoryFiles, renderMergedMemoryContext, renderProjectContext, resolveKortixDir } from "../kortix-paths"
import { MEMORY_CONTEXT_MARKER, upsertMemoryContextAtPromptEnd, wrapInKortixSystemTags } from "./src/message-transform"
import { DB_PATH, STORAGE_BASE, buildSessionLineage, changeSummary, formatMessages, getEnv, searchSessions, shortTs, ttcCompress } from "./src/session"

const _projectPathCache = new Map<string, string | null>()

function projectPathForSession(sessionID: string): string | null {
	if (_projectPathCache.has(sessionID)) return _projectPathCache.get(sessionID)!
	try {
		const db = new Database(`${resolveKortixDir(import.meta.dir)}/kortix.db`, { readonly: true })
		try {
			const row = db
				.query("SELECT p.path FROM session_projects sp JOIN projects p ON sp.project_id = p.id WHERE sp.session_id = ? LIMIT 1")
				.get(sessionID) as { path?: string } | null
			const result = row?.path || null
			_projectPathCache.set(sessionID, result)
			return result
		} finally {
			db.close()
		}
	} catch {
		return null
	}
}

export const KortixSessionsPlugin: Plugin = async ({ client, directory }) => {
	let currentSessionId: string | null = null

	try {
		ensureGlobalMemoryFiles(import.meta.dir)
	} catch (err) {
		console.error(`[kortix-sessions] memory file init failed (non-fatal): ${err}`)
	}

	return {
		hooks: {
			"event": async ({ event }: { event: any }) => {
				try {
					if (event.type === "session.created") {
						currentSessionId = (event as any).properties?.sessionID ?? currentSessionId
					}
				} catch (err) {
					console.error(`[kortix-sessions] event hook failed: ${err}`)
				}
			},
			"experimental.chat.messages.transform": async (_input: any, output: { messages: any[] }) => {
				try {
					const parts: string[] = []
					if (currentSessionId) {
						// Wrap session context in kortix_system tags so frontend strips it from UI
						const sessionCtx = `<session_context>\nSession ID: ${currentSessionId}\n</session_context>`
						parts.push(wrapInKortixSystemTags(sessionCtx, { type: "session-context", source: "kortix-sessions" }))
					}
					const mergedMemory = renderMergedMemoryContext(import.meta.dir)
					if (mergedMemory) {
						// Wrap memory context in kortix_system tags so frontend strips it from UI
						const memCtx = `<memory>\n${mergedMemory}\n</memory>`
						parts.push(wrapInKortixSystemTags(memCtx, { type: "memory-context", source: "kortix-sessions" }))
					}
					if (currentSessionId) {
						const projectPath = projectPathForSession(currentSessionId)
						if (projectPath) {
							const projectCtx = renderProjectContext(projectPath)
							if (projectCtx) {
								const ctx = `<project_context>\nPath: ${projectPath}\n\n${projectCtx}\n</project_context>`
								parts.push(wrapInKortixSystemTags(ctx, { type: "project-context", source: "kortix-sessions" }))
							}
						}
					}
					if (parts.length === 0) return
					upsertMemoryContextAtPromptEnd(
						output.messages as any[],
						`${MEMORY_CONTEXT_MARKER}\n${parts.join("\n\n")}`,
						currentSessionId ?? undefined,
					)
				} catch (err) {
					console.error(`[kortix-sessions] messages.transform failed: ${err}`)
				}
			},
		},
		tool: {
			session_list: tool({
				description: `List past sessions with metadata for cross-session retrieval. Returns IDs, titles, timestamps, change summaries, and parent relationships. Use session_get to inspect one in full.`,
				args: {
					search: tool.schema.string().optional().describe("Filter sessions by title substring (case-insensitive)"),
					limit: tool.schema.number().optional().describe("Max sessions to return (default 20, most recent first)"),
				},
				async execute(args) {
					const result = await client.session.list()
					if (!result.data) return "Error: could not fetch sessions"

					let sessions = result.data as Session[]
					if (args.search) {
						const q = args.search.toLowerCase()
						sessions = sessions.filter((s) => s.title?.toLowerCase().includes(q))
					}
					sessions.sort((a, b) => b.time.updated - a.time.updated)
					const total = sessions.length
					const limit = Math.max(1, Math.min(100, args.limit ?? 20))
					sessions = sessions.slice(0, limit)
					if (sessions.length === 0)
						return args.search ? `No sessions matching "${args.search}".` : "No sessions found."

					return [
						`=== SESSIONS (${sessions.length}/${total}) ===`,
						...sessions.map((s) => {
							const parent = s.parentID ? ` | parent=${s.parentID}` : ""
							return `${s.id} | "${s.title || "(untitled)"}" | ${shortTs(s.time.created)} -> ${shortTs(s.time.updated)} | ${changeSummary(s)}${parent}`
						}),
					].join("\n")
				},
			}),

			session_get: tool({
				description: `Retrieve a past session's conversation with TTC compression via semantic transcript compression. Fetches metadata, todos, and messages, then returns a compact transcript.`,
				args: {
					session_id: tool.schema.string().describe("Session ID (ses_*) from session_list"),
					aggressiveness: tool.schema.number().optional().describe("Compression level 0.0-1.0 (default 0.3). Higher = more compressed."),
				},
				async execute(args) {
					const agg = Math.min(1, Math.max(0, args.aggressiveness ?? 0.3))
					const [sessionRes, todoRes, messagesRes, sessionsRes] = await Promise.all([
						client.session.get({ path: { id: args.session_id } }),
						client.session.todo({ path: { id: args.session_id } }).catch(() => ({ data: [] as Todo[] })),
						client.session.messages({ path: { id: args.session_id } }),
						client.session.list(),
					])
					if (!sessionRes.data) return `Error: session ${args.session_id} not found`
					const session = sessionRes.data as Session
					const todos = (todoRes.data ?? []) as Todo[]
					const messages = messagesRes.data ?? []
					const todoStr = todos.length > 0 ? todos.map((t) => `  [${t.status}] ${t.content}`).join("\n") : "  (none)"
					const lineage = sessionsRes.data ? buildSessionLineage(sessionsRes.data as Session[], session.id) : ""
					const header = [
						`=== SESSION: ${session.title} ===`,
						`ID: ${session.id}`,
						`Created: ${shortTs(session.time.created)} | Updated: ${shortTs(session.time.updated)}`,
						`Changes: ${changeSummary(session)}`,
						`Todos:\n${todoStr}`,
						lineage ? `Lineage:\n${lineage}` : null,
						`Storage: ${STORAGE_BASE}/storage/message/${session.id}/`,
					].filter(Boolean).join("\n")
					if (messages.length === 0) return `${header}\n\n(no messages)`
					const formatted = formatMessages(messages)
					let toolCallCount = 0
					for (const msg of messages) {
						for (const part of msg.parts) {
							if (part.type === "tool") toolCallCount++
						}
					}
					const apiKey = getEnv("TTC_API_KEY")
					if (!apiKey || formatted.length < 500) {
						const reason = !apiKey ? "TTC_API_KEY not set" : "text too short to compress"
						return [header, "", `=== CONVERSATION (${messages.length} msgs, ${toolCallCount} tool calls, uncompressed — ${reason}) ===`, formatted].join("\n")
					}
					const { output, originalTokens, compressedTokens } = await ttcCompress(formatted, agg, apiKey)
					const savings = originalTokens > 0 ? `${Math.round((1 - compressedTokens / originalTokens) * 100)}%` : "N/A"
					return [
						header,
						"",
						`=== CONVERSATION (${messages.length} msgs, ${toolCallCount} tool calls, aggressiveness=${agg}) ===`,
						output,
						"",
						`=== COMPRESSION ===`,
						`${originalTokens} tokens -> ${compressedTokens} tokens (${savings} reduction)`,
					].join("\n")
				},
			}),

			session_search: tool({
				description: `Search prior OpenCode sessions by title, message content, and part payloads. Returns compact session-level hits with snippets and reasons.`,
				args: {
					query: tool.schema.string().describe("Search text for prior sessions"),
					limit: tool.schema.number().optional().describe("Max sessions to return (default 5, max 10)"),
				},
				async execute(args) {
					const limit = Math.max(1, Math.min(10, args.limit ?? 5))
					const results = searchSessions(args.query, limit)
					if (results.length === 0) return `No sessions matched "${args.query}".`
					return [
						`=== SESSION SEARCH: "${args.query}" (${results.length} results) ===`,
						"",
						...results.flatMap((r) => [
							`${r.id} | "${r.title}" | ${shortTs(r.timeUpdated)} | score=${r.score} | ${r.reason}`,
							`Snippet: ${r.snippet || "(no snippet)"}`,
							"",
						]),
					].join("\n")
				},
			}),

			session_lineage: tool({
				description: `Show the parent/child continuation chain for a session using OpenCode's parentID links.`,
				args: {
					session_id: tool.schema.string().describe("Session ID (ses_*) to trace"),
				},
				async execute(args) {
					const result = await client.session.list()
					if (!result.data) return "Error: could not fetch sessions"
					return buildSessionLineage(result.data as Session[], args.session_id)
				},
			}),
		},
	}
}

export default KortixSessionsPlugin
