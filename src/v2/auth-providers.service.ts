import { oidcService } from "./oidc.service";
import { githubOAuthService, type AuthProviderDescriptor } from "./github-oauth.service";

export async function listAuthProviders(apiBaseUrl: string): Promise<{
  ok: true;
  items: AuthProviderDescriptor[];
}> {
  const items: AuthProviderDescriptor[] = [];

  const github = githubOAuthService.describeProvider(apiBaseUrl);
  if (github) {
    items.push(github);
  }

  const oidc = await oidcService.listPublicProviders();
  for (const provider of oidc.items) {
    if (github && provider.name === "github") {
      continue;
    }
    items.push({
      type: "oidc",
      name: provider.name,
      display_name: provider.display_name,
      start_path: `${apiBaseUrl.replace(/\/+$/, "")}/v2/auth/oidc/${encodeURIComponent(provider.name)}/start`,
    });
  }

  return { ok: true, items };
}
