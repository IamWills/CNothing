import { pool } from "../db";
import { unpackEncrypted } from "./oauth.repository";
import type { OAuthConnectionRecord } from "./oauth.entity";
import {
  exchangeConnectionTokensInVault,
  storeProviderClientSecretInVault,
} from "./oauth-vault.service";

const MIGRATION_KEY = "oauth_tokens_to_vault_v1";

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
    expires_at: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    token_type: String(row.token_type ?? "Bearer"),
    status: String(row.status) as OAuthConnectionRecord["status"],
    last_used_at: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  };
}

async function isMigrationComplete(): Promise<boolean> {
  const result = await pool.query(
    `SELECT value FROM cap_system_state WHERE key = $1`,
    [MIGRATION_KEY],
  );
  return result.rows[0]?.value === "completed";
}

async function markMigrationComplete(): Promise<void> {
  await pool.query(
    `
      INSERT INTO cap_system_state (key, value, updated_at)
      VALUES ($1, 'completed', NOW())
      ON CONFLICT (key) DO UPDATE SET value = 'completed', updated_at = NOW()
    `,
    [MIGRATION_KEY],
  );
}

export async function migrateOAuthTokensToVault(): Promise<void> {
  if (await isMigrationComplete()) {
    return;
  }

  const connections = await pool.query(
    `
      SELECT *
      FROM cap_oauth_connections
      WHERE status <> 'revoked'
        AND access_token_secret_id IS NULL
        AND encrypted_access_token IS NOT NULL
    `,
  );

  for (const row of connections.rows) {
    const connection = mapConnectionRow(row);
    const accessToken = unpackEncrypted(connection.encrypted_access_token!);
    const refreshToken = connection.encrypted_refresh_token
      ? unpackEncrypted(connection.encrypted_refresh_token)
      : undefined;

    const secretIds = await exchangeConnectionTokensInVault({
      connection,
      accessToken,
      refreshToken,
      expiresAt: connection.expires_at,
    });

    await pool.query(
      `
        UPDATE cap_oauth_connections
        SET access_token_secret_id = $2,
            refresh_token_secret_id = $3,
            encrypted_access_token = NULL,
            encrypted_refresh_token = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [connection.id, secretIds.access_token_secret_id, secretIds.refresh_token_secret_id],
    );
  }

  const providers = await pool.query(
    `
      SELECT id, tenant_id, encrypted_client_secret, client_secret_vault_id
      FROM cap_oauth_providers
      WHERE encrypted_client_secret IS NOT NULL
        AND client_secret_vault_id IS NULL
    `,
  );

  for (const row of providers.rows) {
    const providerId = String(row.id);
    const secret = unpackEncrypted(Buffer.from(row.encrypted_client_secret as Buffer));
    const vaultId = await storeProviderClientSecretInVault({
      providerId,
      tenantId: row.tenant_id ? String(row.tenant_id) : "default",
      clientSecret: secret,
    });
    await pool.query(
      `
        UPDATE cap_oauth_providers
        SET client_secret_vault_id = $2,
            encrypted_client_secret = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [providerId, vaultId],
    );
  }

  await markMigrationComplete();
}
