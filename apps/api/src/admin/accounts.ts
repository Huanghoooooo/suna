/**
 * Account browsing for the admin panel.
 *
 * Mounted at /v1/admin/api/accounts/*, inheriting supabaseAuth + requireAdmin.
 *
 * This deployment uses a 1:1 user-account model. Admins can create users via
 * /v1/admin/api/users and assign platform roles, but team account/member
 * mutation endpoints are closed to avoid cross-user resource leakage.
 */

import { Hono } from 'hono';
import { desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { AppEnv } from '../types';
import { db } from '../shared/db';
import { accounts, platformUserRoles } from '@kortix/db';

export const accountsApp = new Hono<AppEnv>();

/**
 * POST /v1/admin/api/accounts
 * Body: { name }
 *
 * Disabled in 1:1 account mode. Use /v1/admin/api/users to create a user
 * together with that user's personal account.
 */
accountsApp.post('/', async (c) => {
  return c.json({
    error: 'Team account creation is disabled. Create users through /v1/admin/api/users for 1:1 account isolation.',
  }, 410);
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
  return c.json({
    error: 'Account membership mutation is disabled in 1:1 account mode.',
  }, 410);
});

/**
 * DELETE /v1/admin/api/accounts/:id/members/:userId
 * Removes the membership. Blocks removing the last owner.
 */
accountsApp.delete('/:id/members/:userId', async (c) => {
  return c.json({
    error: 'Account membership mutation is disabled in 1:1 account mode.',
  }, 410);
});
