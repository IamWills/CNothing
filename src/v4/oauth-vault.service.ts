import type { OAuthConnectionRecord, OAuthProviderRecord } from "./oauth.entity";
import config from "../config";
import { decryptWithAes256Gcm } from "../crypto/master-key";
import { secretVaultService } from "./secret-vault.service";

const DEFAULT_TENANT = "default";

function unpackLegacyEncrypted(packed: Buffer): string {
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

export async function storeConnectionTokensInVault(input: {
  connectionId: string;
  tenantId?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string | null;
}): Promise<{ access_token_secret_id: string; refresh_token_secret_id: string | null }> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT;
  const access = await secretVaultService.storeSecret({
    secret_type: "access_token",
    owner_type: "connection",
    owner_id: input.connectionId,
    plaintext: input.accessToken,
    metadata: { tenant_id: tenantId },
    expires_at: input.expiresAt ?? null,
    tenant_id: tenantId,
  });

  let refreshSecretId: string | null = null;
  if (input.refreshToken) {
    const refresh = await secretVaultService.storeSecret({
      secret_type: "refresh_token",
      owner_type: "connection",
      owner_id: input.connectionId,
      plaintext: input.refreshToken,
      metadata: { tenant_id: tenantId },
      tenant_id: tenantId,
    });
    refreshSecretId = refresh.id;
  }

  return {
    access_token_secret_id: access.id,
    refresh_token_secret_id: refreshSecretId,
  };
}

export async function exchangeConnectionTokensInVault(input: {
  connection: OAuthConnectionRecord;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string | null;
}): Promise<{ access_token_secret_id: string; refresh_token_secret_id: string | null }> {
  const tenantId = input.connection.tenant_id ?? DEFAULT_TENANT;
  if (input.connection.access_token_secret_id) {
    await secretVaultService.revokeSecret(input.connection.access_token_secret_id);
  }
  if (input.connection.refresh_token_secret_id) {
    await secretVaultService.revokeSecret(input.connection.refresh_token_secret_id);
  }
  return storeConnectionTokensInVault({
    connectionId: input.connection.id,
    tenantId,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    expiresAt: input.expiresAt,
  });
}

export async function readConnectionAccessToken(connection: OAuthConnectionRecord): Promise<string> {
  if (connection.access_token_secret_id) {
    const token = await secretVaultService.retrieveSecretById(connection.access_token_secret_id);
    if (token) {
      return token;
    }
  }
  if (connection.encrypted_access_token) {
    return unpackLegacyEncrypted(connection.encrypted_access_token);
  }
  throw new Error("Connection access token unavailable");
}

export async function readConnectionRefreshToken(
  connection: OAuthConnectionRecord,
): Promise<string | null> {
  if (connection.refresh_token_secret_id) {
    const token = await secretVaultService.retrieveSecretById(connection.refresh_token_secret_id);
    if (token) {
      return token;
    }
  }
  if (connection.encrypted_refresh_token) {
    return unpackLegacyEncrypted(connection.encrypted_refresh_token);
  }
  return null;
}

export async function storeProviderClientSecretInVault(input: {
  providerId: string;
  tenantId?: string;
  clientSecret: string;
}): Promise<string> {
  const record = await secretVaultService.exchangeSecret({
    secret_type: "client_secret",
    owner_type: "provider",
    owner_id: input.providerId,
    new_plaintext: input.clientSecret,
    metadata: { tenant_id: input.tenantId ?? DEFAULT_TENANT },
    provider_id: input.providerId,
  });
  return record.id;
}

export async function readProviderClientSecret(provider: OAuthProviderRecord): Promise<string | null> {
  if (provider.client_secret_vault_id) {
    const secret = await secretVaultService.retrieveSecretById(provider.client_secret_vault_id);
    if (secret) {
      return secret;
    }
  }
  if (provider.encrypted_client_secret) {
    return unpackLegacyEncrypted(provider.encrypted_client_secret);
  }
  return null;
}
