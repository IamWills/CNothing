import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db";
import type {
  AgentRecord,
  JsonObject,
  OidcProviderPublic,
  OidcProviderRecord,
  UserIdentityRecord,
  UserSessionRecord,
} from "./platform.entity";

function normalizeMetadata(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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

export function generateAgentAccessToken(): string {
  return `agent_${randomBytes(32).toString("base64url")}`;
}

export async function createAgent(input: {
  name: string;
  owner_user_id: string;
  tenant_id?: string;
  public_key_pem?: string;
  metadata?: JsonObject;
}): Promise<{ agent: AgentRecord; access_token: string }> {
  const accessToken = generateAgentAccessToken();
  const result = await pool.query(
    `INSERT INTO cap_agents
       (id, name, public_key_pem, owner_user_id, tenant_id, access_token_hash, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING *`,
    [
      randomUUID(),
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
    `SELECT * FROM cap_agents WHERE access_token_hash = $1 AND status = 'active'`,
    [hashAgentToken(token)],
  );
  return result.rows[0] ? mapAgentRow(result.rows[0]) : null;
}

export async function listAgents(filter?: { owner_user_id?: string }): Promise<AgentRecord[]> {
  const values: string[] = [];
  const where = filter?.owner_user_id
    ? (values.push(filter.owner_user_id), "WHERE owner_user_id = $1")
    : "";
  const result = await pool.query(`SELECT * FROM cap_agents ${where} ORDER BY created_at DESC`, values);
  return result.rows.map(mapAgentRow);
}

export async function revokeAgent(input: { id: string; owner_user_id?: string }): Promise<boolean> {
  const values: string[] = [input.id];
  const ownerClause = input.owner_user_id
    ? (values.push(input.owner_user_id), ` AND owner_user_id = $${values.length}`)
    : "";
  const result = await pool.query(
    `UPDATE cap_agents SET status = 'revoked', updated_at = NOW()
     WHERE id = $1${ownerClause} AND status <> 'revoked'`,
    values,
  );
  return (result.rowCount ?? 0) > 0;
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

export async function createUserSession(input: {
  user_id: string;
  session_token_hash: string;
  ttl_seconds: number;
  metadata?: JsonObject;
}): Promise<UserSessionRecord> {
  const result = await pool.query(
    `INSERT INTO cap_user_sessions (id, user_id, session_token_hash, expires_at, metadata)
     VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval, $5::jsonb)
     RETURNING id, user_id, expires_at, revoked, revoked_at, metadata, created_at, updated_at`,
    [randomUUID(), input.user_id, input.session_token_hash, String(input.ttl_seconds), JSON.stringify(input.metadata ?? {})],
  );
  return mapUserSessionRow(result.rows[0]);
}

export async function findUserSessionByToken(hash: string): Promise<UserSessionRecord | null> {
  const result = await pool.query(
    `SELECT id, user_id, expires_at, revoked, revoked_at, metadata, created_at, updated_at
     FROM cap_user_sessions
     WHERE session_token_hash = $1 AND revoked = FALSE AND expires_at > NOW()`,
    [hash],
  );
  return result.rows[0] ? mapUserSessionRow(result.rows[0]) : null;
}

export async function revokeUserSession(hash: string): Promise<UserSessionRecord | null> {
  const result = await pool.query(
    `UPDATE cap_user_sessions SET revoked = TRUE, revoked_at = NOW(), updated_at = NOW()
     WHERE session_token_hash = $1 AND revoked = FALSE
     RETURNING id, user_id, expires_at, revoked, revoked_at, metadata, created_at, updated_at`,
    [hash],
  );
  return result.rows[0] ? mapUserSessionRow(result.rows[0]) : null;
}

function mapOidcProviderRow(row: Record<string, unknown>): OidcProviderRecord {
  return {
    id: String(row.id), name: String(row.name), display_name: String(row.display_name),
    issuer: String(row.issuer), client_id: String(row.client_id),
    client_secret_encrypted: row.client_secret_encrypted as Buffer,
    scopes: String(row.scopes ?? "openid profile email"), enabled: Boolean(row.enabled),
    metadata: normalizeMetadata(row.metadata), created_at: asIso(row.created_at), updated_at: asIso(row.updated_at),
  };
}

export async function createOidcProvider(input: {
  name: string; display_name: string; issuer: string; client_id: string;
  client_secret_encrypted: Buffer; scopes?: string; metadata?: JsonObject;
}): Promise<OidcProviderRecord> {
  const result = await pool.query(
    `INSERT INTO cap_oidc_providers
       (id, name, display_name, issuer, client_id, client_secret_encrypted, scopes, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING *`,
    [randomUUID(), input.name, input.display_name, input.issuer.replace(/\/+$/, ""), input.client_id,
      input.client_secret_encrypted, input.scopes ?? "openid profile email", JSON.stringify(input.metadata ?? {})],
  );
  return mapOidcProviderRow(result.rows[0]);
}

export async function listOidcProviders(includeDisabled = false): Promise<OidcProviderRecord[]> {
  const result = await pool.query(
    `SELECT * FROM cap_oidc_providers ${includeDisabled ? "" : "WHERE enabled = TRUE"} ORDER BY display_name ASC`,
  );
  return result.rows.map(mapOidcProviderRow);
}

export async function findOidcProviderByName(name: string): Promise<OidcProviderRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_oidc_providers WHERE name = $1 AND enabled = TRUE`, [name]);
  return result.rows[0] ? mapOidcProviderRow(result.rows[0]) : null;
}

export async function findOidcProviderById(id: string): Promise<OidcProviderRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_oidc_providers WHERE id = $1 AND enabled = TRUE`, [id]);
  return result.rows[0] ? mapOidcProviderRow(result.rows[0]) : null;
}

export async function createOidcState(input: {
  provider_id: string; state: string; nonce: string; redirect_after?: string; ttl_seconds?: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO cap_oidc_states (id, provider_id, state, nonce, redirect_after, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' seconds')::interval)`,
    [randomUUID(), input.provider_id, input.state, input.nonce, input.redirect_after ?? null, String(input.ttl_seconds ?? 600)],
  );
}

export async function consumeOidcState(state: string): Promise<{ provider_id: string; nonce: string; redirect_after: string | null } | null> {
  const result = await pool.query(
    `UPDATE cap_oidc_states SET consumed_at = NOW()
     WHERE state = $1 AND consumed_at IS NULL AND expires_at > NOW()
     RETURNING provider_id, nonce, redirect_after`, [state],
  );
  const row = result.rows[0];
  return row ? { provider_id: String(row.provider_id), nonce: String(row.nonce), redirect_after: row.redirect_after ? String(row.redirect_after) : null } : null;
}

export async function upsertUserIdentity(input: {
  user_id: string; provider_id: string; subject: string; email?: string | null; metadata?: JsonObject;
}): Promise<UserIdentityRecord> {
  const result = await pool.query(
    `INSERT INTO cap_user_identities (id, user_id, provider_id, subject, email, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (provider_id, subject) DO UPDATE SET
       user_id = EXCLUDED.user_id, email = EXCLUDED.email,
       metadata = cap_user_identities.metadata || EXCLUDED.metadata, updated_at = NOW()
     RETURNING *`,
    [randomUUID(), input.user_id, input.provider_id, input.subject, input.email ?? null, JSON.stringify(input.metadata ?? {})],
  );
  const row = result.rows[0];
  return { id: String(row.id), user_id: String(row.user_id), provider_id: String(row.provider_id), subject: String(row.subject),
    email: row.email ? String(row.email) : null, metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at), updated_at: asIso(row.updated_at) };
}

export function toPublicOidcProvider(provider: OidcProviderRecord): OidcProviderPublic {
  return { id: provider.id, name: provider.name, display_name: provider.display_name, issuer: provider.issuer, scopes: provider.scopes };
}
