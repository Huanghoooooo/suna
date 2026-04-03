/**
 * Continuation Engine — Passive session.idle evaluator
 *
 * Used only when no active autowork loop is running. Combines signals from
 * IntentGate and TodoEnforcer to decide whether to inject a continuation
 * prompt when the session goes idle.
 *
 * The active autowork loop is handled directly in loop.ts / index.ts.
 * This engine is the "passive continuation" fallback for when the user
 * hasn't explicitly started a loop but has incomplete tracked work.
 */

import type { Todo } from "@opencode-ai/sdk"
import type { ContinuationConfig, ContinuationState } from "../lib/autowork-config"
import { INTERNAL_MARKER } from "../lib/autowork-config"
import { classifyIntent, type IntentResult } from "./intent-gate"
import { evaluateTodos, formatRemainingWork, type TodoEnforcerResult } from "../lib/todo-enforcer"

// ─── Decision Types ───────────────────────────────────────────────────────────

export type ContinuationAction = "continue" | "stop"

export interface ContinuationDecision {
	action: ContinuationAction
	/** The prompt to inject if action === "continue" */
	prompt: string | null
	/** Human-readable reason for the decision (logged, not sent to model) */
	reason: string
	/** Signal sources that informed the decision */
	signals: {
		intent?: IntentResult
		todo?: TodoEnforcerResult
		safetyCheck?: string
	}
}

// ─── Safety Checks ────────────────────────────────────────────────────────────

function checkSafetyLimits(
	config: ContinuationConfig,
	state: ContinuationState,
): string | null {
	const now = Date.now()

	// Session-wide limit
	if (state.totalSessionContinuations >= config.thresholds.maxSessionContinuations) {
		return `max session continuations reached (${config.thresholds.maxSessionContinuations})`
	}

	// Min work duration (don't continue if agent barely started)
	if (state.workCycleStartedAt > 0 && now - state.workCycleStartedAt < config.thresholds.minWorkDurationMs) {
		return `min work duration not met (${config.thresholds.minWorkDurationMs}ms)`
	}

	// Circuit breaker: too many consecutive aborts/empty responses
	if (state.consecutiveAborts >= config.thresholds.maxConsecutiveAborts) {
		return `circuit breaker: ${state.consecutiveAborts} consecutive aborts/empty responses — stopping passive continuation`
	}

	// Passive cooldown: minimum time between passive continuation attempts
	if (state.lastContinuationAt > 0) {
		const elapsed = now - state.lastContinuationAt
		if (elapsed < config.thresholds.passiveCooldownMs) {
			return `passive cooldown: ${Math.round((config.thresholds.passiveCooldownMs - elapsed) / 1000)}s remaining`
		}
	}

	// Abort grace period: skip continuation shortly after an abort
	if (state.lastAbortAt > 0) {
		const timeSinceAbort = now - state.lastAbortAt
		if (timeSinceAbort < config.thresholds.abortGracePeriodMs) {
			return `abort grace period: ${Math.round((config.thresholds.abortGracePeriodMs - timeSinceAbort) / 1000)}s remaining`
		}
	}

	// In-flight guard: prevent double-fire race condition
	if (state.inflight) {
		return `continuation already in-flight — skipping to prevent double-fire`
	}

	return null
}

// ─── Continuation Prompt Builder ─────────────────────────────────────────────

function buildContinuationPrompt(
	todoResult: TodoEnforcerResult | null,
	state: ContinuationState,
): string {
	const parts: string[] = []

	parts.push(`[SYSTEM REMINDER - TODO CONTINUATION]`)
	parts.push(`You have unfinished work. Continue from where you left off.`)
	parts.push(`Session continuations so far: ${state.totalSessionContinuations}.`)

	if (todoResult && todoResult.remainingItems.length > 0) {
		parts.push("")
		parts.push(formatRemainingWork(todoResult))
	}

	parts.push("")
	parts.push(`Pick up the next pending/in-progress item and continue working. Do not re-explain what was already done.`)
	parts.push(INTERNAL_MARKER)

	return parts.join("\n")
}

// ─── Main Evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate whether a session should passively continue after going idle.
 * Only called when no active autowork loop is running.
 *
 * Decision flow:
 *   1. Feature check — continuation must be enabled
 *   2. Empty response check — if last response was empty/aborted, don't continue
 *   3. Safety limits — session cap, min work duration, abort circuit breaker, cooldown
 *   4. IntentGate — classify last assistant message (stop on completed/blocked/answer)
 *   5. TodoEnforcer — check for unfinished tracked work → continue if unfinished
 *   6. Default → stop (conservative)
 */
export function evaluate(
	config: ContinuationConfig,
	state: ContinuationState,
	lastAssistantText: string,
	hadToolCalls: boolean,
	todos: Todo[],
): ContinuationDecision {
	if (!config.features.continuation) {
		return { action: "stop", prompt: null, reason: "continuation disabled", signals: {} }
	}

	// Empty/aborted response check — if the assistant produced nothing, this was
	// likely an abort (context window exhaustion, timeout, etc.). Don't loop on it.
	if (!lastAssistantText.trim() && !hadToolCalls) {
		return {
			action: "stop",
			prompt: null,
			reason: "empty/aborted assistant response — skipping continuation",
			signals: { safetyCheck: "empty_response" },
		}
	}

	const safetyViolation = checkSafetyLimits(config, state)
	if (safetyViolation) {
		return {
			action: "stop",
			prompt: null,
			reason: `safety: ${safetyViolation}`,
			signals: { safetyCheck: safetyViolation },
		}
	}

	// IntentGate classification
	let intentResult: IntentResult | undefined
	if (config.features.intentGate) {
		intentResult = classifyIntent(lastAssistantText, hadToolCalls, todos)

		if (intentResult.intent === "completed") {
			return { action: "stop", prompt: null, reason: "intent: completed", signals: { intent: intentResult } }
		}
		if (intentResult.intent === "blocked-human") {
			return { action: "stop", prompt: null, reason: "intent: blocked on user", signals: { intent: intentResult } }
		}
		if (intentResult.intent === "blocked-external") {
			return { action: "stop", prompt: null, reason: "intent: blocked on external", signals: { intent: intentResult } }
		}
		if (intentResult.intent === "answer") {
			return { action: "stop", prompt: null, reason: "intent: answer-only", signals: { intent: intentResult } }
		}
		if (intentResult.intent === "blocked-question") {
			return { action: "stop", prompt: null, reason: "intent: pending question awaiting user", signals: { intent: intentResult } }
		}
	}

	// TodoEnforcer — primary signal for passive continuation
	let todoResult: TodoEnforcerResult | undefined
	if (config.features.todoEnforcer) {
		todoResult = evaluateTodos(todos)

		if (todoResult.verdict === "done") {
			return {
				action: "stop",
				prompt: null,
				reason: `todos: ${todoResult.reason}`,
				signals: { intent: intentResult, todo: todoResult },
			}
		}

		if (todoResult.verdict === "blocked") {
			return {
				action: "stop",
				prompt: null,
				reason: `todos: ${todoResult.reason}`,
				signals: { intent: intentResult, todo: todoResult },
			}
		}

		if (todoResult.verdict === "unfinished") {
			return {
				action: "continue",
				prompt: buildContinuationPrompt(todoResult, state),
				reason: `todos: ${todoResult.reason}`,
				signals: { intent: intentResult, todo: todoResult },
			}
		}
	}

	// Intent-only fallback (no todo enforcer)
	if (intentResult?.shouldContinue) {
		return {
			action: "continue",
			prompt: buildContinuationPrompt(todoResult ?? null, state),
			reason: `intent: ${intentResult.reason}`,
			signals: { intent: intentResult },
		}
	}

	// Default: stop (conservative)
	return {
		action: "stop",
		prompt: null,
		reason: "no continuation signals",
		signals: { intent: intentResult, todo: todoResult },
	}
}
