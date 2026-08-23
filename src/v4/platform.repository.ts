import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db";
import type {
  AgentRecord,
  JsonObject,
  UserIdentityRecord,
  UserRecord,
  UserRole,
  UserSessionRecord,
} from "./platform.entity";

type Queryable = Pick<typeof pool, "query"> | PoolClient;

function asQueryable(client?: Queryable): Queryable {
  return client ?? pool;
}

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
  client?: Queryable;
}): Promise<{ agent: AgentRecord; access_token: string }> {
  const accessToken = generateAgentAccessToken();
  const db = asQueryable(input.client);
  const result = await db.query(
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

function mapIdentityRow(row: Record<string, unknown>): UserIdentityRecord {
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

export async function findIdentityByProviderSubject(
  providerId: string,
  subject: string,
): Promise<UserIdentityRecord | null> {
  const result = await pool.query(
    `SELECT * FROM cap_user_identities WHERE provider_id = $1 AND subject = $2 LIMIT 1`,
    [providerId, subject],
  );
  return result.rows[0] ? mapIdentityRow(result.rows[0]) : null;
}

export async function findLatestIdentityForUser(userId: string): Promise<UserIdentityRecord | null> {
  const result = await pool.query(
    `SELECT * FROM cap_user_identities WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [userId],
  );
  return result.rows[0] ? mapIdentityRow(result.rows[0]) : null;
}

export function identityDisplayFields(identity: UserIdentityRecord | null): {
  email: string | null;
  display_name: string | null;
} {
  const displayName =
    typeof identity?.metadata.display_name === "string"
      ? identity.metadata.display_name.trim()
      : typeof identity?.metadata.name === "string"
        ? identity.metadata.name.trim()
        : "";
  return {
    email: identity?.email ?? null,
    display_name: displayName || null,
  };
}

function parseUserRole(value: unknown): UserRole {
  return value === "admin" ? "admin" : "user";
}

function mapUserRow(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    role: parseUserRole(row.role),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

export async function findUserById(id: string, client?: Queryable): Promise<UserRecord | null> {
  const result = await asQueryable(client).query(`SELECT id, role, created_at, updated_at FROM cap_users WHERE id = $1`, [
    id,
  ]);
  return result.rows[0] ? mapUserRow(result.rows[0]) : null;
}

/** Inserts a Human user at least privilege. Never promotes, and never copies role from a client or IdP. */
export async function ensureUser(id: string, client?: Queryable): Promise<UserRecord> {
  const result = await asQueryable(client).query(
    `INSERT INTO cap_users (id, role)
     VALUES ($1, 'user')
     ON CONFLICT (id) DO UPDATE SET updated_at = cap_users.updated_at
     RETURNING id, role, created_at, updated_at`,
    [id],
  );
  return mapUserRow(result.rows[0]);
}

export async function countAdmins(client?: Queryable): Promise<number> {
  const result = await asQueryable(client).query(
    `SELECT COUNT(*)::int AS n FROM cap_users WHERE role = 'admin'`,
  );
  return Number(result.rows[0]?.n ?? 0);
}

export async function setUserRole(
  input: { id: string; role: UserRole },
  client?: Queryable,
): Promise<UserRecord> {
  const result = await asQueryable(client).query(
    `UPDATE cap_users SET role = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING id, role, created_at, updated_at`,
    [input.id, input.role],
  );
  if (!result.rows[0]) {
    throw new Error(`User not found: ${input.id}`);
  }
  return mapUserRow(result.rows[0]);
}