import { createHash } from "node:crypto";
import config from "../config";
import { ForbiddenError, ValidationError } from "../utils/errors";
import { redactSecrets } from "./secret-redaction";
import { approvalService } from "./approval.service";
import type { ApprovalRequest } from "./approval";
import type { Mandate } from "./mandate";
import type { AgentRecord } from "./platform.entity";
import type { JsonObject } from "./platform.entity";
import { findOAuthProviderById } from "./oauth.repository";
import { sendApprovalPush } from "./apns.service";
import { listActivePushDevices } from "./device.repository";
import { decideProxyAccessRequest } from "./proxy.repository";
import {
  attachTransactionApproval,
  claimTransactionForExecution,
  findTransactionByApproval,
  findTransactionById,
  findTransactionByIdempotency,
  insertTransaction,
  setTransactionStatus,
} from "./transaction.repository";
import { externalReferenceFromResult, type Transaction } from "./transaction";

export type ApprovalRequiredEnvelope = {
  ok: true;
  status: "approval_required";
  request_id: string;
  access_request_id: string;
  transaction_id: string;
  approval_url: string;
  retry_after_seconds: 5;
  next_action: "wait_for_user";
};

export type DeniedEnvelope = {
  ok: false;
  status: "denied";
  reason: string;
  transaction_id: string;
  request_id: string | null;
};

export function deriveIdempotencyKey(input: {
  mandateId: string;
  method: string;
  url: string;
  body?: unknown;
}): string {
  const digest = createHash("sha256");
  digest.update(input.mandateId);
  digest.update("\n");
  digest.update(input.method.trim().toUpperCase());
  digest.update("\n");
  digest.update(input.url);
  digest.update("\n");
  if (input.body !== undefined) {
    digest.update(typeof input.body === "string" ? input.body : JSON.stringify(input.body));
  }
  return digest.digest("hex");
}

function redactedContext(body: unknown): JsonObject {
  if (body === undefined || body === null) {
    return {};
  }
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  if (raw.length > 8_192) {
    return { body_truncated: true, body_bytes: raw.length };
  }
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    return { body: redactSecrets(parsed) as unknown as JsonObject };
  } catch {
    return { body: "[non-json]" };
  }
}

function approvalUrlFor(approvalId: string, principalId: string, apiBaseUrl: string): string {
  const approvalBase = config.consoleUrl?.replace(/\/+$/, "") ?? apiBaseUrl.replace(/\/+$/, "");
  const userQuery = principalId ? `?user=${encodeURIComponent(principalId)}` : "";
  return `${approvalBase}/approve-proxy/${approvalId}${userQuery}`;
}

export function toApprovalRequiredEnvelope(
  transaction: Transaction,
  approval: ApprovalRequest,
  apiBaseUrl: string,
): ApprovalRequiredEnvelope {
  return {
    ok: true,
    status: "approval_required",
    request_id: approval.id,
    access_request_id: approval.id,
    transaction_id: transaction.id,
    approval_url: approvalUrlFor(approval.id, transaction.principal.id, apiBaseUrl),
    retry_after_seconds: 5,
    next_action: "wait_for_user",
  };
}

export class TransactionIntentService {
  async ensureProposed(input: {
    agent: AgentRecord;
    mandate: Mandate;
    method: string;
    url: URL;
    action: string;
    reason: string;
    body?: unknown;
    idempotencyKey?: string;
    apiBaseUrl: string;
  }): Promise<
    | { kind: "proposed"; envelope: ApprovalRequiredEnvelope; transaction: Transaction }
    | { kind: "authorized"; transaction: Transaction }
    | { kind: "committed"; transaction: Transaction }
    | { kind: "denied"; envelope: DeniedEnvelope }
    | { kind: "failed"; transaction: Transaction }
  > {
    const idempotencyKey = (input.idempotencyKey?.trim() ||
      deriveIdempotencyKey({
        mandateId: input.mandate.id,
        method: input.method,
        url: input.url.toString(),
        body: input.body,
      })).slice(0, 128);

    let transaction = await insertTransaction({
      principal_id: input.mandate.principal.id,
      agent_id: input.agent.id,
      mandate_id: input.mandate.id,
      provider_id: input.mandate.provider_id,
      action: input.action,
      method: input.method,
      url_host: input.url.hostname.toLowerCase(),
      url_path: input.url.pathname,
      context: {
        url: input.url.toString(),
        ...redactedContext(input.body),
      },
      idempotency_key: idempotencyKey,
    });

    transaction = (await findTransactionByIdempotency(input.mandate.id, idempotencyKey)) ?? transaction;

    if (transaction.status === "denied") {
      return {
        kind: "denied",
        envelope: {
          ok: false,
          status: "denied",
          reason: "Principal denied this transaction",
          transaction_id: transaction.id,
          request_id: transaction.approval_request_id,
        },
      };
    }
    if (transaction.status === "committed") {
      return { kind: "committed", transaction };
    }
    if (transaction.status === "authorized" || transaction.status === "executing") {
      return { kind: "authorized", transaction };
    }
    if (transaction.status === "failed") {
      return { kind: "failed", transaction };
    }

    if (transaction.status === "expired") {
      await setTransactionStatus(transaction.id, "proposed");
      transaction = { ...transaction, status: "proposed", approval_request_id: null };
    }

    if (transaction.approval_request_id) {
      const existing = await approvalService.get(transaction.approval_request_id);
      if (existing && existing.status === "pending") {
        return {
          kind: "proposed",
          envelope: toApprovalRequiredEnvelope(transaction, existing, input.apiBaseUrl),
          transaction,
        };
      }
      if (existing?.status === "approved") {
        const authorized = await setTransactionStatus(transaction.id, "authorized");
        return { kind: "authorized", transaction: authorized ?? transaction };
      }
      if (existing?.status === "denied") {
        const denied = await setTransactionStatus(transaction.id, "denied");
        return {
          kind: "denied",
          envelope: {
            ok: false,
            status: "denied",
            reason: "Principal denied this transaction",
            transaction_id: transaction.id,
            request_id: existing.id,
          },
        };
      }
    }

    const provider = await findOAuthProviderById(input.mandate.provider_id);
    const approval = await approvalService.createTransactionApproval({
      agent_id: input.agent.id,
      provider_slug: provider?.slug ?? "provider",
      requested_hosts: [input.url.hostname.toLowerCase()],
      reason: input.reason,
      user_hint: input.mandate.principal.id,
      action: input.action,
      resource: {
        provider: provider?.slug,
        hosts: [input.url.hostname.toLowerCase()],
        method: input.method,
        url: input.url.toString(),
        path: input.url.pathname,
      },
      context: { transaction_id: transaction.id, idempotency_key: idempotencyKey },
      grant_id: input.mandate.id,
      metadata: { transaction_id: transaction.id, provider_id: input.mandate.provider_id },
    });
    transaction = (await attachTransactionApproval(transaction.id, approval.id)) ?? transaction;

    try {
      const devices = await listActivePushDevices(input.mandate.principal.id);
      await sendApprovalPush({
        devices,
        accessRequestId: approval.id,
        provider: provider?.slug ?? "provider",
        agentName: input.agent.name,
        reason: input.reason,
        userId: input.mandate.principal.id,
      });
    } catch (error) {
      console.warn(
        `[v4-push] transaction approval push failed for ${approval.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      kind: "proposed",
      envelope: toApprovalRequiredEnvelope(transaction, approval, input.apiBaseUrl),
      transaction,
    };
  }

  async authorize(approvalId: string, principalId: string): Promise<Transaction> {
    const approval = await approvalService.requirePending(approvalId, principalId);
    if (approval.type !== "transaction") {
      throw new ValidationError("Access request is not a transaction approval", {
        error_code: "not_a_transaction_approval",
      });
    }
    const decided = await decideProxyAccessRequest({
      id: approval.id,
      status: "approved",
      user_id: principalId,
      grant_id: approval.mandate_id ?? undefined,
    });
    if (!decided) {
      throw await approvalService.noLongerPending(approval.id);
    }
    const transaction = await findTransactionByApproval(approval.id);
    if (!transaction) {
      throw new ValidationError("Transaction not found for this approval", {
        error_code: "transaction_not_found",
      });
    }
    const authorized = await setTransactionStatus(transaction.id, "authorized");
    return authorized ?? transaction;
  }

  async deny(approvalId: string, principalId: string): Promise<Transaction | null> {
    const transaction = await findTransactionByApproval(approvalId);
    if (!transaction) {
      return null;
    }
    return setTransactionStatus(transaction.id, "denied");
  }

  async claimExecution(id: string): Promise<Transaction> {
    const claimed = await claimTransactionForExecution(id);
    if (claimed) {
      return claimed;
    }
    const current = await findTransactionById(id);
    if (current?.status === "committed" && current.result) {
      return current;
    }
    if (current?.status === "executing") {
      throw new ValidationError("Transaction is already executing", {
        error_code: "transaction_executing",
      });
    }
    throw new ForbiddenError("Transaction is not authorized", {
      error_code: "transaction_not_authorized",
    });
  }

  async complete(
    id: string,
    result: JsonObject,
    outcome: "committed" | "failed",
  ): Promise<Transaction | null> {
    return setTransactionStatus(id, outcome, {
      result,
      external_reference: outcome === "committed" ? externalReferenceFromResult(result) : null,
    });
  }
}

export const transactionIntentService = new TransactionIntentService();
