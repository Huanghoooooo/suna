/**
 * Kortix Connectors Plugin — SQLite-backed.
 * Single source of truth in .kortix/kortix.db connectors table.
 *
 * Tools: connector_list, connector_get, connector_setup
 */

import { Database } from "bun:sqlite"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { type Plugin, tool } from "@opencode-ai/plugin"
import { ensureKortixDir } from "./lib/paths"
import { ensureSchema } from "./lib/schema"

function resolveDbPath(): string {
	// Use shared path resolution — aligns with the parent plugin's DB location.
	// Inside sandbox: KORTIX_WORKSPACE is set → /workspace/.kortix/kortix.db
	// On host: walks up from import.meta.dir to find workspace root
	const dbDir = ensureKortixDir(import.meta.dir)
	return path.join(dbDir, "kortix.db")
}

let _db: Database | null = null

function db(): Database {
	if (_db) return _db
	_db = new Database(resolveDbPath())
	_db.exec("PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000")

	ensureSchema(_db, "connectors", [
		{ name: "id",             type: "TEXT",    notNull: true,  defaultValue: null, primaryKey: true },
		{ name: "name",           type: "TEXT",    notNull: true,  defaultValue: null, primaryKey: false, unique: true },
		{ name: "description",    type: "TEXT",    notNull: false, defaultValue: null, primaryKey: false },
		{ name: "source",         type: "TEXT",    notNull: false, defaultValue: null, primaryKey: false },
		{ name: "pipedream_slug", type: "TEXT",    notNull: false, defaultValue: null, primaryKey: false },
		{ name: "env_keys",       type: "TEXT",    notNull: false, defaultValue: null, primaryKey: false },
		{ name: "notes",          type: "TEXT",    notNull: false, defaultValue: null, primaryKey: false },
		{ name: "auto_generated", type: "INTEGER", notNull: false, defaultValue: "0",  primaryKey: false },
		{ name: "created_at",     type: "TEXT",    notNull: true,  defaultValue: null, primaryKey: false },
		{ name: "updated_at",     type: "TEXT",    notNull: true,  defaultValue: null, primaryKey: false },
	])

	return _db
}

interface Row {
	name: string; description: string | null; source: string | null
	pipedream_slug: string | null; env_keys: string | null; notes: string | null
}

/** Sandbox master base URL — always localhost:8000 inside the sandbox (no auth needed). */
const SANDBOX_MASTER_URL = process.env.KORTIX_MASTER_URL?.trim() || "http://localhost:8000"

interface SandboxConnectorRow {
	id: string; name: string; description: string | null; source: string | null
	pipedream_slug: string | null; env_keys: string[] | null; notes: string | null
	auto_generated: boolean; created_at: string; updated_at: string
}

/**
 * Try fetching connectors from the sandbox master HTTP API.
 * Inside the sandbox this always works (localhost, no auth).
 * On the host this will fail gracefully (timeout/connection refused).
 */
async function fetchSandboxConnectors(): Promise<Row[]> {
	try {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 2000)
		const res = await fetch(`${SANDBOX_MASTER_URL}/kortix/connectors`, {
			signal: controller.signal,
		})
		clearTimeout(timeout)
		if (!res.ok) return []
		const data = await res.json() as { connectors?: SandboxConnectorRow[] }
		return (data.connectors ?? []).map(c => ({
			name: c.name,
			description: c.description,
			source: c.source,
			pipedream_slug: c.pipedream_slug,
			env_keys: c.env_keys ? JSON.stringify(c.env_keys) : null,
			notes: c.notes,
		}))
	} catch {
		return []
	}
}

/**
 * Try fetching a single connector by name from the sandbox master HTTP API.
 */
async function fetchSandboxConnector(name: string): Promise<Row | null> {
	try {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 2000)
		const res = await fetch(`${SANDBOX_MASTER_URL}/kortix/connectors/${encodeURIComponent(name)}`, {
			signal: controller.signal,
		})
		clearTimeout(timeout)
		if (!res.ok) return null
		const c = await res.json() as SandboxConnectorRow
		if (!c.name) return null
		return {
			name: c.name,
			description: c.description,
			source: c.source,
			pipedream_slug: c.pipedream_slug,
			env_keys: c.env_keys ? JSON.stringify(c.env_keys) : null,
			notes: c.notes,
		}
	} catch {
		return null
	}
}

function resolveConnectorRoot(): string | null {
	const explicit = process.env.OPENCODE_CONFIG_DIR?.trim()
	if (explicit) return path.join(path.resolve(explicit), "connectors")
	const workspace = process.env.KORTIX_WORKSPACE?.trim()
	if (workspace) return path.join(path.resolve(workspace), ".opencode", "connectors")
	return path.join(process.cwd(), ".opencode", "connectors")
}

function discoverFileConnectors(): Row[] {
	const root = resolveConnectorRoot()
	if (!root || !existsSync(root)) return []
	const rows: Row[] = []
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue
		const md = path.join(root, entry.name, "CONNECTOR.md")
		if (!existsSync(md)) continue
		const text = readFileSync(md, "utf8")
		const match = text.match(/^---\n([\s\S]*?)\n---/)
		const frontmatter = match?.[1] ?? ""
		const field = (name: string): string | null => {
			const line = frontmatter.split("\n").find((l) => l.startsWith(`${name}:`))
			if (!line) return null
			return line.slice(name.length + 1).trim().replace(/^"|"$/g, "") || null
		}
		rows.push({
			name: field("name") ?? entry.name,
			description: field("description"),
			source: field("source"),
			pipedream_slug: field("pipedream_slug"),
			env_keys: null,
			notes: null,
		})
	}
	return rows
}

const ConnectorsPlugin: Plugin = async () => {
	return {
		tool: {
			connector_list: tool({
				description: "List all connectors — what's connected, how, and where.",
				args: {
					filter: tool.schema.string().describe('"" for all, or filter by source/name.'),
				},
				async execute(args: { filter: string }): Promise<string> {
					// Try sandbox HTTP API first (works inside sandbox, graceful fail on host)
					let rows = await fetchSandboxConnectors()

					// Fall back to local DB + file-based connectors if sandbox API returned nothing
					if (!rows.length) {
						rows = db().query("SELECT * FROM connectors ORDER BY name").all() as Row[]
						for (const discovered of discoverFileConnectors()) {
							if (!rows.some((r) => r.name === discovered.name)) rows.push(discovered)
						}
					}

					rows.sort((a, b) => a.name.localeCompare(b.name))
					const f = args.filter?.toLowerCase().trim()
					if (f) rows = rows.filter(r =>
						r.name.toLowerCase().includes(f) || r.source?.toLowerCase().includes(f) || r.description?.toLowerCase().includes(f)
					)
					if (!rows.length) return "No connectors found."
					const lines = rows.map(r => `| ${r.name} | ${r.description || ""} | ${r.source || "—"} |`)
					return `| Name | Description | Source |\n|---|---|---|\n${lines.join("\n")}`
				},
			}),

			connector_get: tool({
				description: "Get a connector's full metadata.",
				args: { name: tool.schema.string().describe("Connector name.") },
				async execute(args: { name: string }): Promise<string> {
					// Try sandbox HTTP API first
					let row = await fetchSandboxConnector(args.name)

					// Fall back to local DB
					if (!row) {
						row = db().query("SELECT * FROM connectors WHERE name = ? OR name LIKE ?").get(args.name, `%${args.name}%`) as Row | null
					}
					if (!row) {
						row = discoverFileConnectors().find((r) => r.name === args.name || r.name.includes(args.name)) ?? null
					}
					if (!row) {
						// Try sandbox API for the full list to show available names
						const sandboxRows = await fetchSandboxConnectors()
						const localRows = (db().query("SELECT name FROM connectors ORDER BY name").all() as { name: string }[]).map(r => r.name)
						const allNames = [...new Set([...sandboxRows.map(r => r.name), ...localRows])].sort()
						return `Not found: "${args.name}". Available: ${allNames.join(", ") || "none"}`
					}
					const parts = [`name: ${row.name}`]
					if (row.description) parts.push(`description: ${row.description}`)
					if (row.source) parts.push(`source: ${row.source}`)
					if (row.pipedream_slug) parts.push(`pipedream_slug: ${row.pipedream_slug}`)
					if (row.env_keys) parts.push(`env: ${row.env_keys}`)
					if (row.notes) parts.push(`notes: ${row.notes}`)
					return parts.join("\n")
				},
			}),

			connector_setup: tool({
				description: `Create or update connectors. Pass a JSON array. Only "name" is required. Fields: name, description, source (pipedream/cli/api-key/mcp/custom), pipedream_slug, env_keys (array), notes.`,
				args: {
					connectors: tool.schema.string().describe('JSON array. E.g. [{"name":"github","description":"kortix-ai org","source":"cli"}]'),
				},
				async execute(args: { connectors: string }): Promise<string> {
					let items: Array<Record<string, any>>
					try { items = JSON.parse(args.connectors) } catch { return "Invalid JSON." }
					if (!Array.isArray(items) || !items.length) return "Pass a non-empty array."

					const d = db()
					const stmt = d.prepare(`
						INSERT INTO connectors (id, name, description, source, pipedream_slug, env_keys, notes, auto_generated, created_at, updated_at)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(name) DO UPDATE SET
							description = COALESCE(excluded.description, connectors.description),
							source = COALESCE(excluded.source, connectors.source),
							pipedream_slug = COALESCE(excluded.pipedream_slug, connectors.pipedream_slug),
							env_keys = COALESCE(excluded.env_keys, connectors.env_keys),
							notes = COALESCE(excluded.notes, connectors.notes),
							updated_at = excluded.updated_at
					`)

					const { randomUUID } = await import("node:crypto")
					const now = new Date().toISOString()
					const results: string[] = []
					for (const item of items) {
						if (!item.name) continue
						const name = item.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-|-$/g, "")
						stmt.run(
							randomUUID(), name,
							item.description || null, item.source || null,
							item.pipedream_slug || null,
							item.env_keys ? JSON.stringify(item.env_keys) : null,
							item.notes || null, 0, now, now,
						)
						results.push(`${name} (${item.source || "custom"})`)
					}
					return `Created/updated ${results.length} connectors:\n${results.join("\n")}`
				},
			}),

			connector_remove: tool({
				description: "Remove one or more connectors by name.",
				args: {
					names: tool.schema.string().describe('Comma-separated names or JSON array. E.g. "github,stripe" or ["github","stripe"]'),
				},
				async execute(args: { names: string }): Promise<string> {
					let list: string[]
					try { list = JSON.parse(args.names) } catch { list = args.names.split(",").map(s => s.trim()) }
					list = list.filter(Boolean)
					if (!list.length) return "No names provided."

					const d = db()
					const stmt = d.prepare("DELETE FROM connectors WHERE name = ?")
					const removed: string[] = []
					for (const name of list) {
						const r = stmt.run(name)
						if (r.changes > 0) removed.push(name)
					}
					return removed.length ? `Removed: ${removed.join(", ")}` : "None found."
				},
			}),
		},
	}
}

export default ConnectorsPlugin
