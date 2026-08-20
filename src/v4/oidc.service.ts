import { NotFoundError, ValidationError } from "../utils/errors";
import {
  createOidcState,
  createUserSession,
  consumeOidcState,
  upsertUserIdentity,
} from "./platform.repository";
import {
  createOAuthProvider,
  findLoginProviderBySlug,
  findOAuthProviderBySlug,
  getProviderClientSecret,
  listLoginProviders,
  setProviderLoginEnabled,
  updateOAuthProviderCredentials,
  updateOAuthProviderEndpoints,
} from "./oauth.repository";
import {
  deriveUserIdFromClaims,
  fetchOpenIdConfiguration,
  generateOidcNonce,
  generateOidcState,
  verifyOidcIdToken,
} from "./oidc-crypto";
import { generateUserSessionToken, hashSessionToken } from "./user-session";
import { buildUserSessionCookie } from "./session-cookie";
import config from "../config";
import type { OAuthProviderRecord } from "./oauth.entity";

const DEFAULT_LOGIN_SCOPES = ["openid", "profile", "email"];

/**
 * Login identity providers live in the canonical provider registry. This view keeps the
 * historical `/v4/auth/oidc/*` response shape so existing consoles keep working.
 */
export type OidcProviderPublicView = {
  id: string;
  name: string;
  display_name: string;
  issuer: string;
  scopes: string;
};

function toPublicView(provider: OAuthProviderRecord): OidcProviderPublicView {
  return {
    id: provider.id,
    name: provider.slug,
    display_name: provider.display_name,
    issuer: provider.issuer ?? "",
    scopes: (provider.default_scopes.length > 0 ? provider.default_scopes : DEFAULT_LOGIN_SCOPES).join(
      " ",
    ),
  };
}

function parseScopes(scopes?: string): string[] {
  const parsed = (scopes ?? "").split(/\s+/).filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_LOGIN_SCOPES;
}

/** An OIDC login flow needs an issuer to discover and a client to authenticate as. */
function requireLoginConfiguration(provider: OAuthProviderRecord): {
  issuer: string;
  clientId: string;
} {
  if (!provider.issuer?.trim()) {
    throw new ValidationError(`Provider ${provider.slug} has no issuer configured`, {
      error_code: "provider_issuer_missing",
    });
  }
  if (!provider.client_id?.trim()) {
    throw new ValidationError(`Provider ${provider.slug} has no client_id configured`, {
      error_code: "provider_unconfigured",
    });
  }
  return { issuer: provider.issuer.trim(), clientId: provider.client_id.trim() };
}

export class OidcService {
  /**
   * Registers (or upgrades) a provider as a console login identity provider. When the slug
   * already exists in the registry the existing entry is reused rather than duplicated.
   */
  async registerProvider(input: {
    name: string;
    display_name: string;
    issuer: string;
    client_id: string;
    client_secret: string;
    scopes?: string;
  }) {
    const discovery = await fetchOpenIdConfiguration(input.issuer);
    const issuer = input.issuer.replace(/\/+$/, "");
    const scopes = parseScopes(input.scopes);

    const existing = await findOAuthProviderBySlug(input.name);
    if (existing) {
      await updateOAuthProviderCredentials({
        id: existing.id,
        client_id: input.client_id,
        client_secret: input.client_secret,
      });
      await updateOAuthProviderEndpoints({
        id: existing.id,
        issuer,
        authorization_url: discovery.authorization_endpoint,
        token_url: discovery.token_endpoint,
        jwks_url: discovery.jwks_uri,
        default_scopes: scopes,
      });
      const enabled = await setProviderLoginEnabled(existing.id, true);
      return { ok: true as const, provider: toPublicView(enabled!) };
    }

    const provider = await createOAuthProvider({
      slug: input.name,
      display_name: input.display_name,
      auth_type: "oidc",
      issuer,
      authorization_url: discovery.authorization_endpoint,
      token_url: discovery.token_endpoint,
      jwks_url: discovery.jwks_uri,
      client_id: input.client_id,
      client_secret: input.client_secret,
      default_scopes: scopes,
      supported_scopes: scopes,
      login_enabled: true,
      source: "discovered",
      metadata: { login_provider: true },
    });
    return { ok: true as const, provider: toPublicView(provider) };
  }

  async listPublicProviders() {
    const providers = await listLoginProviders();
    return {
      ok: true as const,
      items: providers.filter((provider) => provider.issuer?.trim()).map(toPublicView),
    };
  }

  async startAuthorization(input: {
    providerName: string;
    apiBaseUrl: string;
    redirectAfter?: string;
  }) {
    const provider = await findLoginProviderBySlug(input.providerName);
    if (!provider) {
      throw new NotFoundError(`OIDC provider not found: ${input.providerName}`);
    }
    const { issuer, clientId } = requireLoginConfiguration(provider);

    const discovery = await fetchOpenIdConfiguration(issuer);
    const state = generateOidcState();
    const nonce = generateOidcNonce();
    const redirectUri = `${input.apiBaseUrl.replace(/\/+$/, "")}/v4/auth/oidc/${encodeURIComponent(provider.slug)}/callback`;

    await createOidcState({
      provider_id: provider.id,
      state,
      nonce,
      redirect_after: input.redirectAfter,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope: toPublicView(provider).scopes,
      redirect_uri: redirectUri,
      state,
      nonce,
    });

    return {
      ok: true as const,
      authorization_url: `${discovery.authorization_endpoint}?${params.toString()}`,
    };
  }

  async handleCallback(input: {
    providerName: string;
    code: string;
    state: string;
    apiBaseUrl: string;
  }) {
    const provider = await findLoginProviderBySlug(input.providerName);
    if (!provider) {
      throw new NotFoundError(`OIDC provider not found: ${input.providerName}`);
    }
    const { issuer, clientId } = requireLoginConfiguration(provider);

    const consumed = await consumeOidcState(input.state);
    if (!consumed || consumed.provider_id !== provider.id) {
      throw new ValidationError("Invalid or expired OIDC state", { error_code: "invalid_oidc_state" });
    }

    const discovery = await fetchOpenIdConfiguration(issuer);
    const redirectUri = `${input.apiBaseUrl.replace(/\/+$/, "")}/v4/auth/oidc/${encodeURIComponent(provider.slug)}/callback`;
    const clientSecret = await getProviderClientSecret(provider);
    if (!clientSecret) {
      throw new ValidationError(`Provider ${provider.slug} has no client secret configured`, {
        error_code: "provider_unconfigured",
      });
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const tokenResponse = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    const tokenPayload = (await tokenResponse.json().catch(() => null)) as {
      id_token?: string;
      error?: string;
    } | null;

    if (!tokenResponse.ok || !tokenPayload?.id_token) {
      throw new ValidationError(tokenPayload?.error ?? "OIDC token exchange failed", {
        error_code: "oidc_token_exchange_failed",
      });
    }

    const claims = await verifyOidcIdToken({
      idToken: tokenPayload.id_token,
      issuer,
      clientId,
      nonce: consumed.nonce,
    });

    const userId = deriveUserIdFromClaims(provider.slug, claims);
    await upsertUserIdentity({
      user_id: userId,
      provider_id: provider.id,
      subject: String(claims.sub ?? ""),
      email: typeof claims.email === "string" ? claims.email : null,
      metadata: { name: claims.name, picture: claims.picture },
    });

    const sessionToken = generateUserSessionToken();
    const session = await createUserSession({
      user_id: userId,
      session_token_hash: hashSessionToken(sessionToken),
      ttl_seconds: config.userSessionTtlSeconds,
      metadata: { provider: provider.slug, oidc: true },
    });

    return {
      ok: true as const,
      session_token: sessionToken,
      user_id: session.user_id,
      expires_at: session.expires_at,
      redirect_after: consumed.redirect_after,
      redirect_url:
        consumed.redirect_after?.trim() ||
        config.consoleUrl ||
        `${config.publicBaseUrl.replace(/\/+$/, "")}/login`,
      session_cookie: buildUserSessionCookie(sessionToken),
    };
  }
}

export const oidcService = new OidcService();
