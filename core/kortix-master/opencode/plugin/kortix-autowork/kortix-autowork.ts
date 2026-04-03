/**
 * Kortix Autowork Plugin — Explicit execution loop
 *
 * Only activates on /autowork, /autowork-team commands or the "autowork" keyword.
 * Drives the DONE/VERIFIED promise protocol with iteration tracking,
 * adversarial verification, and safety gates.
 *
 * Does NOT handle passive todo continuation — that is kortix-todo-enforcing.
 *
 * Signals to kortix-todo-enforcing which sessions have an active autowork loop
 * so it can defer.
 */

import type { Plugin } from "@opencode-ai/plugin"
import type { Todo } from "@opencode-ai/sdk"
import {
	type AutoworkAlgorithm,
	type LoopState,
	createInitialLoopState,
	INTERNAL_MARKER,
	CODE_BLOCK_PATTERN,
	INLINE_CODE_PATTERN,
	COMMAND_TO_ALGORITHM,
} from "./src/config"
import {
	evaluateLoop,
	startLoop,
	stopLoop,
	markStopped,
	recordAbort,
	advanceIteration,
	recordFailure,
	enterVerification,
	checkLoopSafetyGates,
	loadPersistedLoopState,
	loadAllPersistedLoopStates,
	persistLoopState,
	removePersistedLoopState,
} from "./src/loop"

// Import the shared session set so todo-enforcing knows to defer
let autoworkActiveSessions: Set<string>
try {
	const mod = require("../kortix-todo-enforcing/kortix-todo-enforcing")
	autoworkActiveSessions = mod.autoworkActiveSessions ?? new Set<string>()
} catch {
	autoworkActiveSessions = new Set<string>()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wrapSystemPrompt(text: string, type: string): string {
	return `<kortix_system type="${type}" source="kortix-autowork">\n${text}\n</kortix_system>`
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

function cleanTextForKeywordDetection(text: string): string {
	return text
		.replace(CODE_BLOCK_PATTERN, "")
		.replace(INLINE_CODE_PATTERN, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.trim()
}

function isInternalMessage(text: string): boolean {
	if (text.includes(INTERNAL_MARKER)) return true
	if (text.includes("[SYSTEM REMINDER")) return true
	if (text.includes("<kortix_system")) return true
	return false
}

function extractAssistantTexts(messages: any[], fromIndex: number = 0): string[] {
	const texts: string[] = []
	for (let i = fromIndex; i < messages.length; i++) {
		const msg = messages[i]
		if (msg?.info?.role === "assistant") {
			let text = ""
			for (const part of (msg.parts ?? [])) {
				if (part.type === "text" && !part.synthetic && !part.ignored) {
					text += part.text + "\n"
				}
			}
			if (text.trim()) texts.push(text.trim())
		}
	}
	return texts
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

	set(sessionId: string, state: T): void {
		this.map.set(sessionId, { state, lastAccessedAt: Date.now() })
	}

	has(sessionId: string): boolean {
		return this.map.has(sessionId)
	}

	peek(sessionId: string): T | undefined {
		return this.map.get(sessionId)?.state
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

// ─── Default thresholds (autowork-specific) ──────────────────────────────────

const AUTOWORK_THRESHOLDS = {
	baseCooldownMs: 3_000,
	maxConsecutiveFailures: 5,
	failureResetWindowMs: 5 * 60_000,
	abortGracePeriodMs: 3_000,
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const KortixAutoworkPlugin: Plugin = async ({ client }) => {
	const loopStates = new SessionStateMap<LoopState>(
		(_sid) => createInitialLoopState(),
	)

	// Recover persisted loop states on startup
	try {
		const persisted = loadAllPersistedLoopStates()
		for (const [sid, state] of persisted) {
			if (state.active && !state.stopped) {
				loopStates.set(sid, state)
				autoworkActiveSessions.add(sid)
			}
		}
	} catch {}

	const log: LogFn = (level, message) => {
		try {
			client.app.log({
				body: { service: "kortix-autowork", level, message },
			}).catch(() => {})
		} catch {}
	}

	const sid = (sessionId: string) => sessionId.length > 16 ? sessionId.slice(-12) : sessionId

	const pendingCommand = new Map<string, { command: string; args: string }>()

	return {
		"command.execute.before": async (input: any, _output: any) => {
			const command = input?.command as string | undefined
			const sessionId = input?.sessionID as string | undefined
			const args = (input?.arguments as string | undefined) || ""
			if (!command || !sessionId) return

			if (["autowork", "autowork-team", "autowork-cancel"].includes(command)) {
				pendingCommand.set(sessionId, { command, args })
				log("info", `[autowork][${sid(sessionId)}] command.execute.before: ${command} "${args.slice(0, 60)}"`)
			}
		},

		"chat.message": async (input: any, output: any) => {
			try {
				const sessionId = input?.sessionID
				if (!sessionId) return

				const messageText = extractMessageText(output)
				if (!messageText) return
				if (isInternalMessage(messageText)) return

				let loopState = loopStates.get(sessionId)
				const cleanText = cleanTextForKeywordDetection(messageText)

				// ── /autowork-cancel ──
				if (messageText.includes("KORTIX_AUTOWORK_CANCEL") || /\/autowork-cancel\b/.test(messageText)) {
					if (loopState.active) loopState = stopLoop(loopState)
					loopState = markStopped(loopState)
					loopStates.set(sessionId, loopState)
					autoworkActiveSessions.delete(sessionId)
					log("info", `[autowork][${sid(sessionId)}] Cancelled — use /autowork or /autowork-team to restart`)
					return
				}

				// ── /autowork or /autowork-team ──
				const pending = pendingCommand.get(sessionId)
				const autoworkMatch = pending?.command === "autowork"
					|| pending?.command === "autowork-team"
					|| messageText.includes("KORTIX_AUTOWORK")
					|| /\/autowork(?:-team)?\b/.test(messageText)

				if (autoworkMatch) {
					let algorithm: AutoworkAlgorithm = "kraemer"
					if (pending?.command) {
						algorithm = COMMAND_TO_ALGORITHM[pending.command] || "kraemer"
					} else {
						const cmdName = messageText.match(/\/(autowork(?:-team)?)\b/)?.[1]
						if (cmdName) {
							algorithm = COMMAND_TO_ALGORITHM[cmdName] || "kraemer"
						}
					}

					const explicitTask = pending?.args?.trim()
					const task = explicitTask
						|| (pending?.command
							? "Continue the active task in this conversation and drive it to verified completion."
							: messageText
								.replace(/^.*?\/autowork(?:-team)?\s*/i, "")
								.replace(/<!--[\s\S]*?-->/g, "")
								.trim()
						)
						|| "Unspecified task"

					pendingCommand.delete(sessionId)

					if (loopState.active) {
						const updatedPrompt = loopState.taskPrompt
							? `${loopState.taskPrompt}\n\n[User added context at iteration ${loopState.iteration}]: ${task}`
							: task
						loopState = { ...loopState, taskPrompt: updatedPrompt }
						persistLoopState(loopState)
						loopStates.set(sessionId, loopState)
						log("info", `[autowork][${sid(sessionId)}] Context appended mid-loop`)
					} else {
						let msgCount = 0
						try {
							const r = await client.session.messages({ path: { id: sessionId } }).catch(() => ({ data: [] as any[] }))
							msgCount = (r.data ?? []).length
						} catch {}
						loopState = startLoop(task, sessionId, msgCount, algorithm)
						loopStates.set(sessionId, loopState)
						autoworkActiveSessions.add(sessionId)
						log("info", `[autowork][${sid(sessionId)}] Activated: "${task.slice(0, 80)}"`)
					}
					return
				}

				// ── Keyword auto-activation REMOVED ──
				// Previously matched /\bautowork\b/i in any user message, which caused
				// false activations (e.g. "can u run autowork on..." would activate
				// autowork on the lead session even though user meant a background worker).
				// Autowork now ONLY activates via:
				//   1. /autowork or /autowork-team command (pendingCommand)
				//   2. KORTIX_AUTOWORK marker in message text (system-injected)
				//   3. /autowork prefix in worker session assignment

				// ── Active loop absorbs user message ──
				if (loopState.active) {
					const updatedPrompt = loopState.taskPrompt
						? `${loopState.taskPrompt}\n\n[User message at iteration ${loopState.iteration}]: ${messageText.slice(0, 500)}`
						: messageText.slice(0, 500)
					loopState = { ...loopState, taskPrompt: updatedPrompt }
					persistLoopState(loopState)
					loopStates.set(sessionId, loopState)
					log("info", `[autowork][${sid(sessionId)}] User message absorbed (iter ${loopState.iteration})`)
				}
			} catch {}
		},

		event: async ({ event }) => {
			try {
				// Cleanup on session delete
				if (event.type === "session.deleted") {
					const sessionId = (event as any).properties?.info?.id ?? (event as any).properties?.sessionID
					if (sessionId) {
						loopStates.delete(sessionId)
						autoworkActiveSessions.delete(sessionId)
						removePersistedLoopState(sessionId)
						log("info", `[autowork][${sid(sessionId)}] Session deleted — state cleaned up`)
					}
					return
				}

				// Abort events — record grace period
				if (event.type === "session.error" || (event.type as string) === "session.aborted") {
					const sessionId = (event as any).properties?.sessionID
					if (!sessionId) return
					if (loopStates.has(sessionId)) {
						const ls = loopStates.get(sessionId)
						if (ls.active) {
							loopStates.set(sessionId, recordAbort(ls))
							log("info", `[autowork][${sid(sessionId)}] Abort recorded — grace period active`)
						}
					}
					return
				}

				// ── session.idle — autowork evaluation ──
				if (event.type !== "session.idle") return

				const sessionId = (event as any).properties?.sessionID
				if (!sessionId) return

				let loopState = loopStates.get(sessionId)

				// Filesystem recovery
				if (!loopState.active) {
					try {
						const persisted = loadPersistedLoopState(sessionId)
						if (persisted?.active && !persisted.stopped) {
							loopState = persisted
							loopStates.set(sessionId, loopState)
							autoworkActiveSessions.add(sessionId)
							log("info", `[autowork][${sid(sessionId)}] Recovered loop from filesystem`)
						}
					} catch {}
				}

				// Only act if autowork loop is active
				if (!loopState.active) return

				try {
					const t = AUTOWORK_THRESHOLDS

					// Safety gates
					const gateResult = checkLoopSafetyGates(
						loopState,
						t.abortGracePeriodMs,
						t.maxConsecutiveFailures,
						t.failureResetWindowMs,
						t.baseCooldownMs,
					)

					if (gateResult === "__reset_failures__") {
						loopState = { ...loopState, consecutiveFailures: 0 }
						loopStates.set(sessionId, loopState)
						log("info", `[autowork][${sid(sessionId)}] Failure count reset after recovery window`)
					} else if (gateResult) {
						// Quick-check: if the loop should STOP, don't let cooldown prevent termination
						try {
							const quickMsgs = await client.session.messages({ path: { id: sessionId } }).catch(() => ({ data: [] as any[] }))
							const quickTexts = extractAssistantTexts((quickMsgs.data ?? []) as any[], loopState.messageCountAtStart)
							const quickDecision = evaluateLoop(loopState, quickTexts)
							if (quickDecision.action === "stop") {
								log("info", `[autowork][${sid(sessionId)}] Stop detected during gate cooldown — ${quickDecision.reason}`)
								loopState = stopLoop(loopState)
								loopStates.set(sessionId, loopState)
								autoworkActiveSessions.delete(sessionId)
								return
							}
						} catch {}

						log("info", `[autowork][${sid(sessionId)}] Gate: ${gateResult}`)
						return
					}

					// Fetch messages AND todos in parallel
					const [messagesRes, loopTodoRes] = await Promise.all([
						client.session.messages({ path: { id: sessionId } }).catch(() => ({ data: [] as any[] })),
						client.session.todo({ path: { id: sessionId } }).catch(() => ({ data: [] as Todo[] })),
					])
					const messages = (messagesRes.data ?? []) as any[]
					const loopTodos = (loopTodoRes.data ?? []) as Todo[]

					if (hasPendingQuestion(messages)) {
						log("info", `[autowork][${sid(sessionId)}] Skipped: pending question`)
						return
					}

					const allTexts = extractAssistantTexts(messages, loopState.messageCountAtStart)

					const decision = evaluateLoop(loopState, allTexts, loopTodos)
					log("info", `[autowork][${sid(sessionId)}] ${decision.action} — ${decision.reason}`)

					if (decision.action === "verify" && decision.prompt) {
						loopState = advanceIteration(enterVerification(loopState))
						loopStates.set(sessionId, loopState)
						await client.session.promptAsync({
							path: { id: sessionId },
							body: { parts: [{ type: "text" as const, text: wrapSystemPrompt(decision.prompt, "autowork-verify") }] },
						}).catch((err: unknown) => {
							log("warn", `[autowork][${sid(sessionId)}] promptAsync failed: ${err}`)
							loopState = recordFailure(loopState)
							loopStates.set(sessionId, loopState)
						})
					} else if (decision.action === "continue" && decision.prompt) {
						loopState = advanceIteration(loopState)
						loopStates.set(sessionId, loopState)
						await client.session.promptAsync({
							path: { id: sessionId },
							body: { parts: [{ type: "text" as const, text: wrapSystemPrompt(decision.prompt, "autowork-continue") }] },
						}).catch((err: unknown) => {
							log("warn", `[autowork][${sid(sessionId)}] promptAsync failed: ${err}`)
							loopState = recordFailure(loopState)
							loopStates.set(sessionId, loopState)
						})
					} else if (decision.action === "stop") {
						loopState = stopLoop(loopState)
						loopStates.set(sessionId, loopState)
						autoworkActiveSessions.delete(sessionId)
						log("info", `[autowork][${sid(sessionId)}] Complete: ${decision.reason}`)
					}
				} catch (err) {
					log("warn", `[autowork][${sid(sessionId)}] Evaluation error: ${err}`)
					loopState = recordFailure(loopState)
					loopStates.set(sessionId, loopState)
				}
			} catch (err) {
				log("warn", `[autowork] event hook error: ${err}`)
			}
		},
	}
}

export default KortixAutoworkPlugin
