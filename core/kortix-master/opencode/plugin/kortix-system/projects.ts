/**
 * Kortix Projects — project CRUD + session-project linking + file gating.
 *
 * SQLite (kortix.db) is the single source of truth.
 * No filesystem scanning, no markers.
 */

import { Database } from "bun:sqlite"
import * as fs from "node:fs/promises"
import { existsSync, mkdirSync, unlinkSync, statSync } from "node:fs"
import * as path from "node:path"
import { tool, type ToolContext } from "@opencode-ai/plugin"
import { ensureGlobalMemoryFiles } from "./lib/paths"

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectRow {
	id: string; name: string; path: string; description: string
	created_at: string; opencode_id: string | null
}

// ── Database ─────────────────────────────────────────────────────────────────

export function initProjectsDb(dbPath: string): Database {
	mkdirSync(path.dirname(dbPath), { recursive: true })
	try {
		const dbExists = existsSync(dbPath)
		const dbEmpty = dbExists && statSync(dbPath).size === 0
		if (!dbExists || dbEmpty) {
			for (const suffix of ["", "-wal", "-shm", "-journal"]) {
				try { unlinkSync(dbPath + suffix) } catch {}
			}
		}
	} catch {}

	let db: Database
	try { db = new Database(dbPath) } catch {
		for (const suffix of ["", "-wal", "-shm", "-journal"]) {
			try { unlinkSync(dbPath + suffix) } catch {}
		}
		db = new Database(dbPath)
	}
	db.exec("PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000")
	db.exec(`
		CREATE TABLE IF NOT EXISTS projects (
			id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
			description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
			opencode_id TEXT
		);
		CREATE TABLE IF NOT EXISTS session_projects (
			session_id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL REFERENCES projects(id),
			set_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS connectors (
			id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
			description TEXT, source TEXT, pipedream_slug TEXT,
			env_keys TEXT, notes TEXT, auto_generated INTEGER DEFAULT 0,
			created_at TEXT NOT NULL, updated_at TEXT NOT NULL
		);
	`)
	try { db.exec("ALTER TABLE projects ADD COLUMN opencode_id TEXT") } catch {}
	return db
}

// ── Manager ──────────────────────────────────────────────────────────────────

function projectId(name: string): string {
	return `proj-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`
}

export class ProjectManager {
	private sessionProjectCache = new Map<string, ProjectRow>()

	constructor(private client: any, private workspaceRoot: string, public db: Database) {}

	getSessionProject(sessionId: string): ProjectRow | null {
		const cached = this.sessionProjectCache.get(sessionId)
		if (cached) return cached
		const row = this.db.prepare("SELECT p.* FROM session_projects sp JOIN projects p ON sp.project_id = p.id WHERE sp.session_id = $sid")
			.get({ $sid: sessionId }) as ProjectRow | null
		if (row) this.sessionProjectCache.set(sessionId, row)
		return row
	}

	setSessionProject(sessionId: string, projectId: string): void {
		this.db.prepare("INSERT OR REPLACE INTO session_projects (session_id, project_id, set_at) VALUES ($sid, $pid, $now)")
			.run({ $sid: sessionId, $pid: projectId, $now: new Date().toISOString() })
		const project = this.db.prepare("SELECT * FROM projects WHERE id = $id").get({ $id: projectId }) as ProjectRow | null
		if (project) this.sessionProjectCache.set(sessionId, project)
	}

	async createProject(name: string, desc: string, customPath: string): Promise<ProjectRow> {
		const pp = customPath || path.join(this.workspaceRoot, "projects", name)
		const existing = this.db.prepare("SELECT * FROM projects WHERE path=$p").get({ $p: pp }) as ProjectRow | null
		if (existing) {
			if (desc) { this.db.prepare("UPDATE projects SET description=$d WHERE id=$id").run({ $d: desc, $id: existing.id }); existing.description = desc }
			return existing
		}
		const wm = async (f: string, c: string) => { if (!existsSync(f)) await fs.writeFile(f, c, "utf8") }
		for (const d of [".kortix/docs", ".kortix/sessions"])
			await fs.mkdir(path.join(pp, d), { recursive: true })
		ensureGlobalMemoryFiles(import.meta.dir)
		await wm(path.join(pp, ".kortix", "CONTEXT.md"), `# ${name}\n\n${desc || "No description."}\n`)
		const id = projectId(name), now = new Date().toISOString()
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
		return this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as ProjectRow[]
	}

	getProject(q: string): ProjectRow | null {
		return (this.db.prepare("SELECT * FROM projects WHERE path=$v").get({ $v: q })
			|| this.db.prepare("SELECT * FROM projects WHERE LOWER(name)=LOWER($v)").get({ $v: q })
			|| this.db.prepare("SELECT * FROM projects WHERE LOWER(name) LIKE LOWER($v)").get({ $v: `%${q}%` })
		) as ProjectRow | null
	}
}

// ── Tools ────────────────────────────────────────────────────────────────────

export function projectTools(mgr: ProjectManager, db: Database) {
	return {
		project_create: tool({
			description: "Register a directory as a project (new or existing). Never overwrites existing files.",
			args: {
				name: tool.schema.string().describe("Project name"),
				description: tool.schema.string().describe('Description. "" if none.'),
				path: tool.schema.string().describe('Absolute path. "" for default.'),
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
				const lines = ps.map(p => `| **${p.name}** | \`${p.path}\` | ${p.description || "—"} |`)
				return `| Project | Path | Description |\n|---|---|---|\n${lines.join("\n")}\n\n${ps.length} project${ps.length !== 1 ? "s" : ""}.`
			},
		}),

		project_get: tool({
			description: "Get project details and session info.",
			args: { name: tool.schema.string().describe("Name or path") },
			async execute(args: { name: string }): Promise<string> {
				const p = mgr.getProject(args.name)
				if (!p) return `Project not found: "${args.name}"`
				const contextPath = path.join(p.path, ".kortix", "CONTEXT.md")
				return [
					`## ${p.name}`, ``, `**Path:** \`${p.path}\``,
					p.description ? `**Description:** ${p.description}` : null,
					`**ID:** \`${p.id}\``, ``,
					`**Context:** \`${contextPath}\` ${existsSync(contextPath) ? "✓" : "(not created)"}`,
				].filter(Boolean).join("\n")
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

		project_delete: tool({
			description: "Delete a project from the registry. Does NOT delete files on disk.",
			args: { project: tool.schema.string().describe("Project name or path") },
			async execute(args: { project: string }): Promise<string> {
				const p = mgr.getProject(args.project)
				if (!p) return `Project not found: "${args.project}"`
				db.prepare("DELETE FROM session_projects WHERE project_id=$pid").run({ $pid: p.id })
				db.prepare("DELETE FROM projects WHERE id=$id").run({ $id: p.id })
				return `Project **${p.name}** deleted from registry.\nDirectory \`${p.path}\` untouched.`
			},
		}),

		project_select: tool({
			description: "Set the active project for this session. Must be called before file/bash/edit tools.",
			args: { project: tool.schema.string().describe('Project name or path.') },
			async execute(args: { project: string }, toolCtx: ToolContext): Promise<string> {
				if (!toolCtx?.sessionID) return "Error: no session context."
				const p = mgr.getProject(args.project)
				if (!p) return `Project "${args.project}" not found. Use project_list or project_create.`
				mgr.setSessionProject(toolCtx.sessionID, p.id)
				return `Project **${p.name}** selected for this session.\nPath: \`${p.path}\`\nYou can now use file, bash, and edit tools.`
			},
		}),
	}
}

// ── Gating Hook ──────────────────────────────────────────────────────────────

export function projectGateHook(mgr: ProjectManager) {
	// Tools that are ALWAYS allowed without a project
	// ONLY project tools and question are allowed without a project.
	// Everything else — including web search, read, skill — is blocked.
	const UNGATED = new Set([
		"project_create", "project_list", "project_get", "project_update",
		"project_delete", "project_select",
		"question",
		"show",
	])

	return async (input: { tool: string; sessionID: string; callID: string }, _output: { args: any }) => {
		const n = input.tool.replace(/-/g, "_")
		if (UNGATED.has(n)) return
		if (!input.sessionID) return
		try {
			if (mgr.getSessionProject(input.sessionID)) return
		} catch { return } // DB error — fail open
		throw new Error(
			`No project selected for this session. You must select or create a project first.\n` +
			`Use project_list to see existing projects, then project_select to choose one.\n` +
			`Or use project_create to register a new project directory.`
		)
	}
}

// ── Status Injection ─────────────────────────────────────────────────────────

export function projectStatusTransform(mgr: ProjectManager, getCurrentSessionId: () => string | null) {
	return async (_input: any, output: { messages: any[] }) => {
		// Only inject orchestrator reminder for the primary agent (kortix), not sub-agents
		const isOrchestrator = (() => {
			for (const m of output.messages) {
				const agent = m?.info?.agent
				if (agent && agent !== "kortix") return false
			}
			return true
		})()
		try {
			// Get session ID from messages (more reliable than event-based tracking)
			let sid = getCurrentSessionId()
			if (!sid) {
				for (const m of output.messages) {
					const msgSid = m?.info?.sessionID || m?.sessionID
					if (msgSid) { sid = msgSid; break }
				}
			}
			console.log(`[project-gate] Transform called. sid=${sid}, messages=${output.messages?.length || 0}`)
			if (!sid) { console.log("[project-gate] No session ID found, skipping"); return }
			let statusXml: string
			try {
				const project = mgr.getSessionProject(sid)
				if (project) {
					if (isOrchestrator) {
						statusXml = [
							`<project_status selected="${project.name}" path="${project.path}" />`,
							`<system-reminder>`,
							`Follow your orchestrator workflow:`,
							`1. task_create for each piece of work — tell the user your plan`,
							`2. agent_spawn(agent_type:"worker") then agent_wait(agent_id) for each task`,
							`3. Review worker results, task_done for each, report to user`,
							`Always call agent_wait immediately after agent_spawn to get real results.`,
							`</system-reminder>`,
						].join("\n")
					} else {
						// Sub-agents just get project context, no orchestrator instructions
						statusXml = `<project_status selected="${project.name}" path="${project.path}" />`
					}
				} else {
					// Count user messages to detect first message
					const userMsgCount = output.messages.filter((m: any) => m?.info?.role === "user").length
					const isFirst = userMsgCount <= 1

					// Get project list for context
					let projectList = ""
					try {
						const projects = mgr.listProjects()
						if (projects.length > 0) {
							projectList = `\nExisting projects: ${projects.map(p => `"${p.name}" (${p.path})`).join(", ")}`
						}
					} catch {}

					const gate = [
						`<system-reminder>`,
						`STOP. DO NOT CALL ANY TOOL EXCEPT project_list, project_create, project_select, OR question.`,
						``,
						`No project is selected for this session. You MUST select one before doing ANY work.`,
						`Your very next tool call must be one of: project_list, project_create, project_select, or question.`,
						`If you call bash, read, write, edit, skill, web_search, or any other tool, you are violating your instructions.`,
						`${projectList}`,
						``,
						`Step 1: Call project_list to see existing projects.`,
						`Step 2: Either project_select an existing one, or project_create + project_select a new one.`,
						`Step 3: ONLY THEN address the user's request.`,
						`</system-reminder>`,
					].join("\n")
					statusXml = gate
				}
			} catch { return }
			const messages = output.messages
			for (let i = messages.length - 1; i >= 0; i--) {
				if (messages[i]?.info?.role === "user") {
					if (!Array.isArray(messages[i].parts)) messages[i].parts = []
					messages[i].parts.push({ type: "text", text: `<kortix_system type="project-status" source="kortix-system">${statusXml}</kortix_system>` })
					break
				}
			}
		} catch {}
	}
}
