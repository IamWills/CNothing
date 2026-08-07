import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db";
import config from "../config";
import { encryptWithAes256Gcm, decryptWithAes256Gcm } from "../crypto/master-key";
import type { JsonObject } from "./platform.entity";
import type {
  OAuthAuthType,
  OAuthConnectionPublic,
  OAuthConnectionRecord,
  OAuthConnectionStatus,
  OAuthConnectStateRecord,
  OAuthProviderPublic,
  OAuthProviderRecord,
  OAuthProviderStatus,
} from "./oauth.entity";
import {
  exchangeConnectionTokensInVault,
  readConnectionAccessToken,
  readConnectionRefreshToken,
  readProviderClientSecret,
  storeConnectionTokensInVault,
  storeProviderClientSecretInVault,
} from "./oauth-vault.service";

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
    issuer: row.issuer ? String(row.issuer) : null,
    discovery_url: row.discovery_url ? String(row.discovery_url) : null,
    authorization_url: row.authorization_url ? String(row.authorization_url) : null,
    token_url: row.token_url ? String(row.token_url) : null,
    userinfo_url: row.userinfo_url ? String(row.userinfo_url) : null,
    revoke_url: row.revoke_url ? String(row.revoke_url) : null,
    jwks_url: row.jwks_url ? String(row.jwks_url) : null,
    client_id: row.client_id ? String(row.client_id) : null,
    encrypted_client_secret: row.encrypted_client_secret
      ? Buffer.from(row.encrypted_client_secret as Buffer)
      : null,
    client_secret_vault_id: row.client_secret_vault_id ? String(row.client_secret_vault_id) : null,
    secret_alg: String(row.secret_alg ?? "aes-256-gcm/master-key"),
    default_scopes: asStringArray(row.default_scopes),
    supported_scopes: asStringArray(row.supported_scopes),
    pkce_required: Boolean(row.pkce_required),
    token_auth_method: String(row.token_auth_method ?? "client_secret_post") as OAuthProviderRecord["token_auth_method"],
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
    tenant_id: row.tenant_id ? String(row.tenant_id) : "default",
    provider_id: String(row.provider_id),
    provider_account_id: String(row.provider_account_id),
    display_name: String(row.display_name ?? ""),
    encrypted_access_token: row.encrypted_access_token
      ? Buffer.from(row.encrypted_access_token as Buffer)
      : null,
    encrypted_refresh_token: row.encrypted_refresh_token
      ? Buffer.from(row.encrypted_refresh_token as Buffer)
      : null,
    access_token_secret_id: row.access_token_secret_id ? String(row.access_token_secret_id) : null,
    refresh_token_secret_id: row.refresh_token_secret_id
      ? String(row.refresh_token_secret_id)
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

export type OAuthProviderAdminView = OAuthProviderPublic & {
  issuer: string | null;
  discovery_url: string | null;
  authorization_url: string | null;
  token_url: string | null;
  userinfo_url: string | null;
  revoke_url: string | null;
  jwks_url: string | null;
  client_id: string | null;
  has_client_secret: boolean;
  pkce_required: boolean;
  token_auth_method: OAuthProviderRecord["token_auth_method"];
};

export function toProviderAdmin(provider: OAuthProviderRecord): OAuthProviderAdminView {
  return {
    ...toProviderPublic(provider),
    issuer: provider.issuer,
    discovery_url: provider.discovery_url,
    authorization_url: provider.authorization_url,
    token_url: provider.token_url,
    userinfo_url: provider.userinfo_url,
    revoke_url: provider.revoke_url,
    jwks_url: provider.jwks_url,
    client_id: provider.client_id,
    has_client_secret: Boolean(
      provider.encrypted_client_secret || provider.client_secret_vault_id,
    ),
    pkce_required: provider.pkce_required,
    token_auth_method: provider.token_auth_method,
  };
}

export async function getProviderClientSecret(provider: OAuthProviderRecord): Promise<string | null> {
  return readProviderClientSecret(provider);
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
  issuer?: string | null;
  discovery_url?: string | null;
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
  token_auth_method?: OAuthProviderRecord["token_auth_method"];
  metadata?: JsonObject;
}): Promise<OAuthProviderRecord> {
  const id = randomUUID();
  const tokenAuthMethod = input.token_auth_method ?? "client_secret_post";
  const hasSecretOrPublic =
    tokenAuthMethod === "none" || Boolean(input.client_secret?.trim());
  const status =
    input.client_id?.trim() && (tokenAuthMethod === "none" || hasSecretOrPublic)
      ? "active"
      : "unconfigured";

  let clientSecretVaultId: string | null = null;
  if (input.client_secret?.trim()) {
    clientSecretVaultId = await storeProviderClientSecretInVault({
      providerId: id,
      clientSecret: input.client_secret.trim(),
    });
  }

  await pool.query(
    `
      INSERT INTO cap_oauth_providers (
        id, slug, display_name, auth_type, issuer, discovery_url,
        authorization_url, token_url, userinfo_url, revoke_url, jwks_url,
        client_id, encrypted_client_secret, client_secret_vault_id,
        default_scopes, supported_scopes, pkce_required, token_auth_method,
        status, is_builtin, metadata
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,FALSE,$20
      )
    `,
    [
      id,
      input.slug,
      input.display_name,
      input.auth_type,
      input.issuer ?? null,
      input.discovery_url ?? null,
      input.authorization_url ?? null,
      input.token_url ?? null,
      input.userinfo_url ?? null,
      input.revoke_url ?? null,
      input.jwks_url ?? null,
      input.client_id ?? null,
      null,
      clientSecretVaultId,
      JSON.stringify(input.default_scopes ?? []),
      JSON.stringify(input.supported_scopes ?? []),
      input.pkce_required ?? true,
      tokenAuthMethod,
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
  let clientSecretVaultId: string | null = null;
  if (input.client_secret?.trim()) {
    const existing = await findOAuthProviderById(input.id);
    const currentSecret = existing ? await readProviderClientSecret(existing) : null;
    if (currentSecret !== input.client_secret.trim()) {
      clientSecretVaultId = await storeProviderClientSecretInVault({
        providerId: input.id,
        clientSecret: input.client_secret.trim(),
      });
    }
  }

  const result = await pool.query(
    `
      UPDATE cap_oauth_providers
      SET client_id = $2::text,
          encrypted_client_secret = NULL,
          client_secret_vault_id = COALESCE($3, client_secret_vault_id),
          status = CASE WHEN $2::text IS NOT NULL AND $2::text <> '' THEN 'active' ELSE status END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [input.id, input.client_id, clientSecretVaultId],
  );
  const row = result.rows[0];
  return row ? mapProviderRow(row) : null;
}

/** True when users/agents can connect and request_access against this provider. */
export function isOAuthProviderAvailable(provider: OAuthProviderRecord): boolean {
  return toProviderPublic(provider).connectable;
}

export async function createOAuthConnection(input: {
  user_id: string;
  tenant_id?: string;
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
  const tenantId = input.tenant_id ?? "default";
  const secretIds = await storeConnectionTokensInVault({
    connectionId: id,
    tenantId,
    accessToken: input.access_token,
    refreshToken: input.refresh_token,
    expiresAt: input.expires_at ?? null,
  });

  await pool.query(
    `
      INSERT INTO cap_oauth_connections (
        id, user_id, tenant_id, provider_id, provider_account_id, display_name,
        encrypted_access_token, encrypted_refresh_token,
        access_token_secret_id, refresh_token_secret_id,
        expires_at, scopes, token_type, status, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,$7,$8,$9,$10,$11,'active',$12)
    `,
    [
      id,
      input.user_id,
      tenantId,
      input.provider_id,
      input.provider_account_id,
      input.display_name,
      secretIds.access_token_secret_id,
      secretIds.refresh_token_secret_id,
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

export async function listOAuthConnectionsForUser(
  userId: string,
  tenantId?: string,
): Promise<OAuthConnectionPublic[]> {
  const result = await pool.query(
    `
      SELECT c.*, p.slug AS provider_slug, p.display_name AS provider_display_name
      FROM cap_oauth_connections c
      JOIN cap_oauth_providers p ON p.id = c.provider_id
      WHERE c.user_id = $1
        AND c.status <> 'revoked'
        AND ($2::text IS NULL OR c.tenant_id = $2)
      ORDER BY c.created_at DESC
    `,
    [userId, tenantId ?? null],
  );
  return result.rows.map((row) => ({
    id: String(row.id),
    user_id: String(row.user_id),
    tenant_id: String(row.tenant_id ?? "default"),
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
  const connection = await findOAuthConnectionById(input.id);
  if (!connection) {
    throw new Error("OAuth connection not found");
  }

  const secretIds = await exchangeConnectionTokensInVault({
    connection,
    accessToken: input.access_token,
    refreshToken: input.refresh_token,
    expiresAt: input.expires_at,
  });

  await pool.query(
    `
      UPDATE cap_oauth_connections
      SET encrypted_access_token = NULL,
          encrypted_refresh_token = NULL,
          access_token_secret_id = $2,
          refresh_token_secret_id = $3,
          expires_at = $4,
          scopes = COALESCE($5, scopes),
          status = COALESCE($6, status),
          updated_at = NOW()
      WHERE id = $1
    `,
    [
      input.id,
      secretIds.access_token_secret_id,
      secretIds.refresh_token_secret_id,
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

export async function markConnectionExpired(id: string): Promise<void> {
  await pool.query(
    `UPDATE cap_oauth_connections SET status = 'expired', updated_at = NOW() WHERE id = $1`,
    [id],
  );
}

export async function touchOAuthConnection(id: string): Promise<void> {
  await pool.query(
    `UPDATE cap_oauth_connections SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id],
  );
}

export async function getConnectionAccessToken(connection: OAuthConnectionRecord): Promise<string> {
  return readConnectionAccessToken(connection);
}

export async function getConnectionRefreshToken(
  connection: OAuthConnectionRecord,
): Promise<string | null> {
  return readConnectionRefreshToken(connection);
}

export async function createOAuthConnectState(input: {
  provider_id: string;
  user_id?: string;
  redirect_after?: string;
  code_verifier?: string;
  purpose?: string;
  ttl_seconds?: number;
  metadata?: JsonObject;
}): Promise<OAuthConnectStateRecord> {
  const id = randomUUID();
  const state = randomBytes(24).toString("base64url");
  const result = await pool.query(
    `
      INSERT INTO cap_oauth_connect_states (
        id, provider_id, user_id, state, code_verifier, redirect_after, purpose, expires_at, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW() + ($8 || ' seconds')::interval, $9)
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
      JSON.stringify(input.metadata ?? {}),
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
