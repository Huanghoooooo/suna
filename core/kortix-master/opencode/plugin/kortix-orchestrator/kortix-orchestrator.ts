/**
 * Kortix Orchestrator Plugin — Simplified
 *
 * Projects + async session spawning. That's it.
 *
 * Storage: central .kortix/kortix.db (SQLite) — SINGLE SOURCE OF TRUTH
 *   - projects: registry (created via project_create only, no filesystem scanning)
 *   - tasks: per-project task management with lifecycle
 *   - delegations: which sessions were spawned, in which project, by whom
 *
 * Tools (8):
 *   project_create, project_list, project_get, project_update
 *   worker_spawn, worker_list, worker_read, worker_message
 *
 * Flow:
 *   1. Orchestrator calls worker_spawn(project, prompt) → fire & forget
 *   2. Kortix session runs autonomously (autowork loop)
 *   3. On completion/failure → <session-report> lands in orchestrator's thread
 *   4. Orchestrator processes, spawns next work
 */

import { Database } from "bun:sqlite"
import * as fs from "node:fs/promises"
import { mkdirSync, readdirSync, statSync, readFileSync, existsSync, unlinkSync } from "node:fs"
import * as path from "node:path"
import { type Plugin, type ToolContext, tool } from "@opencode-ai/plugin"
import type { Event } from "@opencode-ai/sdk"
import { ensureGlobalMemoryFiles, ensureKortixDir, resolveKortixWorkspaceRoot } from "../kortix-paths"

// ── Kortix System XML Tag Wrapper ───────────────────────────────────────────

/**
 * Wrap content in kortix_system XML tags so the frontend strips it from UI.
 * Internal/system content injected by OpenCode plugins should be wrapped to prevent
 * it from appearing in the rendered output.
 */
function wrapInKortixSystemTags(
	content: string,
	attrs?: Record<string, string>,
): string {
	if (!content || !content.trim()) return ""
	const attrString = attrs
		? " " + Object.entries(attrs)
			.map(([k, v]) => `${k}="${v}"`)
			.join(" ")
		: ""
	return `<kortix_system${attrString}>${content}</kortix_system>`
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ProjectRow { id: string; name: string; path: string; description: string; created_at: string; opencode_id: string | null }
interface DelegationRow {
	session_id: string; project_id: string; prompt: string; agent: string
	parent_session_id: string; parent_agent: string
	status: string; result: string | null; created_at: string; completed_at: string | null
}
// ProjectMarker removed — SQLite is the single source of truth, no .kortix/project.json markers.

// ── Database ─────────────────────────────────────────────────────────────────

function initDb(dbPath: string): Database {
	mkdirSync(path.dirname(dbPath), { recursive: true })

	// Clean orphaned/corrupt DB files — prevents "disk I/O error"
	// This handles: empty DB with stale WAL/SHM, missing DB with orphaned WAL/SHM
	try {
		const dbExists = existsSync(dbPath)
		const dbEmpty = dbExists && statSync(dbPath).size === 0
		if (!dbExists || dbEmpty) {
			// Remove ALL associated files and start fresh
			for (const suffix of ["", "-wal", "-shm", "-journal"]) {
				try { unlinkSync(dbPath + suffix) } catch {}
			}
		}
	} catch {}

	let db: Database
	try {
		db = new Database(dbPath)
	} catch (e) {
		// Nuke and retry on any open failure
		for (const suffix of ["", "-wal", "-shm", "-journal"]) {
			try { unlinkSync(dbPath + suffix) } catch {}
		}
		db = new Database(dbPath)
	}
	// DELETE journal mode — no sidecar files that corrupt on crash/reload
	// WAL creates -wal/-shm files that get orphaned when process doesn't close cleanly
	db.exec("PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000")
	db.exec(`
		CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
			description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
			opencode_id TEXT
		);
		CREATE TABLE IF NOT EXISTS delegations (
			session_id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL REFERENCES projects(id),
			prompt TEXT NOT NULL,
			agent TEXT NOT NULL DEFAULT 'kortix',
			parent_session_id TEXT NOT NULL,
			parent_agent TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'running',
			result TEXT,
			created_at TEXT NOT NULL,
			completed_at TEXT
		);
		CREATE TABLE IF NOT EXISTS session_projects (
			session_id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL REFERENCES projects(id),
			set_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS connectors (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			description TEXT,
			source TEXT,
			pipedream_slug TEXT,
			env_keys TEXT,
			notes TEXT,
			auto_generated INTEGER DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
	`)
	// Migration: add opencode_id column if missing (existing DBs)
	try { db.exec("ALTER TABLE projects ADD COLUMN opencode_id TEXT") } catch {}
	return db
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function projectId(name: string): string {
	return `proj-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`
}

// scanProjects removed — SQLite is the single source of truth for projects.
// No filesystem scanning, no .kortix/project.json markers.

// ── Manager ──────────────────────────────────────────────────────────────────

class Manager {
	/** Debounce timers for session.idle — if session stays idle for 10s, it's truly done */
	private idleTimers = new Map<string, ReturnType<typeof setTimeout>>()

	constructor(private client: any, private dir: string, private db: Database) {}

	// ── Session ↔ Project Link ──
	// In-memory cache: once a session is linked to a project, we never query the DB again.
	// The DB is only for persistence across process restarts.
	private sessionProjectCache = new Map<string, ProjectRow>()

	/** Get the Kortix project linked to this session, or null. Cached after first hit. */
	getSessionProject(sessionId: string): ProjectRow | null {
		// Hot path: in-memory cache (no DB round-trip)
		const cached = this.sessionProjectCache.get(sessionId)
		if (cached) return cached

		// Cold path: check DB (only happens once per session per process lifetime)
		const row = this.db.prepare("SELECT p.* FROM session_projects sp JOIN projects p ON sp.project_id = p.id WHERE sp.session_id = $sid")
			.get({ $sid: sessionId }) as ProjectRow | null
		if (row) this.sessionProjectCache.set(sessionId, row)
		return row
	}

	/** Link a session to a Kortix project. Caches immediately. */
	setSessionProject(sessionId: string, projectId: string): void {
		this.db.prepare("INSERT OR REPLACE INTO session_projects (session_id, project_id, set_at) VALUES ($sid, $pid, $now)")
			.run({ $sid: sessionId, $pid: projectId, $now: new Date().toISOString() })
		// Update cache immediately so subsequent tool calls never hit DB
		const project = this.db.prepare("SELECT * FROM projects WHERE id = $id").get({ $id: projectId }) as ProjectRow | null
		if (project) this.sessionProjectCache.set(sessionId, project)
	}


	// ── Projects ──

	async createProject(name: string, desc: string, customPath: string): Promise<ProjectRow> {
		const pp = customPath || path.join(this.dir, "projects", name)
		const existing = this.db.prepare("SELECT * FROM projects WHERE path=$p").get({ $p: pp }) as ProjectRow | null
		if (existing) {
			if (desc) { this.db.prepare("UPDATE projects SET description=$d WHERE id=$id").run({ $d: desc, $id: existing.id }); existing.description = desc }
			return existing
		}

		// Scaffold directory structure
		const wm = async (f: string, c: string) => { if (!existsSync(f)) await fs.writeFile(f, c, "utf8") }
		for (const d of [".kortix/docs", ".kortix/sessions"])
			await fs.mkdir(path.join(pp, d), { recursive: true })
		ensureGlobalMemoryFiles(import.meta.dir)
		await wm(path.join(pp, ".kortix", "CONTEXT.md"), `# ${name}\n\n${desc || "No description."}\n`)

		// Write to SQLite — the single source of truth
		const id = projectId(name), now = new Date().toISOString()

		// Best-effort OpenCode link (non-blocking)
		let opencodeId: string | null = null
		try {
			const ocResult = await this.client.project.current({ directory: pp })
			const ocProject = ocResult.data as any
			if (ocProject?.id && ocProject.id !== "global") opencodeId = ocProject.id
		} catch {}

		this.db.prepare("INSERT INTO projects (id,name,path,description,created_at,opencode_id) VALUES ($id,$n,$p,$d,$c,$oid)")
			.run({ $id: id, $n: name, $p: pp, $d: desc || "", $c: now, $oid: opencodeId })
		return { id, name, path: pp, description: desc || "", created_at: now, opencode_id: opencodeId }
	}

	listProjects(): ProjectRow[] {
		// SQLite is the single source of truth. No scanning, no OpenCode sync.
		return this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as ProjectRow[]
	}

	getProject(q: string): ProjectRow | null {
		return (this.db.prepare("SELECT * FROM projects WHERE path=$v").get({ $v: q })
			|| this.db.prepare("SELECT * FROM projects WHERE LOWER(name)=LOWER($v)").get({ $v: q })
			|| this.db.prepare("SELECT * FROM projects WHERE LOWER(name) LIKE LOWER($v)").get({ $v: `%${q}%` })
		) as ProjectRow | null
	}

	// ── Worker Sessions ──

	private async projectState(project: ProjectRow, skipSid?: string): Promise<{ ctx: string; siblingCtx: string }> {
		let ctx = ""
		try { ctx = await fs.readFile(path.join(project.path, ".kortix", "CONTEXT.md"), "utf8") } catch { ctx = "(none)" }

		const siblings = this.db.prepare("SELECT session_id, prompt, status FROM delegations WHERE project_id=$pid ORDER BY created_at DESC LIMIT 10")
			.all({ $pid: project.id }) as Array<{ session_id: string; prompt: string; status: string }>
		const rows = skipSid ? siblings.filter((s) => s.session_id !== skipSid) : siblings
		return {
			ctx,
			siblingCtx: rows.length > 0
				? rows.map((s) => `- [${s.status}] ${s.session_id.slice(-8)}: ${s.prompt.slice(0, 120)}`).join("\n")
				: "(none)",
		}
	}

	private model(model?: string): { providerID: string; modelID: string } | undefined {
		if (!model || !model.includes("/")) return undefined
		const parts = model.split("/")
		const providerID = parts[0] || ""
		const rest = parts.slice(1)
		return { providerID, modelID: rest.join("/") }
	}

	private promptBody(agent: string, text: string, model?: string): Record<string, any> {
		const body: Record<string, any> = {
			agent,
			parts: [{ type: "text" as const, text }],
			tools: { session_start_background: false, session_spawn: false, session_list_background: false, session_list_spawned: false, session_message: false },
		}
		const cfg = this.model(model)
		if (cfg) body.model = cfg
		return body
	}

	private dispatch(sessionId: string, body: Record<string, any>): void {
		this.client.session
			.prompt({ path: { id: sessionId }, body })
			.catch(async () => {
				try {
					await this.client.session.prompt({ path: { id: sessionId }, body })
				} catch (err: any) {
					this.db.prepare("UPDATE delegations SET status='failed',result=$r,completed_at=$t WHERE session_id=$sid")
						.run({ $r: `Spawn error (after retry): ${err.message}`, $t: new Date().toISOString(), $sid: sessionId })
					this.notifyParent(sessionId)
				}
			})
	}

	private assignment(project: ProjectRow, sessionId: string, prompt: string, ctx: string, siblingCtx: string, command: string, resumedSessionId?: string): string {
		const cmdPrefix = command ? `${command}\n\n` : ""
		const kind = resumedSessionId ? "## Follow-up Session Work" : "## Session Work"
		const extra = resumedSessionId
			? `\n**Resumed Session:** ${resumedSessionId}\n\nContinue work in this same session. Reuse prior context and only respond once this follow-up is actually complete.\n`
			: ""
		return `${cmdPrefix}## Assignment

**Project:** ${project.name} — \`${project.path}\`
**Session:** ${sessionId}

${kind}

${prompt}${extra}

## Project Context

${ctx}

## Other Active Sessions in This Project

${siblingCtx}

Other workers may be running in parallel on this project. **Do NOT touch files outside your assigned scope.** Check \`.kortix/sessions/\` for completed session results if you need shared context.

## Rules

1. **Working directory:** \`${project.path}\` — use \`workdir\` on bash commands.
2. **Stay in your lane.** Only modify files within your task scope. Other workers may be active — respect their file ownership.
3. **TDD:** Write tests FIRST. Implement to pass. Verify after every change.
4. Update \`.kortix/CONTEXT.md\` with discoveries and decisions.
5. Write docs to \`.kortix/docs/\` for shared context.
6. Include test results in your final message.
7. When fully done and all tests pass, emit \`<promise>DONE</promise>\` then \`<promise>VERIFIED</promise>\`.
`
	}

	async spawn(project: ProjectRow, prompt: string, agent: string, parentSid: string, parentAgent: string, command: string = "/autowork", model?: string, title?: string): Promise<DelegationRow> {
		// Read project context
		const state = await this.projectState(project)

		// Create child session
		const sess = await this.client.session.create({ body: { title: (title || prompt).slice(0, 80), parentID: parentSid } })
		if (!sess.data?.id) throw new Error("Failed to create session")
		const sessionId = sess.data.id
		// Agent name is already validated by resolveAgent() in the tool layer — just use it
		const agentName = agent || "kortix"
		const now = new Date().toISOString()

		// Record delegation
		this.db.prepare(`INSERT INTO delegations (session_id,project_id,prompt,agent,parent_session_id,parent_agent,status,created_at)
			VALUES ($sid,$pid,$prompt,$agent,$psid,$pa,'running',$c)`)
			.run({ $sid: sessionId, $pid: project.id, $prompt: prompt, $agent: agentName, $psid: parentSid, $pa: parentAgent, $c: now })

		this.dispatch(sessionId, this.promptBody(agentName, this.assignment(project, sessionId, prompt, state.ctx, state.siblingCtx, command), model))

		return this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid").get({ $sid: sessionId }) as DelegationRow
	}

	async resume(sessionId: string, prompt: string, parentSid: string, parentAgent: string, command: string = "/autowork", model?: string): Promise<DelegationRow> {
		const del = this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid").get({ $sid: sessionId }) as DelegationRow | null
		if (!del) throw new Error(`Session \"${sessionId}\" not found.`)
		const project = this.db.prepare("SELECT * FROM projects WHERE id=$id").get({ $id: del.project_id }) as ProjectRow | null
		if (!project) throw new Error(`Project for session \"${sessionId}\" not found.`)
		const state = await this.projectState(project, sessionId)
		this.db.prepare("UPDATE delegations SET status='running',result=NULL,completed_at=NULL,parent_session_id=$psid,parent_agent=$pa WHERE session_id=$sid")
			.run({ $psid: parentSid, $pa: parentAgent, $sid: sessionId })
		this.dispatch(sessionId, this.promptBody(del.agent || "kortix", this.assignment(project, sessionId, prompt, state.ctx, state.siblingCtx, command, sessionId), model))
		return this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid").get({ $sid: sessionId }) as DelegationRow
	}

	// ── Event Handlers ──

	/**
	 * Debounced idle handler — like PTY exit notification.
	 * On session.idle, starts a 10s timer. If session stays idle (continuation
	 * plugin doesn't continue it), we report back with whatever output exists.
	 * During active autowork loop, idle events reset the timer so it never fires.
	 */
	handleIdleDebounced(sessionId: string): void {
		const del = this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid AND status='running'")
			.get({ $sid: sessionId }) as DelegationRow | null
		if (!del) return

		// Clear any existing timer for this session
		const existing = this.idleTimers.get(sessionId)
		if (existing) clearTimeout(existing)

		// Set new timer — if session stays idle for 10s, it's truly done
		const timer = setTimeout(() => {
			this.idleTimers.delete(sessionId)
			this.handleIdleFinal(sessionId).catch(() => {})
		}, 10_000)

		this.idleTimers.set(sessionId, timer)
	}

	/**
	 * Called after 10s of continuous idle — session is truly done.
	 * Reports back regardless of DONE/VERIFIED status.
	 */
	private async handleIdleFinal(sessionId: string): Promise<void> {
		const del = this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid AND status='running'")
			.get({ $sid: sessionId }) as DelegationRow | null
		if (!del) return

		try {
			const msgs = await this.client.session.messages({ path: { id: sessionId } })
			const data = (msgs.data ?? []) as any[]
			const now = new Date().toISOString()
			const result = data.length > 0 ? this.extractResult(data) : "(session produced no output)"

			// Scan for promises
			let hasVerified = false, hasDone = false
			for (const m of data) {
				if (m?.info?.role !== "assistant") continue
				for (const p of m.parts ?? [])
					if (p.type === "text" && typeof p.text === "string") {
						if (p.text.includes("<promise>VERIFIED</promise>")) hasVerified = true
						if (p.text.includes("<promise>DONE</promise>")) hasDone = true
					}
			}

			if (hasVerified) {
				// Clean completion
				this.db.prepare("UPDATE delegations SET status='complete',result=$r,completed_at=$t WHERE session_id=$sid")
					.run({ $r: result, $t: now, $sid: sessionId })
				this.persistResult(del, result)
			} else if (hasDone) {
				// DONE but verification failed
				this.db.prepare("UPDATE delegations SET status='failed',result=$r,completed_at=$t WHERE session_id=$sid")
					.run({ $r: `DONE but verification failed.\n${result}`, $t: now, $sid: sessionId })
				this.persistResult(del, result)
			} else {
				// Session stopped without DONE/VERIFIED — stalled or autowork loop ended
				this.db.prepare("UPDATE delegations SET status='failed',result=$r,completed_at=$t WHERE session_id=$sid")
					.run({ $r: `Session went idle without completing (no DONE/VERIFIED). Last output:\n${result}`, $t: now, $sid: sessionId })
				this.persistResult(del, result)
			}

			// ALWAYS notify — this is the key difference. Every session reports back.
			this.notifyParent(sessionId)
		} catch {}
	}

	handleError(sessionId: string, error: string): void {
		const del = this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid AND status='running'")
			.get({ $sid: sessionId }) as DelegationRow | null
		if (!del) return
		// Clear any pending idle timer
		const timer = this.idleTimers.get(sessionId)
		if (timer) { clearTimeout(timer); this.idleTimers.delete(sessionId) }
		this.db.prepare("UPDATE delegations SET status='failed',result=$r,completed_at=$t WHERE session_id=$sid")
			.run({ $r: `Session error: ${error}`, $t: new Date().toISOString(), $sid: sessionId })
		this.notifyParent(sessionId)
	}

	async sendMessage(sessionId: string, message: string): Promise<string> {
		const del = this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid").get({ $sid: sessionId }) as DelegationRow | null
		if (!del) return `Session "${sessionId}" not found in delegations.`
		if (del.status !== "running") return `Session is ${del.status}, not running.`
		try {
			await this.client.session.prompt({
				path: { id: sessionId },
				body: { noReply: true, parts: [{ type: "text", text: `[Orchestrator]: ${message}` }] },
			})
			return `Message sent to ${sessionId}.`
		} catch (e) { return `Failed: ${e instanceof Error ? e.message : "unknown"}` }
	}

	listDelegations(projectId?: string): Array<DelegationRow & { project_name: string }> {
		let q = "SELECT d.*, p.name as project_name FROM delegations d LEFT JOIN projects p ON d.project_id=p.id WHERE 1=1"
		const params: Record<string, string> = {}
		if (projectId) { q += " AND d.project_id=$pid"; params.$pid = projectId }
		q += " ORDER BY d.created_at DESC LIMIT 30"
		return this.db.prepare(q).all(params) as Array<DelegationRow & { project_name: string }>
	}

	/**
	 * Read a session's state — works for running and completed sessions.
	 *
	 * Modes:
	 *   "summary" (default) — status + stats + last few text outputs. Cheap.
	 *   "tools"   — summary + list of all tool calls with truncated I/O
	 *   "full"    — complete formatted transcript (like session_get but without TTC compression)
	 *   "search"  — filter messages by regex pattern, return matches
	 */
	async readSession(sessionId: string, mode: string = "summary", pattern?: string): Promise<string> {
		// Check delegations first for stored result
		const del = this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid").get({ $sid: sessionId }) as DelegationRow | null

		// Fetch live messages from the session
		let data: any[] = []
		try {
			const msgs = await this.client.session.messages({ path: { id: sessionId } })
			data = (msgs.data ?? []) as any[]
		} catch {
			// Can't read messages — fall back to stored result
			if (del?.result) return `**Status:** ${del.status}\n**Agent:** ${del.agent}\n\n${del.result}`
			return `Session "${sessionId}" — messages could not be read.`
		}

		const status = del?.status || "unknown"
		const agent = del?.agent || ""

		if (data.length === 0) {
			return `**Status:** ${status} | **Agent:** ${agent} | No messages yet.`
		}

		// ── Stats ──
		let totalMsgs = 0
		let totalTools = 0
		const toolCounts: Record<string, number> = {}
		const toolEntries: Array<{ name: string; input: string; output: string; status: string }> = []
		const textChunks: Array<{ role: string; text: string }> = []

		for (const m of data) {
			const role = m?.info?.role === "user" ? "USER" : "ASSISTANT"
			if (role === "ASSISTANT") totalMsgs++

			for (const p of m.parts ?? []) {
				if (p.type === "text" && typeof p.text === "string" && !p.synthetic && !p.ignored && p.text.trim()) {
					textChunks.push({ role, text: p.text })
				}
				if (p.type === "tool") {
					totalTools++
					const name = p.tool || "unknown"
					toolCounts[name] = (toolCounts[name] || 0) + 1
					const st = p.state || {}
					const inp = JSON.stringify(st.input ?? {})
					const out = st.output ?? st.error ?? ""
					toolEntries.push({
						name,
						input: inp.length > 200 ? inp.slice(0, 200) + "..." : inp,
						output: typeof out === "string" && out.length > 300 ? out.slice(0, 300) + "..." : String(out).slice(0, 300),
						status: st.status || "?",
					})
				}
			}
		}

		const toolList = Object.entries(toolCounts).map(([k, v]) => `${k}(${v})`).join(", ")
		const header = `**Status:** ${status} | **Agent:** ${agent} | **Messages:** ${totalMsgs} | **Tool calls:** ${totalTools}\n**Tools:** ${toolList || "none"}`

		// ── Mode: search ──
		if (mode === "search" && pattern) {
			const re = new RegExp(pattern, "i")
			const matches = textChunks.filter(c => re.test(c.text))
			if (matches.length === 0) return `${header}\n\nNo matches for "${pattern}".`
			const lines = matches.slice(-10).map(c => `**${c.role}:** ${c.text.slice(0, 400)}`)
			return `${header}\n\n**Matches for "${pattern}"** (${matches.length} found, showing last 10):\n\n${lines.join("\n\n")}`
		}

		// ── Mode: full ──
		if (mode === "full") {
			const lines: string[] = [header, ""]
			for (const c of textChunks) lines.push(`**${c.role}:** ${c.text}`)
			for (const t of toolEntries) lines.push(`**TOOL [${t.name}]** (${t.status}): ${t.input} → ${t.output}`)
			return lines.join("\n\n")
		}

		// ── Mode: tools ──
		if (mode === "tools") {
			const lines: string[] = [header, ""]
			for (const t of toolEntries) {
				lines.push(`[${t.status}] **${t.name}**: ${t.input} → ${t.output}`)
			}
			return lines.join("\n")
		}

		// ── Mode: summary (default) ──
		const recent = textChunks.filter(c => c.role === "ASSISTANT").slice(-3)
		const lines: string[] = [header, ""]
		if (textChunks.length > 3) lines.push(`_(showing last 3 of ${textChunks.filter(c => c.role === "ASSISTANT").length} outputs)_`)
		for (const c of recent) lines.push(c.text.slice(0, 500))
		return lines.join("\n\n")
	}

	// ── Internal ──

	private extractResult(msgs: any[]): string {
		for (let i = msgs.length - 1; i >= 0; i--) {
			const m = msgs[i]; if (m?.info?.role !== "assistant") continue
			let t = ""; for (const p of m.parts ?? []) if (p.type === "text" && !p.synthetic && !p.ignored && typeof p.text === "string") t += p.text + "\n"
			if (t.trim()) return t.trim()
		}
		return "(no output)"
	}

	private persistResult(del: DelegationRow, result: string): void {
		try {
			const proj = this.db.prepare("SELECT path FROM projects WHERE id=$id").get({ $id: del.project_id }) as { path: string } | null
			if (!proj) return
			const dir = path.join(proj.path, ".kortix", "sessions")
			mkdirSync(dir, { recursive: true })
			Bun.write(path.join(dir, `${del.session_id.slice(-12)}.md`),
				`# Session Result\n\n**Session:** ${del.session_id}\n**Agent:** ${del.agent}\n**Status:** ${del.status}\n**Prompt:** ${del.prompt.slice(0, 200)}\n**Created:** ${del.created_at}\n**Completed:** ${del.completed_at || "-"}\n\n---\n\n${result}\n`)
		} catch {}
	}

	notifyParent(sessionId: string): void {
		try {
			const del = this.db.prepare("SELECT * FROM delegations WHERE session_id=$sid").get({ $sid: sessionId }) as DelegationRow | null
			if (!del) return
			const proj = this.db.prepare("SELECT name FROM projects WHERE id=$id").get({ $id: del.project_id }) as { name: string } | null
			const label = del.status === "complete" ? "COMPLETE" : "FAILED"
			const body = (del.result || "(no output)").slice(0, 3000)

			this.client.session.prompt({
				path: { id: del.parent_session_id },
				body: { noReply: false, agent: del.parent_agent, parts: [{ type: "text", text:
					`<session-report>\n<session-id>${del.session_id}</session-id>\n<status>${label}</status>\n<project>${proj?.name || "?"}</project>\n<prompt>${del.prompt.slice(0, 200)}</prompt>\n<result>\n${body}\n</result>\n</session-report>\n\nSession **${label}** in project **${proj?.name || "?"}**. Use \`session_read("${del.session_id}")\` for full output, or \`session_get\` to inspect.` }] },
			}).catch(() => {})
		} catch {}
	}
}

// ── Plugin ───────────────────────────────────────────────────────────────────

const KortixPlugin: Plugin = async (ctx) => {
	const { client } = ctx
	const workspaceRoot = resolveKortixWorkspaceRoot(import.meta.dir)
	const kortixDir = ensureKortixDir(import.meta.dir)
	const db = initDb(path.join(kortixDir, "kortix.db"))
	const mgr = new Manager(client, workspaceRoot, db)

	// Track current session ID for per-message project status injection
	let currentOrchestratorSessionId: string | null = null

	// Fetch available agent names from the runtime — no hardcoding
	let cachedAgentNames: string[] | null = null // null = not yet loaded
	const agentListReady = ((client as any).agents?.() as Promise<any> | undefined)
		?.then((res: any) => {
			const agents = res?.data ?? res ?? []
			if (Array.isArray(agents) && agents.length > 0) {
				cachedAgentNames = agents.map((a: any) => a?.name ?? a?.id).filter(Boolean)
			} else {
				cachedAgentNames = ["kortix"]
			}
		})
		?.catch(() => { cachedAgentNames = ["kortix"] }) // fallback on error

	/** Validate an agent name against the runtime's available agents */
	async function resolveAgent(explicit: string, parentAgent: string): Promise<string> {
		// Wait for agent list if it hasn't loaded yet (typically <100ms)
		if (!cachedAgentNames && agentListReady) {
			await agentListReady
		}
		const known = cachedAgentNames ?? ["kortix"]
		// If explicit and valid, use it
		if (explicit && explicit !== "default" && explicit !== "background" && known.includes(explicit)) {
			return explicit
		}
		// Inherit from parent if valid
		if (parentAgent && known.includes(parentAgent)) {
			return parentAgent
		}
		// Fallback
		return "kortix"
	}

	const listBackgroundSessions = tool({
		description: "List background sessions, optionally filtered by project.",
		args: {
			project: tool.schema.string().describe('"" for all projects.'),
		},
		async execute(args: { project: string }): Promise<string> {
			let pid: string | undefined
			if (args.project) { const p = mgr.getProject(args.project); if (!p) return "Project not found."; pid = p.id }
			const dels = mgr.listDelegations(pid)
			if (!dels.length) return "No worker sessions."
			const lines = dels.map(d => {
				const elapsed = d.status === "running" ? ` ${Math.round((Date.now() - new Date(d.created_at).getTime()) / 1000)}s` : ""
				return `| ${d.session_id.slice(-8)} | ${d.status}${elapsed} | ${d.project_name || "-"} | ${d.prompt.slice(0, 50)} |`
			})
			return `| Session | Status | Project | Prompt |\n|---|---|---|---|\n${lines.join("\n")}`
		},
	})

	const spawnBackgroundSession = tool({
		description: `Spawn or resume a background session in a project. Returns the session ID immediately, then later sends a <session-report> on completion or failure. Runs /autowork by default.`,
		args: {
			project: tool.schema.string().describe('Project name or path. Required for new sessions. "" when resuming via session_id.'),
			description: tool.schema.string().describe('Short session label (shown in lists). "" to auto-generate from prompt.'),
			prompt: tool.schema.string().describe("Detailed task description. Be thorough — the session starts with zero context beyond this + project's .kortix/CONTEXT.md."),
			agent: tool.schema.string().describe('"" to inherit from current session (recommended). Or any agent name like "kortix", "explore", "general".'),
			subagent_type: tool.schema.string().describe('Deprecated, ignored. Use agent instead.'),
			session_id: tool.schema.string().describe('Existing session ID to resume. "" for a new session.'),
			model: tool.schema.string().describe('"" to inherit from current session (recommended). Or "provider/model" like "anthropic/claude-sonnet-4-6".'),
			command: tool.schema.string().describe('"" for default (/autowork). Or any command. "none" for one-shot (no loop).'),
		},
		async execute(args: { project: string; description: string; prompt: string; agent: string; subagent_type: string; session_id: string; model: string; command: string }, toolCtx: ToolContext): Promise<string> {
			if (!toolCtx?.sessionID) return "Error: no session context."
			try {
				const cmd = args.command === "none" ? "" : (args.command || "/autowork")
				// Resolve agent: explicit arg > parent session's agent > "kortix"
				// subagent_type is ignored — LLMs fill it with garbage like "background"
				const agent = await resolveAgent(args.agent || "", toolCtx.agent || "")
				const existingSessionId = args.session_id || ""
				const del = existingSessionId
					? await mgr.resume(existingSessionId, args.prompt, toolCtx.sessionID, toolCtx.agent, cmd, args.model || undefined)
					: await (async () => {
						const p = mgr.getProject(args.project)
						if (!p) throw new Error(`Project "${args.project}" not found.`)
						return mgr.spawn(p, args.prompt, agent, toolCtx.sessionID, toolCtx.agent, cmd, args.model || undefined, args.description || undefined)
					})()
				const p = db.prepare("SELECT name FROM projects WHERE id=$id").get({ $id: del.project_id }) as { name: string } | null
				const active = (db.prepare("SELECT COUNT(*) as c FROM delegations WHERE status='running'").get() as { c: number })?.c || 0
				return `Session ${existingSessionId ? "resumed" : "started"}:\n- **Session:** ${del.session_id}\n- **Project:** ${p?.name || "?"}\n- **Agent:** ${del.agent}${args.model ? `\n- **Model:** ${args.model}` : ""}\n- **Command:** ${cmd || "(one-shot)"}\n- **Active:** ${active}\n\n<session-report> will arrive on completion/failure.`
			} catch (e) { return `Failed: ${e instanceof Error ? e.message : "unknown"}` }
		},
	})

	return {
		tool: {
			project_create: tool({
				description: "Register a directory as a project (new or existing). Never overwrites existing files.",
				args: {
					name: tool.schema.string().describe("Project name"),
					description: tool.schema.string().describe('Description. "" if none.'),
					path: tool.schema.string().describe('Absolute path. "" for default (projects/{name}).'),
				},
				async execute(args: { name: string; description: string; path: string }): Promise<string> {
					try {
						const p = await mgr.createProject(args.name, args.description, args.path)
						return `Project **${p.name}** at \`${p.path}\` (${p.id})`
					} catch (e) { return `Failed: ${e instanceof Error ? e.message : "unknown"}` }
				},
			}),

		project_list: tool({
				description: "List all projects from Kortix SQLite.",
				args: {},
				async execute(): Promise<string> {
					const ps = mgr.listProjects()
					if (!ps.length) return "No projects yet. Use `project_create` to create one."
					const lines = ps.map(p => {
						const sessions = (db.prepare("SELECT COUNT(*) as c FROM delegations WHERE project_id=$pid").get({ $pid: p.id }) as { c: number })?.c || 0
						return `| **${p.name}** | \`${p.path}\` | ${sessions} | ${p.description || "—"} |`
					})
					return `| Project | Path | Sessions | Description |\n|---|---|---|---|\n${lines.join("\n")}\n\n${ps.length} project${ps.length !== 1 ? "s" : ""}.`
				},
			}),

			project_get: tool({
				description: "Get project details and session info.",
				args: { name: tool.schema.string().describe("Name or path") },
				async execute(args: { name: string }): Promise<string> {
					const p = mgr.getProject(args.name)
					if (!p) return `Project not found: "${args.name}"`
					const sessionStats = db.prepare("SELECT status, COUNT(*) as c FROM delegations WHERE project_id=$pid GROUP BY status").all({ $pid: p.id }) as Array<{ status: string; c: number }>
					const contextPath = path.join(p.path, ".kortix", "CONTEXT.md")
					const contextExists = existsSync(contextPath)
					const lines = [
						`## ${p.name}`,
						``,
						`**Path:** \`${p.path}\``,
						p.description ? `**Description:** ${p.description}` : null,
						`**ID:** \`${p.id}\``,
						``,
						`### Sessions`,
						sessionStats.length > 0 ? sessionStats.map(s => `- ${s.status}: ${s.c}`).join("\n") : "No sessions yet.",
						``,
						`**Context:** \`${contextPath}\` ${contextExists ? "✓" : "(not created)"}`,
					].filter(Boolean)
					return lines.join("\n")
				},
			}),

			project_update: tool({
				description: "Update project name/description.",
				args: {
					project: tool.schema.string().describe("Name or path"),
					name: tool.schema.string().describe('"" to keep current'),
					description: tool.schema.string().describe('"" to keep current'),
				},
				async execute(args: { project: string; name: string; description: string }): Promise<string> {
					const p = mgr.getProject(args.project)
					if (!p) return "Not found."
					const n = args.name || p.name, d = args.description || p.description
					db.prepare("UPDATE projects SET name=$n,description=$d WHERE id=$id").run({ $n: n, $d: d, $id: p.id })
					return `Updated: **${n}**`
				},
			}),

			project_select: tool({
				description: "Set the active project for this session. Must be called before any file/bash/edit operations. Auto-detected from working directory when possible.",
				args: {
					project: tool.schema.string().describe('Project name or path to select.'),
				},
				async execute(args: { project: string }, toolCtx: ToolContext): Promise<string> {
					if (!toolCtx?.sessionID) return "Error: no session context."
					const p = mgr.getProject(args.project)
					if (!p) return `Project "${args.project}" not found. Use project_list to see available projects, or project_create to register one.`
					mgr.setSessionProject(toolCtx.sessionID, p.id)
					return `Project **${p.name}** selected for this session.\nPath: \`${p.path}\`\nYou can now use file, bash, and edit tools.`
				},
			}),

			session_start_background: spawnBackgroundSession,
			session_spawn: tool({
				description: "Compatibility alias for `session_start_background`.",
				args: {
					project: tool.schema.string().describe('Project name or path. Required for new sessions. "" when resuming via session_id.'),
					description: tool.schema.string().describe('Short session label. "" to auto-generate.'),
					prompt: tool.schema.string().describe("Detailed task description."),
					agent: tool.schema.string().describe('"" to inherit from current session. Or explicit agent name.'),
					subagent_type: tool.schema.string().describe('Deprecated, ignored. Use agent instead.'),
					session_id: tool.schema.string().describe('Existing session ID to resume. "" for new.'),
					model: tool.schema.string().describe('"" to inherit from current session. Or "provider/model".'),
					command: tool.schema.string().describe('"" for default (/autowork). Or any command. "none" for one-shot.'),
				},
				async execute(args: { project: string; description: string; prompt: string; agent: string; subagent_type: string; session_id: string; model: string; command: string }, toolCtx: ToolContext): Promise<string> {
					return spawnBackgroundSession.execute(args, toolCtx)
				},
			}),

			session_list_background: listBackgroundSessions,
			session_list_spawned: tool({
				description: "Compatibility alias for `session_list_background`.",
				args: {
					project: tool.schema.string().describe('"" for all projects.'),
				},
				async execute(args: { project: string }, toolCtx: ToolContext): Promise<string> {
					return listBackgroundSessions.execute(args, toolCtx)
				},
			}),

			session_read: tool({
				description: `Read a session's state. Works on running AND completed sessions.
Modes:
  "summary" (default) — status + stats + last 3 text outputs. Cheap, use this first.
  "tools"   — summary + every tool call with truncated I/O. See what the session DID.
  "full"    — complete transcript. Expensive — only use when you need everything.
  "search"  — filter by regex pattern. Find errors, specific output, etc.
Also works on ANY session ID (not just spawned ones) — use session_list (built-in) to find IDs.`,
				args: {
					session_id: tool.schema.string().describe("Session ID"),
					mode: tool.schema.string().describe('"summary" (default), "tools", "full", or "search"'),
					pattern: tool.schema.string().describe('Regex for search mode. E.g. "error|fail|TypeError". "" to skip.'),
				},
				async execute(args: { session_id: string; mode: string; pattern: string }): Promise<string> {
					return mgr.readSession(args.session_id, args.mode || "summary", args.pattern || undefined)
				},
			}),

			session_message: tool({
				description: "Send a message into a running session. The agent sees it on its next iteration.",
				args: {
					session_id: tool.schema.string().describe("Session ID"),
					message: tool.schema.string().describe("Message content"),
				},
				async execute(args: { session_id: string; message: string }): Promise<string> { return mgr.sendMessage(args.session_id, args.message) },
			}),
		},

		// ── Project gate: block work tools until a project is selected for the session ──
		// CRITICAL: This hook runs before EVERY tool call. If it throws, the tool
		// fails. If the DB is broken, we must FAIL OPEN (allow) not fail closed
		// (block everything with "disk I/O error").
		"tool.execute.before": async (input: { tool: string; sessionID: string; callID: string }, _output: { args: any }) => {
			// Normalize tool name to underscores so we only need one canonical form.
			const toolName = input.tool
			const n = toolName.replace(/-/g, "_")

			// Tools that are always allowed without a project selected.
			// Listed in underscore form — the normalizer above handles hyphens.
			const UNGATED_PREFIXES = [
				"project_", "session_", "worktree_",     // orchestration
				"web_search",                            // web search
				"image_search",                          // image search
				"scrape_webpage",                        // web scraping
				"instance_dispose",                      // system reload
				"context7_",                             // docs
			]
			if (UNGATED_PREFIXES.some(p => n.startsWith(p))) return

			const UNGATED_EXACT = [
				"todowrite", "todoread", "show", "question", "skill",
				"webfetch", "apply_patch",
			]
			if (UNGATED_EXACT.includes(n)) return

			const sessionId = input.sessionID
			if (!sessionId) return // no session context — can't gate

			// Wrap DB access in try-catch — if the DB is broken, fail open, don't block work
			try {
				// Check if session already has a project (in-memory cache → DB fallback, once per session)
				const linked = mgr.getSessionProject(sessionId)
				if (linked) return // already linked — allow
			} catch (err) {
				// DB error (disk I/O, corruption, etc.) — fail open, don't block work
				console.error(`[kortix-orchestrator] Project gate DB error (allowing tool): ${err instanceof Error ? err.message : err}`)
				return
			}

			// No project — block with descriptive error
			throw new Error(
				`No project selected for this session. You must select or create a project first.\n` +
				`Use project_list to see existing projects, then project_select to choose one.\n` +
				`Or use project_create to register a new project directory.`
			)
		},

		event: async ({ event }: { event: Event }) => {
			const sid = (event as any).properties?.sessionID
			if (!sid) return
			if (event.type === "session.created") {
				currentOrchestratorSessionId = sid
			}
			if (event.type === "session.idle") mgr.handleIdleDebounced(sid)
			if (event.type === "session.error" || (event.type as string) === "session.aborted") {
				const error = (event as any).properties?.error || (event as any).properties?.reason || "Session error"
				mgr.handleError(sid, String(error))
			}
		},

		// ── Project status: injected into every message ──
		"experimental.chat.messages.transform": async (_input: any, output: { messages: any[] }) => {
			try {
				if (!currentOrchestratorSessionId) return

				let statusXml: string
				try {
					const project = mgr.getSessionProject(currentOrchestratorSessionId)
					if (project) {
						statusXml = `<project_status selected="${project.name}" path="${project.path}" />`
					} else {
						statusXml = [
							`<project_status selected="false">`,
							`All tools are gated. You must select or create a project first.`,
							`1. project_list — see existing projects`,
							`2. Decide: does this belong to an existing project, or create a new one?`,
							`3. If unclear, ask the user with the question tool.`,
							`4. project_select or project_create → project_select`,
							`Load skill "kortix-projects-sessions" for full context.`,
							`</project_status>`,
						].join("\n")
					}
				} catch { return } // DB error — fail open

				const messages = output.messages
				for (let i = messages.length - 1; i >= 0; i--) {
					if (messages[i]?.info?.role === "user") {
						if (!Array.isArray(messages[i].parts)) messages[i].parts = []
						messages[i].parts.push({ type: "text", text: wrapInKortixSystemTags(statusXml) })
						break
					}
				}
			} catch (err) {
				console.error(`[kortix-orchestrator] project status injection failed: ${err}`)
			}
		},

		"experimental.session.compacting": async (_input: any, output: { context: string[] }) => {
			const active = db.prepare("SELECT d.*,p.name as pn FROM delegations d LEFT JOIN projects p ON d.project_id=p.id WHERE d.status='running'").all() as Array<DelegationRow & { pn: string }>
			if (!active.length) return
			const inner = ["<orchestrator-state>", "Active workers:"]
			for (const d of active) inner.push(`- ${d.session_id.slice(-8)} [${d.agent}] in ${d.pn}: ${d.prompt.slice(0, 100)}`)
			inner.push("</orchestrator-state>")
			// Wrap in kortix_system tags so frontend strips from UI
			output.context.push(wrapInKortixSystemTags(inner.join("\n"), { type: "orchestrator-state", source: "kortix-orchestrator" }))
		},
	}
}

export default KortixPlugin
