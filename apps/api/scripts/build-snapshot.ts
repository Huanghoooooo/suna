#!/usr/bin/env bun
/**
 * Build a JustAVPS snapshot for Suna sandboxes.
 *
 * Spins up a minimal machine, runs the start-sandbox.sh script to pull
 * the Docker image and configure the environment, then snapshots the
 * machine and deletes it.
 *
 * Usage:
 *   bun run scripts/build-snapshot.ts                          # uses default image from config
 *   bun run scripts/build-snapshot.ts --image kortix/computer:0.8.24
 *   bun run scripts/build-snapshot.ts --image kortix/computer:0.8.24 --name kortix-computer-v0.8.24
 *   bun run scripts/build-snapshot.ts --server-type cx23 --location nbg1
 *
 * Requires:
 *   JUSTAVPS_API_URL, JUSTAVPS_API_KEY (from .env)
 */

import { parseArgs } from 'util';
import { config, SANDBOX_VERSION } from '../src/config';
import { justavpsFetch, buildCustomerCloudInitScript } from '../src/platform/providers/justavps';

const { values } = parseArgs({
  options: {
    image: { type: 'string', default: config.SANDBOX_IMAGE || `kortix/computer:${SANDBOX_VERSION}` },
    name: { type: 'string' },
    'server-type': { type: 'string', default: 'cx23' },
    location: { type: 'string', default: 'nbg1' },
    'keep-machine': { type: 'boolean', default: false },
  },
});

const dockerImage = values.image!;
const version = dockerImage.includes(':') ? dockerImage.split(':').pop()! : SANDBOX_VERSION;
const snapshotName = values.name || `kortix-computer-v${version}`;
const serverType = values['server-type']!;
const location = values.location!;

console.log(`\n=== Building snapshot: ${snapshotName} ===`);
console.log(`    Docker image:  ${dockerImage}`);
console.log(`    Server:        ${serverType} @ ${location}`);
console.log('');

console.log('[1/5] Creating machine...');
const machine = await justavpsFetch<{
  id: string;
  slug: string;
  status: string;
  ip: string | null;
}>('/machines', {
  method: 'POST',
  body: {
    provider: 'cloud',
    server_type: serverType,
    region: location,
    name: `snapshot-builder-${Date.now().toString(36)}`,
    image_id: null,
    cloud_init_script: buildCustomerCloudInitScript(dockerImage),
  },
});
console.log(`       Machine ID: ${machine.id}`);
console.log(`       Slug:       ${machine.slug}`);

console.log('[2/5] Waiting for machine to be ready...');
const MAX_WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 10_000;
const start = Date.now();

while (Date.now() - start < MAX_WAIT_MS) {
  const info = await justavpsFetch<{ status: string; ip: string | null }>(`/machines/${machine.id}`);
  const elapsed = Math.floor((Date.now() - start) / 1000);

  if (info.status === 'ready') {
    console.log(`       Ready! (${elapsed}s)`);
    break;
  }
  if (info.status === 'error' || info.status === 'deleted') {
    console.error(`ERROR: Machine entered '${info.status}' state`);
    process.exit(1);
  }

  process.stdout.write(`\r       Status: ${info.status.padEnd(20)} (${elapsed}s)`);
  await Bun.sleep(POLL_MS);
}

if (Date.now() - start >= MAX_WAIT_MS) {
  console.error('\nERROR: Timed out waiting for machine to be ready');
  process.exit(1);
}

console.log('[3/5] Waiting 90s for cloud-init + docker pull to complete...');
await Bun.sleep(90_000);

── 4. Create snapshot ──────────────────────────────────────────────────────
console.log(`[4/5] Creating snapshot: ${snapshotName}`);
const imageResp = await justavpsFetch<{ id: string; status: string }>(
  `/machines/${machine.id}/image`,
  { method: 'POST', body: { name: snapshotName } },
);
console.log(`       Image ID: ${imageResp.id}`);

// Poll until snapshot is ready
const imgStart = Date.now();
const IMG_TIMEOUT_MS = 15 * 60 * 1000;

while (Date.now() - imgStart < IMG_TIMEOUT_MS) {
  const img = await justavpsFetch<{ status: string }>(`/images/${imageResp.id}`);
  const elapsed = Math.floor((Date.now() - imgStart) / 1000);

  if (img.status === 'ready') {
    console.log(`       Snapshot ready! (${elapsed}s)`);
    break;
  }

  process.stdout.write(`\r       Snapshot status: ${img.status.padEnd(20)} (${elapsed}s)`);
  await Bun.sleep(10_000);
}

// ── 5. Delete builder machine ───────────────────────────────────────────────
if (values['keep-machine']) {
  console.log(`[5/5] Keeping machine ${machine.id} (--keep-machine)`);
} else {
  console.log(`[5/5] Deleting builder machine ${machine.id}...`);
  await justavpsFetch(`/machines/${machine.id}`, { method: 'DELETE' });
}

console.log(`
=== Done ===
    Snapshot name: ${snapshotName}
    Image ID:      ${imageResp.id}

Suna will auto-resolve this as the latest image on next sandbox creation
(resolveLatestImageId picks the highest kortix-computer-v* semver).
`);
