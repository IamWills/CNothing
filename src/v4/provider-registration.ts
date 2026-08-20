import { ValidationError } from "../utils/errors";
import config from "../config";
import type { JsonObject } from "./platform.entity";
import type { OAuthProviderRecord } from "./oauth.entity";
import { mergeDiscoveredProviderInput } from "./oidc-provider-discovery.service";
import type { ProviderRegistrationMethod, ProviderSource, ProviderValidationResult } from "./provider-registry";
import { registerOAuthClient } from "./rfc7591";

/**
 * Operator or agent input before a strategy prepares a registry row.
 */
export type RegistrationInput = {
  slug: string;
  display_name: string;
  auth_type?: "oauth2" | "oidc";
  discovery_url?: string;
  issuer?: string;
  authorization_url?: string;
  token_url?: string;
  userinfo_url?: string;
  revoke_url?: string;
  jwks_url?: string;
  client_id?: string;
  client_secret?: string;
  default_scopes?: string[];
  supported_scopes?: string[];
  pkce_required?: boolean;
  token_auth_method?: OAuthProviderRecord["token_auth_method"];
  login_enabled?: boolean;
  metadata?: JsonObject;
};

export type PreparedRegistration = {
  method: ProviderRegistrationMethod;
  source: ProviderSource;
  validation: ProviderValidationResult;
  provider: Awaited<ReturnType<typeof mergeDiscoveredProviderInput>> & {
    login_enabled?: boolean;
  };
};

export interface RegistrationStrategy {
  readonly method: ProviderRegistrationMethod;
  prepare(input: RegistrationInput): Promise<PreparedRegistration>;
}

function validationFromPrepared(
  method: ProviderRegistrationMethod,
  provider: PreparedRegistration["provider"],
  extra: Partial<ProviderValidationResult> = {},
): ProviderValidationResult {
  return {
    ok: extra.ok !== false,
    checked_at: new Date().toISOString(),
    method,
    issuer: provider.issuer,
    authorization_url: provider.authorization_url ?? null,
    token_url: provider.token_url ?? null,
    jwks_url: provider.jwks_url ?? null,
    registration_endpoint: extra.registration_endpoint ?? provider.registration_url ?? null,
    ...(extra.error ? { error: extra.error } : {}),
    ...(extra.dynamic_client_registration
      ? { dynamic_client_registration: extra.dynamic_client_registration }
      : {}),
  };
}

export class ManualRegistrationStrategy implements RegistrationStrategy {
  readonly method = "manual" as const;

  async prepare(input: RegistrationInput): Promise<PreparedRegistration> {
    const provider = await mergeDiscoveredProviderInput({
      ...input,
      auth_type: input.auth_type ?? "oauth2",
    });
    return {
      method: this.method,
      source: "manual",
      validation: validationFromPrepared(this.method, provider),
      provider: { ...provider, login_enabled: input.login_enabled },
    };
  }
}

/**
 * OIDC Discovery, RFC 8414 Authorization Server Metadata, and optional RFC 7591
 * Dynamic Client Registration. DCR credentials never auto-activate a provider.
 */
export class DynamicRegistrationStrategy implements RegistrationStrategy {
  readonly method = "dynamic" as const;

  async prepare(input: RegistrationInput): Promise<PreparedRegistration> {
    if (!input.discovery_url?.trim() && !input.issuer?.trim()) {
      throw new ValidationError("discovery_url or issuer is required for dynamic registration", {
        error_code: "missing_discovery",
      });
    }

    const provider = await mergeDiscoveredProviderInput({
      ...input,
      auth_type: input.auth_type ?? "oidc",
    });

    const registrationUrl = provider.registration_url?.trim();
    let dynamicClientRegistration: ProviderValidationResult["dynamic_client_registration"] = {
      attempted: false,
      ok: false,
    };
    if (registrationUrl) {
      const publicOrigin = config.publicBaseUrl.replace(/\/+$/, "");
      const registered = await registerOAuthClient({
        registrationUrl,
        redirectUris: [`${publicOrigin}/v4/oauth/callback/${provider.slug}`],
        clientName: "CNothing",
        clientUri: publicOrigin,
      });
      dynamicClientRegistration = {
        attempted: registered.attempted,
        ok: registered.ok,
        ...(registered.error ? { error: registered.error } : {}),
      };
      if (registered.ok && registered.client_id) {
        provider.client_id = registered.client_id;
        if (registered.client_secret) {
          provider.client_secret = registered.client_secret;
        }
        if (registered.token_endpoint_auth_method) {
          provider.token_auth_method = registered.token_endpoint_auth_method;
        }
      }
    }

    return {
      method: this.method,
      source: "discovered",
      validation: validationFromPrepared(this.method, provider, {
        registration_endpoint: registrationUrl ?? null,
        dynamic_client_registration: dynamicClientRegistration,
      }),
      provider: { ...provider, login_enabled: input.login_enabled },
    };
  }
}

const manualStrategy = new ManualRegistrationStrategy();
const dynamicStrategy = new DynamicRegistrationStrategy();

export function selectRegistrationStrategy(input: {
  discovery_url?: string;
  issuer?: string;
}): RegistrationStrategy {
  if (input.discovery_url?.trim() || input.issuer?.trim()) {
    return dynamicStrategy;
  }
  return manualStrategy;
}
