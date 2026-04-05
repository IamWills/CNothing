import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import {
  decryptWithPrivateKey,
  encryptForPublicKey,
  getPublicKeyInfo,
  type HybridEnvelope,
} from "../crypto/hybrid-envelope";
import type {
  AuthEnvelopePayload,
  AuthaiPublicKey,
  ClientSealedValue,
  ChallengePayload,
  JsonObject,
  JsonValue,
  ReadEnvelopePayload,
  ReadResultPayload,
  SaveEnvelopePayload,
} from "./entity";

export function generateClientKeyPair(input?: {
  modulusLength?: number;
  keyId?: string;
}): {
  privateKeyPem: string;
  publicKeyPem: string;
  publicKeyInfo: ReturnType<typeof getPublicKeyInfo>;
} {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: input?.modulusLength ?? 4096,
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });

  return {
    privateKeyPem: pair.privateKey,
    publicKeyPem: pair.publicKey,
    publicKeyInfo: getPublicKeyInfo({
      publicKeyPem: pair.publicKey,
      keyId: input?.keyId ?? "client",
    }),
  };
}

export function derivePublicKeyPem(privateKeyPem: string): string {
  const privateKey = createPrivateKey(privateKeyPem);
  return createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
}

export function decryptChallengeForClient(input: {
  clientPrivateKeyPem: string;
  envelope: HybridEnvelope;
  expectedKeyId?: string;
}): ChallengePayload {
  return decryptWithPrivateKey<ChallengePayload>({
    privateKeyPem: input.clientPrivateKeyPem,
    envelope: input.envelope,
    expectedKeyId: input.expectedKeyId,
  });
}

export function decryptReadResultForClient(input: {
  clientPrivateKeyPem: string;
  envelope: HybridEnvelope;
  expectedKeyId?: string;
}): ReadResultPayload {
  return decryptWithPrivateKey<ReadResultPayload>({
    privateKeyPem: input.clientPrivateKeyPem,
    envelope: input.envelope,
    expectedKeyId: input.expectedKeyId,
  });
}

export function buildAuthEnvelope(input: {
  authaiPublicKey: AuthaiPublicKey;
  payload: AuthEnvelopePayload;
}): HybridEnvelope {
  return encryptForPublicKey({
    publicKeyPem: input.authaiPublicKey.public_key_pem,
    keyId: input.authaiPublicKey.key_id,
    payload: input.payload,
  });
}

export function buildSaveEnvelope(input: {
  authaiPublicKey: AuthaiPublicKey;
  payload: SaveEnvelopePayload;
}): HybridEnvelope {
  return encryptForPublicKey({
    publicKeyPem: input.authaiPublicKey.public_key_pem,
    keyId: input.authaiPublicKey.key_id,
    payload: input.payload,
  });
}

export function buildReadEnvelope(input: {
  authaiPublicKey: AuthaiPublicKey;
  payload: ReadEnvelopePayload;
}): HybridEnvelope {
  return encryptForPublicKey({
    publicKeyPem: input.authaiPublicKey.public_key_pem,
    keyId: input.authaiPublicKey.key_id,
    payload: input.payload,
  });
}

export function normalizeMetadata(input: JsonObject | undefined): JsonObject | undefined {
  if (!input) {
    return undefined;
  }
  return input;
}

export function sealValueForClient(input: {
  clientPublicKeyPem: string;
  keyId?: string;
  value: JsonValue;
}): ClientSealedValue {
  return {
    v: "cnsk1",
    kind: "client-sealed-json",
    envelope: encryptForPublicKey({
      publicKeyPem: input.clientPublicKeyPem,
      keyId: input.keyId,
      payload: input.value,
    }),
  };
}

export function unsealValueForClient(input: {
  clientPrivateKeyPem: string;
  sealedValue: ClientSealedValue;
  expectedKeyId?: string;
}): JsonValue {
  return decryptWithPrivateKey<JsonValue>({
    privateKeyPem: input.clientPrivateKeyPem,
    envelope: input.sealedValue.envelope,
    expectedKeyId: input.expectedKeyId,
  });
}

export function isClientSealedValue(value: unknown): value is ClientSealedValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    record.v === "cnsk1" &&
    record.kind === "client-sealed-json" &&
    Boolean(record.envelope && typeof record.envelope === "object")
  );
}
