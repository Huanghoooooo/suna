/**
 * Account self-service member management.
 *
 * Purpose: let an account's own owner / admin add, promote, or remove
 * members WITHOUT requiring a platform-level role. The `/admin/*` UI is
 * for super_admins; this module is for a sales lead to run their sales
 * account themselves.
 *
 * Mount path: /v1/account-membership/:accountId/...
 *   - GET    /v1/account-membership/:accountId/members
 *   - POST   /v1/account-membership/:accountId/members
 *   - PUT    /v1/account-membership/:accountId/members/:userId
 *   - DELETE /v1/account-membership/:accountId/members/:userId
 *
 * Auth: supabaseAuth at the mount site. Inside each handler we call
 * assertAccountRole to ensure the caller is an owner/admin of the target
 * account (super_admin does NOT automatically pass here — they already
 * have the /admin/* UI for cross-account work; this module is deliberately
 * scoped to "people inside this account").
 *
 * Safety rails (same as /admin version):
 *   - Admin cannot mutate owners; can only promote/demote between
 *     member↔admin and remove members/admins.
 *   - Owner can do anything, except demoting/removing the last owner.
 *   - Duplicate-email on create → 409 via Supabase error; account_members
 *     insert failure rolls back the auth user.
 */

import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { db } from '../shared/db';
import { accounts, accountMembers } from '@kortix/db';
import { getSupabase } from '../shared/supabase';

export const memberSelfServiceApp = new Hono<AppEnv>();

type AccountRole = 'owner' | 'admin' | 'member';

const accountRoleSchema = z.enum(['owner', 'admin', 'member']);
const putMemberBody = z.object({ role: accountRoleSchema });
const createMemberBody = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  accountRole: accountRoleSchema.default('member'),
});

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

async function countOwners(accountId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(accountMembers)
    .where(
      and(eq(accountMembers.accountId, accountId), eq(accountMembers.accountRole, 'owner')),
    );
  return row?.n ?? 0;
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
 * Create a new Supabase user and add them to this account at the given role.
 * Caller must be owner or admin of this account.
 */
memberSelfServiceApp.post('/:accountId/members', async (c) => {
  const callerUserId = c.get('userId') as string;
  const accountId = c.req.param('accountId');

  const callerRole = await getCallerRole(callerUserId, accountId);
  if (callerRole !== 'owner' && callerRole !== 'admin') {
    return c.json({ error: 'Only account owners or admins can create members' }, 403);
  }

  const parsed = createMemberBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const { email, password, accountRole } = parsed.data;

  // admin cannot create an owner — only owners grant owner.
  if (accountRole === 'owner' && callerRole !== 'owner') {
    return c.json({ error: 'Only owners can grant owner role' }, 403);
  }

  const [acct] = await db
    .select({ accountId: accounts.accountId })
    .from(accounts)
    .where(eq(accounts.accountId, accountId))
    .limit(1);
  if (!acct) return c.json({ error: 'Account not found' }, 404);

  const supabase = getSupabase();
  const created = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (created.error || !created.data?.user?.id) {
    const message = created.error?.message || 'Failed to create user';
    const isDuplicate = /already|exists|registered/i.test(message);
    return c.json({ error: message }, isDuplicate ? 409 : 500);
  }

  const newUserId = created.data.user.id;

  try {
    await db
      .insert(accountMembers)
      .values({ userId: newUserId, accountId, accountRole })
      .onConflictDoUpdate({
        target: [accountMembers.userId, accountMembers.accountId],
        set: { accountRole },
      });
  } catch (err: any) {
    await supabase.auth.admin.deleteUser(newUserId).catch(() => {});
    return c.json(
      { error: 'Failed to attach member; user creation rolled back', details: err?.message || String(err) },
      500,
    );
  }

  return c.json({ ok: true, userId: newUserId, email, accountId, accountRole });
});

/**
 * PUT /v1/account-membership/:accountId/members/:userId
 * Change a member's account role. Hierarchy:
 *   - owner: can set any role
 *   - admin: can only flip between member and admin; cannot touch owners
 */
memberSelfServiceApp.put('/:accountId/members/:userId', async (c) => {
  const callerUserId = c.get('userId') as string;
  const accountId = c.req.param('accountId');
  const targetUserId = c.req.param('userId');

  const callerRole = await getCallerRole(callerUserId, accountId);
  if (callerRole !== 'owner' && callerRole !== 'admin') {
    return c.json({ error: 'Only account owners or admins can change roles' }, 403);
  }

  const parsed = putMemberBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const nextRole = parsed.data.role;

  const [existing] = await db
    .select({ role: accountMembers.accountRole })
    .from(accountMembers)
    .where(and(eq(accountMembers.accountId, accountId), eq(accountMembers.userId, targetUserId)))
    .limit(1);
  if (!existing) return c.json({ error: 'Member not found' }, 404);
  const currentRole = existing.role as AccountRole;

  if (currentRole === nextRole) {
    return c.json({ ok: true, role: nextRole, unchanged: true });
  }

  if (callerRole === 'admin') {
    if (currentRole === 'owner' || nextRole === 'owner') {
      return c.json({ error: 'Only owners can manage the owner role' }, 403);
    }
  }

  if (currentRole === 'owner' && nextRole !== 'owner') {
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
    .where(and(eq(accountMembers.accountId, accountId), eq(accountMembers.userId, targetUserId)));

  return c.json({ ok: true, role: nextRole });
});

/**
 * DELETE /v1/account-membership/:accountId/members/:userId
 * Remove a member. Same hierarchy as PUT.
 */
memberSelfServiceApp.delete('/:accountId/members/:userId', async (c) => {
  const callerUserId = c.get('userId') as string;
  const accountId = c.req.param('accountId');
  const targetUserId = c.req.param('userId');

  const callerRole = await getCallerRole(callerUserId, accountId);
  if (callerRole !== 'owner' && callerRole !== 'admin') {
    return c.json({ error: 'Only account owners or admins can remove members' }, 403);
  }

  const [existing] = await db
    .select({ role: accountMembers.accountRole })
    .from(accountMembers)
    .where(and(eq(accountMembers.accountId, accountId), eq(accountMembers.userId, targetUserId)))
    .limit(1);
  if (!existing) return c.json({ error: 'Member not found' }, 404);
  const currentRole = existing.role as AccountRole;

  if (callerRole === 'admin' && currentRole === 'owner') {
    return c.json({ error: 'Only owners can remove owners' }, 403);
  }

  if (currentRole === 'owner') {
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
    .where(and(eq(accountMembers.accountId, accountId), eq(accountMembers.userId, targetUserId)));

  return c.json({ ok: true, removed: true });
});
