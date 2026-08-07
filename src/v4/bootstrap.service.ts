import config from "../config";
import {
  BUILTIN_PROVIDER_SLUGS,
  ENV_CLIENT_ID_KEYS,
  ENV_CLIENT_SECRET_KEYS,
} from "./oauth-provider-env";
import {
  findOAuthProviderBySlug,
  updateOAuthProviderCredentials,
} from "./oauth.repository";

/** Sync builtin OAuth provider credentials from env vars on startup. */
export async function runV4StartupBootstrap(): Promise<void> {
  for (const slug of BUILTIN_PROVIDER_SLUGS) {
    if (slug === "github" && config.githubOAuth) {
      const provider = await findOAuthProviderBySlug("github");
      if (provider) {
        await updateOAuthProviderCredentials({
          id: provider.id,
          client_id: config.githubOAuth.clientId,
          client_secret: config.githubOAuth.clientSecret,
        });
      }
      continue;
    }

    const clientIdKey = ENV_CLIENT_ID_KEYS[slug];
    const clientSecretKey = ENV_CLIENT_SECRET_KEYS[slug];
    const clientId = clientIdKey ? process.env[clientIdKey]?.trim() : undefined;
    const clientSecret = clientSecretKey ? process.env[clientSecretKey]?.trim() : undefined;
    if (!clientId) {
      continue;
    }

    const provider = await findOAuthProviderBySlug(slug);
    if (!provider) {
      continue;
    }

    await updateOAuthProviderCredentials({
      id: provider.id,
      client_id: clientId,
      client_secret: clientSecret,
    });
  }
}
