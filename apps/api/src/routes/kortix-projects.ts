/**
 * Kortix API proxy handler — /v1/kortix/*
 *
 * In cloud/JustAVPS mode this must proxy through the same preview pipeline as
 * /v1/p/:sandboxId/:port/* so the sandbox service key and auto-wake behavior
 * are applied correctly.
 */

import type { Context } from 'hono';
import { config } from '../config';
import { db } from '../shared/db';
import { resolveAccountId } from '../shared/resolve-account';
import { getSandboxBaseUrl } from '../sandbox-proxy/routes/local-preview';
import { proxyToDaytona } from '../sandbox-proxy/routes/preview';

async function resolveActiveSandboxExternalId(userId: string): Promise<string | null> {
  const accountId = await resolveAccountId(userId);
  const safeAccountId = accountId.replace(/'/g, "''");
  const rows = await db.execute(`
    select external_id
    from kortix.sandboxes
    where account_id = '${safeAccountId}'
    order by updated_at desc
    limit 1
  `);
  const row = rows?.[0] as { external_id?: string } | undefined;
  return row?.external_id ?? null;
}

export async function kortixProxyHandler(c: Context): Promise<Response> {
  // /v1/kortix/projects/xxx → /kortix/projects/xxx
  const sandboxPath = c.req.path.replace(/^\/v1/, '').replace(/\/+$/, '') || '/kortix';

  // Local/self-hosted can hit the local sandbox directly.
  if (!config.JUSTAVPS_API_KEY) {
    const targetUrl = `${getSandboxBaseUrl(config.SANDBOX_CONTAINER_NAME)}${sandboxPath}`;
    const headers = new Headers();
    const ct = c.req.header('content-type');
    if (ct) headers.set('Content-Type', ct);
    if (config.INTERNAL_SERVICE_KEY) headers.set('Authorization', `Bearer ${config.INTERNAL_SERVICE_KEY}`);

    try {
      const res = await fetch(targetUrl, {
        method: c.req.method,
        headers,
        body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? await c.req.arrayBuffer() : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.arrayBuffer();
      return new Response(data, {
        status: res.status,
        headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
      });
    } catch (err: any) {
      return c.json({ error: 'Sandbox unreachable', detail: err?.message }, 502);
    }
  }

  // Cloud/JustAVPS: reuse the preview proxy so auth, service key injection,
  // preview token handling, and auto-wake all work the same way.
  const userId = c.get('userId') as string;
  const externalId = await resolveActiveSandboxExternalId(userId);
  if (!externalId) {
    return c.json({ error: 'No active sandbox found for account' }, 404);
  }

  const queryString = new URL(c.req.url).search;
  const body = c.req.method !== 'GET' && c.req.method !== 'HEAD'
    ? await c.req.raw.clone().arrayBuffer()
    : undefined;

  return proxyToDaytona(
    externalId,
    8000,
    userId,
    c.req.method,
    sandboxPath,
    queryString,
    c.req.raw.headers,
    body,
    c.req.header('Origin') || '',
  );
}
