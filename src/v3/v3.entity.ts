import type { JsonObject } from "../v2/v2.entity";

export const V3_VERSION = "3.0.0";

export const V3_PRODUCT = "Execution Trust Layer for AI Agents";

export const V3_TAGLINE =
  "Secure execution of real-world capabilities without exposing secrets to AI agents.";

export const V3_PRINCIPLES = [
  "Agent thinks.",
  "cnothing executes.",
  "Secrets never leave cnothing.",
  "Every risky action is approved, executed, and audited.",
  "Agent Never Owns Secrets.",
  "Public Metadata May Flow Through Agent.",
  "Secrets Never Flow Through Agent.",
  "User Authorizes Capabilities.",
  "CNothing Executes Trust.",
] as const;

export const V3_MODULES = [
  "provider_registry",
  "oauth_broker",
  "capability_registry",
  "authorization_engine",
  "invocation_gateway",
  "policy_engine",
  "audit",
  "secret_vault",
  "approval_engine",
  "execution_workers",
] as const;

export type V3Module = (typeof V3_MODULES)[number];

export type SecretType =
  | "client_secret"
  | "api_key"
  | "oauth_code"
  | "access_token"
  | "refresh_token"
  | "oauth_access_token"
  | "oauth_refresh_token"
  | "private_key"
  | "ssh_private_key"
  | "session_cookie"
  | "cookie"
  | "password"
  | "recovery_code"
  | "mfa_secret"
  | "browser_session";

export type SecretOwnerType = "provider" | "connection" | "user" | "agent" | "system";

export type SecretStatus = "active" | "rotated" | "revoked" | "expired";

export type SecretVaultRecord = {
  id: string;
  secret_type: SecretType;
  owner_type: SecretOwnerType;
  owner_id: string;
  secret_alg: string;
  key_version: number;
  status: SecretStatus;
  fingerprint: string;
  secret_ref: string;
  provider_id: string | null;
  user_id: string | null;
  metadata: JsonObject;
  expires_at: string | null;
  rotated_from_id: string | null;
  rotated_at: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"
  | "consumed";

export type ApprovalRecord = {
  id: string;
  user_id: string;
  agent_id: string;
  capability_id: string;
  execution_id: string | null;
  policy_id: string | null;
  requested_action: string;
  input_summary: string;
  safe_input_summary: string | null;
  input_hash: string | null;
  risk_level: string;
  scopes: string[];
  resource_key: string | null;
  expires_at: string;
  status: ApprovalStatus;
  approved_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  decided_by: string | null;
  approval_token_hash: string | null;
  tenant_id: string;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type ExecutionStatus =
  | "created"
  | "policy_checking"
  | "pending_approval"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "denied"
  | "cancelled"
  | "timeout"
  | "reconnect_required"
  | "pending"; // legacy alias

export type ExecutionRecord = {
  id: string;
  agent_id: string;
  user_id: string | null;
  capability_id: string;
  provider_id: string | null;
  connection_id: string | null;
  approval_id: string | null;
  idempotency_key: string | null;
  status: ExecutionStatus;
  input_hash: string | null;
  result_hash: string | null;
  error_code: string | null;
  error_message: string | null;
  dry_run: boolean;
  result_payload: JsonObject | null;
  policy_decision: JsonObject | null;
  worker_type: string | null;
  safe_input: JsonObject | null;
  sanitized_output: JsonObject | null;
  audit_chain_id: string | null;
  tenant_id: string;
  started_at: string;
  finished_at: string | null;
  completed_at: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type CapabilityPermissionEffect =
  | "allow"
  | "deny"
  | "require_approval"
  | "require_reauth";

export type CapabilityPermissionRecord = {
  id: string;
  agent_id: string | null;
  capability_id: string | null;
  capability_pattern: string | null;
  provider_pattern: string | null;
  effect: CapabilityPermissionEffect;
  max_risk_level: string | null;
  require_approval: boolean | null;
  rate_limit_per_minute: number | null;
  spending_limit_cents: number | null;
  enabled: boolean;
  priority: number;
  tenant_id: string;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type InvokeGatewayStatus =
  | "pending_approval"
  | "completed"
  | "failed"
  | "denied"
  | "reconnect_required";

export type InvokeGatewayResponse =
  | {
      status: "pending_approval";
      approval_id: string;
      approval_url: string;
      safe_summary: string;
      execution_id: string;
      audit_chain_id?: string;
    }
  | {
      status: "completed";
      result: unknown;
      execution_id: string;
      audit_id: string;
      audit_chain_id?: string;
    }
  | {
      status: "denied";
      execution_id: string;
      audit_chain_id?: string;
      error: {
        code: "policy_denied" | string;
        message: string;
        recoverable: false;
      };
    }
  | {
      status: "reconnect_required";
      execution_id: string;
      connection_url: string;
      audit_chain_id?: string;
      error?: {
        code: "reconnect_required";
        message: string;
        recoverable: true;
      };
    }
  | {
      status: "failed";
      error: {
        code: string;
        message: string;
        recoverable: boolean;
      };
      execution_id?: string;
      audit_id?: string;
      audit_chain_id?: string;
    };

export type ProviderProposalStatus = "pending" | "validated" | "created" | "rejected" | "failed";

export type ProviderProposalRecord = {
  id: string;
  agent_id: string;
  status: ProviderProposalStatus;
  provider_name: string;
  proposed_slug: string;
  issuer_url: string | null;
  discovery_url: string | null;
  authorization_url: string | null;
  token_url: string | null;
  jwks_url: string | null;
  userinfo_url: string | null;
  registration_endpoint: string | null;
  openapi_url: string | null;
  mcp_url: string | null;
  scopes: string[];
  risk_assessment: JsonObject;
  validation_errors: string[];
  provider_id: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type ProviderProposalInput = {
  provider_name: string;
  issuer_url?: string;
  discovery_url?: string;
  authorization_url?: string;
  token_url?: string;
  jwks_url?: string;
  userinfo_url?: string;
  registration_endpoint?: string;
  openapi_url?: string;
  mcp_url?: string;
  scopes?: string[];
  description?: string;
  logo_url?: string;
  api_base_url?: string;
  risk_suggestion?: string;
  slug?: string;
};

export type ProviderProposalPublicView = {
  id: string;
  status: ProviderProposalStatus;
  provider_name: string;
  proposed_slug: string;
  provider_id: string | null;
  connectable: boolean;
  credential_setup_required: boolean;
  risk_assessment: JsonObject;
  validation_errors: string[];
  scopes: string[];
  created_at: string;
  updated_at: string;
};

export type TrustAuditEventType =
  | "provider_proposal"
  | "provider_created"
  | "authorization"
  | "invocation"
  | "policy_decision"
  | "secret_stored"
  | "secret_rotated"
  | "secret_revoked"
  | "secret_decrypted"
  | "approval_requested"
  | "approval_decided"
  | "execution"
  | "import"
  | "capability_invoked"
  | "policy_evaluated"
  | "approval_approved"
  | "approval_rejected"
  | "secret_accessed"
  | "worker_started"
  | "third_party_called"
  | "result_sanitized"
  | "execution_completed"
  | "execution_failed"
  | "execution_denied"
  | "reconnect_required";
