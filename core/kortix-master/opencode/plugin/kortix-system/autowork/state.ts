import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ensureKortixDir } from "../lib/paths"
import { AUTOWORK_DEFAULTS, createInitialAutoworkState, type AutoworkState } from "./config"
import type { AutoworkStopReason } from "./engine"

const KORTIX_DIR = ensureKortixDir(import.meta.dir)
const STATE_DIR = `${KORTIX_DIR}/autowork-states`

function statePath(sessionId: string): string {
	return join(STATE_DIR, `${sessionId}.json`)
}

export function persistAutoworkState(state: AutoworkState): void {
	try {
		if (!state.sessionId) return
		if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
		writeFileSync(statePath(state.sessionId), JSON.stringify(state, null, 2), "utf-8")
	} catch {
		// non-fatal
	}
}

export function loadAutoworkState(sessionId: string): AutoworkState | null {
	try {
		const path = statePath(sessionId)
		if (!existsSync(path)) return null
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<AutoworkState>
		if (typeof parsed.active !== "boolean") return null
		// Merge with defaults so old-schema state files still load cleanly.
		return { ...createInitialAutoworkState(), ...parsed } as AutoworkState
	} catch {
		return null
	}
}

export function loadAllAutoworkStates(): Map<string, AutoworkState> {
	const states = new Map<string, AutoworkState>()
	try {
		if (!existsSync(STATE_DIR)) return states
		for (const file of readdirSync(STATE_DIR).filter((entry) => entry.endsWith(".json"))) {
			try {
				const parsed = JSON.parse(readFileSync(join(STATE_DIR, file), "utf-8")) as Partial<AutoworkState>
				if (parsed.sessionId && typeof parsed.active === "boolean") {
					states.set(parsed.sessionId, { ...createInitialAutoworkState(), ...parsed } as AutoworkState)
				}
			} catch {
				// ignore broken state file
			}
		}
	} catch {
		// ignore
	}
	return states
}

export function removeAutoworkState(sessionId: string): void {
	try {
		const path = statePath(sessionId)
		if (existsSync(path)) unlinkSync(path)
	} catch {
		// ignore
	}
}

export function startAutowork(
	taskPrompt: string,
	sessionId: string,
	messageCountAtStart = 0,
	maxIterations: number = AUTOWORK_DEFAULTS.maxIterations,
): AutoworkState {
	const state: AutoworkState = {
		...createInitialAutoworkState(),
		active: true,
		sessionId,
		taskPrompt,
		messageCountAtStart,
		maxIterations,
		startedAt: Date.now(),
		stopped: false,
	}
	persistAutoworkState(state)
	return state
}

export function stopAutowork(state: AutoworkState, stopReason: AutoworkStopReason): AutoworkState {
	const updated: AutoworkState = {
		...state,
		active: false,
		stopped: true,
		stopReason,
		completedAt: Date.now(),
	}
	persistAutoworkState(updated)
	return updated
}

export function appendTaskContext(state: AutoworkState, text: string): AutoworkState {
	const updated: AutoworkState = {
		...state,
		taskPrompt: state.taskPrompt ? `${state.taskPrompt}\n\n${text}` : text,
	}
	persistAutoworkState(updated)
	return updated
}

export function advanceAutowork(state: AutoworkState): AutoworkState {
	const updated: AutoworkState = {
		...state,
		iteration: state.iteration + 1,
		lastInjectedAt: Date.now(),
		consecutiveFailures: 0,
	}
	persistAutoworkState(updated)
	return updated
}

export function recordAutoworkFailure(state: AutoworkState): AutoworkState {
	const updated: AutoworkState = {
		...state,
		consecutiveFailures: state.consecutiveFailures + 1,
		lastFailureAt: Date.now(),
	}
	persistAutoworkState(updated)
	return updated
}

export function recordAutoworkAbort(state: AutoworkState): AutoworkState {
	const updated: AutoworkState = {
		...state,
		lastAbortAt: Date.now(),
	}
	persistAutoworkState(updated)
	return updated
}
