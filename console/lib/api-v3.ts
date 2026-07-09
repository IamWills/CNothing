import type { ConsoleConnection } from "@/lib/api";
import {
  type V25ImportCandidate,
  type V25ImportJob,
  type V25OAuthConnection,
  type V25OAuthProvider,
  type V25OAuthProviderAdmin,
  type V2AuditEvent,
  type V2AuthProvider,
  type V2AuthorizationRequest,
  type V2PendingConfirmation,
} from "@/lib/api-v2";

export type V3PlatformStatus = {
  ok: true;
  version: string;
  product: string;
  tagline: string;
  counts: Record<string, number>;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

async function requestJson<T>(
  connection: ConsoleConnection,
  path: string,
  init?: RequestInit & { userSession?: boolean; userSessionToken?: string },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  if (init?.userSessionToken?.trim()) {
    headers.set("authorization", `Bearer ${init.userSessionToken.trim()}`);
  } else if (connection.adminToken.trim()) {
    headers.set("authorization", `Bearer ${connection.adminToken.trim()}`);
  }

  const response = await fetch(`${normalizeBaseUrl(connection.baseUrl)}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message ?? "Request failed")
        : "Request failed";
    throw new Error(message);
  }
  return data as T;
}

export async function fetchV3PlatformStatus(connection: ConsoleConnection) {
  return requestJson<V3PlatformStatus>(connection, "/v3/platform/status", { userSession: false });
}

export async function fetchV3Providers(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V25OAuthProvider[] }>(connection, "/v3/providers");
}

export async function fetchV3ProvidersAdmin(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V25OAuthProviderAdmin[] }>(connection, "/v3/capabilities").catch(
    () => fetchV3Providers(connection).then((response) => ({
      ok: true as const,
      items: response.items as unknown as V25OAuthProviderAdmin[],
    })),
  );
}

export async function startV3OAuthConnect(
  connection: ConsoleConnection,
  payload: {
    provider_slug: string;
    redirect_after?: string;
    scopes?: string[];
    tenant_id?: string;
  },
) {
  return requestJson<{ ok: true; authorization_url: string }>(connection, "/v3/oauth/connect/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function startV3DeviceFlow(
  connection: ConsoleConnection,
  payload: { provider_slug: string; scopes?: string[]; tenant_id?: string },
) {
  return requestJson<{
    ok: true;
    session_id: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string | null;
    expires_at: string;
    poll_interval_seconds: number;
  }>(connection, "/v3/oauth/device/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function pollV3DeviceFlow(connection: ConsoleConnection, sessionId: string) {
  return requestJson<{
    ok: true;
    status: "pending" | "completed" | "expired" | "denied";
    connection_id?: string;
    poll_interval_seconds?: number;
  }>(connection, "/v3/oauth/device/poll", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId }),
  });
}

export async function fetchV3OAuthConnections(connection: ConsoleConnection, tenantId?: string) {
  const query = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  return requestJson<{ ok: true; items: V25OAuthConnection[] }>(
    connection,
    `/v3/oauth/connections${query}`,
  );
}

export async function revokeV3OAuthConnection(connection: ConsoleConnection, connectionId: string) {
  return requestJson<{ ok: true }>(
    connection,
    `/v3/oauth/connections/${encodeURIComponent(connectionId)}`,
    { method: "DELETE" },
  );
}

export async function fetchV3Audit(connection: ConsoleConnection, limit = 50) {
  return requestJson<{ ok: true; items: V2AuditEvent[] }>(connection, `/v3/audit?limit=${limit}`);
}

export async function importV3OpenApiSpec(
  connection: ConsoleConnection,
  payload: { content?: string; url?: string; filename?: string; provider_slug?: string },
) {
  return requestJson<{ ok: true; job: V25ImportJob }>(connection, "/v3/import/openapi", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchV3ImportOpenApiJob(connection: ConsoleConnection, jobId: string) {
  return requestJson<{ ok: true; job: V25ImportJob }>(
    connection,
    `/v3/import/openapi/${encodeURIComponent(jobId)}`,
  );
}

export async function activateV3OpenApiCapabilities(
  connection: ConsoleConnection,
  payload: {
    job_id: string;
    candidate_names: string[];
    provider_slug?: string;
  },
) {
  return requestJson<{ ok: true; activated: number }>(
    connection,
    "/v3/capabilities/generate-from-openapi",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function importV3McpManifest(
  connection: ConsoleConnection,
  payload: { url: string; provider_slug?: string },
) {
  return requestJson<{ ok: true; job: V25ImportJob }>(connection, "/v3/import/mcp", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function approveV3Authorization(
  connection: ConsoleConnection,
  authorizationId: string,
  payload: { connection_id: string; scopes?: string[]; expires_at?: string },
) {
  return requestJson<{ ok: true }>(
    connection,
    `/v3/approve/${encodeURIComponent(authorizationId)}`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export type V3Agent = {
  id: string;
  name: string;
  owner_user_id: string;
  tenant_id?: string;
  status: string;
  public_key_pem: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type V3Grant = {
  id: string;
  user_id: string;
  agent_id: string;
  capability_id: string;
  scopes: string[];
  expires_at: string | null;
  revoked: boolean;
  provider_id?: string | null;
  connection_id?: string | null;
  grant_status?: string | null;
  last_used_at?: string | null;
  capability_name: string;
  capability_description: string;
  agent_name: string;
  connector_provider: string;
  created_at: string;
};

export type V3Capability = {
  id: string;
  name: string;
  description: string;
  capability_type: string;
  scopes: string[];
  risk_level: string;
  status?: string;
};

export async function fetchV3Agents(
  connection: ConsoleConnection,
  filter?: { owner_user_id?: string; tenant_id?: string },
) {
  const params = new URLSearchParams();
  if (filter?.owner_user_id) params.set("owner_user_id", filter.owner_user_id);
  if (filter?.tenant_id) params.set("tenant_id", filter.tenant_id);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson<{ ok: true; items: V3Agent[] }>(connection, `/v3/agents${query}`);
}

export async function registerV3Agent(
  connection: ConsoleConnection,
  payload: {
    name: string;
    owner_user_id: string;
    tenant_id?: string;
    public_key_pem?: string;
    metadata?: Record<string, unknown>;
  },
) {
  return requestJson<{ ok: true; agent: V3Agent; access_token: string }>(
    connection,
    "/v3/agents/register",
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function fetchV3Grants(
  connection: ConsoleConnection,
  filter?: { user_id?: string; agent_id?: string; tenant_id?: string },
) {
  const params = new URLSearchParams();
  if (filter?.user_id) params.set("user_id", filter.user_id);
  if (filter?.agent_id) params.set("agent_id", filter.agent_id);
  if (filter?.tenant_id) params.set("tenant_id", filter.tenant_id);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson<{ ok: true; items: V3Grant[] }>(connection, `/v3/grants${query}`);
}

export async function createV3Grant(
  connection: ConsoleConnection,
  payload: { user_id: string; agent_id: string; capability: string; scopes?: string[] },
) {
  return requestJson<{ ok: true; grant: V3Grant & { capability: string } }>(connection, "/v3/grants", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function revokeV3Grant(connection: ConsoleConnection, grantId: string) {
  return requestJson<{ ok: true; grant: V3Grant }>(connection, "/v3/grants/revoke", {
    method: "POST",
    body: JSON.stringify({ grant_id: grantId }),
  });
}

export async function fetchV3Capabilities(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V3Capability[] }>(connection, "/v3/capabilities");
}

export async function fetchV3AuthMe(connection: ConsoleConnection, userSessionToken?: string) {
  return requestJson<{
    ok: true;
    user_id: string;
    expires_at: string;
    session_id: string;
  }>(connection, "/v3/auth/me", userSessionToken ? { userSessionToken } : undefined);
}

export async function fetchV3AuthProviders(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V2AuthProvider[] }>(connection, "/v3/auth/providers");
}

export async function issueV3LoginToken(connection: ConsoleConnection, userId: string) {
  return requestJson<{ ok: true; login_token: string; user_id: string; expires_at: string }>(
    connection,
    "/v3/auth/login-tokens",
    {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    },
  );
}

export async function loginV3User(
  connection: ConsoleConnection,
  payload: { user_id: string; login_token: string },
) {
  return requestJson<{ ok: true; session_token: string; user_id: string; expires_at: string }>(
    connection,
    "/v3/auth/login",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function logoutV3User(connection: ConsoleConnection, userSessionToken: string) {
  return requestJson<{ ok: true; revoked: boolean }>(connection, "/v3/auth/logout", {
    method: "POST",
    userSessionToken,
  });
}

export function buildV3GitHubStartUrl(connection: ConsoleConnection, redirectAfter: string) {
  const params = new URLSearchParams({ redirect_after: redirectAfter });
  return `${normalizeBaseUrl(connection.baseUrl)}/v3/auth/github/start?${params.toString()}`;
}

export function buildV3OidcStartUrl(
  connection: ConsoleConnection,
  providerName: string,
  redirectAfter: string,
) {
  const params = new URLSearchParams({ redirect_after: redirectAfter });
  return `${normalizeBaseUrl(connection.baseUrl)}/v3/auth/oidc/${encodeURIComponent(providerName)}/start?${params.toString()}`;
}

export async function fetchV3AuthorizationRequest(
  connection: ConsoleConnection,
  requestId: string,
) {
  return requestJson<{ ok: true; authorization_request: V2AuthorizationRequest }>(
    connection,
    `/v3/authorize/${encodeURIComponent(requestId)}`,
  );
}

export async function approveV3AuthorizationRequest(
  connection: ConsoleConnection,
  payload: { authorization_request_id: string; granted_capabilities?: string[] },
  userSessionToken?: string,
) {
  return requestJson<{ ok: true }>(connection, "/v3/authorize/approve", {
    method: "POST",
    body: JSON.stringify(payload),
    ...(userSessionToken ? { userSessionToken } : {}),
  });
}

export async function denyV3AuthorizationRequest(
  connection: ConsoleConnection,
  authorizationRequestId: string,
  userSessionToken?: string,
) {
  return requestJson<{ ok: true }>(connection, "/v3/authorize/deny", {
    method: "POST",
    body: JSON.stringify({ authorization_request_id: authorizationRequestId }),
    ...(userSessionToken ? { userSessionToken } : {}),
  });
}

export async function fetchV3PendingConfirmations(
  connection: ConsoleConnection,
  userSessionToken?: string,
) {
  return requestJson<{ ok: true; items: V2PendingConfirmation[] }>(
    connection,
    "/v3/confirmations/pending",
    userSessionToken ? { userSessionToken } : undefined,
  );
}

export async function approveV3PendingConfirmation(
  connection: ConsoleConnection,
  confirmationId: string,
  userSessionToken?: string,
) {
  return requestJson<{ ok: true }>(connection, "/v3/confirmations/approve", {
    method: "POST",
    body: JSON.stringify({ confirmation_id: confirmationId }),
    ...(userSessionToken ? { userSessionToken } : {}),
  });
}

export async function rejectV3PendingConfirmation(
  connection: ConsoleConnection,
  confirmationId: string,
  userSessionToken?: string,
) {
  return requestJson<{ ok: true }>(connection, "/v3/confirmations/reject", {
    method: "POST",
    body: JSON.stringify({ confirmation_id: confirmationId }),
    ...(userSessionToken ? { userSessionToken } : {}),
  });
}

export type GatewayApproval = {
  approval_id: string;
  status: string;
  capability_id: string;
  agent_id?: string;
  safe_summary: string;
  risk_level: string;
  scopes?: string[];
  resource_key?: string | null;
  expires_at: string;
  approved_at?: string | null;
  rejected_at?: string | null;
  created_at?: string;
};

export type GatewayCapability = {
  id: string;
  name: string;
  display_name: string | null;
  description: string;
  provider: string | null;
  required_scopes: string[];
  execution_type: string;
  risk_level: string;
  approval_policy: string;
  status: string;
};

export type GatewayPolicyBundle = {
  ok: true;
  policies: Array<{
    id: string;
    capability_pattern: string | null;
    action: string;
    priority: number;
    enabled: boolean;
    metadata: Record<string, unknown>;
  }>;
  capability_permissions: Array<{
    id: string;
    agent_id: string | null;
    capability_pattern: string | null;
    effect: string;
    require_approval: boolean | null;
    rate_limit_per_minute: number | null;
    priority: number;
    enabled: boolean;
    metadata: Record<string, unknown>;
  }>;
};

export type GatewayAuditEvent = {
  id: string;
  event_type: string;
  agent_id: string | null;
  user_id: string | null;
  capability_id: string | null;
  execution_id: string | null;
  approval_id: string | null;
  input_summary: string | null;
  risk_level: string | null;
  result: string | null;
  created_at: string;
};

export async function fetchGatewayCapabilities(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: GatewayCapability[] }>(
    connection,
    "/api/v3/capabilities",
  );
}

export async function fetchGatewayApprovals(
  connection: ConsoleConnection,
  status?: string,
) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return requestJson<{ ok: true; items: GatewayApproval[] }>(
    connection,
    `/api/v3/approvals${query}`,
  );
}

export async function fetchGatewayApproval(
  connection: ConsoleConnection,
  approvalId: string,
) {
  return requestJson<{ ok: true } & GatewayApproval>(
    connection,
    `/api/v3/approvals/${encodeURIComponent(approvalId)}`,
  );
}

export async function decideGatewayApproval(
  connection: ConsoleConnection,
  approvalId: string,
  decision: "approved" | "rejected",
  token?: string,
) {
  return requestJson<{ ok: true; approval_id: string; status: string; execution?: unknown }>(
    connection,
    `/api/v3/approvals/${encodeURIComponent(approvalId)}/decide`,
    {
      method: "POST",
      body: JSON.stringify({ decision, token }),
    },
  );
}

export async function fetchGatewayPolicies(connection: ConsoleConnection) {
  return requestJson<GatewayPolicyBundle>(connection, "/api/v3/policies");
}

export async function fetchGatewayAudit(connection: ConsoleConnection, limit = 50) {
  return requestJson<{ ok: true; items: GatewayAuditEvent[] }>(
    connection,
    `/api/v3/audit?limit=${limit}`,
  );
}

export type { V25ImportCandidate, V25ImportJob, V25OAuthConnection, V25OAuthProvider, V2AuthProvider, V2AuthorizationRequest, V2PendingConfirmation };
