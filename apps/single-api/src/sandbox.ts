import { execFileSync } from 'node:child_process';
import { config } from './config';

function run(command: string, args: string[], timeout = 30_000): string {
  return execFileSync(command, args, {
    cwd: config.rootDir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    env: {
      ...process.env,
      SANDBOX_CONTAINER_NAME: config.sandboxContainer,
      KORTIX_TOKEN: config.sandboxToken,
      INTERNAL_SERVICE_KEY: config.sandboxToken,
      TUNNEL_TOKEN: config.sandboxToken,
      KORTIX_API_URL: config.sandboxApiUrl,
      TUNNEL_API_URL: config.sandboxApiUrl,
      CORS_ALLOWED_ORIGINS: [config.webUrl, config.publicApiUrl].join(','),
    },
  });
}

export function compose(args: string[], timeout = 120_000): string {
  return run('docker', ['compose', '-f', config.composeFile, ...args], timeout);
}

export function inspectContainer() {
  try {
    const raw = run('docker', ['inspect', config.sandboxContainer], 10_000);
    const [info] = JSON.parse(raw);
    return {
      exists: true,
      running: Boolean(info?.State?.Running),
      status: info?.State?.Status || 'unknown',
      health: info?.State?.Health?.Status || null,
      startedAt: info?.State?.StartedAt || null,
      ports: info?.NetworkSettings?.Ports || {},
    };
  } catch (err: any) {
    return {
      exists: false,
      running: false,
      status: 'missing',
      health: null,
      error: String(err?.stderr || err?.message || err).trim(),
      ports: {},
    };
  }
}

export async function sandboxHealth() {
  const container = inspectContainer();
  let runtime: any = null;
  try {
    const res = await fetch(`${config.sandboxBaseUrl}/kortix/health`, {
      headers: { Authorization: `Bearer ${config.sandboxToken}` },
      signal: AbortSignal.timeout(2500),
    });
    runtime = {
      ok: res.ok,
      status: res.status,
      body: await res.json().catch(() => null),
    };
  } catch (err: any) {
    runtime = { ok: false, error: err?.message || String(err) };
  }
  return {
    container,
    runtime,
    baseUrl: config.sandboxBaseUrl,
    containerName: config.sandboxContainer,
  };
}

export function sandboxLogs(lines = 160): string {
  try {
    return run('docker', ['logs', '--tail', String(lines), config.sandboxContainer], 10_000);
  } catch (err: any) {
    return String(err?.stderr || err?.message || err);
  }
}

export function execInSandbox(args: string[], timeout = 15_000): string {
  return run('docker', ['exec', config.sandboxContainer, ...args], timeout);
}
