import config from "../config";
import {
  createSha256Fingerprint,
  decryptWithAes256Gcm,
  encryptWithAes256Gcm,
  generateDataEncryptionKey,
} from "../crypto/master-key";
import type { KvRecord } from "./key-service.entity";

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

export function encryptJsonValue(value: unknown): StoredValueShape {
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

export function decryptKvRecordValue(record: StoredValueShape): unknown {
  const dek = decryptWithAes256Gcm({
    ciphertext: record.wrapped_dek,
    key: config.masterKey,
    iv: record.wrapped_dek_iv,
    tag: record.wrapped_dek_tag,
  });
  const plaintext = decryptWithAes256Gcm({
    ciphertext: record.ciphertext,
    key: dek,
    iv: record.cipher_iv,
    tag: record.cipher_tag,
  });
  return JSON.parse(plaintext.toString("utf8"));
}
