import { createSign, createVerify, randomUUID } from "node:crypto";
import { encodeBase64Url } from "../crypto/base64url";
import type { CapabilityGrantPayload } from "./v2.entity";

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function encodeJsonBase64Url(value: unknown): string {
  return encodeBase64Url(JSON.stringify(value));
}

export function signCapabilityGrant(input: {
  privateKeyPem: string;
  keyId: string;
  payload: Omit<CapabilityGrantPayload, "iat" | "jti"> & { iat?: number; jti?: string };
  ttlSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? 120;
  const payload: CapabilityGrantPayload = {
    ...input.payload,
    iat: input.payload.iat ?? now,
    exp: input.payload.exp ?? now + ttl,
    jti: input.payload.jti ?? randomUUID(),
  };

  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: input.keyId,
  };

  const signingInput = `${encodeJsonBase64Url(header)}.${encodeJsonBase64Url(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = encodeBase64Url(signer.sign(input.privateKeyPem));
  return `${signingInput}.${signature}`;
}

export function verifyCapabilityGrant(input: {
  token: string;
  publicKeyPem: string;
  expectedAudience?: string;
  expectedIssuer?: string;
}): CapabilityGrantPayload {
  const parts = input.token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid grant token format");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();

  const signatureValid = verifier.verify(input.publicKeyPem, decodeBase64Url(encodedSignature));
  if (!signatureValid) {
    throw new Error("Invalid grant token signature");
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload).toString("utf8")) as CapabilityGrantPayload;
  const now = Math.floor(Date.now() / 1000);

  if (input.expectedIssuer && payload.iss !== input.expectedIssuer) {
    throw new Error("Grant token issuer mismatch");
  }
  if (input.expectedAudience && payload.aud !== input.expectedAudience) {
    throw new Error("Grant token audience mismatch");
  }
  if (!payload.exp || payload.exp <= now) {
    throw new Error("Grant token expired");
  }
  if (!payload.capability || !payload.user || !payload.sub) {
    throw new Error("Grant token missing required claims");
  }

  return payload;
}
