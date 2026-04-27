import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db";
import type {
  AuditEventRecord,
  ChallengeRecord,
  ClientRecord,
  ClientKeyRotationRecord,
  ClientSummary,
  JsonObject,
  KeyHolderChallengeRecord,
  KvRecord,
  KvRecordSummary,
  NamespaceSummary,
} from "./key-service.entity";

function normalizeMetadata(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function mapClientRow(row: Record<string, unknown>): ClientRecord {
  return {
    client_uuid: String(row.client_uuid),
    public_key_pem: String(row.public_key_pem),
    public_key_fingerprint: String(row.public_key_fingerprint),
    key_alg: String(row.key_alg),
    key_id: row.key_id ? String(row.key_id) : null,
    client_label: row.client_label ? String(row.client_label) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
  };
}

function mapChallengeRow(row: Record<string, unknown>): ChallengeRecord {
  return {
    challenge_id: String(row.challenge_id),
    client_uuid: String(row.client_uuid),
    purpose: String(row.purpose),
    nonce_hash: String(row.nonce_hash),
    issued_at: asIso(row.issued_at),
    expires_at: asIso(row.expires_at),
    used_at: row.used_at ? asIso(row.used_at) : null,
    status: String(row.status) as ChallengeRecord["status"],
    request_id: row.request_id ? String(row.request_id) : null,
    metadata: normalizeMetadata(row.metadata),
  };
}

function mapKeyHolderChallengeRow(row: Record<string, unknown>): KeyHolderChallengeRecord {
  return {
    verification_id: String(row.verification_id),
    target_public_key_fingerprint: String(row.target_public_key_fingerprint),
    purpose: String(row.purpose),
    secret_hash: String(row.secret_hash),
    issued_at: asIso(row.issued_at),
    expires_at: asIso(row.expires_at),
    used_at: row.used_at ? asIso(row.used_at) : null,
    status: String(row.status) as KeyHolderChallengeRecord["status"],
    request_id: row.request_id ? String(row.request_id) : null,
    metadata: normalizeMetadata(row.metadata),
  };
}

function mapClientSummaryRow(row: Record<string, unknown>): ClientSummary {
  return {
    ...mapClientRow(row),
    namespace_count: Number(row.namespace_count ?? 0),
    kv_count: Number(row.kv_count ?? 0),
    last_activity_at: row.last_activity_at ? asIso(row.last_activity_at) : null,
  };
}

function mapKvRow(row: Record<string, unknown>): KvRecord {
  return {
    id: String(row.id),
    client_uuid: String(row.client_uuid),
    namespace: String(row.namespace),
    record_key: String(row.record_key),
    cipher_alg: String(row.cipher_alg),
    ciphertext: row.ciphertext as Buffer,
    cipher_iv: row.cipher_iv as Buffer,
    cipher_tag: row.cipher_tag as Buffer,
    wrapped_dek_alg: String(row.wrapped_dek_alg),
    wrapped_dek: row.wrapped_dek as Buffer,
    wrapped_dek_iv: row.wrapped_dek_iv as Buffer,
    wrapped_dek_tag: row.wrapped_dek_tag as Buffer,
    value_fingerprint: String(row.value_fingerprint),
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    last_read_at: row.last_read_at ? asIso(row.last_read_at) : null,
  };
}

function mapNamespaceRow(row: Record<string, unknown>): NamespaceSummary {
  return {
    namespace: String(row.namespace),
    key_count: Number(row.key_count ?? 0),
    last_updated_at: row.last_updated_at ? asIso(row.last_updated_at) : null,
  };
}

function mapKvSummaryRow(row: Record<string, unknown>): KvRecordSummary {
  return {
    id: String(row.id),
    client_uuid: String(row.client_uuid),
    namespace: String(row.namespace),
    record_key: String(row.record_key),
    value_fingerprint: String(row.value_fingerprint),
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
    updated_at: asIso(row.updated_at),
    last_read_at: row.last_read_at ? asIso(row.last_read_at) : null,
  };
}

function mapAuditRow(row: Record<string, unknown>): AuditEventRecord {
  return {
    id: String(row.id),
    client_uuid: row.client_uuid ? String(row.client_uuid) : null,
    action: String(row.action),
    status: String(row.status),
    request_id: row.request_id ? String(row.request_id) : null,
    error_code: row.error_code ? String(row.error_code) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
  };
}

function mapClientKeyRotationRow(row: Record<string, unknown>): ClientKeyRotationRecord {
  return {
    id: String(row.id),
    client_uuid: String(row.client_uuid),
    old_public_key_fingerprint: String(row.old_public_key_fingerprint),
    new_public_key_fingerprint: String(row.new_public_key_fingerprint),
    old_key_id: row.old_key_id ? String(row.old_key_id) : null,
    new_key_id: row.new_key_id ? String(row.new_key_id) : null,
    request_id: row.request_id ? String(row.request_id) : null,
    metadata: normalizeMetadata(row.metadata),
    created_at: asIso(row.created_at),
  };
}

async function queryRow<T>(
  client: PoolClient,
  sql: string,
  params: unknown[],
  mapper: (row: Record<string, unknown>) => T,
): Promise<T | null> {
  const result = await client.query(sql, params);
  return result.rows[0] ? mapper(result.rows[0] as Record<string, unknown>) : null;
}

export class KeyServiceRepository {
  async withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await handler(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findClientByFingerprint(
    client: PoolClient,
    fingerprint: string,
  ): Promise<ClientRecord | null> {
    return queryRow(
      client,
      `
        SELECT *
        FROM authai_clients
        WHERE public_key_fingerprint = $1
        LIMIT 1
      `,
      [fingerprint],
      mapClientRow,
    );
  }

  async findClientByUuid(client: PoolClient, clientUuid: string): Promise<ClientRecord | null> {
    return queryRow(
      client,
      `
        SELECT *
        FROM authai_clients
        WHERE client_uuid = $1
        LIMIT 1
      `,
      [clientUuid],
      mapClientRow,
    );
  }

  async listClients(client: PoolClient): Promise<ClientSummary[]> {
    const result = await client.query(
      `
        SELECT
          c.*,
          COUNT(k.id)::int AS kv_count,
          COUNT(DISTINCT k.namespace)::int AS namespace_count,
          MAX(GREATEST(
            c.updated_at,
            COALESCE(k.updated_at, c.updated_at),
            COALESCE(k.last_read_at, c.updated_at)
          )) AS last_activity_at
        FROM authai_clients c
        LEFT JOIN authai_kv_records k
          ON k.client_uuid = c.client_uuid
        GROUP BY c.client_uuid
        ORDER BY last_activity_at DESC NULLS LAST, c.updated_at DESC
      `,
    );
    return result.rows.map((row) => mapClientSummaryRow(row as Record<string, unknown>));
  }

  async upsertClient(
    client: PoolClient,
    input: {
      publicKeyPem: string;
      publicKeyFingerprint: string;
      keyAlg: string;
      keyId?: string;
      clientLabel?: string;
      metadata: JsonObject;
    },
  ): Promise<ClientRecord> {
    const existing = await this.findClientByFingerprint(client, input.publicKeyFingerprint);
    if (existing) {
      const result = await client.query(
        `
          UPDATE authai_clients
          SET
            public_key_pem = $2,
            key_alg = $3,
            key_id = $4,
            client_label = $5,
            metadata = $6::jsonb
          WHERE client_uuid = $1
          RETURNING *
        `,
        [
          existing.client_uuid,
          input.publicKeyPem,
          input.keyAlg,
          input.keyId ?? null,
          input.clientLabel ?? null,
          JSON.stringify(input.metadata),
        ],
      );
      return mapClientRow(result.rows[0] as Record<string, unknown>);
    }

    const result = await client.query(
      `
        INSERT INTO authai_clients (
          client_uuid,
          public_key_pem,
          public_key_fingerprint,
          key_alg,
          key_id,
          client_label,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        RETURNING *
      `,
      [
        randomUUID(),
        input.publicKeyPem,
        input.publicKeyFingerprint,
        input.keyAlg,
        input.keyId ?? null,
        input.clientLabel ?? null,
        JSON.stringify(input.metadata),
      ],
    );
    return mapClientRow(result.rows[0] as Record<string, unknown>);
  }

  async rotateClientKey(
    client: PoolClient,
    input: {
      clientUuid: string;
      publicKeyPem: string;
      publicKeyFingerprint: string;
      keyAlg: string;
      keyId?: string;
      clientLabel?: string;
      metadata: JsonObject;
    },
  ): Promise<ClientRecord> {
    const result = await client.query(
      `
        UPDATE authai_clients
        SET
          public_key_pem = $2,
          public_key_fingerprint = $3,
          key_alg = $4,
          key_id = $5,
          client_label = $6,
          metadata = $7::jsonb
        WHERE client_uuid = $1
        RETURNING *
      `,
      [
        input.clientUuid,
        input.publicKeyPem,
        input.publicKeyFingerprint,
        input.keyAlg,
        input.keyId ?? null,
        input.clientLabel ?? null,
        JSON.stringify(input.metadata),
      ],
    );
    return mapClientRow(result.rows[0] as Record<string, unknown>);
  }

  async appendClientKeyRotation(
    client: PoolClient,
    input: {
      clientUuid: string;
      oldPublicKeyFingerprint: string;
      newPublicKeyFingerprint: string;
      oldKeyId?: string | null;
      newKeyId?: string | null;
      requestId?: string;
      metadata: JsonObject;
    },
  ): Promise<ClientKeyRotationRecord> {
    const result = await client.query(
      `
        INSERT INTO authai_client_key_rotations (
          id,
          client_uuid,
          old_public_key_fingerprint,
          new_public_key_fingerprint,
          old_key_id,
          new_key_id,
          request_id,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        RETURNING *
      `,
      [
        randomUUID(),
        input.clientUuid,
        input.oldPublicKeyFingerprint,
        input.newPublicKeyFingerprint,
        input.oldKeyId ?? null,
        input.newKeyId ?? null,
        input.requestId ?? null,
        JSON.stringify(input.metadata),
      ],
    );
    return mapClientKeyRotationRow(result.rows[0] as Record<string, unknown>);
  }

  async createChallenge(
    client: PoolClient,
    input: {
      clientUuid: string;
      purpose: string;
      nonceHash: string;
      issuedAt: Date;
      expiresAt: Date;
      requestId?: string;
      metadata: JsonObject;
    },
  ): Promise<ChallengeRecord> {
    const result = await client.query(
      `
        INSERT INTO authai_challenges (
          challenge_id,
          client_uuid,
          purpose,
          nonce_hash,
          issued_at,
          expires_at,
          status,
          request_id,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8::jsonb)
        RETURNING *
      `,
      [
        randomUUID(),
        input.clientUuid,
        input.purpose,
        input.nonceHash,
        input.issuedAt.toISOString(),
        input.expiresAt.toISOString(),
        input.requestId ?? null,
        JSON.stringify(input.metadata),
      ],
    );
    return mapChallengeRow(result.rows[0] as Record<string, unknown>);
  }

  async findChallengeById(
    client: PoolClient,
    challengeId: string,
  ): Promise<ChallengeRecord | null> {
    return queryRow(
      client,
      `
        SELECT *
        FROM authai_challenges
        WHERE challenge_id = $1
        LIMIT 1
      `,
      [challengeId],
      mapChallengeRow,
    );
  }

  async markChallengeUsed(
    client: PoolClient,
    challengeId: string,
    requestId?: string,
  ): Promise<ChallengeRecord | null> {
    return queryRow(
      client,
      `
        UPDATE authai_challenges
        SET
          status = 'used',
          used_at = NOW(),
          request_id = COALESCE($2, request_id)
        WHERE challenge_id = $1
        RETURNING *
      `,
      [challengeId, requestId ?? null],
      mapChallengeRow,
    );
  }

  async revokeOtherActiveChallenges(
    client: PoolClient,
    clientUuid: string,
    challengeId: string,
    purpose: string,
  ): Promise<void> {
    await client.query(
      `
        UPDATE authai_challenges
        SET status = 'revoked'
        WHERE client_uuid = $1
          AND purpose = $2
          AND status = 'active'
          AND challenge_id <> $3
      `,
      [clientUuid, purpose, challengeId],
    );
  }

  async createKeyHolderChallenge(
    client: PoolClient,
    input: {
      targetPublicKeyFingerprint: string;
      purpose: string;
      secretHash: string;
      issuedAt: Date;
      expiresAt: Date;
      requestId?: string;
      metadata: JsonObject;
    },
  ): Promise<KeyHolderChallengeRecord> {
    const result = await client.query(
      `
        INSERT INTO authai_key_holder_challenges (
          verification_id,
          target_public_key_fingerprint,
          purpose,
          secret_hash,
          issued_at,
          expires_at,
          status,
          request_id,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8::jsonb)
        RETURNING *
      `,
      [
        randomUUID(),
        input.targetPublicKeyFingerprint,
        input.purpose,
        input.secretHash,
        input.issuedAt.toISOString(),
        input.expiresAt.toISOString(),
        input.requestId ?? null,
        JSON.stringify(input.metadata),
      ],
    );
    return mapKeyHolderChallengeRow(result.rows[0] as Record<string, unknown>);
  }

  async findKeyHolderChallengeById(
    client: PoolClient,
    verificationId: string,
  ): Promise<KeyHolderChallengeRecord | null> {
    return queryRow(
      client,
      `
        SELECT *
        FROM authai_key_holder_challenges
        WHERE verification_id = $1
        LIMIT 1
      `,
      [verificationId],
      mapKeyHolderChallengeRow,
    );
  }

  async markKeyHolderChallengeUsed(
    client: PoolClient,
    verificationId: string,
    requestId?: string,
  ): Promise<KeyHolderChallengeRecord | null> {
    return queryRow(
      client,
      `
        UPDATE authai_key_holder_challenges
        SET
          status = 'used',
          used_at = NOW(),
          request_id = COALESCE($2, request_id)
        WHERE verification_id = $1
        RETURNING *
      `,
      [verificationId, requestId ?? null],
      mapKeyHolderChallengeRow,
    );
  }

  async upsertKvRecord(
    client: PoolClient,
    input: {
      clientUuid: string;
      namespace: string;
      recordKey: string;
      cipherAlg: string;
      ciphertext: Buffer;
      cipherIv: Buffer;
      cipherTag: Buffer;
      wrappedDekAlg: string;
      wrappedDek: Buffer;
      wrappedDekIv: Buffer;
      wrappedDekTag: Buffer;
      valueFingerprint: string;
      metadata: JsonObject;
    },
  ): Promise<KvRecord> {
    const result = await client.query(
      `
        INSERT INTO authai_kv_records (
          id,
          client_uuid,
          namespace,
          record_key,
          cipher_alg,
          ciphertext,
          cipher_iv,
          cipher_tag,
          wrapped_dek_alg,
          wrapped_dek,
          wrapped_dek_iv,
          wrapped_dek_tag,
          value_fingerprint,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
        ON CONFLICT (client_uuid, namespace, record_key)
        DO UPDATE SET
          cipher_alg = EXCLUDED.cipher_alg,
          ciphertext = EXCLUDED.ciphertext,
          cipher_iv = EXCLUDED.cipher_iv,
          cipher_tag = EXCLUDED.cipher_tag,
          wrapped_dek_alg = EXCLUDED.wrapped_dek_alg,
          wrapped_dek = EXCLUDED.wrapped_dek,
          wrapped_dek_iv = EXCLUDED.wrapped_dek_iv,
          wrapped_dek_tag = EXCLUDED.wrapped_dek_tag,
          value_fingerprint = EXCLUDED.value_fingerprint,
          metadata = EXCLUDED.metadata
        RETURNING *
      `,
      [
        randomUUID(),
        input.clientUuid,
        input.namespace,
        input.recordKey,
        input.cipherAlg,
        input.ciphertext,
        input.cipherIv,
        input.cipherTag,
        input.wrappedDekAlg,
        input.wrappedDek,
        input.wrappedDekIv,
        input.wrappedDekTag,
        input.valueFingerprint,
        JSON.stringify(input.metadata),
      ],
    );
    return mapKvRow(result.rows[0] as Record<string, unknown>);
  }

  async findKvRecords(
    client: PoolClient,
    input: { clientUuid: string; namespace: string; keys: string[] },
  ): Promise<KvRecord[]> {
    const result = await client.query(
      `
        SELECT *
        FROM authai_kv_records
        WHERE client_uuid = $1
          AND namespace = $2
          AND record_key = ANY($3::text[])
      `,
      [input.clientUuid, input.namespace, input.keys],
    );
    return result.rows.map((row) => mapKvRow(row as Record<string, unknown>));
  }

  async findKvRecord(
    client: PoolClient,
    input: { clientUuid: string; namespace: string; key: string },
  ): Promise<KvRecord | null> {
    return queryRow(
      client,
      `
        SELECT *
        FROM authai_kv_records
        WHERE client_uuid = $1
          AND namespace = $2
          AND record_key = $3
        LIMIT 1
      `,
      [input.clientUuid, input.namespace, input.key],
      mapKvRow,
    );
  }

  async listNamespaces(client: PoolClient, clientUuid: string): Promise<NamespaceSummary[]> {
    const result = await client.query(
      `
        SELECT
          namespace,
          COUNT(*)::int AS key_count,
          MAX(updated_at) AS last_updated_at
        FROM authai_kv_records
        WHERE client_uuid = $1
        GROUP BY namespace
        ORDER BY last_updated_at DESC NULLS LAST, namespace ASC
      `,
      [clientUuid],
    );
    return result.rows.map((row) => mapNamespaceRow(row as Record<string, unknown>));
  }

  async listKvRecordSummaries(
    client: PoolClient,
    input: { clientUuid: string; namespace: string },
  ): Promise<KvRecordSummary[]> {
    const result = await client.query(
      `
        SELECT
          id,
          client_uuid,
          namespace,
          record_key,
          value_fingerprint,
          metadata,
          created_at,
          updated_at,
          last_read_at
        FROM authai_kv_records
        WHERE client_uuid = $1
          AND namespace = $2
        ORDER BY updated_at DESC, record_key ASC
      `,
      [input.clientUuid, input.namespace],
    );
    return result.rows.map((row) => mapKvSummaryRow(row as Record<string, unknown>));
  }

  async markKvRead(
    client: PoolClient,
    input: { clientUuid: string; namespace: string; keys: string[] },
  ): Promise<void> {
    await client.query(
      `
        UPDATE authai_kv_records
        SET last_read_at = NOW()
        WHERE client_uuid = $1
          AND namespace = $2
          AND record_key = ANY($3::text[])
      `,
      [input.clientUuid, input.namespace, input.keys],
    );
  }

  async appendAuditEvent(
    client: PoolClient,
    input: {
      clientUuid?: string | null;
      action: string;
      status: string;
      requestId?: string | null;
      errorCode?: string | null;
      metadata: JsonObject;
    },
  ): Promise<AuditEventRecord> {
    const result = await client.query(
      `
        INSERT INTO authai_audit_events (
          id,
          client_uuid,
          action,
          status,
          request_id,
          error_code,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        RETURNING *
      `,
      [
        randomUUID(),
        input.clientUuid ?? null,
        input.action,
        input.status,
        input.requestId ?? null,
        input.errorCode ?? null,
        JSON.stringify(input.metadata),
      ],
    );
    return mapAuditRow(result.rows[0] as Record<string, unknown>);
  }
}
