import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db";
import config from "../config";
import { encryptWithAes256Gcm, decryptWithAes256Gcm } from "../crypto/master-key";
import type { JsonObject } from "./v2.entity";
import type {
  OAuthAuthType,
  OAuthConnectionPublic,
  OAuthConnectionRecord,
  OAuthConnectionStatus,
  OAuthConnectStateRecord,
  OAuthProviderPublic,
  OAuthProviderRecord,
  OAuthProviderStatus,
} from "./v2.5.entity";

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

function packEncrypted(plaintext: string): Buffer {
  const wrapped = encryptWithAes256Gcm({
    plaintext: Buffer.from(plaintext, "utf8"),
    key: config.masterKey,
  });
  return Buffer.concat([wrapped.iv, wrapped.tag, wrapped.ciphertext]);
}

export function unpackEncrypted(packed: Buffer): string {
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  return decryptWithAes256Gcm({
    ciphertext,
    key: config.masterKey,
    iv,
    tag,
  }).toString("utf8");
}

function mapProviderRow(row: Record<string, unknown>): OAuthProviderRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    display_name: String(row.display_name),
    auth_type: String(row.auth_type) as OAuthAuthType,
    authorization_url: row.authorization_url ? String(row.authorization_url) : null,
    token_url: row.token_url ? String(row.token_url) : null,
    userinfo_url: row.userinfo_url ? String(row.userinfo_url) : null,
    revoke_url: row.revoke_url ? String(row.revoke_url) : null,
    jwks_url: row.jwks_url ? String(row.jwks_url) : null,
    client_id: row.client_id ? String(row.client_id) : null,
    encrypted_client_secret: row.encrypted_client_secret
      ? Buffer.from(row.encrypted_client_secret as Buffer)
      : null,
    secret_alg: String(row.secret_alg ?? "aes-256-gcm/master-key"),
    default_scopes: asStringArray(row.default_scopes),
    supported_scopes: asStringArray(row.supported_scopes),
    pkce_required: Boolean(row.pkce_required),
    token_auth_method: String(row.token_auth_method ?? "client_secret_post"),
    status: String(row.status) as OAuthProviderStatus,
    is_builtin: Boolean(row.is_builtin),
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function mapConnectionRow(row: Record<string, unknown>): OAuthConnectionRecord {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    provider_id: String(row.provider_id),
    provider_account_id: String(row.provider_account_id),
    display_name: String(row.display_name ?? ""),
    encrypted_access_token: Buffer.from(row.encrypted_access_token as Buffer),
    encrypted_refresh_token: row.encrypted_refresh_token
      ? Buffer.from(row.encrypted_refresh_token as Buffer)
      : null,
    token_alg: String(row.token_alg ?? "aes-256-gcm/master-key"),
    expires_at: row.expires_at ? asIso(row.expires_at) : null,
    scopes: asStringArray(row.scopes),
    token_type: String(row.token_type ?? "Bearer"),
    status: String(row.status) as OAuthConnectionStatus,
    last_used_at: row.last_used_at ? asIso(row.last_used_at) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

export function toProviderPublic(provider: OAuthProviderRecord): OAuthProviderPublic {
  const connectable =
    provider.status === "active" && Boolean(provider.client_id?.trim());
  return {
    id: provider.id,
    slug: provider.slug,
    display_name: provider.display_name,
    auth_type: provider.auth_type,
    default_scopes: provider.default_scopes,
    supported_scopes: provider.supported_scopes,
    status: provider.status,
    is_builtin: provider.is_builtin,
    connectable,
  };
}

export function getProviderClientSecret(provider: OAuthProviderRecord): string | null {
  if (!provider.encrypted_client_secret) {
    return null;
  }
  return unpackEncrypted(provider.encrypted_client_secret);
}

export async function findOAuthProviderById(id: string): Promise<OAuthProviderRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_oauth_providers WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? mapProviderRow(row) : null;
}

export async function findOAuthProviderBySlug(slug: string): Promise<OAuthProviderRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_oauth_providers WHERE slug = $1`, [slug]);
  const row = result.rows[0];
  return row ? mapProviderRow(row) : null;
}

export async function listOAuthProviders(): Promise<OAuthProviderRecord[]> {
  const result = await pool.query(`SELECT * FROM cap_oauth_providers ORDER BY display_name ASC`);
  return result.rows.map(mapProviderRow);
}

export async function createOAuthProvider(input: {
  slug: string;
  display_name: string;
  auth_type: OAuthAuthType;
  authorization_url?: string;
  token_url?: string;
  userinfo_url?: string;
  revoke_url?: string;
  jwks_url?: string;
  client_id?: string;
  client_secret?: string;
  default_scopes?: string[];
  supported_scopes?: string[];
  pkce_required?: boolean;
  token_auth_method?: string;
  metadata?: JsonObject;
}): Promise<OAuthProviderRecord> {
  const id = randomUUID();
  const encryptedSecret = input.client_secret ? packEncrypted(input.client_secret) : null;
  const status = input.client_id?.trim() ? "active" : "unconfigured";

  await pool.query(
    `
      INSERT INTO cap_oauth_providers (
        id, slug, display_name, auth_type,
        authorization_url, token_url, userinfo_url, revoke_url, jwks_url,
        client_id, encrypted_client_secret,
        default_scopes, supported_scopes, pkce_required, token_auth_method,
        status, is_builtin, metadata
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,FALSE,$17
      )
    `,
    [
      id,
      input.slug,
      input.display_name,
      input.auth_type,
      input.authorization_url ?? null,
      input.token_url ?? null,
      input.userinfo_url ?? null,
      input.revoke_url ?? null,
      input.jwks_url ?? null,
      input.client_id ?? null,
      encryptedSecret,
      JSON.stringify(input.default_scopes ?? []),
      JSON.stringify(input.supported_scopes ?? []),
      input.pkce_required ?? true,
      input.token_auth_method ?? "client_secret_post",
      status,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  return (await findOAuthProviderById(id))!;
}

export async function updateOAuthProviderCredentials(input: {
  id: string;
  client_id: string;
  client_secret?: string;
}): Promise<OAuthProviderRecord | null> {
  const encryptedSecret = input.client_secret ? packEncrypted(input.client_secret) : null;
  const result = await pool.query(
    `
      UPDATE cap_oauth_providers
      SET client_id = $2,
          encrypted_client_secret = COALESCE($3, encrypted_client_secret),
          status = CASE WHEN $2 IS NOT NULL AND $2 <> '' THEN 'active' ELSE status END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [input.id, input.client_id, encryptedSecret],
  );
  const row = result.rows[0];
  return row ? mapProviderRow(row) : null;
}

export async function createOAuthConnection(input: {
  user_id: string;
  provider_id: string;
  provider_account_id: string;
  display_name: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  scopes?: string[];
  token_type?: string;
  metadata?: JsonObject;
}): Promise<OAuthConnectionRecord> {
  const id = randomUUID();
  await pool.query(
    `
      INSERT INTO cap_oauth_connections (
        id, user_id, provider_id, provider_account_id, display_name,
        encrypted_access_token, encrypted_refresh_token,
        expires_at, scopes, token_type, status, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11)
    `,
    [
      id,
      input.user_id,
      input.provider_id,
      input.provider_account_id,
      input.display_name,
      packEncrypted(input.access_token),
      input.refresh_token ? packEncrypted(input.refresh_token) : null,
      input.expires_at ?? null,
      JSON.stringify(input.scopes ?? []),
      input.token_type ?? "Bearer",
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return (await findOAuthConnectionById(id))!;
}

export async function findOAuthConnectionById(id: string): Promise<OAuthConnectionRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_oauth_connections WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? mapConnectionRow(row) : null;
}

export async function listOAuthConnectionsForUser(userId: string): Promise<OAuthConnectionPublic[]> {
  const result = await pool.query(
    `
      SELECT c.*, p.slug AS provider_slug, p.display_name AS provider_display_name
      FROM cap_oauth_connections c
      JOIN cap_oauth_providers p ON p.id = c.provider_id
      WHERE c.user_id = $1 AND c.status <> 'revoked'
      ORDER BY c.created_at DESC
    `,
    [userId],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    user_id: String(row.user_id),
    provider_id: String(row.provider_id),
    provider_slug: String(row.provider_slug),
    provider_display_name: String(row.provider_display_name),
    provider_account_id: String(row.provider_account_id),
    display_name: String(row.display_name ?? ""),
    scopes: asStringArray(row.scopes),
    status: String(row.status) as OAuthConnectionStatus,
    expires_at: row.expires_at ? asIso(row.expires_at) : null,
    last_used_at: row.last_used_at ? asIso(row.last_used_at) : null,
    created_at: asIso(row.created_at),
  }));
}

export async function revokeOAuthConnection(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE cap_oauth_connections
      SET status = 'revoked', updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND status <> 'revoked'
      RETURNING id
    `,
    [id, userId],
  );
  return Boolean(result.rows[0]);
}

export async function updateOAuthConnectionTokens(input: {
  id: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: string | null;
  scopes?: string[];
  status?: OAuthConnectionStatus;
}): Promise<void> {
  await pool.query(
    `
      UPDATE cap_oauth_connections
      SET encrypted_access_token = $2,
          encrypted_refresh_token = COALESCE($3, encrypted_refresh_token),
          expires_at = $4,
          scopes = COALESCE($5, scopes),
          status = COALESCE($6, status),
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      input.id,
      packEncrypted(input.access_token),
      input.refresh_token ? packEncrypted(input.refresh_token) : null,
      input.expires_at ?? null,
      input.scopes ? JSON.stringify(input.scopes) : null,
      input.status ?? null,
    ],
  );
}

export async function markConnectionReconnectRequired(id: string): Promise<void> {
  await pool.query(
    `UPDATE cap_oauth_connections SET status = 'reconnect_required', updated_at = NOW() WHERE id = $1`,
    [id],
  );
}

export async function touchOAuthConnection(id: string): Promise<void> {
  await pool.query(
    `UPDATE cap_oauth_connections SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id],
  );
}

export function getConnectionAccessToken(connection: OAuthConnectionRecord): string {
  return unpackEncrypted(connection.encrypted_access_token);
}

export function getConnectionRefreshToken(connection: OAuthConnectionRecord): string | null {
  if (!connection.encrypted_refresh_token) {
    return null;
  }
  return unpackEncrypted(connection.encrypted_refresh_token);
}

export async function createOAuthConnectState(input: {
  provider_id: string;
  user_id?: string;
  redirect_after?: string;
  code_verifier?: string;
  purpose?: string;
  ttl_seconds?: number;
}): Promise<OAuthConnectStateRecord> {
  const id = randomUUID();
  const state = randomBytes(24).toString("base64url");
  const result = await pool.query(
    `
      INSERT INTO cap_oauth_connect_states (
        id, provider_id, user_id, state, code_verifier, redirect_after, purpose, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() + ($8 || ' seconds')::interval)
      RETURNING *
    `,
    [
      id,
      input.provider_id,
      input.user_id ?? null,
      state,
      input.code_verifier ?? null,
      input.redirect_after ?? null,
      input.purpose ?? "connection",
      String(input.ttl_seconds ?? 600),
    ],
  );
  const row = result.rows[0]!;
  return {
    id: String(row.id),
    provider_id: String(row.provider_id),
    user_id: row.user_id ? String(row.user_id) : null,
    state: String(row.state),
    code_verifier: row.code_verifier ? String(row.code_verifier) : null,
    redirect_after: row.redirect_after ? String(row.redirect_after) : null,
    purpose: String(row.purpose),
    expires_at: asIso(row.expires_at),
    consumed_at: null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
  };
}

export async function consumeOAuthConnectState(state: string): Promise<OAuthConnectStateRecord | null> {
  const result = await pool.query(
    `
      UPDATE cap_oauth_connect_states
      SET consumed_at = NOW()
      WHERE state = $1 AND consumed_at IS NULL AND expires_at > NOW()
      RETURNING *
    `,
    [state],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: String(row.id),
    provider_id: String(row.provider_id),
    user_id: row.user_id ? String(row.user_id) : null,
    state: String(row.state),
    code_verifier: row.code_verifier ? String(row.code_verifier) : null,
    redirect_after: row.redirect_after ? String(row.redirect_after) : null,
    purpose: String(row.purpose),
    expires_at: asIso(row.expires_at),
    consumed_at: row.consumed_at ? asIso(row.consumed_at) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
  };
}

export async function writeOAuthAudit(input: {
  user_id?: string;
  provider_id?: string;
  connection_id?: string;
  action: string;
  success?: boolean;
  error_code?: string;
  metadata?: JsonObject;
}): Promise<void> {
  await pool.query(
    `
      INSERT INTO cap_oauth_audit (id, user_id, provider_id, connection_id, action, success, error_code, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
    [
      randomUUID(),
      input.user_id ?? null,
      input.provider_id ?? null,
      input.connection_id ?? null,
      input.action,
      input.success ?? true,
      input.error_code ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
