import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { JsonObject } from "./platform.entity";
import {
  transactionFromRow,
  type Transaction,
  type TransactionRow,
  type TransactionStatus,
} from "./transaction";

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function normalizeMetadata(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function mapRow(row: Record<string, unknown>): TransactionRow {
  return {
    id: String(row.id),
    principal_type: String(row.principal_type ?? "user"),
    principal_id: String(row.principal_id),
    agent_id: String(row.agent_id),
    mandate_id: String(row.mandate_id),
    provider_id: row.provider_id ? String(row.provider_id) : null,
    action: String(row.action),
    method: String(row.method),
    url_host: String(row.url_host),
    url_path: String(row.url_path),
    amount: row.amount == null ? null : String(row.amount),
    currency: row.currency ? String(row.currency) : null,
    counterparty: row.counterparty ? String(row.counterparty) : null,
    context: normalizeMetadata(row.context),
    status: String(row.status),
    approval_request_id: row.approval_request_id ? String(row.approval_request_id) : null,
    external_reference: row.external_reference ? String(row.external_reference) : null,
    idempotency_key: String(row.idempotency_key),
    result: row.result,
    created_at: asIso(row.created_at),
    completed_at: row.completed_at ? asIso(row.completed_at) : null,
  };
}

export async function findTransactionById(id: string): Promise<Transaction | null> {
  const result = await pool.query(`SELECT * FROM proxy_transactions WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? transactionFromRow(mapRow(row)) : null;
}

export async function findTransactionByApproval(approvalRequestId: string): Promise<Transaction | null> {
  const result = await pool.query(
    `SELECT * FROM proxy_transactions WHERE approval_request_id = $1`,
    [approvalRequestId],
  );
  const row = result.rows[0];
  return row ? transactionFromRow(mapRow(row)) : null;
}

export async function findTransactionByIdempotency(
  mandateId: string,
  idempotencyKey: string,
): Promise<Transaction | null> {
  const result = await pool.query(
    `SELECT * FROM proxy_transactions WHERE mandate_id = $1 AND idempotency_key = $2`,
    [mandateId, idempotencyKey],
  );
  const row = result.rows[0];
  return row ? transactionFromRow(mapRow(row)) : null;
}

export async function insertTransaction(input: {
  principal_id: string;
  agent_id: string;
  mandate_id: string;
  provider_id?: string | null;
  action: string;
  method: string;
  url_host: string;
  url_path: string;
  context?: JsonObject;
  idempotency_key: string;
}): Promise<Transaction> {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO proxy_transactions (
        id, principal_type, principal_id, agent_id, mandate_id, provider_id,
        action, method, url_host, url_path, context, status, idempotency_key
      ) VALUES (
        $1,'user',$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'proposed',$11
      )
      ON CONFLICT (mandate_id, idempotency_key) DO NOTHING
      RETURNING *
    `,
    [
      id,
      input.principal_id,
      input.agent_id,
      input.mandate_id,
      input.provider_id ?? null,
      input.action,
      input.method,
      input.url_host,
      input.url_path,
      JSON.stringify(input.context ?? {}),
      input.idempotency_key,
    ],
  );
  const row = result.rows[0];
  if (row) {
    return transactionFromRow(mapRow(row));
  }
  const existing = await findTransactionByIdempotency(input.mandate_id, input.idempotency_key);
  if (!existing) {
    throw new Error("Failed to insert or load transaction");
  }
  return existing;
}

export async function attachTransactionApproval(
  id: string,
  approvalRequestId: string,
): Promise<Transaction | null> {
  const result = await pool.query(
    `
      UPDATE proxy_transactions
      SET approval_request_id = COALESCE(approval_request_id, $2)
      WHERE id = $1
      RETURNING *
    `,
    [id, approvalRequestId],
  );
  const row = result.rows[0];
  return row ? transactionFromRow(mapRow(row)) : null;
}

export async function setTransactionStatus(
  id: string,
  status: TransactionStatus,
  extra: { result?: JsonObject | null; external_reference?: string | null } = {},
): Promise<Transaction | null> {
  const completed = status === "committed" || status === "failed" || status === "denied" || status === "expired";
  const result = await pool.query(
    `
      UPDATE proxy_transactions
      SET status = $2,
          result = COALESCE($3::jsonb, result),
          external_reference = COALESCE($4, external_reference),
          completed_at = CASE WHEN $5 THEN NOW() ELSE completed_at END
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      status,
      extra.result ? JSON.stringify(extra.result) : null,
      extra.external_reference ?? null,
      completed,
    ],
  );
  const row = result.rows[0];
  return row ? transactionFromRow(mapRow(row)) : null;
}

/** Atomic gate so two retries cannot both execute the upstream write. */
export async function claimTransactionForExecution(id: string): Promise<Transaction | null> {
  const result = await pool.query(
    `
      UPDATE proxy_transactions
      SET status = 'executing'
      WHERE id = $1 AND status = 'authorized'
      RETURNING *
    `,
    [id],
  );
  const row = result.rows[0];
  return row ? transactionFromRow(mapRow(row)) : null;
}
