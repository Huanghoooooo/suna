import type { ResolvedEndpoint } from '../platform/providers';
import type { StepResult } from './types';
import { execOnHost } from './exec';

export function getCurrentImage(endpoint: ResolvedEndpoint, containerName: string): Promise<StepResult> {
  return execOnHost(
    endpoint,
    `docker inspect --format='{{.Config.Image}}' ${containerName}`,
    10,
  );
}

export async function pullImage(endpoint: ResolvedEndpoint, image: string): Promise<StepResult> {
  // 1. Check if image already exists locally
  const exists = await execOnHost(endpoint, `docker image inspect ${image} >/dev/null 2>&1 && echo cached`, 10);
  if (exists.stdout?.trim() === 'cached') {
    return { success: true, stdout: 'cached', stderr: '', exitCode: 0, durationMs: 0 };
  }

  // 2. Pre-flight: verify Docker daemon is responsive
  const dockerCheck = await execOnHost(endpoint, 'docker info >/dev/null 2>&1 && echo ok', 10);
  if (dockerCheck.stdout?.trim() !== 'ok') {
    return { success: false, stdout: '', stderr: 'Docker daemon is not running or not responsive', exitCode: -1, durationMs: 0 };
  }

  // 3. Pull via systemd-run (detached) — the CF proxy times out on long pulls.
  //    Use a unique unit name to avoid conflicts with stale units from previous attempts.
  const unitName = `kortix-pull-${Date.now()}`;

  // Clean up any stale pull units first
  await execOnHost(endpoint, 'systemctl reset-failed kortix-pull-* 2>/dev/null; systemctl stop kortix-pull-* 2>/dev/null || true', 10);

  const startPull = await execOnHost(
    endpoint,
    `systemd-run --unit=${unitName} --description="Pull ${image}" docker pull ${image}`,
    15,
  );

  if (!startPull.success) {
    return {
      success: false,
      stdout: startPull.stdout,
      stderr: `Failed to start pull: ${startPull.stderr}`,
      exitCode: startPull.exitCode,
      durationMs: 0,
    };
  }

  // 4. Poll until the image exists or the pull unit exits
  const startTime = Date.now();
  const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes max

  while (Date.now() - startTime < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 5000));

    // Check if image is now available
    const check = await execOnHost(endpoint, `docker image inspect ${image} >/dev/null 2>&1 && echo ready`, 10);
    if (check.stdout?.trim() === 'ready') {
      const elapsed = Date.now() - startTime;
      return { success: true, stdout: 'pulled', stderr: '', exitCode: 0, durationMs: elapsed };
    }

    // Check if the systemd pull unit has exited (failed or succeeded)
    const unitStatus = await execOnHost(
      endpoint,
      `systemctl is-active ${unitName} 2>/dev/null || echo stopped`,
      5,
    );
    const status = unitStatus.stdout?.trim();
    if (status === 'failed' || status === 'stopped' || status === 'inactive') {
      // Unit finished but image not found — pull failed
      const logs = await execOnHost(endpoint, `journalctl -u ${unitName} --no-pager -n 20 2>/dev/null || true`, 10);
      const logOutput = logs.stdout?.trim() || 'No logs available';
      return {
        success: false,
        stdout: '',
        stderr: `Docker pull failed for ${image}. Logs:\n${logOutput}`,
        exitCode: -1,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // Timeout — kill the pull unit and report
  await execOnHost(endpoint, `systemctl stop ${unitName} 2>/dev/null || true`, 5);
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  return {
    success: false,
    stdout: '',
    stderr: `Pull timed out after ${elapsed}s for ${image}. The image may be too large for this machine's connection speed.`,
    exitCode: -1,
    durationMs: Date.now() - startTime,
  };
}

export async function checkpointSqlite(endpoint: ResolvedEndpoint, containerName: string): Promise<StepResult> {
  return execOnHost(
    endpoint,
    `docker exec ${containerName} python3 -c "import sqlite3,glob
for db in glob.glob('/workspace/.local/share/opencode/*.db'):
 c=sqlite3.connect(db);c.execute('PRAGMA wal_checkpoint(TRUNCATE)');c.close()" 2>/dev/null || true`,
    10,
  );
}

export async function stopAndStartContainer(
  endpoint: ResolvedEndpoint,
  containerName: string,
  runCommand: string,
): Promise<StepResult> {
  const scriptLines = [
    '#!/bin/bash',
    // Disable systemd service to prevent auto-restart
    'systemctl disable --now justavps-docker 2>/dev/null || true',
    'systemctl disable --now kortix-sandbox 2>/dev/null || true',
    // Stop and remove container — retry until name is free
    `docker stop -t 10 ${containerName} 2>/dev/null || true`,
    `docker rm -f ${containerName} 2>/dev/null || true`,
    `for i in $(seq 1 10); do docker inspect ${containerName} >/dev/null 2>&1 || break; sleep 1; done`,
    // Start new container
    runCommand,
  ].join('\n');

  const b64 = Buffer.from(scriptLines).toString('base64');
  const unitName = `kortix-update-${Date.now()}`;

  // Write script to temp file, then run it via systemd-run (survives connection drop)
  await execOnHost(
    endpoint,
    `echo '${b64}' | base64 -d > /tmp/kortix-update.sh && chmod +x /tmp/kortix-update.sh`,
    5,
  );

  const result = await execOnHost(
    endpoint,
    `systemctl reset-failed kortix-update-restart 2>/dev/null || true; systemd-run --unit=${unitName} --description="Kortix sandbox update" /tmp/kortix-update.sh`,
    15,
  );

  if (!result.success && (result.stderr.includes('502') || result.stderr.includes('aborted') || result.stderr.includes('timed out'))) {
    return { success: true, stdout: '', stderr: '', exitCode: 0, durationMs: result.durationMs };
  }
  return result;
}

export async function verifyContainer(
  endpoint: ResolvedEndpoint,
  expectedImage: string,
  containerName: string,
  retries = 50,
): Promise<StepResult> {
  for (let i = 0; i < retries; i++) {
    const result = await execOnHost(
      endpoint,
      `docker inspect --format='{{.Config.Image}}' ${containerName}`,
      10,
    );
    const running = result.stdout.trim().replace(/'/g, '');
    if (result.success && running === expectedImage) return result;
    const delay = Math.min(2000 * Math.pow(1.5, i), 15000);
    await new Promise((r) => setTimeout(r, delay));
  }
  return {
    success: false,
    stdout: '',
    stderr: `Container not running expected image ${expectedImage} after ${retries} retries`,
    exitCode: -1,
    durationMs: 0,
  };
}
