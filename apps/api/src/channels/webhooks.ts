import { Hono } from 'hono';
import { eq, and, isNotNull } from 'drizzle-orm';
import { channelConfigs, sandboxes } from '@kortix/db';
import { db } from '../shared/db';
import { getSandboxBaseUrl } from '../sandbox-proxy/routes/local-preview';
import { config } from '../config';

export const channelWebhooksApp = new Hono();

type ChannelType = 'telegram' | 'slack' | 'discord';

interface ResolvedSandbox {
  url: string;
  channelId: string;
  serviceKey?: string;
  platformConfig?: Record<string, unknown>;
}

async function resolveSandbox(channelType: ChannelType, channelId?: string): Promise<ResolvedSandbox | null> {
  const conditions = channelId
    ? [
        eq(channelConfigs.channelConfigId as any, channelId),
        eq(channelConfigs.channelType as any, channelType),
        isNotNull(channelConfigs.sandboxId as any),
      ]
    : [
        eq(channelConfigs.channelType as any, channelType),
        eq(channelConfigs.enabled as any, true),
        isNotNull(channelConfigs.sandboxId as any),
      ];

  const rows = await db
    .select({
      channelId: channelConfigs.channelConfigId,
      platformConfig: channelConfigs.platformConfig,
      provider: sandboxes.provider,
      baseUrl: sandboxes.baseUrl,
      metadata: sandboxes.metadata,
      config: sandboxes.config,
    })
    .from(channelConfigs)
    //@ts-ignore
    .innerJoin(sandboxes, eq(channelConfigs.sandboxId, sandboxes.sandboxId))
    //@ts-ignore
    .where(and(...conditions))
    .limit(1);

  if (!rows.length) return null;

  const row = rows[0];

  const cfg = (row.config || {}) as Record<string, unknown>;
  const meta = (row.metadata || {}) as Record<string, unknown>;
  const serviceKey = (cfg.serviceKey as string) || undefined;
  const platformConfig = (row.platformConfig || undefined) as Record<string, unknown> | undefined;

  if (row.provider === 'justavps' && meta) {
    const slug = meta.justavpsSlug as string | undefined;
    const proxyToken = meta.justavpsProxyToken as string | undefined;
    if (slug && proxyToken && config.JUSTAVPS_PROXY_DOMAIN) {
      return {
        url: `https://8000--${slug}.${config.JUSTAVPS_PROXY_DOMAIN}?__proxy_token=${proxyToken}`,
        channelId: row.channelId, serviceKey, platformConfig,
      };
    }
  }

  if (row.baseUrl) {
    return { url: row.baseUrl, channelId: row.channelId, serviceKey, platformConfig };
  }

  const localUrl = getSandboxBaseUrl(row.channelId);
  return localUrl ? { url: localUrl, channelId: row.channelId, serviceKey, platformConfig } : null;
}

function buildHeaders(
  resolved: ResolvedSandbox,
  channelType: ChannelType,
  c: { req: { header: (name: string) => string | undefined } },
): { targetUrl: string; headers: Record<string, string> } {
  const baseUrl = resolved.url.split('?')[0];
  const targetUrl = `${baseUrl}/channels/api/webhooks/${channelType}`;

  const headers: Record<string, string> = {
    'Content-Type': c.req.header('Content-Type') || 'application/json',
  };

  try {
    const proxyToken = new URL(resolved.url).searchParams.get('__proxy_token');
    if (proxyToken) headers['X-Proxy-Token'] = proxyToken;
  } catch { }

  if (resolved.serviceKey) {
    headers['Authorization'] = `Bearer ${resolved.serviceKey}`;
  }

  if (channelType === 'telegram') {
    const secret = (resolved.platformConfig?.webhook_secret as string) || c.req.header('X-Telegram-Bot-Api-Secret-Token');
    if (secret) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
  }

  if (channelType === 'slack') {
    const sig = c.req.header('X-Slack-Signature');
    const ts = c.req.header('X-Slack-Request-Timestamp');
    if (sig) headers['X-Slack-Signature'] = sig;
    if (ts) headers['X-Slack-Request-Timestamp'] = ts;
  }

  return { targetUrl, headers };
}

async function forwardWebhook(
  channelType: ChannelType,
  c: { req: { raw: Request; header: (name: string) => string | undefined; param: (name: string) => string | undefined } },
  channelId?: string,
): Promise<Response> {
  let resolved: ResolvedSandbox | null = null;

  try {
    resolved = await resolveSandbox(channelType, channelId);
  } catch (err) {
    console.error(`[channel-webhooks] DB lookup failed for ${channelType}${channelId ? `/${channelId}` : ''}:`, err);
    return new Response(JSON.stringify({ error: 'Internal error resolving channel' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!resolved) {
    console.warn(`[channel-webhooks] No ${channelType} channel found${channelId ? ` (id=${channelId})` : ''}`);
    return new Response(JSON.stringify({ error: 'No channel configured' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawBody = await c.req.raw.clone().arrayBuffer();
  const { targetUrl, headers } = buildHeaders(resolved, channelType, c);

  console.log(`[channel-webhooks] ${channelType}${channelId ? `/${channelId}` : ''} → ${targetUrl}`);

  try {
    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(30_000),
    });

    const body = await resp.text();

    if (!resp.ok) {
      console.error(`[channel-webhooks] ${channelType} forward returned ${resp.status}: ${body.slice(0, 300)}`);
    }

    return new Response(body, {
      status: resp.status,
      headers: { 'Content-Type': resp.headers.get('Content-Type') || 'text/plain' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[channel-webhooks] ${channelType} forward failed: ${msg}`);
    if (stack) console.error(stack);
    return new Response(JSON.stringify({ error: 'Webhook forwarding failed', details: msg }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// Slack — named sub-routes MUST come before /:channelId to avoid "events" being parsed as a UUID
channelWebhooksApp.post('/slack/events', (c: any) => forwardWebhook('slack', c));
channelWebhooksApp.post('/slack/commands', (c: any) => forwardWebhook('slack', c));
channelWebhooksApp.post('/slack/interactivity', (c: any) => forwardWebhook('slack', c));
channelWebhooksApp.post('/slack/:channelId', (c: any) => forwardWebhook('slack', c, c.req.param('channelId')));
channelWebhooksApp.post('/slack', (c: any) => forwardWebhook('slack', c));

// Telegram
channelWebhooksApp.post('/telegram/:channelId', (c: any) => forwardWebhook('telegram', c, c.req.param('channelId')));
channelWebhooksApp.post('/telegram', (c: any) => forwardWebhook('telegram', c));

// Discord
channelWebhooksApp.post('/discord/:channelId', (c: any) => forwardWebhook('discord', c, c.req.param('channelId')));
channelWebhooksApp.post('/discord', (c: any) => forwardWebhook('discord', c));
