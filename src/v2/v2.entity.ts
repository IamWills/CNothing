export type JsonObject = Record<string, unknown>;

export type AgentStatus = "active" | "suspended" | "revoked";
export type ConnectorStatus = "active" | "suspended" | "revoked";
export type CapabilityStatus = "active" | "deprecated" | "disabled";
export type CapabilityType = "ACTION" | "QUERY" | "CONFIDENTIAL_QUERY";
export type RiskLevel = "PUBLIC" | "LOW" | "MEDIUM" | "HIGH" | "CONFIDENTIAL";
export type PolicyAction =
  | "allow"
  | "deny"
  | "require_user_confirmation"
  | "require_step_up_auth"
  | "require_explicit_reason";

export type AgentRecord = {
  id: string;
  name: string;
  public_key_pem: string | null;
  owner_user_id: string;
  tenant_id: string;
  status: AgentStatus;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type ConnectorRecord = {
  id: string;
  provider: string;
  display_name: string;
  public_key_pem: string | null;
  callback_url: string;
  jwks_url: string | null;
  status: ConnectorStatus;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type CredentialRecord = {
  id: string;
  connector_id: string;
  owner_user_id: string;
  encrypted_secret: Buffer;
  secret_alg: string;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type CapabilityRecord = {
  id: string;
  connector_id: string;
  name: string;
  description: string;
  capability_type: CapabilityType;
  input_schema: JsonObject;
  output_schema: JsonObject;
  scopes: string[];
  risk_level: RiskLevel;
  status: CapabilityStatus;
  metadata: JsonObject;
  provider_id: string | null;
  display_name: string | null;
  connection_required: boolean;
  source: string | null;
  invocation_type: string | null;
  invocation_config: JsonObject;
  policy_config: JsonObject;
  created_at: string;
  updated_at: string;
};

export type GrantRecord = {
  id: string;
  user_id: string;
  agent_id: string;
  capability_id: string;
  scopes: string[];
  expires_at: string | null;
  revoked: boolean;
  revoked_at: string | null;
  provider_id: string | null;
  connection_id: string | null;
  grant_status: string | null;
  last_used_at: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type PolicyRecord = {
  id: string;
  capability_id: string | null;
  capability_pattern: string | null;
  risk_level: RiskLevel | null;
  capability_type: CapabilityType | null;
  action: PolicyAction;
  priority: number;
  enabled: boolean;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type InvokeAuditRecord = {
  id: string;
  user_id: string | null;
  agent_id: string | null;
  capability_id: string | null;
  capability_name: string;
  connector_id: string | null;
  provider_id: string | null;
  connection_id: string | null;
  policy_decision: string;
  status: string;
  request_id: string | null;
  error_code: string | null;
  input_hash: string | null;
  output_hash: string | null;
  success: boolean | null;
  risk_level: string | null;
  metadata: JsonObject;
  created_at: string;
};

export type PendingConfirmationRecord = {
  id: string;
  user_id: string;
  agent_id: string;
  capability_id: string;
  input: JsonObject;
  reason: string | null;
  expires_at: string;
  confirmed_at: string | null;
  rejected_at: string | null;
  metadata: JsonObject;
  created_at: string;
};

export type CapabilityGrantPayload = {
  iss: string;
  sub: string;
  aud: string;
  user: string;
  capability: string;
  scope: string[];
  exp: number;
  iat: number;
  jti: string;
};

export type PolicyDecision = {
  action: PolicyAction;
  matched_policy_id: string | null;
  reason: string | null;
};

export type InvokeCapabilityInput = {
  capability: string;
  input?: JsonObject;
  user_id?: string;
  reason?: string;
  confirmation_id?: string;
  request_id?: string;
};

export type InvokeCapabilityResult = {
  ok: true;
  request_id: string;
  capability: string;
  result: unknown;
};

export type InvokePendingConfirmation = {
  ok: false;
  pending: true;
  confirmation_id: string;
  policy_decision: PolicyDecision;
  expires_at: string;
  message: string;
};

export type AuthorizationRequestStatus = "pending" | "approved" | "denied" | "expired";

export type AuthorizationRequestRecord = {
  id: string;
  user_id: string;
  agent_id: string;
  requested_capabilities: string[];
  granted_capabilities: string[];
  status: AuthorizationRequestStatus;
  redirect_uri: string | null;
  state: string | null;
  reason: string | null;
  expires_at: string;
  approved_at: string | null;
  denied_at: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type GrantSummary = GrantRecord & {
  capability_name: string;
  capability_description: string;
  agent_name: string;
  connector_provider: string;
};

export type PendingConfirmationSummary = PendingConfirmationRecord & {
  capability_name: string;
  agent_name: string;
};

export type AuthorizationRequestView = AuthorizationRequestRecord & {
  agent_name: string;
  capabilities: Array<{
    name: string;
    description: string;
    capability_type: CapabilityType;
    risk_level: RiskLevel;
    scopes: string[];
  }>;
};

export type UserSessionRecord = {
  id: string;
  user_id: string;
  expires_at: string;
  revoked: boolean;
  revoked_at: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type LoginTokenRecord = {
  id: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
  created_by: string | null;
  metadata: JsonObject;
  created_at: string;
};

export type OidcProviderRecord = {
  id: string;
  name: string;
  display_name: string;
  issuer: string;
  client_id: string;
  client_secret_encrypted: Buffer;
  scopes: string;
  enabled: boolean;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type OidcProviderPublic = {
  id: string;
  name: string;
  display_name: string;
  issuer: string;
  scopes: string;
};

export type UserIdentityRecord = {
  id: string;
  user_id: string;
  provider_id: string;
  subject: string;
  email: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};
