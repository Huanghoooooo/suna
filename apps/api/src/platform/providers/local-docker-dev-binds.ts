import { existsSync } from 'fs';
import { resolve } from 'path';

export const LOCAL_DOCKER_DEV_BIND_SPECS = [
  { source: 'core/kortix-master/src', target: '/ephemeral/kortix-master/src' },
  { source: 'core/kortix-master/opencode/plugin', target: '/ephemeral/kortix-master/opencode/plugin' },
  { source: 'core/kortix-master/opencode/agents', target: '/ephemeral/kortix-master/opencode/agents' },
  { source: 'core/kortix-master/opencode/commands', target: '/ephemeral/kortix-master/opencode/commands' },
  { source: 'core/kortix-master/opencode/skills', target: '/ephemeral/kortix-master/opencode/skills' },
  { source: 'core/kortix-master/opencode/tools', target: '/ephemeral/kortix-master/opencode/tools' },
  { source: 'core/kortix-master/opencode/patches', target: '/ephemeral/kortix-master/opencode/patches' },
  { source: 'core/kortix-master/opencode/opencode.jsonc', target: '/ephemeral/kortix-master/opencode/opencode.jsonc' },
  { source: 'core/kortix-master/channels/src', target: '/ephemeral/kortix-master/channels/src' },
  { source: 'core/kortix-master/triggers/src', target: '/ephemeral/kortix-master/triggers/src' },
  { source: 'core/services', target: '/ephemeral/services' },
] as const;

const DEV_MODE_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isLocalDockerDevModeEnabled(env: Record<string, string | undefined>): boolean {
  const raw = env.KORTIX_DEV_MODE?.trim().toLowerCase();
  return !!raw && DEV_MODE_TRUE_VALUES.has(raw);
}

export function resolveLocalDockerRepoRoot(cwd = process.cwd()): string | null {
  const candidates = [
    resolve(__dirname, '../../../../../'),
    cwd,
    resolve(cwd, '../..'),
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (existsSync(resolve(candidate, 'core/docker/docker-compose.dev.yml'))) {
      return candidate;
    }
  }

  return null;
}

export function buildLocalDockerDevBinds(opts: {
  cwd?: string;
  env?: Record<string, string | undefined>;
  warn?: (message: string) => void;
} = {}): string[] {
  const env = opts.env ?? process.env;
  if (!isLocalDockerDevModeEnabled(env)) return [];

  const repoRoot = resolveLocalDockerRepoRoot(opts.cwd);
  if (!repoRoot) {
    opts.warn?.('[LOCAL-DOCKER] KORTIX_DEV_MODE is enabled but repo root was not found, skipping dev bind mounts');
    return [];
  }

  return LOCAL_DOCKER_DEV_BIND_SPECS.flatMap(({ source, target }) => {
    const hostPath = resolve(repoRoot, source);
    if (!existsSync(hostPath)) {
      opts.warn?.(`[LOCAL-DOCKER] Dev bind source missing, skipping: ${hostPath}`);
      return [];
    }
    return [`${hostPath}:${target}:ro`];
  });
}
