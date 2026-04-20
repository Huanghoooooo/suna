/**
 * Account browsing & in-account member management.
 *
 * Mounted at /v1/admin/api/accounts/*, inheriting supabaseAuth + requireAdmin.
 *
 * Platform admins (admin / super_admin) can manage members of any account.
 * Account-internal roles are: owner / admin / member.
 *
 * Safety rails:
 *   - Removing or demoting the last owner of an account is blocked.
 */

import { Hono } from 'hono';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { db } from '../shared/db';
import { accounts, accountMembers, platformUserRoles } from '@kortix/db';
import type { PlatformRole } from '../shared/platform-roles';

export const accountsApp = new Hono<AppEnv>();

const accountRoleSchema = z.enum(['owner', 'admin', 'member']);
const putMemberBody = z.object({ role: accountRoleSchema });

const createAccountBody = z.object({
  name: z.string().trim().min(1, 'name is required').max(255),
});

async function countOwners(accountId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(accountMembers)
    .where(and(eq(accountMembers.accountId, accountId), eq(accountMembers.accountRole, 'owner')));
  return row?.n ?? 0;
}

/**
 * POST /v1/admin/api/accounts
 * Body: { name }
 *
 * Creates a new non-personal ("team") account with the caller set as the
 * initial owner. Intended for super_admin use to spin up departments or
 * shared workspaces.
 *
 * Permission: super_admin only. Regular admin is NOT allowed — creating
 * accounts is a platform-shape decision, not an operational one.
 */
accountsApp.post('/', async (c) => {
  const callerRole = c.get('platformRole') as PlatformRole | undefined;
  if (callerRole !== 'super_admin') {
    return c.json({ error: 'Only super_admin can create accounts' }, 403);
  }

  const callerAccountId = c.get('userId') as string | undefined;
  if (!callerAccountId) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const parsed = createAccountBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const { name } = parsed.data;

  // Transactional insert: account + owner membership. If the membership
  // insert fails for any reason we want the account row rolled back so we
  // don't leak an ownerless (ergo undeletable) account.
  try {
    const result = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(accounts)
        .values({ name, personalAccount: false })
        .returning({
          accountId: accounts.accountId,
          name: accounts.name,
          personalAccount: accounts.personalAccount,
          createdAt: accounts.createdAt,
        });
      if (!inserted) throw new Error('Account insert returned no row');

      await tx.insert(accountMembers).values({
        userId: callerAccountId,
        accountId: inserted.accountId,
        accountRole: 'owner',
      });

      return inserted;
    });

    return c.json({ ok: true, account: result }, 201);
  } catch (err: any) {
    return c.json(
      { error: 'Failed to create account', details: err?.message || String(err) },
      500,
    );
  }
});

/**
 * GET /v1/admin/api/accounts
 * Query: ?search=foo&page=1&limit=50
 * Returns paginated accounts with owner email and platform role (if any).
 */
accountsApp.get('/', async (c) => {
  const q = (c.req.query('search') || '').trim();
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const offset = (page - 1) * limit;

  const searchCond = q
    ? or(
        ilike(accounts.name, `%${q}%`),
        sql`EXISTS (
          SELECT 1 FROM auth.users au
          JOIN kortix.account_members am ON am.user_id = au.id
          WHERE am.account_id = ${accounts.accountId}
            AND au.email ILIKE ${'%' + q + '%'}
          LIMIT 1
        )`,
      )
    : undefined;

  try {
    const ownerEmailSub = sql<string>`(
      SELECT au.email FROM auth.users au
      JOIN kortix.account_members am ON am.user_id = au.id
      WHERE am.account_id = ${accounts.accountId}
      ORDER BY am.joined_at ASC
      LIMIT 1
    )`;

    const memberCountSub = sql<number>`(
      SELECT count(*)::int FROM kortix.account_members am
      WHERE am.account_id = ${accounts.accountId}
    )`;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select({
          accountId: accounts.accountId,
          name: accounts.name,
          personalAccount: accounts.personalAccount,
          createdAt: accounts.createdAt,
          ownerEmail: ownerEmailSub,
          memberCount: memberCountSub,
          platformRole: platformUserRoles.role,
        })
        .from(accounts)
        .leftJoin(platformUserRoles, eq(platformUserRoles.accountId, accounts.accountId))
        .where(searchCond)
        .orderBy(desc(accounts.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(accounts)
        .where(searchCond),
    ]);

    return c.json({ accounts: rows, total, page, limit });
  } catch (e: any) {
    return c.json({ accounts: [], total: 0, page, limit, error: e?.message || String(e) }, 500);
  }
});

/**
 * GET /v1/admin/api/accounts/:id
 * Account detail with platform role and member list.
 */
accountsApp.get('/:id', async (c) => {
  const accountId = c.req.param('id');

  const [acct] = await db
    .select({
      accountId: accounts.accountId,
      name: accounts.name,
      personalAccount: accounts.personalAccount,
      setupCompleteAt: accounts.setupCompleteAt,
      createdAt: accounts.createdAt,
      updatedAt: accounts.updatedAt,
    })
    .from(accounts)
    .where(eq(accounts.accountId, accountId))
    .limit(1);

  if (!acct) return c.json({ error: 'Account not found' }, 404);

  const [roleRow] = await db
    .select({ role: platformUserRoles.role })
    .from(platformUserRoles)
    .where(eq(platformUserRoles.accountId, accountId))
    .limit(1);

  const members = await db.execute(sql`
    SELECT
      am.user_id      AS "userId",
      am.account_role AS "accountRole",
      am.joined_at    AS "joinedAt",
      u.email         AS email
    FROM kortix.account_members am
    LEFT JOIN auth.users u ON u.id = am.user_id
    WHERE am.account_id = ${accountId}
    ORDER BY
      CASE am.account_role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
      am.joined_at ASC
  `);

  return c.json({
    account: acct,
    platformRole: roleRow?.role ?? 'user',
    members,
  });
});

/**
 * GET /v1/admin/api/accounts/:id/members
 * Members-only convenience endpoint (same list as the detail payload).
 */
accountsApp.get('/:id/members', async (c) => {
  const accountId = c.req.param('id');
  const members = await db.execute(sql`
    SELECT
      am.user_id      AS "userId",
      am.account_role AS "accountRole",
      am.joined_at    AS "joinedAt",
      u.email         AS email
    FROM kortix.account_members am
    LEFT JOIN auth.users u ON u.id = am.user_id
    WHERE am.account_id = ${accountId}
    ORDER BY
      CASE am.account_role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
      am.joined_at ASC
  `);
  return c.json({ members });
});

/**
 * PUT /v1/admin/api/accounts/:id/members/:userId
 * Body: { role: 'owner' | 'admin' | 'member' }
 * Blocks demoting the last owner.
 */
accountsApp.put('/:id/members/:userId', async (c) => {
  const accountId = c.req.param('id');
  const userId = c.req.param('userId');

  const parsed = putMemberBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const nextRole = parsed.data.role;

  const [existing] = await db
    .select({ role: accountMembers.accountRole })
    .from(accountMembers)
    .where(and(eq(accountMembers.accountId, accountId), eq(accountMembers.userId, userId)))
    .limit(1);

  if (!existing) return c.json({ error: 'Member not found' }, 404);

  if (existing.role === nextRole) {
    return c.json({ ok: true, role: nextRole, unchanged: true });
  }

  if (existing.role === 'owner' && nextRole !== 'owner') {
    const owners = await countOwners(accountId);
    if (owners <= 1) {
      return c.json(
        { error: 'Cannot demote the last owner. Promote another member first.' },
        409,
      );
    }
  }

  await db
    .update(accountMembers)
    .set({ accountRole: nextRole })
    .where(and(eq(accountMembers.accountId, accountId), eq(accountMembers.userId, userId)));

  return c.json({ ok: true, role: nextRole });
});

/**
 * DELETE /v1/admin/api/accounts/:id/members/:userId
 * Removes the membership. Blocks removing the last owner.
 */
accountsApp.delete('/:id/members/:userId', async (c) => {
  const accountId = c.req.param('id');
  const userId = c.req.param('userId');

  const [existing] = await db
    .select({ role: accountMembers.accountRole })
    .from(accountMembers)
    .where(and(eq(accountMembers.accountId, accountId), eq(accountMembers.userId, userId)))
    .limit(1);

  if (!existing) return c.json({ error: 'Member not found' }, 404);

  if (existing.role === 'owner') {
    const owners = await countOwners(accountId);
    if (owners <= 1) {
      return c.json(
        { error: 'Cannot remove the last owner. Promote another member first.' },
        409,
      );
    }
  }

  await db
    .delete(accountMembers)
    .where(and(eq(accountMembers.accountId, accountId), eq(accountMembers.userId, userId)));

  return c.json({ ok: true, removed: true });
});
