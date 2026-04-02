import type { OpencodeClient } from '@opencode-ai/sdk'
import { NotificationManager } from './notification-manager.ts'
import { OutputManager } from './output-manager.ts'
import { SessionLifecycleManager } from './session-lifecycle.ts'
import type { PTYSessionInfo, ReadResult, SearchResult, SpawnOptions } from './types.ts'
import { withSession } from './utils.ts'

// ── bun-pty availability probe ──────────────────────────────────────────────
// We try-catch the import so the plugin can still load and give a clear error
// at tool-call time instead of crashing the entire plugin at import.
let _bunPtyAvailable = false
let _bunPtyLoadError: string | null = null

try {
  // Dynamic require so a missing native addon doesn't kill the module graph
  const bunPty = await import('bun-pty') as any
  const Terminal = bunPty.Terminal ?? bunPty.default?.Terminal
  const bunPtyPkg = await import('bun-pty/package.json')
  const bunPtyVersion: string = bunPtyPkg.version ?? bunPtyPkg.default?.version ?? 'unknown'

  // Monkey-patch bun-pty to fix race condition in _startReadLoop
  // Temporary workaround until https://github.com/sursaone/bun-pty/pull/37 is merged
  // Softened: warn instead of hard-throw if version is newer than expected.
  const { semver } = await import('bun')
  if (semver.order(bunPtyVersion, '0.4.8') > 0) {
    console.warn(
      `[opencode-pty] bun-pty ${bunPtyVersion} is newer than 0.4.8 — monkey-patch skipped. ` +
        `If you see race conditions in _startReadLoop, remove the workaround or update the patch.`
    )
  } else if (Terminal) {
    const proto = Terminal.prototype as unknown as {
      _startReadLoop?: (...args: unknown[]) => unknown
    }
    const original = proto._startReadLoop
    if (typeof original === 'function') {
      proto._startReadLoop = async function (
        this: InstanceType<typeof Terminal>,
        ...args: unknown[]
      ) {
        await Promise.resolve() // Yield to allow event handlers to be registered
        return original.apply(this, args)
      }
    }
  }

  _bunPtyAvailable = true
  console.log(`[opencode-pty] bun-pty ${bunPtyVersion} loaded successfully`)
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  _bunPtyLoadError = msg
  _bunPtyAvailable = false
  console.error(
    `[opencode-pty] bun-pty failed to load — PTY tools will be unavailable.\n` +
      `  Error: ${msg}\n` +
      `  Platform: ${process.platform}/${process.arch}\n` +
      `  Runtime: ${typeof Bun !== 'undefined' ? `Bun ${(Bun as any).version}` : 'NOT Bun (bun-pty requires Bun!)'}\n` +
      `  Fix: cd plugin/opencode-pty && bun install`
  )
}

/** Check if bun-pty loaded successfully. Call before any PTY operation. */
export function isBunPtyAvailable(): boolean {
  return _bunPtyAvailable
}

/** If bun-pty failed to load, returns the error message. */
export function bunPtyLoadError(): string | null {
  return _bunPtyLoadError
}

// ── Session update callbacks ────────────────────────────────────────────────
type SessionUpdateCallback = (session: PTYSessionInfo) => void

export const sessionUpdateCallbacks: SessionUpdateCallback[] = []

export function registerSessionUpdateCallback(callback: SessionUpdateCallback) {
  sessionUpdateCallbacks.push(callback)
}

export function removeSessionUpdateCallback(callback: SessionUpdateCallback) {
  const index = sessionUpdateCallbacks.indexOf(callback)
  if (index !== -1) {
    sessionUpdateCallbacks.splice(index, 1)
  }
}

function notifySessionUpdate(session: PTYSessionInfo) {
  for (const callback of sessionUpdateCallbacks) {
    try {
      callback(session)
    } catch {
      // Ignore callback errors
    }
  }
}

// ── Raw output callbacks ────────────────────────────────────────────────────
type RawOutputCallback = (session: PTYSessionInfo, rawData: string) => void

export const rawOutputCallbacks: RawOutputCallback[] = []

export function registerRawOutputCallback(callback: RawOutputCallback): void {
  rawOutputCallbacks.push(callback)
}

export function removeRawOutputCallback(callback: RawOutputCallback): void {
  const index = rawOutputCallbacks.indexOf(callback)
  if (index !== -1) {
    rawOutputCallbacks.splice(index, 1)
  }
}

function notifyRawOutput(session: PTYSessionInfo, rawData: string): void {
  for (const callback of rawOutputCallbacks) {
    try {
      callback(session, rawData)
    } catch {
      // Ignore callback errors
    }
  }
}

// ── PTY Manager ─────────────────────────────────────────────────────────────
class PTYManager {
  private lifecycleManager = new SessionLifecycleManager()
  private outputManager = new OutputManager()
  private notificationManager = new NotificationManager()

  init(client: OpencodeClient): void {
    this.notificationManager.init(client)
  }

  clearAllSessions(): void {
    this.lifecycleManager.clearAllSessions()
  }

  async spawn(opts: SpawnOptions): Promise<PTYSessionInfo> {
    if (!_bunPtyAvailable) {
      throw new Error(
        `[PTY manager] Cannot spawn: bun-pty is not available. Load error: ${_bunPtyLoadError ?? 'unknown'}`
      )
    }

    try {
      const session = await this.lifecycleManager.spawn(
        opts,
        (session, data) => {
          notifyRawOutput(this.lifecycleManager.toInfo(session), data)
        },
        async (session, exitCode) => {
          notifySessionUpdate(this.lifecycleManager.toInfo(session))
          if (session?.notifyOnExit) {
            await this.notificationManager.sendExitNotification(session, exitCode || 0)
          }
        }
      )
      notifySessionUpdate(session)
      return session
    } catch (err: unknown) {
      // Add manager-level context if not already a PTY diagnostic
      if (err instanceof Error && err.message.includes('[PTY spawn')) {
        throw err // Already has rich diagnostics
      }
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `[PTY manager] spawn failed for "${opts.command} ${(opts.args ?? []).join(' ')}": ${msg}`
      )
    }
  }

  write(id: string, data: string): boolean {
    return withSession(
      this.lifecycleManager,
      id,
      (session) => this.outputManager.write(session, data),
      false
    )
  }

  read(id: string, offset: number = 0, limit?: number): ReadResult | null {
    return withSession(
      this.lifecycleManager,
      id,
      (session) => this.outputManager.read(session, offset, limit),
      null
    )
  }

  search(id: string, pattern: RegExp, offset: number = 0, limit?: number): SearchResult | null {
    return withSession(
      this.lifecycleManager,
      id,
      (session) => this.outputManager.search(session, pattern, offset, limit),
      null
    )
  }

  list(): PTYSessionInfo[] {
    return this.lifecycleManager.listSessions().map((s) => this.lifecycleManager.toInfo(s))
  }

  get(id: string): PTYSessionInfo | null {
    return withSession(
      this.lifecycleManager,
      id,
      (session) => this.lifecycleManager.toInfo(session),
      null
    )
  }

  getRawBuffer(id: string): { raw: string; byteLength: number } | null {
    return withSession(
      this.lifecycleManager,
      id,
      (session) => ({
        raw: session.buffer.readRaw(),
        byteLength: session.buffer.byteLength,
      }),
      null
    )
  }

  kill(id: string, cleanup: boolean = false): boolean {
    return this.lifecycleManager.kill(id, cleanup)
  }

  cleanupBySession(parentSessionId: string): void {
    this.lifecycleManager.cleanupBySession(parentSessionId)
  }
}

export const manager = new PTYManager()

export function initManager(opcClient: OpencodeClient): void {
  manager.init(opcClient)
}
