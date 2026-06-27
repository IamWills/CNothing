import config from "../config";
import {
  BUILTIN_PROVIDER_TEMPLATES,
  ENV_CLIENT_ID_KEYS,
  ENV_CLIENT_SECRET_KEYS,
} from "./builtin-providers";
import {
  findOAuthProviderBySlug,
  listOAuthProviders,
  updateOAuthProviderCredentials,
} from "./oauth.repository";
import { findConnectorByProvider, createCapability } from "./v2.repository";
import { PLATFORM_CONNECTOR_PROVIDER } from "./platform-connector.executor";

export async function syncBuiltinProviderCredentialsFromEnv(): Promise<void> {
  for (const slug of Object.keys(BUILTIN_PROVIDER_TEMPLATES)) {
    const clientIdKey = ENV_CLIENT_ID_KEYS[slug];
    const clientSecretKey = ENV_CLIENT_SECRET_KEYS[slug];
    const clientId = clientIdKey ? process.env[clientIdKey]?.trim() : undefined;
    const clientSecret = clientSecretKey ? process.env[clientSecretKey]?.trim() : undefined;

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

export async function seedBuiltinCapabilities(): Promise<void> {
  const connector = await findConnectorByProvider(PLATFORM_CONNECTOR_PROVIDER);
  if (!connector) {
    return;
  }

  for (const [slug, templates] of Object.entries(BUILTIN_PROVIDER_TEMPLATES)) {
    const provider = await findOAuthProviderBySlug(slug);
    if (!provider) {
      continue;
    }

    for (const template of templates) {
      try {
        await createCapability({
          connector_id: connector.id,
          name: template.name,
          description: template.description,
          capability_type: template.capability_type,
          input_schema: template.input_schema,
          output_schema: template.output_schema,
          scopes: template.scopes,
          risk_level: template.risk_level,
          metadata: {
            display_name: template.display_name,
            connection_required: true,
            source: template.source,
            invocation_type: template.invocation_type,
            invocation_config: template.invocation_config,
            policy_config: template.policy_config,
            provider_id: provider.id,
          },
        });
      } catch {
        // capability may already exist
      }
    }
  }
}

export async function runV25StartupBootstrap(): Promise<void> {
  await syncBuiltinProviderCredentialsFromEnv();
  if (config.v2AutoBootstrap) {
    await seedBuiltinCapabilities();
  }
}

export async function getV25PlatformStatus() {
  const providers = await listOAuthProviders();
  return {
    version: "2.5.0",
    oauth_providers: providers.map((provider) => ({
      slug: provider.slug,
      display_name: provider.display_name,
      status: provider.status,
      connectable: provider.status === "active" && Boolean(provider.client_id),
    })),
  };
}
