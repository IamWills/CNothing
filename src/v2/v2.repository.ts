import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db";
import { encryptWithAes256Gcm } from "../crypto/master-key";
import config from "../config";
import type {
  AgentRecord,
  AuthorizationRequestRecord,
  AuthorizationRequestStatus,
  CapabilityRecord,
  ConnectorRecord,
  GrantRecord,
  GrantSummary,
  InvokeAuditRecord,
  JsonObject,
  LoginTokenRecord,
  OidcProviderRecord,
  OidcProviderPublic,
  PendingConfirmationRecord,
  PendingConfirmationSummary,
  PolicyRecord,
  UserIdentityRecord,
  UserSessionRecord,
} from "./v2.entity";

function normalizeMetadata(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateAgentAccessToken(): string {
  return `agent_${randomBytes(32).toString("base64url")}`;
}

function mapAgentRow(row: Record<string, unknown>): AgentRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    public_key_pem: row.public_key_pem ? String(row.public_key_pem) : null,
    owner_user_id: String(row.owner_user_id),
    tenant_id: row.tenant_id ? String(row.tenant_id) : "default",
    status: String(row.status) as AgentRecord["status"],
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function mapConnectorRow(row: Record<string, unknown>): ConnectorRecord {
  return {
    id: String(row.id),
    provider: String(row.provider),
    display_name: String(row.display_name),
    public_key_pem: row.public_key_pem ? String(row.public_key_pem) : null,
    callback_url: String(row.callback_url),
    jwks_url: row.jwks_url ? String(row.jwks_url) : null,
    status: String(row.status) as ConnectorRecord["status"],
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function mapCapabilityRow(row: Record<string, unknown>): CapabilityRecord {
  const metadata = normalizeMetadata(row.metadata);
  const invocationConfig =
    row.invocation_config && typeof row.invocation_config === "object"
      ? normalizeMetadata(row.invocation_config)
      : normalizeMetadata(metadata.invocation_config);
  const policyConfig =
    row.policy_config && typeof row.policy_config === "object"
      ? normalizeMetadata(row.policy_config)
      : normalizeMetadata(metadata.policy_config);

  return {
    id: String(row.id),
    connector_id: String(row.connector_id),
    name: String(row.name),
    description: String(row.description ?? ""),
    capability_type: String(row.capability_type) as CapabilityRecord["capability_type"],
    input_schema: normalizeMetadata(row.input_schema),
    output_schema: normalizeMetadata(row.output_schema),
    scopes: asStringArray(row.scopes),
    risk_level: String(row.risk_level) as CapabilityRecord["risk_level"],
    status: String(row.status) as CapabilityRecord["status"],
    provider_id: row.provider_id ? String(row.provider_id) : null,
    display_name: row.display_name ? String(row.display_name) : null,
    connection_required:
      row.connection_required !== undefined ? Boolean(row.connection_required) : true,
    source: row.source ? String(row.source) : null,
    invocation_type: row.invocation_type ? String(row.invocation_type) : null,
    invocation_config: invocationConfig,
    policy_config: policyConfig,
    execution_type: (row.execution_type
      ? String(row.execution_type)
      : "oauth_api") as CapabilityRecord["execution_type"],
    approval_policy: (row.approval_policy
      ? String(row.approval_policy)
      : "none") as CapabilityRecord["approval_policy"],
    owner_user_id: row.owner_user_id ? String(row.owner_user_id) : null,
    provider: row.provider
      ? String(row.provider)
      : String(row.name).includes(".")
        ? String(row.name).split(".")[0]!
        : null,
    deleted_at: row.deleted_at ? asIso(row.deleted_at) : null,
    metadata,
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function mapGrantRow(row: Record<string, unknown>): GrantRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    agent_id: String(row.agent_id),
    capability_id: String(row.capability_id),
    scopes: asStringArray(row.scopes),
    expires_at: row.expires_at ? asIso(row.expires_at) : null,
    revoked: Boolean(row.revoked),
    revoked_at: row.revoked_at ? asIso(row.revoked_at) : null,
    provider_id: row.provider_id ? String(row.provider_id) : null,
    connection_id: row.connection_id ? String(row.connection_id) : null,
    grant_status: row.grant_status ? String(row.grant_status) : null,
    last_used_at: row.last_used_at ? asIso(row.last_used_at) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function mapPolicyRow(row: Record<string, unknown>): PolicyRecord {
  return {
    id: String(row.id),
    capability_id: row.capability_id ? String(row.capability_id) : null,
    capability_pattern: row.capability_pattern ? String(row.capability_pattern) : null,
    risk_level: row.risk_level ? (String(row.risk_level) as PolicyRecord["risk_level"]) : null,
    capability_type: row.capability_type
      ? (String(row.capability_type) as PolicyRecord["capability_type"])
      : null,
    action: String(row.action) as PolicyRecord["action"],
    priority: Number(row.priority ?? 100),
    enabled: Boolean(row.enabled),
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function mapPendingConfirmationRow(row: Record<string, unknown>): PendingConfirmationRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    agent_id: String(row.agent_id),
    capability_id: String(row.capability_id),
    input: normalizeMetadata(row.input),
    reason: row.reason ? String(row.reason) : null,
    expires_at: asIso(row.expires_at),
    confirmed_at: row.confirmed_at ? asIso(row.confirmed_at) : null,
    rejected_at: row.rejected_at ? asIso(row.rejected_at) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
  };
}

export async function createAgent(input: {
  name: string;
  owner_user_id: string;
  tenant_id?: string;
  public_key_pem?: string;
  metadata?: JsonObject;
}): Promise<{ agent: AgentRecord; access_token: string }> {
  const id = randomUUID();
  const accessToken = generateAgentAccessToken();
  const result = await pool.query(
    `
      INSERT INTO cap_agents (id, name, public_key_pem, owner_user_id, tenant_id, access_token_hash, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING *
    `,
    [
      id,
      input.name,
      input.public_key_pem ?? null,
      input.owner_user_id,
      input.tenant_id?.trim() || "default",
      hashAgentToken(accessToken),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return { agent: mapAgentRow(result.rows[0]), access_token: accessToken };
}

export async function findAgentByAccessToken(token: string): Promise<AgentRecord | null> {
  const result = await pool.query(
    `
      SELECT *
      FROM cap_agents
      WHERE access_token_hash = $1 AND status = 'active'
    `,
    [hashAgentToken(token)],
  );
  return result.rows[0] ? mapAgentRow(result.rows[0]) : null;
}

export async function findAgentById(id: string): Promise<AgentRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_agents WHERE id = $1`, [id]);
  return result.rows[0] ? mapAgentRow(result.rows[0]) : null;
}

export async function findAgentByName(name: string): Promise<AgentRecord | null> {
  const result = await pool.query(
    `SELECT * FROM cap_agents WHERE name = $1 AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
    [name],
  );
  return result.rows[0] ? mapAgentRow(result.rows[0]) : null;
}

export async function listAgents(filter?: {
  owner_user_id?: string;
  tenant_id?: string;
}): Promise<AgentRecord[]> {
  const conditions: string[] = [];
  const values: string[] = [];
  if (filter?.owner_user_id) {
    values.push(filter.owner_user_id);
    conditions.push(`owner_user_id = $${values.length}`);
  }
  if (filter?.tenant_id) {
    values.push(filter.tenant_id);
    conditions.push(`tenant_id = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM cap_agents ${where} ORDER BY created_at DESC`, values);
  return result.rows.map(mapAgentRow);
}

export async function createConnector(input: {
  provider: string;
  display_name: string;
  callback_url: string;
  public_key_pem?: string;
  jwks_url?: string;
  metadata?: JsonObject;
}): Promise<ConnectorRecord> {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO cap_connectors (id, provider, display_name, public_key_pem, callback_url, jwks_url, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING *
    `,
    [
      id,
      input.provider,
      input.display_name,
      input.public_key_pem ?? null,
      input.callback_url,
      input.jwks_url ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapConnectorRow(result.rows[0]);
}

export async function updateConnectorCallbackUrl(
  connectorId: string,
  callbackUrl: string,
): Promise<ConnectorRecord | null> {
  const result = await pool.query(
    `
      UPDATE cap_connectors
      SET callback_url = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [connectorId, callbackUrl],
  );
  return result.rows[0] ? mapConnectorRow(result.rows[0]) : null;
}

export async function findConnectorById(id: string): Promise<ConnectorRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_connectors WHERE id = $1`, [id]);
  return result.rows[0] ? mapConnectorRow(result.rows[0]) : null;
}

export async function findConnectorByProvider(provider: string): Promise<ConnectorRecord | null> {
  const result = await pool.query(
    `SELECT * FROM cap_connectors WHERE provider = $1 AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
    [provider],
  );
  return result.rows[0] ? mapConnectorRow(result.rows[0]) : null;
}

export async function listConnectors(): Promise<ConnectorRecord[]> {
  const result = await pool.query(`SELECT * FROM cap_connectors ORDER BY created_at DESC`);
  return result.rows.map(mapConnectorRow);
}

export async function createCapability(input: {
  connector_id: string;
  name: string;
  description?: string;
  capability_type?: CapabilityRecord["capability_type"];
  input_schema?: JsonObject;
  output_schema?: JsonObject;
  scopes?: string[];
  risk_level?: CapabilityRecord["risk_level"];
  metadata?: JsonObject;
}): Promise<CapabilityRecord> {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO cap_capabilities (
        id, connector_id, name, description, capability_type,
        input_schema, output_schema, scopes, risk_level, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::jsonb)
      RETURNING *
    `,
    [
      id,
      input.connector_id,
      input.name,
      input.description ?? "",
      input.capability_type ?? "ACTION",
      JSON.stringify(input.input_schema ?? {}),
      JSON.stringify(input.output_schema ?? {}),
      JSON.stringify(input.scopes ?? []),
      input.risk_level ?? "LOW",
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapCapabilityRow(result.rows[0]);
}

export async function findCapabilityByName(name: string): Promise<CapabilityRecord | null> {
  const result = await pool.query(
    `SELECT * FROM cap_capabilities WHERE name = $1 AND status = 'active' AND deleted_at IS NULL`,
    [name],
  );
  return result.rows[0] ? mapCapabilityRow(result.rows[0]) : null;
}

export async function listCapabilities(): Promise<CapabilityRecord[]> {
  const result = await pool.query(
    `SELECT * FROM cap_capabilities WHERE status = 'active' AND deleted_at IS NULL ORDER BY name ASC`,
  );
  return result.rows.map(mapCapabilityRow);
}

export async function createGrant(input: {
  user_id: string;
  agent_id: string;
  capability_id: string;
  tenant_id?: string;
  scopes?: string[];
  expires_at?: string;
  metadata?: JsonObject;
  provider_id?: string;
  connection_id?: string;
  grant_status?: string;
}): Promise<GrantRecord> {
  await pool.query(
    `
      UPDATE cap_grants
      SET revoked = TRUE, revoked_at = NOW(), updated_at = NOW()
      WHERE user_id = $1
        AND agent_id = $2
        AND capability_id = $3
        AND revoked = FALSE
    `,
    [input.user_id, input.agent_id, input.capability_id],
  );

  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO cap_grants (
        id, user_id, agent_id, capability_id, tenant_id, scopes, expires_at, metadata,
        provider_id, connection_id, grant_status
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11)
      RETURNING *
    `,
    [
      id,
      input.user_id,
      input.agent_id,
      input.capability_id,
      input.tenant_id ?? "default",
      JSON.stringify(input.scopes ?? []),
      input.expires_at ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.provider_id ?? null,
      input.connection_id ?? null,
      input.grant_status ?? "approved",
    ],
  );
  return mapGrantRow(result.rows[0]);
}

export async function findActiveGrant(input: {
  user_id: string;
  agent_id: string;
  capability_id: string;
}): Promise<GrantRecord | null> {
  const result = await pool.query(
    `
      SELECT * FROM cap_grants
      WHERE user_id = $1
        AND agent_id = $2
        AND capability_id = $3
        AND revoked = FALSE
        AND (grant_status IS NULL OR grant_status = 'approved')
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.user_id, input.agent_id, input.capability_id],
  );
  return result.rows[0] ? mapGrantRow(result.rows[0]) : null;
}

export async function findActiveGrantsForAgentCapability(input: {
  agent_id: string;
  capability_id: string;
}): Promise<GrantRecord[]> {
  const result = await pool.query(
    `
      SELECT * FROM cap_grants
      WHERE agent_id = $1
        AND capability_id = $2
        AND revoked = FALSE
        AND (grant_status IS NULL OR grant_status = 'approved')
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
    `,
    [input.agent_id, input.capability_id],
  );
  return result.rows.map(mapGrantRow);
}

export async function revokeGrant(grantId: string): Promise<GrantRecord | null> {
  const result = await pool.query(
    `
      UPDATE cap_grants
      SET revoked = TRUE,
          revoked_at = NOW(),
          grant_status = 'revoked',
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [grantId],
  );
  return result.rows[0] ? mapGrantRow(result.rows[0]) : null;
}

export async function touchGrantLastUsed(grantId: string): Promise<void> {
  await pool.query(
    `UPDATE cap_grants SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [grantId],
  );
}

export async function listGrants(filter?: {
  user_id?: string;
  agent_id?: string;
}): Promise<GrantRecord[]> {
  const clauses: string[] = [];
  const values: string[] = [];
  if (filter?.user_id) {
    values.push(filter.user_id);
    clauses.push(`user_id = $${values.length}`);
  }
  if (filter?.agent_id) {
    values.push(filter.agent_id);
    clauses.push(`agent_id = $${values.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT * FROM cap_grants ${where} ORDER BY created_at DESC`,
    values,
  );
  return result.rows.map(mapGrantRow);
}

export async function listGrantSummaries(filter?: {
  user_id?: string;
  agent_id?: string;
  tenant_id?: string;
}): Promise<GrantSummary[]> {
  const clauses: string[] = ["g.revoked = FALSE"];
  const values: string[] = [];
  if (filter?.user_id) {
    values.push(filter.user_id);
    clauses.push(`g.user_id = $${values.length}`);
  }
  if (filter?.agent_id) {
    values.push(filter.agent_id);
    clauses.push(`g.agent_id = $${values.length}`);
  }
  if (filter?.tenant_id) {
    values.push(filter.tenant_id);
    clauses.push(`g.tenant_id = $${values.length}`);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const result = await pool.query(
    `
      SELECT
        g.*,
        c.name AS capability_name,
        c.description AS capability_description,
        a.name AS agent_name,
        conn.provider AS connector_provider
      FROM cap_grants g
      JOIN cap_capabilities c ON c.id = g.capability_id
      JOIN cap_agents a ON a.id = g.agent_id
      JOIN cap_connectors conn ON conn.id = c.connector_id
      ${where}
      ORDER BY g.created_at DESC
    `,
    values,
  );
  return result.rows.map((row) => ({
    ...mapGrantRow(row),
    capability_name: String(row.capability_name),
    capability_description: String(row.capability_description ?? ""),
    agent_name: String(row.agent_name),
    connector_provider: String(row.connector_provider),
  }));
}

function mapAuthorizationRequestRow(row: Record<string, unknown>): AuthorizationRequestRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    agent_id: String(row.agent_id),
    requested_capabilities: asStringArray(row.requested_capabilities),
    granted_capabilities: asStringArray(row.granted_capabilities),
    status: String(row.status) as AuthorizationRequestStatus,
    redirect_uri: row.redirect_uri ? String(row.redirect_uri) : null,
    state: row.state ? String(row.state) : null,
    reason: row.reason ? String(row.reason) : null,
    expires_at: asIso(row.expires_at),
    approved_at: row.approved_at ? asIso(row.approved_at) : null,
    denied_at: row.denied_at ? asIso(row.denied_at) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

export async function createAuthorizationRequest(input: {
  user_id: string;
  agent_id: string;
  requested_capabilities: string[];
  redirect_uri?: string;
  state?: string;
  reason?: string;
  ttlSeconds?: number;
  metadata?: JsonObject;
}): Promise<AuthorizationRequestRecord> {
  const id = randomUUID();
  const ttl = input.ttlSeconds ?? 900;
  const result = await pool.query(
    `
      INSERT INTO cap_authorization_requests (
        id, user_id, agent_id, requested_capabilities, redirect_uri, state, reason, expires_at, metadata
      )
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, NOW() + ($8 || ' seconds')::interval, $9::jsonb)
      RETURNING *
    `,
    [
      id,
      input.user_id,
      input.agent_id,
      JSON.stringify(input.requested_capabilities),
      input.redirect_uri ?? null,
      input.state ?? null,
      input.reason ?? null,
      String(ttl),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapAuthorizationRequestRow(result.rows[0]);
}

export async function findAuthorizationRequest(id: string): Promise<AuthorizationRequestRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_authorization_requests WHERE id = $1`, [id]);
  if (!result.rows[0]) return null;
  const record = mapAuthorizationRequestRow(result.rows[0]);
  if (record.status === "pending" && record.expires_at <= new Date().toISOString()) {
    await pool.query(
      `UPDATE cap_authorization_requests SET status = 'expired', updated_at = NOW() WHERE id = $1`,
      [id],
    );
    return { ...record, status: "expired" };
  }
  return record;
}

export async function bindAuthorizationRequestUser(input: {
  id: string;
  user_id: string;
}): Promise<AuthorizationRequestRecord | null> {
  const result = await pool.query(
    `
      UPDATE cap_authorization_requests
      SET user_id = $2, updated_at = NOW()
      WHERE id = $1
        AND status = 'pending'
        AND expires_at > NOW()
      RETURNING *
    `,
    [input.id, input.user_id],
  );
  return result.rows[0] ? mapAuthorizationRequestRow(result.rows[0]) : null;
}

export async function approveAuthorizationRequest(input: {
  id: string;
  granted_capabilities?: string[];
}): Promise<AuthorizationRequestRecord | null> {
  const existing = await findAuthorizationRequest(input.id);
  if (!existing || existing.status !== "pending") {
    return existing;
  }

  const granted =
    input.granted_capabilities && input.granted_capabilities.length > 0
      ? input.granted_capabilities
      : existing.requested_capabilities;

  const result = await pool.query(
    `
      UPDATE cap_authorization_requests
      SET
        status = 'approved',
        granted_capabilities = $2::jsonb,
        approved_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
        AND status = 'pending'
        AND expires_at > NOW()
      RETURNING *
    `,
    [input.id, JSON.stringify(granted)],
  );
  return result.rows[0] ? mapAuthorizationRequestRow(result.rows[0]) : null;
}

export async function denyAuthorizationRequest(id: string): Promise<AuthorizationRequestRecord | null> {
  const result = await pool.query(
    `
      UPDATE cap_authorization_requests
      SET status = 'denied', denied_at = NOW(), updated_at = NOW()
      WHERE id = $1
        AND status = 'pending'
      RETURNING *
    `,
    [id],
  );
  return result.rows[0] ? mapAuthorizationRequestRow(result.rows[0]) : null;
}

export async function listAuthorizationRequests(input: {
  user_id?: string;
  agent_id?: string;
  status?: AuthorizationRequestStatus;
  limit?: number;
}): Promise<AuthorizationRequestRecord[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (input.user_id) {
    clauses.push(`user_id = $${i++}`);
    values.push(input.user_id);
  }
  if (input.agent_id) {
    clauses.push(`agent_id = $${i++}`);
    values.push(input.agent_id);
  }
  if (input.status) {
    clauses.push(`status = $${i++}`);
    values.push(input.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  values.push(Math.min(input.limit ?? 50, 200));
  const result = await pool.query(
    `SELECT * FROM cap_authorization_requests ${where} ORDER BY created_at DESC LIMIT $${i}`,
    values,
  );
  return result.rows.map(mapAuthorizationRequestRow);
}

export async function listPendingConfirmations(filter?: {
  user_id?: string;
}): Promise<PendingConfirmationSummary[]> {
  const clauses = [
    "p.confirmed_at IS NULL",
    "p.rejected_at IS NULL",
    "p.expires_at > NOW()",
  ];
  const values: string[] = [];
  if (filter?.user_id) {
    values.push(filter.user_id);
    clauses.push(`p.user_id = $${values.length}`);
  }
  const result = await pool.query(
    `
      SELECT p.*, c.name AS capability_name, a.name AS agent_name
      FROM cap_pending_confirmations p
      JOIN cap_capabilities c ON c.id = p.capability_id
      JOIN cap_agents a ON a.id = p.agent_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY p.created_at DESC
    `,
    values,
  );
  return result.rows.map((row) => ({
    ...mapPendingConfirmationRow(row),
    capability_name: String(row.capability_name),
    agent_name: String(row.agent_name),
  }));
}

export async function listInvokeAudit(input?: {
  limit?: number;
  agent_id?: string;
  user_id?: string;
}): Promise<InvokeAuditRecord[]> {
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (input?.agent_id) {
    values.push(input.agent_id);
    clauses.push(`agent_id = $${values.length}`);
  }
  if (input?.user_id) {
    values.push(input.user_id);
    clauses.push(`user_id = $${values.length}`);
  }
  values.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await pool.query(
    `
      SELECT * FROM cap_invoke_audit
      ${where}
      ORDER BY created_at DESC
      LIMIT $${values.length}
    `,
    values,
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    user_id: row.user_id ? String(row.user_id) : null,
    agent_id: row.agent_id ? String(row.agent_id) : null,
    capability_id: row.capability_id ? String(row.capability_id) : null,
    capability_name: String(row.capability_name),
    connector_id: row.connector_id ? String(row.connector_id) : null,
    provider_id: row.provider_id ? String(row.provider_id) : null,
    connection_id: row.connection_id ? String(row.connection_id) : null,
    policy_decision: String(row.policy_decision),
    status: String(row.status),
    request_id: row.request_id ? String(row.request_id) : null,
    error_code: row.error_code ? String(row.error_code) : null,
    input_hash: row.input_hash ? String(row.input_hash) : null,
    output_hash: row.output_hash ? String(row.output_hash) : null,
    success: row.success === null || row.success === undefined ? null : Boolean(row.success),
    risk_level: row.risk_level ? String(row.risk_level) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
  }));
}

export async function findCapabilitiesByNames(names: string[]): Promise<CapabilityRecord[]> {
  if (names.length === 0) return [];
  const result = await pool.query(
    `SELECT * FROM cap_capabilities WHERE name = ANY($1::text[]) AND status = 'active'`,
    [names],
  );
  return result.rows.map(mapCapabilityRow);
}

export async function findCapabilityById(id: string): Promise<CapabilityRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_capabilities WHERE id = $1`, [id]);
  return result.rows[0] ? mapCapabilityRow(result.rows[0]) : null;
}

export async function listPolicies(): Promise<PolicyRecord[]> {
  const result = await pool.query(`SELECT * FROM cap_policies WHERE enabled = TRUE ORDER BY priority ASC`);
  return result.rows.map(mapPolicyRow);
}

export async function storeCredential(input: {
  connector_id: string;
  owner_user_id: string;
  secret: Buffer;
  metadata?: JsonObject;
}): Promise<string> {
  const id = randomUUID();
  const encrypted = encryptWithAes256Gcm({
    plaintext: input.secret,
    key: config.masterKey,
  });
  const payload = Buffer.concat([encrypted.iv, encrypted.tag, encrypted.ciphertext]);
  await pool.query(
    `
      INSERT INTO cap_credentials (id, connector_id, owner_user_id, encrypted_secret, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [id, input.connector_id, input.owner_user_id, payload, JSON.stringify(input.metadata ?? {})],
  );
  return id;
}

export type UserCredentialRecord = {
  id: string;
  connector_id: string;
  owner_user_id: string;
  encrypted_secret: Buffer;
  metadata: JsonObject;
};

export async function findUserCredential(input: {
  connector_id: string;
  owner_user_id: string;
}): Promise<UserCredentialRecord | null> {
  const result = await pool.query(
    `
      SELECT * FROM cap_credentials
      WHERE connector_id = $1 AND owner_user_id = $2
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [input.connector_id, input.owner_user_id],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    connector_id: String(row.connector_id),
    owner_user_id: String(row.owner_user_id),
    encrypted_secret: row.encrypted_secret as Buffer,
    metadata: normalizeMetadata(row.metadata),
  };
}

export async function upsertUserCredential(input: {
  connector_id: string;
  owner_user_id: string;
  secret: Buffer;
  metadata?: JsonObject;
}): Promise<string> {
  const existing = await findUserCredential({
    connector_id: input.connector_id,
    owner_user_id: input.owner_user_id,
  });

  const encrypted = encryptWithAes256Gcm({
    plaintext: input.secret,
    key: config.masterKey,
  });
  const payload = Buffer.concat([encrypted.iv, encrypted.tag, encrypted.ciphertext]);

  if (existing) {
    await pool.query(
      `
        UPDATE cap_credentials
        SET encrypted_secret = $3, metadata = $4::jsonb, updated_at = NOW()
        WHERE id = $1 AND connector_id = $2
      `,
      [existing.id, input.connector_id, payload, JSON.stringify(input.metadata ?? {})],
    );
    return existing.id;
  }

  const id = randomUUID();
  await pool.query(
    `
      INSERT INTO cap_credentials (id, connector_id, owner_user_id, encrypted_secret, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [id, input.connector_id, input.owner_user_id, payload, JSON.stringify(input.metadata ?? {})],
  );
  return id;
}

export async function createPendingConfirmation(input: {
  user_id: string;
  agent_id: string;
  capability_id: string;
  input: JsonObject;
  reason?: string;
  ttlSeconds?: number;
}): Promise<PendingConfirmationRecord> {
  const id = randomUUID();
  const ttl = input.ttlSeconds ?? 600;
  const result = await pool.query(
    `
      INSERT INTO cap_pending_confirmations (id, user_id, agent_id, capability_id, input, reason, expires_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW() + ($7 || ' seconds')::interval)
      RETURNING *
    `,
    [
      id,
      input.user_id,
      input.agent_id,
      input.capability_id,
      JSON.stringify(input.input),
      input.reason ?? null,
      String(ttl),
    ],
  );
  return mapPendingConfirmationRow(result.rows[0]);
}

export async function findPendingConfirmation(id: string): Promise<PendingConfirmationRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_pending_confirmations WHERE id = $1`, [id]);
  return result.rows[0] ? mapPendingConfirmationRow(result.rows[0]) : null;
}

export async function confirmPendingConfirmation(id: string): Promise<PendingConfirmationRecord | null> {
  const result = await pool.query(
    `
      UPDATE cap_pending_confirmations
      SET confirmed_at = NOW()
      WHERE id = $1
        AND confirmed_at IS NULL
        AND rejected_at IS NULL
        AND expires_at > NOW()
      RETURNING *
    `,
    [id],
  );
  return result.rows[0] ? mapPendingConfirmationRow(result.rows[0]) : null;
}

export async function rejectPendingConfirmation(id: string): Promise<PendingConfirmationRecord | null> {
  const result = await pool.query(
    `
      UPDATE cap_pending_confirmations
      SET rejected_at = NOW()
      WHERE id = $1
        AND confirmed_at IS NULL
        AND rejected_at IS NULL
      RETURNING *
    `,
    [id],
  );
  return result.rows[0] ? mapPendingConfirmationRow(result.rows[0]) : null;
}

export async function writeInvokeAudit(input: {
  user_id?: string | null;
  agent_id?: string;
  capability_id?: string;
  capability_name: string;
  connector_id?: string;
  provider_id?: string;
  connection_id?: string;
  policy_decision: string;
  status: string;
  request_id?: string;
  error_code?: string | null;
  metadata?: JsonObject;
  input_hash?: string;
  output_hash?: string;
  success?: boolean;
  risk_level?: string;
}): Promise<InvokeAuditRecord> {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO cap_invoke_audit (
        id, user_id, agent_id, capability_id, capability_name, connector_id,
        provider_id, connection_id,
        policy_decision, status, request_id, error_code, metadata,
        input_hash, output_hash, success, risk_level
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17)
      RETURNING *
    `,
    [
      id,
      input.user_id ?? null,
      input.agent_id ?? null,
      input.capability_id ?? null,
      input.capability_name,
      input.connector_id ?? null,
      input.provider_id ?? null,
      input.connection_id ?? null,
      input.policy_decision,
      input.status,
      input.request_id ?? null,
      input.error_code ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.input_hash ?? null,
      input.output_hash ?? null,
      input.success ?? null,
      input.risk_level ?? null,
    ],
  );
  const row = result.rows[0];
  return {
    id: String(row.id),
    user_id: row.user_id ? String(row.user_id) : null,
    agent_id: row.agent_id ? String(row.agent_id) : null,
    capability_id: row.capability_id ? String(row.capability_id) : null,
    capability_name: String(row.capability_name),
    connector_id: row.connector_id ? String(row.connector_id) : null,
    provider_id: row.provider_id ? String(row.provider_id) : null,
    connection_id: row.connection_id ? String(row.connection_id) : null,
    policy_decision: String(row.policy_decision),
    status: String(row.status),
    request_id: row.request_id ? String(row.request_id) : null,
    error_code: row.error_code ? String(row.error_code) : null,
    input_hash: row.input_hash ? String(row.input_hash) : null,
    output_hash: row.output_hash ? String(row.output_hash) : null,
    success: row.success === null || row.success === undefined ? null : Boolean(row.success),
    risk_level: row.risk_level ? String(row.risk_level) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
  };
}

function mapUserSessionRow(row: Record<string, unknown>): UserSessionRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    expires_at: asIso(row.expires_at),
    revoked: Boolean(row.revoked),
    revoked_at: row.revoked_at ? asIso(row.revoked_at) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function mapLoginTokenRow(row: Record<string, unknown>): LoginTokenRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    expires_at: asIso(row.expires_at),
    used_at: row.used_at ? asIso(row.used_at) : null,
    created_by: row.created_by ? String(row.created_by) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
  };
}

export async function createUserSession(input: {
  user_id: string;
  session_token_hash: string;
  ttl_seconds: number;
  metadata?: JsonObject;
}): Promise<UserSessionRecord> {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO cap_user_sessions (id, user_id, session_token_hash, expires_at, metadata)
      VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval, $5::jsonb)
      RETURNING id, user_id, expires_at, revoked, revoked_at, metadata, created_at, updated_at
    `,
    [id, input.user_id, input.session_token_hash, String(input.ttl_seconds), JSON.stringify(input.metadata ?? {})],
  );
  return mapUserSessionRow(result.rows[0]);
}

export async function findUserSessionByToken(sessionTokenHash: string): Promise<UserSessionRecord | null> {
  const result = await pool.query(
    `
      SELECT id, user_id, expires_at, revoked, revoked_at, metadata, created_at, updated_at
      FROM cap_user_sessions
      WHERE session_token_hash = $1
        AND revoked = FALSE
        AND expires_at > NOW()
    `,
    [sessionTokenHash],
  );
  return result.rows[0] ? mapUserSessionRow(result.rows[0]) : null;
}

export async function revokeUserSession(sessionTokenHash: string): Promise<UserSessionRecord | null> {
  const result = await pool.query(
    `
      UPDATE cap_user_sessions
      SET revoked = TRUE, revoked_at = NOW(), updated_at = NOW()
      WHERE session_token_hash = $1 AND revoked = FALSE
      RETURNING id, user_id, expires_at, revoked, revoked_at, metadata, created_at, updated_at
    `,
    [sessionTokenHash],
  );
  return result.rows[0] ? mapUserSessionRow(result.rows[0]) : null;
}

export async function createLoginToken(input: {
  user_id: string;
  token_hash: string;
  ttl_seconds: number;
  created_by?: string | null;
  metadata?: JsonObject;
}): Promise<LoginTokenRecord> {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO cap_login_tokens (id, user_id, token_hash, expires_at, created_by, metadata)
      VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval, $5, $6::jsonb)
      RETURNING *
    `,
    [
      id,
      input.user_id,
      input.token_hash,
      String(input.ttl_seconds),
      input.created_by ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapLoginTokenRow(result.rows[0]);
}

export async function consumeLoginToken(input: {
  user_id: string;
  token_hash: string;
}): Promise<LoginTokenRecord | null> {
  const result = await pool.query(
    `
      UPDATE cap_login_tokens
      SET used_at = NOW()
      WHERE user_id = $1
        AND token_hash = $2
        AND used_at IS NULL
        AND expires_at > NOW()
      RETURNING *
    `,
    [input.user_id, input.token_hash],
  );
  return result.rows[0] ? mapLoginTokenRow(result.rows[0]) : null;
}

function mapOidcProviderRow(row: Record<string, unknown>): OidcProviderRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    display_name: String(row.display_name),
    issuer: String(row.issuer),
    client_id: String(row.client_id),
    client_secret_encrypted: row.client_secret_encrypted as Buffer,
    scopes: String(row.scopes ?? "openid profile email"),
    enabled: Boolean(row.enabled),
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function mapUserIdentityRow(row: Record<string, unknown>): UserIdentityRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    provider_id: String(row.provider_id),
    subject: String(row.subject),
    email: row.email ? String(row.email) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

export async function createOidcProvider(input: {
  name: string;
  display_name: string;
  issuer: string;
  client_id: string;
  client_secret_encrypted: Buffer;
  scopes?: string;
  metadata?: JsonObject;
}): Promise<OidcProviderRecord> {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO cap_oidc_providers (
        id, name, display_name, issuer, client_id, client_secret_encrypted, scopes, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      RETURNING *
    `,
    [
      id,
      input.name,
      input.display_name,
      input.issuer.replace(/\/+$/, ""),
      input.client_id,
      input.client_secret_encrypted,
      input.scopes ?? "openid profile email",
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapOidcProviderRow(result.rows[0]);
}

export async function listOidcProviders(includeDisabled = false): Promise<OidcProviderRecord[]> {
  const result = await pool.query(
    `
      SELECT * FROM cap_oidc_providers
      ${includeDisabled ? "" : "WHERE enabled = TRUE"}
      ORDER BY display_name ASC
    `,
  );
  return result.rows.map(mapOidcProviderRow);
}

export async function findOidcProviderByName(name: string): Promise<OidcProviderRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_oidc_providers WHERE name = $1 AND enabled = TRUE`, [
    name,
  ]);
  return result.rows[0] ? mapOidcProviderRow(result.rows[0]) : null;
}

export async function findOidcProviderById(id: string): Promise<OidcProviderRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_oidc_providers WHERE id = $1 AND enabled = TRUE`, [id]);
  return result.rows[0] ? mapOidcProviderRow(result.rows[0]) : null;
}

export async function createOidcState(input: {
  provider_id: string;
  state: string;
  nonce: string;
  redirect_after?: string;
  ttl_seconds?: number;
}): Promise<void> {
  await pool.query(
    `
      INSERT INTO cap_oidc_states (id, provider_id, state, nonce, redirect_after, expires_at)
      VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' seconds')::interval)
    `,
    [
      randomUUID(),
      input.provider_id,
      input.state,
      input.nonce,
      input.redirect_after ?? null,
      String(input.ttl_seconds ?? 600),
    ],
  );
}

export async function consumeOidcState(state: string): Promise<{
  provider_id: string;
  nonce: string;
  redirect_after: string | null;
} | null> {
  const result = await pool.query(
    `
      UPDATE cap_oidc_states
      SET consumed_at = NOW()
      WHERE state = $1
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING provider_id, nonce, redirect_after
    `,
    [state],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    provider_id: String(row.provider_id),
    nonce: String(row.nonce),
    redirect_after: row.redirect_after ? String(row.redirect_after) : null,
  };
}

export async function upsertUserIdentity(input: {
  user_id: string;
  provider_id: string;
  subject: string;
  email?: string | null;
  metadata?: JsonObject;
}): Promise<UserIdentityRecord> {
  const id = randomUUID();
  const result = await pool.query(
    `
      INSERT INTO cap_user_identities (id, user_id, provider_id, subject, email, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (provider_id, subject)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        email = EXCLUDED.email,
        metadata = cap_user_identities.metadata || EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *
    `,
    [
      id,
      input.user_id,
      input.provider_id,
      input.subject,
      input.email ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapUserIdentityRow(result.rows[0]);
}

export function toPublicOidcProvider(provider: OidcProviderRecord): OidcProviderPublic {
  return {
    id: provider.id,
    name: provider.name,
    display_name: provider.display_name,
    issuer: provider.issuer,
    scopes: provider.scopes,
  };
}
