import type { JsonObject } from "./platform.entity";

/**
 * An ApprovalRequest is a decision the principal must make before the agent
 * may act. AccessRequest is the current stored representation
 * (`proxy_access_requests`) and the v4 API name.
 *
 * Phase 3 only writes type = "delegation". The same record, iOS challenge,
 * and state machine will later carry type = "action" | "transaction".
 */
export type ApprovalType = "delegation" | "action" | "transaction";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";
export type ApprovalPrincipalType = "user" | "organization" | "service_account" | "team";

export type ApprovalPrincipal = {
  type: ApprovalPrincipalType;
  id: string | null;
};

export type ApprovalDecision = {
  verdict: "approved" | "denied";
  decided_by: string | null;
  decided_at: string | null;
  connection_id: string | null;
  mandate_id: string | null;
};

export type ApprovalRequest = {
  id: string;
  type: ApprovalType;
  principal: ApprovalPrincipal;
  agent_id: string;
  mandate_id: string | null;
  action: string | null;
  resource: JsonObject;
  context: JsonObject;
  risk: string | null;
  status: ApprovalStatus;
  created_at: string;
  expires_at: string;
  decision: ApprovalDecision | null;
  // Compatibility fields the v4 AccessRequest API already returns.
  provider_slug: string;
  requested_hosts: string[];
  reason: string | null;
  user_id: string | null;
  user_hint: string | null;
  callback_url: string | null;
  connection_id: string | null;
  grant_id: string | null;
  decided_at: string | null;
};

export type AccessRequestRow = {
  id: string;
  agent_id: string;
  provider_slug: string;
  requested_hosts: string[];
  reason: string | null;
  status: ApprovalStatus;
  user_id: string | null;
  user_hint: string | null;
  callback_url: string | null;
  connection_id: string | null;
  grant_id: string | null;
  expires_at: string;
  decided_at: string | null;
  metadata: JsonObject;
  created_at: string;
  approval_type?: string | null;
  principal_type?: string | null;
  principal_id?: string | null;
  action?: string | null;
  resource?: unknown;
  context?: unknown;
  risk?: string | null;
  decision?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function parseDecision(value: unknown, row: AccessRequestRow): ApprovalDecision | null {
  if (row.status !== "approved" && row.status !== "denied") {
    return null;
  }
  const stored = isRecord(value) ? value : {};
  return {
    verdict: row.status,
    decided_by: typeof stored.decided_by === "string" ? stored.decided_by : row.user_id,
    decided_at: typeof stored.decided_at === "string" ? stored.decided_at : row.decided_at,
    connection_id:
      typeof stored.connection_id === "string" ? stored.connection_id : row.connection_id,
    mandate_id: typeof stored.mandate_id === "string" ? stored.mandate_id : row.grant_id,
  };
}

export function buildDelegationResource(input: {
  provider: string;
  hosts: string[];
}): JsonObject {
  return { provider: input.provider, hosts: input.hosts };
}

export function approvalFromAccessRow(row: AccessRequestRow): ApprovalRequest {
  const resource = isRecord(row.resource)
    ? row.resource
    : buildDelegationResource({ provider: row.provider_slug, hosts: row.requested_hosts });
  const principalId = row.principal_id?.trim() || row.user_id || row.user_hint || null;
  return {
    id: row.id,
    type: (row.approval_type?.trim() || "delegation") as ApprovalType,
    principal: {
      type: (row.principal_type?.trim() || "user") as ApprovalPrincipalType,
      id: principalId,
    },
    agent_id: row.agent_id,
    mandate_id: row.grant_id,
    action: row.action ?? (row.approval_type === "delegation" || !row.approval_type ? "delegate" : null),
    resource,
    context: isRecord(row.context) ? row.context : {},
    risk: row.risk ?? null,
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    decision: parseDecision(row.decision, row),
    provider_slug: row.provider_slug,
    requested_hosts:
      asStringArray(resource.hosts).length > 0 ? asStringArray(resource.hosts) : row.requested_hosts,
    reason: row.reason,
    user_id: row.user_id,
    user_hint: row.user_hint,
    callback_url: row.callback_url,
    connection_id: row.connection_id,
    grant_id: row.grant_id,
    decided_at: row.decided_at,
  };
}

/** v4 wire shape. Existing fields stay; ApprovalRequest fields are additive. */
export function toAccessRequestPublic(approval: ApprovalRequest) {
  return {
    access_request_id: approval.id,
    agent_id: approval.agent_id,
    provider: approval.provider_slug,
    requested_hosts: approval.requested_hosts,
    reason: approval.reason,
    status: approval.status,
    user_hint: approval.user_hint,
    expires_at: approval.expires_at,
    created_at: approval.created_at,
    grant_id: approval.grant_id,
    connection_id: approval.connection_id,
    decided_at: approval.decided_at,
    type: approval.type,
    principal: approval.principal,
    action: approval.action,
    resource: approval.resource,
    risk: approval.risk,
    mandate_id: approval.mandate_id,
    decision: approval.decision,
  };
}

export function approvalIsPending(approval: ApprovalRequest, now: Date = new Date()): boolean {
  return approval.status === "pending" && new Date(approval.expires_at).getTime() >= now.getTime();
}
