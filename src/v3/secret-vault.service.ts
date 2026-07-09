import { createHash } from "node:crypto";
import type { JsonObject } from "../v2/v2.entity";
import type { SecretOwnerType, SecretType, SecretVaultRecord } from "./v3.entity";
import { normalizeSecretType, secretTypeLookupVariants } from "./secret-types";
import {
  expireVaultSecret,
  findActiveVaultSecret,
  findVaultSecretByRef,
  insertVaultSecret,
  listVaultSecretsByOwner,
  retrieveVaultSecretPlaintext,
  revokeVaultSecret,
  rotateVaultSecret,
  unpackVaultSecret,
  writeTrustAudit,
} from "./v3.repository";

export { normalizeSecretType, secretTypeLookupVariants } from "./secret-types";

export type StoreSecretInput = {
  secret_type: SecretType;
  owner_type: SecretOwnerType;
  owner_id: string;
  plaintext: string;
  metadata?: JsonObject;
  expires_at?: string | null;
  tenant_id?: string;
  agent_id?: string | null;
  provider_id?: string | null;
  user_id?: string | null;
};

export type SecretMetadataView = {
  id: string;
  secret_ref: string;
  secret_type: SecretType;
  owner_type: SecretOwnerType;
  owner_id: string;
  status: string;
  fingerprint: string;
  key_version: number;
  provider_id: string | null;
  user_id: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

function toMetadataView(record: SecretVaultRecord): SecretMetadataView {
  return {
    id: record.id,
    secret_ref: record.secret_ref || record.id,
    secret_type: record.secret_type,
    owner_type: record.owner_type,
    owner_id: record.owner_id,
    status: record.status,
    fingerprint: record.fingerprint,
    key_version: record.key_version,
    provider_id: record.provider_id,
    user_id: record.user_id,
    expires_at: record.expires_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export class SecretVaultService {
  /** Internal only — never exposed to agents. */
  async storeSecret(input: StoreSecretInput): Promise<SecretMetadataView> {
    const record = await insertVaultSecret({
      secret_type: normalizeSecretType(input.secret_type),
      owner_type: input.owner_type,
      owner_id: input.owner_id,
      plaintext: input.plaintext,
      metadata: input.metadata,
      expires_at: input.expires_at,
      tenant_id: input.tenant_id,
      provider_id: input.provider_id,
      user_id: input.user_id,
    });

    await writeTrustAudit({
      event_type: "secret_stored",
      agent_id: input.agent_id ?? null,
      user_id: input.user_id ?? null,
      provider_id: input.provider_id ?? null,
      metadata: {
        secret_id: record.id,
        secret_ref: record.secret_ref,
        secret_type: record.secret_type,
        owner_type: record.owner_type,
        owner_id: record.owner_id,
        fingerprint: record.fingerprint,
      },
    });

    return toMetadataView(record);
  }

  /**
   * Internal only — plaintext never leaves the vault boundary.
   * Every successful decrypt writes a secret_decrypted audit event.
   */
  async retrieveSecret(input: {
    owner_type: SecretOwnerType;
    owner_id: string;
    secret_type: SecretType;
    agent_id?: string | null;
    reason?: string;
  }): Promise<string | null> {
    for (const type of secretTypeLookupVariants(input.secret_type)) {
      const record = await findActiveVaultSecret({
        owner_type: input.owner_type,
        owner_id: input.owner_id,
        secret_type: type,
      });
      if (!record) continue;

      if (record.expires_at && new Date(record.expires_at).getTime() < Date.now()) {
        await expireVaultSecret(record.id);
        continue;
      }

      const plaintext = unpackVaultSecret(record.encrypted_payload);
      await writeTrustAudit({
        event_type: "secret_decrypted",
        agent_id: input.agent_id ?? null,
        metadata: {
          secret_id: record.id,
          secret_ref: record.secret_ref,
          secret_type: record.secret_type,
          owner_type: record.owner_type,
          owner_id: record.owner_id,
          reason: input.reason ?? "worker_execution",
        },
      });
      return plaintext;
    }
    return null;
  }

  async retrieveSecretById(
    secretId: string,
    opts?: { agent_id?: string | null; reason?: string },
  ): Promise<string | null> {
    const plaintext = await retrieveVaultSecretPlaintext(secretId);
    if (plaintext) {
      await writeTrustAudit({
        event_type: "secret_decrypted",
        agent_id: opts?.agent_id ?? null,
        metadata: {
          secret_id: secretId,
          reason: opts?.reason ?? "worker_execution",
        },
      });
    }
    return plaintext;
  }

  /** Public metadata only — never returns plaintext. */
  async getSecretMetadataByRef(secretRef: string): Promise<SecretMetadataView | null> {
    const record = await findVaultSecretByRef(secretRef);
    if (!record) return null;
    return toMetadataView(record);
  }

  async exchangeSecret(input: {
    owner_type: SecretOwnerType;
    owner_id: string;
    secret_type: SecretType;
    new_plaintext: string;
    metadata?: JsonObject;
    provider_id?: string | null;
    user_id?: string | null;
  }): Promise<SecretMetadataView> {
    for (const type of secretTypeLookupVariants(input.secret_type)) {
      const existing = await findActiveVaultSecret({
        owner_type: input.owner_type,
        owner_id: input.owner_id,
        secret_type: type,
      });
      if (existing) {
        await revokeVaultSecret(existing.id);
      }
    }

    return this.storeSecret({
      secret_type: input.secret_type,
      owner_type: input.owner_type,
      owner_id: input.owner_id,
      plaintext: input.new_plaintext,
      metadata: input.metadata,
      provider_id: input.provider_id,
      user_id: input.user_id,
    });
  }

  async rotateSecret(input: {
    secret_id: string;
    new_plaintext: string;
  }): Promise<SecretMetadataView> {
    const record = await rotateVaultSecret({
      secretId: input.secret_id,
      newPlaintext: input.new_plaintext,
    });

    await writeTrustAudit({
      event_type: "secret_rotated",
      metadata: {
        secret_id: record.id,
        secret_ref: record.secret_ref,
        rotated_from_id: input.secret_id,
        fingerprint: record.fingerprint,
      },
    });

    return toMetadataView(record);
  }

  async revokeSecret(secretId: string): Promise<void> {
    await revokeVaultSecret(secretId);
    await writeTrustAudit({
      event_type: "secret_revoked",
      metadata: { secret_id: secretId },
    });
  }

  async expireSecret(secretId: string): Promise<void> {
    await expireVaultSecret(secretId);
    await writeTrustAudit({
      event_type: "secret_revoked",
      metadata: { secret_id: secretId, reason: "expired" },
    });
  }

  async listSecretMetadata(input: {
    owner_type: SecretOwnerType;
    owner_id: string;
  }): Promise<SecretMetadataView[]> {
    const records = await listVaultSecretsByOwner(input);
    return records.map(toMetadataView);
  }

  hashResult(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
}

export const secretVaultService = new SecretVaultService();
