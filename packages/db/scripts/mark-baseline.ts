#!/usr/bin/env bun
/**
 * Mark the baseline migration (0000_baseline) as already applied.
 *
 * Run this ONCE on an existing database that was set up via db:push or
 * Supabase migrations. It inserts the journal entry into the drizzle
 * migrations table so that `db:migrate` won't try to re-create everything.
 *
 * Usage:
 *   DATABASE_URL=... bun run scripts/mark-baseline.ts
 */
import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join } from 'path';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

// Read the journal to get the baseline entry
const journal = JSON.parse(
  readFileSync(join(import.meta.dir, '../drizzle/meta/_journal.json'), 'utf-8'),
);
const baseline = journal.entries.find((e: { tag: string }) => e.tag === '0000_baseline');
if (!baseline) {
  console.error('Could not find 0000_baseline in journal');
  await sql.end();
  process.exit(1);
}

// Read the baseline SQL to compute its hash (drizzle uses a simple hash)
const baselineSql = readFileSync(
  join(import.meta.dir, '../drizzle/0000_baseline.sql'),
  'utf-8',
);

// Drizzle stores a hash of the migration SQL
function hashString(s: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(s);
  return hasher.digest('hex');
}

const hash = hashString(baselineSql);

// Ensure the drizzle migrations table exists
await sql`
  CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )
`;

// Check if already marked
const existing = await sql`
  SELECT id FROM "drizzle"."__drizzle_migrations" WHERE hash = ${hash}
`;

if (existing.length > 0) {
  console.log('Baseline migration already marked as applied. Nothing to do.');
} else {
  await sql`
    INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
    VALUES (${hash}, ${baseline.when})
  `;
  console.log('Baseline migration marked as applied.');
}

await sql.end();
