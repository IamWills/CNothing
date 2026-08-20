import { AppError, ValidationError } from "../utils/errors";
import { assertSafeMetadataUrl, fetchPublicJsonDocument } from "./safe-fetch";
import type { JsonObject } from "./platform.entity";
import type { OAuthProviderRecord } from "./oauth.entity";

export type DiscoveredOAuthProvider = {
  issuer: string;
  discovery_url: string;
  authorization_url: string;
  token_url: string;
  userinfo_url: string | null;
  jwks_url: string | null;
  revoke_url: string | null;
  registration_url: string | null;
  scopes_supported: string[];
};

type OpenIdDiscoveryDocument = {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  revocation_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
};

function wellKnownDiscoveryUrls(input: { discovery_url?: string; issuer?: string }): string[] {
  const discoveryUrl = input.discovery_url?.trim();
  if (discoveryUrl) {
    if (
      discoveryUrl.includes("/.well-known/openid-configuration") ||
      discoveryUrl.includes("/.well-known/oauth-authorization-server")
    ) {
      return [discoveryUrl];
    }
    const base = discoveryUrl.replace(/\/+$/, "");
    return [
      `${base}/.well-known/openid-configuration`,
      `${base}/.well-known/oauth-authorization-server`,
    ];
  }

  const issuer = input.issuer?.trim();
  if (!issuer) {
    throw new Error("discovery_url or issuer is required");
  }
  const base = issuer.replace(/\/+$/, "");
  return [
    `${base}/.well-known/openid-configuration`,
    `${base}/.well-known/oauth-authorization-server`,
  ];
}

function isMissingMetadataDocument(error: unknown): boolean {
  if (!(error instanceof AppError) || !error.details || typeof error.details !== "object") {
    return false;
  }
  const code = (error.details as { error_code?: string }).error_code;
  return code === "metadata_fetch_failed";
}

function sameIssuer(left: string, right: string): boolean {
  return left.replace(/\/+$/, "") === right.replace(/\/+$/, "");
}

/**
 * Every endpoint in the response is attacker-controlled if the issuer is
 * hostile, so each one is re-validated before it can be persisted and used.
 */
async function assertSafeEndpoint(value: string | undefined, label: string): Promise<string | null> {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  await assertSafeMetadataUrl(trimmed, label);
  return trimmed;
}

export async function discoverOAuthProvider(input: {
  discovery_url?: string;
  issuer?: string;
}): Promise<DiscoveredOAuthProvider> {
  const urls = wellKnownDiscoveryUrls(input);
  let lastError: unknown;
  for (const [index, discoveryEndpoint] of urls.entries()) {
    try {
      return await fetchDiscoveryDocument(discoveryEndpoint, input);
    } catch (error) {
      lastError = error;
      const canFallback =
        index < urls.length - 1 && isMissingMetadataDocument(error);
      if (!canFallback) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Discovery failed");
}

async function fetchDiscoveryDocument(
  discoveryEndpoint: string,
  input: { issuer?: string },
): Promise<DiscoveredOAuthProvider> {
  const doc = await fetchPublicJsonDocument<OpenIdDiscoveryDocument>(discoveryEndpoint, {
    label: "discovery_url",
  });

  const issuer = String(doc.issuer ?? input.issuer ?? "").trim();
  const authorizationUrl = String(doc.authorization_endpoint ?? "").trim();
  const tokenUrl = String(doc.token_endpoint ?? "").trim();

  if (!issuer || !authorizationUrl || !tokenUrl) {
    throw new ValidationError(
      "Discovery document is missing issuer, authorization_endpoint, or token_endpoint",
      { error_code: "discovery_document_incomplete" },
    );
  }

  // OpenID Connect Discovery requires the advertised issuer to match the one
  // that was looked up; otherwise a provider could impersonate another.
  const requestedIssuer = input.issuer?.trim();
  if (requestedIssuer && !sameIssuer(issuer, requestedIssuer)) {
    throw new ValidationError("Discovery document issuer does not match the requested issuer", {
      error_code: "discovery_issuer_mismatch",
    });
  }

  await assertSafeMetadataUrl(issuer, "issuer");

  let registrationUrl: string | null = null;
  try {
    registrationUrl = await assertSafeEndpoint(doc.registration_endpoint, "registration_endpoint");
  } catch {
    registrationUrl = null;
  }

  return {
    issuer,
    discovery_url: discoveryEndpoint,
    authorization_url: (await assertSafeEndpoint(authorizationUrl, "authorization_url"))!,
    token_url: (await assertSafeEndpoint(tokenUrl, "token_url"))!,
    userinfo_url: await assertSafeEndpoint(doc.userinfo_endpoint, "userinfo_url"),
    jwks_url: await assertSafeEndpoint(doc.jwks_uri, "jwks_url"),
    revoke_url: await assertSafeEndpoint(doc.revocation_endpoint, "revoke_url"),
    registration_url: registrationUrl,
    scopes_supported: Array.isArray(doc.scopes_supported)
      ? doc.scopes_supported.map(String)
      : [],
  };
}

/**
 * Manually entered endpoints get the same treatment as discovered ones: an
 * operator typo (or a hostile tenant admin) must not be able to point the
 * broker at a loopback or metadata address.
 */
async function assertSafeProviderEndpoints<
  T extends {
    issuer?: string | null;
    discovery_url?: string | null;
    authorization_url?: string;
    token_url?: string;
    userinfo_url?: string;
    revoke_url?: string;
    jwks_url?: string;
  },
>(provider: T): Promise<T> {
  const fields: Array<[string, string | null | undefined]> = [
    ["issuer", provider.issuer],
    ["discovery_url", provider.discovery_url],
    ["authorization_url", provider.authorization_url],
    ["token_url", provider.token_url],
    ["userinfo_url", provider.userinfo_url],
    ["revoke_url", provider.revoke_url],
    ["jwks_url", provider.jwks_url],
  ];

  for (const [label, value] of fields) {
    if (value?.trim()) {
      await assertSafeMetadataUrl(value, label);
    }
  }
  return provider;
}

export async function mergeDiscoveredProviderInput(input: {
  slug: string;
  display_name: string;
  auth_type?: "oauth2" | "oidc";
  discovery_url?: string;
  issuer?: string;
  authorization_url?: string;
  token_url?: string;
  userinfo_url?: string;
  revoke_url?: string;
  jwks_url?: string;
  client_id?: string;
  client_secret?: string;
  default_scopes?: string[];
  supported_scopes?: string[];
  pkce_required?: boolean;
  token_auth_method?: OAuthProviderRecord["token_auth_method"];
  metadata?: JsonObject;
}): Promise<{
  slug: string;
  display_name: string;
  auth_type: "oauth2" | "oidc";
  issuer: string | null;
  discovery_url: string | null;
  authorization_url?: string;
  token_url?: string;
  userinfo_url?: string;
  revoke_url?: string;
  jwks_url?: string;
  registration_url?: string | null;
  client_id?: string;
  client_secret?: string;
  default_scopes?: string[];
  supported_scopes?: string[];
  pkce_required?: boolean;
  token_auth_method?: OAuthProviderRecord["token_auth_method"];
  metadata?: JsonObject;
}> {
  const hasDiscovery = Boolean(input.discovery_url?.trim() || input.issuer?.trim());
  if (!hasDiscovery) {
    return assertSafeProviderEndpoints({
      ...input,
      auth_type: input.auth_type ?? "oauth2",
      issuer: input.issuer ?? null,
      discovery_url: input.discovery_url ?? null,
    });
  }

  const discovered = await discoverOAuthProvider({
    discovery_url: input.discovery_url,
    issuer: input.issuer,
  });

  const supportedScopes =
    input.supported_scopes && input.supported_scopes.length > 0
      ? input.supported_scopes
      : discovered.scopes_supported;

  // Operator-supplied endpoints win over discovered ones, so the merged result is
  // validated again rather than trusting the discovery pass alone.
  return assertSafeProviderEndpoints({
    slug: input.slug,
    display_name: input.display_name,
    auth_type: input.auth_type ?? "oidc",
    issuer: discovered.issuer,
    discovery_url: discovered.discovery_url,
    authorization_url: input.authorization_url ?? discovered.authorization_url,
    token_url: input.token_url ?? discovered.token_url,
    userinfo_url: input.userinfo_url ?? discovered.userinfo_url ?? undefined,
    revoke_url: input.revoke_url ?? discovered.revoke_url ?? undefined,
    jwks_url: input.jwks_url ?? discovered.jwks_url ?? undefined,
    registration_url: discovered.registration_url,
    client_id: input.client_id,
    client_secret: input.client_secret,
    default_scopes: input.default_scopes,
    supported_scopes: supportedScopes,
    pkce_required: input.pkce_required,
    token_auth_method: input.token_auth_method,
    metadata: input.metadata,
  });
}
