import { createPublicKey } from "node:crypto";
import config from "../config";

export type JwksResponse = {
  keys: Array<{
    kty: "RSA";
    use: "sig";
    alg: "RS256";
    kid: string;
    n: string;
    e: string;
  }>;
};

function rsaPublicKeyToJwk(publicKeyPem: string, keyId: string): JwksResponse["keys"][number] {
  const publicKey = createPublicKey(publicKeyPem);
  const jwk = publicKey.export({ format: "jwk" }) as { n?: string; e?: string };
  if (!jwk.n || !jwk.e) {
    throw new Error("Unable to export RSA public key as JWK");
  }
  return {
    kty: "RSA",
    use: "sig",
    alg: "RS256",
    kid: keyId,
    n: jwk.n,
    e: jwk.e,
  };
}

export function getCapabilityGrantJwks(): JwksResponse {
  return {
    keys: [rsaPublicKeyToJwk(config.authaiPublicKeyPem, config.authaiKeyId)],
  };
}

export function getIssuerMetadata(baseUrl: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  return {
    issuer: "cnothing",
    jwks_uri: `${normalizedBase}/v2/jwks`,
    grant_signing_alg: "RS256",
    grant_ttl_seconds: 120,
  };
}
