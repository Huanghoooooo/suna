import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('local docker fallback shell safety', () => {
  test('quotes container names and env values before building docker exec commands', () => {
    const source = readFileSync(join(import.meta.dir, '../platform/providers/local-docker.ts'), 'utf8');

    expect(source).toContain('function shellQuote(value: string)');
    expect(source).toContain("printf '%s' ${shellQuote(val)} > /run/s6/container_environment/${key}");
    expect(source).toContain('docker exec ${shellQuote(CONTAINER_NAME)} bash -c ');
  });
});
