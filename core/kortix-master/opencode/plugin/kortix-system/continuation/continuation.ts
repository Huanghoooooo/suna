/**
 * Kortix Todo Enforcing Plugin — Passive continuation
 *
 * Always active. When the agent goes idle and there are pending/in-progress
 * todos, nudges it to keep working. Does NOT use the DONE/VERIFIED protocol.
 * Does NOT activate on /autowork commands.
 *
 * This is the ambient "don't stop mid-work" behavior, separate from the
 * explicit autowork execution loop.
 *
 * Defers to kortix-autowork: if an autowork loop is active for the session,
 * this plugin does nothing (it checks for the KORTIX_AUTOWORK marker and
 * the autowork loop's session flag).
 */

import type { Plugin } from "@opencode-ai/plugin"
import type { Todo } from "@opencode-ai/sdk"
import {
	type ContinuationConfig,
	type ContinuationState,
	DEFAULT_CONFIG,
	createInitialState,
	mergeConfig,
	INTERNAL_MARKER,
	CODE_BLOCK_PATTERN,
	INLINE_CODE_PATTERN,
} from "../lib/autowork-config"
import { evaluate } from "./continuation-engine"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrapSystemPrompt(text: string): string {
	return `<kortix_system type="passive-continuation" source="kortix-todo-enforcing">\n${text}\n</kortix_system>`
}

type LogFn = (level: "info" | "warn" | "error", message: string) => void

function extractMessageText(input: any): string {
	const parts = input?.parts ?? []
	let text = ""
	for (const part of parts) {
		if (typeof part === "string") text += part
		else if (part?.type === "text") text += part.text ?? ""
		else if (typeof part?.text === "string") text += part.text
	}
	return text
}

function isInternalMessage(text: string): boolean {
	if (text.includes(INTERNAL_MARKER)) return true
	if (text.includes("[SYSTEM REMINDER")) return true
	if (text.includes("<kortix_system")) return true
	return false
}

function extractLastAssistantMessage(messages: any[]): { text: string; hadToolCalls: boolean } {
	let text = ""
	let hadToolCalls = false
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg?.info?.role === "assistant") {
			for (const part of (msg.parts ?? [])) {
				if (part.type === "text" && !part.synthetic && !part.ignored) {
					text += part.text + "\n"
				}
				if (part.type === "tool") hadToolCalls = true
			}
			break
		}
	}
	return { text: text.trim(), hadToolCalls }
}

function hasPendingQuestion(messages: any[]): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		const role = msg?.info?.role
		if (role === "user") return false
		if (role === "assistant") {
			for (const part of (msg.parts ?? [])) {
				if (part.type === "tool") {
					const toolName = (part.toolName ?? part.tool_name ?? part.name ?? "") as string
					if (toolName === "question" || toolName === "mcp_question") {
						const status = part.state?.status ?? ""
						if (status === "running" || status === "pending") return true
					}
				}
			}
		}
	}
	return false
}

// ─── Per-Session State ────────────────────────────────────────────────────────

const SESSION_STATE_TTL_MS = 2 * 60 * 60 * 1000

interface SessionEntry<T> {
	state: T
	lastAccessedAt: number
}

class SessionStateMap<T> {
	private map = new Map<string, SessionEntry<T>>()
	private lastGcAt = Date.now()
	private readonly gcIntervalMs = 10 * 60 * 1000

	constructor(private readonly factory: (sessionId: string) => T) {}

	get(sessionId: string): T {
		this.maybeGc()
		let entry = this.map.get(sessionId)
		if (!entry) {
			entry = { state: this.factory(sessionId), lastAccessedAt: Date.now() }
			this.map.set(sessionId, entry)
		} else {
			entry.lastAccessedAt = Date.now()
		}
		return entry.state
	}

	delete(sessionId: string): void {
		this.map.delete(sessionId)
	}

	private maybeGc(): void {
		const now = Date.now()
		if (now - this.lastGcAt < this.gcIntervalMs) return
		this.lastGcAt = now
		const cutoff = now - SESSION_STATE_TTL_MS
		for (const [key, entry] of this.map) {
			if (entry.lastAccessedAt < cutoff) this.map.delete(key)
		}
	}
}

// ─── Autowork detection ───────────────────────────────────────────────────────

/**
 * Track which sessions have an active autowork loop.
 * The autowork plugin sets this; we check it to defer.
 */
const autoworkActiveSessions = new Set<string>()

// ─── Plugin ───────────────────────────────────────────────────────────────────

const KortixTodoEnforcingPlugin: Plugin = async ({ client }) => {
	const config: ContinuationConfig = mergeConfig(DEFAULT_CONFIG)

	const continuationStates = new SessionStateMap<ContinuationState>(
		(sid) => { const s = createInitialState(); s.sessionId = sid; return s },
	)
	/** Sessions where continuation has been explicitly disabled (e.g. by autowork-cancel) */
	const disabledSessions = new Set<string>()

	const log: LogFn = (level, message) => {
		try {
			client.app.log({
				body: { service: "kortix-todo-enforcing", level, message },
			}).catch(() => {})
		} catch {}
	}

	const sid = (sessionId: string) => sessionId.length > 16 ? sessionId.slice(-12) : sessionId

	return {
		"chat.message": async (input: any, output: any) => {
			try {
				const sessionId = input?.sessionID
				if (!sessionId) return

				const messageText = extractMessageText(output)
				if (!messageText) return
				if (isInternalMessage(messageText)) return

				// Reset passive state on new user message
				const contState = continuationStates.get(sessionId)
				contState.workCycleStartedAt = Date.now()
				contState.consecutiveAborts = 0
				contState.inflight = false

				// If autowork is being activated in this message, mark the session
				if (messageText.includes("KORTIX_AUTOWORK")) {
					autoworkActiveSessions.add(sessionId)
				}
				// If autowork is being cancelled, remove the mark and disable passive too
				if (messageText.includes("KORTIX_AUTOWORK_CANCEL")) {
					autoworkActiveSessions.delete(sessionId)
					disabledSessions.add(sessionId)
				}
			} catch {}
		},

		event: async ({ event }) => {
			try {
				// Cleanup on session delete
				if (event.type === "session.deleted") {
					const sessionId = (event as any).properties?.info?.id ?? (event as any).properties?.sessionID
					if (sessionId) {
						continuationStates.delete(sessionId)
						autoworkActiveSessions.delete(sessionId)
						disabledSessions.delete(sessionId)
					}
					return
				}

				// Track aborts for circuit breaker
				if (event.type === "session.error" || (event.type as string) === "session.aborted") {
					const sessionId = (event as any).properties?.sessionID
					if (!sessionId) return
					const cs = continuationStates.get(sessionId)
					cs.lastAbortAt = Date.now()
					cs.consecutiveAborts++
					cs.inflight = false
					return
				}

				// ── session.idle — the main evaluation point ──
				if (event.type !== "session.idle") return

				const sessionId = (event as any).properties?.sessionID
				if (!sessionId) return

				// Defer to autowork if it's active for this session
				if (autoworkActiveSessions.has(sessionId)) return

				// Respect explicit disable
				if (disabledSessions.has(sessionId)) return

				const contState = continuationStates.get(sessionId)

				try {
					const [todoRes, messagesRes] = await Promise.all([
						client.session.todo({ path: { id: sessionId } }).catch(() => ({ data: [] as Todo[] })),
						client.session.messages({ path: { id: sessionId } }).catch(() => ({ data: [] as any[] })),
					])

					const todos = (todoRes.data ?? []) as Todo[]
					const messages = (messagesRes.data ?? []) as any[]

					if (hasPendingQuestion(messages)) {
						log("info", `[todo-enforcing][${sid(sessionId)}] Skipped: pending question`)
						return
					}

					const { text, hadToolCalls } = extractLastAssistantMessage(messages)

					// Track empty/aborted responses for circuit breaker
					if (!text.trim() && !hadToolCalls) {
						contState.consecutiveAborts++
					} else {
						contState.consecutiveAborts = 0
					}

					const decision = evaluate(config, contState, text, hadToolCalls, todos)
					log("info", `[todo-enforcing][${sid(sessionId)}] ${decision.action} — ${decision.reason}`)

					if (decision.action === "continue" && decision.prompt) {
						contState.inflight = true
						contState.totalSessionContinuations++
						contState.lastContinuationAt = Date.now()
						await client.session.promptAsync({
							path: { id: sessionId },
							body: { parts: [{ type: "text" as const, text: wrapSystemPrompt(decision.prompt) }] },
						}).catch((err: unknown) => {
							log("warn", `[todo-enforcing][${sid(sessionId)}] promptAsync failed: ${err}`)
						}).finally(() => {
							contState.inflight = false
						})
					}
				} catch (err) {
					log("warn", `[todo-enforcing][${sid(sessionId)}] Error: ${err}`)
					contState.inflight = false
				}
			} catch (err) {
				log("warn", `[todo-enforcing] event hook error: ${err}`)
			}
		},
	}
}

export default KortixTodoEnforcingPlugin

/** Allow autowork plugin to signal session state */
export { autoworkActiveSessions }
