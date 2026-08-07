import type { JsonObject } from "./platform.entity";
import type { OAuthProviderRecord } from "./oauth.entity";

export type DiscoveredOAuthProvider = {
  issuer: string;
  authorization_url: string;
  token_url: string;
  userinfo_url: string | null;
  jwks_url: string | null;
  revoke_url: string | null;
  scopes_supported: string[];
};

type OpenIdDiscoveryDocument = {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
};

function normalizeDiscoveryUrl(input: { discovery_url?: string; issuer?: string }): string {
  const discoveryUrl = input.discovery_url?.trim();
  if (discoveryUrl) {
    if (discoveryUrl.includes("/.well-known/openid-configuration")) {
      return discoveryUrl;
    }
    return `${discoveryUrl.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  }

  const issuer = input.issuer?.trim();
  if (!issuer) {
    throw new Error("discovery_url or issuer is required");
  }
  return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

export async function discoverOAuthProvider(input: {
  discovery_url?: string;
  issuer?: string;
}): Promise<DiscoveredOAuthProvider> {
  const discoveryEndpoint = normalizeDiscoveryUrl(input);
  const response = await fetch(discoveryEndpoint);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed (${response.status}) for ${discoveryEndpoint}`);
  }

  const doc = (await response.json()) as OpenIdDiscoveryDocument;
  const issuer = String(doc.issuer ?? input.issuer ?? "").trim();
  const authorizationUrl = String(doc.authorization_endpoint ?? "").trim();
  const tokenUrl = String(doc.token_endpoint ?? "").trim();

  if (!issuer || !authorizationUrl || !tokenUrl) {
    throw new Error("OIDC discovery document missing issuer, authorization_endpoint, or token_endpoint");
  }

  return {
    issuer,
    authorization_url: authorizationUrl,
    token_url: tokenUrl,
    userinfo_url: doc.userinfo_endpoint ? String(doc.userinfo_endpoint) : null,
    jwks_url: doc.jwks_uri ? String(doc.jwks_uri) : null,
    revoke_url: doc.revocation_endpoint ? String(doc.revocation_endpoint) : null,
    scopes_supported: Array.isArray(doc.scopes_supported)
      ? doc.scopes_supported.map(String)
      : [],
  };
}

export function mergeDiscoveredProviderInput(input: {
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
    return Promise.resolve({
      ...input,
      auth_type: input.auth_type ?? "oauth2",
      issuer: input.issuer ?? null,
      discovery_url: input.discovery_url ?? null,
    });
  }

  return discoverOAuthProvider({
    discovery_url: input.discovery_url,
    issuer: input.issuer,
  }).then((discovered) => {
    const discoveryUrl = input.discovery_url?.trim()
      ? normalizeDiscoveryUrl({ discovery_url: input.discovery_url })
      : normalizeDiscoveryUrl({ issuer: discovered.issuer });

    const supportedScopes =
      input.supported_scopes && input.supported_scopes.length > 0
        ? input.supported_scopes
        : discovered.scopes_supported;

    return {
      slug: input.slug,
      display_name: input.display_name,
      auth_type: input.auth_type ?? "oidc",
      issuer: discovered.issuer,
      discovery_url: discoveryUrl,
      authorization_url: input.authorization_url ?? discovered.authorization_url,
      token_url: input.token_url ?? discovered.token_url,
      userinfo_url: input.userinfo_url ?? discovered.userinfo_url ?? undefined,
      revoke_url: input.revoke_url ?? discovered.revoke_url ?? undefined,
      jwks_url: input.jwks_url ?? discovered.jwks_url ?? undefined,
      client_id: input.client_id,
      client_secret: input.client_secret,
      default_scopes: input.default_scopes,
      supported_scopes: supportedScopes,
      pkce_required: input.pkce_required,
      token_auth_method: input.token_auth_method,
      metadata: input.metadata,
    };
  });
}
