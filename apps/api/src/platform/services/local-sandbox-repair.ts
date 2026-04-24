import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { sandboxes, type Database } from '@kortix/db';

type SandboxRow = typeof sandboxes.$inferSelect;

const CONFLICTING_LOCAL_STATUSES = ['active', 'provisioning', 'stopped', 'error'] as const;

export async function archiveConflictingLocalDockerSandbox(
  db: Database,
  row: SandboxRow | null | undefined,
): Promise<SandboxRow | null> {
  if (!row || row.provider !== 'local_docker' || !row.externalId) {
    return row ?? null;
  }
  if (!CONFLICTING_LOCAL_STATUSES.includes(row.status as (typeof CONFLICTING_LOCAL_STATUSES)[number])) {
    return row;
  }

  const [conflict] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sandboxes)
    .where(
      and(
        eq(sandboxes.provider, 'local_docker'),
        eq(sandboxes.externalId, row.externalId),
        ne(sandboxes.accountId, row.accountId),
        inArray(sandboxes.status, [...CONFLICTING_LOCAL_STATUSES]),
      ),
    );

  if (!conflict || Number(conflict.count) === 0) {
    return row;
  }

  const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
  const [archived] = await db
    .update(sandboxes)
    .set({
      status: 'archived',
      metadata: {
        ...metadata,
        archivedReason: 'conflicting_local_external_id',
        conflictingExternalId: row.externalId,
        archivedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(sandboxes.sandboxId, row.sandboxId))
    .returning();

  console.warn(
    `[PLATFORM] Archived corrupted local sandbox ${row.sandboxId} for account ${row.accountId}; ` +
    `external_id ${row.externalId} is shared across accounts`,
  );

  return archived ? null : row;
}
