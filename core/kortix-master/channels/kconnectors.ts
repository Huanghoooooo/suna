#!/usr/bin/env bun
/**
 * kconnectors — Connector management CLI.
 *
 * Usage:
 *   kconnectors list [--filter <text>]     List all connectors
 *   kconnectors get <name>                 Get connector details
 *   kconnectors add <json>                 Create/update (JSON array or single object)
 *   kconnectors remove <name> [<name>...]  Delete by name
 *   kconnectors help                       Show usage
 *
 * Output: JSON always.
 */

import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { randomUUID } from "node:crypto"

// ─── JSON output ─────────────────────────────────────────────────────────────

function out(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

// ─── Argument parsing (same pattern as kchannel.ts) ──────────────────────────

function parseArgs(argv: string[]): { command: string; args: string[]; flags: Record<string, string> } {
  const all = argv.slice(2)
  const command = all[0] ?? "help"
  const args: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 1; i < all.length; i++) {
    const a = all[i]!
    if (a.startsWith("--")) {
      const key = a.slice(2)
      const val = all[i + 1] && !all[i + 1]!.startsWith("--") ? all[++i]! : "true"
      flags[key] = val
    } else {
      args.push(a)
    }
  }
  return { command, args, flags }
}

// ─── DB path resolution (same as channel-db.ts) ─────────────────────────────

function resolveDbPath(): string {
  const root = process.env.KORTIX_WORKSPACE?.trim()
    || (process.env.OPENCODE_CONFIG_DIR?.trim()
      ? path.dirname(path.resolve(process.env.OPENCODE_CONFIG_DIR))
      : (process.env.HOME ? path.join(process.env.HOME, "") : process.cwd()))
  for (const candidate of [
    path.join(root, ".kortix", "kortix.db"),
    "/workspace/.kortix/kortix.db",
  ]) {
    const dir = path.dirname(candidate)
    if (existsSync(dir)) return candidate
  }
  const dbDir = path.join(root, ".kortix")
  mkdirSync(dbDir, { recursive: true })
  return path.join(dbDir, "kortix.db")
}

let _db: Database | null = null

function getDb(): Database {
  if (_db) return _db
  const dbPath = resolveDbPath()
  _db = new Database(dbPath)
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConnectorRow {
  id: string
  name: string
  description: string | null
  source: string | null
  pipedream_slug: string | null
  env_keys: string | null
  notes: string | null
  auto_generated: number
  created_at: string
  updated_at: string
}

// ─── File-based connector discovery ──────────────────────────────────────────

function resolveConnectorRoot(): string | null {
  // Check KORTIX_WORKSPACE first — that's where runtime data lives in the sandbox
  const workspace = process.env.KORTIX_WORKSPACE?.trim()
  if (workspace) {
    const wsPath = path.join(path.resolve(workspace), ".opencode", "connectors")
    if (existsSync(wsPath)) return wsPath
  }
  const explicit = process.env.OPENCODE_CONFIG_DIR?.trim()
  if (explicit) {
    const cfgPath = path.join(path.resolve(explicit), "connectors")
    if (existsSync(cfgPath)) return cfgPath
  }
  // Fallback: check both, return whichever exists
  if (workspace) return path.join(path.resolve(workspace), ".opencode", "connectors")
  return path.join(process.cwd(), ".opencode", "connectors")
}

interface FileConnector {
  name: string
  description: string | null
  source: string | null
  pipedream_slug: string | null
}

function discoverFileConnectors(): FileConnector[] {
  const root = resolveConnectorRoot()
  if (!root || !existsSync(root)) return []
  const rows: FileConnector[] = []
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
    })
  }
  return rows
}

// ─── Format helper ───────────────────────────────────────────────────────────

function formatRow(r: ConnectorRow): any {
  return {
    name: r.name,
    description: r.description,
    source: r.source,
    pipedream_slug: r.pipedream_slug,
    env_keys: r.env_keys ? JSON.parse(r.env_keys) : null,
    notes: r.notes,
    auto_generated: !!r.auto_generated,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function formatFileConnector(fc: FileConnector): any {
  return {
    name: fc.name,
    description: fc.description,
    source: fc.source ?? "file",
    pipedream_slug: fc.pipedream_slug,
    env_keys: null,
    notes: null,
    auto_generated: false,
    created_at: null,
    updated_at: null,
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { command, args, flags } = parseArgs(process.argv)

  switch (command) {
    case "list": case "ls": {
      const db = getDb()
      let rows = db.query("SELECT * FROM connectors ORDER BY name").all() as ConnectorRow[]
      const formatted = rows.map(formatRow)

      // Merge file-based connectors not already in DB
      const dbNames = new Set(rows.map(r => r.name))
      for (const fc of discoverFileConnectors()) {
        if (!dbNames.has(fc.name)) {
          formatted.push(formatFileConnector(fc))
        }
      }

      // Sort merged list
      formatted.sort((a: any, b: any) => a.name.localeCompare(b.name))

      // Apply filter
      const f = flags.filter?.toLowerCase().trim()
      let result = formatted
      if (f && f !== "all" && f !== "*") {
        result = formatted.filter((r: any) =>
          r.name?.toLowerCase().includes(f) ||
          r.source?.toLowerCase().includes(f) ||
          r.description?.toLowerCase().includes(f)
        )
      }

      out({ ok: true, connectors: result })
      break
    }

    case "get": case "info": {
      const name = args[0]
      if (!name) { out({ ok: false, error: "Connector name required" }); process.exit(1) }
      const db = getDb()
      const row = db.query("SELECT * FROM connectors WHERE name = ?").get(name) as ConnectorRow | null
      if (!row) {
        // Try fuzzy match
        const fuzzy = db.query("SELECT * FROM connectors WHERE name LIKE ?").get(`%${name}%`) as ConnectorRow | null
        if (fuzzy) {
          out({ ok: true, connector: formatRow(fuzzy) })
          break
        }
        out({ ok: false, error: `Connector "${name}" not found` })
        process.exit(1)
      }
      out({ ok: true, connector: formatRow(row) })
      break
    }

    case "add": case "create": case "upsert": {
      const jsonStr = args[0]
      if (!jsonStr) { out({ ok: false, error: "JSON argument required" }); process.exit(1) }

      let items: Array<Record<string, any>>
      try {
        const parsed = JSON.parse(jsonStr)
        items = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        out({ ok: false, error: "Invalid JSON" })
        process.exit(1)
      }

      if (!items.length) { out({ ok: false, error: "Empty array" }); process.exit(1) }

      const db = getDb()
      const stmt = db.prepare(`
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
        results.push(name)
      }
      out({ ok: true, created: results.length, connectors: results })
      break
    }

    case "remove": case "rm": case "delete": {
      if (!args.length) { out({ ok: false, error: "At least one connector name required" }); process.exit(1) }
      const db = getDb()
      const stmt = db.prepare("DELETE FROM connectors WHERE name = ?")
      const removed: string[] = []
      for (const name of args) {
        const r = stmt.run(name)
        if (r.changes > 0) removed.push(name)
      }
      out({ ok: true, removed })
      break
    }

    case "help":
    default:
      console.log(`
kconnectors — Connector Management

Commands:
  list [--filter <text>]     List all connectors (DB + file-based)
  get <name>                 Get connector details
  add <json>                 Create/update (JSON array or single object)
  remove <name> [<name>...]  Delete by name
  help                       Show this help
`)
      break
  }
}

main().catch((err) => {
  out({ ok: false, error: err instanceof Error ? err.message : String(err) })
  process.exit(1)
})
