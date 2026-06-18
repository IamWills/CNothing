import { randomUUID } from "node:crypto";
import config from "../config";
import { decryptKvRecordValue } from "../core/key-service-kv";
import { KeyServiceRepository } from "../core/key-service.repository";
import { normalizeNamespace, normalizeRecordKey } from "../core/key-service.shared";
import { encryptWithAes256Gcm } from "../crypto/master-key";
import { NotFoundError } from "../utils/errors";
import { findConnectorById } from "./v2.repository";
import { pool } from "../db";

export type KvMigrationInventoryItem = {
  client_uuid: string;
  namespace: string;
  record_key: string;
  value_fingerprint: string;
  updated_at: string;
  suggested_capability: string | null;
};

const NAMESPACE_CAPABILITY_HINTS: Array<{ pattern: RegExp; capability: string }> = [
  { pattern: /^github[./]/i, capability: "github.create_issue" },
  { pattern: /^github$/i, capability: "github.create_issue" },
  { pattern: /^slack[./]/i, capability: "slack.post_message" },
  { pattern: /^slack$/i, capability: "slack.post_message" },
  { pattern: /^openai[./]/i, capability: "http.request" },
  { pattern: /^stripe[./]/i, capability: "http.request" },
];

function suggestCapability(namespace: string, recordKey: string): string | null {
  for (const hint of NAMESPACE_CAPABILITY_HINTS) {
    if (hint.pattern.test(namespace)) {
      return hint.capability;
    }
  }
  if (recordKey.includes("/")) {
    const provider = recordKey.split("/")[0]?.toLowerCase();
    if (provider === "github") return "github.create_issue";
    if (provider === "slack") return "slack.post_message";
  }
  return null;
}

export class KvMigrationService {
  private readonly repo = new KeyServiceRepository();

  async getInventory(limit = 500): Promise<{ ok: true; items: KvMigrationInventoryItem[]; total: number }> {
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM authai_kv_records`);
    const total = Number(countResult.rows[0]?.total ?? 0);

    const result = await pool.query(
      `
        SELECT client_uuid, namespace, record_key, value_fingerprint, updated_at
        FROM authai_kv_records
        ORDER BY updated_at DESC
        LIMIT $1
      `,
      [Math.min(Math.max(limit, 1), 2000)],
    );

    const items = result.rows.map((row) => {
      const namespace = String(row.namespace);
      const recordKey = String(row.record_key);
      return {
        client_uuid: String(row.client_uuid),
        namespace,
        record_key: recordKey,
        value_fingerprint: String(row.value_fingerprint),
        updated_at: new Date(String(row.updated_at)).toISOString(),
        suggested_capability: suggestCapability(namespace, recordKey),
      };
    });

    return { ok: true, items, total };
  }

  async migrateRecordToCredential(input: {
    client_uuid: string;
    namespace: string;
    record_key: string;
    connector_id: string;
    owner_user_id: string;
  }) {
    const namespace = normalizeNamespace(input.namespace);
    const recordKey = normalizeRecordKey(input.record_key);

    const connector = await findConnectorById(input.connector_id);
    if (!connector || connector.status !== "active") {
      throw new NotFoundError(`Connector not found: ${input.connector_id}`);
    }

    const migrationResult = await this.repo.withTransaction(async (tx) => {
      const record = await this.repo.findKvRecord(tx, {
        clientUuid: input.client_uuid,
        namespace,
        key: recordKey,
      });
      if (!record) {
        throw new NotFoundError(`KV record not found: ${namespace}/${recordKey}`);
      }

      const value = decryptKvRecordValue(record);
      const secretPayload = Buffer.from(JSON.stringify(value), "utf8");

      const credentialId = randomUUID();
      const encrypted = encryptWithAes256Gcm({
        plaintext: secretPayload,
        key: config.masterKey,
      });
      const payload = Buffer.concat([encrypted.iv, encrypted.tag, encrypted.ciphertext]);

      await tx.query(
        `
          INSERT INTO cap_credentials (id, connector_id, owner_user_id, encrypted_secret, metadata)
          VALUES ($1, $2, $3, $4, $5::jsonb)
        `,
        [
          credentialId,
          input.connector_id,
          input.owner_user_id,
          payload,
          JSON.stringify({
            migrated_from: "v1_kv",
            client_uuid: input.client_uuid,
            namespace,
            record_key: recordKey,
            value_fingerprint: record.value_fingerprint,
          }),
        ],
      );

      await this.repo.appendAuditEvent(tx, {
        clientUuid: input.client_uuid,
        action: "v2.migration.kv_to_credential",
        status: "success",
        requestId: randomUUID(),
        metadata: {
          namespace,
          record_key: recordKey,
          connector_id: input.connector_id,
          owner_user_id: input.owner_user_id,
          credential_id: credentialId,
        },
      });

      return {
        credential_id: credentialId,
        connector_id: input.connector_id,
        owner_user_id: input.owner_user_id,
        source: {
          client_uuid: input.client_uuid,
          namespace,
          record_key: recordKey,
        },
      };
    });

    return { ok: true as const, migration: migrationResult };
  }

  getMigrationGuide() {
    return {
      ok: true as const,
      guide: {
        summary: "Migrate from v1 encrypted KV to v2 connector-held credentials.",
        sunset_at: config.v1SunsetDate,
        steps: [
          "Inventory v1 KV records via GET /v2/admin/migration/kv-inventory.",
          "Register connectors and capabilities for each third-party provider.",
          "Migrate secrets into connector-local storage via POST /v2/admin/migration/kv-to-credential.",
          "Replace kv.read/kv.save agent flows with invoke(capability, input).",
          "Revoke v1 client access after validation.",
        ],
        mappings: NAMESPACE_CAPABILITY_HINTS.map((item) => ({
          namespace_pattern: item.pattern.source,
          suggested_capability: item.capability,
        })),
      },
    };
  }
}

export const kvMigrationService = new KvMigrationService();
