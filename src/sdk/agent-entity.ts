export type JsonObject = Record<string, unknown>;
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export type CNothingAgentClientConfig = {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof fetch;
};

export type CapabilitySummary = {
  id: string;
  name: string;
  description: string;
  connector_id: string;
  capability_type: "ACTION" | "QUERY" | "CONFIDENTIAL_QUERY";
  scopes: string[];
  risk_level: "PUBLIC" | "LOW" | "MEDIUM" | "HIGH" | "CONFIDENTIAL";
  input_schema: JsonObject;
  output_schema: JsonObject;
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

export class CNothingAgentError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = "CNothingAgentError";
    this.statusCode = statusCode;
    this.details = details;
  }
}
