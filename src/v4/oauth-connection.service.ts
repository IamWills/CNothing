import { createHash, randomBytes } from "node:crypto";
import config from "../config";
import { encodeBase64Url } from "../crypto/base64url";
import { ValidationError, NotFoundError, ForbiddenError } from "../utils/errors";
import {
  consumeOAuthConnectState,
  createOAuthConnectState,
  createOAuthConnection,
  findOAuthProviderById,
  findOAuthProviderBySlug,
  getProviderClientSecret,
  listOAuthConnectionsForUser,
  revokeOAuthConnection,
  updateOAuthConnectionTokens,
  markConnectionReconnectRequired,
  writeOAuthAudit,
} from "./oauth.repository";
import { buildUserSessionCookie } from "./session-cookie";
import { createUserSession, ensureUser, findIdentityByProviderSubject, upsertUserIdentity } from "./platform.repository";
import { generateUserSessionToken, hashSessionToken } from "./user-session";
import type { OAuthProviderRecord, OAuthTokenAuthMethod } from "./oauth.entity";

/** A stored client_secret means a confidential client, even if the row still says `none`. */
function resolveTokenAuthMethod(
  method: OAuthTokenAuthMethod,
  clientSecret: string | null | undefined,
): OAuthTokenAuthMethod {
  if (clientSecret && method === "none") {
    return "client_secret_post";
  }
  return method;
}

function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = encodeBase64Url(randomBytes(32));
  const challenge = encodeBase64Url(
    createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

function buildCallbackUrl(
  apiBaseUrl: string,
  providerSlug: string,
  apiVersion: "v4" = "v4",
): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/${apiVersion}/oauth/callback/${encodeURIComponent(providerSlug)}`;
}

function isAllowedRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (config.consoleUrl) {
      const consoleOrigin = new URL(config.consoleUrl).origin;
      if (parsed.origin === consoleOrigin) {
        return true;
      }
    }
    const publicOrigin = new URL(config.publicBaseUrl).origin;
    return parsed.origin === publicOrigin;
  } catch {
    return false;
  }
}

export class OAuthConnectionService {
  async startConnect(input: {
    providerId?: string;
    providerSlug?: string;
    userId: string;
    apiBaseUrl: string;
    redirectAfter?: string;
    scopes?: string[];
    oauthApiVersion?: "v4";
    tenantId?: string;
  }) {
    const provider = input.providerId
      ? await findOAuthProviderById(input.providerId)
      : input.providerSlug
        ? await findOAuthProviderBySlug(input.providerSlug)
        : null;

    if (!provider) {
      throw new NotFoundError("OAuth provider not found");
    }
    if (provider.status !== "active" || !provider.client_id) {
      throw new ForbiddenError("OAuth provider is not configured for connection", {
        error_code: "provider_unconfigured",
        provider: provider.slug,
      });
    }

    const redirectAfter = input.redirectAfter?.trim();
    if (redirectAfter && !isAllowedRedirect(redirectAfter)) {
      throw new ValidationError("redirect_after is not in the allowlist", {
        error_code: "redirect_not_allowed",
      });
    }

    const pkce = provider.pkce_required ? generatePkcePair() : null;
    const connectState = await createOAuthConnectState({
      provider_id: provider.id,
      user_id: input.userId,
      redirect_after: redirectAfter,
      code_verifier: pkce?.verifier,
      purpose: "connection",
      metadata: { tenant_id: input.tenantId ?? "default" },
    });

    const scopes =
      input.scopes && input.scopes.length > 0
        ? input.scopes
        : provider.default_scopes;

    const oauthApiVersion = input.oauthApiVersion ?? "v4";
    const authorizationUrl = this.buildAuthorizationUrl({
      provider,
      state: connectState.state,
      redirectUri: buildCallbackUrl(input.apiBaseUrl, provider.slug, oauthApiVersion),
      scopes,
      codeChallenge: pkce?.challenge,
    });

    await writeOAuthAudit({
      user_id: input.userId,
      provider_id: provider.id,
      action: "oauth.connect.start",
    });

    return {
      ok: true as const,
      authorization_url: authorizationUrl,
      state: connectState.state,
    };
  }

  /**
   * Console login via an active OAuth broker provider (including agent-registered ones).
   * Reuses the connection callback URL so DCR redirect URIs keep working.
   */
  async startLogin(input: {
    providerSlug: string;
    apiBaseUrl: string;
    redirectAfter?: string;
  }) {
    const provider = await findOAuthProviderBySlug(input.providerSlug);
    if (!provider) {
      throw new NotFoundError("OAuth provider not found");
    }
    if (provider.status !== "active" || !provider.client_id) {
      throw new ForbiddenError("OAuth provider is not configured for login", {
        error_code: "provider_unconfigured",
        provider: provider.slug,
      });
    }
    if (!provider.authorization_url || !provider.token_url) {
      throw new ValidationError("Provider missing authorization_url or token_url");
    }

    const redirectAfter = input.redirectAfter?.trim();
    if (redirectAfter && !isAllowedRedirect(redirectAfter)) {
      throw new ValidationError("redirect_after is not in the allowlist", {
        error_code: "redirect_not_allowed",
      });
    }

    const pkce = provider.pkce_required ? generatePkcePair() : null;
    const connectState = await createOAuthConnectState({
      provider_id: provider.id,
      redirect_after: redirectAfter,
      code_verifier: pkce?.verifier,
      purpose: "login",
    });

    const authorizationUrl = this.buildAuthorizationUrl({
      provider,
      state: connectState.state,
      redirectUri: buildCallbackUrl(input.apiBaseUrl, provider.slug, "v4"),
      scopes: provider.default_scopes,
      codeChallenge: pkce?.challenge,
    });

    await writeOAuthAudit({
      provider_id: provider.id,
      action: "oauth.login.start",
    });

    return {
      ok: true as const,
      authorization_url: authorizationUrl,
      state: connectState.state,
    };
  }

  private buildAuthorizationUrl(input: {
    provider: OAuthProviderRecord;
    state: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge?: string;
  }): string {
    if (!input.provider.authorization_url) {
      throw new ValidationError("Provider missing authorization_url");
    }

    const params = new URLSearchParams({
      client_id: input.provider.client_id!,
      redirect_uri: input.redirectUri,
      response_type: "code",
      state: input.state,
    });

    if (input.scopes.length > 0) {
      params.set("scope", input.scopes.join(" "));
    }

    if (input.codeChallenge) {
      params.set("code_challenge", input.codeChallenge);
      params.set("code_challenge_method", "S256");
    }

    if (input.provider.auth_type === "oidc") {
      params.set("nonce", encodeBase64Url(randomBytes(16)));
    }

    if (input.provider.slug === "github") {
      params.set("allow_signup", "true");
    }

    return `${input.provider.authorization_url}?${params.toString()}`;
  }

  async handleCallback(input: {
    providerSlug: string;
    code: string;
    state: string;
    apiBaseUrl: string;
    oauthApiVersion?: "v4";
  }): Promise<{
    ok: true;
    connection_id: string;
    redirect_url: string;
    session_cookie?: string;
    user_id?: string;
  }> {
    const provider = await findOAuthProviderBySlug(input.providerSlug);
    if (!provider) {
      throw new NotFoundError("OAuth provider not found");
    }

    const connectState = await consumeOAuthConnectState(input.state);
    if (!connectState || connectState.provider_id !== provider.id) {
      throw new ValidationError("Invalid or expired OAuth state", {
        error_code: "invalid_oauth_state",
      });
    }

    const isLogin = connectState.purpose === "login";
    let userId: string | undefined = connectState.user_id ?? undefined;
    if (!isLogin && !userId) {
      throw new ValidationError("OAuth state missing user binding", {
        error_code: "oauth_user_unbound",
      });
    }

    const clientSecret = await getProviderClientSecret(provider);
    const tokenAuthMethod = resolveTokenAuthMethod(provider.token_auth_method, clientSecret);
    if (tokenAuthMethod !== "none" && !clientSecret) {
      throw new ForbiddenError("OAuth provider client secret not configured");
    }

    const redirectUri = buildCallbackUrl(
      input.apiBaseUrl,
      provider.slug,
      input.oauthApiVersion ?? "v4",
    );
    const tokenPayload = await this.exchangeCodeForTokens({
      provider,
      code: input.code,
      redirectUri,
      clientSecret: clientSecret ?? "",
      codeVerifier: connectState.code_verifier,
    });

    const profile = await this.fetchProfile(provider, tokenPayload.access_token);

    let sessionCookie: string | undefined;
    if (isLogin) {
      const email =
        typeof profile.metadata.email === "string" ? profile.metadata.email.trim().toLowerCase() : "";
      const login =
        typeof profile.metadata.login === "string" ? profile.metadata.login.trim() : "";
      const existing = await findIdentityByProviderSubject(provider.id, profile.accountId);
      userId =
        existing?.user_id ??
        `${provider.slug}:${login || email || profile.accountId}`;
      await ensureUser(userId);
      await upsertUserIdentity({
        user_id: userId,
        provider_id: provider.id,
        subject: profile.accountId,
        email: typeof profile.metadata.email === "string" ? profile.metadata.email : null,
        metadata: {
          ...profile.metadata,
          display_name: profile.displayName,
        },
      });
      const sessionToken = generateUserSessionToken();
      await createUserSession({
        user_id: userId,
        session_token_hash: hashSessionToken(sessionToken),
        ttl_seconds: config.userSessionTtlSeconds,
        metadata: { provider: provider.slug, oauth_login: true },
      });
      sessionCookie = buildUserSessionCookie(sessionToken);
    }

    const tenantId =
      typeof connectState.metadata?.tenant_id === "string"
        ? connectState.metadata.tenant_id
        : "default";
    if (!userId) {
      throw new ValidationError("OAuth login failed to resolve user id", {
        error_code: "oauth_user_unbound",
      });
    }

    const connection = await createOAuthConnection({
      user_id: userId,
      tenant_id: tenantId,
      provider_id: provider.id,
      provider_account_id: profile.accountId,
      display_name: profile.displayName,
      access_token: tokenPayload.access_token,
      refresh_token: tokenPayload.refresh_token,
      expires_at: tokenPayload.expires_at,
      scopes: tokenPayload.scopes,
      token_type: tokenPayload.token_type,
      metadata: profile.metadata,
    });

    await writeOAuthAudit({
      user_id: userId,
      provider_id: provider.id,
      connection_id: connection.id,
      action: isLogin ? "oauth.login.completed" : "oauth.connect.completed",
    });

    const redirectUrl = isLogin
      ? connectState.redirect_after?.trim() ||
        config.consoleUrl ||
        `${config.publicBaseUrl.replace(/\/+$/, "")}/login`
      : connectState.redirect_after?.trim() ||
        (config.consoleUrl
          ? `${config.consoleUrl}/connections`
          : `${config.publicBaseUrl}/connections`);

    return {
      ok: true as const,
      connection_id: connection.id,
      redirect_url: redirectUrl,
      ...(sessionCookie ? { session_cookie: sessionCookie, user_id: userId } : {}),
    };
  }

  private async exchangeCodeForTokens(input: {
    provider: OAuthProviderRecord;
    code: string;
    redirectUri: string;
    clientSecret: string;
    codeVerifier: string | null;
  }): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_at?: string;
    scopes: string[];
    token_type: string;
  }> {
    if (!input.provider.token_url) {
      throw new ValidationError("Provider missing token_url");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.provider.client_id!,
    });

    const tokenAuthMethod = resolveTokenAuthMethod(input.provider.token_auth_method, input.clientSecret);
    if (tokenAuthMethod !== "none") {
      body.set("client_secret", input.clientSecret);
    }

    if (input.codeVerifier) {
      body.set("code_verifier", input.codeVerifier);
    }

    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    };

    if (tokenAuthMethod === "client_secret_basic" && input.clientSecret) {
      const basic = Buffer.from(`${input.provider.client_id}:${input.clientSecret}`).toString("base64");
      headers.authorization = `Basic ${basic}`;
      body.delete("client_secret");
    }

    const response = await fetch(input.provider.token_url, {
      method: "POST",
      headers,
      body,
    });

    const payload = (await response.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
      error?: string;
      error_description?: string;
    } | null;

    if (!response.ok || !payload?.access_token) {
      throw new ValidationError(
        payload?.error_description ?? payload?.error ?? "Token exchange failed",
        { error_code: "token_exchange_failed" },
      );
    }

    const expiresAt =
      typeof payload.expires_in === "number"
        ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
        : undefined;

    return {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      expires_at: expiresAt,
      scopes: payload.scope ? payload.scope.split(/[\s,]+/).filter(Boolean) : [],
      token_type: payload.token_type ?? "Bearer",
    };
  }

  async fetchConnectionProfile(
    provider: OAuthProviderRecord,
    accessToken: string,
  ): Promise<{ accountId: string; displayName: string; metadata: Record<string, unknown> }> {
    return this.fetchProfile(provider, accessToken);
  }

  private async fetchProfile(
    provider: OAuthProviderRecord,
    accessToken: string,
  ): Promise<{ accountId: string; displayName: string; metadata: Record<string, unknown> }> {
    if (provider.slug === "github") {
      const response = await fetch("https://api.github.com/user", {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${accessToken}`,
          "x-github-api-version": "2022-11-28",
        },
      });
      const user = (await response.json()) as { id?: number; login?: string; name?: string | null };
      if (!user.id || !user.login) {
        throw new ValidationError("Failed to fetch GitHub profile");
      }
      return {
        accountId: String(user.id),
        displayName: user.name ?? user.login,
        metadata: { login: user.login },
      };
    }

    if (provider.userinfo_url) {
      const response = await fetch(provider.userinfo_url, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const profile = (await response.json()) as {
        sub?: string;
        id?: string;
        email?: string;
        name?: string;
      };
      const accountId = profile.sub ?? profile.id ?? createHash("sha256").update(accessToken).digest("hex").slice(0, 16);
      return {
        accountId,
        displayName: profile.name ?? profile.email ?? accountId,
        metadata: { email: profile.email },
      };
    }

    return {
      accountId: createHash("sha256").update(accessToken).digest("hex").slice(0, 16),
      displayName: provider.display_name,
      metadata: {},
    };
  }

  async refreshConnectionTokens(connectionId: string): Promise<boolean> {
    const { findOAuthConnectionById } = await import("./oauth.repository");
    const connection = await findOAuthConnectionById(connectionId);
    if (!connection) {
      return false;
    }

    const provider = await findOAuthProviderById(connection.provider_id);
    if (!provider?.token_url) {
      return false;
    }

    const refreshToken = await (await import("./oauth.repository")).getConnectionRefreshToken(connection);
    if (!refreshToken) {
      await markConnectionReconnectRequired(connectionId);
      return false;
    }

    const clientSecret = await getProviderClientSecret(provider);
    const refreshAuthMethod = resolveTokenAuthMethod(provider.token_auth_method, clientSecret);
    if (refreshAuthMethod !== "none" && !clientSecret) {
      await markConnectionReconnectRequired(connectionId);
      return false;
    }

    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: provider.client_id!,
      });
      const tokenAuthMethod = resolveTokenAuthMethod(provider.token_auth_method, clientSecret);
      if (tokenAuthMethod !== "none") {
        body.set("client_secret", clientSecret!);
      }

      const headers: Record<string, string> = {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      };
      if (tokenAuthMethod === "client_secret_basic" && clientSecret) {
        headers.authorization = `Basic ${Buffer.from(`${provider.client_id}:${clientSecret}`).toString("base64")}`;
        body.delete("client_secret");
      }

      const response = await fetch(provider.token_url, {
        method: "POST",
        headers,
        body,
      });

      const payload = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };

      if (!response.ok || !payload.access_token) {
        await markConnectionReconnectRequired(connectionId);
        await writeOAuthAudit({
          user_id: connection.user_id,
          provider_id: provider.id,
          connection_id: connectionId,
          action: "oauth.token.refresh_failed",
          success: false,
          error_code: "refresh_failed",
        });
        return false;
      }

      await updateOAuthConnectionTokens({
        id: connectionId,
        access_token: payload.access_token,
        refresh_token: payload.refresh_token ?? refreshToken,
        expires_at:
          typeof payload.expires_in === "number"
            ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
            : null,
        status: "active",
      });

      return true;
    } catch {
      await markConnectionReconnectRequired(connectionId);
      return false;
    }
  }

  async listConnections(userId: string, tenantId?: string) {
    return listOAuthConnectionsForUser(userId, tenantId);
  }

  async revokeConnection(connectionId: string, userId: string) {
    const { findOAuthConnectionById, getConnectionAccessToken, getConnectionRefreshToken } =
      await import("./oauth.repository");
    const connection = await findOAuthConnectionById(connectionId);
    if (!connection || connection.user_id !== userId) {
      throw new NotFoundError("Connection not found");
    }

    const provider = await findOAuthProviderById(connection.provider_id);
    if (provider) {
      await this.revokeRemoteTokens({
        provider,
        accessToken: await getConnectionAccessToken(connection),
        refreshToken: await getConnectionRefreshToken(connection),
      });
    }

    const revoked = await revokeOAuthConnection(connectionId, userId);
    if (!revoked) {
      throw new NotFoundError("Connection not found");
    }
    await writeOAuthAudit({
      user_id: userId,
      connection_id: connectionId,
      provider_id: connection.provider_id,
      action: "oauth.connection.revoked",
    });
    return { ok: true as const };
  }

  private async revokeRemoteTokens(input: {
    provider: OAuthProviderRecord;
    accessToken: string;
    refreshToken: string | null;
  }): Promise<void> {
    try {
      if (input.provider.slug === "microsoft") {
        await fetch("https://graph.microsoft.com/v1.0/me/revokeSignInSessions", {
          method: "POST",
          headers: { authorization: `Bearer ${input.accessToken}` },
        });
        return;
      }

      if (input.provider.slug === "github" && input.provider.client_id) {
        const clientSecret = await getProviderClientSecret(input.provider);
        if (clientSecret) {
          const basic = Buffer.from(`${input.provider.client_id}:${clientSecret}`).toString("base64");
          await fetch(`https://api.github.com/applications/${input.provider.client_id}/grant`, {
            method: "DELETE",
            headers: {
              authorization: `Basic ${basic}`,
              accept: "application/vnd.github+json",
              "content-type": "application/json",
            },
            body: JSON.stringify({ access_token: input.accessToken }),
          });
        }
        return;
      }

      const tokenToRevoke = input.refreshToken ?? input.accessToken;
      if (input.provider.revoke_url) {
        if (input.provider.slug === "google") {
          await fetch(`${input.provider.revoke_url}?token=${encodeURIComponent(tokenToRevoke)}`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
          });
          return;
        }

        const body = new URLSearchParams({ token: tokenToRevoke });
        if (input.provider.client_id) {
          body.set("client_id", input.provider.client_id);
        }
        const clientSecret = await getProviderClientSecret(input.provider);
        if (clientSecret) {
          body.set("client_secret", clientSecret);
        }
        await fetch(input.provider.revoke_url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        });
      }
    } catch {
      await writeOAuthAudit({
        provider_id: input.provider.id,
        action: "oauth.token.revoke_failed",
        success: false,
        error_code: "remote_revoke_failed",
      });
    }
  }
}

export const oauthConnectionService = new OAuthConnectionService();

export class OAuthProviderService {
  async listPublicProviders() {
    const { listOAuthProviders, toProviderPublic } = await import("./oauth.repository");
    const providers = await listOAuthProviders();
    return providers.filter((provider) => toProviderPublic(provider).connectable).map(toProviderPublic);
  }

  async getProvider(id: string) {
    const { findOAuthProviderById, toProviderPublic } = await import("./oauth.repository");
    const provider = await findOAuthProviderById(id);
    if (!provider) {
      throw new NotFoundError("OAuth provider not found");
    }
    return toProviderPublic(provider);
  }

  async createProvider(
    input: Parameters<typeof import("./oauth.repository").createOAuthProvider>[0] & {
      discovery_url?: string;
      issuer?: string;
    },
  ) {
    const { selectRegistrationStrategy } = await import("./provider-registration");
    const { withRegistryMetadata } = await import("./provider-registry");
    const { createOAuthProvider, toProviderAdmin } = await import("./oauth.repository");
    const strategy = selectRegistrationStrategy(input);
    const prepared = await strategy.prepare({
      slug: input.slug,
      display_name: input.display_name,
      auth_type: input.auth_type === "oidc" ? "oidc" : "oauth2",
      discovery_url: input.discovery_url,
      issuer: input.issuer ?? undefined,
      authorization_url: input.authorization_url,
      token_url: input.token_url,
      userinfo_url: input.userinfo_url,
      revoke_url: input.revoke_url,
      jwks_url: input.jwks_url,
      client_id: input.client_id,
      client_secret: input.client_secret,
      default_scopes: input.default_scopes,
      supported_scopes: input.supported_scopes,
      pkce_required: input.pkce_required,
      token_auth_method: input.token_auth_method,
      login_enabled: input.login_enabled,
      metadata: input.metadata,
    });
    const provider = await createOAuthProvider({
      ...prepared.provider,
      source: prepared.source,
      metadata: withRegistryMetadata(prepared.provider.metadata, {
        method: prepared.method,
        validation: prepared.validation,
      }),
    });
    return toProviderAdmin(provider);
  }

  /**
   * Agent or operator submits an unknown issuer. Lookup first; if missing,
   * run dynamic discovery and persist an unconfigured registry row for review.
   * Never activates the provider and never stores a blocked internal URL.
   */
  async proposeProvider(input: {
    slug?: string;
    display_name?: string;
    discovery_url?: string;
    issuer?: string;
  }) {
    const { ValidationError } = await import("../utils/errors");
    const { DynamicRegistrationStrategy } = await import("./provider-registration");
    const { slugFromIssuerOrHost, withRegistryMetadata } = await import("./provider-registry");
    const {
      createOAuthProvider,
      findOAuthProviderByIssuer,
      findOAuthProviderBySlug,
      toProviderAdmin,
      updateOAuthProviderCredentials,
      updateOAuthProviderEndpoints,
    } = await import("./oauth.repository");

    const discoveryUrl = input.discovery_url?.trim();
    const issuer = input.issuer?.trim();
    if (!discoveryUrl && !issuer) {
      throw new ValidationError("discovery_url or issuer is required", {
        error_code: "missing_discovery",
      });
    }

    const slug = (input.slug?.trim() || slugFromIssuerOrHost(issuer || discoveryUrl || "")).toLowerCase();
    if (!slug) {
      throw new ValidationError("slug could not be derived from issuer", { error_code: "missing_slug" });
    }
    const displayName = input.display_name?.trim() || slug;

    const existing =
      (await findOAuthProviderBySlug(slug)) ?? (issuer ? await findOAuthProviderByIssuer(issuer) : null);

    const strategy = new DynamicRegistrationStrategy();
    try {
      const prepared = await strategy.prepare({
        slug,
        display_name: displayName,
        discovery_url: discoveryUrl,
        issuer,
      });
      const metadata = withRegistryMetadata(prepared.provider.metadata, {
        method: prepared.method,
        validation: prepared.validation,
      });

      if (existing) {
        if (existing.status === "unconfigured" && existing.source === "discovered") {
          const updated = await updateOAuthProviderEndpoints({
            id: existing.id,
            display_name: displayName,
            issuer: prepared.provider.issuer,
            discovery_url: prepared.provider.discovery_url,
            authorization_url: prepared.provider.authorization_url,
            token_url: prepared.provider.token_url,
            userinfo_url: prepared.provider.userinfo_url,
            revoke_url: prepared.provider.revoke_url,
            jwks_url: prepared.provider.jwks_url,
            default_scopes: prepared.provider.default_scopes,
            supported_scopes: prepared.provider.supported_scopes,
            metadata,
          });
          if (prepared.provider.client_id?.trim()) {
            await updateOAuthProviderCredentials({
              id: existing.id,
              client_id: prepared.provider.client_id,
              client_secret: prepared.provider.client_secret,
              activate: false,
            });
          }
          const latest = await findOAuthProviderBySlug(slug);
          return toProviderAdmin(latest ?? updated ?? existing);
        }
        return toProviderAdmin(existing);
      }

      const provider = await createOAuthProvider({
        ...prepared.provider,
        source: "discovered",
        status: "unconfigured",
        metadata,
      });
      return toProviderAdmin(provider);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const blocked = /blocked|https/i.test(message);
      if (blocked || existing) {
        throw error;
      }
      const provider = await createOAuthProvider({
        slug,
        display_name: displayName,
        auth_type: "oidc",
        issuer: issuer ?? null,
        discovery_url: discoveryUrl ?? null,
        source: "discovered",
        metadata: withRegistryMetadata(
          {},
          {
            method: "dynamic",
            validation: {
              ok: false,
              checked_at: new Date().toISOString(),
              method: "dynamic",
              error: message,
            },
          },
        ),
      });
      return toProviderAdmin(provider);
    }
  }

  async listAdminProviders() {
    const { listOAuthProviders, toProviderAdmin } = await import("./oauth.repository");
    const providers = await listOAuthProviders();
    return providers.map(toProviderAdmin);
  }

  async reviewProvider(id: string) {
    const { markOAuthProviderReviewed, toProviderAdmin } = await import("./oauth.repository");
    const provider = await markOAuthProviderReviewed(id);
    if (!provider) {
      throw new NotFoundError("OAuth provider not found");
    }
    return toProviderAdmin(provider);
  }

  async setProviderStatus(id: string, status: "active" | "disabled") {
    const { ValidationError } = await import("../utils/errors");
    const { canActivateProvider } = await import("./provider-registry");
    const { findOAuthProviderById, setOAuthProviderStatus, toProviderAdmin } = await import(
      "./oauth.repository"
    );
    const existing = await findOAuthProviderById(id);
    if (!existing) {
      throw new NotFoundError("OAuth provider not found");
    }
    if (status === "active" && !canActivateProvider(existing)) {
      throw new ValidationError("Provider needs client credentials before it can be activated", {
        error_code: "provider_unconfigured",
      });
    }
    const provider = await setOAuthProviderStatus(id, status);
    return toProviderAdmin(provider!);
  }

  async updateProvider(input: {
    id: string;
    display_name?: string;
    discovery_url?: string;
    issuer?: string;
    authorization_url?: string;
    token_url?: string;
    userinfo_url?: string;
    revoke_url?: string;
    jwks_url?: string;
    default_scopes?: string[];
    supported_scopes?: string[];
    login_enabled?: boolean;
    status?: "active" | "disabled";
    reviewed?: boolean;
  }) {
    const { findOAuthProviderById, setProviderLoginEnabled, toProviderAdmin, updateOAuthProviderEndpoints } =
      await import("./oauth.repository");
    const { selectRegistrationStrategy } = await import("./provider-registration");
    const { withRegistryMetadata } = await import("./provider-registry");
    const existing = await findOAuthProviderById(input.id);
    if (!existing) {
      throw new NotFoundError("OAuth provider not found");
    }

    const hasDiscoveryUpdate = Boolean(input.discovery_url?.trim() || input.issuer?.trim());
    const hasEndpointUpdate = Boolean(
      input.authorization_url?.trim() ||
        input.token_url?.trim() ||
        input.userinfo_url?.trim() ||
        input.revoke_url?.trim() ||
        input.jwks_url?.trim(),
    );

    if (hasDiscoveryUpdate || hasEndpointUpdate) {
      const strategy = selectRegistrationStrategy({
        discovery_url: input.discovery_url ?? (hasDiscoveryUpdate ? undefined : existing.discovery_url ?? undefined),
        issuer: input.issuer ?? (hasDiscoveryUpdate ? undefined : existing.issuer ?? undefined),
      });
      const prepared = await strategy.prepare({
        slug: existing.slug,
        display_name: input.display_name ?? existing.display_name,
        auth_type: existing.auth_type === "oidc" ? "oidc" : "oauth2",
        discovery_url: input.discovery_url ?? existing.discovery_url ?? undefined,
        issuer: input.issuer ?? existing.issuer ?? undefined,
        authorization_url: input.authorization_url ?? existing.authorization_url ?? undefined,
        token_url: input.token_url ?? existing.token_url ?? undefined,
        userinfo_url: input.userinfo_url ?? existing.userinfo_url ?? undefined,
        revoke_url: input.revoke_url ?? existing.revoke_url ?? undefined,
        jwks_url: input.jwks_url ?? existing.jwks_url ?? undefined,
        default_scopes: input.default_scopes,
        supported_scopes: input.supported_scopes,
      });
      await updateOAuthProviderEndpoints({
        id: existing.id,
        display_name: prepared.provider.display_name,
        issuer: prepared.provider.issuer,
        discovery_url: prepared.provider.discovery_url,
        authorization_url: prepared.provider.authorization_url,
        token_url: prepared.provider.token_url,
        userinfo_url: prepared.provider.userinfo_url,
        revoke_url: prepared.provider.revoke_url,
        jwks_url: prepared.provider.jwks_url,
        default_scopes: prepared.provider.default_scopes,
        supported_scopes: prepared.provider.supported_scopes,
        metadata: withRegistryMetadata(existing.metadata, {
          method: prepared.method,
          validation: prepared.validation,
        }),
      });
    } else if (
      input.display_name?.trim() ||
      input.default_scopes ||
      input.supported_scopes
    ) {
      await updateOAuthProviderEndpoints({
        id: existing.id,
        display_name: input.display_name,
        default_scopes: input.default_scopes,
        supported_scopes: input.supported_scopes,
      });
    }

    if (input.reviewed) {
      await this.reviewProvider(input.id);
    }
    if (input.login_enabled !== undefined) {
      await setProviderLoginEnabled(input.id, input.login_enabled);
    }
    if (input.status) {
      await this.setProviderStatus(input.id, input.status);
    }

    const updated = await findOAuthProviderById(input.id);
    return toProviderAdmin(updated!);
  }

  async updateProviderCredentials(input: {
    id: string;
    client_id: string;
    client_secret?: string;
  }) {
    const { updateOAuthProviderCredentials, toProviderAdmin } = await import("./oauth.repository");
    const provider = await updateOAuthProviderCredentials(input);
    if (!provider) {
      throw new NotFoundError("OAuth provider not found");
    }
    return toProviderAdmin(provider);
  }
}

export const oauthProviderService = new OAuthProviderService();
