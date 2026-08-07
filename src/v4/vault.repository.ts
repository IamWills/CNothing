import { randomUUID } from "node:crypto";
import config from "../config";
import { pool } from "../db";
import {
  createSha256Fingerprint,
  decryptWithAes256Gcm,
  encryptWithAes256Gcm,
} from "../crypto/master-key";
import type { JsonObject } from "./platform.entity";
import type {
  SecretOwnerType,
  SecretStatus,
  SecretType,
  SecretVaultRecord,
  VaultAuditEvent,
} from "./vault.entity";

function normalizeMetadata(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function packEncrypted(plaintext: string): Buffer {
  const wrapped = encryptWithAes256Gcm({ plaintext: Buffer.from(plaintext, "utf8"), key: config.masterKey });
  return Buffer.concat([wrapped.iv, wrapped.tag, wrapped.ciphertext]);
}

export function unpackVaultSecret(packed: Buffer): string {
  return decryptWithAes256Gcm({
    iv: packed.subarray(0, 12),
    tag: packed.subarray(12, 28),
    ciphertext: packed.subarray(28),
    key: config.masterKey,
  }).toString("utf8");
}

function mapVaultRow(row: Record<string, unknown>): SecretVaultRecord {
  return {
    id: String(row.id), secret_type: String(row.secret_type) as SecretType,
    owner_type: String(row.owner_type) as SecretOwnerType, owner_id: String(row.owner_id),
    secret_alg: String(row.secret_alg ?? "aes-256-gcm/master-key"), key_version: Number(row.key_version ?? 1),
    status: String(row.status) as SecretStatus, fingerprint: String(row.fingerprint),
    secret_ref: String(row.secret_ref ?? row.id), provider_id: row.provider_id ? String(row.provider_id) : null,
    user_id: row.user_id ? String(row.user_id) : null, metadata: normalizeMetadata(row.metadata),
    expires_at: row.expires_at ? asIso(row.expires_at) : null,
    rotated_from_id: row.rotated_from_id ? String(row.rotated_from_id) : null,
    rotated_at: row.rotated_at ? asIso(row.rotated_at) : null,
    created_at: asIso(row.created_at), updated_at: asIso(row.updated_at),
    revoked_at: row.revoked_at ? asIso(row.revoked_at) : null,
  };
}

export async function insertVaultSecret(input: {
  secret_type: SecretType; owner_type: SecretOwnerType; owner_id: string; plaintext: string;
  metadata?: JsonObject; expires_at?: string | null; tenant_id?: string;
  provider_id?: string | null; user_id?: string | null;
}): Promise<SecretVaultRecord> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO cap_secret_vault
       (id, secret_type, owner_type, owner_id, encrypted_payload, fingerprint, metadata,
        expires_at, tenant_id, secret_ref, provider_id, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, input.secret_type, input.owner_type, input.owner_id, packEncrypted(input.plaintext),
      createSha256Fingerprint(input.plaintext), JSON.stringify(input.metadata ?? {}), input.expires_at ?? null,
      input.tenant_id ?? String(input.metadata?.tenant_id ?? "default"), id, input.provider_id ?? null, input.user_id ?? null],
  );
  const result = await pool.query(`SELECT * FROM cap_secret_vault WHERE id = $1`, [id]);
  return mapVaultRow(result.rows[0]);
}

export async function findActiveVaultSecret(input: {
  owner_type: SecretOwnerType; owner_id: string; secret_type: SecretType;
}): Promise<(SecretVaultRecord & { encrypted_payload: Buffer }) | null> {
  const result = await pool.query(
    `SELECT * FROM cap_secret_vault
     WHERE owner_type = $1 AND owner_id = $2 AND secret_type = $3 AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [input.owner_type, input.owner_id, input.secret_type],
  );
  const row = result.rows[0];
  return row ? { ...mapVaultRow(row), encrypted_payload: Buffer.from(row.encrypted_payload as Buffer) } : null;
}

export async function retrieveVaultSecretPlaintext(id: string): Promise<string | null> {
  const result = await pool.query(`SELECT encrypted_payload, status FROM cap_secret_vault WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row && String(row.status) === "active" ? unpackVaultSecret(Buffer.from(row.encrypted_payload as Buffer)) : null;
}

export async function revokeVaultSecret(id: string): Promise<void> {
  await pool.query(`UPDATE cap_secret_vault SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
                    WHERE id = $1 AND status = 'active'`, [id]);
}

export async function expireVaultSecret(id: string): Promise<void> {
  await pool.query(`UPDATE cap_secret_vault SET status = 'expired', updated_at = NOW()
                    WHERE id = $1 AND status = 'active'`, [id]);
}

export async function rotateVaultSecret(input: { secretId: string; newPlaintext: string }): Promise<SecretVaultRecord> {
  const existing = await pool.query(`SELECT * FROM cap_secret_vault WHERE id = $1`, [input.secretId]);
  const row = existing.rows[0];
  if (!row) throw new Error("Secret not found");
  await pool.query(`UPDATE cap_secret_vault SET status = 'rotated', rotated_at = NOW(), updated_at = NOW() WHERE id = $1`, [input.secretId]);
  return insertVaultSecret({
    secret_type: String(row.secret_type) as SecretType, owner_type: String(row.owner_type) as SecretOwnerType,
    owner_id: String(row.owner_id), plaintext: input.newPlaintext,
    metadata: { ...normalizeMetadata(row.metadata), rotated_from_id: input.secretId },
    provider_id: row.provider_id ? String(row.provider_id) : null,
    user_id: row.user_id ? String(row.user_id) : null,
  });
}

export async function listVaultSecretsByOwner(input: { owner_type: SecretOwnerType; owner_id: string }): Promise<SecretVaultRecord[]> {
  const result = await pool.query(
    `SELECT * FROM cap_secret_vault WHERE owner_type = $1 AND owner_id = $2 ORDER BY created_at DESC`,
    [input.owner_type, input.owner_id],
  );
  return result.rows.map(mapVaultRow);
}

export async function findVaultSecretByRef(ref: string): Promise<SecretVaultRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_secret_vault WHERE secret_ref = $1 OR id = $1 LIMIT 1`, [ref]);
  return result.rows[0] ? mapVaultRow(result.rows[0]) : null;
}

export async function writeVaultAudit(input: {
  event_type: VaultAuditEvent; agent_id?: string | null; user_id?: string | null;
  provider_id?: string | null; metadata?: JsonObject;
}): Promise<void> {
  await pool.query(
    `INSERT INTO vault_audit (id, event_type, agent_id, user_id, provider_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [randomUUID(), input.event_type, input.agent_id ?? null, input.user_id ?? null,
      input.provider_id ?? null, JSON.stringify(input.metadata ?? {})],
  );
}
