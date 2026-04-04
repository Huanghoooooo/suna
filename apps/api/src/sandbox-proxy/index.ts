import { Hono } from 'hono';
import { eq, and, ne } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { config } from '../config';
import { combinedAuth } from '../middleware/auth';
import { preview, proxyToDaytona } from './routes/preview';
import { proxyToSandbox } from './routes/local-preview';
import { getAuthToken } from './routes/auth';
import { shareApp } from './routes/share';
import { db } from '../shared/db';

const sandboxProxyApp = new Hono();

// ── Cookie auth endpoint ────────────────────────────────────────────────────
// POST /v1/p/auth — validates JWT and sets __preview_session cookie.
sandboxProxyApp.route('/auth', getAuthToken);

// ── Public URL share endpoint ───────────────────────────────────────────────
// POST /v1/p/share — returns a shareable URL for a sandbox port.
sandboxProxyApp.route('/share', shareApp);

// ── Path-based proxy ────────────────────────────────────────────────────────
// Auth middleware for both modes (Supabase JWT, kortix_ tokens, cookies).
sandboxProxyApp.use('/:sandboxId/:port/*', combinedAuth);
sandboxProxyApp.use('/:sandboxId/:port', combinedAuth);

// ── Provider cache ──────────────────────────────────────────────────────────
// Cache sandbox provider lookups to avoid a DB query on every request.
// Key: externalId, Value: { provider, expiresAt }
type CachedProviderName = 'daytona' | 'local_docker' | 'justavps';
interface ProviderCacheEntry {
  provider: CachedProviderName;
  baseUrl: string;
  serviceKey: string;
  proxyToken: string;
  slug: string;
  expiresAt: number;
}
const providerCache = new Map<string, ProviderCacheEntry>();
const PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function resolveProvider(externalId: string): Promise<{ provider: CachedProviderName; baseUrl: string; serviceKey: string; proxyToken: string; slug: string } | null> {
  const cached = providerCache.get(externalId);
  if (cached && Date.now() < cached.expiresAt) {
    return { provider: cached.provider, baseUrl: cached.baseUrl, serviceKey: cached.serviceKey, proxyToken: cached.proxyToken, slug: cached.slug };
  }
  providerCache.delete(externalId);

  try {
    const [sandbox] = await db
      .select({ provider: sandboxes.provider, baseUrl: sandboxes.baseUrl, config: sandboxes.config, metadata: sandboxes.metadata })
      .from(sandboxes)
      .where(
        and(
          eq(sandboxes.externalId, externalId),
          ne(sandboxes.status, 'pooled'),
        )
      )
      .limit(1);

    if (!sandbox) return null;

    const provider = sandbox.provider as CachedProviderName;
    const baseUrl = sandbox.baseUrl || '';
    const configJson = (sandbox.config || {}) as Record<string, unknown>;
    const serviceKey = typeof configJson.serviceKey === 'string' ? configJson.serviceKey : '';
    const metaJson = (sandbox.metadata || {}) as Record<string, unknown>;
    let proxyToken = typeof metaJson.justavpsProxyToken === 'string' ? metaJson.justavpsProxyToken : '';
    const slug = typeof metaJson.justavpsSlug === 'string' ? metaJson.justavpsSlug : '';

    if (provider === 'justavps' && !proxyToken && config.JUSTAVPS_API_KEY) {
      try {
        const apiBase = config.JUSTAVPS_API_URL.replace(/\/$/, '');
        const res = await fetch(`${apiBase}/proxy-tokens`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.JUSTAVPS_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            machine_id: externalId,
            label: `kortix-sandbox-${externalId}`,
            expires_in_seconds: 7 * 24 * 60 * 60,
          }),
        });
        if (res.ok) {
          const data = await res.json() as { token: string };
          proxyToken = data.token;
          await db.update(sandboxes).set({
            metadata: { ...metaJson, justavpsProxyToken: proxyToken },
            updatedAt: new Date(),
          }).where(eq(sandboxes.externalId, externalId));
          console.log(`[PREVIEW] Lazy-created proxy token for JustAVPS sandbox ${externalId}`);
        } else {
          const errText = await res.text().catch(() => '');
          console.error(`[PREVIEW] Proxy token creation returned ${res.status}: ${errText.slice(0, 300)}`);
        }
      } catch (err) {
        console.warn(`[PREVIEW] Failed to lazy-create proxy token for ${externalId}:`, err);
      }
    }

    // Don't cache JustAVPS entries without a proxy token — retry on next request
    const cacheTtl = (provider === 'justavps' && !proxyToken) ? 0 : PROVIDER_CACHE_TTL_MS;
    providerCache.set(externalId, { provider, baseUrl, serviceKey, proxyToken, slug, expiresAt: Date.now() + cacheTtl });
    return { provider, baseUrl, serviceKey, proxyToken, slug };
  } catch (err) {
    console.error(`[PREVIEW] Provider lookup failed for ${externalId}:`, err);
    return null;
  }
}

// ── Single-provider fast paths ──────────────────────────────────────────────
// When only ONE provider is configured, skip the per-request DB lookup entirely
// and route all requests to the appropriate handler (same behavior as before).

const enabledCount = [config.isDaytonaEnabled(), config.isLocalDockerEnabled(), config.isJustAVPSEnabled()].filter(Boolean).length;

if (enabledCount === 1 && config.isDaytonaEnabled()) {
  // Cloud-only: all requests go to Daytona preview handler
  sandboxProxyApp.route('/', preview);
} else if (enabledCount === 1 && config.isLocalDockerEnabled()) {
  // Local-only: all requests go to local Docker proxy
  const localOnlyProxy = new Hono();

  localOnlyProxy.all('/:sandboxId/:port/*', async (c) => {
    const sandboxId = c.req.param('sandboxId');
    const port = parseInt(c.req.param('port'), 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return c.json({ error: `Invalid port: ${c.req.param('port')}` }, 400);
    }

    const fullPath = new URL(c.req.url).pathname;
    const prefix = `/${sandboxId}/${port}`;
    const idx = fullPath.indexOf(prefix);
    const remainingPath = idx !== -1 ? fullPath.slice(idx + prefix.length) || '/' : '/';

    const queryString = new URL(c.req.url).search;

    const method = c.req.method;
    let body: ArrayBuffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      body = await c.req.raw.arrayBuffer();
    }

    const origin = c.req.header('Origin') || '';

    return proxyToSandbox(sandboxId, port, method, remainingPath, queryString, c.req.raw.headers, body, false, origin);
  });

  localOnlyProxy.all('/:sandboxId/:port', async (c) => {
    const sandboxId = c.req.param('sandboxId');
    const port = c.req.param('port');
    return c.redirect(`/${sandboxId}/${port}/`, 301);
  });

  sandboxProxyApp.route('/', localOnlyProxy);
} else if (enabledCount === 1 && config.isJustAVPSEnabled()) {
  // JustAVPS-only: route through CF Worker proxy at {port}--{slug}.kortix.cloud
  const justavpsOnlyProxy = new Hono();

  justavpsOnlyProxy.all('/:sandboxId/:port/*', async (c) => {
    const sandboxId = c.req.param('sandboxId');
    const port = parseInt(c.req.param('port'), 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return c.json({ error: `Invalid port: ${c.req.param('port')}` }, 400);
    }

    const resolved = await resolveProvider(sandboxId);
    if (!resolved?.slug) {
      return c.json({ error: 'Sandbox not found' }, 404);
    }

    // Route through CF Worker: https://{port}--{slug}.{domain}
    const proxyDomain = config.JUSTAVPS_PROXY_DOMAIN;
    const cfProxyUrl = `https://${port}--${resolved.slug}.${proxyDomain}`;

    const fullPath = new URL(c.req.url).pathname;
    const prefix = `/${sandboxId}/${port}`;
    const idx = fullPath.indexOf(prefix);
    const remainingPath = idx !== -1 ? fullPath.slice(idx + prefix.length) || '/' : '/';

    const queryString = new URL(c.req.url).search;
    const method = c.req.method;
    let body: ArrayBuffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      body = await c.req.raw.arrayBuffer();
    }

    const origin = c.req.header('Origin') || '';

    // Auth: proxy token for CF Worker, service key for core/kortix-master
    const extraHeaders: Record<string, string> = {};
    if (resolved.proxyToken) {
      extraHeaders['X-Proxy-Token'] = resolved.proxyToken;
    }

    return proxyToSandbox(sandboxId, 8000, method, remainingPath, queryString, c.req.raw.headers, body, false, origin, cfProxyUrl, resolved.serviceKey, extraHeaders);
  });

  justavpsOnlyProxy.all('/:sandboxId/:port', async (c) => {
    const sandboxId = c.req.param('sandboxId');
    const port = c.req.param('port');
    return c.redirect(`/${sandboxId}/${port}/`, 301);
  });

  sandboxProxyApp.route('/', justavpsOnlyProxy);
} else {
  // ── Multi-provider mode ─────────────────────────────────────────────────
  // Multiple providers enabled: look up the sandbox's provider per request
  // and dispatch to the correct handler.

  const multiProxy = new Hono<{ Variables: { userId: string; userEmail: string } }>();

  multiProxy.all('/:sandboxId/:port/*', async (c) => {
    const sandboxId = c.req.param('sandboxId');
    const portStr = c.req.param('port');
    const port = parseInt(portStr, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return c.json({ error: `Invalid port: ${portStr}` }, 400);
    }

    const resolved = await resolveProvider(sandboxId);

    // Extract common request data
    const fullPath = new URL(c.req.url).pathname;
    const prefix = `/${sandboxId}/${port}`;
    const idx = fullPath.indexOf(prefix);
    const remainingPath = idx !== -1 ? fullPath.slice(idx + prefix.length) || '/' : '/';

    const queryString = new URL(c.req.url).search;

    const method = c.req.method;
    let body: ArrayBuffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      body = await c.req.raw.arrayBuffer();
    }

    const origin = c.req.header('Origin') || '';

    if (resolved?.provider === 'local_docker') {
      return proxyToSandbox(sandboxId, port, method, remainingPath, queryString, c.req.raw.headers, body, false, origin);
    }

    if (resolved?.provider === 'justavps') {
      // JustAVPS: route through CF Worker proxy at {port}--{slug}.{domain}
      const proxyDomain = config.JUSTAVPS_PROXY_DOMAIN;
      const cfProxyUrl = `https://${port}--${resolved.slug}.${proxyDomain}`;
      const extra: Record<string, string> = {};
      if (resolved.proxyToken) {
        extra['X-Proxy-Token'] = resolved.proxyToken;
      }
      return proxyToSandbox(sandboxId, 8000, method, remainingPath, queryString, c.req.raw.headers, body, false, origin, cfProxyUrl, resolved.serviceKey, extra);
    }

    // Default: route to Daytona preview handler
    const userId = (c.get('userId') as string) || '';
    return proxyToDaytona(sandboxId, port, userId, method, remainingPath, queryString, c.req.raw.headers, body, origin);
  });

  multiProxy.all('/:sandboxId/:port', async (c) => {
    const sandboxId = c.req.param('sandboxId');
    const port = c.req.param('port');
    return c.redirect(`/${sandboxId}/${port}/`, 301);
  });

  sandboxProxyApp.route('/', multiProxy);
}

export { sandboxProxyApp };
