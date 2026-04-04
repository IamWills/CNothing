import { randomUUID } from "node:crypto";
import { KeyService } from "../core/key-service";
import { decryptKvRecordValue, encryptJsonValue } from "../core/key-service-kv";
import {
  assertJsonSerializable,
  normalizeJsonObject,
  normalizeNamespace,
  normalizeRecordKey,
} from "../core/key-service.shared";
import type { ClientSummary, KvRecordSummary, NamespaceSummary } from "../core/key-service.entity";
import { KeyServiceRepository } from "../core/key-service.repository";
import { NotFoundError, ValidationError } from "../utils/errors";

type ManualKvSaveInput = {
  namespace?: unknown;
  items?: unknown;
};

type ManualKvItemInput = {
  key?: unknown;
  value?: unknown;
  metadata?: unknown;
};

export class KeyServiceAdminService {
  private readonly keyService = new KeyService();

  private readonly repo = new KeyServiceRepository();

  async listClients(): Promise<ClientSummary[]> {
    return this.repo.withTransaction((tx) => this.repo.listClients(tx));
  }

  async registerClient(input: Record<string, unknown>) {
    return this.keyService.registerClient(input);
  }

  async listNamespaces(clientUuid: string): Promise<NamespaceSummary[]> {
    return this.repo.withTransaction(async (tx) => {
      const client = await this.repo.findClientByUuid(tx, clientUuid);
      if (!client) {
        throw new NotFoundError(`Unknown client_uuid: ${clientUuid}`);
      }
      return this.repo.listNamespaces(tx, clientUuid);
    });
  }

  async listKvRecords(clientUuid: string, namespace: string): Promise<KvRecordSummary[]> {
    const normalizedNamespace = normalizeNamespace(namespace);
    return this.repo.withTransaction(async (tx) => {
      const client = await this.repo.findClientByUuid(tx, clientUuid);
      if (!client) {
        throw new NotFoundError(`Unknown client_uuid: ${clientUuid}`);
      }
      return this.repo.listKvRecordSummaries(tx, {
        clientUuid,
        namespace: normalizedNamespace,
      });
    });
  }

  async getKvValue(clientUuid: string, namespace: string, key: string) {
    const normalizedNamespace = normalizeNamespace(namespace);
    const normalizedKey = normalizeRecordKey(key);

    return this.repo.withTransaction(async (tx) => {
      const client = await this.repo.findClientByUuid(tx, clientUuid);
      if (!client) {
        throw new NotFoundError(`Unknown client_uuid: ${clientUuid}`);
      }

      const record = await this.repo.findKvRecord(tx, {
        clientUuid,
        namespace: normalizedNamespace,
        key: normalizedKey,
      });
      if (!record) {
        throw new NotFoundError(`No KV record for ${normalizedNamespace}/${normalizedKey}`);
      }

      await this.repo.markKvRead(tx, {
        clientUuid,
        namespace: normalizedNamespace,
        keys: [normalizedKey],
      });

      return {
        ok: true,
        client_uuid: clientUuid,
        namespace: normalizedNamespace,
        key: normalizedKey,
        value: decryptKvRecordValue(record),
        metadata: record.metadata,
        value_fingerprint: record.value_fingerprint,
        updated_at: record.updated_at,
        last_read_at: record.last_read_at,
      };
    });
  }

  async savePlaintextKv(clientUuid: string, input: ManualKvSaveInput) {
    const namespace = normalizeNamespace(input.namespace);
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new ValidationError("items must be a non-empty array", {
        error_code: "payload_invalid",
      });
    }

    const savedKeys = await this.repo.withTransaction(async (tx) => {
      const client = await this.repo.findClientByUuid(tx, clientUuid);
      if (!client) {
        throw new NotFoundError(`Unknown client_uuid: ${clientUuid}`);
      }

      const keys: string[] = [];
      for (const rawItem of input.items as ManualKvItemInput[]) {
        const recordKey = normalizeRecordKey(rawItem?.key);
        assertJsonSerializable(rawItem?.value, `value for ${recordKey}`);
        const metadata = normalizeJsonObject(rawItem?.metadata);
        const encryptedValue = encryptJsonValue(rawItem?.value);

        await this.repo.upsertKvRecord(tx, {
          clientUuid,
          namespace,
          recordKey,
          cipherAlg: encryptedValue.cipher_alg,
          ciphertext: encryptedValue.ciphertext,
          cipherIv: encryptedValue.cipher_iv,
          cipherTag: encryptedValue.cipher_tag,
          wrappedDekAlg: encryptedValue.wrapped_dek_alg,
          wrappedDek: encryptedValue.wrapped_dek,
          wrappedDekIv: encryptedValue.wrapped_dek_iv,
          wrappedDekTag: encryptedValue.wrapped_dek_tag,
          valueFingerprint: encryptedValue.value_fingerprint,
          metadata,
        });
        keys.push(recordKey);
      }

      await this.repo.appendAuditEvent(tx, {
        clientUuid,
        action: "admin.kv.save_plaintext",
        status: "success",
        requestId: randomUUID(),
        metadata: {
          namespace,
          saved_keys: keys,
          saved_via: "admin_api",
        },
      });

      return keys;
    });

    return {
      ok: true,
      client_uuid: clientUuid,
      namespace,
      saved_keys: savedKeys,
    };
  }
}
