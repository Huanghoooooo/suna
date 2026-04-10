export const INTERNAL_MARKER = "<!-- KORTIX_INTERNAL -->"
export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
export const INLINE_CODE_PATTERN = /`[^`]+`/g

export type RalphPhase = "starting" | "executing" | "verifying" | "fixing" | "complete" | "failed" | "cancelled"

export interface RalphOptions {
	maxIterations: number
	completionPromise: string
	verificationCondition: string | null
}

export interface RalphState {
	active: boolean
	sessionId: string | null
	taskPrompt: string | null
	verificationCondition: string | null
	verificationAttempted: boolean
	iteration: number
	maxIterations: number
	completionPromise: string
	currentPhase: RalphPhase
	startedAt: number
	completedAt: number | null
	messageCountAtStart: number
	lastInjectedAt: number
	consecutiveFailures: number
	lastFailureAt: number
	lastAbortAt: number
	stopped: boolean
}

export const RALPH_DEFAULTS: RalphOptions = {
	maxIterations: 50,
	completionPromise: "DONE",
	verificationCondition: null,
}

export const RALPH_THRESHOLDS = {
	baseCooldownMs: 3_000,
	maxConsecutiveFailures: 5,
	failureResetWindowMs: 5 * 60_000,
	abortGracePeriodMs: 3_000,
} as const

export function createInitialRalphState(): RalphState {
	return {
		active: false,
		sessionId: null,
		taskPrompt: null,
		verificationCondition: null,
		verificationAttempted: false,
		iteration: 0,
		maxIterations: RALPH_DEFAULTS.maxIterations,
		completionPromise: RALPH_DEFAULTS.completionPromise,
		currentPhase: "cancelled",
		startedAt: 0,
		completedAt: null,
		messageCountAtStart: 0,
		lastInjectedAt: 0,
		consecutiveFailures: 0,
		lastFailureAt: 0,
		lastAbortAt: 0,
		stopped: false,
	}
}

function tokenizeArgs(raw: string): string[] {
	const tokens = raw.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? []
	return tokens.map((token) => token.replace(/^['"]|['"]$/g, ""))
}

export function parseRalphArgs(raw: string): { options: RalphOptions; task: string } {
	const tokens = tokenizeArgs(raw.trim())
	const options: RalphOptions = { ...RALPH_DEFAULTS }
	const taskTokens: string[] = []

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]
		if (!token) continue
		if (token === "--max-iterations") {
			const value = Number(tokens[i + 1])
			if (Number.isFinite(value) && value > 0) {
				options.maxIterations = value
				i += 1
				continue
			}
		}
		if (token === "--completion-promise") {
			const value = tokens[i + 1]
			if (value) {
				options.completionPromise = value
				i += 1
				continue
			}
		}
		if (token === "--verification") {
			const value = tokens[i + 1]
			if (value) {
				options.verificationCondition = value
				i += 1
				continue
			}
		}
		taskTokens.push(token)
	}

	return {
		options,
		task: taskTokens.join(" ").trim() || "Unspecified task",
	}
}

export function completionReached(text: string, completionPromise: string): boolean {
	const trimmed = text.trim()
	if (!trimmed) return false
	if (trimmed === completionPromise) return true
	return trimmed
		.split(/\r?\n/)
		.map((line) => line.trim())
		.some((line) => line === completionPromise)
}
