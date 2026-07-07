import type { JsonObject } from "../v2/v2.entity";

export const V3_VERSION = "3.0.0";

export const V3_PRINCIPLES = [
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
] as const;

export type V3Module = (typeof V3_MODULES)[number];

export type SecretType =
  | "client_secret"
  | "api_key"
  | "oauth_code"
  | "access_token"
  | "refresh_token"
  | "private_key"
  | "session_cookie";

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
  metadata: JsonObject;
  expires_at: string | null;
  rotated_from_id: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
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
  | "import";
