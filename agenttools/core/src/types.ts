export type JsonObject = Record<string, unknown>;

export type EnrollmentState = {
  enrollment_id: string;
  enrollment_secret: string;
  approval_url: string;
  user_code: string;
  expires_at: string;
};

export type CredentialStore = {
  readToken(): Promise<string>;
  writeToken(token: string): Promise<void>;
  readEnrollment(): Promise<EnrollmentState | null>;
  writeEnrollment(state: EnrollmentState | null): Promise<void>;
};

export type AgentToolName =
  | "list_grants"
  | "list_providers"
  | "request_access"
  | "get_access_status"
  | "proxy_request";

export type EnrollmentRequired = {
  ok: false;
  status: "enrollment_required";
  next_action: "wait_for_user";
  retry_after_seconds: number;
  user_action: {
    message: string;
    approval_url: string;
    user_code: string;
  };
  expires_at: string;
};

export type IdentityReady = {
  status: "ready";
};

export type Identity = IdentityReady | EnrollmentRequired;

export type AgentError = {
  ok: false;
  status: "error";
  next_action: "inspect_error";
  error: { message: string };
};

export type ToolResult = EnrollmentRequired | AgentError | Record<string, unknown>;

export type RequestAccessInput = {
  provider: string;
  reason: string;
  user_id?: string;
  hosts?: string[];
  callback_url?: string;
  issuer?: string;
  discovery_url?: string;
};

export type GetAccessStatusInput = {
  access_request_id: string;
};

export type ProxyRequestInput = {
  grant_id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  idempotency_key?: string;
};

export type AgentOptions = {
  baseUrl?: string;
  clientName?: string;
  softwareId?: string;
  store?: CredentialStore;
  fetch?: typeof fetch;
};
