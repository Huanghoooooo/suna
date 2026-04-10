import { describe, expect, test } from "bun:test"
import { completionReached, parseRalphArgs } from "./config"

describe("parseRalphArgs", () => {
	test("parses max iterations and completion promise", () => {
		const parsed = parseRalphArgs(`--max-iterations 12 --completion-promise "ALL GOOD" fix auth flow`)
		expect(parsed.options.maxIterations).toBe(12)
		expect(parsed.options.completionPromise).toBe("ALL GOOD")
		expect(parsed.task).toBe("fix auth flow")
	})

	test("falls back to defaults when flags are missing", () => {
		const parsed = parseRalphArgs("ship the feature")
		expect(parsed.options.maxIterations).toBe(50)
		expect(parsed.options.completionPromise).toBe("DONE")
		expect(parsed.task).toBe("ship the feature")
	})

	test("completionReached only matches exact promise line", () => {
		expect(completionReached("DONE", "DONE")).toBe(true)
		expect(completionReached("All good\nDONE\n", "DONE")).toBe(true)
		expect(completionReached("Do not emit DONE yet", "DONE")).toBe(false)
		expect(completionReached("RALPH_DONE_NOW", "RALPH_DONE")).toBe(false)
	})
})
