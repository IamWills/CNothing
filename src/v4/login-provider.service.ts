import { createOAuthProvider, findOAuthProviderBySlug } from "./oauth.repository";

export const GITHUB_PROVIDER_SLUG = "github";

/**
 * cap_user_identities.provider_id references the canonical provider registry, so a login
 * only needs the provider row that is already backing the flow. GitHub console login is
 * driven by environment credentials rather than a registry entry, so its row is created
 * on demand when the baseline seed is missing.
 */
export async function resolveGitHubLoginProviderId(): Promise<string> {
  const existing = await findOAuthProviderBySlug(GITHUB_PROVIDER_SLUG);
  if (existing) {
    return existing.id;
  }

  const created = await createOAuthProvider({
    slug: GITHUB_PROVIDER_SLUG,
    display_name: "GitHub",
    auth_type: "oauth2",
    authorization_url: "https://github.com/login/oauth/authorize",
    token_url: "https://github.com/login/oauth/access_token",
    userinfo_url: "https://api.github.com/user",
    default_scopes: ["read:user", "user:email"],
    pkce_required: false,
    login_enabled: true,
    metadata: { template: "github", api_hosts: ["api.github.com"] },
  });
  return created.id;
}
