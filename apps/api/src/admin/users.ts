/**
 * Admin user provisioning for the 1:1 user/account model.
 *
 * Enterprise deployments disable public signup, so platform admins create
 * users here. Each user gets exactly one personal account whose account_id
 * is the Supabase user id. All user-scoped resources hang from that account.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { db } from '../shared/db';
import { accounts, accountMembers } from '@kortix/db';
import { getSupabase } from '../shared/supabase';

export const usersApp = new Hono<AppEnv>();

const createUserBody = z.object({
  email: z.string().email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().trim().max(255).optional(),
});

/**
 * POST /v1/admin/api/users
 * Body: { email, password, displayName? }
 */
usersApp.post('/', async (c) => {
  const parsed = createUserBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', issues: parsed.error.issues }, 400);
  }
  const { email, password, displayName } = parsed.data;

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
  const accountId = userId;
  const accountName = displayName || email;

  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(accounts)
        .values({
          accountId,
          name: accountName,
          personalAccount: true,
        })
        .onConflictDoNothing();

      await tx
        .insert(accountMembers)
        .values({ userId, accountId, accountRole: 'owner' })
        .onConflictDoNothing();
    });
  } catch (err: any) {
    await supabase.auth.admin.deleteUser(userId).catch(() => {});
    return c.json(
      { error: 'Failed to provision user account; user creation rolled back', details: err?.message || String(err) },
      500,
    );
  }

  return c.json({
    ok: true,
    userId,
    email,
    accountId,
    accountRole: 'owner',
  });
});
