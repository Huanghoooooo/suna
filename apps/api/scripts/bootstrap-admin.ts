#!/usr/bin/env bun
/**
 * Bootstrap the first platform super_admin from an env variable.
 *
 * Why this script exists:
 *   kortix.platform_user_roles is intentionally not writable from any HTTP
 *   endpoint — the only way to grant the first super_admin is at the database
 *   level. This script is the supported, idempotent way to do it so customer
 *   operators don't need to hand-write SQL during deployment.
 *
 * Usage:
 *   # via env
 *   INITIAL_SUPER_ADMIN_EMAIL=ops@acme.com bun run scripts/bootstrap-admin.ts
 *
 *   # via CLI flag (overrides env)
 *   bun run scripts/bootstrap-admin.ts --email ops@acme.com
 *
 * Behaviour:
 *   - Looks up auth.users by email (case-insensitive).
 *   - Finds the user's personal account via kortix.account_members.
 *   - Upserts a 'super_admin' row in kortix.platform_user_roles.
 *   - Idempotent: re-running with the same email is a no-op.
 *
 * Requires:
 *   DATABASE_URL — same Postgres/Supabase DB used by the API.
 */

import postgres from 'postgres';

function parseArgs(): { email: string | null } {
  const args = process.argv.slice(2);
  let email: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--email' || args[i] === '-e') && args[i + 1]) {
      email = args[i + 1]!;
      i++;
    }
  }
  if (!email) email = process.env.INITIAL_SUPER_ADMIN_EMAIL?.trim() || null;
  return { email };
}

async function main() {
  const { email } = parseArgs();

  if (!email) {
    console.error(
      'Error: no email provided.\n' +
      '  Set INITIAL_SUPER_ADMIN_EMAIL, or pass --email <addr>.',
    );
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL is not set.');
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

  try {
    const users = await sql<{ id: string; email: string }[]>`
      SELECT id, email
      FROM auth.users
      WHERE lower(email) = lower(${email})
      LIMIT 1
    `;

    if (users.length === 0) {
      console.error(
        `Error: no user found with email "${email}".\n` +
        '  The user must sign up through the normal flow first, then re-run this script.',
      );
      process.exit(2);
    }

    const user = users[0]!;

    const memberships = await sql<{ account_id: string; personal_account: boolean; account_name: string }[]>`
      SELECT am.account_id, a.personal_account, a.name AS account_name
      FROM kortix.account_members am
      JOIN kortix.accounts a ON a.account_id = am.account_id
      WHERE am.user_id = ${user.id}
      ORDER BY a.personal_account DESC, a.created_at ASC
      LIMIT 1
    `;

    if (memberships.length === 0) {
      console.error(
        `Error: user "${email}" has no account membership.\n` +
        '  Sign in through the app at least once to provision an account, then re-run.',
      );
      process.exit(3);
    }

    const { account_id, personal_account, account_name } = memberships[0]!;

    const existing = await sql<{ role: string }[]>`
      SELECT role FROM kortix.platform_user_roles
      WHERE account_id = ${account_id}
      LIMIT 1
    `;

    if (existing.length > 0 && existing[0]!.role === 'super_admin') {
      console.log(
        `✓ ${email} is already a super_admin (account "${account_name}", ${account_id}). ` +
        'No changes made.',
      );
      return;
    }

    await sql`
      INSERT INTO kortix.platform_user_roles (account_id, role, granted_by)
      VALUES (${account_id}, 'super_admin', ${account_id})
      ON CONFLICT (account_id) DO UPDATE
        SET role = 'super_admin'
    `;

    console.log(
      `✓ Granted super_admin to ${email}\n` +
      `  account:  ${account_name} (${account_id})${personal_account ? ' [personal]' : ''}\n` +
      `  user_id:  ${user.id}`,
    );
  } finally {
    await sql.end({ timeout: 2 });
  }
}

main().catch((err) => {
  console.error('bootstrap-admin failed:', err?.message || err);
  process.exit(1);
});
