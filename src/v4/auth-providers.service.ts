import { oidcService } from "./oidc.service";
import { githubOAuthService, type AuthProviderDescriptor } from "./github-oauth.service";
import { listOAuthProviders, toProviderPublic } from "./oauth.repository";

export async function listAuthProviders(apiBaseUrl: string): Promise<{
  ok: true;
  items: AuthProviderDescriptor[];
}> {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const items: AuthProviderDescriptor[] = [];
  const seenNames = new Set<string>();

  const github = githubOAuthService.describeProvider(apiBaseUrl);
  if (github) {
    items.push(github);
    seenNames.add(github.name);
  }

  const oidc = await oidcService.listPublicProviders();
  for (const provider of oidc.items) {
    if (seenNames.has(provider.name)) {
      continue;
    }
    items.push({
      type: "oidc",
      name: provider.name,
      display_name: provider.display_name,
      start_path: `${base}/v4/auth/oidc/${encodeURIComponent(provider.name)}/start`,
    });
    seenNames.add(provider.name);
  }

  // Agent-/admin-registered OAuth brokers that are ready to connect also work as login IdPs.
  const oauthProviders = await listOAuthProviders();
  for (const provider of oauthProviders) {
    if (seenNames.has(provider.slug)) {
      continue;
    }
    if (provider.auth_type !== "oauth2" && provider.auth_type !== "oidc") {
      continue;
    }
    const pub = toProviderPublic(provider);
    if (!pub.connectable || !provider.authorization_url || !provider.token_url) {
      continue;
    }
    items.push({
      type: "oauth",
      name: provider.slug,
      display_name: provider.display_name,
      start_path: `${base}/v4/auth/oauth/${encodeURIComponent(provider.slug)}/start`,
    });
    seenNames.add(provider.slug);
  }

  return { ok: true, items };
}
