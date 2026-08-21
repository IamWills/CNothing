import { randomBytes } from "node:crypto";
import config from "../config";
import { ValidationError, NotFoundError } from "../utils/errors";
import { encodeBase64Url } from "../crypto/base64url";
import { consumeOAuth2State, createOAuth2State } from "./oauth2-state.repository";
import {
  createUserSession,
  ensureUser,
  upsertUserIdentity,
} from "./platform.repository";
import {
  generateUserSessionToken,
  hashSessionToken,
} from "./user-session";
import { resolveGitHubLoginProviderId } from "./login-provider.service";
import { buildUserSessionCookie } from "./session-cookie";

const GITHUB_OAUTH_SCOPES = "read:user user:email";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

export type AuthProviderDescriptor = {
  /** github = env-configured GitHub login; oidc = id_token login; oauth = broker login */
  type: "github" | "oidc" | "oauth";
  name: string;
  display_name: string;
  start_path: string;
};

function generateOAuthState(): string {
  return encodeBase64Url(randomBytes(24));
}

function buildRedirectAfterLogin(input: { redirectAfter?: string | null }): string {
  return (
    input.redirectAfter?.trim() ||
    config.consoleUrl ||
    `${config.publicBaseUrl.replace(/\/+$/, "")}/login`
  );
}

export class GitHubOAuthService {
  isEnabled(): boolean {
    return Boolean(config.githubOAuth?.clientId && config.githubOAuth?.clientSecret);
  }

  describeProvider(apiBaseUrl: string): AuthProviderDescriptor | null {
    if (!this.isEnabled()) {
      return null;
    }
    return {
      type: "github",
      name: "github",
      display_name: "GitHub",
      start_path: `${apiBaseUrl.replace(/\/+$/, "")}/v4/auth/github/start`,
    };
  }

  async startAuthorization(input: { apiBaseUrl: string; redirectAfter?: string }) {
    if (!config.githubOAuth) {
      throw new NotFoundError("GitHub OAuth is not configured");
    }

    const state = generateOAuthState();
    await createOAuth2State({
      provider: "github",
      state,
      redirect_after: input.redirectAfter,
    });

    const redirectUri = config.githubOAuth.redirectUri;
    const params = new URLSearchParams({
      client_id: config.githubOAuth.clientId,
      redirect_uri: redirectUri,
      scope: GITHUB_OAUTH_SCOPES,
      state,
      allow_signup: "true",
    });

    return {
      ok: true as const,
      authorization_url: `${GITHUB_AUTHORIZE_URL}?${params.toString()}`,
    };
  }

  async handleCallback(input: { code: string; state: string; apiBaseUrl: string }) {
    if (!config.githubOAuth) {
      throw new NotFoundError("GitHub OAuth is not configured");
    }

    const consumed = await consumeOAuth2State(input.state);
    if (!consumed || consumed.provider !== "github") {
      throw new ValidationError("Invalid or expired OAuth state", { error_code: "invalid_oauth_state" });
    }

    const redirectUri = config.githubOAuth.redirectUri;
    const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: config.githubOAuth.clientId,
        client_secret: config.githubOAuth.clientSecret,
        code: input.code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenPayload = (await tokenResponse.json().catch(() => null)) as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    } | null;

    if (!tokenResponse.ok || !tokenPayload?.access_token) {
      throw new ValidationError(
        tokenPayload?.error_description ?? tokenPayload?.error ?? "GitHub token exchange failed",
        { error_code: "github_token_exchange_failed" },
      );
    }

    const profile = await this.fetchGitHubProfile(tokenPayload.access_token);
    const userId = `github:${profile.login}`;

    const providerId = await resolveGitHubLoginProviderId();
    await ensureUser(userId);
    await upsertUserIdentity({
      user_id: userId,
      provider_id: providerId,
      subject: String(profile.id),
      email: profile.email,
      metadata: {
        login: profile.login,
        name: profile.name,
        avatar_url: profile.avatar_url,
      },
    });

    const sessionToken = generateUserSessionToken();
    const session = await createUserSession({
      user_id: userId,
      session_token_hash: hashSessionToken(sessionToken),
      ttl_seconds: config.userSessionTtlSeconds,
      metadata: { provider: "github", login: profile.login },
    });

    return {
      ok: true as const,
      session_token: sessionToken,
      user_id: session.user_id,
      expires_at: session.expires_at,
      redirect_url: buildRedirectAfterLogin({
        redirectAfter: consumed.redirect_after,
      }),
      session_cookie: buildUserSessionCookie(sessionToken),
    };
  }

  private async fetchGitHubProfile(accessToken: string): Promise<{
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  }> {
    const userResponse = await fetch(GITHUB_USER_URL, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "x-github-api-version": "2022-11-28",
      },
    });

    const user = (await userResponse.json().catch(() => null)) as {
      id?: number;
      login?: string;
      name?: string | null;
      email?: string | null;
      avatar_url?: string | null;
      message?: string;
    } | null;

    if (!userResponse.ok || !user?.id || !user.login) {
      throw new ValidationError(user?.message ?? "Failed to fetch GitHub profile", {
        error_code: "github_profile_failed",
      });
    }

    let email = user.email ?? null;
    if (!email) {
      const emailsResponse = await fetch(GITHUB_EMAILS_URL, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${accessToken}`,
          "x-github-api-version": "2022-11-28",
        },
      });
      const emails = (await emailsResponse.json().catch(() => null)) as Array<{
        email?: string;
        primary?: boolean;
        verified?: boolean;
      }> | null;
      if (Array.isArray(emails)) {
        const primary = emails.find((item) => item.primary && item.verified);
        email = primary?.email ?? emails.find((item) => item.verified)?.email ?? null;
      }
    }

    return {
      id: user.id,
      login: user.login,
      name: user.name ?? null,
      email,
      avatar_url: user.avatar_url ?? null,
    };
  }
}

export const githubOAuthService = new GitHubOAuthService();
