import { describe, expect, test } from 'bun:test';
import { resolve } from 'path';
import {
  buildLocalDockerDevBinds,
  LOCAL_DOCKER_DEV_BIND_SPECS,
} from '../platform/providers/local-docker-dev-binds';

describe('local docker dev bind mounts', () => {
  const repoRoot = resolve(import.meta.dir, '../../../..');

  test('returns no bind mounts when dev mode is disabled', () => {
    expect(buildLocalDockerDevBinds({ cwd: repoRoot, env: {} })).toEqual([]);
  });

  test('mirrors docker-compose.dev bind mounts when dev mode is enabled', () => {
    const binds = buildLocalDockerDevBinds({
      cwd: repoRoot,
      env: { KORTIX_DEV_MODE: '1' },
    });

    expect(binds).toHaveLength(LOCAL_DOCKER_DEV_BIND_SPECS.length);
    for (const spec of LOCAL_DOCKER_DEV_BIND_SPECS) {
      expect(binds).toContain(`${resolve(repoRoot, spec.source)}:${spec.target}:ro`);
    }
  });
});
