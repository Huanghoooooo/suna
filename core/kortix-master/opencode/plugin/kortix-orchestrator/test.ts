/**
 * E2E test for kortix-orchestrator plugin
 *
 * Tests: project CRUD, session spawn, event handling, notification flow
 * Run: cd .opencode && bun run plugin/kortix-orchestrator/test.ts
 */

import { unlinkSync, rmSync, existsSync, readFileSync } from "node:fs"
import * as path from "node:path"

const PACKAGE_ROOT = path.resolve(import.meta.dir, "../../")
const WORKSPACE_ROOT = path.resolve(import.meta.dir, "../../../../../")
const NESTED_PLUGIN_DIR = path.join(PACKAGE_ROOT, "plugin", "kortix-orchestrator")
const TEST_PROJECT = path.join(WORKSPACE_ROOT, "projects", "e2e-test-project")
const DB_PATH = path.join(WORKSPACE_ROOT, ".kortix", "kortix.db")

// Cleanup before test
function cleanup() {
	for (const f of [DB_PATH, DB_PATH + "-wal", DB_PATH + "-shm", DB_PATH + "-journal"]) {
		try { unlinkSync(f) } catch {}
	}
	try { rmSync(TEST_PROJECT, { recursive: true, force: true }) } catch {}
}

// Track calls for assertions
let spawnedSessions: Array<{ id: string; agent: string; promptLen: number }> = []
let promptCalls: Array<{ sessionId: string; bodyLen: number; noReply: boolean }> = []

// Mock OpenCode client
let sessionCounter = 0
const mockClient = {
	session: {
		create: async (opts: any) => {
			const id = `ses_test_${Date.now().toString(36)}_${++sessionCounter}`
			spawnedSessions.push({ id, agent: opts?.body?.agent || "", promptLen: 0 })
			return { data: { id } }
		},
		prompt: async (opts: any) => {
			const text = opts.body.parts?.[0]?.text || ""
			promptCalls.push({
				sessionId: opts.path.id,
				bodyLen: text.length,
				noReply: opts.body.noReply ?? false,
			})
			return {}
		},
		messages: async (opts: any) => {
			// Simulate a session with VERIFIED promise for idle handler test
			if (opts.path.id === "ses_verified_test") {
				return {
					data: [{
						info: { role: "assistant" },
						parts: [{ type: "text", text: "Work done.\n<promise>DONE</promise>\n<promise>VERIFIED</promise>", synthetic: false, ignored: false }],
					}],
				}
			}
			if (opts.path.id === "ses_done_no_verified") {
				return {
					data: [{
						info: { role: "assistant" },
						parts: [{ type: "text", text: "Work done.\n<promise>DONE</promise>", synthetic: false, ignored: false }],
					}],
				}
			}
			return { data: [] }
		},
		delete: async () => ({}),
	},
}

// ── Test runner ──

let passed = 0
let failed = 0

function assert(condition: boolean, msg: string) {
	if (condition) {
		console.log(`  PASS: ${msg}`)
		passed++
	} else {
		console.error(`  FAIL: ${msg}`)
		failed++
	}
}

async function run() {
	cleanup()
	console.log("Loading plugin...")
	const mod = await import("./kortix-orchestrator.ts")
	const plugin = await mod.default({ client: mockClient, directory: NESTED_PLUGIN_DIR })
	const tools = plugin.tool as Record<string, any>
	const event = plugin.event as (args: { event: any }) => Promise<void>

	console.log("\n── 1. Plugin initialization ──")
	assert(Object.keys(tools).length === 11, `11 tools registered (got ${Object.keys(tools).length})`)
	assert(typeof event === "function", "Event handler is a function")
	assert(existsSync(DB_PATH), "SQLite DB created in central workspace .kortix")

	console.log("\n── 2. Project CRUD ──")
	const createResult = await tools.project_create.execute(
		{ name: "e2e-test-project", description: "Test project for E2E", path: "" },
		{ sessionID: "ses_orchestrator", agent: "kortix" },
	)
	assert(createResult.includes("e2e-test-project"), "project_create returns project name")
	assert(existsSync(TEST_PROJECT), "Project directory created")
	assert(existsSync(path.join(TEST_PROJECT, ".kortix", "CONTEXT.md")), "CONTEXT.md exists")
	assert(existsSync(path.join(TEST_PROJECT, ".kortix", "docs")), ".kortix/docs exists")
	assert(existsSync(path.join(TEST_PROJECT, ".kortix", "sessions")), ".kortix/sessions exists")

	// Idempotent — calling again doesn't crash
	const createAgain = await tools.project_create.execute(
		{ name: "e2e-test-project", description: "Updated desc", path: "" },
		{ sessionID: "ses_orchestrator", agent: "kortix" },
	)
	assert(createAgain.includes("e2e-test-project"), "project_create idempotent")

	const listResult = await tools.project_list.execute({}, {})
	assert(listResult.includes("e2e-test-project"), "project_list shows the project")

	const getResult = await tools.project_get.execute({ name: "e2e-test-project" }, {})
	assert(getResult.includes("e2e-test-project"), "project_get finds by name")

	const updateResult = await tools.project_update.execute(
		{ project: "e2e-test-project", name: "", description: "New description" },
		{},
	)
	assert(updateResult.includes("New description") || updateResult.includes("Updated"), "project_update works")

	// Existing directory — should not overwrite
	const contextBody = readFileSync(path.join(TEST_PROJECT, ".kortix", "CONTEXT.md"), "utf8")
	assert(contextBody.includes("# e2e-test-project"), "CONTEXT.md preserved on re-create")

	console.log("\n── 3. Session spawn ──")
	spawnedSessions = []
	promptCalls = []

	const spawnResult = await tools.session_start_background.execute(
		{ project: "e2e-test-project", description: "hello app", prompt: "Build a hello world app", agent: "", subagent_type: "", session_id: "", model: "", command: "" },
		{ sessionID: "ses_orchestrator", agent: "kortix" },
	)
	assert(spawnResult.includes("Session:") || spawnResult.includes("ses_test"), "session_start_background returns session ID")
	assert(spawnedSessions.length === 1, "One session created via client.session.create")
	// prompt() is fire-and-forget (no await in the plugin), but mock resolves sync
	const spawnPrompts = promptCalls.filter(p => !p.noReply && p.bodyLen > 100)
	assert(spawnPrompts.length === 1, `prompt() fired for spawn (${spawnPrompts.length} calls)`)
	assert(spawnPrompts[0].bodyLen > 100, `Prompt sent (${spawnPrompts[0].bodyLen} chars)`)

	// Large prompt — should NOT fail
	promptCalls = []
	const bigPrompt = "X".repeat(20000)
	const spawnBig = await tools.session_start_background.execute(
		{ project: "e2e-test-project", description: "big prompt", prompt: bigPrompt, agent: "", subagent_type: "", session_id: "", model: "", command: "" },
		{ sessionID: "ses_orchestrator", agent: "kortix" },
	)
	assert(spawnBig.includes("Session:") || spawnBig.includes("ses_test"), `20K prompt spawns OK (got: ${spawnBig.slice(0, 100)})`)
	const bigPrompts = promptCalls.filter(p => !p.noReply && p.bodyLen > 20000)
	assert(bigPrompts.length === 1, `prompt() fired for 20K spawn (${bigPrompts.length} calls)`)
	assert(bigPrompts[0].bodyLen > 20000, `Full 20K prompt passed through (${bigPrompts[0].bodyLen} chars)`)

	console.log("\n── 3b. Session resume ──")
	promptCalls = []
	const resumed = await tools.session_start_background.execute(
		{ project: "", description: "resume hello app", prompt: "Add tests and continue", agent: "", subagent_type: "", session_id: spawnedSessions[0].id, model: "", command: "" },
		{ sessionID: "ses_orchestrator_2", agent: "kortix" },
	)
	assert(resumed.includes(`**Session:** ${spawnedSessions[0].id}`), "session_start_background reuses session_id on resume")
	assert(spawnedSessions.length === 2, "Resume does not create a new child session")
	assert(promptCalls.some(p => p.sessionId === spawnedSessions[0].id), "Resume prompts the existing child session")
	const compatSpawn = await tools.session_spawn.execute(
		{ project: "", description: "compat resume", prompt: "Ping the same session again", agent: "", subagent_type: "", session_id: spawnedSessions[0].id, model: "", command: "" },
		{ sessionID: "ses_orchestrator_3", agent: "kortix" },
	)
	assert(compatSpawn.includes(`**Session:** ${spawnedSessions[0].id}`), "session_spawn aliases session_start_background")

	console.log("\n── 4. Session list ──")
	const listSessions = await tools.session_list_background.execute({ project: "e2e-test-project" }, {})
	assert(listSessions.includes("running"), "session_list_background shows running sessions")
	const compatListSessions = await tools.session_list_spawned.execute({ project: "e2e-test-project" }, {})
	assert(compatListSessions === listSessions, "session_list_spawned aliases session_list_background")

	console.log("\n── 5. Session read ──")
	const readResult = await tools.session_read.execute({ session_id: spawnedSessions[0].id }, {})
	assert(readResult.includes("running") || readResult.includes("Status"), "session_read shows live status")

	console.log("\n── 6. Session message ──")
	const msgResult = await tools.session_message.execute(
		{ session_id: spawnedSessions[0].id, message: "Status update please" },
		{},
	)
	assert(msgResult.includes("sent") || msgResult.includes("Message"), "session_message delivered")

	console.log("\n── 7. Event handler — debounced idle (VERIFIED) ──")
	promptCalls = []

	const { Database } = await import("bun:sqlite")
	const db = new Database(DB_PATH)
	const proj = db.prepare("SELECT id FROM projects LIMIT 1").get() as { id: string }

	db.prepare(`INSERT INTO delegations (session_id,project_id,prompt,agent,parent_session_id,parent_agent,status,created_at)
		VALUES ('ses_verified_test',$pid,'test prompt','kortix','ses_orchestrator','kortix','running',$now)`)
		.run({ $pid: proj.id, $now: new Date().toISOString() })

	// Fire idle event — this starts a 10s debounce timer
	await event({ event: { type: "session.idle", properties: { sessionID: "ses_verified_test" } } as any })

	// Status should still be running (debounce hasn't fired yet)
	const midCheck = db.prepare("SELECT status FROM delegations WHERE session_id='ses_verified_test'").get() as any
	assert(midCheck?.status === "running", `Before debounce: still running (got ${midCheck?.status})`)

	// Wait for debounce timer to fire (10s + 1s buffer)
	console.log("  (waiting 11s for debounce timer...)")
	await new Promise(r => setTimeout(r, 11_000))

	const completed = db.prepare("SELECT status, result FROM delegations WHERE session_id='ses_verified_test'").get() as any
	assert(completed?.status === "complete", `After debounce: VERIFIED → complete (got ${completed?.status})`)
	assert(completed?.result?.includes("Work done"), "Result captured from assistant message")
	assert(promptCalls.some(p => p.sessionId === "ses_orchestrator"), "Orchestrator notified")
	assert(promptCalls.some(p => p.sessionId === "ses_orchestrator" && p.bodyLen > 100), "Completion report includes session payload")

	console.log("\n── 8. Event handler — DONE without VERIFIED ──")
	promptCalls = []

	db.prepare(`INSERT INTO delegations (session_id,project_id,prompt,agent,parent_session_id,parent_agent,status,created_at)
		VALUES ('ses_done_no_verified',$pid,'test prompt 2','kortix','ses_orchestrator','kortix','running',$now)`)
		.run({ $pid: proj.id, $now: new Date().toISOString() })

	await event({ event: { type: "session.idle", properties: { sessionID: "ses_done_no_verified" } } as any })
	console.log("  (waiting 11s for debounce timer...)")
	await new Promise(r => setTimeout(r, 11_000))

	const failedDel = db.prepare("SELECT status, result FROM delegations WHERE session_id='ses_done_no_verified'").get() as any
	assert(failedDel?.status === "failed", `DONE-no-VERIFIED → failed (got ${failedDel?.status})`)
	assert(promptCalls.some(p => p.sessionId === "ses_orchestrator"), "Orchestrator notified of failure")

	console.log("\n── 9. Event handler — session.error (instant, no debounce) ──")
	promptCalls = []

	db.prepare(`INSERT INTO delegations (session_id,project_id,prompt,agent,parent_session_id,parent_agent,status,created_at)
		VALUES ('ses_error_test',$pid,'test prompt 3','kortix','ses_orchestrator','kortix','running',$now)`)
		.run({ $pid: proj.id, $now: new Date().toISOString() })

	await event({ event: { type: "session.error", properties: { sessionID: "ses_error_test", error: "LLM timeout" } } as any })

	const errorDel = db.prepare("SELECT status, result FROM delegations WHERE session_id='ses_error_test'").get() as any
	assert(errorDel?.status === "failed", `session.error → status=failed (got ${errorDel?.status})`)
	assert(errorDel?.result?.includes("LLM timeout"), "Error reason captured")

	console.log("\n── 10. Result persistence ──")
	const sessionsDir = path.join(TEST_PROJECT, ".kortix", "sessions")
	assert(existsSync(sessionsDir), ".kortix/sessions/ directory exists")

	console.log("\n── 11. Project select & tool gate ──")
	const toolGate = plugin["tool.execute.before"] as (input: { tool: string; sessionID: string; callID: string }, output: { args: any }) => Promise<void>
	assert(typeof toolGate === "function", "tool.execute.before hook registered")

	// Non-write tools should always pass (even without project)
	const ungatedSession = "ses_no_project_test"
	for (const freeTool of [
		"project_list", "session_read", "mcp_bash", "bash",
		"read", "mcp_read", "glob", "mcp_glob", "grep", "mcp_grep",
		"web_search", "show", "skill", "question",
	]) {
		await toolGate({ tool: freeTool, sessionID: ungatedSession, callID: `c_${freeTool}` }, { args: {} })
		assert(true, `${freeTool} allowed without project`)
	}

	// Only file-mutation tools should be gated without a project
	for (const gatedTool of ["edit", "mcp_edit", "write", "mcp_write", "morph_edit", "mcp_morph_edit"]) {
		let blocked = false
		try {
			await toolGate({ tool: gatedTool, sessionID: ungatedSession, callID: `c_${gatedTool}` }, { args: {} })
		} catch (e: any) {
			blocked = true
			assert(e.message.includes("No project selected"), `${gatedTool} gate error correct`)
		}
		assert(blocked, `${gatedTool} blocked without project`)
	}

	// project_select should link session to project
	const selectResult = await tools.project_select.execute(
		{ project: "e2e-test-project" },
		{ sessionID: ungatedSession, agent: "kortix" },
	)
	assert(selectResult.includes("e2e-test-project"), "project_select returns project name")
	assert(selectResult.includes("selected"), "project_select confirms selection")

	// After select, gated tools should pass
	for (const gatedTool of ["edit", "mcp_edit", "write", "mcp_write", "morph_edit", "mcp_morph_edit"]) {
		let allowed = false
		try {
			await toolGate({ tool: gatedTool, sessionID: ungatedSession, callID: `c_post_${gatedTool}` }, { args: {} })
			allowed = true
		} catch {}
		assert(allowed, `${gatedTool} allowed after project_select`)
	}

	// project_select with invalid project
	const badSelect = await tools.project_select.execute(
		{ project: "nonexistent-project" },
		{ sessionID: "ses_bad_select", agent: "kortix" },
	)
	assert(badSelect.includes("not found"), "project_select rejects unknown project")

	db.close()

	// Summary
	console.log(`\n${"=".repeat(40)}`)
	console.log(`Results: ${passed} passed, ${failed} failed`)
	console.log(`${"=".repeat(40)}`)

	cleanup()
	process.exit(failed > 0 ? 1 : 0)
}

run().catch((e) => {
	console.error("Test crashed:", e)
	cleanup()
	process.exit(1)
})
