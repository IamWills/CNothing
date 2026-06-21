import { NotFoundError, ValidationError } from "../utils/errors";
import {
  createOidcProvider,
  createOidcState,
  createUserSession,
  consumeOidcState,
  findOidcProviderById,
  findOidcProviderByName,
  listOidcProviders,
  toPublicOidcProvider,
  upsertUserIdentity,
} from "./v2.repository";
import {
  decryptOidcClientSecret,
  deriveUserIdFromClaims,
  encryptOidcClientSecret,
  fetchOpenIdConfiguration,
  generateOidcNonce,
  generateOidcState,
  verifyOidcIdToken,
} from "./oidc-crypto";
import { generateUserSessionToken, hashSessionToken } from "./user-session";
import { buildUserSessionCookie } from "./session-cookie";
import config from "../config";

export class OidcService {
  async registerProvider(input: {
    name: string;
    display_name: string;
    issuer: string;
    client_id: string;
    client_secret: string;
    scopes?: string;
  }) {
    await fetchOpenIdConfiguration(input.issuer);
    const provider = await createOidcProvider({
      name: input.name,
      display_name: input.display_name,
      issuer: input.issuer,
      client_id: input.client_id,
      client_secret_encrypted: encryptOidcClientSecret(input.client_secret),
      scopes: input.scopes,
    });
    return { ok: true as const, provider: toPublicOidcProvider(provider) };
  }

  async listPublicProviders() {
    const providers = await listOidcProviders(false);
    return {
      ok: true as const,
      items: providers.map(toPublicOidcProvider),
    };
  }

  async startAuthorization(input: {
    providerName: string;
    apiBaseUrl: string;
    redirectAfter?: string;
  }) {
    const provider = await findOidcProviderByName(input.providerName);
    if (!provider) {
      throw new NotFoundError(`OIDC provider not found: ${input.providerName}`);
    }

    const discovery = await fetchOpenIdConfiguration(provider.issuer);
    const state = generateOidcState();
    const nonce = generateOidcNonce();
    const redirectUri = `${input.apiBaseUrl.replace(/\/+$/, "")}/v2/auth/oidc/${encodeURIComponent(provider.name)}/callback`;

    await createOidcState({
      provider_id: provider.id,
      state,
      nonce,
      redirect_after: input.redirectAfter,
    });

    const params = new URLSearchParams({
      client_id: provider.client_id,
      response_type: "code",
      scope: provider.scopes,
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
    const provider = await findOidcProviderByName(input.providerName);
    if (!provider) {
      throw new NotFoundError(`OIDC provider not found: ${input.providerName}`);
    }

    const consumed = await consumeOidcState(input.state);
    if (!consumed || consumed.provider_id !== provider.id) {
      throw new ValidationError("Invalid or expired OIDC state", { error_code: "invalid_oidc_state" });
    }

    const discovery = await fetchOpenIdConfiguration(provider.issuer);
    const redirectUri = `${input.apiBaseUrl.replace(/\/+$/, "")}/v2/auth/oidc/${encodeURIComponent(provider.name)}/callback`;
    const clientSecret = decryptOidcClientSecret(provider.client_secret_encrypted);

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: redirectUri,
      client_id: provider.client_id,
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
      issuer: provider.issuer,
      clientId: provider.client_id,
      nonce: consumed.nonce,
    });

    const userId = deriveUserIdFromClaims(provider.name, claims);
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
      metadata: { provider: provider.name, oidc: true },
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

export { findOidcProviderById };
