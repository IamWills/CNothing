import { githubOAuthService, type AuthProviderDescriptor } from "./github-oauth.service";
import { listOAuthProviders, toProviderPublic } from "./oauth.repository";
import type { OAuthProviderRecord } from "./oauth.entity";

/**
 * A provider can back a console login in two ways, both served from the same registry entry:
 *  - `oidc`: registered as a login identity provider, so the id_token is verified against its issuer.
 *  - `oauth`: any connectable broker, which signs the user in from the profile endpoint.
 */
function describeLogin(
  provider: OAuthProviderRecord,
  base: string,
): AuthProviderDescriptor | null {
  if (provider.auth_type !== "oauth2" && provider.auth_type !== "oidc") {
    return null;
  }
  if (!toProviderPublic(provider).connectable) {
    return null;
  }

  if (provider.login_enabled && provider.issuer?.trim()) {
    return {
      type: "oidc",
      name: provider.slug,
      display_name: provider.display_name,
      start_path: `${base}/v4/auth/oidc/${encodeURIComponent(provider.slug)}/start`,
    };
  }

  if (provider.authorization_url && provider.token_url) {
    return {
      type: "oauth",
      name: provider.slug,
      display_name: provider.display_name,
      start_path: `${base}/v4/auth/oauth/${encodeURIComponent(provider.slug)}/start`,
    };
  }

  return null;
}

export async function listAuthProviders(apiBaseUrl: string): Promise<{
  ok: true;
  items: AuthProviderDescriptor[];
}> {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const items: AuthProviderDescriptor[] = [];
  const seenNames = new Set<string>();

  // Environment-configured GitHub login takes precedence over its registry entry.
  const github = githubOAuthService.describeProvider(apiBaseUrl);
  if (github) {
    items.push(github);
    seenNames.add(github.name);
  }

  for (const provider of await listOAuthProviders()) {
    if (seenNames.has(provider.slug)) {
      continue;
    }
    const descriptor = describeLogin(provider, base);
    if (descriptor) {
      items.push(descriptor);
      seenNames.add(provider.slug);
    }
  }

  return { ok: true, items };
}
