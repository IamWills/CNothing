import { ValidationError } from "../utils/errors";
import type { JsonObject } from "./platform.entity";
import type { OAuthProviderRecord } from "./oauth.entity";
import { mergeDiscoveredProviderInput } from "./oidc-provider-discovery.service";
import type { ProviderRegistrationMethod, ProviderSource, ProviderValidationResult } from "./provider-registry";

/**
 * Operator or agent input before a strategy prepares a registry row.
 * RFC 7591 client registration is intentionally not implemented here.
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
): ProviderValidationResult {
  return {
    ok: true,
    checked_at: new Date().toISOString(),
    method,
    issuer: provider.issuer,
    authorization_url: provider.authorization_url ?? null,
    token_url: provider.token_url ?? null,
    jwks_url: provider.jwks_url ?? null,
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
 * OIDC Discovery and RFC 8414 Authorization Server Metadata.
 * Does not perform RFC 7591 Dynamic Client Registration.
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

    return {
      method: this.method,
      source: "discovered",
      validation: validationFromPrepared(this.method, provider),
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
