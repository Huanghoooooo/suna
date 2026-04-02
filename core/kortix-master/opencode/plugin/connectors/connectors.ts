/**
 * Kortix Connectors Plugin — SQLite-backed.
 * Single source of truth in .kortix/kortix.db connectors table.
 *
 * Tools: connector_list, connector_get, connector_setup
 */

import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { type Plugin, tool } from "@opencode-ai/plugin"

function resolveDbPath(): string {
	const root = process.env.KORTIX_WORKSPACE?.trim()
		|| (process.env.OPENCODE_CONFIG_DIR?.trim()
			? path.dirname(path.resolve(process.env.OPENCODE_CONFIG_DIR))
			: process.cwd())
	const dbDir = path.join(root, ".kortix")
	mkdirSync(dbDir, { recursive: true })
	return path.join(dbDir, "kortix.db")
}

let _db: Database | null = null

function db(): Database {
	if (_db) return _db
	_db = new Database(resolveDbPath())
	_db.exec("PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000")
	_db.exec(`
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
	return _db
}

interface Row {
	name: string; description: string | null; source: string | null
	pipedream_slug: string | null; env_keys: string | null; notes: string | null
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
					let rows = db().query("SELECT * FROM connectors ORDER BY name").all() as Row[]
					for (const discovered of discoverFileConnectors()) {
						if (!rows.some((r) => r.name === discovered.name)) rows.push(discovered)
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
					let row = db().query("SELECT * FROM connectors WHERE name = ? OR name LIKE ?").get(args.name, `%${args.name}%`) as Row | null
					if (!row) {
						row = discoverFileConnectors().find((r) => r.name === args.name || r.name.includes(args.name)) ?? null
					}
					if (!row) {
						const all = (db().query("SELECT name FROM connectors ORDER BY name").all() as { name: string }[]).map(r => r.name)
						return `Not found: "${args.name}". Available: ${all.join(", ") || "none"}`
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
