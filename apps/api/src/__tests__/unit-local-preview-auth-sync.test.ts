import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('local preview auth sync', () => {
  test('syncs the sandbox auth bundle into the addressed container, not the fixed default sandbox', () => {
    const source = readFileSync(join(import.meta.dir, '../sandbox-proxy/routes/local-preview.ts'), 'utf8');

    expect(source).toContain('const localPreviewSyncState = new Map<string, LocalPreviewSyncState>();');
    expect(source).toContain('function trySyncServiceKey(sandboxId: string, serviceKey: string): boolean');
    expect(source).not.toContain('if (state.synced) return false;');
    expect(source).toContain("`docker exec ${shellQuote(sandboxId)} bash -c ${shellQuote(buildCanonicalSandboxAuthCommand(serviceKey, config.KORTIX_URL.replace(/\\/v1\\/router\\/?$/, '') || `http://host.docker.internal:${config.PORT}`))}`");
    expect(source).not.toContain("docker exec ${shellQuote(config.SANDBOX_CONTAINER_NAME)}");
  });

  test('local provider resolution bypasses stale cache and refreshes live docker baseUrl', () => {
    const source = readFileSync(join(import.meta.dir, '../sandbox-proxy/index.ts'), 'utf8');

    expect(source).toContain("if (cached.provider === 'local_docker') {");
    expect(source).toContain("const liveSandbox = await localProvider.find(externalId);");
    expect(source).toContain("console.log(`[PREVIEW] Refreshed local sandbox baseUrl for ${externalId} -> ${liveSandbox.baseUrl}`);");
    expect(source).toContain("provider === 'local_docker' ? 0 :");
  });
});
