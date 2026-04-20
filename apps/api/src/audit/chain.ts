import { createHash } from 'node:crypto';

/** SHA-256 hex (64 chars), used for hash-chain records. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * First link in the per-account chain. Not equal to any record_hash of a prior row.
 */
export function genesisHashForAccount(accountId: string): string {
  return sha256Hex(`WUTONG_AUDIT_V1|GENESIS|${accountId}`);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'undefined') return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(value as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

export type CanonicalAuditPayload = {
  chainSeq: number;
  category: string;
  action: string;
  actorUserId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAtIso: string;
};

export function canonicalPayloadString(p: CanonicalAuditPayload): string {
  return stableStringify(p);
}

export function computeRecordHash(prevRecordHash: string, payload: CanonicalAuditPayload): string {
  return sha256Hex(`${prevRecordHash}|${canonicalPayloadString(payload)}`);
}
