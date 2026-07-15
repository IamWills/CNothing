import config from "../config";
import { assertSafePublicUrlWithDns } from "./url-safety.service";

export type DynamicClientRegistrationResult = {
  client_id: string;
  client_secret?: string;
  registration_access_token?: string;
};

export async function registerOAuthClient(input: {
  registration_endpoint: string;
  redirect_uri: string;
  provider_name: string;
  scopes: string[];
  token_endpoint_auth_method?: "client_secret_basic" | "client_secret_post" | "none";
}): Promise<DynamicClientRegistrationResult | null> {
  await assertSafePublicUrlWithDns(input.registration_endpoint, "registration_endpoint");

  const authMethod = input.token_endpoint_auth_method ?? "client_secret_basic";
  const response = await fetch(input.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: `CNothing Trust Broker - ${input.provider_name}`,
      redirect_uris: [input.redirect_uri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: authMethod,
      scope: input.scopes.join(" "),
      application_type: "web",
      software_id: config.serviceName,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    client_id?: string;
    client_secret?: string;
    registration_access_token?: string;
  };

  if (!payload.client_id?.trim()) {
    return null;
  }

  return {
    client_id: payload.client_id.trim(),
    client_secret: payload.client_secret?.trim(),
    registration_access_token: payload.registration_access_token?.trim(),
  };
}

export function buildOAuthCallbackUri(apiBaseUrl: string, providerSlug: string, apiVersion = "v4"): string {
  const base = (config.publicBaseUrl || apiBaseUrl).replace(/\/+$/, "");
  return `${base}/${apiVersion}/oauth/callback/${encodeURIComponent(providerSlug)}`;
}
