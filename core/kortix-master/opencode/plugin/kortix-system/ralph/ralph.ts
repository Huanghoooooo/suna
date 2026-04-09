/**
 * Ralph plugin — canonical single-owner persistent execution loop.
 *
 * `/ralph` is the preferred command.
 * `/autowork` is kept as a compatibility alias.
 */

import type { Plugin } from "@opencode-ai/plugin"
import type { Todo } from "@opencode-ai/sdk"
import {
	CODE_BLOCK_PATTERN,
	INLINE_CODE_PATTERN,
	INTERNAL_MARKER,
	RALPH_THRESHOLDS,
	parseRalphArgs,
	createInitialRalphState,
} from "./config"
import {
	advanceRalph,
	appendTaskContext,
	loadAllRalphStates,
	loadRalphState,
	persistRalphState,
	recordRalphAbort,
	recordRalphFailure,
	removeRalphState,
	startRalph,
	stopRalph,
} from "./state"
import { checkRalphSafetyGates, evaluateRalph } from "./engine"

export const ralphActiveSessions = new Set<string>()

function wrapSystemPrompt(text: string, type: string): string {
	return `<kortix_system type="${type}" source="kortix-ralph">\n${text}\n</kortix_system>`
}

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

function cleanText(text: string): string {
	return text
		.replace(CODE_BLOCK_PATTERN, "")
		.replace(INLINE_CODE_PATTERN, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.trim()
}

function isInternalMessage(text: string): boolean {
	return text.includes(INTERNAL_MARKER) || text.includes("[RALPH -") || text.includes("<kortix_system")
}

function extractRenderedCommandArgs(text: string): string {
	const quotedBlocks = [...text.matchAll(/"([\s\S]*?)"/g)]
	for (let i = quotedBlocks.length - 1; i >= 0; i--) {
		const candidate = quotedBlocks[i]?.[1]?.trim()
		if (candidate && (candidate.includes("--completion-promise") || candidate.includes("--max-iterations") || candidate.length > 0)) {
			return candidate
		}
	}
	const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
	return lines.at(-1) ?? ""
}

function extractAssistantTexts(messages: any[], fromIndex = 0): string[] {
	const texts: string[] = []
	for (let i = fromIndex; i < messages.length; i++) {
		const message = messages[i]
		if (message?.info?.role !== "assistant") continue
		let text = ""
		for (const part of message.parts ?? []) {
			if (part.type === "text" && !part.synthetic && !part.ignored) text += `${part.text ?? ""}\n`
		}
		if (text.trim()) texts.push(text.trim())
	}
	return texts
}

function hasPendingQuestion(messages: any[]): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		const role = message?.info?.role
		if (role === "user") return false
		if (role !== "assistant") continue
		for (const part of message.parts ?? []) {
			if (part.type !== "tool") continue
			const toolName = (part.toolName ?? part.tool_name ?? part.name ?? "") as string
			const status = part.state?.status ?? ""
			if ((toolName === "question" || toolName === "mcp_question") && (status === "running" || status === "pending")) return true
		}
	}
	return false
}

class SessionStateMap<T> {
	private map = new Map<string, { state: T; lastAccessedAt: number }>()
	private lastGcAt = Date.now()
	private readonly gcIntervalMs = 10 * 60 * 1000
	private readonly ttlMs = 2 * 60 * 60 * 1000

	constructor(private readonly factory: (sessionId: string) => T) {}

	get(sessionId: string): T {
		this.maybeGc()
		const existing = this.map.get(sessionId)
		if (existing) {
			existing.lastAccessedAt = Date.now()
			return existing.state
		}
		const state = this.factory(sessionId)
		this.map.set(sessionId, { state, lastAccessedAt: Date.now() })
		return state
	}

	set(sessionId: string, state: T): void {
		this.map.set(sessionId, { state, lastAccessedAt: Date.now() })
	}

	has(sessionId: string): boolean {
		return this.map.has(sessionId)
	}

	delete(sessionId: string): void {
		this.map.delete(sessionId)
	}

	private maybeGc(): void {
		const now = Date.now()
		if (now - this.lastGcAt < this.gcIntervalMs) return
		this.lastGcAt = now
		const cutoff = now - this.ttlMs
		for (const [key, entry] of this.map) {
			if (entry.lastAccessedAt < cutoff) this.map.delete(key)
		}
	}
}

const RalphPlugin: Plugin = async ({ client }) => {
	const states = new SessionStateMap((_sid) => createInitialRalphState())
	const pendingCommand = new Map<string, { command: string; args: string }>()

	try {
		const persisted = loadAllRalphStates()
		for (const [sid, state] of persisted) {
			if (state.active && !state.stopped) {
				states.set(sid, state)
				ralphActiveSessions.add(sid)
			}
		}
	} catch {
		// ignore recovery failures
	}

	const log = (level: "info" | "warn" | "error", message: string) => {
		try {
			client.app.log({ body: { service: "kortix-ralph", level, message } }).catch(() => {})
		} catch {
			// ignore
		}
	}

	const sid = (sessionId: string) => sessionId.length > 16 ? sessionId.slice(-12) : sessionId

	return {
		"command.execute.before": async (input: any) => {
			const command = input?.command as string | undefined
			const sessionId = input?.sessionID as string | undefined
			const args = (input?.arguments as string | undefined) || ""
			if (!command || !sessionId) return
			if (["ralph", "ralph-loop", "autowork", "cancel-ralph", "autowork-cancel"].includes(command)) {
				pendingCommand.set(sessionId, { command, args })
				log("info", `[ralph][${sid(sessionId)}] command.execute.before: ${command} \"${args.slice(0, 80)}\"`)
			}
		},

		"chat.message": async (input: any, output: any) => {
			try {
				const sessionId = input?.sessionID as string | undefined
				if (!sessionId) return

				const messageText = extractMessageText(output)
				if (!messageText || isInternalMessage(messageText)) return

				let state = states.get(sessionId)
				const clean = cleanText(messageText)
				const pending = pendingCommand.get(sessionId)

				const cancelMatch = pending?.command === "cancel-ralph"
					|| pending?.command === "autowork-cancel"
					|| /\/(?:cancel-ralph|autowork-cancel)\b/.test(clean)

				if (cancelMatch) {
					pendingCommand.delete(sessionId)
					if (state.active) {
						state = stopRalph(state, "cancelled")
						states.set(sessionId, state)
						ralphActiveSessions.delete(sessionId)
						log("info", `[ralph][${sid(sessionId)}] Cancelled`)
					}
					return
				}

				const ralphMatch = pending?.command === "ralph"
					|| pending?.command === "ralph-loop"
					|| pending?.command === "autowork"
					|| /\/(?:ralph|ralph-loop|autowork)\b/.test(clean)

				if (ralphMatch) {
					const pendingArgs = pending?.args?.trim()
					const rawArgs = pendingArgs
						|| (() => {
							const slashForm = clean.replace(/^.*?\/(?:ralph|ralph-loop|autowork)\s*/i, "").trim()
							if (slashForm && slashForm !== clean) return slashForm
							return extractRenderedCommandArgs(clean)
						})()
					const { task, options } = parseRalphArgs(rawArgs)
					pendingCommand.delete(sessionId)

					if (state.active) {
						state = appendTaskContext(state, `[User added context at iteration ${state.iteration}]: ${task}`)
						states.set(sessionId, state)
						log("info", `[ralph][${sid(sessionId)}] Context appended mid-loop`)
					} else {
						let msgCount = 0
						try {
							const result = await client.session.messages({ path: { id: sessionId } }).catch(() => ({ data: [] as any[] }))
							msgCount = (result.data ?? []).length
						} catch {
							// ignore
						}
						state = startRalph(task, sessionId, msgCount, options.maxIterations, options.completionPromise)
						states.set(sessionId, state)
						ralphActiveSessions.add(sessionId)
						log("info", `[ralph][${sid(sessionId)}] Activated: \"${task.slice(0, 80)}\"`)
					}
					return
				}

				if (state.active) {
					state = appendTaskContext(state, `[User message at iteration ${state.iteration}]: ${messageText.slice(0, 500)}`)
					states.set(sessionId, state)
					log("info", `[ralph][${sid(sessionId)}] User message absorbed`)
				}
			} catch (error) {
				log("warn", `[ralph] chat.message error: ${error}`)
			}
		},

		event: async ({ event }) => {
			try {
				if (event.type === "session.deleted") {
					const sessionId = (event as any).properties?.info?.id ?? (event as any).properties?.sessionID
					if (sessionId) {
						states.delete(sessionId)
						ralphActiveSessions.delete(sessionId)
						removeRalphState(sessionId)
					}
					return
				}

				if (event.type === "session.error" || (event.type as string) === "session.aborted") {
					const sessionId = (event as any).properties?.sessionID as string | undefined
					if (!sessionId || !states.has(sessionId)) return
					const state = states.get(sessionId)
					if (!state.active) return
					states.set(sessionId, recordRalphAbort(state))
					log("info", `[ralph][${sid(sessionId)}] Abort recorded`)
					return
				}

				if (event.type !== "session.idle") return
				const sessionId = (event as any).properties?.sessionID as string | undefined
				if (!sessionId) return

				let state = states.get(sessionId)
				if (!state.active) {
					const persisted = loadRalphState(sessionId)
					if (persisted?.active && !persisted.stopped) {
						state = persisted
						states.set(sessionId, state)
						ralphActiveSessions.add(sessionId)
						log("info", `[ralph][${sid(sessionId)}] Recovered persisted state`)
					}
				}
				if (!state.active) return

				const gateResult = checkRalphSafetyGates(
					state,
					RALPH_THRESHOLDS.abortGracePeriodMs,
					RALPH_THRESHOLDS.maxConsecutiveFailures,
					RALPH_THRESHOLDS.failureResetWindowMs,
					RALPH_THRESHOLDS.baseCooldownMs,
				)

				if (gateResult === "__reset_failures__") {
					state = { ...state, consecutiveFailures: 0 }
					persistRalphState(state)
					states.set(sessionId, state)
				} else if (gateResult) {
					log("info", `[ralph][${sid(sessionId)}] Gate: ${gateResult}`)
					return
				}

				const [messagesRes, todoRes] = await Promise.all([
					client.session.messages({ path: { id: sessionId } }).catch(() => ({ data: [] as any[] })),
					client.session.todo({ path: { id: sessionId } }).catch(() => ({ data: [] as Todo[] })),
				])

				const messages = (messagesRes.data ?? []) as any[]
				const todos = (todoRes.data ?? []) as Todo[]

				if (hasPendingQuestion(messages)) {
					log("info", `[ralph][${sid(sessionId)}] Skipped: pending question`)
					return
				}

				const assistantTexts = extractAssistantTexts(messages, state.messageCountAtStart)
				const decision = evaluateRalph(state, assistantTexts, todos)
				log("info", `[ralph][${sid(sessionId)}] ${decision.action} — ${decision.reason}`)

				if (decision.action === "stop") {
					state = stopRalph(state, decision.phase === "failed" ? "failed" : decision.phase === "cancelled" ? "cancelled" : "complete")
					states.set(sessionId, state)
					ralphActiveSessions.delete(sessionId)
					return
				}

				if (decision.prompt) {
					state = advanceRalph(state, decision.phase)
					states.set(sessionId, state)
					await client.session.promptAsync({
						path: { id: sessionId },
						body: { parts: [{ type: "text", text: wrapSystemPrompt(decision.prompt, "ralph-continue") }] },
					}).catch((error: unknown) => {
						log("warn", `[ralph][${sid(sessionId)}] promptAsync failed: ${error}`)
						state = recordRalphFailure(state)
						states.set(sessionId, state)
					})
				}
			} catch (error) {
				log("warn", `[ralph] event error: ${error}`)
			}
		},
	}
}

export default RalphPlugin
