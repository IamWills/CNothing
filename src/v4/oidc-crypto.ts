import { createHash, createPublicKey, createVerify, randomBytes } from "node:crypto";
import { encodeBase64Url } from "../crypto/base64url";
import { ValidationError } from "../utils/errors";
import { assertSafeMetadataUrl, fetchPublicJsonDocument } from "./safe-fetch";

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
  const document = await fetchPublicJsonDocument<OpenIdConfiguration>(
    `${normalizedIssuer}/.well-known/openid-configuration`,
    { label: "issuer" },
  );

  if (document.issuer?.replace(/\/+$/, "") !== normalizedIssuer) {
    throw new ValidationError("Discovery document issuer does not match the configured issuer", {
      error_code: "discovery_issuer_mismatch",
    });
  }
  // jwks_uri decides which keys can sign an accepted id_token, so it must be
  // validated before it is ever fetched.
  await assertSafeMetadataUrl(document.jwks_uri, "jwks_uri");
  await assertSafeMetadataUrl(document.authorization_endpoint, "authorization_endpoint");
  await assertSafeMetadataUrl(document.token_endpoint, "token_endpoint");

  return document;
}

export async function fetchJwks(jwksUri: string): Promise<JwkKey[]> {
  const payload = await fetchPublicJsonDocument<{ keys?: JwkKey[] }>(jwksUri, {
    label: "jwks_uri",
  });
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
