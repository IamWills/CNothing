import { createHash } from "node:crypto";
import type { JsonObject } from "../v2/v2.entity";
import type { SecretOwnerType, SecretType, SecretVaultRecord } from "./v3.entity";
import {
  findActiveVaultSecret,
  insertVaultSecret,
  listVaultSecretsByOwner,
  retrieveVaultSecretPlaintext,
  revokeVaultSecret,
  rotateVaultSecret,
  unpackVaultSecret,
  writeTrustAudit,
} from "./v3.repository";

export type StoreSecretInput = {
  secret_type: SecretType;
  owner_type: SecretOwnerType;
  owner_id: string;
  plaintext: string;
  metadata?: JsonObject;
  expires_at?: string | null;
  tenant_id?: string;
  agent_id?: string | null;
};

export type SecretMetadataView = {
  id: string;
  secret_type: SecretType;
  owner_type: SecretOwnerType;
  owner_id: string;
  status: string;
  fingerprint: string;
  key_version: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

function toMetadataView(record: SecretVaultRecord): SecretMetadataView {
  return {
    id: record.id,
    secret_type: record.secret_type,
    owner_type: record.owner_type,
    owner_id: record.owner_id,
    status: record.status,
    fingerprint: record.fingerprint,
    key_version: record.key_version,
    expires_at: record.expires_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export class SecretVaultService {
  /** Internal only — never exposed to agents. */
  async storeSecret(input: StoreSecretInput): Promise<SecretMetadataView> {
    const record = await insertVaultSecret({
      secret_type: input.secret_type,
      owner_type: input.owner_type,
      owner_id: input.owner_id,
      plaintext: input.plaintext,
      metadata: input.metadata,
      expires_at: input.expires_at,
      tenant_id: input.tenant_id,
    });

    await writeTrustAudit({
      event_type: "secret_stored",
      agent_id: input.agent_id ?? null,
      metadata: {
        secret_id: record.id,
        secret_type: record.secret_type,
        owner_type: record.owner_type,
        owner_id: record.owner_id,
        fingerprint: record.fingerprint,
      },
    });

    return toMetadataView(record);
  }

  /** Internal only — plaintext never leaves the vault boundary. */
  async retrieveSecret(input: {
    owner_type: SecretOwnerType;
    owner_id: string;
    secret_type: SecretType;
  }): Promise<string | null> {
    const record = await findActiveVaultSecret(input);
    if (!record) {
      return null;
    }
    return unpackVaultSecret(record.encrypted_payload);
  }

  async retrieveSecretById(secretId: string): Promise<string | null> {
    return retrieveVaultSecretPlaintext(secretId);
  }

  async exchangeSecret(input: {
    owner_type: SecretOwnerType;
    owner_id: string;
    secret_type: SecretType;
    new_plaintext: string;
    metadata?: JsonObject;
  }): Promise<SecretMetadataView> {
    const existing = await findActiveVaultSecret({
      owner_type: input.owner_type,
      owner_id: input.owner_id,
      secret_type: input.secret_type,
    });

    if (existing) {
      await revokeVaultSecret(existing.id);
    }

    return this.storeSecret({
      secret_type: input.secret_type,
      owner_type: input.owner_type,
      owner_id: input.owner_id,
      plaintext: input.new_plaintext,
      metadata: input.metadata,
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
