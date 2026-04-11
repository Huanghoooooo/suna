import { describe, expect, test } from "bun:test"
import { createInitialAutoworkState } from "./config"
import { evaluateAutowork } from "./engine"

describe("evaluateAutowork", () => {
	test("continues when completion promise has not been emitted", () => {
		const state = {
			...createInitialAutoworkState(),
			active: true,
			sessionId: "ses-1",
			taskPrompt: "fix the bug",
			currentPhase: "starting" as const,
		}
		const decision = evaluateAutowork(state, ["Still working"], [])
		expect(decision.action).toBe("continue")
		expect(decision.phase).toBe("executing")
		expect(decision.prompt).toContain("completion promise")
	})

	test("rejects premature completion when todo items remain", () => {
		const state = {
			...createInitialAutoworkState(),
			active: true,
			sessionId: "ses-2",
			taskPrompt: "finish task",
			completionPromise: "DONE",
		}
		const decision = evaluateAutowork(state, ["DONE"], [
			{ status: "in_progress", content: "remaining item", priority: "high" } as any,
		])
		expect(decision.action).toBe("continue")
		expect(decision.phase).toBe("fixing")
		expect(decision.prompt).toContain("COMPLETION REJECTED")
	})

	test("stops when completion promise is emitted and todos are clear", () => {
		const state = {
			...createInitialAutoworkState(),
			active: true,
			sessionId: "ses-3",
			completionPromise: "DONE",
		}
		const decision = evaluateAutowork(state, ["Verified\nDONE"], [
			{ status: "completed", content: "done", priority: "medium" } as any,
		])
		expect(decision.action).toBe("stop")
		expect(decision.phase).toBe("complete")
	})
})
