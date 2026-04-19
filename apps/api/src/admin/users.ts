/**
 * Admin user creation — lets platform admins provision new users and pin
 * them to a specific account at a specific role in one shot.
 *
 * Why this exists:
 *   Enterprise deployments disable public signup (Supabase Auth setting),
 *   so there is no self-serve path for employees to get an account. An
 *   admin in /admin/accounts/[id] clicks "+ 新建成员", picks an email +
 *   initial password + role, and this endpoint creates the Supabase auth
 *   user AND the kortix.account_members row in one request.
 *
 * Auth & guards (inherit from adminApp):
 *   supabaseAuth + requireAdmin — both admin and super_admin can call.
 *
 * Side effects:
 *   1. supabase.auth.admin.createUser (email_confirm: true so the employee
 *      can log in immediately without a verification email).
 *   2. INSERT kortix.account_members (user_id, account_id, account_role).
 *   3. NO kortix.accounts row is created here — we attach to an existing
 *      account chosen by the admin. Suna's application-layer auto-
 *      provisioning in shared/resolve-account.ts will still create a
 *      personal account lazily the first time the user logs in, so they
 *      end up in TWO accounts: the chosen target + their auto-created
 *      personal. That's fine and matches Suna's existing UX.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { db } from '../shared/db';
import { accounts, accountMembers } from '@kortix/db';
import { getSupabase } from '../shared/supabase';

export const usersApp = new Hono<AppEnv>();

const createUserBody = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  accountId: z.string().uuid(),
  accountRole: z.enum(['owner', 'admin', 'member']).default('member'),
});

/**
 * POST /v1/admin/api/users
 * Body: { email, password, accountId, accountRole }
 */
usersApp.post('/', async (c) => {
  const parsed = createUserBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const { email, password, accountId, accountRole } = parsed.data;

  // Ensure the target account exists — avoids creating an orphaned user
  // when the admin picked a bad id.
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
    // Supabase returns a 422-ish error when the email is already registered.
    const isDuplicate = /already|exists|registered/i.test(message);
    return c.json({ error: message }, isDuplicate ? 409 : 500);
  }

  const userId = created.data.user.id;

  try {
    await db
      .insert(accountMembers)
      .values({ userId, accountId, accountRole })
      .onConflictDoUpdate({
        target: [accountMembers.userId, accountMembers.accountId],
        set: { accountRole },
      });
  } catch (err: any) {
    // Membership insert failed after user was created — rollback the auth
    // user so we don't leak a dangling row with no kortix membership.
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    return c.json(
      { error: 'Failed to assign member role; user creation rolled back', details: err?.message || String(err) },
      500,
    );
  }

  return c.json({
    ok: true,
    userId,
    email,
    accountId,
    accountRole,
  });
});
