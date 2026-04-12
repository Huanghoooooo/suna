import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('sandbox sync fallback shell safety', () => {
  test('startup token sync fallback quotes shell values and uses base64 bootstrap payload', () => {
    const source = readFileSync(join(import.meta.dir, '../index.ts'), 'utf8');

    expect(source).toContain('function shellQuote(value: string)');
    expect(source).toContain("printf '%s' ${shellQuote(v)} > /run/s6/container_environment/${k}");
    expect(source).toContain('docker exec ${shellQuote(config.SANDBOX_CONTAINER_NAME)} bash -c ');
    expect(source).toContain("os.environ['BOOTSTRAP_UPDATE_B64']");
    expect(source).not.toContain('JSON.stringify(JSON.stringify({ KORTIX_TOKEN: token, KORTIX_API_URL: kortixApiUrl }))');
  });

  test('sandbox health fallback quotes shell values before docker exec', () => {
    const source = readFileSync(join(import.meta.dir, '../platform/services/sandbox-health.ts'), 'utf8');

    expect(source).toContain('function shellQuote(value: string)');
    expect(source).toContain("printf '%s' ${shellQuote(val)} > /run/s6/container_environment/${key}");
    expect(source).toContain('docker exec ${shellQuote(config.SANDBOX_CONTAINER_NAME)} bash -c ');
  });
});
