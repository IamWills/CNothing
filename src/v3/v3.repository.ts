import { randomUUID } from "node:crypto";
import { pool } from "../db";
import config from "../config";
import {
  encryptWithAes256Gcm,
  decryptWithAes256Gcm,
  createSha256Fingerprint,
} from "../crypto/master-key";
import type { JsonObject } from "../v2/v2.entity";
import type {
  ProviderProposalRecord,
  ProviderProposalStatus,
  SecretOwnerType,
  SecretStatus,
  SecretType,
  SecretVaultRecord,
  TrustAuditEventType,
} from "./v3.entity";

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

export function unpackVaultSecret(packed: Buffer): string {
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

function mapVaultRow(row: Record<string, unknown>): SecretVaultRecord {
  return {
    id: String(row.id),
    secret_type: String(row.secret_type) as SecretVaultRecord["secret_type"],
    owner_type: String(row.owner_type) as SecretVaultRecord["owner_type"],
    owner_id: String(row.owner_id),
    secret_alg: String(row.secret_alg ?? "aes-256-gcm/master-key"),
    key_version: Number(row.key_version ?? 1),
    status: String(row.status) as SecretStatus,
    fingerprint: String(row.fingerprint),
    metadata: normalizeMetadata(row.metadata),
    expires_at: row.expires_at ? asIso(row.expires_at) : null,
    rotated_from_id: row.rotated_from_id ? String(row.rotated_from_id) : null,
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    revoked_at: row.revoked_at ? asIso(row.revoked_at) : null,
  };
}

function mapProposalRow(row: Record<string, unknown>): ProviderProposalRecord {
  return {
    id: String(row.id),
    agent_id: String(row.agent_id),
    status: String(row.status) as ProviderProposalStatus,
    provider_name: String(row.provider_name),
    proposed_slug: String(row.proposed_slug),
    issuer_url: row.issuer_url ? String(row.issuer_url) : null,
    discovery_url: row.discovery_url ? String(row.discovery_url) : null,
    authorization_url: row.authorization_url ? String(row.authorization_url) : null,
    token_url: row.token_url ? String(row.token_url) : null,
    jwks_url: row.jwks_url ? String(row.jwks_url) : null,
    userinfo_url: row.userinfo_url ? String(row.userinfo_url) : null,
    registration_endpoint: row.registration_endpoint ? String(row.registration_endpoint) : null,
    openapi_url: row.openapi_url ? String(row.openapi_url) : null,
    mcp_url: row.mcp_url ? String(row.mcp_url) : null,
    scopes: asStringArray(row.scopes),
    risk_assessment: normalizeMetadata(row.risk_assessment),
    validation_errors: asStringArray(row.validation_errors),
    provider_id: row.provider_id ? String(row.provider_id) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

export async function insertVaultSecret(input: {
  secret_type: SecretType;
  owner_type: SecretOwnerType;
  owner_id: string;
  plaintext: string;
  metadata?: JsonObject;
  expires_at?: string | null;
  tenant_id?: string;
}): Promise<SecretVaultRecord> {
  const id = randomUUID();
  const fingerprint = createSha256Fingerprint(input.plaintext);
  const encryptedPayload = packEncrypted(input.plaintext);
  const tenantId = input.tenant_id ?? String(input.metadata?.tenant_id ?? "default");

  await pool.query(
    `
      INSERT INTO cap_secret_vault (
        id, secret_type, owner_type, owner_id, encrypted_payload,
        fingerprint, metadata, expires_at, tenant_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [
      id,
      input.secret_type,
      input.owner_type,
      input.owner_id,
      encryptedPayload,
      fingerprint,
      JSON.stringify(input.metadata ?? {}),
      input.expires_at ?? null,
      tenantId,
    ],
  );

  const result = await pool.query(`SELECT * FROM cap_secret_vault WHERE id = $1`, [id]);
  return mapVaultRow(result.rows[0]!);
}

export async function findActiveVaultSecret(input: {
  owner_type: SecretOwnerType;
  owner_id: string;
  secret_type: SecretType;
}): Promise<(SecretVaultRecord & { encrypted_payload: Buffer }) | null> {
  const result = await pool.query(
    `
      SELECT * FROM cap_secret_vault
      WHERE owner_type = $1 AND owner_id = $2 AND secret_type = $3 AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.owner_type, input.owner_id, input.secret_type],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    ...mapVaultRow(row),
    encrypted_payload: Buffer.from(row.encrypted_payload as Buffer),
  };
}

export async function retrieveVaultSecretPlaintext(secretId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT encrypted_payload, status FROM cap_secret_vault WHERE id = $1`,
    [secretId],
  );
  const row = result.rows[0];
  if (!row || String(row.status) !== "active") {
    return null;
  }
  return unpackVaultSecret(Buffer.from(row.encrypted_payload as Buffer));
}

export async function revokeVaultSecret(secretId: string): Promise<void> {
  await pool.query(
    `
      UPDATE cap_secret_vault
      SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'active'
    `,
    [secretId],
  );
}

export async function rotateVaultSecret(input: {
  secretId: string;
  newPlaintext: string;
}): Promise<SecretVaultRecord> {
  const existing = await pool.query(`SELECT * FROM cap_secret_vault WHERE id = $1`, [input.secretId]);
  const row = existing.rows[0];
  if (!row) {
    throw new Error("Secret not found");
  }

  await pool.query(
    `
      UPDATE cap_secret_vault
      SET status = 'rotated', updated_at = NOW()
      WHERE id = $1
    `,
    [input.secretId],
  );

  return insertVaultSecret({
    secret_type: String(row.secret_type) as SecretType,
    owner_type: String(row.owner_type) as SecretOwnerType,
    owner_id: String(row.owner_id),
    plaintext: input.newPlaintext,
    metadata: {
      ...normalizeMetadata(row.metadata),
      rotated_from_id: input.secretId,
    },
  });
}

export async function listVaultSecretsByOwner(input: {
  owner_type: SecretOwnerType;
  owner_id: string;
}): Promise<SecretVaultRecord[]> {
  const result = await pool.query(
    `
      SELECT id, secret_type, owner_type, owner_id, secret_alg, key_version,
             status, fingerprint, metadata, expires_at, rotated_from_id,
             created_at, updated_at, revoked_at
      FROM cap_secret_vault
      WHERE owner_type = $1 AND owner_id = $2
      ORDER BY created_at DESC
    `,
    [input.owner_type, input.owner_id],
  );
  return result.rows.map(mapVaultRow);
}

export async function insertProviderProposal(input: {
  agent_id: string;
  tenant_id?: string;
  provider_name: string;
  proposed_slug: string;
  issuer_url?: string | null;
  discovery_url?: string | null;
  authorization_url?: string | null;
  token_url?: string | null;
  jwks_url?: string | null;
  userinfo_url?: string | null;
  registration_endpoint?: string | null;
  openapi_url?: string | null;
  mcp_url?: string | null;
  scopes?: string[];
  risk_assessment?: JsonObject;
  validation_errors?: string[];
  metadata?: JsonObject;
  status?: ProviderProposalStatus;
  provider_id?: string | null;
}): Promise<ProviderProposalRecord> {
  const id = randomUUID();
  await pool.query(
    `
      INSERT INTO cap_provider_proposals (
        id, agent_id, tenant_id, status, provider_name, proposed_slug,
        issuer_url, discovery_url, authorization_url, token_url, jwks_url,
        userinfo_url, registration_endpoint, openapi_url, mcp_url,
        scopes, risk_assessment, validation_errors, provider_id, metadata
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      )
    `,
    [
      id,
      input.agent_id,
      input.tenant_id ?? "default",
      input.status ?? "pending",
      input.provider_name,
      input.proposed_slug,
      input.issuer_url ?? null,
      input.discovery_url ?? null,
      input.authorization_url ?? null,
      input.token_url ?? null,
      input.jwks_url ?? null,
      input.userinfo_url ?? null,
      input.registration_endpoint ?? null,
      input.openapi_url ?? null,
      input.mcp_url ?? null,
      JSON.stringify(input.scopes ?? []),
      JSON.stringify(input.risk_assessment ?? {}),
      JSON.stringify(input.validation_errors ?? []),
      input.provider_id ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  const result = await pool.query(`SELECT * FROM cap_provider_proposals WHERE id = $1`, [id]);
  return mapProposalRow(result.rows[0]!);
}

export async function updateProviderProposal(
  id: string,
  patch: Partial<{
    status: ProviderProposalStatus;
    validation_errors: string[];
    risk_assessment: JsonObject;
    provider_id: string | null;
  }>,
): Promise<ProviderProposalRecord | null> {
  const fields: string[] = ["updated_at = NOW()"];
  const values: unknown[] = [];
  let index = 1;

  if (patch.status) {
    fields.push(`status = $${index++}`);
    values.push(patch.status);
  }
  if (patch.validation_errors) {
    fields.push(`validation_errors = $${index++}`);
    values.push(JSON.stringify(patch.validation_errors));
  }
  if (patch.risk_assessment) {
    fields.push(`risk_assessment = $${index++}`);
    values.push(JSON.stringify(patch.risk_assessment));
  }
  if (patch.provider_id !== undefined) {
    fields.push(`provider_id = $${index++}`);
    values.push(patch.provider_id);
  }

  values.push(id);
  await pool.query(
    `UPDATE cap_provider_proposals SET ${fields.join(", ")} WHERE id = $${index}`,
    values,
  );

  const result = await pool.query(`SELECT * FROM cap_provider_proposals WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? mapProposalRow(row) : null;
}

export async function findProviderProposalById(id: string): Promise<ProviderProposalRecord | null> {
  const result = await pool.query(`SELECT * FROM cap_provider_proposals WHERE id = $1`, [id]);
  const row = result.rows[0];
  return row ? mapProposalRow(row) : null;
}

export async function findProviderProposalForAgent(input: {
  id: string;
  agent_id: string;
}): Promise<ProviderProposalRecord | null> {
  const result = await pool.query(
    `SELECT * FROM cap_provider_proposals WHERE id = $1 AND agent_id = $2`,
    [input.id, input.agent_id],
  );
  const row = result.rows[0];
  return row ? mapProposalRow(row) : null;
}

export async function writeTrustAudit(input: {
  event_type: TrustAuditEventType;
  tenant_id?: string | null;
  agent_id?: string | null;
  user_id?: string | null;
  provider_id?: string | null;
  capability_id?: string | null;
  grant_id?: string | null;
  policy_id?: string | null;
  execution_id?: string | null;
  latency_ms?: number | null;
  result_hash?: string | null;
  metadata?: JsonObject;
}): Promise<void> {
  await pool.query(
    `
      INSERT INTO cap_trust_audit (
        id, event_type, tenant_id, agent_id, user_id, provider_id, capability_id,
        grant_id, policy_id, execution_id, latency_ms, result_hash, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    `,
    [
      randomUUID(),
      input.event_type,
      input.tenant_id ?? null,
      input.agent_id ?? null,
      input.user_id ?? null,
      input.provider_id ?? null,
      input.capability_id ?? null,
      input.grant_id ?? null,
      input.policy_id ?? null,
      input.execution_id ?? null,
      input.latency_ms ?? null,
      input.result_hash ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function countVaultSecrets(): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM cap_secret_vault WHERE status = 'active'`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function countProviderProposals(): Promise<number> {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM cap_provider_proposals`);
  return Number(result.rows[0]?.count ?? 0);
}
