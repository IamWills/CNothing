import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { JsonObject } from "./platform.entity";

export type ProxyAccessRequestStatus = "pending" | "approved" | "denied" | "expired";

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
};

export type ProxyGrantStatus = "active" | "revoked";

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
}): Promise<ProxyAccessRequestRecord> {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO proxy_access_requests (
        id, agent_id, provider_slug, requested_hosts, reason, user_hint, callback_url, expires_at, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() + ($8 || ' seconds')::interval,$9)
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
      WHERE user_hint = $1 AND status = 'pending' AND expires_at > NOW()
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
      SET user_hint = $2, updated_at = NOW()
      WHERE id = $1
        AND status = 'pending'
        AND expires_at > NOW()
        AND (user_hint IS NULL OR user_hint = '' OR user_hint = $2)
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
      SET status = $2, user_id = $3, connection_id = $4, grant_id = $5, decided_at = NOW()
      WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
      RETURNING *
    `,
    [input.id, input.status, input.user_id, input.connection_id ?? null, input.grant_id ?? null],
  );
  const row = result.rows[0];
  return row ? mapAccessRequestRow(row) : null;
}

export async function createProxyGrant(input: {
  agent_id: string;
  user_id: string;
  connection_id: string;
  provider_id: string;
  allowed_hosts: string[];
  allowed_methods: string[];
  expires_at?: string | null;
  metadata?: JsonObject;
}): Promise<ProxyGrantRecord> {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO proxy_grants (
        id, agent_id, user_id, connection_id, provider_id,
        allowed_hosts, allowed_methods, expires_at, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `,
    [
      id,
      input.agent_id,
      input.user_id,
      input.connection_id,
      input.provider_id,
      JSON.stringify(input.allowed_hosts),
      JSON.stringify(input.allowed_methods),
      input.expires_at ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapGrantRow(result.rows[0]!);
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

export async function revokeProxyGrant(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE proxy_grants
      SET status = 'revoked', updated_at = NOW()
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
}): Promise<void> {
  await pool.query(
    `
      INSERT INTO proxy_request_audit (
        id, grant_id, agent_id, connection_id, method, url_host, url_path,
        status_code, success, error_code, duration_ms
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
    ],
  );
}
