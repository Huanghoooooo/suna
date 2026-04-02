#!/usr/bin/env bun
/**
 * Run drizzle-kit migrate against the database.
 *
 * Usage:
 *   DATABASE_URL=... bun run scripts/migrate.ts
 *
 * This is a thin wrapper so `pnpm db:migrate` works from the monorepo root.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
const db = drizzle(sql);

console.log('Running migrations...');
await migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations complete.');

await sql.end();
