/**
 * Public URL Share Endpoints — /v1/p/share
 *
 * Proxies to the sandbox's /kortix/share endpoints so the frontend can create,
 * list, and revoke share links without talking to the sandbox directly.
 *
 * Routes:
 * - POST   /v1/p/share        body: { sandbox_id, port, ttl?, label? }
 * - GET    /v1/p/share        query: sandbox_id
 * - DELETE /v1/p/share/:token query: sandbox_id
 *
 * Auth: combinedAuth (Supabase JWT, kortix_ token, or cookie).
 */

import { Hono } from 'hono'
import { execSync, spawn } from 'child_process'
import { config } from '../../config'
import { resolveProvider } from '../index'
import { combinedAuth } from '../../middleware/auth'

const shareApp = new Hono()

type NgrokTunnel = {
  name: string
  public_url: string
  proto: string
  config?: { addr?: string }
}

const NGROK_API_PORTS = [4040, 4041, 4042]
const LOCAL_SHARE_TUNNEL_NAME = 'kortix-share'
type ResolvedProvider = NonNullable<Awaited<ReturnType<typeof resolveProvider>>>

function isNgrokInstalled(): boolean {
  try {
    execSync('which ngrok', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

async function probeNgrokApi(apiPort: number): Promise<{ tunnels: NgrokTunnel[]; apiPort: number } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/tunnels`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return null
    const data = await res.json() as { tunnels: NgrokTunnel[] }
    return { tunnels: data.tunnels, apiPort }
  } catch {
    return null
  }
}

async function findNgrokAgent(): Promise<{ tunnels: NgrokTunnel[]; apiPort: number } | null> {
  const results = await Promise.all(NGROK_API_PORTS.map(probeNgrokApi))
  return results.find((r): r is NonNullable<typeof r> => r !== null) ?? null
}

function findTunnelForPort(tunnels: NgrokTunnel[], port: number): NgrokTunnel | undefined {
  return tunnels.find((t) => {
    const addr = t.config?.addr || ''
    const match = addr.match(/:(\d+)$/)
    return match && Number(match[1]) === port
  })
}

async function ensureLocalTunnel(hostPort: number): Promise<string> {
  const agent = await findNgrokAgent()

  if (agent) {
    const existing = findTunnelForPort(agent.tunnels, hostPort)
    if (existing) return existing.public_url.replace(/\/+$/, '')

    const res = await fetch(`http://127.0.0.1:${agent.apiPort}/api/tunnels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: LOCAL_SHARE_TUNNEL_NAME, proto: 'http', addr: String(hostPort) }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Failed to add ngrok tunnel (${res.status}): ${text.slice(0, 300)}`)
    }
    const created = await res.json() as NgrokTunnel
    return created.public_url.replace(/\/+$/, '')
  }

  if (!isNgrokInstalled()) {
    throw new Error('ngrok is not installed')
  }

  const ngrokProc = spawn('ngrok', ['http', String(hostPort)], {
    stdio: 'ignore',
    detached: true,
  })
  ngrokProc.unref()

  for (let i = 0; i < 25; i += 1) {
    const found = await findNgrokAgent()
    const tunnel = found ? findTunnelForPort(found.tunnels, hostPort) : null
    if (tunnel) return tunnel.public_url.replace(/\/+$/, '')
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`ngrok tunnel for port ${hostPort} was not detected in time`)
}

async function syncSandboxPublicBase(resolvedBaseUrl: string, serviceKey: string, publicBaseUrl: string): Promise<void> {
  if (!serviceKey) return
  await fetch(`${resolvedBaseUrl}/env`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ keys: { PUBLIC_BASE_URL: publicBaseUrl } }),
    signal: AbortSignal.timeout(10_000),
  })
}

function buildSharedUrl(baseUrl: string, token: string): string {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  base.pathname = `/s/${token}/`
  return base.toString()
}

function buildSandboxShareBaseUrl(resolved: ResolvedProvider): string | null {
  if (resolved.provider === 'justavps' && resolved.slug && resolved.proxyToken) {
    const domain = config.JUSTAVPS_PROXY_DOMAIN
    return `https://8000--${resolved.slug}.${domain}/kortix/share`
  }
  if (resolved.baseUrl) {
    return `${resolved.baseUrl}/kortix/share`
  }
  return null
}

function buildSandboxHeaders(resolved: ResolvedProvider): Record<string, string> {
  const headers: Record<string, string> = {}
  if (resolved.serviceKey) {
    headers.Authorization = `Bearer ${resolved.serviceKey}`
  }
  if (resolved.proxyToken) {
    headers['X-Proxy-Token'] = resolved.proxyToken
  }
  return headers
}

async function parseJsonResponse(resp: Response): Promise<Record<string, unknown>> {
  const text = await resp.text().catch(() => '')
  if (!text) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { error: text.slice(0, 500) }
  }
}

async function resolveShareTarget(sandboxId: string): Promise<{
  resolved: ResolvedProvider
  sandboxShareBaseUrl: string
} | {
  error: string
  status: number
}> {
  const resolved = await resolveProvider(sandboxId)
  if (!resolved) {
    return { error: 'Sandbox not found or not active', status: 404 }
  }

  const sandboxShareBaseUrl = buildSandboxShareBaseUrl(resolved)
  if (!sandboxShareBaseUrl) {
    return { error: 'Cannot reach sandbox', status: 502 }
  }

  return { resolved, sandboxShareBaseUrl }
}

shareApp.post('/',
  combinedAuth,
  async (c) => {
    let body: { sandbox_id: string; port: number; ttl?: string; label?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const { sandbox_id, port, ttl, label } = body
    if (!sandbox_id || typeof sandbox_id !== 'string') {
      return c.json({ error: 'sandbox_id is required (string)' }, 400)
    }
    if (!port || typeof port !== 'number' || port < 1 || port > 65535) {
      return c.json({ error: 'port is required (1-65535)' }, 400)
    }

    const target = await resolveShareTarget(sandbox_id)
    if ('error' in target) {
      return c.json({ error: target.error }, target.status as any)
    }

    const queryParams = new URLSearchParams()
    if (ttl) queryParams.set('ttl', ttl)
    if (label) queryParams.set('label', label)
    const qs = queryParams.toString() ? `?${queryParams.toString()}` : ''
    const sandboxUrl = `${target.sandboxShareBaseUrl}/${port}${qs}`

    // Forward the request to the sandbox
    try {
      const resp = await fetch(sandboxUrl, {
        headers: buildSandboxHeaders(target.resolved),
        signal: AbortSignal.timeout(10_000),
      })

      const result = await parseJsonResponse(resp)

      if (!resp.ok) {
        return c.json(result, resp.status as any)
      }

      if (target.resolved.provider === 'local_docker') {
        const hostPort = (() => {
          try {
            const parsed = new URL(target.resolved.baseUrl)
            return Number(parsed.port || '14000')
          } catch {
            return 14000
          }
        })()
        const publicBaseUrl = await ensureLocalTunnel(hostPort)
        await syncSandboxPublicBase(target.resolved.baseUrl, target.resolved.serviceKey, publicBaseUrl)
        if (typeof result.token === 'string') {
          result.url = buildSharedUrl(publicBaseUrl, result.token)
        }
      }

      return c.json(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: 'Failed to create share link', details: msg }, 502)
    }
  },
)

shareApp.get('/', combinedAuth, async (c) => {
  const sandbox_id = c.req.query('sandbox_id')
  if (!sandbox_id || typeof sandbox_id !== 'string') {
    return c.json({ error: 'sandbox_id is required (string)' }, 400)
  }

  const target = await resolveShareTarget(sandbox_id)
  if ('error' in target) {
    return c.json({ error: target.error }, target.status as any)
  }

  try {
    const resp = await fetch(target.sandboxShareBaseUrl, {
      headers: buildSandboxHeaders(target.resolved),
      signal: AbortSignal.timeout(10_000),
    })
    const result = await parseJsonResponse(resp)
    return c.json(result, resp.status as any)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: 'Failed to load share links', details: msg }, 502)
  }
})

shareApp.delete('/:token', combinedAuth, async (c) => {
  const sandbox_id = c.req.query('sandbox_id')
  if (!sandbox_id || typeof sandbox_id !== 'string') {
    return c.json({ error: 'sandbox_id is required (string)' }, 400)
  }

  const token = c.req.param('token')
  if (!token) {
    return c.json({ error: 'token is required' }, 400)
  }

  const target = await resolveShareTarget(sandbox_id)
  if ('error' in target) {
    return c.json({ error: target.error }, target.status as any)
  }

  try {
    const resp = await fetch(`${target.sandboxShareBaseUrl}/${encodeURIComponent(token)}`, {
      method: 'DELETE',
      headers: buildSandboxHeaders(target.resolved),
      signal: AbortSignal.timeout(10_000),
    })
    const result = await parseJsonResponse(resp)
    return c.json(result, resp.status as any)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: 'Failed to revoke share link', details: msg }, 502)
  }
})

export { shareApp }
