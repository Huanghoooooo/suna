import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

/**
 * Tests for the share route (GET /kortix/share/:port).
 *
 * Now creates token-based short-lived share URLs with TTL.
 * Imports the real route module to test actual behavior.
 */

const ENV_KEYS = [
  'ENV_MODE', 'JUSTAVPS_SLUG', 'JUSTAVPS_PROXY_TOKEN', 'JUSTAVPS_PROXY_DOMAIN',
  'SANDBOX_ID', 'KORTIX_API_URL', 'SANDBOX_PORT_MAP', 'SHARE_STORE_PATH',
]
const savedEnv: Record<string, string | undefined> = {}

function saveEnv() { for (const k of ENV_KEYS) savedEnv[k] = process.env[k] }
function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}
function clearEnv() { for (const k of ENV_KEYS) delete process.env[k] }

describe('GET /kortix/share/:port (token-based)', () => {
  let shareRouter: any
  let Hono: any

  beforeEach(async () => {
    saveEnv()
    clearEnv()
    // Use temp path so tests don't interfere with real store
    process.env.SHARE_STORE_PATH = `/tmp/test-shares-${Date.now()}.json`
    // Re-import to get fresh module
    const { Hono: H } = await import('hono')
    Hono = H
    shareRouter = (await import('../../src/routes/share')).default
  })

  afterEach(() => {
    restoreEnv()
  })

  function buildApp() {
    const app = new Hono()
    app.route('/kortix/share', shareRouter)
    return app
  }

  // ── Creates share with token ──────────────────────────────────────────

  it('returns a share with token, url, expiresAt, ttl', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/3000')

    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.port).toBe(3000)
    expect(body.token).toBeTruthy()
    expect(body.url).toContain('/s/')
    expect(body.url).toContain(body.token)
    expect(body.expiresAt).toBeTruthy()
    expect(body.ttl).toBe('1h') // default
  })

  it('default TTL is 1 hour', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/3000')
    const body = await res.json() as any

    const expires = new Date(body.expiresAt).getTime()
    const now = Date.now()
    const diff = expires - now
    // Should be ~1 hour (3600000ms), allow 5s tolerance
    expect(diff).toBeGreaterThan(3_595_000)
    expect(diff).toBeLessThan(3_605_000)
  })

  // ── Custom TTL ────────────────────────────────────────────────────────

  it('accepts ?ttl=30m', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/3000?ttl=30m')
    const body = await res.json() as any

    expect(body.ttl).toBe('30m')
  })

  it('accepts ?ttl=2h', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/3000?ttl=2h')
    const body = await res.json() as any

    expect(body.ttl).toBe('2h')
  })

  it('rejects TTL below minimum (5m)', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/3000?ttl=1s')

    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('short')
  })

  it('rejects TTL above maximum (365d)', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/3000?ttl=400d')

    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('long')
  })

  it('rejects invalid TTL format', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/3000?ttl=banana')

    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('Invalid TTL')
  })

  // ── Optional label ────────────────────────────────────────────────────

  it('accepts ?label=demo', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/3000?label=demo')
    const body = await res.json() as any

    expect(body.label).toBe('demo')
  })

  // ── Long TTL hint ─────────────────────────────────────────────────────

  it('adds hint for TTL > 24h', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/3000?ttl=2d')
    const body = await res.json() as any

    expect(body.hint).toContain('deploy')
  })

  it('no hint for TTL <= 24h', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/3000?ttl=1h')
    const body = await res.json() as any

    expect(body.hint).toBeUndefined()
  })

  // ── URL construction ──────────────────────────────────────────────────

  it('cloud mode: URL goes through port 8000 CF Worker with __proxy_token', async () => {
    process.env.ENV_MODE = 'cloud'
    process.env.JUSTAVPS_SLUG = 'abc123'
    process.env.JUSTAVPS_PROXY_TOKEN = 'tok_xyz'

    const app = buildApp()
    const res = await app.request('/kortix/share/3000')
    const body = await res.json() as any

    expect(body.url).toContain('8000--abc123.kortix.cloud')
    expect(body.url).toContain('__proxy_token=tok_xyz')
    expect(body.url).toContain('/s/')
  })

  it('local mode: URL is localhost', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/3000')
    const body = await res.json() as any

    expect(body.url).toContain('localhost')
    expect(body.url).toContain('/s/')
  })

  // ── Validation ────────────────────────────────────────────────────────

  it('returns 400 for port 0', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/0')
    expect(res.status).toBe(400)
  })

  it('returns 400 for port 99999', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/99999')
    expect(res.status).toBe(400)
  })

  // ── List shares ───────────────────────────────────────────────────────

  it('GET /kortix/share lists active shares', async () => {
    const app = buildApp()
    await app.request('/kortix/share/3000')
    await app.request('/kortix/share/5000')

    const res = await app.request('/kortix/share')
    const body = await res.json() as any

    expect(body.count).toBeGreaterThanOrEqual(2)
    expect(body.shares.length).toBeGreaterThanOrEqual(2)
  })

  // ── Delete share ──────────────────────────────────────────────────────

  it('DELETE /kortix/share/:token revokes a share', async () => {
    const app = buildApp()
    const createRes = await app.request('/kortix/share/3000')
    const { token } = await createRes.json() as any

    const delRes = await app.request(`/kortix/share/${token}`, { method: 'DELETE' })
    expect(delRes.status).toBe(200)

    // Should no longer appear in list
    const listRes = await app.request('/kortix/share')
    const { shares } = await listRes.json() as any
    expect(shares.some((s: any) => s.token === token)).toBe(false)
  })

  it('DELETE unknown token returns 404', async () => {
    const app = buildApp()
    const res = await app.request('/kortix/share/nonexistent', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})
