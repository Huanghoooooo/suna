/**
 * Runtime Reload — Nuclear restart for the entire Kortix stack.
 *
 * Two modes:
 *   - "dispose-only": Hot-reload OpenCode config (agents, skills, commands, opencode.jsonc).
 *     Does NOT reload .ts plugin code (module cache persists). Fast (~2s).
 *
 *   - "full": Kill and restart EVERY process that holds code.
 *     Restarts all s6 services. Guarantees fresh module caches.
 *     Takes ~5-10s. All active sessions will be interrupted.
 *
 * s6 services (from Dockerfile / core/s6-services/):
 *   svc-opencode-serve     — OpenCode runtime (port 4096, plugins, agents, tools, web UI)
 *   svc-static-web         — Static file server (port 3211)
 *   svc-lss-sync           — Local semantic search indexer
 *   svc-kortix-master      — This process (port 8000)
 */

export type ReloadMode = 'dispose-only' | 'full'

export interface ReloadResult {
  success: boolean
  mode: ReloadMode
  steps: string[]
  errors: string[]
}

/**
 * Dispose the OpenCode instance — hot-reload config from disk.
 * Reloads: agents, skills, commands, opencode.jsonc, MCP connections.
 * Does NOT reload: .ts plugin code (module cache persists in the process).
 */
async function disposeOpenCode(result: ReloadResult): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:4096/instance/dispose', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
    })
    await res.arrayBuffer().catch(() => {})
    result.steps.push('OpenCode disposed — agents, skills, commands reloaded from disk')
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    result.errors.push(`OpenCode dispose failed: ${msg}`)
    return false
  }
}

/**
 * Restart an s6 service. s6-svc -r sends SIGTERM, waits for exit, restarts.
 * Returns immediately — s6 handles the lifecycle.
 */
function restartS6(svcName: string, result: ReloadResult): void {
  try {
    const proc = Bun.spawnSync(['s6-svc', '-r', `/run/service/${svcName}`])
    if (proc.exitCode === 0) {
      result.steps.push(`Restarted ${svcName}`)
    } else {
      // exit 111 = supervisor not running (service doesn't exist in this environment)
      result.steps.push(`${svcName}: skipped (exit ${proc.exitCode})`)
    }
  } catch {
    result.steps.push(`${svcName}: s6-svc not available (local dev?)`)
  }
}

export async function initiateRuntimeReload(mode: ReloadMode): Promise<ReloadResult> {
  const result: ReloadResult = {
    success: true,
    mode,
    steps: [],
    errors: [],
  }

  // ── dispose-only: hot-reload config without killing processes ──
  if (mode === 'dispose-only') {
    const ok = await disposeOpenCode(result)
    result.success = ok
    if (ok) result.steps.push('Note: .ts plugin code changes need Full Restart')
    return result
  }

  // ── full: kill and restart every code-holding process ──
  // s6-svc -r = SIGTERM → wait for exit → restart fresh (clean module cache)
  result.steps.push('Full restart: restarting all code-holding services via s6')

  restartS6('svc-opencode-serve', result)     // port 4096 — plugins, agents, tools
  restartS6('svc-static-web', result)         // port 3211 — static file server
  restartS6('svc-lss-sync', result)           // semantic search indexer

  result.steps.push('Restarting kortix-master last — s6 will respawn with fresh state')
  result.success = true

  // Self-restart — deferred so HTTP response goes out first
  setTimeout(() => {
    console.log('[runtime-reload] Full restart: killing kortix-master — s6 will respawn')
    try {
      Bun.spawn(['s6-svc', '-r', '/run/service/svc-kortix-master'], {
        stdout: 'inherit', stderr: 'inherit',
      })
    } catch {}
    // Fallback hard exit if s6 didn't kill us
    setTimeout(() => process.exit(0), 3000)
  }, 300)

  return result
}
