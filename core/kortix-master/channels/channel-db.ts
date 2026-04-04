/**
 * Channel DB — SQLite-backed channel configuration store.
 * Lives in .kortix/kortix.db alongside connectors, triggers, etc.
 *
 * Used by: ktelegram, kslack, kchannel CLIs, and the webhook bridges.
 */

import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import * as path from "node:path"

// ─── DB path resolution (same as connectors.ts) ─────────────────────────────

function resolveDbPath(): string {
  const root = process.env.KORTIX_WORKSPACE?.trim()
    || (process.env.OPENCODE_CONFIG_DIR?.trim()
      ? path.dirname(path.resolve(process.env.OPENCODE_CONFIG_DIR))
      : (process.env.HOME ? path.join(process.env.HOME, "") : process.cwd()))
  // Try known paths
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

export function getDb(): Database {
  if (_db) return _db
  const dbPath = resolveDbPath()
  _db = new Database(dbPath)
  _db.exec("PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000")
  _db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      name TEXT NOT NULL UNIQUE,
      enabled INTEGER DEFAULT 1,
      bot_token TEXT NOT NULL,
      signing_secret TEXT,
      webhook_secret TEXT NOT NULL,
      webhook_path TEXT NOT NULL UNIQUE,
      bot_id TEXT,
      bot_username TEXT,
      default_agent TEXT DEFAULT 'kortix',
      default_model TEXT DEFAULT 'anthropic/claude-sonnet-4-20250514',
      instructions TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  return _db
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChannelConfig {
  id: string
  platform: "telegram" | "slack"
  name: string
  enabled: boolean
  bot_token: string
  signing_secret: string | null
  webhook_secret: string
  webhook_path: string
  bot_id: string | null
  bot_username: string | null
  default_agent: string
  default_model: string
  instructions: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── Name generation ─────────────────────────────────────────────────────────

const ADJECTIVES = [
  "Atlas", "Spark", "Wave", "Pulse", "Nova", "Echo", "Bolt", "Flux",
  "Apex", "Edge", "Core", "Drift", "Haze", "Peak", "Rift", "Vibe",
  "Zeal", "Glow", "Dash", "Fuse", "Arc", "Bloom", "Crest", "Forge",
  "Nexus", "Orbit", "Prism", "Sage", "Tide", "Volt",
]

export function generateChannelName(createdBy?: string): string {
  const db = getDb()
  const existing = db.query("SELECT name FROM channels").all() as { name: string }[]
  const usedNames = new Set(existing.map(r => r.name))

  for (let i = 0; i < 100; i++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    const suffix = createdBy ? ` (by ${createdBy})` : ""
    const name = `Kortix ${adj}${suffix}`
    if (!usedNames.has(name)) return name
  }
  // Fallback with random number
  return `Kortix ${Date.now().toString(36)}${createdBy ? ` (by ${createdBy})` : ""}`
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function createChannel(opts: {
  platform: "telegram" | "slack"
  name?: string
  bot_token: string
  signing_secret?: string
  bot_id?: string
  bot_username?: string
  default_agent?: string
  default_model?: string
  instructions?: string
  created_by?: string
}): ChannelConfig {
  const db = getDb()
  const id = crypto.randomUUID()
  const name = opts.name || generateChannelName(opts.created_by)
  const webhookSecret = crypto.randomUUID().replace(/-/g, "")
  const webhookPath = `/hooks/${opts.platform}/${id}`
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO channels (id, platform, name, enabled, bot_token, signing_secret, webhook_secret, webhook_path,
      bot_id, bot_username, default_agent, default_model, instructions, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, opts.platform, name, opts.bot_token, opts.signing_secret || null,
    webhookSecret, webhookPath,
    opts.bot_id || null, opts.bot_username || null,
    opts.default_agent || "kortix", opts.default_model || "anthropic/claude-sonnet-4-20250514",
    opts.instructions || null, opts.created_by || null, now, now,
  )

  return getChannel(id)!
}

export function getChannel(id: string): ChannelConfig | null {
  const db = getDb()
  const row = db.query("SELECT * FROM channels WHERE id = ?").get(id) as any
  if (!row) return null
  return { ...row, enabled: !!row.enabled }
}

export function getChannelByPath(webhookPath: string): ChannelConfig | null {
  const db = getDb()
  const row = db.query("SELECT * FROM channels WHERE webhook_path = ?").get(webhookPath) as any
  if (!row) return null
  return { ...row, enabled: !!row.enabled }
}

export function listChannels(platform?: string): ChannelConfig[] {
  const db = getDb()
  let rows: any[]
  if (platform) {
    rows = db.query("SELECT * FROM channels WHERE platform = ? ORDER BY created_at DESC").all(platform) as any[]
  } else {
    rows = db.query("SELECT * FROM channels ORDER BY created_at DESC").all() as any[]
  }
  return rows.map(r => ({ ...r, enabled: !!r.enabled }))
}

export function updateChannel(id: string, updates: Partial<Pick<ChannelConfig,
  "name" | "enabled" | "bot_token" | "signing_secret" | "default_agent" | "default_model" | "instructions" | "bot_id" | "bot_username"
>>): ChannelConfig | null {
  const db = getDb()
  const existing = getChannel(id)
  if (!existing) return null

  const fields: string[] = ["updated_at = ?"]
  const values: any[] = [new Date().toISOString()]

  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      if (key === "enabled") {
        fields.push(`${key} = ?`)
        values.push(val ? 1 : 0)
      } else {
        fields.push(`${key} = ?`)
        values.push(val)
      }
    }
  }

  values.push(id)
  db.prepare(`UPDATE channels SET ${fields.join(", ")} WHERE id = ?`).run(...values)
  return getChannel(id)
}

export function deleteChannel(id: string): boolean {
  const db = getDb()
  const result = db.prepare("DELETE FROM channels WHERE id = ?").run(id)
  return result.changes > 0
}

export function enableChannel(id: string): ChannelConfig | null {
  return updateChannel(id, { enabled: true })
}

export function disableChannel(id: string): ChannelConfig | null {
  return updateChannel(id, { enabled: false })
}

// ─── Connector auto-registration ─────────────────────────────────────────────

export function registerConnector(channel: ChannelConfig): void {
  const db = getDb()
  // Ensure connectors table exists (normally created by connectors plugin, but we may run standalone)
  db.exec(`
    CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, source TEXT,
      pipedream_slug TEXT, env_keys TEXT, notes TEXT, auto_generated INTEGER DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `)
  const connectorName = `${channel.platform}-${channel.name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-")}`
  const description = `${channel.platform === "telegram" ? "Telegram" : "Slack"} bot @${channel.bot_username || "?"} — ${channel.name}`
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO connectors (id, name, description, source, notes, auto_generated, created_at, updated_at)
    VALUES (?, ?, ?, 'channel', ?, 1, ?, ?)
    ON CONFLICT(name) DO UPDATE SET description = excluded.description, updated_at = excluded.updated_at
  `).run(crypto.randomUUID(), connectorName, description, `Channel ID: ${channel.id}`, now, now)
}
