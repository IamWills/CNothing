import {
  BUILTIN_PROVIDER_TEMPLATES,
  ENV_CLIENT_ID_KEYS,
  ENV_CLIENT_SECRET_KEYS,
} from "./builtin-providers";
import { listOAuthProviders } from "./oauth.repository";

export type ProviderTemplateCatalogItem = {
  slug: string;
  display_name: string;
  auth_type: string;
  status: string;
  connectable: boolean;
  capability_count: number;
  capabilities: string[];
  env_client_id_key: string | null;
  env_client_secret_key: string | null;
  authorization_url: string | null;
  documentation_url: string | null;
};

export async function listProviderTemplateCatalog(): Promise<ProviderTemplateCatalogItem[]> {
  const providers = await listOAuthProviders();
  return providers
    .filter((provider) => provider.is_builtin)
    .map((provider) => {
      const templates = BUILTIN_PROVIDER_TEMPLATES[provider.slug] ?? [];
      return {
        slug: provider.slug,
        display_name: provider.display_name,
        auth_type: provider.auth_type,
        status: provider.status,
        connectable: provider.status === "active" && Boolean(provider.client_id?.trim()),
        capability_count: templates.length,
        capabilities: templates.map((template) => template.name),
        env_client_id_key: ENV_CLIENT_ID_KEYS[provider.slug] ?? null,
        env_client_secret_key: ENV_CLIENT_SECRET_KEYS[provider.slug] ?? null,
        authorization_url: provider.authorization_url,
        documentation_url:
          typeof provider.metadata.documentation_url === "string"
            ? provider.metadata.documentation_url
            : null,
      };
    });
}
