import type { Todo } from "@opencode-ai/sdk"
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ensureKortixDir } from "../../kortix-paths"
import { AUTOWORK_LOOP_CONFIG, INTERNAL_MARKER, createInitialLoopState, type AutoworkAlgorithm, type LoopState } from "./config"
import { evaluateTodos, formatRemainingWork } from "./todo-enforcer"

const KORTIX_DIR = ensureKortixDir(import.meta.dir)
const LOOP_STATE_DIR = `${KORTIX_DIR}/loop-states`
const LEGACY_LOOP_STATE_PATH = `${KORTIX_DIR}/loop-state.json`

function loopStatePath(sessionId: string): string {
	return join(LOOP_STATE_DIR, `${sessionId}.json`)
}

export function persistLoopState(state: LoopState): void {
	try {
		if (!state.sessionId) return
		if (!existsSync(LOOP_STATE_DIR)) mkdirSync(LOOP_STATE_DIR, { recursive: true })
		writeFileSync(loopStatePath(state.sessionId), JSON.stringify(state, null, 2), "utf-8")
	} catch {
		// non-fatal
	}
}

export function loadPersistedLoopState(sessionId?: string): LoopState | null {
	try {
		if (sessionId) {
			const path = loopStatePath(sessionId)
			if (existsSync(path)) {
				const parsed = JSON.parse(readFileSync(path, "utf-8")) as LoopState
				if (typeof parsed.active === "boolean") return parsed
			}
		}
		if (existsSync(LEGACY_LOOP_STATE_PATH)) {
			const parsed = JSON.parse(readFileSync(LEGACY_LOOP_STATE_PATH, "utf-8")) as LoopState
			if (typeof parsed.active !== "boolean") return null
			if (parsed.sessionId) {
				persistLoopState(parsed)
				try { unlinkSync(LEGACY_LOOP_STATE_PATH) } catch {}
			}
			return parsed
		}
		return null
	} catch {
		return null
	}
}

export function loadAllPersistedLoopStates(): Map<string, LoopState> {
	const states = new Map<string, LoopState>()
	try {
		if (existsSync(LOOP_STATE_DIR)) {
			for (const file of readdirSync(LOOP_STATE_DIR).filter((f) => f.endsWith(".json"))) {
				try {
					const parsed = JSON.parse(readFileSync(join(LOOP_STATE_DIR, file), "utf-8")) as LoopState
					if (typeof parsed.active === "boolean" && parsed.sessionId) states.set(parsed.sessionId, parsed)
				} catch {}
			}
		}
		if (existsSync(LEGACY_LOOP_STATE_PATH)) {
			const parsed = JSON.parse(readFileSync(LEGACY_LOOP_STATE_PATH, "utf-8")) as LoopState
			if (typeof parsed.active === "boolean" && parsed.sessionId && !states.has(parsed.sessionId)) {
				states.set(parsed.sessionId, parsed)
				persistLoopState(parsed)
				try { unlinkSync(LEGACY_LOOP_STATE_PATH) } catch {}
			}
		}
	} catch {}
	return states
}

export function removePersistedLoopState(sessionId: string): void {
	try {
		const path = loopStatePath(sessionId)
		if (existsSync(path)) unlinkSync(path)
	} catch {}
}

export function startLoop(taskPrompt: string, sessionId: string, messageCountAtStart = 0, algorithm: AutoworkAlgorithm = "kraemer"): LoopState {
	const state: LoopState = {
		...createInitialLoopState(),
		active: true,
		taskPrompt,
		sessionId,
		startedAt: Date.now(),
		messageCountAtStart,
		algorithm,
	}
	persistLoopState(state)
	return state
}

export function stopLoop(state: LoopState): LoopState {
	const updated = { ...state, active: false }
	persistLoopState(updated)
	return updated
}

export function markStopped(state: LoopState): LoopState {
	const updated = { ...state, stopped: true }
	persistLoopState(updated)
	return updated
}

export function clearStopped(state: LoopState): LoopState {
	const updated = { ...state, stopped: false }
	persistLoopState(updated)
	return updated
}

export function recordAbort(state: LoopState): LoopState {
	const updated = { ...state, lastAbortAt: Date.now() }
	persistLoopState(updated)
	return updated
}

export function advanceIteration(state: LoopState): LoopState {
	const updated = {
		...state,
		iteration: state.iteration + 1,
		lastInjectedAt: Date.now(),
		consecutiveFailures: 0,
	}
	persistLoopState(updated)
	return updated
}

export function recordFailure(state: LoopState): LoopState {
	const updated = {
		...state,
		consecutiveFailures: state.consecutiveFailures + 1,
		lastFailureAt: Date.now(),
	}
	persistLoopState(updated)
	return updated
}

export function enterVerification(state: LoopState): LoopState {
	const updated = { ...state, inVerification: true }
	persistLoopState(updated)
	return updated
}

export function exitVerification(state: LoopState): LoopState {
	const updated = { ...state, inVerification: false }
	persistLoopState(updated)
	return updated
}

export function checkLoopSafetyGates(
	state: LoopState,
	abortGracePeriodMs: number,
	maxConsecutiveFailures: number,
	failureResetWindowMs: number,
	baseCooldownMs: number,
): string | null {
	if (state.stopped) return "continuation stopped by user (/autowork-cancel) — use /autowork or /autowork-team to restart"
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

export type LoopAction = "continue" | "verify" | "stop"

export interface LoopDecision {
	action: LoopAction
	prompt: string | null
	reason: string
}

export function evaluateLoop(state: LoopState, allAssistantTexts: string[], todos?: Todo[]): LoopDecision {
	if (!state.active) return { action: "stop", prompt: null, reason: "no active loop" }
	if (state.iteration >= AUTOWORK_LOOP_CONFIG.maxIterations) {
		return { action: "stop", prompt: null, reason: `max iterations reached (${AUTOWORK_LOOP_CONFIG.maxIterations})` }
	}

	const combinedText = allAssistantTexts.join("\n")
	const hasDone = combinedText.includes(AUTOWORK_LOOP_CONFIG.completionPromise)
	const hasVerified = combinedText.includes(AUTOWORK_LOOP_CONFIG.verificationPromise)

	if (hasDone && hasVerified) return { action: "stop", prompt: null, reason: "both DONE and VERIFIED promises detected — loop complete" }

	if (hasDone && !state.inVerification) {
		if (todos && todos.length > 0) {
			const todoResult = evaluateTodos(todos)
			if (todoResult.verdict === "unfinished") {
				return { action: "continue", prompt: buildPrematureDonePrompt(state, todoResult), reason: `DONE claimed but ${todoResult.reason} — continuing` }
			}
		}
		return { action: "verify", prompt: buildVerificationPrompt(state, todos), reason: "DONE promise detected — entering E2E verification" }
	}

	if (state.inVerification) {
		if (hasVerified) return { action: "stop", prompt: null, reason: "VERIFIED promise detected — loop complete" }
		if (hasDone) {
			if (todos && todos.length > 0) {
				const todoResult = evaluateTodos(todos)
				if (todoResult.verdict === "unfinished") {
					return { action: "continue", prompt: buildPrematureDonePrompt(state, todoResult), reason: "DONE re-emitted but todos still unfinished — continuing" }
				}
			}
			return { action: "verify", prompt: buildVerificationPrompt(state, todos), reason: "DONE re-emitted during verification — re-verifying E2E" }
		}
		return { action: "continue", prompt: buildVerificationContinuationPrompt(state), reason: "in E2E verification phase — no promises yet, continue fixing" }
	}

	return { action: "continue", prompt: buildLoopContinuationPrompt(state, todos), reason: `iteration ${state.iteration + 1}/${AUTOWORK_LOOP_CONFIG.maxIterations}` }
}

function buildLoopContinuationPrompt(state: LoopState, todos?: Todo[]): string {
	const parts: string[] = []
	const pct = Math.round((state.iteration / AUTOWORK_LOOP_CONFIG.maxIterations) * 100)
	parts.push(`[SYSTEM REMINDER - AUTOWORK]`)
	parts.push(`You are in an active autowork loop. Iteration: ${state.iteration + 1} of ${AUTOWORK_LOOP_CONFIG.maxIterations}.`)
	if (pct >= 80) parts.push(``, `**CRITICAL: You have used ${pct}% of your iteration budget.** Finish NOW or you will be force-stopped. Focus only on completing remaining work and verifying.`)
	else if (pct >= 50) parts.push(``, `**WARNING: You have used ${pct}% of your iteration budget.** Prioritize completion. Do not start new exploratory work.`)
	parts.push("")
	if (state.taskPrompt) parts.push(`Original task: ${state.taskPrompt}`, "")
	if (todos && todos.length > 0) {
		const todoResult = evaluateTodos(todos)
		if (todoResult.verdict === "unfinished" && todoResult.remainingItems.length > 0) parts.push(formatRemainingWork(todoResult), "")
		else if (todoResult.verdict === "done") parts.push(`[TODO STATUS] All ${todoResult.totalItems} items complete.`, "")
	}
	parts.push(`Continue working on the next pending item.`)
	parts.push(`As you complete each step: verify it worked before moving to the next.`)
	parts.push(`Don't batch verification at the end — confirm each piece of output as you produce it.`)
	parts.push(`When ALL todos are done and every step has been verified, emit exactly:`)
	parts.push(AUTOWORK_LOOP_CONFIG.completionPromise)
	parts.push(``, `Do NOT emit this promise while any todo item is still pending or in-progress.`, `Do NOT emit this promise based on intent — only on observed, confirmed results.`, INTERNAL_MARKER)
	return parts.join("\n")
}

function buildPrematureDonePrompt(state: LoopState, todoResult: ReturnType<typeof evaluateTodos>): string {
	const parts: string[] = []
	parts.push(`[SYSTEM REMINDER - AUTOWORK: PREMATURE DONE REJECTED]`, "", `You emitted <promise>DONE</promise> but your todo list CONTRADICTS this claim.`, `Your DONE was REJECTED. The loop continues.`, "", `This is a hard enforcement — you CANNOT claim completion while tracked work remains unfinished.`, `Do NOT emit DONE again until EVERY item below is completed or explicitly cancelled with a documented reason.`, "")
	if (state.taskPrompt) parts.push(`Original task: ${state.taskPrompt}`, "")
	parts.push(formatRemainingWork(todoResult), "", `REQUIRED ACTIONS:`, `1. Complete every remaining item listed above`, `2. Run tests/verification for each completed item`, `3. Only THEN emit ${AUTOWORK_LOOP_CONFIG.completionPromise}`, ``, `If an item is genuinely impossible, mark it cancelled in your todos with a clear reason — do not leave it pending.`, INTERNAL_MARKER)
	return parts.join("\n")
}

function buildVerificationPrompt(state: LoopState, todos?: Todo[]): string {
	const parts: string[] = []
	parts.push(`[SYSTEM REMINDER - AUTOWORK: MANDATORY E2E VERIFICATION]`, "", `You claimed completion. The loop will NOT end until you PROVE your work is correct.`, `Self-verification is adversarial — assume your implementation has bugs until proven otherwise.`, "")
	if (state.taskPrompt) parts.push(`Original task: ${state.taskPrompt}`, "")
	if (todos && todos.length > 0) {
		const todoResult = evaluateTodos(todos)
		if (todoResult.completedItems > 0) parts.push(`[TODO STATUS] ${todoResult.completedItems}/${todoResult.totalItems} items completed.`, "")
	}
	parts.push(`## Phase 1: Adversarial Self-Critique (MANDATORY)`, `Before running any verification, STOP and think critically:`, `- List 3-5 things that COULD be wrong with your implementation`, `- List edge cases you might have missed`, `- List requirements from the original task you might have only partially addressed`, `- Consider: "If a senior engineer reviewed this, what would they flag?"`, `Write these concerns down, then verify EACH ONE.`, "", `## Phase 2: Requirement Tracing (MANDATORY)`, `Go back to the original task. For EACH stated requirement:`, `- State the requirement`, `- Point to the exact code/artifact that satisfies it`, `- Run a test or command that PROVES it works`, `- If any requirement is not demonstrably met, FIX IT before proceeding`, "", `## Phase 3: E2E Verification (MANDATORY)`, `1. Run ALL tests — unit, integration, e2e. Every failure must be fixed.`, `2. Run builds and linters. Zero errors.`, `3. Exercise the actual output — don't just re-read files.`, `   Run it, observe real output, confirm it's correct.`, `4. Trace the full flow a real user would take.`, `5. Check for regressions — test what you might have broken.`, "", `## Phase 4: Gate Decision`, `ALL of these must be YES:`, `- Every requirement from the original task is demonstrably satisfied?`, `- Every concern from Phase 1 has been verified/addressed?`, `- All tests pass? All builds clean?`, `- No regressions detected?`, "", `If ALL checks pass, emit exactly:`, AUTOWORK_LOOP_CONFIG.verificationPromise, "", `If ANY check fails: fix the issues, then emit:`, AUTOWORK_LOOP_CONFIG.completionPromise, `to re-enter verification.`, INTERNAL_MARKER)
	return parts.join("\n")
}

function buildVerificationContinuationPrompt(state: LoopState): string {
	const parts: string[] = []
	parts.push(`[SYSTEM REMINDER - AUTOWORK: VERIFICATION INCOMPLETE]`, "", `You are in the verification phase but have NOT yet emitted ${AUTOWORK_LOOP_CONFIG.verificationPromise}.`, `This means verification is not finished. Keep going.`, "")
	if (state.taskPrompt) parts.push(`Original task: ${state.taskPrompt}`, "")
	parts.push(`What you must still do:`, `1. If you haven't done the adversarial self-critique yet — do it NOW`, `2. If you haven't traced every requirement back to the original task — do it NOW`, `3. If you haven't run all tests/builds/linters — run them NOW`, `4. If any test fails — fix it, don't skip it`, `5. If any requirement is unmet — implement it, don't ignore it`, "", `When EVERYTHING passes and every requirement is proven met:`, `  emit ${AUTOWORK_LOOP_CONFIG.verificationPromise}`, "", `If you found and fixed issues, re-enter the full verification cycle:`, `  emit ${AUTOWORK_LOOP_CONFIG.completionPromise}`, INTERNAL_MARKER)
	return parts.join("\n")
}
