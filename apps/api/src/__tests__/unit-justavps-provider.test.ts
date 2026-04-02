import { describe, test, expect } from 'bun:test';
import { buildCustomerCloudInitScript } from '../platform/providers/justavps';

describe('JustAVPS provider bootstrap script resolution', () => {
  test('buildCustomerCloudInitScript embeds sandbox bootstrap', () => {
    const script = buildCustomerCloudInitScript('kortix/computer:0.8.20');
    expect(script).toContain('/usr/local/bin/kortix-start-sandbox.sh');
    expect(script).toContain('kortix/computer:0.8.20');
    expect(script).toContain('raw.githubusercontent.com/kortix-ai/suna/main/scripts/start-sandbox.sh');
  });
});
