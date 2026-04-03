/**
 * Kortix Autowork — Configuration
 *
 * One canonical autowork loop. No alternate algorithms.
 */

export const INTERNAL_MARKER = "<!-- KORTIX_INTERNAL -->"
export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
export const INLINE_CODE_PATTERN = /`[^`]+`/g

export interface ContinuationFeatures {
	continuation: boolean
	todoEnforcer: boolean
	intentGate: boolean
	planner: boolean
}

export interface ContinuationThresholds {
	baseCooldownMs: number
	maxConsecutiveFailures: number
	failureResetWindowMs: number
	abortGracePeriodMs: number
	minWorkDurationMs: number
	maxSessionContinuations: number
	maxConsecutiveAborts: number
	passiveCooldownMs: number
}

export interface ContinuationConfig {
	features: ContinuationFeatures
	thresholds: ContinuationThresholds
}

export const DEFAULT_FEATURES: ContinuationFeatures = {
	continuation: true,
	todoEnforcer: true,
	intentGate: true,
	planner: false,
}

export const DEFAULT_THRESHOLDS: ContinuationThresholds = {
	baseCooldownMs: 3_000,
	maxConsecutiveFailures: 5,
	failureResetWindowMs: 5 * 60_000,
	abortGracePeriodMs: 3_000,
	minWorkDurationMs: 8_000,
	maxSessionContinuations: 50,
	maxConsecutiveAborts: 3,
	passiveCooldownMs: 5_000,
}

export const DEFAULT_CONFIG: ContinuationConfig = {
	features: { ...DEFAULT_FEATURES },
	thresholds: { ...DEFAULT_THRESHOLDS },
}

export interface ContinuationState {
	sessionId: string | null
	totalSessionContinuations: number
	workCycleStartedAt: number
	consecutiveAborts: number
	lastAbortAt: number
	lastContinuationAt: number
	inflight: boolean
}

export function createInitialState(): ContinuationState {
	return {
		sessionId: null,
		totalSessionContinuations: 0,
		workCycleStartedAt: 0,
		consecutiveAborts: 0,
		lastAbortAt: 0,
		lastContinuationAt: 0,
		inflight: false,
	}
}

export function mergeConfig(partial: Partial<ContinuationConfig>): ContinuationConfig {
	return {
		features: {
			...DEFAULT_FEATURES,
			...partial.features,
		},
		thresholds: {
			...DEFAULT_THRESHOLDS,
			...partial.thresholds,
		},
	}
}

export type AutoworkAlgorithm = "kraemer"

export const COMMAND_TO_ALGORITHM: Record<string, AutoworkAlgorithm> = {
	autowork: "kraemer",
	"autowork-team": "kraemer",
}

export const AUTOWORK_LOOP_CONFIG = {
	maxIterations: 500,
	completionPromise: "<promise>DONE</promise>",
	verificationPromise: "<promise>VERIFIED</promise>",
	selfVerify: true,
} as const

export interface LoopState {
	active: boolean
	taskPrompt: string | null
	iteration: number
	sessionId: string | null
	startedAt: number
	inVerification: boolean
	messageCountAtStart: number
	consecutiveFailures: number
	lastFailureAt: number
	lastInjectedAt: number
	stopped: boolean
	lastAbortAt: number
	algorithm: AutoworkAlgorithm
}

export function createInitialLoopState(): LoopState {
	return {
		active: false,
		taskPrompt: null,
		iteration: 0,
		sessionId: null,
		startedAt: 0,
		inVerification: false,
		messageCountAtStart: 0,
		consecutiveFailures: 0,
		lastFailureAt: 0,
		lastInjectedAt: 0,
		stopped: false,
		lastAbortAt: 0,
		algorithm: "kraemer",
	}
}
