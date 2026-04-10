import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const tempRoots: string[] = []
const originalStorageBase = process.env.OPENCODE_STORAGE_BASE

afterEach(() => {
	if (originalStorageBase === undefined) delete process.env.OPENCODE_STORAGE_BASE
	else process.env.OPENCODE_STORAGE_BASE = originalStorageBase
	for (const dir of tempRoots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeStorage(): string {
	const root = mkdtempSync(path.join(tmpdir(), "kortix-ralph-test-"))
	tempRoots.push(root)
	const storageBase = path.join(root, ".local", "share", "opencode")
	mkdirSync(storageBase, { recursive: true })
	return storageBase
}

function assistant(text: string) {
	return { info: { role: "assistant" }, parts: [{ type: "text", text }] }
}

describe("Ralph plugin integration", () => {
	test("continues on idle and stops after completion promise with clear todos", async () => {
		process.env.OPENCODE_STORAGE_BASE = makeStorage()

		const prompts: Array<{ sessionId: string; text: string }> = []
		const messages = new Map<string, any[]>()
		const todos = new Map<string, any[]>()

		const pluginMod = await import(`./ralph.ts?ralph-test=${Date.now()}`)
		const stateMod = await import(`./state.ts?ralph-test=${Date.now()}`)
		const pluginFactory = pluginMod.default

		const client = {
			app: { log: async () => {} },
			session: {
				messages: async ({ path }: any) => ({ data: messages.get(path.id) ?? [] }),
				todo: async ({ path }: any) => ({ data: todos.get(path.id) ?? [] }),
				promptAsync: async ({ path, body }: any) => {
					prompts.push({ sessionId: path.id, text: body.parts[0].text })
				},
			},
		} as any

		const plugin = await pluginFactory({ client })
		const sessionId = "ses_ralph_1"

		messages.set(sessionId, [])
		todos.set(sessionId, [{ status: "in_progress", content: "fix bug", priority: "high" }])

		await plugin["chat.message"](
			{ sessionID: sessionId },
			{ parts: [{ type: "text", text: `/ralph --completion-promise "DONE" fix the bug` }] },
		)

		messages.set(sessionId, [assistant("Investigating root cause")])
		await plugin.event({ event: { type: "session.idle", properties: { sessionID: sessionId } } })

		expect(prompts.length).toBe(1)
		expect(prompts[0]?.text).toContain("[RALPH - ITERATION")

		messages.set(sessionId, [assistant("Verified implementation\nDONE")])
		todos.set(sessionId, [{ status: "completed", content: "fix bug", priority: "high" }])
		await new Promise((resolve) => setTimeout(resolve, 3100))
		await plugin.event({ event: { type: "session.idle", properties: { sessionID: sessionId } } })

		expect(pluginMod.ralphActiveSessions.has(sessionId)).toBe(false)
		const persisted = stateMod.loadRalphState(sessionId)
		expect(persisted?.active).toBe(false)
		expect(persisted?.currentPhase).toBe("complete")
	})

	test("falls back to slash command text when command args are empty", async () => {
		process.env.OPENCODE_STORAGE_BASE = makeStorage()

		const prompts: Array<{ sessionId: string; text: string }> = []
		const messages = new Map<string, any[]>()
		const todos = new Map<string, any[]>()

		const pluginMod = await import(`./ralph.ts?ralph-empty-args=${Date.now()}`)
		const pluginFactory = pluginMod.default

		const client = {
			app: { log: async () => {} },
			session: {
				messages: async ({ path }: any) => ({ data: messages.get(path.id) ?? [] }),
				todo: async ({ path }: any) => ({ data: todos.get(path.id) ?? [] }),
				promptAsync: async ({ path, body }: any) => {
					prompts.push({ sessionId: path.id, text: body.parts[0].text })
				},
			},
		} as any

		const plugin = await pluginFactory({ client })
		const sessionId = "ses_ralph_empty_args"
		messages.set(sessionId, [])
		todos.set(sessionId, [])

		await plugin["command.execute.before"]({ sessionID: sessionId, command: "ralph", arguments: "" })
		await plugin["chat.message"](
			{ sessionID: sessionId },
			{ parts: [{ type: "text", text: "/ralph --completion-promise RALPH_DONE --max-iterations 4 build feature" }] },
		)

		messages.set(sessionId, [assistant("Still working")])
		await plugin.event({ event: { type: "session.idle", properties: { sessionID: sessionId } } })

		expect(prompts.length).toBe(1)
		expect(prompts[0]?.text).toContain("emit exactly: RALPH_DONE")
		expect(prompts[0]?.text).toContain("ITERATION 1/4")
	})

	test("extracts args from rendered command body when slash command is expanded", async () => {
		process.env.OPENCODE_STORAGE_BASE = makeStorage()

		const prompts: Array<{ sessionId: string; text: string }> = []
		const messages = new Map<string, any[]>()
		const todos = new Map<string, any[]>()

		const pluginMod = await import(`./ralph.ts?ralph-rendered-args=${Date.now()}`)
		const pluginFactory = pluginMod.default

		const client = {
			app: { log: async () => {} },
			session: {
				messages: async ({ path }: any) => ({ data: messages.get(path.id) ?? [] }),
				todo: async ({ path }: any) => ({ data: todos.get(path.id) ?? [] }),
				promptAsync: async ({ path, body }: any) => {
					prompts.push({ sessionId: path.id, text: body.parts[0].text })
				},
			},
		} as any

		const plugin = await pluginFactory({ client })
		const sessionId = "ses_ralph_rendered_args"
		messages.set(sessionId, [])
		todos.set(sessionId, [])

		await plugin["command.execute.before"]({ sessionID: sessionId, command: "ralph", arguments: "" })
		await plugin["chat.message"](
			{ sessionID: sessionId },
			{ parts: [{ type: "text", text: '# Ralph\n\nRules...\n\n"build feature --completion-promise RALPH_DONE --max-iterations 4"' }] },
		)

		messages.set(sessionId, [assistant("Still working")])
		await plugin.event({ event: { type: "session.idle", properties: { sessionID: sessionId } } })

		expect(prompts.length).toBe(1)
		expect(prompts[0]?.text).toContain("emit exactly: RALPH_DONE")
		expect(prompts[0]?.text).toContain("ITERATION 1/4")
	})
})
