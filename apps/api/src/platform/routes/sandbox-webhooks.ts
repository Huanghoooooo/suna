/**
 * Webhook receiver for JustAVPS machine events + SSE provisioning stream.
 *
 * POST /webhooks/justavps — receives HMAC-signed events (no auth, HMAC-verified)
 * GET  /sandbox/:id/provision-stream — SSE stream for frontend (auth required)
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createHmac, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from '../../shared/db';
import { combinedAuth } from '../../middleware/auth';
import { config } from '../../config';
import { sandboxEventBus, type SandboxProvisionEvent } from '../services/sandbox-events';
import { resolveAccountId } from '../../shared/resolve-account';
import type { AuthVariables } from '../../types';

const router = new Hono();

// ─── POST /webhooks/justavps — Webhook receiver (no user auth, HMAC only) ──

router.post('/webhooks/justavps', async (c) => {
  const signature = c.req.header('X-JustAVPS-Signature');
  const webhookSecret = config.JUSTAVPS_WEBHOOK_SECRET;

  const body = await c.req.text();

  // Verify HMAC if secret is configured
  if (webhookSecret && signature) {
    const expected = createHmac('sha256', webhookSecret).update(body).digest('hex');
    try {
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return c.json({ error: 'Invalid signature' }, 401);
      }
    } catch {
      return c.json({ error: 'Invalid signature format' }, 401);
    }
  } else if (webhookSecret && !signature) {
    return c.json({ error: 'Missing signature' }, 401);
  }

  try {
    const payload = JSON.parse(body);
    const d = payload.data || {};
    if (payload.event !== 'machine.heartbeat') {
      console.log(`[WEBHOOK] ← ${payload.event} | machine=${d.machineId?.slice(0, 8)} stage=${d.stage || '-'} status=${d.status || '-'} msg=${d.message || '-'}`);
    }
    await sandboxEventBus.processWebhook(payload);
    return c.json({ ack: true });
  } catch (err) {
    console.error('[WEBHOOK] Failed to process JustAVPS webhook:', err);
    return c.json({ error: 'Failed to process webhook' }, 500);
  }
});

// ─── GET /sandbox/:id/provision-stream — SSE for frontend (auth required) ──

// Auth sub-router for SSE endpoint (uses combinedAuth for query-param token support — EventSource can't set headers)
const sseRouter = new Hono<{ Variables: AuthVariables }>();
sseRouter.use('*', combinedAuth);
sseRouter.get('/:id/provision-stream', async (c) => {
  const sandboxId = c.req.param('id');
  const userId = c.get('userId');

  const accountId = await resolveAccountId(userId);
  const [sandbox] = await db
    .select()
    .from(sandboxes)
    .where(eq(sandboxes.sandboxId, sandboxId))
    .limit(1);

  if (!sandbox || sandbox.accountId !== accountId) {
    return c.json({ error: 'Sandbox not found' }, 404);
  }

  return streamSSE(c, async (stream) => {
    // Emit current state
    const meta = (sandbox.metadata as Record<string, unknown>) ?? {};
    await stream.writeSSE({
      data: JSON.stringify({
        sandbox_id: sandbox.sandboxId,
        status: sandbox.status,
        provisioning_stage: meta.provisioningStage ?? null,
        message: meta.provisioningMessage ?? null,
        provider: sandbox.provider,
      }),
      event: 'status',
    });

    if (sandbox.provider === 'local_docker' || sandbox.status === 'active' || sandbox.status === 'error') {
      await stream.writeSSE({ data: JSON.stringify({ done: true }), event: 'done' });
      return;
    }

    let resolved = false;

    const listener = async (event: SandboxProvisionEvent) => {
      if (resolved) return;
      try {
        await stream.writeSSE({
          data: JSON.stringify({
            sandbox_id: sandboxId,
            event: event.event,
            stage: event.stage,
            status: event.status,
            message: event.message,
            timestamp: event.timestamp,
          }),
          event: 'stage',
        });

        if (event.status === 'ready' || event.status === 'error') {
          resolved = true;
          await stream.writeSSE({ data: JSON.stringify({ done: true }), event: 'done' });
          sandboxEventBus.off(sandboxId, listener);
        }
      } catch {
        resolved = true;
        sandboxEventBus.off(sandboxId, listener);
      }
    };

    sandboxEventBus.on(sandboxId, listener);

    stream.onAbort(() => {
      resolved = true;
      sandboxEventBus.off(sandboxId, listener);
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        stream.writeSSE({ data: JSON.stringify({ done: true, reason: 'timeout' }), event: 'done' }).catch(() => {});
        sandboxEventBus.off(sandboxId, listener);
      }
    }, 10 * 60 * 1000);

    const keepalive = setInterval(() => {
      if (resolved) { clearInterval(keepalive); return; }
      stream.writeSSE({ data: '', event: 'ping' }).catch(() => {
        resolved = true;
        sandboxEventBus.off(sandboxId, listener);
      });
    }, 30_000);

    while (!resolved) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    clearTimeout(timeout);
    clearInterval(keepalive);
  });
});

// Mount SSE sub-router under /sandbox
router.route('/sandbox', sseRouter);

export { router as sandboxWebhookRouter };
