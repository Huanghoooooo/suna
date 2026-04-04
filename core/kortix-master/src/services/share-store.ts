/**
 * Share Store — manages short-lived public URL share tokens.
 *
 * Each share maps a random token → { port, expiresAt }.
 * Tokens are validated by the /s/:token/* proxy route.
 *
 * Storage: in-memory Map + persisted to disk so shares survive master restarts.
 * Expired shares are pruned on read and periodically.
 *
 * TTL defaults:
 *   - Default: 1 hour
 *   - Min: 5 minutes
 *   - Max: 7 days (168 hours)
 */

import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ShareEntry {
  token: string
  port: number
  createdAt: string  // ISO 8601
  expiresAt: string  // ISO 8601
  label?: string     // optional human-readable label
}

// ── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_TTL_MS = 60 * 60 * 1000           // 1 hour
export const MIN_TTL_MS = 5 * 60 * 1000                 // 5 minutes
export const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000       // 7 days

const PERSIST_PATH = process.env.SHARE_STORE_PATH || '/workspace/.kortix/shares.json'
const PRUNE_INTERVAL_MS = 5 * 60 * 1000  // prune every 5 min
const TOKEN_BYTES = 24  // 32 chars base64url

// ── Store ───────────────────────────────────────────────────────────────────

const shares = new Map<string, ShareEntry>()
let pruneTimer: ReturnType<typeof setInterval> | null = null

// ── TTL parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a human-readable TTL string into milliseconds.
 * Supports: "30m", "2h", "1d", "90s", "1h30m", or plain number (seconds).
 * Returns null if invalid.
 */
export function parseTTL(input: string): number | null {
  if (!input) return null

  // Plain number → treat as seconds
  const asNum = Number(input)
  if (!isNaN(asNum) && asNum > 0) return asNum * 1000

  let total = 0
  const regex = /(\d+(?:\.\d+)?)\s*(s|m|h|d)/gi
  let match: RegExpExecArray | null
  let matched = false

  while ((match = regex.exec(input)) !== null) {
    matched = true
    const val = parseFloat(match[1])
    switch (match[2].toLowerCase()) {
      case 's': total += val * 1000; break
      case 'm': total += val * 60 * 1000; break
      case 'h': total += val * 60 * 60 * 1000; break
      case 'd': total += val * 24 * 60 * 60 * 1000; break
    }
  }

  return matched && total > 0 ? total : null
}

/**
 * Clamp a TTL in milliseconds to the allowed range.
 * Returns the clamped value.
 */
export function clampTTL(ms: number): number {
  return Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, ms))
}

// ── Core operations ─────────────────────────────────────────────────────────

function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

function isExpired(entry: ShareEntry): boolean {
  return new Date(entry.expiresAt).getTime() <= Date.now()
}

/**
 * Create a new share for a port.
 *
 * @param port - Container port to share
 * @param ttlMs - Time-to-live in milliseconds (clamped to min/max)
 * @param label - Optional human-readable label
 * @returns The created share entry
 */
export function createShare(port: number, ttlMs: number = DEFAULT_TTL_MS, label?: string): ShareEntry {
  const clamped = clampTTL(ttlMs)
  const now = new Date()
  const entry: ShareEntry = {
    token: generateToken(),
    port,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + clamped).toISOString(),
    ...(label ? { label } : {}),
  }

  shares.set(entry.token, entry)
  persistSync()
  return entry
}

/**
 * Validate a share token. Returns the entry if valid and not expired, null otherwise.
 * Automatically prunes expired entries on access.
 */
export function validateShare(token: string): ShareEntry | null {
  const entry = shares.get(token)
  if (!entry) return null

  if (isExpired(entry)) {
    shares.delete(token)
    return null
  }

  return entry
}

/**
 * Revoke a share by token.
 */
export function revokeShare(token: string): boolean {
  const existed = shares.delete(token)
  if (existed) persistSync()
  return existed
}

/**
 * List all active (non-expired) shares, optionally filtered by port.
 */
export function listShares(port?: number): ShareEntry[] {
  pruneExpired()
  const all = Array.from(shares.values())
  return port !== undefined ? all.filter(e => e.port === port) : all
}

/**
 * Revoke all shares for a given port.
 */
export function revokeSharesForPort(port: number): number {
  let count = 0
  for (const [token, entry] of shares) {
    if (entry.port === port) {
      shares.delete(token)
      count++
    }
  }
  if (count > 0) persistSync()
  return count
}

// ── Pruning ─────────────────────────────────────────────────────────────────

function pruneExpired(): number {
  let pruned = 0
  for (const [token, entry] of shares) {
    if (isExpired(entry)) {
      shares.delete(token)
      pruned++
    }
  }
  if (pruned > 0) persistSync()
  return pruned
}

// ── Persistence ─────────────────────────────────────────────────────────────

function persistSync(): void {
  try {
    mkdirSync(dirname(PERSIST_PATH), { recursive: true })
    const data = Array.from(shares.values())
    writeFileSync(PERSIST_PATH, JSON.stringify(data, null, 2))
  } catch (err) {
    // Non-fatal — shares still work in-memory
    console.warn('[share-store] persist failed:', err instanceof Error ? err.message : err)
  }
}

function loadFromDisk(): void {
  try {
    const raw = readFileSync(PERSIST_PATH, 'utf-8')
    const data: ShareEntry[] = JSON.parse(raw)
    for (const entry of data) {
      if (!isExpired(entry)) {
        shares.set(entry.token, entry)
      }
    }
    if (data.length > 0) {
      const active = shares.size
      console.log(`[share-store] Loaded ${active} active share(s) from disk (${data.length - active} expired)`)
    }
  } catch {
    // File doesn't exist yet — that's fine
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

export function initShareStore(): void {
  loadFromDisk()
  if (!pruneTimer) {
    pruneTimer = setInterval(pruneExpired, PRUNE_INTERVAL_MS)
    // Don't prevent process exit
    if (pruneTimer.unref) pruneTimer.unref()
  }
}

export function stopShareStore(): void {
  if (pruneTimer) {
    clearInterval(pruneTimer)
    pruneTimer = null
  }
}

/**
 * Format a TTL in milliseconds as a human-readable string.
 */
export function formatTTL(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1).replace(/\.0$/, '')}h`
  return `${(ms / 86_400_000).toFixed(1).replace(/\.0$/, '')}d`
}
