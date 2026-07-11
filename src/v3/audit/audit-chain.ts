import { randomUUID } from "node:crypto";
import { pool } from "../../db";
import type { JsonObject } from "../../v2/v2.entity";
import { sanitizeDeep } from "../sanitizer/sanitizer";
import {
  createAuditChainId,
  hashAuditPayload,
  verifyAuditChain,
} from "./audit-chain-hash";

export type { AuditChainEventLite } from "./audit-chain-hash";
export { createAuditChainId, verifyAuditChain, hashAuditPayload };

export type AuditChainEventType =
  | "capability_invoked"
  | "policy_evaluated"
  | "approval_requested"
  | "approval_approved"
  | "approval_rejected"
  | "secret_accessed"
  | "worker_started"
  | "third_party_called"
  | "result_sanitized"
  | "execution_completed"
  | "execution_failed"
  | "execution_denied"
  | "reconnect_required";

export type AuditChainEvent = {
  id: string;
  audit_chain_id: string;
  sequence_no: number;
  event_type: string;
  prev_hash: string | null;
  chain_hash: string;
  execution_id: string | null;
  agent_id: string | null;
  user_id: string | null;
  capability_id: string | null;
  approval_id: string | null;
  result: string | null;
  input_summary: string | null;
  risk_level: string | null;
  metadata: JsonObject;
  created_at: string;
};

/**
 * Append an event to an audit chain with hash linking.
 * Metadata is sanitized — secrets must never enter the chain.
 */
export async function appendAuditChainEvent(input: {
  audit_chain_id: string;
  event_type: AuditChainEventType | string;
  execution_id?: string | null;
  agent_id?: string | null;
  user_id?: string | null;
  capability_id?: string | null;
  approval_id?: string | null;
  policy_id?: string | null;
  provider_id?: string | null;
  result?: string | null;
  input_summary?: string | null;
  risk_level?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  result_hash?: string | null;
  metadata?: JsonObject;
}): Promise<AuditChainEvent> {
  const safeMetadata = (sanitizeDeep(input.metadata ?? {}) ?? {}) as JsonObject;

  let prevHash: string | null = null;
  let sequenceNo = 1;
  try {
    const prev = await pool.query(
      `
        SELECT chain_hash, sequence_no
        FROM cap_trust_audit
        WHERE audit_chain_id = $1
        ORDER BY sequence_no DESC NULLS LAST, created_at DESC
        LIMIT 1
      `,
      [input.audit_chain_id],
    );
    prevHash = prev.rows[0]?.chain_hash ? String(prev.rows[0].chain_hash) : null;
    sequenceNo = prev.rows[0]?.sequence_no != null ? Number(prev.rows[0].sequence_no) + 1 : 1;
  } catch {
    // columns may not exist yet
  }

  const id = randomUUID();
  const chainHash = hashAuditPayload([
    prevHash,
    sequenceNo,
    input.event_type,
    input.execution_id ?? null,
    input.capability_id ?? null,
    input.result ?? null,
    input.input_summary ?? null,
    safeMetadata,
    id,
  ]);

  try {
    await pool.query(
      `
        INSERT INTO cap_trust_audit (
          id, event_type, tenant_id, agent_id, user_id, provider_id, capability_id,
          grant_id, policy_id, execution_id, latency_ms, result_hash, metadata,
          ip, user_agent, approval_id, input_summary, risk_level, result,
          audit_chain_id, prev_hash, chain_hash, sequence_no, status
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,
          $14,$15,$16,$17,$18,$19,
          $20,$21,$22,$23,'recorded'
        )
      `,
      [
        id,
        input.event_type,
        null,
        input.agent_id ?? null,
        input.user_id ?? null,
        input.provider_id ?? null,
        input.capability_id ?? null,
        null,
        input.policy_id ?? null,
        input.execution_id ?? null,
        null,
        input.result_hash ?? null,
        JSON.stringify(safeMetadata),
        input.ip ?? null,
        input.user_agent ?? null,
        input.approval_id ?? null,
        input.input_summary ?? null,
        input.risk_level ?? null,
        input.result ?? null,
        input.audit_chain_id,
        prevHash,
        chainHash,
        sequenceNo,
      ],
    );
  } catch {
    // Fallback without chain columns
    await pool.query(
      `
        INSERT INTO cap_trust_audit (
          id, event_type, tenant_id, agent_id, user_id, provider_id, capability_id,
          grant_id, policy_id, execution_id, latency_ms, result_hash, metadata,
          ip, user_agent, approval_id, input_summary, risk_level, result
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,
          $14,$15,$16,$17,$18,$19
        )
      `,
      [
        id,
        input.event_type,
        null,
        input.agent_id ?? null,
        input.user_id ?? null,
        input.provider_id ?? null,
        input.capability_id ?? null,
        null,
        input.policy_id ?? null,
        input.execution_id ?? null,
        null,
        input.result_hash ?? null,
        JSON.stringify({ ...safeMetadata, audit_chain_id: input.audit_chain_id }),
        input.ip ?? null,
        input.user_agent ?? null,
        input.approval_id ?? null,
        input.input_summary ?? null,
        input.risk_level ?? null,
        input.result ?? null,
      ],
    );
  }

  return {
    id,
    audit_chain_id: input.audit_chain_id,
    sequence_no: sequenceNo,
    event_type: input.event_type,
    prev_hash: prevHash,
    chain_hash: chainHash,
    execution_id: input.execution_id ?? null,
    agent_id: input.agent_id ?? null,
    user_id: input.user_id ?? null,
    capability_id: input.capability_id ?? null,
    approval_id: input.approval_id ?? null,
    result: input.result ?? null,
    input_summary: input.input_summary ?? null,
    risk_level: input.risk_level ?? null,
    metadata: safeMetadata,
    created_at: new Date().toISOString(),
  };
}

export async function getAuditChain(auditChainId: string): Promise<AuditChainEvent[]> {
  const result = await pool.query(
    `
      SELECT id, audit_chain_id, sequence_no, event_type, prev_hash, chain_hash,
             execution_id, agent_id, user_id, capability_id, approval_id,
             result, input_summary, risk_level, metadata, created_at
      FROM cap_trust_audit
      WHERE audit_chain_id = $1
      ORDER BY sequence_no ASC NULLS LAST, created_at ASC
    `,
    [auditChainId],
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    audit_chain_id: String(row.audit_chain_id),
    sequence_no: Number(row.sequence_no ?? 0),
    event_type: String(row.event_type),
    prev_hash: row.prev_hash ? String(row.prev_hash) : null,
    chain_hash: String(row.chain_hash ?? ""),
    execution_id: row.execution_id ? String(row.execution_id) : null,
    agent_id: row.agent_id ? String(row.agent_id) : null,
    user_id: row.user_id ? String(row.user_id) : null,
    capability_id: row.capability_id ? String(row.capability_id) : null,
    approval_id: row.approval_id ? String(row.approval_id) : null,
    result: row.result ? String(row.result) : null,
    input_summary: row.input_summary ? String(row.input_summary) : null,
    risk_level: row.risk_level ? String(row.risk_level) : null,
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as JsonObject)
        : {},
    created_at: new Date(String(row.created_at)).toISOString(),
  }));
}
