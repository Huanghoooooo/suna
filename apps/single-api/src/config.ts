import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Env = Record<string, string | undefined>;

function loadEnvFile(path: string): Env {
  if (!existsSync(path)) return {};
  const out: Env = {};
  for (const raw of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

const rootDir = resolve(import.meta.dir, '../../..');
const merged: Env = {
  ...loadEnvFile(resolve(rootDir, '.env')),
  ...loadEnvFile(resolve(rootDir, 'apps/single-api/.env')),
  ...process.env,
};

function str(key: string, fallback: string): string {
  const value = merged[key];
  return value && value.trim() ? value.trim() : fallback;
}

function int(key: string, fallback: number): number {
  const value = Number(str(key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  rootDir,
  host: str('SINGLE_API_HOST', '0.0.0.0'),
  port: int('SINGLE_API_PORT', 18008),
  publicApiUrl: str('SINGLE_PUBLIC_API_URL', 'http://localhost:18008').replace(/\/$/, ''),
  webUrl: str('SINGLE_WEB_URL', 'http://localhost:13000').replace(/\/$/, ''),
  dataDir: resolve(rootDir, str('SINGLE_DATA_DIR', '.single-data')),
  composeFile: resolve(rootDir, str('SINGLE_COMPOSE_FILE', 'core/docker/docker-compose.yml')),
  sandboxContainer: str('SINGLE_SANDBOX_CONTAINER', 'kortix-single-sandbox'),
  sandboxBaseUrl: str('SINGLE_SANDBOX_BASE_URL', 'http://127.0.0.1:14000').replace(/\/$/, ''),
  sandboxToken: str('SINGLE_SANDBOX_TOKEN', 'kortix_single_dev_token_change_me'),
  sandboxApiUrl: str('KORTIX_API_URL', 'http://host.docker.internal:18008').replace(/\/$/, ''),
  model: str('SINGLE_MODEL', 'apipool/claude-opus-4-7'),
  env: merged,
};

export function sandboxHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set('Authorization', `Bearer ${config.sandboxToken}`);
  return headers;
}
