import config from "../config";
import { decodeBase64Url } from "../crypto/hybrid-envelope";
import {
  decryptEnvelopePayloadWithContentKey,
  encryptForPublicKey,
  extractApiKeyEnvelope,
  unwrapEnvelopeContentKey,
  type HybridEnvelope,
} from "../crypto/hybrid-envelope";
import {
  createSha256Fingerprint,
  decryptWithAes256Gcm,
  encryptWithAes256Gcm,
  generateDataEncryptionKey,
} from "../crypto/master-key";
import type { JsonObject } from "./key-service.entity";
import type { KvRecord } from "./key-service.entity";

export const KSP1_ENVELOPE_CIPHER_ALG = "ksp1-envelope/A256GCM";

type StoredValueShape = Pick<
  KvRecord,
  | "cipher_alg"
  | "ciphertext"
  | "cipher_iv"
  | "cipher_tag"
  | "wrapped_dek_alg"
  | "wrapped_dek"
  | "wrapped_dek_iv"
  | "wrapped_dek_tag"
  | "value_fingerprint"
>;

export type PreparedKvStoredValue = StoredValueShape & {
  metadataPatch?: JsonObject;
};

function plaintextFingerprintBuffer(plaintext: unknown): Buffer {
  if (typeof plaintext === "string") {
    return Buffer.from(plaintext, "utf8");
  }
  return Buffer.from(JSON.stringify(plaintext ?? null), "utf8");
}

function decodeEnvelopeField(value: string, fieldName: string): Buffer {
  return decodeBase64Url(value, fieldName);
}

export function isKvKsp1EnvelopeRecord(record: Pick<KvRecord, "cipher_alg">): boolean {
  return record.cipher_alg === KSP1_ENVELOPE_CIPHER_ALG;
}

function encryptKsp1EnvelopeValue(input: {
  envelope: HybridEnvelope;
  authaiPrivateKeyPem: string;
  authaiKeyId?: string;
}): PreparedKvStoredValue {
  const contentKey = unwrapEnvelopeContentKey({
    privateKeyPem: input.authaiPrivateKeyPem,
    envelope: input.envelope,
    expectedKeyId: input.authaiKeyId,
  });

  const iv = decodeEnvelopeField(input.envelope.iv, "iv");
  const ciphertext = decodeEnvelopeField(input.envelope.ciphertext, "ciphertext");
  const tag = decodeEnvelopeField(input.envelope.tag, "tag");
  const aad = input.envelope.aad ? decodeEnvelopeField(input.envelope.aad, "aad") : undefined;

  const plaintext = decryptEnvelopePayloadWithContentKey({
    contentKey,
    iv,
    ciphertext,
    tag,
    aad,
  });

  const wrappedContentKey = encryptWithAes256Gcm({
    plaintext: contentKey,
    key: config.masterKey,
  });

  const metadataPatch: JsonObject = {
    cnothing_value_format: "ksp1_envelope",
  };
  if (input.envelope.key_id) {
    metadataPatch.envelope_key_id = input.envelope.key_id;
  }
  if (input.envelope.aad) {
    metadataPatch.envelope_aad = input.envelope.aad;
  }

  return {
    cipher_alg: KSP1_ENVELOPE_CIPHER_ALG,
    ciphertext,
    cipher_iv: iv,
    cipher_tag: tag,
    wrapped_dek_alg: wrappedContentKey.algorithm,
    wrapped_dek: wrappedContentKey.ciphertext,
    wrapped_dek_iv: wrappedContentKey.iv,
    wrapped_dek_tag: wrappedContentKey.tag,
    value_fingerprint: createSha256Fingerprint(plaintextFingerprintBuffer(plaintext)),
    metadataPatch,
  };
}

export function prepareKvStoredValue(input: {
  value: unknown;
  authaiPrivateKeyPem: string;
  authaiKeyId?: string;
}): PreparedKvStoredValue {
  const envelope = extractApiKeyEnvelope(input.value);
  if (!envelope) {
    return encryptJsonValue(input.value);
  }
  return encryptKsp1EnvelopeValue({
    envelope,
    authaiPrivateKeyPem: input.authaiPrivateKeyPem,
    authaiKeyId: input.authaiKeyId,
  });
}

export function encryptJsonValue(value: unknown): PreparedKvStoredValue {
  const plaintext = Buffer.from(JSON.stringify(value ?? null), "utf8");
  const dek = generateDataEncryptionKey();
  const encryptedValue = encryptWithAes256Gcm({
    plaintext,
    key: dek,
  });
  const wrappedDek = encryptWithAes256Gcm({
    plaintext: dek,
    key: config.masterKey,
  });

  return {
    cipher_alg: encryptedValue.algorithm,
    ciphertext: encryptedValue.ciphertext,
    cipher_iv: encryptedValue.iv,
    cipher_tag: encryptedValue.tag,
    wrapped_dek_alg: wrappedDek.algorithm,
    wrapped_dek: wrappedDek.ciphertext,
    wrapped_dek_iv: wrappedDek.iv,
    wrapped_dek_tag: wrappedDek.tag,
    value_fingerprint: createSha256Fingerprint(plaintext),
  };
}

function unwrapStoredKsp1ContentKey(record: StoredValueShape): Buffer {
  return decryptWithAes256Gcm({
    ciphertext: record.wrapped_dek,
    key: config.masterKey,
    iv: record.wrapped_dek_iv,
    tag: record.wrapped_dek_tag,
  });
}

function decryptStoredKsp1EnvelopePlaintext(record: StoredValueShape, metadata: JsonObject): unknown {
  const contentKey = unwrapStoredKsp1ContentKey(record);
  const aad =
    typeof metadata.envelope_aad === "string" && metadata.envelope_aad.trim()
      ? decodeEnvelopeField(metadata.envelope_aad, "envelope_aad")
      : undefined;

  return decryptEnvelopePayloadWithContentKey({
    contentKey,
    iv: record.cipher_iv,
    ciphertext: record.ciphertext,
    tag: record.cipher_tag,
    aad,
  });
}

export function readKvRecordValue(input: {
  record: StoredValueShape & { metadata?: JsonObject };
  recipientPublicKeyPem?: string;
}): unknown {
  if (!isKvKsp1EnvelopeRecord(input.record)) {
    return decryptKvRecordValue(input.record);
  }

  const plaintext = decryptStoredKsp1EnvelopePlaintext(input.record, input.record.metadata ?? {});
  if (!input.recipientPublicKeyPem) {
    return plaintext;
  }

  const envelopeKeyId =
    typeof input.record.metadata?.envelope_key_id === "string"
      ? input.record.metadata.envelope_key_id
      : undefined;

  return encryptForPublicKey({
    publicKeyPem: input.recipientPublicKeyPem,
    keyId: envelopeKeyId,
    payload: plaintext,
  });
}

export function decryptKvRecordValue(record: StoredValueShape & { metadata?: JsonObject }): unknown {
  return readKvRecordValue({ record });
}
