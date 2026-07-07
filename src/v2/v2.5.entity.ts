import type {
  CapabilityType,
  GrantRecord,
  JsonObject,
  PolicyAction,
  RiskLevel,
} from "./v2.entity";

export type OAuthAuthType = "oauth2" | "oidc" | "api_key" | "custom";
export type OAuthProviderStatus = "active" | "unconfigured" | "disabled";
export type OAuthConnectionStatus = "active" | "expired" | "reconnect_required" | "revoked";
export type OAuthTokenAuthMethod = "client_secret_basic" | "client_secret_post" | "none";
export type CapabilitySource =
  | "built_in"
  | "openapi_import"
  | "mcp_import"
  | "manual_schema"
  | "provider_template";
export type InvocationType = "http" | "mcp" | "builtin" | "custom";
export type GrantStatus = "pending" | "approved" | "denied" | "expired" | "revoked";
export type ImportJobType = "openapi" | "mcp";
export type ImportJobStatus = "pending" | "processing" | "completed" | "failed";

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
  device_authorization_endpoint: string | null;
  registration_endpoint: string | null;
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
  supports_device_flow: boolean;
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

export type CapabilityGrantRecord = GrantRecord & {
  provider_id: string | null;
  connection_id: string | null;
  grant_status: GrantStatus;
  last_used_at: string | null;
};

export type CapabilityV25Record = {
  id: string;
  connector_id: string;
  provider_id: string | null;
  name: string;
  display_name: string | null;
  description: string;
  capability_type: CapabilityType;
  input_schema: JsonObject;
  output_schema: JsonObject;
  scopes: string[];
  risk_level: RiskLevel;
  status: string;
  connection_required: boolean;
  source: CapabilitySource;
  invocation_type: InvocationType;
  invocation_config: JsonObject;
  policy_config: JsonObject;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type AgentCapabilityView = {
  name: string;
  display_name: string;
  description: string;
  capability_type: CapabilityType;
  risk_level: RiskLevel;
  required_scopes: string[];
  input_schema: JsonObject;
  output_schema: JsonObject;
  connection_required: boolean;
  authorized: boolean;
  grant_status: GrantStatus | null;
};

export type ImportJobRecord = {
  id: string;
  import_type: ImportJobType;
  status: ImportJobStatus;
  source_url: string | null;
  source_filename: string | null;
  provider_id: string | null;
  candidate_count: number;
  candidates: JsonObject[];
  error_message: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type AuditLogRecord = {
  id: string;
  user_id: string | null;
  agent_id: string | null;
  provider_id: string | null;
  connection_id: string | null;
  capability_id: string | null;
  capability_name: string;
  action: string;
  policy_decision: string;
  risk_level: string | null;
  input_hash: string | null;
  output_hash: string | null;
  success: boolean | null;
  error_code: string | null;
  metadata: JsonObject;
  created_at: string;
};

export type PolicyConfigV25 = {
  allow?: boolean;
  deny?: boolean;
  require_user_confirmation?: boolean;
  require_step_up_auth?: boolean;
  redact_output?: string[];
  summarize_only?: boolean;
  metadata_only?: boolean;
  max_result_count?: number;
  block_sensitive_fields?: string[];
};

export type ExtendedPolicyAction =
  | PolicyAction
  | "redact_output"
  | "summarize_only"
  | "metadata_only"
  | "max_result_count"
  | "block_sensitive_fields";

export type PolicyDecisionV25 = {
  action: ExtendedPolicyAction;
  matched_policy_id: string | null;
  reason: string | null;
  output_mode?: "full" | "metadata_only" | "summary" | "redacted";
  redact_fields?: string[];
  max_result_count?: number;
};

export type AgentAuthorizationRequest = {
  capability: string;
  requested_scopes?: string[];
  reason?: string;
};

export type AgentAuthorizationResponse = {
  authorization_id: string;
  approval_url: string;
  status: "pending";
};

export type AgentInvokeRequest = {
  capability: string;
  input?: JsonObject;
  reason?: string;
  confirmation_id?: string;
  request_id?: string;
};
