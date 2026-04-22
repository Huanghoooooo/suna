/**
 * Platform role management — grant/revoke admin and super_admin.
 *
 * Auth & hierarchy:
 *   - All routes require requireAdmin (mounted at parent level).
 *   - super_admin: can set any role on any account.
 *   - admin:       can grant/revoke 'admin' on accounts currently at 'user'
 *                  or 'admin'. Cannot touch super_admin accounts. Cannot
 *                  grant super_admin.
 *
 * Safety rails:
 *   - Demoting the last super_admin is always blocked.
 *   - Granting super_admin via API is allowed only for existing super_admins.
 *     The first super_admin must come from scripts/bootstrap-admin.ts.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { db } from '../shared/db';
import { accounts, platformUserRoles } from '@kortix/db';
import type { PlatformRole } from '../shared/platform-roles';

export const platformRolesApp = new Hono<AppEnv>();

const roleSchema = z.enum(['user', 'admin', 'super_admin']);
const putBodySchema = z.object({ role: roleSchema });

/**
 * Return the caller's platform role as set by requireAdmin middleware.
 */
function callerRole(c: { get: (key: string) => unknown }): PlatformRole {
  const role = c.get('platformRole') as PlatformRole | undefined;
  if (!role) throw new HTTPException(500, { message: 'platformRole missing from context' });
  return role;
}

/**
 * Check whether `caller` can transition `targetCurrent` → `targetNext`.
 * Throws HTTPException(403) if not allowed.
 */
function assertCanTransition(
  caller: PlatformRole,
  targetCurrent: PlatformRole,
  targetNext: PlatformRole,
) {
  if (caller === 'super_admin') return;
  if (caller === 'admin') {
    if (targetCurrent === 'super_admin' || targetNext === 'super_admin') {
      throw new HTTPException(403, { message: 'Only super_admin can manage super_admin role' });
    }
    return;
  }
  throw new HTTPException(403, { message: 'Admin access required' });
}

async function countSuperAdmins(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(platformUserRoles)
    .where(eq(platformUserRoles.role, 'super_admin'));
  return row?.n ?? 0;
}

async function getTargetRole(accountId: string): Promise<PlatformRole> {
  const [row] = await db
    .select({ role: platformUserRoles.role })
    .from(platformUserRoles)
    .where(eq(platformUserRoles.accountId, accountId))
    .limit(1);
  return (row?.role as PlatformRole) ?? 'user';
}

/**
 * GET /v1/admin/api/platform-roles
 * List accounts with an explicit platform role (admin/super_admin rows).
 * Accounts not in platform_user_roles are implicit 'user' and not listed here.
 */
platformRolesApp.get('/', async (c) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        pr.account_id    AS "accountId",
        pr.role          AS role,
        pr.granted_by    AS "grantedBy",
        pr.created_at    AS "createdAt",
        a.name           AS "accountName",
        a.personal_account AS "personalAccount",
        (
          SELECT u.email FROM auth.users u
          JOIN kortix.account_members am ON am.user_id = u.id
          WHERE am.account_id = pr.account_id
          ORDER BY am.joined_at ASC
          LIMIT 1
        )                AS "ownerEmail"
      FROM kortix.platform_user_roles pr
      JOIN kortix.accounts a ON a.account_id = pr.account_id
      ORDER BY
        CASE pr.role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        a.name ASC
    `);
    return c.json({ roles: rows });
  } catch (e: any) {
    return c.json({ roles: [], error: e?.message || String(e) }, 500);
  }
});

/**
 * PUT /v1/admin/api/platform-roles/:accountId
 * Body: { role: 'user' | 'admin' | 'super_admin' }
 * Setting role='user' removes the platform_user_roles row (revoke).
 */
platformRolesApp.put('/:accountId', async (c) => {
  const caller = callerRole(c);
  const callerAccountId = (c.get('accountId') as string | undefined) ?? (c.get('userId') as string);
  const targetAccountId = c.req.param('accountId');

  const parseResult = putBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parseResult.success) {
    return c.json({ error: 'Invalid body', issues: parseResult.error.issues }, 400);
  }
  const nextRole = parseResult.data.role;

  const [acct] = await db
    .select({ accountId: accounts.accountId })
    .from(accounts)
    .where(eq(accounts.accountId, targetAccountId))
    .limit(1);
  if (!acct) return c.json({ error: 'Account not found' }, 404);

  const currentRole = await getTargetRole(targetAccountId);

  if (currentRole === nextRole) {
    return c.json({ ok: true, role: nextRole, unchanged: true });
  }

  assertCanTransition(caller, currentRole, nextRole);

  if (currentRole === 'super_admin') {
    const total = await countSuperAdmins();
    if (total <= 1) {
      return c.json(
        { error: 'Cannot demote the last super_admin. Promote another first.' },
        409,
      );
    }
  }

  if (nextRole === 'user') {
    await db
      .delete(platformUserRoles)
      .where(eq(platformUserRoles.accountId, targetAccountId));
    return c.json({ ok: true, role: 'user', revoked: true });
  }

  await db
    .insert(platformUserRoles)
    .values({
      accountId: targetAccountId,
      role: nextRole,
      grantedBy: callerAccountId,
    })
    .onConflictDoUpdate({
      target: platformUserRoles.accountId,
      set: { role: nextRole, grantedBy: callerAccountId },
    });

  return c.json({ ok: true, role: nextRole });
});

/**
 * DELETE /v1/admin/api/platform-roles/:accountId
 * Equivalent to PUT with role='user'. Revokes any platform role.
 */
platformRolesApp.delete('/:accountId', async (c) => {
  const caller = callerRole(c);
  const targetAccountId = c.req.param('accountId');

  const currentRole = await getTargetRole(targetAccountId);
  if (currentRole === 'user') {
    return c.json({ ok: true, revoked: false, alreadyNone: true });
  }

  assertCanTransition(caller, currentRole, 'user');

  if (currentRole === 'super_admin') {
    const total = await countSuperAdmins();
    if (total <= 1) {
      return c.json(
        { error: 'Cannot demote the last super_admin. Promote another first.' },
        409,
      );
    }
  }

  await db
    .delete(platformUserRoles)
    .where(eq(platformUserRoles.accountId, targetAccountId));

  return c.json({ ok: true, revoked: true });
});
