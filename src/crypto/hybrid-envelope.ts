import {
  constants,
  createPrivateKey,
  createPublicKey,
  publicEncrypt,
  privateDecrypt,
} from "node:crypto";
import { ValidationError } from "../utils/errors";
import { encodeBase64Url } from "./base64url";
import {
  createSha256Fingerprint,
  decryptWithAes256Gcm,
  encryptWithAes256Gcm,
  generateDataEncryptionKey,
} from "./master-key";

export type HybridEnvelope = {
  v: "ksp1";
  alg: "RSA-OAEP-256";
  enc: "A256GCM";
  key_id?: string;
  encrypted_key: string;
  iv: string;
  ciphertext: string;
  tag: string;
  aad?: string;
};

function decodeBase64Url(input: string, fieldName: string): Buffer {
  const normalized = input.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized) {
    throw new ValidationError(`${fieldName} is required`);
  }
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  try {
    return Buffer.from(`${normalized}${padding}`, "base64");
  } catch {
    throw new ValidationError(`${fieldName} must be base64url`);
  }
}

function normalizeEnvelope(input: unknown): HybridEnvelope {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Envelope must be an object");
  }
  const record = input as Record<string, unknown>;
  return {
    v: record.v === "ksp1" ? "ksp1" : "ksp1",
    alg: "RSA-OAEP-256",
    enc: "A256GCM",
    key_id: typeof record.key_id === "string" ? record.key_id.trim() : undefined,
    encrypted_key:
      typeof record.encrypted_key === "string" ? record.encrypted_key.trim() : "",
    iv: typeof record.iv === "string" ? record.iv.trim() : "",
    ciphertext: typeof record.ciphertext === "string" ? record.ciphertext.trim() : "",
    tag: typeof record.tag === "string" ? record.tag.trim() : "",
    aad: typeof record.aad === "string" && record.aad.trim() ? record.aad.trim() : undefined,
  };
}

export function getPublicKeyInfo(input: { publicKeyPem: string; keyId: string }) {
  const publicKey = createPublicKey(input.publicKeyPem);
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  return {
    algorithm: "RSA-OAEP-256/A256GCM",
    key_id: input.keyId,
    public_key_pem: input.publicKeyPem,
    public_key_fingerprint: createSha256Fingerprint(publicKeyDer),
  };
}

export function encryptForPublicKey(input: {
  publicKeyPem: string;
  payload: unknown;
  keyId?: string;
  aad?: Record<string, unknown> | string;
}): HybridEnvelope {
  const publicKey = createPublicKey(input.publicKeyPem);
  if (publicKey.asymmetricKeyType !== "rsa") {
    throw new ValidationError("Only RSA public keys are supported");
  }
  const payloadBytes = Buffer.from(JSON.stringify(input.payload), "utf8");
  const aadBytes =
    typeof input.aad === "string"
      ? Buffer.from(input.aad, "utf8")
      : input.aad
        ? Buffer.from(JSON.stringify(input.aad), "utf8")
        : undefined;
  const contentKey = generateDataEncryptionKey();
  const encryptedPayload = encryptWithAes256Gcm({
    plaintext: payloadBytes,
    key: contentKey,
    aad: aadBytes,
  });
  const encryptedKey = publicEncrypt(
    {
      key: publicKey,
      oaepHash: "sha256",
      padding: constants.RSA_PKCS1_OAEP_PADDING,
    },
    contentKey,
  );

  return {
    v: "ksp1",
    alg: "RSA-OAEP-256",
    enc: "A256GCM",
    key_id: input.keyId,
    encrypted_key: encodeBase64Url(encryptedKey),
    iv: encodeBase64Url(encryptedPayload.iv),
    ciphertext: encodeBase64Url(encryptedPayload.ciphertext),
    tag: encodeBase64Url(encryptedPayload.tag),
    aad: aadBytes ? encodeBase64Url(aadBytes) : undefined,
  };
}

export function decryptWithPrivateKey<T = unknown>(input: {
  privateKeyPem: string;
  envelope: unknown;
  expectedKeyId?: string;
}): T {
  const envelope = normalizeEnvelope(input.envelope);
  if (input.expectedKeyId && envelope.key_id && envelope.key_id !== input.expectedKeyId) {
    throw new ValidationError("Envelope key_id does not match the active server key");
  }

  const encryptedKey = decodeBase64Url(envelope.encrypted_key, "encrypted_key");
  const iv = decodeBase64Url(envelope.iv, "iv");
  const ciphertext = decodeBase64Url(envelope.ciphertext, "ciphertext");
  const tag = decodeBase64Url(envelope.tag, "tag");
  const aad = envelope.aad ? decodeBase64Url(envelope.aad, "aad") : undefined;

  let contentKey: Buffer;
  try {
    contentKey = privateDecrypt(
      {
        key: createPrivateKey(input.privateKeyPem),
        oaepHash: "sha256",
        padding: constants.RSA_PKCS1_OAEP_PADDING,
      },
      encryptedKey,
    );
  } catch (error) {
    throw new ValidationError("Failed to decrypt encrypted_key", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  if (contentKey.length !== 32) {
    throw new ValidationError("Decrypted content key must be 32 bytes");
  }

  try {
    const payloadBytes = decryptWithAes256Gcm({
      ciphertext,
      key: contentKey,
      iv,
      tag,
      aad,
    });
    return JSON.parse(payloadBytes.toString("utf8")) as T;
  } catch (error) {
    throw new ValidationError("Failed to decrypt envelope payload", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
