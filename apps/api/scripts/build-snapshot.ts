#!/usr/bin/env bun
/**
 * Build a JustAVPS snapshot for Suna sandboxes.
 *
 * Self-contained — only needs JUSTAVPS_API_URL and JUSTAVPS_API_KEY.
 * Works both locally (reads .env) and in CI (env vars set by GitHub secrets).
 *
 * Usage:
 *   bun run scripts/build-snapshot.ts --image kortix/computer:0.8.26
 *   bun run scripts/build-snapshot.ts --image kortix/computer:0.8.26 --name kortix-computer-v0.8.26
 *   bun run scripts/build-snapshot.ts --server-type cx23 --location nbg1
 *   bun run scripts/build-snapshot.ts --keep-machine
 *
 * Env:
 *   JUSTAVPS_API_URL (default: https://justavps.com/api/v1)
 *   JUSTAVPS_API_KEY (required)
 */

import { parseArgs } from 'util';
import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

// Load .env if present (local dev), otherwise rely on CI env vars
const envPath = resolve(import.meta.dir, '../.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

const API_URL = (process.env.JUSTAVPS_API_URL || 'https://justavps.com/api/v1').replace(/\/$/, '');
const API_KEY = process.env.JUSTAVPS_API_KEY;
if (!API_KEY) {
  console.error('JUSTAVPS_API_KEY is required');
  process.exit(1);
}

const defaultVersion = 'latest';

const { values } = parseArgs({
  options: {
    image: { type: 'string', default: `kortix/computer:${defaultVersion}` },
    name: { type: 'string' },
    'server-type': { type: 'string', default: 'cx23' },
    location: { type: 'string', default: 'nbg1' },
    'keep-machine': { type: 'boolean', default: false },
  },
});

const dockerImage = values.image!;
const version = dockerImage.includes(':') ? dockerImage.split(':').pop()! : defaultVersion;
const snapshotName = values.name || `kortix-computer-v${version}`;
const serverType = values['server-type']!;
const location = values.location!;

async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${API_KEY}` };
  if (opts.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`JustAVPS ${opts.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

const cloudInitScript = [
  'curl -fsSL https://raw.githubusercontent.com/kortix-ai/suna/main/scripts/start-sandbox.sh -o /usr/local/bin/kortix-start-sandbox.sh',
  'chmod +x /usr/local/bin/kortix-start-sandbox.sh',
  `/usr/local/bin/kortix-start-sandbox.sh ${shellEscape(dockerImage)}`,
].join('\n');

console.log(`\n=== Building snapshot: ${snapshotName} ===`);
console.log(`    Image:   ${dockerImage}`);
console.log(`    Server:  ${serverType} @ ${location}`);
console.log(`    API:     ${API_URL}\n`);

// 1. Create machine
console.log('[1/5] Creating machine...');
const machine = await api<{ id: string; slug: string }>('/machines', {
  method: 'POST',
  body: {
    provider: 'cloud',
    server_type: serverType,
    region: location,
    name: `snapshot-builder-${Date.now().toString(36)}`,
    image_id: null,
    cloud_init_script: cloudInitScript,
  },
});
console.log(`       ID: ${machine.id}  Slug: ${machine.slug}`);

// 2. Wait for ready
console.log('[2/5] Waiting for machine...');
const MAX_WAIT = 10 * 60 * 1000;
const POLL = 10_000;
const t0 = Date.now();

while (Date.now() - t0 < MAX_WAIT) {
  const info = await api<{ status: string }>(`/machines/${machine.id}`);
  const elapsed = Math.floor((Date.now() - t0) / 1000);

  if (info.status === 'ready') {
    console.log(`       Ready (${elapsed}s)`);
    break;
  }
  if (info.status === 'error' || info.status === 'deleted') {
    console.error(`ERROR: Machine ${info.status}`);
    process.exit(1);
  }
  process.stdout.write(`\r       ${info.status.padEnd(20)} (${elapsed}s)`);
  await Bun.sleep(POLL);
}

if (Date.now() - t0 >= MAX_WAIT) {
  console.error('\nERROR: Timeout waiting for machine');
  process.exit(1);
}

// 3. Wait for cloud-init + docker pull
console.log('[3/5] Waiting 90s for cloud-init...');
await Bun.sleep(90_000);

// 4. Create snapshot
console.log(`[4/5] Creating snapshot: ${snapshotName}`);
const img = await api<{ id: string }>(`/machines/${machine.id}/image`, {
  method: 'POST',
  body: { name: snapshotName },
});
console.log(`       Image ID: ${img.id}`);

const t1 = Date.now();
const IMG_TIMEOUT = 15 * 60 * 1000;

while (Date.now() - t1 < IMG_TIMEOUT) {
  const status = await api<{ status: string }>(`/images/${img.id}`);
  const elapsed = Math.floor((Date.now() - t1) / 1000);

  if (status.status === 'ready') {
    console.log(`       Ready (${elapsed}s)`);
    break;
  }
  process.stdout.write(`\r       ${status.status.padEnd(20)} (${elapsed}s)`);
  await Bun.sleep(10_000);
}

// 5. Cleanup
if (values['keep-machine']) {
  console.log(`[5/5] Keeping machine ${machine.id}`);
} else {
  console.log(`[5/5] Deleting builder machine...`);
  await api(`/machines/${machine.id}`, { method: 'DELETE' });
}

console.log(`\n=== Done ===`);
console.log(`    Snapshot: ${snapshotName}`);
console.log(`    Image ID: ${img.id}`);
console.log(`    Auto-resolved on next sandbox creation.\n`);
