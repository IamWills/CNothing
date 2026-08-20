import type { JsonObject } from "./platform.entity";

export type TransactionStatus =
  | "proposed"
  | "authorized"
  | "executing"
  | "committed"
  | "failed"
  | "denied"
  | "expired";

export type Transaction = {
  id: string;
  principal: { type: string; id: string };
  agent_id: string;
  mandate_id: string;
  provider_id: string | null;
  action: string;
  method: string;
  url_host: string;
  url_path: string;
  amount: string | null;
  currency: string | null;
  counterparty: string | null;
  context: JsonObject;
  status: TransactionStatus;
  approval_request_id: string | null;
  external_reference: string | null;
  idempotency_key: string;
  result: JsonObject | null;
  created_at: string;
  completed_at: string | null;
};

export type TransactionRow = {
  id: string;
  principal_type: string;
  principal_id: string;
  agent_id: string;
  mandate_id: string;
  provider_id: string | null;
  action: string;
  method: string;
  url_host: string;
  url_path: string;
  amount: string | null;
  currency: string | null;
  counterparty: string | null;
  context: unknown;
  status: string;
  approval_request_id: string | null;
  external_reference: string | null;
  idempotency_key: string;
  result: unknown;
  created_at: string;
  completed_at: string | null;
};

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

export function transactionFromRow(row: TransactionRow): Transaction {
  return {
    id: row.id,
    principal: {
      type: row.principal_type || "user",
      id: row.principal_id,
    },
    agent_id: row.agent_id,
    mandate_id: row.mandate_id,
    provider_id: row.provider_id,
    action: row.action,
    method: row.method,
    url_host: row.url_host,
    url_path: row.url_path,
    amount: row.amount,
    currency: row.currency,
    counterparty: row.counterparty,
    context: isRecord(row.context) ? row.context : {},
    status: row.status as TransactionStatus,
    approval_request_id: row.approval_request_id,
    external_reference: row.external_reference,
    idempotency_key: row.idempotency_key,
    result: isRecord(row.result) ? row.result : null,
    created_at: asIso(row.created_at),
    completed_at: row.completed_at ? asIso(row.completed_at) : null,
  };
}

export function externalReferenceFromResult(result: JsonObject | null): string | null {
  if (!result) return null;
  const body = result.body;
  if (isRecord(body)) {
    for (const key of ["html_url", "url", "id"]) {
      const value = body[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
      if (typeof value === "number") {
        return String(value);
      }
    }
  }
  return null;
}
