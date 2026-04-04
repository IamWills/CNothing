import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const AES_256_GCM = "aes-256-gcm";

export type WrappedCiphertext = {
  algorithm: "AES-256-GCM";
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
};

function ensureMasterKey(key: Buffer): void {
  if (key.length !== 32) {
    throw new Error("Master key must be exactly 32 bytes.");
  }
}

export function encryptWithAes256Gcm(input: {
  plaintext: Buffer;
  key: Buffer;
  aad?: Buffer;
}): WrappedCiphertext {
  ensureMasterKey(input.key);
  const iv = randomBytes(GCM_IV_LENGTH);
  const cipher = createCipheriv(AES_256_GCM, input.key, iv, { authTagLength: GCM_TAG_LENGTH });
  if (input.aad) {
    cipher.setAAD(input.aad);
  }
  const ciphertext = Buffer.concat([cipher.update(input.plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    algorithm: "AES-256-GCM",
    ciphertext,
    iv,
    tag,
  };
}

export function decryptWithAes256Gcm(input: {
  ciphertext: Buffer;
  key: Buffer;
  iv: Buffer;
  tag: Buffer;
  aad?: Buffer;
}): Buffer {
  ensureMasterKey(input.key);
  const decipher = createDecipheriv(AES_256_GCM, input.key, input.iv, { authTagLength: GCM_TAG_LENGTH });
  if (input.aad) {
    decipher.setAAD(input.aad);
  }
  decipher.setAuthTag(input.tag);
  return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]);
}

export function createSha256Fingerprint(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function generateDataEncryptionKey(): Buffer {
  return randomBytes(32);
}
