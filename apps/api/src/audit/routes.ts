import { Hono } from 'hono';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../types';
import { getRequestContext } from '../lib/request-context';
import { resolveAccountId } from '../shared/resolve-account';
import { appendAuditEvent, listAuditEvents, getAuditEvent, verifyAuditChain, type AuditCategory } from './service';

const postBodySchema = z.object({
  category: z.enum(['business', 'system', 'agent_trace']),
  action: z.string().min(1).max(160),
  summary: z.string().min(1).max(8000),
  metadata: z.record(z.unknown()).optional(),
  actorUserId: z.string().uuid().nullable().optional(),
  resourceType: z.string().max(128).nullable().optional(),
  resourceId: z.string().max(4096).nullable().optional(),
  requestId: z.string().max(128).nullable().optional(),
});

function clientIp(c: { req: { header: (name: string) => string | undefined } }): string | undefined {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim();
  return c.req.header('x-real-ip') ?? undefined;
}

/**
 * Resolve tenant account for the current principal.
 * - Supabase JWT: userId is profile UUID → map via membership to accountId.
 * - Kortix API key: accountId is set on context; userId is duplicated as accountId.
 */
async function getAccountIdFromContext(c: { get: (k: string) => unknown }): Promise<string> {
  const explicit = c.get('accountId') as string | undefined;
  if (explicit) return explicit;
  const userId = c.get('userId') as string;
  return resolveAccountId(userId);
}

function inferActorFromContext(c: { get: (k: string) => unknown }): string | null {
  const explicitAccount = c.get('accountId') as string | undefined;
  if (explicitAccount) return null;
  const userId = c.get('userId') as string;
  if (userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return userId;
  }
  return null;
}

export function createAuditApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * GET /events — paginated audit list for the current account
   */
  app.get('/events', async (c) => {
    const accountId = await getAccountIdFromContext(c);
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
    const category = c.req.query('category') as AuditCategory | undefined;
    const actionPrefix = c.req.query('action_prefix') || c.req.query('actionPrefix') || undefined;
    const q = c.req.query('q') || undefined;
    const fromIso = c.req.query('from');
    const toIso = c.req.query('to');
    const from = fromIso ? new Date(fromIso) : undefined;
    const to = toIso ? new Date(toIso) : undefined;

    if (category && !['business', 'system', 'agent_trace'].includes(category)) {
      throw new HTTPException(400, { message: 'Invalid category' });
    }
    if (from && Number.isNaN(from.getTime())) {
      throw new HTTPException(400, { message: 'Invalid from' });
    }
    if (to && Number.isNaN(to.getTime())) {
      throw new HTTPException(400, { message: 'Invalid to' });
    }

    const result = await listAuditEvents({
      accountId,
      category,
      actionPrefix,
      q,
      from,
      to,
      page,
      limit,
    });

    return c.json(result);
  });

  /**
   * GET /events/:logId — single event
   */
  app.get('/events/:logId', async (c) => {
    const accountId = await getAccountIdFromContext(c);
    const logId = c.req.param('logId');
    const row = await getAuditEvent(accountId, logId);
    if (!row) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.json(row);
  });

  /**
   * POST /events — append audit entry (hash chain updated server-side)
   */
  app.post('/events', async (c) => {
    const accountId = await getAccountIdFromContext(c);
    const raw = await c.req.json().catch(() => null);
    const parsed = postBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
    }

    const body = parsed.data;
    const actorUserId = body.actorUserId !== undefined ? body.actorUserId : inferActorFromContext(c);

    const reqCtx = getRequestContext();
    const row = await appendAuditEvent({
      accountId,
      category: body.category,
      action: body.action,
      summary: body.summary,
      metadata: body.metadata,
      actorUserId,
      resourceType: body.resourceType ?? null,
      resourceId: body.resourceId ?? null,
      requestId: body.requestId ?? reqCtx?.requestId ?? null,
      ipAddress: clientIp(c),
      userAgent: c.req.header('user-agent') ?? null,
    });

    return c.json(row, 201);
  });

  /**
   * GET /verify-chain — integrity check for the current account (full scan)
   */
  app.get('/verify-chain', async (c) => {
    const accountId = await getAccountIdFromContext(c);
    const result = await verifyAuditChain(accountId);
    return c.json(result);
  });

  return app;
}
