/**
 * sandbox-provision-poller.ts
 *
 * Background service that polls JustAVPS for all sandboxes stuck in 'provisioning'.
 * Acts as a reliable fallback when webhooks are broken/unreachable (e.g. dead ngrok URL).
 *
 * On each tick:
 *   1. Finds all sandboxes with status='provisioning' and provider='justavps'
 *   2. Fetches each machine's current state from JustAVPS API
 *   3. Updates the DB stage (forward-only, same as webhook handler)
 *   4. Emits events via sandboxEventBus so SSE streams and in-memory listeners get notified
 *   5. Flips sandbox to 'active' only after port 8000 is actually reachable
 *   6. Flips sandbox to 'error' when JustAVPS reports 'error' or 'deleted'
 */

import { eq, and } from 'drizzle-orm';
import { sandboxes } from '@kortix/db';
import { db } from '../../shared/db';
import { config } from '../../config';
import { sandboxEventBus } from './sandbox-events';
import { probeJustAvpsSandboxReadiness } from './sandbox-readiness';
import { sendWorkspaceReadyEmail } from './email-notification';

// ─── Config ──────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 8_000;       // 8s between sweeps
const JUSTAVPS_TIMEOUT_MS = 10_000;   // 10s per machine fetch
const MAX_CONCURRENT = 5;             // don't hammer JustAVPS
const CREATION_GRACE_MS = 60_000;     // 60s grace period before treating 404 as fatal

let _intervalId: ReturnType<typeof setInterval> | null = null;
let _running = false;

// Stage ordering — same as sandbox-events.ts
const STAGE_ORDER: Record<string, number> = {
  server_creating: 1,
  server_created: 2,
  cloud_init_running: 3,
  cloud_init_done: 4,
  services_starting: 5,
  services_ready: 6,
};

// ─── Public API ──────────────────────────────────────────────────────────────

export function startProvisionPoller(): void {
  if (_intervalId) return;

  // Don't start if JustAVPS isn't configured
  if (!config.JUSTAVPS_API_KEY || !config.JUSTAVPS_API_URL) {
    console.log('[provision-poller] JustAVPS not configured, skipping');
    return;
  }

  // Warn about dead webhook URL
  const webhookUrl = config.JUSTAVPS_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[provision-poller] ⚠️  JUSTAVPS_WEBHOOK_URL not set — relying entirely on polling for provisioning updates');
  } else if (webhookUrl.includes('ngrok.app') || webhookUrl.includes('ngrok.io')) {
    console.warn(`[provision-poller] ⚠️  JUSTAVPS_WEBHOOK_URL points to ngrok (${webhookUrl}) — if tunnel is dead, polling will compensate`);
  }

  // Run first check after a brief delay, then on interval
  setTimeout(() => {
    pollProvisioningSandboxes();
    _intervalId = setInterval(pollProvisioningSandboxes, POLL_INTERVAL_MS);
  }, 3_000);

  console.log(`[provision-poller] Started (interval: ${POLL_INTERVAL_MS / 1000}s)`);
}

export function stopProvisionPoller(): void {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

// ─── Core ────────────────────────────────────────────────────────────────────

async function pollProvisioningSandboxes(): Promise<void> {
  if (_running) return; // Skip if previous tick is still running
  _running = true;

  try {
    // Find all provisioning JustAVPS sandboxes
    const rows = await db
      .select()
      .from(sandboxes)
      .where(
        and(
          eq(sandboxes.status, 'provisioning'),
          eq(sandboxes.provider, 'justavps'),
        ),
      );

    if (rows.length === 0) {
      _running = false;
      return;
    }

    // Process in batches to avoid hammering JustAVPS
    for (let i = 0; i < rows.length; i += MAX_CONCURRENT) {
      const batch = rows.slice(i, i + MAX_CONCURRENT);
      await Promise.allSettled(batch.map((sandbox) => pollSingleSandbox(sandbox)));
    }
  } catch (err) {
    console.error('[provision-poller] Sweep error:', err);
  } finally {
    _running = false;
  }
}

async function pollSingleSandbox(sandbox: typeof sandboxes.$inferSelect): Promise<void> {
  if (!sandbox.externalId) return; // No machine yet — nothing to poll

  try {
    const baseUrl = config.JUSTAVPS_API_URL.replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/machines/${sandbox.externalId}`, {
      headers: {
        'Authorization': `Bearer ${config.JUSTAVPS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(JUSTAVPS_TIMEOUT_MS),
    });

    if (!res.ok) {
      if (res.status === 404) {
        const ageMs = Date.now() - new Date(sandbox.createdAt).getTime();
        if (ageMs < CREATION_GRACE_MS) {
          console.log(`[provision-poller] ${sandbox.sandboxId} got 404 but sandbox is only ${Math.round(ageMs / 1000)}s old — will retry`);
          return;
        }

        await db
          .update(sandboxes)
          .set({
            status: 'error',
            metadata: {
              ...(sandbox.metadata as Record<string, unknown> ?? {}),
              provisioningStage: 'error',
              provisioningError: 'Machine not found on provider',
            },
            updatedAt: new Date(),
          })
          .where(eq(sandboxes.sandboxId, sandbox.sandboxId));
        console.log(`[provision-poller] ${sandbox.sandboxId} → error (machine 404)`);
        sandboxEventBus.emit({
          sandboxId: sandbox.sandboxId,
          externalId: sandbox.externalId,
          event: 'provision_poll',
          status: 'error',
          message: 'Machine not found on provider',
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    const machine = await res.json() as {
      status: string;
      provisioning_stage?: string | null;
      ip?: string | null;
    };

    const meta = (sandbox.metadata as Record<string, unknown>) ?? {};
    const currentStage = (meta.provisioningStage as string) || '';
    const currentRank = STAGE_ORDER[currentStage] ?? 0;
    const incomingStage = machine.provisioning_stage || '';
    const incomingRank = STAGE_ORDER[incomingStage] ?? 0;

    // ── Machine is ready → verify sandbox services before flipping active ──
    if (machine.status === 'ready') {
      const healedMeta = {
        ...meta,
        provisioningStage: 'services_ready',
        provisioningMessage: 'VM is ready, verifying sandbox services...',
        ...(machine.ip ? { publicIp: machine.ip } : {}),
      };

      const readiness = await probeJustAvpsSandboxReadiness({
        slug: (meta.justavpsSlug as string | undefined) || undefined,
        proxyToken: (meta.justavpsProxyToken as string | undefined) || undefined,
        serviceKey: ((sandbox.config as Record<string, unknown> | null)?.serviceKey as string | undefined) || undefined,
        externalId: sandbox.externalId || undefined,
      });

      if (!readiness.ready) {
        await db
          .update(sandboxes)
          .set({
            metadata: {
              ...healedMeta,
              provisioningMessage: readiness.message,
            },
            updatedAt: new Date(),
          })
          .where(eq(sandboxes.sandboxId, sandbox.sandboxId));

        sandboxEventBus.emit({
          sandboxId: sandbox.sandboxId,
          externalId: sandbox.externalId,
          event: 'provision_poll',
          stage: 'services_ready',
          message: readiness.message,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      await db
        .update(sandboxes)
        .set({ status: 'active', metadata: healedMeta, updatedAt: new Date() })
        .where(
          and(
            eq(sandboxes.sandboxId, sandbox.sandboxId),
            eq(sandboxes.status, 'provisioning'),
          ),
        );

      console.log(`[provision-poller] ${sandbox.sandboxId} → active (sandbox services ready)`);

      sandboxEventBus.emit({
        sandboxId: sandbox.sandboxId,
        externalId: sandbox.externalId,
        event: 'provision_poll',
        stage: 'services_ready',
        status: 'ready',
        message: 'All services are up',
        timestamp: new Date().toISOString(),
      });

      // Send "workspace ready" email notification (fire-and-forget)
      sendWorkspaceReadyEmail({
        accountId: sandbox.accountId,
        sandboxName: sandbox.name || sandbox.sandboxId,
        sandboxId: sandbox.sandboxId,
      }).catch(() => {}); // never block on email failures

      return;
    }

    // ── Machine errored or deleted → flip to error ──
    if (machine.status === 'error' || machine.status === 'deleted') {
      const errorMeta = {
        ...meta,
        provisioningStage: machine.provisioning_stage || 'error',
        provisioningError: machine.status === 'deleted'
          ? 'Machine was deleted by the provider'
          : `Machine provisioning failed (${machine.provisioning_stage || 'unknown'})`,
      };

      await db
        .update(sandboxes)
        .set({ status: 'error', metadata: errorMeta, updatedAt: new Date() })
        .where(eq(sandboxes.sandboxId, sandbox.sandboxId));

      console.log(`[provision-poller] ${sandbox.sandboxId} → error (machine ${machine.status})`);

      sandboxEventBus.emit({
        sandboxId: sandbox.sandboxId,
        externalId: sandbox.externalId,
        event: 'provision_poll',
        status: 'error',
        message: errorMeta.provisioningError,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // ── Stage progressed forward → update DB + emit event ──
    if (incomingStage && incomingRank > currentRank) {
      const updatedMeta = {
        ...meta,
        provisioningStage: incomingStage,
        provisioningMessage: getStageMessage(incomingStage),
        ...(machine.ip ? { publicIp: machine.ip } : {}),
      };

      await db
        .update(sandboxes)
        .set({ metadata: updatedMeta, updatedAt: new Date() })
        .where(eq(sandboxes.sandboxId, sandbox.sandboxId));

      console.log(`[provision-poller] ${sandbox.sandboxId} stage: ${currentStage || '(none)'} → ${incomingStage}`);

      sandboxEventBus.emit({
        sandboxId: sandbox.sandboxId,
        externalId: sandbox.externalId,
        event: 'provision_poll',
        stage: incomingStage,
        message: getStageMessage(incomingStage),
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    // Non-fatal — will retry next tick
    console.warn(`[provision-poller] Failed to poll ${sandbox.sandboxId}:`, (err as Error).message);
  }
}

function getStageMessage(stage: string): string {
  const messages: Record<string, string> = {
    server_creating: 'Creating server...',
    server_created: 'Server created, running cloud-init...',
    cloud_init_running: 'Configuring machine...',
    cloud_init_done: 'Configuration complete, starting services...',
    services_starting: 'Services booting...',
    services_ready: 'All services are up',
  };
  return messages[stage] || 'Provisioning...';
}
