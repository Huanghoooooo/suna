import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ensureKortixDir } from "../lib/paths"
import { createInitialRalphState, type RalphPhase, type RalphState } from "./config"

const KORTIX_DIR = ensureKortixDir(import.meta.dir)
const STATE_DIR = `${KORTIX_DIR}/ralph-states`

function statePath(sessionId: string): string {
	return join(STATE_DIR, `${sessionId}.json`)
}

export function persistRalphState(state: RalphState): void {
	try {
		if (!state.sessionId) return
		if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
		writeFileSync(statePath(state.sessionId), JSON.stringify(state, null, 2), "utf-8")
	} catch {
		// non-fatal
	}
}

export function loadRalphState(sessionId: string): RalphState | null {
	try {
		const path = statePath(sessionId)
		if (!existsSync(path)) return null
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as RalphState
		if (typeof parsed.active !== "boolean") return null
		return parsed
	} catch {
		return null
	}
}

export function loadAllRalphStates(): Map<string, RalphState> {
	const states = new Map<string, RalphState>()
	try {
		if (!existsSync(STATE_DIR)) return states
		for (const file of readdirSync(STATE_DIR).filter((entry) => entry.endsWith(".json"))) {
			try {
				const parsed = JSON.parse(readFileSync(join(STATE_DIR, file), "utf-8")) as RalphState
				if (parsed.sessionId && typeof parsed.active === "boolean") states.set(parsed.sessionId, parsed)
			} catch {
				// ignore broken state file
			}
		}
	} catch {
		// ignore
	}
	return states
}

export function removeRalphState(sessionId: string): void {
	try {
		const path = statePath(sessionId)
		if (existsSync(path)) unlinkSync(path)
	} catch {
		// ignore
	}
}

export function startRalph(
	taskPrompt: string,
	sessionId: string,
	messageCountAtStart = 0,
	maxIterations = 50,
	completionPromise = "DONE",
): RalphState {
	const state: RalphState = {
		...createInitialRalphState(),
		active: true,
		sessionId,
		taskPrompt,
		messageCountAtStart,
		maxIterations,
		completionPromise,
		currentPhase: "starting",
		startedAt: Date.now(),
		stopped: false,
	}
	persistRalphState(state)
	return state
}

export function stopRalph(state: RalphState, phase: Extract<RalphPhase, "complete" | "failed" | "cancelled">): RalphState {
	const updated: RalphState = {
		...state,
		active: false,
		stopped: true,
		currentPhase: phase,
		completedAt: Date.now(),
	}
	persistRalphState(updated)
	return updated
}

export function appendTaskContext(state: RalphState, text: string): RalphState {
	const updated = {
		...state,
		taskPrompt: state.taskPrompt ? `${state.taskPrompt}\n\n${text}` : text,
	}
	persistRalphState(updated)
	return updated
}

export function advanceRalph(state: RalphState, phase: RalphPhase): RalphState {
	const updated: RalphState = {
		...state,
		iteration: state.iteration + 1,
		currentPhase: phase,
		lastInjectedAt: Date.now(),
		consecutiveFailures: 0,
	}
	persistRalphState(updated)
	return updated
}

export function recordRalphFailure(state: RalphState): RalphState {
	const updated: RalphState = {
		...state,
		consecutiveFailures: state.consecutiveFailures + 1,
		lastFailureAt: Date.now(),
	}
	persistRalphState(updated)
	return updated
}

export function recordRalphAbort(state: RalphState): RalphState {
	const updated: RalphState = {
		...state,
		lastAbortAt: Date.now(),
	}
	persistRalphState(updated)
	return updated
}
