/**
 * Account self-service member management.
 *
 * Purpose: expose read-only membership information for the current user's
 * account. Mutating endpoints are intentionally closed because this deployment
 * uses a 1:1 user-account model.
 *
 * Mount path: /v1/account-membership/:accountId/...
 *   - GET    /v1/account-membership/:accountId/members
 *   - POST   /v1/account-membership/:accountId/members              (disabled)
 *   - PUT    /v1/account-membership/:accountId/members/:userId      (disabled)
 *   - DELETE /v1/account-membership/:accountId/members/:userId      (disabled)
 *
 * Auth: supabaseAuth at the mount site. Inside each handler we call
 * assertAccountRole to ensure the caller is an owner/admin of the target
 * account (super_admin does NOT automatically pass here — they already
 * have the /admin/* UI for cross-account work; this module is deliberately
 * scoped to "people inside this account").
 *
 * New users must be provisioned through /v1/admin/api/users so each auth user
 * receives their own personal account and isolated sandbox scope.
 */

import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import type { AppEnv } from '../types';
import { db } from '../shared/db';
import { accountMembers } from '@kortix/db';

export const memberSelfServiceApp = new Hono<AppEnv>();

type AccountRole = 'owner' | 'admin' | 'member';

/**
 * Assert the caller is owner or admin of the target account. On failure
 * sends an appropriate HTTP response and returns null; callers should
 * short-circuit when this returns null.
 */
async function getCallerRole(callerUserId: string, accountId: string): Promise<AccountRole | null> {
  const [row] = await db
    .select({ role: accountMembers.accountRole })
    .from(accountMembers)
    .where(
      and(eq(accountMembers.userId, callerUserId), eq(accountMembers.accountId, accountId)),
    )
    .limit(1);
  return (row?.role as AccountRole | undefined) ?? null;
}

/**
 * GET /v1/account-membership/:accountId/members
 * List members of an account. Any member can read.
 */
memberSelfServiceApp.get('/:accountId/members', async (c) => {
  const callerUserId = c.get('userId') as string;
  const accountId = c.req.param('accountId');

  // Verify the account exists and caller is a member (any role).
  const callerRole = await getCallerRole(callerUserId, accountId);
  if (!callerRole) return c.json({ error: 'Not a member of this account' }, 403);

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

  return c.json({ callerRole, members });
});

/**
 * POST /v1/account-membership/:accountId/members
 */
memberSelfServiceApp.post('/:accountId/members', async (c) => {
  return c.json({
    error: 'Team membership mutation is disabled. Create users through /v1/admin/api/users for 1:1 account isolation.',
  }, 410);
});

/**
 * PUT /v1/account-membership/:accountId/members/:userId
 * Change a member's account role. Hierarchy:
 *   - owner: can set any role
 *   - admin: can only flip between member and admin; cannot touch owners
 */
memberSelfServiceApp.put('/:accountId/members/:userId', async (c) => {
  return c.json({
    error: 'Team membership mutation is disabled in 1:1 account mode.',
  }, 410);
});

/**
 * DELETE /v1/account-membership/:accountId/members/:userId
 * Remove a member. Same hierarchy as PUT.
 */
memberSelfServiceApp.delete('/:accountId/members/:userId', async (c) => {
  return c.json({
    error: 'Team membership mutation is disabled in 1:1 account mode.',
  }, 410);
});
