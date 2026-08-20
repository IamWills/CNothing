import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "../db";
import { buildDelegationResource } from "./approval";
import { buildMandateConstraints } from "./mandate";
import type { JsonObject } from "./platform.entity";

export type ProxyAccessRequestStatus = "pending" | "approved" | "denied" | "expired";

/** Persistence of an ApprovalRequest. The v4 API still calls this an AccessRequest. */

export type ProxyAccessRequestRecord = {
  id: string;
  agent_id: string;
  provider_slug: string;
  requested_hosts: string[];
  reason: string | null;
  status: ProxyAccessRequestStatus;
  user_id: string | null;
  user_hint: string | null;
  callback_url: string | null;
  connection_id: string | null;
  grant_id: string | null;
  expires_at: string;
  decided_at: string | null;
  metadata: JsonObject;
  created_at: string;
  approval_type: string;
  principal_type: string;
  principal_id: string | null;
  action: string | null;
  resource: JsonObject;
  context: JsonObject;
  risk: string | null;
  decision: JsonObject | null;
};

export type ProxyGrantStatus = "active" | "revoked";

/** Persistence of a Mandate. The v4 API still calls this a Grant. */
export type ProxyGrantRecord = {
  id: string;
  agent_id: string;
  user_id: string;
  connection_id: string;
  provider_id: string;
  allowed_hosts: string[];
  allowed_methods: string[];
  status: ProxyGrantStatus;
  expires_at: string | null;
  last_used_at: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
  principal_type: string;
  principal_id: string;
  constraints: JsonObject;
  actions: string[];
  revoked_at: string | null;
};

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function normalizeMetadata(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function mapAccessRequestRow(row: Record<string, unknown>): ProxyAccessRequestRecord {
  return {
    id: String(row.id),
    agent_id: String(row.agent_id),
    provider_slug: String(row.provider_slug),
    requested_hosts: asStringArray(row.requested_hosts),
    reason: row.reason ? String(row.reason) : null,
    status: String(row.status) as ProxyAccessRequestStatus,
    user_id: row.user_id ? String(row.user_id) : null,
    user_hint: row.user_hint ? String(row.user_hint) : null,
    callback_url: row.callback_url ? String(row.callback_url) : null,
    connection_id: row.connection_id ? String(row.connection_id) : null,
    grant_id: row.grant_id ? String(row.grant_id) : null,
    expires_at: asIso(row.expires_at),
    decided_at: row.decided_at ? asIso(row.decided_at) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    approval_type: String(row.approval_type ?? "delegation"),
    principal_type: String(row.principal_type ?? "user"),
    principal_id: row.principal_id ? String(row.principal_id) : null,
    action: row.action ? String(row.action) : null,
    resource: normalizeMetadata(row.resource),
    context: normalizeMetadata(row.context),
    risk: row.risk ? String(row.risk) : null,
    decision: row.decision && typeof row.decision === "object" && !Array.isArray(row.decision)
      ? (row.decision as JsonObject)
      : null,
  };
}

function mapGrantRow(row: Record<string, unknown>): ProxyGrantRecord {
  return {
    id: String(row.id),
    agent_id: String(row.agent_id),
    user_id: String(row.user_id),
    connection_id: String(row.connection_id),
    provider_id: String(row.provider_id),
    allowed_hosts: asStringArray(row.allowed_hosts),
    allowed_methods: asStringArray(row.allowed_methods),
    status: String(row.status) as ProxyGrantStatus,
    expires_at: row.expires_at ? asIso(row.expires_at) : null,
    last_used_at: row.last_used_at ? asIso(row.last_used_at) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    principal_type: String(row.principal_type ?? "user"),
    principal_id: String(row.principal_id ?? row.user_id),
    constraints: normalizeMetadata(row.constraints),
    actions: asStringArray(row.actions),
    revoked_at: row.revoked_at ? asIso(row.revoked_at) : null,
  };
}

export async function createProxyAccessRequest(input: {
  agent_id: string;
  provider_slug: string;
  requested_hosts: string[];
  reason?: string;
  user_hint?: string;
  callback_url?: string;
  ttl_seconds?: number;
  metadata?: JsonObject;
  approval_type?: "delegation" | "action" | "transaction";
  action?: string;
  resource?: JsonObject;
  context?: JsonObject;
  grant_id?: string;
}): Promise<ProxyAccessRequestRecord> {
  const id = randomUUID();
  const principalId = input.user_hint?.trim() || null;
  const approvalType = input.approval_type ?? "delegation";
  const action = input.action ?? (approvalType === "delegation" ? "delegate" : null);
  const resource =
    input.resource ??
    buildDelegationResource({
      provider: input.provider_slug,
      hosts: input.requested_hosts,
    });
  const result = await pool.query(
    `
      INSERT INTO proxy_access_requests (
        id, agent_id, provider_slug, requested_hosts, reason, user_hint, callback_url,
        expires_at, metadata, grant_id,
        approval_type, principal_type, principal_id, action, resource, context
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,NOW() + ($8 || ' seconds')::interval,$9,$10,
        $11,'user',$12,$13,$14::jsonb,$15::jsonb
      )
      RETURNING *
    `,
    [
      id,
      input.agent_id,
      input.provider_slug,
      JSON.stringify(input.requested_hosts),
      input.reason ?? null,
      input.user_hint ?? null,
      input.callback_url ?? null,
      String(input.ttl_seconds ?? 3600),
      JSON.stringify(input.metadata ?? {}),
      input.grant_id ?? null,
      approvalType,
      principalId,
      action,
      JSON.stringify(resource),
      JSON.stringify(input.context ?? {}),
    ],
  );
  return mapAccessRequestRow(result.rows[0]!);
}

export async function listPendingAccessRequestsForUser(
  userId: string,
): Promise<ProxyAccessRequestRecord[]> {
  const result = await pool.query(
    `
      SELECT * FROM proxy_access_requests
      WHERE status = 'pending' AND expires_at > NOW()
        AND (user_hint = $1 OR principal_id = $1)
      ORDER BY created_at DESC
    `,
    [userId],
  );
  return result.rows.map(mapAccessRequestRow);
}

/** Bind a pending request to a user when the agent omitted user_id (enables iOS poll/push). */
export async function claimProxyAccessRequestUserHint(input: {
  id: string;
  user_hint: string;
}): Promise<ProxyAccessRequestRecord | null> {
  const result = await pool.query(
    `
      UPDATE proxy_access_requests
      SET user_hint = $2,
          principal_type = 'user',
          principal_id = $2,
          updated_at = NOW()
      WHERE id = $1
        AND status = 'pending'
        AND expires_at > NOW()
        AND (user_hint IS NULL OR user_hint = '' OR user_hint = $2)
        AND (principal_id IS NULL OR principal_id = $2)
      RETURNING *
    `,
    [input.id, input.user_hint],
  );
  const row = result.rows[0];
  return row ? mapAccessRequestRow(row) : null;
}

export async function findProxyAccessRequest(id: string): Promise<ProxyAccessRequestRecord | null> {
  const result = await pool.query(`SELECT * FROM proxy_access_requests WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? mapAccessRequestRow(row) : null;
}

export async function decideProxyAccessRequest(input: {
  id: string;
  status: "approved" | "denied";
  user_id: string;
  connection_id?: string;
  grant_id?: string;
}): Promise<ProxyAccessRequestRecord | null> {
  const result = await pool.query(
    `
      UPDATE proxy_access_requests
      SET status = $2,
          user_id = $3,
          principal_type = 'user',
          principal_id = COALESCE(principal_id, $3),
          connection_id = $4,
          grant_id = $5,
          decided_at = NOW(),
          decision = jsonb_strip_nulls(jsonb_build_object(
            'verdict', $2::text,
            'decided_by', $3::text,
            'decided_at', NOW(),
            'connection_id', $4::text,
            'mandate_id', $5::text
          ))
      WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
      RETURNING *
    `,
    [input.id, input.status, input.user_id, input.connection_id ?? null, input.grant_id ?? null],
  );
  const row = result.rows[0];
  return row ? mapAccessRequestRow(row) : null;
}

/**
 * Claims a pending access request and mints its grant in one transaction.
 *
 * The claim is the atomic gate: two concurrent approvals of the same request
 * used to pass the pending check independently and each create a grant, leaving
 * an orphaned second grant that the user never saw and could not revoke from
 * the request. Returns null when the request was already decided or expired.
 */
export async function approveAccessRequestWithGrant(input: {
  access_request_id: string;
  user_id: string;
  connection_id: string;
  provider_id: string;
  allowed_hosts: string[];
  allowed_methods: string[];
  expires_at?: string | null;
  metadata?: JsonObject;
  require_approval?: boolean;
}): Promise<ProxyGrantRecord | null> {
  return withTransaction(async (client) => {
    const claimed = await client.query(
      `
        UPDATE proxy_access_requests
        SET status = 'approved', user_id = $2, connection_id = $3,
            principal_type = 'user', principal_id = $2,
            decided_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
        RETURNING agent_id
      `,
      [input.access_request_id, input.user_id, input.connection_id],
    );
    const claim = claimed.rows[0];
    if (!claim) {
      return null;
    }

    const grantId = randomUUID();
    const constraints = buildMandateConstraints({
      hosts: input.allowed_hosts,
      methods: input.allowed_methods,
      expires_at: input.expires_at ?? null,
      require_approval: input.require_approval,
    });
    const grant = await client.query(
      `
        INSERT INTO proxy_grants (
          id, agent_id, user_id, connection_id, provider_id,
          allowed_hosts, allowed_methods, expires_at, metadata,
          principal_type, principal_id, constraints, actions
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'user',$3,$10,'[]'::jsonb)
        RETURNING *
      `,
      [
        grantId,
        String(claim.agent_id),
        input.user_id,
        input.connection_id,
        input.provider_id,
        JSON.stringify(input.allowed_hosts),
        JSON.stringify(input.allowed_methods),
        input.expires_at ?? null,
        JSON.stringify(input.metadata ?? {}),
        JSON.stringify(constraints),
      ],
    );

    await client.query(
      `
        UPDATE proxy_access_requests
        SET grant_id = $2,
            decision = jsonb_strip_nulls(jsonb_build_object(
              'verdict', 'approved',
              'decided_by', $3::text,
              'decided_at', NOW(),
              'connection_id', $4::text,
              'mandate_id', $2::text
            ))
        WHERE id = $1
      `,
      [input.access_request_id, grantId, input.user_id, input.connection_id],
    );

    return mapGrantRow(grant.rows[0]!);
  });
}

export async function findProxyGrantById(id: string): Promise<ProxyGrantRecord | null> {
  const result = await pool.query(`SELECT * FROM proxy_grants WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? mapGrantRow(row) : null;
}

export async function listProxyGrantsForAgent(agentId: string): Promise<ProxyGrantRecord[]> {
  const result = await pool.query(
    `SELECT * FROM proxy_grants WHERE agent_id = $1 ORDER BY created_at DESC`,
    [agentId],
  );
  return result.rows.map(mapGrantRow);
}

export async function listProxyGrantsForUser(userId: string): Promise<ProxyGrantRecord[]> {
  const result = await pool.query(
    `SELECT * FROM proxy_grants WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map(mapGrantRow);
}

export async function updateProxyGrantConstraints(
  id: string,
  constraints: ReturnType<typeof buildMandateConstraints>,
): Promise<ProxyGrantRecord | null> {
  const result = await pool.query(
    `
      UPDATE proxy_grants
      SET constraints = $2::jsonb, updated_at = NOW()
      WHERE id = $1 AND status = 'active'
      RETURNING *
    `,
    [id, JSON.stringify(constraints)],
  );
  const row = result.rows[0];
  return row ? mapGrantRow(row) : null;
}

export async function revokeProxyGrant(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE proxy_grants
      SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND status = 'active'
      RETURNING id
    `,
    [id, userId],
  );
  return Boolean(result.rows[0]);
}

export async function touchProxyGrant(id: string): Promise<void> {
  await pool.query(
    `UPDATE proxy_grants SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id],
  );
}

export async function writeProxyRequestAudit(input: {
  grant_id?: string | null;
  agent_id?: string | null;
  connection_id?: string | null;
  method: string;
  url_host: string;
  url_path: string;
  status_code?: number | null;
  success: boolean;
  error_code?: string | null;
  duration_ms?: number | null;
  transaction_id?: string | null;
  approval_request_id?: string | null;
  policy_decision?: string | null;
}): Promise<void> {
  await pool.query(
    `
      INSERT INTO proxy_request_audit (
        id, grant_id, agent_id, connection_id, method, url_host, url_path,
        status_code, success, error_code, duration_ms,
        transaction_id, approval_request_id, policy_decision
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    `,
    [
      randomUUID(),
      input.grant_id ?? null,
      input.agent_id ?? null,
      input.connection_id ?? null,
      input.method,
      input.url_host,
      input.url_path,
      input.status_code ?? null,
      input.success,
      input.error_code ?? null,
      input.duration_ms ?? null,
      input.transaction_id ?? null,
      input.approval_request_id ?? null,
      input.policy_decision ?? null,
    ],
  );
}
