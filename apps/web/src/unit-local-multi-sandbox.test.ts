import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

describe('local multi-sandbox source guards', () => {
  test('server store no longer collapses local sandboxes into the default entry', () => {
    const source = readFileSync(join(TEST_DIR, 'stores/server-store.ts'), 'utf8');

    expect(source).toContain("if (provider === 'local_docker') return `sandbox-${instanceId}`;");
    expect(source).not.toContain("if (provider === 'local_docker') return DEFAULT_SERVER_ID;");
    expect(source).not.toContain('get().updateServerSilent(DEFAULT_SERVER_ID');
  });

  test('local sandbox registration uses per-instance IDs instead of default', () => {
    const source = readFileSync(join(TEST_DIR, 'hooks/platform/use-sandbox.ts'), 'utf8');

    expect(source).toContain("if (sandbox.provider === 'local_docker') return `sandbox-${sandbox.sandbox_id}`;");
    expect(source).not.toContain("if (sandbox.provider === 'local_docker') return 'default';");
  });

  test('explicit local sandbox creation no longer routes through single-instance init/local', () => {
    const source = readFileSync(join(TEST_DIR, 'lib/platform-client.ts'), 'utf8');

    expect(source).toContain("const result = await platformFetch<SandboxInfo>('/platform/sandbox', {");
    expect(source).toContain("const { sandbox } = await ensureLocalSandboxViaInit();");
  });
});
