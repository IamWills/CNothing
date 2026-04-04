import {
  createPublicKey,
  publicEncrypt,
  constants,
  randomBytes,
} from "node:crypto";
import { encodeBase64Url } from "./base64url";
import { createSha256Fingerprint, encryptWithAes256Gcm } from "./master-key";
import { ValidationError } from "../utils/errors";

export type ProviderEnvelope = {
  v: "ks1";
  alg: "RSA-OAEP-256";
  enc: "A256GCM";
  provider: string;
  name: string;
  issued_at: string;
  key_id?: string;
  public_key_fingerprint: string;
  aad: string;
  encrypted_key: string;
  iv: string;
  ciphertext: string;
  tag: string;
};

export type IssueEnvelopeResult = {
  token: string;
  envelope: ProviderEnvelope;
};

export function issueEnvelopeForRsaPublicKey(input: {
  provider: string;
  name: string;
  plaintextSecret: string;
  servicePublicKeyPem: string;
  keyId?: string;
}): IssueEnvelopeResult {
  const publicKeyPem = input.servicePublicKeyPem.trim();
  if (!publicKeyPem) {
    throw new ValidationError("service_public_key_pem is required");
  }

  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch (error) {
    throw new ValidationError("Invalid service public key PEM", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  if (publicKey.asymmetricKeyType !== "rsa") {
    throw new ValidationError("Only RSA public keys are currently supported");
  }

  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const publicKeyFingerprint = createSha256Fingerprint(publicKeyDer);
  const issuedAt = new Date().toISOString();

  const aadPayload = {
    v: "ks1",
    provider: input.provider,
    name: input.name,
    issued_at: issuedAt,
    key_id: input.keyId ?? null,
    public_key_fingerprint: publicKeyFingerprint,
  };
  const aadBytes = Buffer.from(JSON.stringify(aadPayload), "utf8");

  const contentKey = randomBytes(32);
  const secretBytes = Buffer.from(input.plaintextSecret, "utf8");
  const sealedSecret = encryptWithAes256Gcm({
    plaintext: secretBytes,
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

  const envelope: ProviderEnvelope = {
    v: "ks1",
    alg: "RSA-OAEP-256",
    enc: "A256GCM",
    provider: input.provider,
    name: input.name,
    issued_at: issuedAt,
    key_id: input.keyId,
    public_key_fingerprint: publicKeyFingerprint,
    aad: encodeBase64Url(aadBytes),
    encrypted_key: encodeBase64Url(encryptedKey),
    iv: encodeBase64Url(sealedSecret.iv),
    ciphertext: encodeBase64Url(sealedSecret.ciphertext),
    tag: encodeBase64Url(sealedSecret.tag),
  };

  return {
    envelope,
    token: `ks1.${encodeBase64Url(JSON.stringify(envelope))}`,
  };
}
