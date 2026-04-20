import { eq, and, desc, asc, count, gte, lte, or, ilike } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { auditLogs } from '@kortix/db';
import { db } from '../shared/db';
import {
  genesisHashForAccount,
  computeRecordHash,
  type CanonicalAuditPayload,
} from './chain';

export type AuditCategory = 'business' | 'system' | 'agent_trace';

export type AppendAuditInput = {
  accountId: string;
  category: AuditCategory;
  /** Dot-separated, e.g. user.login, shipment.create, agent.tool_call */
  action: string;
  summary: string;
  metadata?: Record<string, unknown>;
  actorUserId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Append-only audit row with per-account hash chain. Serialized with
 * pg_advisory_xact_lock so concurrent writers for the same account cannot
 * produce inconsistent chain_seq / prev_record_hash values.
 */
export async function appendAuditEvent(input: AppendAuditInput) {
  const meta = input.metadata ?? {};
  const createdAt = new Date();

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.accountId}::text, 0::bigint))`,
    );

    const [last] = await tx
      .select({
        chainSeq: auditLogs.chainSeq,
        recordHash: auditLogs.recordHash,
      })
      .from(auditLogs)
      .where(eq(auditLogs.accountId, input.accountId))
      .orderBy(desc(auditLogs.chainSeq))
      .limit(1);

    const chainSeq = (last?.chainSeq ?? 0) + 1;
    const prevRecordHash = last?.recordHash ?? genesisHashForAccount(input.accountId);

    const payload: CanonicalAuditPayload = {
      chainSeq,
      category: input.category,
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      summary: input.summary,
      metadata: meta,
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      createdAtIso: createdAt.toISOString(),
    };

    const recordHash = computeRecordHash(prevRecordHash, payload);

    const [row] = await tx
      .insert(auditLogs)
      .values({
        accountId: input.accountId,
        chainSeq,
        category: input.category,
        action: input.action,
        actorUserId: input.actorUserId ?? null,
        resourceType: input.resourceType ?? null,
        resourceId: input.resourceId ?? null,
        summary: input.summary,
        metadata: meta,
        requestId: input.requestId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        prevRecordHash,
        recordHash,
        createdAt,
      })
      .returning();

    if (!row) throw new Error('audit insert returned no row');
    return row;
  });
}

export type ListAuditParams = {
  accountId: string;
  category?: AuditCategory;
  actionPrefix?: string;
  q?: string;
  from?: Date;
  to?: Date;
  page: number;
  limit: number;
};

export async function listAuditEvents(p: ListAuditParams) {
  const limit = Math.min(Math.max(p.limit, 1), 100);
  const page = Math.max(p.page, 1);
  const offset = (page - 1) * limit;

  const conditions = [eq(auditLogs.accountId, p.accountId)];

  if (p.category) {
    conditions.push(eq(auditLogs.category, p.category));
  }
  if (p.actionPrefix) {
    conditions.push(ilike(auditLogs.action, `${p.actionPrefix}%`));
  }
  if (p.q?.trim()) {
    const term = `%${p.q.trim()}%`;
    conditions.push(or(ilike(auditLogs.summary, term), ilike(auditLogs.action, term))!);
  }
  if (p.from) {
    conditions.push(gte(auditLogs.createdAt, p.from));
  }
  if (p.to) {
    conditions.push(lte(auditLogs.createdAt, p.to));
  }

  const whereClause = and(...conditions);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(auditLogs).where(whereClause),
  ]);

  return {
    data: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

export async function getAuditEvent(accountId: string, logId: string) {
  const [row] = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.accountId, accountId), eq(auditLogs.logId, logId)))
    .limit(1);
  return row ?? null;
}

/**
 * Re-scan all rows for the account in chain order and recompute hashes.
 * O(n); use for admin / integrity checks, not per request.
 */
export async function verifyAuditChain(accountId: string) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.accountId, accountId))
    .orderBy(asc(auditLogs.chainSeq));

  let prev = genesisHashForAccount(accountId);
  let expectedSeq = 1;

  for (const row of rows) {
    if (row.chainSeq !== expectedSeq) {
      return {
        valid: false,
        reason: 'chain_seq_gap_or_duplicate' as const,
        expectedSeq,
        gotSeq: row.chainSeq,
      };
    }
    if (row.prevRecordHash !== prev) {
      return {
        valid: false,
        reason: 'prev_record_hash_mismatch' as const,
        atChainSeq: row.chainSeq,
      };
    }

    const payload: CanonicalAuditPayload = {
      chainSeq: row.chainSeq,
      category: row.category,
      action: row.action,
      actorUserId: row.actorUserId,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      summary: row.summary,
      metadata: row.metadata ?? {},
      requestId: row.requestId,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAtIso: row.createdAt.toISOString(),
    };

    const expectedHash = computeRecordHash(prev, payload);
    if (expectedHash !== row.recordHash) {
      return {
        valid: false,
        reason: 'record_hash_mismatch' as const,
        atChainSeq: row.chainSeq,
      };
    }

    prev = row.recordHash;
    expectedSeq += 1;
  }

  return {
    valid: true as const,
    chainLength: rows.length,
  };
}
