import { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getPlatformRole } from '../shared/platform-roles';
import { resolveAccountId } from '../shared/resolve-account';

export async function requireAdmin(c: Context, next: Next) {
  const userId = c.get('userId') as string | undefined;
  if (!userId) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  const resolvedAccountId = await resolveAccountId(userId);
  let role = await getPlatformRole(resolvedAccountId);
  if (role === 'user' && resolvedAccountId !== userId) {
    role = await getPlatformRole(userId);
  }
  if (role !== 'admin' && role !== 'super_admin') {
    throw new HTTPException(403, { message: 'Admin access required' });
  }

  c.set('accountId', resolvedAccountId);
  c.set('platformRole', role);
  await next();
}
