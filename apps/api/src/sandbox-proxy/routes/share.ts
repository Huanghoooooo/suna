/**
 * Public URL Share Endpoint — POST /v1/p/share
 *
 * Proxies to the sandbox's /kortix/share/:port endpoint to create a
 * token-based, time-limited share URL. This lets the frontend or external
 * callers create share links without being inside the sandbox.
 *
 * Body: { sandbox_id, port, ttl? }
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

    // Resolve the sandbox to find how to reach it
    const resolved = await resolveProvider(sandbox_id)
    if (!resolved) {
      return c.json({ error: 'Sandbox not found or not active' }, 404)
    }

    // Build the URL to the sandbox's /kortix/share/:port endpoint
    let sandboxUrl: string
    const queryParams = new URLSearchParams()
    if (ttl) queryParams.set('ttl', ttl)
    if (label) queryParams.set('label', label)
    const qs = queryParams.toString() ? `?${queryParams.toString()}` : ''

    if (resolved.provider === 'justavps' && resolved.slug && resolved.proxyToken) {
      const domain = config.JUSTAVPS_PROXY_DOMAIN
      sandboxUrl = `https://8000--${resolved.slug}.${domain}/kortix/share/${port}${qs}`
    } else if (resolved.baseUrl) {
      sandboxUrl = `${resolved.baseUrl}/kortix/share/${port}${qs}`
    } else {
      return c.json({ error: 'Cannot reach sandbox' }, 502)
    }

    // Forward the request to the sandbox
    try {
      const headers: Record<string, string> = {}
      if (resolved.serviceKey) {
        headers['Authorization'] = `Bearer ${resolved.serviceKey}`
      }
      if (resolved.proxyToken) {
        headers['X-Proxy-Token'] = resolved.proxyToken
      }

      const resp = await fetch(sandboxUrl, {
        headers,
        signal: AbortSignal.timeout(10_000),
      })

      const result = await resp.json() as Record<string, unknown>

      if (!resp.ok) {
        return c.json(result, resp.status as any)
      }

      if (resolved.provider === 'local_docker') {
        const hostPort = (() => {
          try {
            const parsed = new URL(resolved.baseUrl)
            return Number(parsed.port || '14000')
          } catch {
            return 14000
          }
        })()
        const publicBaseUrl = await ensureLocalTunnel(hostPort)
        await syncSandboxPublicBase(resolved.baseUrl, resolved.serviceKey, publicBaseUrl)
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

export { shareApp }
