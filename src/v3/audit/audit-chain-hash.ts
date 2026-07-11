import { createHash, randomUUID } from "node:crypto";

export type AuditChainEventLite = {
  prev_hash: string | null;
  chain_hash: string;
};

export function createAuditChainId(): string {
  return `ach_${randomUUID().replace(/-/g, "")}`;
}

export function hashAuditPayload(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Verify hash chain integrity (no secret material involved). */
export function verifyAuditChain(events: AuditChainEventLite[]): {
  valid: boolean;
  broken_at: number | null;
} {
  let expectedPrev: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.prev_hash !== expectedPrev) {
      return { valid: false, broken_at: i };
    }
    expectedPrev = event.chain_hash;
  }
  return { valid: true, broken_at: null };
}
