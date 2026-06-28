export type JsonObject = Record<string, unknown>;
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export type CNothingAgentApiVersion = "v2" | "v2.5" | "v2.6";

export type CNothingAgentClientConfig = {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof fetch;
  /** Defaults to v2.5 (OAuth broker + capability gateway). Set to v2 for legacy endpoints. */
  apiVersion?: CNothingAgentApiVersion;
};

/** @deprecated Use AgentCapabilityView — kept for backward compatibility. */
export type CapabilitySummary = AgentCapabilityView;

export type AgentCapabilityView = {
  name: string;
  display_name: string;
  description: string;
  capability_type: "ACTION" | "QUERY" | "CONFIDENTIAL_QUERY";
  risk_level: "PUBLIC" | "LOW" | "MEDIUM" | "HIGH" | "CONFIDENTIAL";
  required_scopes: string[];
  input_schema: JsonObject;
  output_schema: JsonObject;
  connection_required: boolean;
  authorized: boolean;
  grant_status: "pending" | "approved" | "denied" | "expired" | "revoked" | null;
};

export type InvokeCapabilityRequest = {
  capability: string;
  input?: JsonObject;
  user_id?: string;
  reason?: string;
  confirmation_id?: string;
  request_id?: string;
};

export type InvokeCapabilitySuccess = {
  ok: true;
  request_id: string;
  capability: string;
  result: unknown;
};

export type InvokeCapabilityPending = {
  ok: false;
  pending: true;
  confirmation_id: string;
  policy_decision: {
    action: string;
    matched_policy_id: string | null;
    reason: string | null;
  };
  expires_at: string;
  message: string;
};

export type AuthorizationRequiredResponse = {
  ok: false;
  error_code: "authorization_required";
  message: string;
  capability?: string;
  approval_url?: string;
  hint?: string;
};

export type AgentAuthorizationResponse = {
  authorization_id: string;
  approval_url: string;
  status: "pending";
};

export type AgentAuthorizationStatusResponse = {
  authorization_id: string;
  status: string;
  capability: string | null;
  granted_capabilities: string[];
  expires_at: string;
  approved_at: string | null;
  denied_at: string | null;
  capability_details: {
    name: string;
    risk_level: string;
    scopes: string[];
  } | null;
};

export type AgentGrantSummary = {
  id: string;
  capability: string;
  agent_name: string;
  scopes: string[];
  expires_at: string | null;
  revoked: boolean;
  status: string;
  connection_id: string | null;
  provider_id: string | null;
  last_used_at: string | null;
  created_at: string;
};

/** Legacy v2 authorization request (multi-capability). */
export type AuthorizationRequestResponse = {
  ok: true;
  authorization_request: {
    id: string;
    status: string;
    user_id: string;
    agent_id: string;
    agent_name: string;
    requested_capabilities: string[];
    expires_at: string;
    approval_url: string;
    state: string | null;
  };
};

/** Legacy v2 authorization status. */
export type AuthorizationRequestStatusResponse = {
  ok: true;
  authorization_request: {
    id: string;
    status: string;
    user_id: string;
    agent_id: string;
    agent_name: string;
    requested_capabilities: string[];
    granted_capabilities: string[];
    expires_at: string;
    approved_at: string | null;
    denied_at: string | null;
    capabilities: CapabilitySummary[];
  };
};

export type RequestAuthorizationV25Input = {
  capability: string;
  reason?: string;
  requested_scopes?: string[];
};

export type RequestAuthorizationV2Input = {
  capabilities: string[];
  user_id?: string;
  redirect_uri?: string;
  state?: string;
  reason?: string;
};

export class CNothingAgentError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "CNothingAgentError";
    this.statusCode = statusCode;
    this.details = details;
  }

  get errorCode(): string | undefined {
    if (this.details && typeof this.details === "object" && "error_code" in this.details) {
      return String((this.details as { error_code?: string }).error_code);
    }
    return undefined;
  }

  get isAuthorizationRequired(): boolean {
    return this.errorCode === "authorization_required";
  }
}
