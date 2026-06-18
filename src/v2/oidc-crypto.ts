import { createHash, createPublicKey, createVerify, randomBytes } from "node:crypto";
import config from "../config";
import { encodeBase64Url } from "../crypto/base64url";
import { decryptWithAes256Gcm, encryptWithAes256Gcm } from "../crypto/master-key";

type OpenIdConfiguration = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

type JwkKey = {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
};

function decodeBase64UrlToBuffer(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

export async function fetchOpenIdConfiguration(issuer: string): Promise<OpenIdConfiguration> {
  const normalizedIssuer = issuer.replace(/\/+$/, "");
  const response = await fetch(`${normalizedIssuer}/.well-known/openid-configuration`);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed for ${issuer}: ${response.status}`);
  }
  return (await response.json()) as OpenIdConfiguration;
}

export async function fetchJwks(jwksUri: string): Promise<JwkKey[]> {
  const response = await fetch(jwksUri);
  if (!response.ok) {
    throw new Error(`JWKS fetch failed: ${response.status}`);
  }
  const payload = (await response.json()) as { keys?: JwkKey[] };
  return payload.keys ?? [];
}

function jwkToPem(key: JwkKey): string {
  if (key.kty !== "RSA" || !key.n || !key.e) {
    throw new Error("Unsupported JWK key type");
  }
  return createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" })
    .export({ type: "spki", format: "pem" })
    .toString();
}

export async function verifyOidcIdToken(input: {
  idToken: string;
  issuer: string;
  clientId: string;
  nonce: string;
}): Promise<Record<string, unknown>> {
  const parts = input.idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid id_token format");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(decodeBase64UrlToBuffer(encodedHeader).toString("utf8")) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(decodeBase64UrlToBuffer(encodedPayload).toString("utf8")) as Record<
    string,
    unknown
  >;

  if (header.alg !== "RS256") {
    throw new Error(`Unsupported id_token alg: ${header.alg ?? "unknown"}`);
  }

  const discovery = await fetchOpenIdConfiguration(input.issuer);
  const jwks = await fetchJwks(discovery.jwks_uri);
  const jwk = jwks.find((key) => key.kid === header.kid) ?? jwks.find((key) => key.use === "sig");
  if (!jwk) {
    throw new Error("No matching JWKS key for id_token");
  }

  const publicKeyPem = jwkToPem(jwk);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(signingInput);
  verifier.end();
  const valid = verifier.verify(publicKeyPem, decodeBase64UrlToBuffer(encodedSignature));
  if (!valid) {
    throw new Error("Invalid id_token signature");
  }

  const now = Math.floor(Date.now() / 1000);
  const iss = String(payload.iss ?? "");
  const aud = payload.aud;
  const exp = Number(payload.exp ?? 0);
  const tokenNonce = String(payload.nonce ?? "");

  if (iss.replace(/\/+$/, "") !== input.issuer.replace(/\/+$/, "")) {
    throw new Error("id_token issuer mismatch");
  }
  const audiences = Array.isArray(aud) ? aud.map(String) : [String(aud ?? "")];
  if (!audiences.includes(input.clientId)) {
    throw new Error("id_token audience mismatch");
  }
  if (!exp || exp <= now) {
    throw new Error("id_token expired");
  }
  if (tokenNonce !== input.nonce) {
    throw new Error("id_token nonce mismatch");
  }

  return payload;
}

export function encryptOidcClientSecret(secret: string): Buffer {
  const encrypted = encryptWithAes256Gcm({
    plaintext: Buffer.from(secret, "utf8"),
    key: config.masterKey,
  });
  return Buffer.concat([encrypted.iv, encrypted.tag, encrypted.ciphertext]);
}

export function decryptOidcClientSecret(payload: Buffer): string {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  return decryptWithAes256Gcm({
    ciphertext,
    iv,
    tag,
    key: config.masterKey,
  }).toString("utf8");
}

export function generateOidcState(): string {
  return encodeBase64Url(randomBytes(24));
}

export function generateOidcNonce(): string {
  return encodeBase64Url(randomBytes(24));
}

export function deriveUserIdFromClaims(providerName: string, claims: Record<string, unknown>): string {
  const email = typeof claims.email === "string" ? claims.email.trim() : "";
  if (email && claims.email_verified === true) {
    return email.toLowerCase();
  }
  const subject = String(claims.sub ?? "");
  return `oidc:${providerName}:${subject}`;
}

export function hashOidcState(state: string): string {
  return createHash("sha256").update(`oidc-state:${state}`).digest("hex");
}
