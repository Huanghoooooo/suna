/**
 * Pure unit tests for audit hash chain — no database required.
 */
import { describe, it, expect } from 'bun:test';
import {
  sha256Hex,
  genesisHashForAccount,
  computeRecordHash,
  canonicalPayloadString,
  type CanonicalAuditPayload,
} from '../audit/chain';

describe('audit chain (pure)', () => {
  it('sha256Hex is deterministic', () => {
    expect(sha256Hex('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('genesisHashForAccount depends on account id', () => {
    const a = genesisHashForAccount('00000000-0000-4000-a000-000000000001');
    const b = genesisHashForAccount('00000000-0000-4000-a000-000000000002');
    expect(a.length).toBe(64);
    expect(b.length).toBe(64);
    expect(a).not.toBe(b);
  });

  it('computeRecordHash chains: second row uses first recordHash as prev', () => {
    const accountId = '00000000-0000-4000-a000-000000000099';
    const prev0 = genesisHashForAccount(accountId);

    const p1: CanonicalAuditPayload = {
      chainSeq: 1,
      category: 'business',
      action: 'test.action',
      actorUserId: null,
      resourceType: null,
      resourceId: null,
      summary: 'one',
      metadata: { a: 1 },
      requestId: null,
      ipAddress: null,
      userAgent: null,
      createdAtIso: '2026-04-20T12:00:00.000Z',
    };

    const h1 = computeRecordHash(prev0, p1);
    expect(h1.length).toBe(64);

    const p2: CanonicalAuditPayload = {
      ...p1,
      chainSeq: 2,
      summary: 'two',
      metadata: { a: 2 },
      createdAtIso: '2026-04-20T12:00:01.000Z',
    };

    const h2 = computeRecordHash(h1, p2);
    expect(h2).not.toBe(h1);
  });

  it('canonicalPayloadString sorts object keys for stable hashing', () => {
    const p: CanonicalAuditPayload = {
      chainSeq: 1,
      category: 'business',
      action: 'x',
      actorUserId: null,
      resourceType: null,
      resourceId: null,
      summary: 's',
      metadata: { z: 1, a: 2 },
      requestId: null,
      ipAddress: null,
      userAgent: null,
      createdAtIso: '2026-04-20T12:00:00.000Z',
    };
    const s1 = canonicalPayloadString(p);
    const s2 = canonicalPayloadString({
      ...p,
      metadata: { a: 2, z: 1 },
    });
    expect(s1).toBe(s2);
  });
});
