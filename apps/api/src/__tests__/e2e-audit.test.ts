/**
 * Audit log integration tests — require DATABASE_URL and reachable PostgreSQL (14+).
 *
 *   cd apps/api && bun test src/__tests__/e2e-audit.test.ts
 *
 * Loads `.env` automatically when present (Bun).
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { accounts, accountMembers, auditLogs } from '@kortix/db';
import { createAuditApp } from '../audit/routes';
import { verifyAuditChain } from '../audit/service';
import {
  TEST_USER_ID,
  TEST_USER_EMAIL,
  getTestDb,
  jsonPost,
  jsonGet,
} from './helpers';
import type { AuthVariables } from '../types';

/** True only when DATABASE_URL is set and Postgres accepts connections. */
async function isDatabaseReachable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    const db = getTestDb();
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const dbReachable = await isDatabaseReachable();

describe.skipIf(!dbReachable)('Audit log (DB + HTTP)', () => {
  const db = getTestDb();

  beforeAll(async () => {
    await db
      .insert(accounts)
      .values({
        accountId: TEST_USER_ID,
        name: 'audit-e2e',
        personalAccount: true,
      })
      .onConflictDoNothing();

    await db
      .insert(accountMembers)
      .values({
        userId: TEST_USER_ID,
        accountId: TEST_USER_ID,
        accountRole: 'owner',
      })
      .onConflictDoNothing({ target: [accountMembers.userId, accountMembers.accountId] });

    await db.delete(auditLogs).where(eq(auditLogs.accountId, TEST_USER_ID));
  });

  afterAll(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.accountId, TEST_USER_ID));
  });

  const app = new Hono<{ Variables: AuthVariables }>();
  app.use('*', async (c, next) => {
    c.set('userId', TEST_USER_ID);
    c.set('userEmail', TEST_USER_EMAIL);
    await next();
  });
  app.route('/v1/audit', createAuditApp());

  it('POST /v1/audit/events appends row with chainSeq and hashes', async () => {
    const res = await jsonPost(app, '/v1/audit/events', {
      category: 'business',
      action: 'test.e2e.append',
      summary: 'integration test append',
      metadata: { case: 'e2e-audit' },
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.accountId).toBe(TEST_USER_ID);
    expect(body.chainSeq).toBe(1);
    expect(typeof body.recordHash).toBe('string');
    expect((body.recordHash as string).length).toBe(64);
    expect(typeof body.prevRecordHash).toBe('string');
    expect((body.prevRecordHash as string).length).toBe(64);
    expect(body.action).toBe('test.e2e.append');
  });

  it('POST second event increments chainSeq and links prevRecordHash', async () => {
    const first = await jsonPost(app, '/v1/audit/events', {
      category: 'system',
      action: 'test.e2e.second',
      summary: 'second row',
    });
    expect(first.status).toBe(201);
    const a = (await first.json()) as { chainSeq: number; recordHash: string };

    const second = await jsonPost(app, '/v1/audit/events', {
      category: 'business',
      action: 'test.e2e.third',
      summary: 'third row',
    });
    expect(second.status).toBe(201);
    const b = (await second.json()) as { chainSeq: number; prevRecordHash: string };

    expect(b.chainSeq).toBe(a.chainSeq + 1);
    expect(b.prevRecordHash).toBe(a.recordHash);
  });

  it('GET /v1/audit/events returns pagination', async () => {
    const res = await jsonGet(app, '/v1/audit/events?limit=10&page=1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      pagination: { total: number };
    };
    expect(body.data.length).toBeGreaterThanOrEqual(3);
    expect(body.pagination.total).toBeGreaterThanOrEqual(3);
  });

  it('GET /v1/audit/verify-chain reports valid', async () => {
    const res = await jsonGet(app, '/v1/audit/verify-chain');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { valid: boolean; chainLength?: number };
    expect(body.valid).toBe(true);
    expect(body.chainLength).toBeGreaterThanOrEqual(3);
  });

  it('verifyAuditChain() matches HTTP verify', async () => {
    const direct = await verifyAuditChain(TEST_USER_ID);
    expect(direct.valid).toBe(true);
  });
});
