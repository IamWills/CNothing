import type { JsonObject } from "./platform.entity";

export type OAuthAuthType = "oauth2" | "oidc" | "api_key" | "custom";
export type OAuthProviderStatus = "active" | "unconfigured" | "disabled";
export type OAuthConnectionStatus = "active" | "expired" | "reconnect_required" | "revoked";
export type OAuthTokenAuthMethod = "client_secret_basic" | "client_secret_post" | "none";

export type OAuthProviderRecord = {
  id: string;
  slug: string;
  display_name: string;
  auth_type: OAuthAuthType;
  issuer: string | null;
  discovery_url: string | null;
  authorization_url: string | null;
  token_url: string | null;
  userinfo_url: string | null;
  revoke_url: string | null;
  jwks_url: string | null;
  client_id: string | null;
  encrypted_client_secret: Buffer | null;
  client_secret_vault_id: string | null;
  secret_alg: string;
  default_scopes: string[];
  supported_scopes: string[];
  pkce_required: boolean;
  token_auth_method: OAuthTokenAuthMethod;
  status: OAuthProviderStatus;
  is_builtin: boolean;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type OAuthProviderPublic = {
  id: string;
  slug: string;
  display_name: string;
  auth_type: OAuthAuthType;
  default_scopes: string[];
  supported_scopes: string[];
  status: OAuthProviderStatus;
  is_builtin: boolean;
  connectable: boolean;
};

export type OAuthConnectionRecord = {
  id: string;
  user_id: string;
  tenant_id: string;
  provider_id: string;
  provider_account_id: string;
  display_name: string;
  encrypted_access_token: Buffer | null;
  encrypted_refresh_token: Buffer | null;
  access_token_secret_id: string | null;
  refresh_token_secret_id: string | null;
  token_alg: string;
  expires_at: string | null;
  scopes: string[];
  token_type: string;
  status: OAuthConnectionStatus;
  last_used_at: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type OAuthConnectionPublic = {
  id: string;
  user_id: string;
  tenant_id: string;
  provider_id: string;
  provider_slug: string;
  provider_display_name: string;
  provider_account_id: string;
  display_name: string;
  scopes: string[];
  status: OAuthConnectionStatus;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

export type OAuthConnectStateRecord = {
  id: string;
  provider_id: string;
  user_id: string | null;
  state: string;
  code_verifier: string | null;
  redirect_after: string | null;
  purpose: string;
  expires_at: string;
  consumed_at: string | null;
  metadata: JsonObject;
  created_at: string;
};
