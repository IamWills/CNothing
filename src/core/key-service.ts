import { randomBytes, randomUUID } from "node:crypto";
import config from "../config";
import { encryptForPublicKey, decryptWithPrivateKey, getPublicKeyInfo } from "../crypto/hybrid-envelope";
import {
  createSha256Fingerprint,
  decryptWithAes256Gcm,
  encryptWithAes256Gcm,
  generateDataEncryptionKey,
} from "../crypto/master-key";
import { NotFoundError, ValidationError, ConflictError } from "../utils/errors";
import type {
  AuthaiPublicKeyView,
  ChallengeRecord,
  ClientRecord,
  JsonObject,
} from "./key-service.entity";
import { KeyServiceRepository } from "./key-service.repository";

const ACTIVE_CHALLENGE_PURPOSE = "authai.operation";
const CLIENT_KEY_ALG = "RSA-OAEP-256/A256GCM";

type RegisterRequest = {
  client_public_key?: unknown;
  client_key_alg?: unknown;
  client_key_id?: unknown;
  client_label?: unknown;
  metadata?: unknown;
};

type AuthEnvelopePayload = {
  v: "ksp1";
  type: "auth";
  action: "authai.refresh" | "kv.save" | "kv.read";
  client_uuid: string;
  challenge_id: string;
  nonce: string;
  issued_at: string;
  expires_at: string;
  request_id: string;
};

type SaveEnvelopePayload = {
  v: "ksp1";
  type: "kv.save";
  namespace: string;
  items: Array<{
    key: string;
    value: unknown;
    metadata?: JsonObject;
  }>;
};

type ReadEnvelopePayload = {
  v: "ksp1";
  type: "kv.read";
  namespace: string;
  keys: string[];
};

function normalizeString(
  value: unknown,
  fieldName: string,
  pattern: RegExp,
  maxLength: number,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new ValidationError(`${fieldName} is required`, { error_code: "missing_field" });
  }
  if (normalized.length > maxLength || !pattern.test(normalized)) {
    throw new ValidationError(`${fieldName} contains unsupported characters`, {
      error_code: "invalid_field",
      field: fieldName,
    });
  }
  return normalized;
}

function normalizeOptionalString(value: unknown, maxLength: number): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new ValidationError("Field is too long", { error_code: "field_too_long" });
  }
  return normalized;
}

function normalizeJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function assertJsonSerializable(value: unknown, fieldName: string): void {
  try {
    JSON.stringify(value);
  } catch (error) {
    throw new ValidationError(`${fieldName} must be JSON serializable`, {
      error_code: "invalid_json",
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function now(): Date {
  return new Date();
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function createNonce(): string {
  return randomBytes(32).toString("base64url");
}

function authaiPublicKeyView(): AuthaiPublicKeyView {
  return getPublicKeyInfo({
    publicKeyPem: config.authaiPublicKeyPem,
    keyId: config.authaiKeyId,
  });
}

function normalizeNamespace(value: unknown): string {
  return normalizeString(value, "namespace", /^[a-zA-Z0-9._:@/-]{1,160}$/, 160);
}

function normalizeRecordKey(value: unknown): string {
  return normalizeString(value, "key", /^[a-zA-Z0-9._:@/-]{1,256}$/, 256);
}

function normalizeClientPublicKey(value: unknown): string {
  const pem = typeof value === "string" ? value.trim() : "";
  if (!pem) {
    throw new ValidationError("client_public_key is required", { error_code: "missing_field" });
  }
  if (!pem.includes("BEGIN PUBLIC KEY")) {
    throw new ValidationError("client_public_key must be a PEM encoded public key", {
      error_code: "invalid_public_key",
    });
  }
  return pem;
}

export class KeyService {
  private readonly repo = new KeyServiceRepository();

  getAuthaiPublicKey(): AuthaiPublicKeyView {
    return authaiPublicKeyView();
  }

  private async issueChallenge(
    client: ClientRecord,
    requestId?: string,
    metadata: JsonObject = {},
  ): Promise<{
    challenge_for_client: ReturnType<typeof encryptForPublicKey>;
    challenge_id: string;
    expires_at: string;
  }> {
    return this.repo.withTransaction(async (tx) => {
      const issuedAt = now();
      const expiresAt = addSeconds(issuedAt, config.challengeTtlSeconds);
      const nonce = createNonce();
      const challenge = await this.repo.createChallenge(tx, {
        clientUuid: client.client_uuid,
        purpose: ACTIVE_CHALLENGE_PURPOSE,
        nonceHash: createSha256Fingerprint(nonce),
        issuedAt,
        expiresAt,
        requestId,
        metadata,
      });
      await this.repo.revokeOtherActiveChallenges(
        tx,
        client.client_uuid,
        challenge.challenge_id,
        ACTIVE_CHALLENGE_PURPOSE,
      );
      const envelope = encryptForPublicKey({
        publicKeyPem: client.public_key_pem,
        keyId: client.key_id ?? undefined,
        payload: {
          v: "ksp1",
          type: "challenge",
          purpose: ACTIVE_CHALLENGE_PURPOSE,
          client_uuid: client.client_uuid,
          challenge_id: challenge.challenge_id,
          nonce,
          issued_at: challenge.issued_at,
          expires_at: challenge.expires_at,
        },
      });
      return {
        challenge_for_client: envelope,
        challenge_id: challenge.challenge_id,
        expires_at: challenge.expires_at,
      };
    });
  }

  private async validateAuthEnvelope(
    authEnvelope: unknown,
    expectedAction: AuthEnvelopePayload["action"],
  ): Promise<{ client: ClientRecord; auth: AuthEnvelopePayload; challenge: ChallengeRecord }> {
    const auth = decryptWithPrivateKey<AuthEnvelopePayload>({
      privateKeyPem: config.authaiPrivateKeyPem,
      envelope: authEnvelope,
      expectedKeyId: config.authaiKeyId,
    });

    if (auth.v !== "ksp1" || auth.type !== "auth") {
      throw new ValidationError("Invalid auth envelope payload", { error_code: "invalid_auth_envelope" });
    }
    if (auth.action !== expectedAction) {
      throw new ValidationError("Auth envelope action mismatch", {
        error_code: "challenge_purpose_mismatch",
        client_uuid: auth.client_uuid,
      });
    }

    return this.repo.withTransaction(async (tx) => {
      const client = await this.repo.findClientByUuid(tx, auth.client_uuid);
      if (!client) {
        throw new NotFoundError(`Unknown client_uuid: ${auth.client_uuid}`);
      }

      const challenge = await this.repo.findChallengeById(tx, auth.challenge_id);
      if (!challenge || challenge.client_uuid !== client.client_uuid) {
        throw new ValidationError("Challenge not found", {
          error_code: "challenge_not_found",
          client_uuid: client.client_uuid,
        });
      }
      if (challenge.purpose !== ACTIVE_CHALLENGE_PURPOSE) {
        throw new ValidationError("Challenge purpose mismatch", {
          error_code: "challenge_purpose_mismatch",
          client_uuid: client.client_uuid,
        });
      }
      if (challenge.status !== "active") {
        throw new ConflictError("Challenge already used or revoked", {
          error_code: "challenge_already_used",
          client_uuid: client.client_uuid,
        });
      }
      if (new Date(challenge.expires_at).getTime() < Date.now()) {
        throw new ValidationError("Challenge expired", {
          error_code: "challenge_expired",
          client_uuid: client.client_uuid,
        });
      }
      if (createSha256Fingerprint(auth.nonce) !== challenge.nonce_hash) {
        throw new ValidationError("Challenge nonce mismatch", {
          error_code: "challenge_nonce_mismatch",
          client_uuid: client.client_uuid,
        });
      }

      await this.repo.markChallengeUsed(tx, challenge.challenge_id, auth.request_id);
      return { client, auth, challenge };
    });
  }

  async registerClient(input: RegisterRequest) {
    const publicKeyPem = normalizeClientPublicKey(input.client_public_key);
    const keyAlg = normalizeOptionalString(input.client_key_alg, 64) ?? CLIENT_KEY_ALG;
    const keyId = normalizeOptionalString(input.client_key_id, 128);
    const clientLabel = normalizeOptionalString(input.client_label, 160);
    const metadata = normalizeJsonObject(input.metadata);
    const publicKeyFingerprint = getPublicKeyInfo({
      publicKeyPem,
      keyId: keyId ?? "external",
    }).public_key_fingerprint;

    const client = await this.repo.withTransaction((tx) =>
      this.repo.upsertClient(tx, {
        publicKeyPem,
        publicKeyFingerprint,
        keyAlg,
        keyId,
        clientLabel,
        metadata,
      }),
    );

    const challenge = await this.issueChallenge(client, randomUUID(), {
      source: "authai.register",
    });

    await this.repo.withTransaction((tx) =>
      this.repo.appendAuditEvent(tx, {
        clientUuid: client.client_uuid,
        action: "authai.register",
        status: "success",
        metadata: {
          public_key_fingerprint: client.public_key_fingerprint,
          reused_existing_client: Boolean(client.created_at !== client.updated_at),
        },
      }),
    );

    return {
      ok: true,
      client_uuid: client.client_uuid,
      client_key_fingerprint: client.public_key_fingerprint,
      authai_public_key: this.getAuthaiPublicKey(),
      challenge_for_client: challenge.challenge_for_client,
      challenge_id: challenge.challenge_id,
      challenge_expires_at: challenge.expires_at,
    };
  }

  async refreshChallenge(input: { auth_envelope?: unknown }) {
    const { client, auth } = await this.validateAuthEnvelope(input.auth_envelope, "authai.refresh");
    const challenge = await this.issueChallenge(client, auth.request_id, {
      source: "authai.refresh",
    });
    await this.repo.withTransaction((tx) =>
      this.repo.appendAuditEvent(tx, {
        clientUuid: client.client_uuid,
        action: "authai.refresh",
        status: "success",
        requestId: auth.request_id,
        metadata: {},
      }),
    );
    return {
      ok: true,
      client_uuid: client.client_uuid,
      request_id: auth.request_id,
      authai_public_key: this.getAuthaiPublicKey(),
      next_challenge_for_client: challenge.challenge_for_client,
      next_challenge_id: challenge.challenge_id,
      next_challenge_expires_at: challenge.expires_at,
    };
  }

  async saveKv(input: { auth_envelope?: unknown; data_envelope?: unknown }) {
    const { client, auth } = await this.validateAuthEnvelope(input.auth_envelope, "kv.save");
    const payload = decryptWithPrivateKey<SaveEnvelopePayload>({
      privateKeyPem: config.authaiPrivateKeyPem,
      envelope: input.data_envelope,
      expectedKeyId: config.authaiKeyId,
    });

    if (payload.v !== "ksp1" || payload.type !== "kv.save") {
      throw new ValidationError("Invalid kv.save payload", { error_code: "payload_invalid" });
    }
    const namespace = normalizeNamespace(payload.namespace);
    if (!Array.isArray(payload.items) || payload.items.length === 0) {
      throw new ValidationError("kv.save requires at least one item", { error_code: "payload_invalid" });
    }

    const savedKeys = await this.repo.withTransaction(async (tx) => {
      const keys: string[] = [];
      for (const item of payload.items) {
        const recordKey = normalizeRecordKey(item?.key);
        assertJsonSerializable(item?.value, `value for ${recordKey}`);
        const metadata = normalizeJsonObject(item?.metadata);
        const plaintext = Buffer.from(JSON.stringify(item?.value ?? null), "utf8");
        const dek = generateDataEncryptionKey();
        const encryptedValue = encryptWithAes256Gcm({
          plaintext,
          key: dek,
        });
        const wrappedDek = encryptWithAes256Gcm({
          plaintext: dek,
          key: config.masterKey,
        });
        await this.repo.upsertKvRecord(tx, {
          clientUuid: client.client_uuid,
          namespace,
          recordKey,
          cipherAlg: encryptedValue.algorithm,
          ciphertext: encryptedValue.ciphertext,
          cipherIv: encryptedValue.iv,
          cipherTag: encryptedValue.tag,
          wrappedDekAlg: wrappedDek.algorithm,
          wrappedDek: wrappedDek.ciphertext,
          wrappedDekIv: wrappedDek.iv,
          wrappedDekTag: wrappedDek.tag,
          valueFingerprint: createSha256Fingerprint(plaintext),
          metadata,
        });
        keys.push(recordKey);
      }
      await this.repo.appendAuditEvent(tx, {
        clientUuid: client.client_uuid,
        action: "kv.save",
        status: "success",
        requestId: auth.request_id,
        metadata: {
          namespace,
          saved_keys: keys,
        },
      });
      return keys;
    });

    const challenge = await this.issueChallenge(client, auth.request_id, {
      source: "kv.save",
      namespace,
    });

    return {
      ok: true,
      client_uuid: client.client_uuid,
      request_id: auth.request_id,
      namespace,
      saved_keys: savedKeys,
      authai_public_key: this.getAuthaiPublicKey(),
      next_challenge_for_client: challenge.challenge_for_client,
      next_challenge_id: challenge.challenge_id,
      next_challenge_expires_at: challenge.expires_at,
    };
  }

  async readKv(input: { auth_envelope?: unknown; query_envelope?: unknown }) {
    const { client, auth } = await this.validateAuthEnvelope(input.auth_envelope, "kv.read");
    const payload = decryptWithPrivateKey<ReadEnvelopePayload>({
      privateKeyPem: config.authaiPrivateKeyPem,
      envelope: input.query_envelope,
      expectedKeyId: config.authaiKeyId,
    });

    if (payload.v !== "ksp1" || payload.type !== "kv.read") {
      throw new ValidationError("Invalid kv.read payload", { error_code: "payload_invalid" });
    }
    const namespace = normalizeNamespace(payload.namespace);
    if (!Array.isArray(payload.keys) || payload.keys.length === 0) {
      throw new ValidationError("kv.read requires at least one key", { error_code: "payload_invalid" });
    }

    const normalizedKeys = payload.keys.map((key) => normalizeRecordKey(key));
    const rows = await this.repo.withTransaction(async (tx) => {
      const found = await this.repo.findKvRecords(tx, {
        clientUuid: client.client_uuid,
        namespace,
        keys: normalizedKeys,
      });
      await this.repo.markKvRead(tx, {
        clientUuid: client.client_uuid,
        namespace,
        keys: normalizedKeys,
      });
      await this.repo.appendAuditEvent(tx, {
        clientUuid: client.client_uuid,
        action: "kv.read",
        status: "success",
        requestId: auth.request_id,
        metadata: {
          namespace,
          requested_keys: normalizedKeys,
          returned_keys: found.map((item) => item.record_key),
        },
      });
      return found;
    });

    const resultItems = Object.fromEntries(
      rows.map((row) => {
        const dek = decryptWithAes256Gcm({
          ciphertext: row.wrapped_dek,
          key: config.masterKey,
          iv: row.wrapped_dek_iv,
          tag: row.wrapped_dek_tag,
        });
        const plaintext = decryptWithAes256Gcm({
          ciphertext: row.ciphertext,
          key: dek,
          iv: row.cipher_iv,
          tag: row.cipher_tag,
        });
        return [row.record_key, JSON.parse(plaintext.toString("utf8"))];
      }),
    );

    const resultEnvelope = encryptForPublicKey({
      publicKeyPem: client.public_key_pem,
      keyId: client.key_id ?? undefined,
      payload: {
        v: "ksp1",
        type: "kv.read.result",
        namespace,
        items: resultItems,
      },
    });

    const challenge = await this.issueChallenge(client, auth.request_id, {
      source: "kv.read",
      namespace,
    });

    return {
      ok: true,
      client_uuid: client.client_uuid,
      request_id: auth.request_id,
      namespace,
      returned_keys: Object.keys(resultItems),
      result_envelope_for_client: resultEnvelope,
      authai_public_key: this.getAuthaiPublicKey(),
      next_challenge_for_client: challenge.challenge_for_client,
      next_challenge_id: challenge.challenge_id,
      next_challenge_expires_at: challenge.expires_at,
    };
  }
}
