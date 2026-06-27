import { createHash } from "node:crypto";
import { decryptWithAes256Gcm } from "../crypto/master-key";
import config from "../config";
import { pool } from "../db";
import { createOAuthConnection, findOAuthProviderBySlug } from "./oauth.repository";
import { findConnectorByProvider } from "./v2.repository";
import { PLATFORM_CONNECTOR_PROVIDER } from "./platform-connector.executor";

const MIGRATION_KEY = "credential_to_oauth_v1";

async function getMigrationState(): Promise<string | null> {
  const result = await pool.query(`SELECT value FROM cap_system_state WHERE key = $1`, [MIGRATION_KEY]);
  return result.rows[0] ? String(result.rows[0].value) : null;
}

async function setMigrationState(value: string): Promise<void> {
  await pool.query(
    `
      INSERT INTO cap_system_state (key, value)
      VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [MIGRATION_KEY, value],
  );
}

type GitHubCredentialPayload = {
  type?: string;
  access_token?: string;
  scope?: string | null;
};

function decryptCredentialSecret(encrypted: Buffer): GitHubCredentialPayload | null {
  try {
    const iv = encrypted.subarray(0, 12);
    const tag = encrypted.subarray(12, 28);
    const ciphertext = encrypted.subarray(28);
    const plaintext = decryptWithAes256Gcm({
      ciphertext,
      iv,
      tag,
      key: config.masterKey,
    });
    const parsed = JSON.parse(plaintext.toString("utf8")) as GitHubCredentialPayload;
    if (parsed?.type !== "github_oauth" || !parsed.access_token?.trim()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function migrateCredentialsToOAuthConnections(): Promise<{ migrated: number }> {
  const state = await getMigrationState();
  if (state === "completed") {
    return { migrated: 0 };
  }

  const provider = await findOAuthProviderBySlug("github");
  const connector = await findConnectorByProvider(PLATFORM_CONNECTOR_PROVIDER);
  if (!provider || !connector) {
    await setMigrationState("skipped");
    return { migrated: 0 };
  }

  const credentials = await pool.query(
    `
      SELECT id, owner_user_id, encrypted_secret, metadata
      FROM cap_credentials
      WHERE connector_id = $1
    `,
    [connector.id],
  );

  let migrated = 0;
  for (const row of credentials.rows) {
    const userId = String(row.owner_user_id);
    const payload = decryptCredentialSecret(row.encrypted_secret as Buffer);
    if (!payload?.access_token) {
      continue;
    }

    const existing = await pool.query(
      `
        SELECT id FROM cap_oauth_connections
        WHERE user_id = $1 AND provider_id = $2 AND status = 'active'
        LIMIT 1
      `,
      [userId, provider.id],
    );
    if (existing.rows[0]) {
      continue;
    }

    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const meta = metadata as { login?: string };
    const login = typeof meta.login === "string" ? meta.login : userId;
    const accountId = createHash("sha256").update(`${userId}:${payload.access_token}`).digest("hex").slice(0, 16);

    const connection = await createOAuthConnection({
      user_id: userId,
      provider_id: provider.id,
      provider_account_id: accountId,
      display_name: login,
      access_token: payload.access_token,
      scopes: payload.scope ? payload.scope.split(/[\s,]+/).filter(Boolean) : provider.default_scopes,
      token_type: "Bearer",
      metadata: {
        migrated_from: "cap_credentials",
        credential_id: String(row.id),
        provider: "github",
      },
    });

    await pool.query(
      `
        UPDATE cap_grants g
        SET connection_id = $1,
            provider_id = $2,
            updated_at = NOW()
        FROM cap_capabilities c
        WHERE g.user_id = $3
          AND g.capability_id = c.id
          AND c.name LIKE 'github.%'
          AND g.revoked = FALSE
          AND g.connection_id IS NULL
      `,
      [connection.id, provider.id, userId],
    );

    migrated += 1;
  }

  await setMigrationState("completed");
  return { migrated };
}
