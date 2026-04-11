import type { Todo } from "@opencode-ai/sdk"
import { completionReached, INTERNAL_MARKER, type AutoworkPhase, type AutoworkState } from "./config"

export type AutoworkAction = "continue" | "stop"

export interface AutoworkDecision {
	action: AutoworkAction
	phase: AutoworkPhase
	prompt: string | null
	reason: string
}

function todoSummary(todos: Todo[]): { unfinished: Todo[]; completedCount: number } {
	const unfinished = todos.filter((todo) => todo.status === "pending" || todo.status === "in_progress")
	const completedCount = todos.filter((todo) => todo.status === "completed" || todo.status === "cancelled").length
	return { unfinished, completedCount }
}

function buildContinuePrompt(state: AutoworkState): string {
	return [
		`[AUTOWORK - ITERATION ${state.iteration + 1}/${state.maxIterations}]`,
		"",
		"Your previous attempt did not output the completion promise.",
		"Continue working on the task. Persist until it is truly complete.",
		"",
		"Rules:",
		"- Keep your todo list current as the contract for remaining work.",
		"- Gather fresh verification evidence before claiming completion.",
		"- Do not stop at partial completion.",
		"- If blocked by missing info, say exactly what is blocked and why.",
		"",
		state.taskPrompt ? `Original task: ${state.taskPrompt}` : null,
		"",
		`When the task is fully complete and verified, emit exactly: ${state.completionPromise}`,
		INTERNAL_MARKER,
	].filter(Boolean).join("\n")
}

function buildPrematureCompletionPrompt(state: AutoworkState, todos: Todo[]): string {
	const { unfinished, completedCount } = todoSummary(todos)
	return [
		"[AUTOWORK - COMPLETION REJECTED]",
		"",
		`You emitted the completion promise (${state.completionPromise}) before all todo items were finished.`,
		"Autowork does not allow silent partial completion. Continue fixing the remaining work.",
		"",
		`Todo status: ${completedCount}/${todos.length} complete.`,
		...unfinished.map((todo) => `- [${todo.status}] ${todo.content}`),
		"",
		`Do not emit ${state.completionPromise} again until every pending/in_progress todo is finished or cancelled with a clear reason.`,
		INTERNAL_MARKER,
	].join("\n")
}

function buildVerificationPrompt(state: AutoworkState): string {
	return [
		`[AUTOWORK - VERIFICATION]`,
		"",
		"You claimed the task is complete. Now PROVE it.",
		"",
		`**Verification condition:** ${state.verificationCondition}`,
		"",
		"Run the actual verification steps right now:",
		"- Execute commands, read files, run tests — whatever the condition requires",
		"- Show concrete evidence (command output, file contents, test results)",
		"- Do NOT just claim it passes — demonstrate it",
		"",
		"If verification passes: emit " + state.completionPromise + " again",
		"If verification fails: fix the issues and try again",
		INTERNAL_MARKER,
	].filter(Boolean).join("\n")
}

export function evaluateAutowork(state: AutoworkState, assistantTexts: string[], todos: Todo[]): AutoworkDecision {
	if (!state.active) return { action: "stop", phase: state.currentPhase, prompt: null, reason: "inactive" }
	if (state.iteration >= state.maxIterations) {
		return {
			action: "stop",
			phase: "failed",
			prompt: null,
			reason: `max iterations reached (${state.maxIterations})`,
		}
	}

	const completionSeen = assistantTexts.some((text) => completionReached(text, state.completionPromise))
	const { unfinished } = todoSummary(todos)

	if (completionSeen) {
		if (unfinished.length > 0) {
			return {
				action: "continue",
				phase: "fixing",
				prompt: buildPrematureCompletionPrompt(state, todos),
				reason: `completion promise seen but ${unfinished.length} todo item(s) remain`,
			}
		}

		// If there's a verification condition and we haven't verified yet, run verification
		if (state.verificationCondition && !state.verificationAttempted) {
			return {
				action: "continue",
				phase: "verifying",
				prompt: buildVerificationPrompt(state),
				reason: "completion promise detected — running verification",
			}
		}

		return {
			action: "stop",
			phase: "complete",
			prompt: null,
			reason: "completion promise detected, todos clear" + (state.verificationAttempted ? ", verification passed" : ""),
		}
	}

	return {
		action: "continue",
		phase: state.currentPhase === "starting" ? "executing" : state.currentPhase === "fixing" ? "fixing" : "executing",
		prompt: buildContinuePrompt(state),
		reason: `iteration ${state.iteration + 1}/${state.maxIterations}`,
	}
}

export function checkAutoworkSafetyGates(
	state: AutoworkState,
	abortGracePeriodMs: number,
	maxConsecutiveFailures: number,
	failureResetWindowMs: number,
	baseCooldownMs: number,
): string | null {
	if (state.stopped) return "continuation stopped by user — use /autowork to restart"
	if (state.lastAbortAt > 0) {
		const timeSinceAbort = Date.now() - state.lastAbortAt
		if (timeSinceAbort < abortGracePeriodMs) return `abort grace period: ${Math.round((abortGracePeriodMs - timeSinceAbort) / 1000)}s remaining`
	}
	if (state.consecutiveFailures >= maxConsecutiveFailures) {
		if (state.lastFailureAt > 0 && Date.now() - state.lastFailureAt >= failureResetWindowMs) return "__reset_failures__"
		return `max consecutive failures (${state.consecutiveFailures}) — pausing for ${Math.round(failureResetWindowMs / 60000)} min`
	}
	if (state.lastInjectedAt > 0 && state.consecutiveFailures > 0) {
		const effectiveCooldown = baseCooldownMs * Math.pow(2, Math.min(state.consecutiveFailures, 5))
		const elapsed = Date.now() - state.lastInjectedAt
		if (elapsed < effectiveCooldown) return `backoff cooldown: ${Math.round((effectiveCooldown - elapsed) / 1000)}s remaining (failure ${state.consecutiveFailures})`
	}
	if (state.lastInjectedAt > 0 && state.consecutiveFailures === 0) {
		const elapsed = Date.now() - state.lastInjectedAt
		if (elapsed < baseCooldownMs) return `minimum cooldown: ${Math.round((baseCooldownMs - elapsed) / 1000)}s remaining`
	}
	return null
}
