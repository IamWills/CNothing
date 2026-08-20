import type { OAuthTokenAuthMethod } from "./oauth.entity";
import { postPublicJsonDocument } from "./safe-fetch";

export type DynamicClientRegistrationResult = {
  attempted: boolean;
  ok: boolean;
  error?: string;
  client_id?: string;
  client_secret?: string;
  token_endpoint_auth_method?: OAuthTokenAuthMethod;
};

type RegistrationResponse = {
  client_id?: string;
  client_secret?: string;
  token_endpoint_auth_method?: string;
  error?: string;
  error_description?: string;
};

function mapAuthMethod(value: string | undefined): OAuthTokenAuthMethod {
  if (value === "none") return "none";
  if (value === "client_secret_basic") return "client_secret_basic";
  return "client_secret_post";
}

/**
 * RFC 7591 Dynamic Client Registration. Optional: a missing or hostile
 * registration_endpoint must not fail discovery. Credentials are returned to
 * the caller to vault; this function never persists them.
 */
export async function registerOAuthClient(input: {
  registrationUrl: string;
  redirectUris: string[];
  clientName: string;
  clientUri: string;
}): Promise<DynamicClientRegistrationResult> {
  try {
    const response = await postPublicJsonDocument<RegistrationResponse>(
      input.registrationUrl,
      {
        redirect_uris: input.redirectUris,
        token_endpoint_auth_method: "client_secret_post",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        application_type: "web",
        client_name: input.clientName,
        client_uri: input.clientUri,
      },
      { label: "registration_endpoint" },
    );

    if (response.status < 200 || response.status >= 300 || !response.json) {
      const description =
        response.json?.error_description ||
        response.json?.error ||
        `HTTP ${response.status}`;
      return {
        attempted: true,
        ok: false,
        error: `RFC 7591 registration failed: ${description}`,
      };
    }

    const clientId = response.json.client_id?.trim();
    if (!clientId) {
      return {
        attempted: true,
        ok: false,
        error: "RFC 7591 registration response omitted client_id",
      };
    }

    const authMethod = mapAuthMethod(response.json.token_endpoint_auth_method);
    const clientSecret = response.json.client_secret?.trim();
    if (authMethod !== "none" && !clientSecret) {
      return {
        attempted: true,
        ok: false,
        error: "RFC 7591 registration did not return a client_secret",
      };
    }

    return {
      attempted: true,
      ok: true,
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      token_endpoint_auth_method: authMethod,
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
