import type { ConsoleConnection } from "@/lib/api";

// --- Types ---

export type V4OAuthProvider = {
  id: string;
  slug: string;
  display_name: string;
  auth_type: string;
  default_scopes: string[];
  supported_scopes: string[];
  status: string;
  is_builtin: boolean;
  connectable: boolean;
};

export type V4OAuthProviderAdmin = V4OAuthProvider & {
  authorization_url: string | null;
  token_url: string | null;
  userinfo_url: string | null;
  revoke_url: string | null;
  client_id: string | null;
  has_client_secret: boolean;
  pkce_required: boolean;
  login_enabled: boolean;
};

export type V4OAuthConnection = {
  id: string;
  user_id: string;
  provider_id: string;
  provider_slug: string;
  provider_display_name: string;
  provider_account_id: string;
  display_name: string;
  scopes: string[];
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

export type V4AuthProvider = {
  type: "github" | "oidc" | "oauth";
  name: string;
  display_name: string;
  start_path: string;
};

export type V4Agent = {
  id: string;
  name: string;
  owner_user_id: string;
  tenant_id?: string;
  status: string;
  created_at: string;
  updated_at?: string;
};

export type V4AccessRequest = {
  ok: true;
  access_request_id: string;
  agent_id: string;
  provider: string;
  requested_hosts: string[];
  reason: string | null;
  status: "pending" | "approved" | "denied" | "expired";
  user_hint?: string | null;
  expires_at: string;
  type?: "delegation" | "action" | "transaction";
  principal?: { type: string; id: string | null };
  action?: string | null;
  resource?: { provider?: string; hosts?: string[] };
  mandate_id?: string | null;
  decision?: {
    verdict: "approved" | "denied";
    decided_by: string | null;
    decided_at: string | null;
    mandate_id: string | null;
  } | null;
};

export type V4Grant = {
  id: string;
  agent_id: string;
  connection_id: string;
  provider_id: string;
  allowed_hosts: string[];
  allowed_methods: string[];
  status: "active" | "revoked";
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  principal?: { type: string; id: string };
  constraints?: { hosts: string[]; methods: string[]; expires_at: string | null };
  actions?: string[];
  issued_at?: string;
  revoked_at?: string | null;
};

// --- Transport ---

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

async function requestJson<T>(
  connection: ConsoleConnection,
  path: string,
  init?: RequestInit & { admin?: boolean; userSessionToken?: string },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  if (init?.userSessionToken?.trim()) {
    headers.set("authorization", `Bearer ${init.userSessionToken.trim()}`);
  } else if (init?.admin && connection.adminToken.trim()) {
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

// --- Auth / sessions ---

export async function fetchV4AuthMe(connection: ConsoleConnection, userSessionToken?: string) {
  return requestJson<{ ok: true; user_id: string; expires_at: string; session_id: string }>(
    connection,
    "/v4/auth/me",
    userSessionToken ? { userSessionToken } : undefined,
  );
}

export async function fetchV4AuthProviders(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V4AuthProvider[] }>(connection, "/v4/auth/providers");
}

export async function logoutV4User(connection: ConsoleConnection, userSessionToken?: string) {
  return requestJson<{ ok: true; revoked: boolean }>(connection, "/v4/auth/logout", {
    method: "POST",
    ...(userSessionToken ? { userSessionToken } : {}),
  });
}

export function buildV4GitHubStartUrl(connection: ConsoleConnection, redirectAfter: string) {
  const params = new URLSearchParams({ redirect_after: redirectAfter });
  return `${normalizeBaseUrl(connection.baseUrl)}/v4/auth/github/start?${params.toString()}`;
}

export function buildV4OidcStartUrl(
  connection: ConsoleConnection,
  providerName: string,
  redirectAfter: string,
) {
  const params = new URLSearchParams({ redirect_after: redirectAfter });
  return `${normalizeBaseUrl(connection.baseUrl)}/v4/auth/oidc/${encodeURIComponent(providerName)}/start?${params.toString()}`;
}

export function buildV4OAuthLoginStartUrl(
  connection: ConsoleConnection,
  providerSlug: string,
  redirectAfter: string,
) {
  const params = new URLSearchParams({ redirect_after: redirectAfter });
  return `${normalizeBaseUrl(connection.baseUrl)}/v4/auth/oauth/${encodeURIComponent(providerSlug)}/start?${params.toString()}`;
}

export function buildV4AuthProviderStartUrl(
  connection: ConsoleConnection,
  provider: V4AuthProvider,
  redirectAfter: string,
) {
  if (provider.type === "github") {
    return buildV4GitHubStartUrl(connection, redirectAfter);
  }
  if (provider.type === "oauth") {
    return buildV4OAuthLoginStartUrl(connection, provider.name, redirectAfter);
  }
  return buildV4OidcStartUrl(connection, provider.name, redirectAfter);
}

// --- Providers ---

export async function fetchV4Providers(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V4OAuthProvider[] }>(connection, "/v4/providers");
}

export async function fetchV4ProvidersAdmin(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V4OAuthProviderAdmin[] }>(
    connection,
    "/v4/providers/admin",
    { admin: true },
  );
}

export async function createV4Provider(
  connection: ConsoleConnection,
  payload: {
    slug: string;
    display_name: string;
    auth_type?: string;
    discovery_url?: string;
    issuer?: string;
    authorization_url?: string;
    token_url?: string;
    userinfo_url?: string;
    revoke_url?: string;
    client_id?: string;
    client_secret?: string;
    default_scopes?: string[];
    supported_scopes?: string[];
    pkce_required?: boolean;
  },
) {
  return requestJson<{ ok: true; provider: V4OAuthProviderAdmin }>(connection, "/v4/providers", {
    method: "POST",
    body: JSON.stringify(payload),
    admin: true,
  });
}

export async function updateV4ProviderCredentials(
  connection: ConsoleConnection,
  providerId: string,
  payload: { client_id: string; client_secret?: string },
) {
  return requestJson<{ ok: true; provider: V4OAuthProviderAdmin }>(
    connection,
    `/v4/providers/${encodeURIComponent(providerId)}/credentials`,
    { method: "PATCH", body: JSON.stringify(payload), admin: true },
  );
}

// --- OAuth connect + connections ---

export async function startV4OAuthConnect(
  connection: ConsoleConnection,
  payload: { provider_slug: string; redirect_after?: string; scopes?: string[] },
) {
  return requestJson<{ ok: true; authorization_url: string }>(
    connection,
    "/v4/oauth/connect/start",
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function fetchV4Connections(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V4OAuthConnection[] }>(connection, "/v4/connections");
}

export async function revokeV4Connection(connection: ConsoleConnection, connectionId: string) {
  return requestJson<{ ok: true }>(
    connection,
    `/v4/connections/${encodeURIComponent(connectionId)}`,
    { method: "DELETE" },
  );
}

// --- Agents (admin) ---

export async function fetchV4Agents(
  connection: ConsoleConnection,
  filter?: { owner_user_id?: string },
) {
  const params = new URLSearchParams();
  if (filter?.owner_user_id) params.set("owner_user_id", filter.owner_user_id);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson<{ ok: true; items: V4Agent[] }>(connection, `/v4/agents${query}`, {
    admin: true,
  });
}

export async function registerV4Agent(
  connection: ConsoleConnection,
  payload: { name: string; owner_user_id: string; metadata?: Record<string, unknown> },
) {
  return requestJson<{ ok: true; agent: V4Agent; access_token: string }>(
    connection,
    "/v4/agents",
    { method: "POST", body: JSON.stringify(payload), admin: true },
  );
}

export async function revokeV4Agent(connection: ConsoleConnection, agentId: string) {
  return requestJson<{ ok: true; revoked: true }>(
    connection,
    `/v4/agents/${encodeURIComponent(agentId)}`,
    { method: "DELETE", admin: true },
  );
}

// --- Access requests + grants ---

export async function fetchV4AccessRequest(connection: ConsoleConnection, id: string) {
  return requestJson<V4AccessRequest>(
    connection,
    `/v4/access-requests/${encodeURIComponent(id)}`,
  );
}

export async function approveV4AccessRequest(
  connection: ConsoleConnection,
  id: string,
  payload: {
    connection_id: string;
    allowed_hosts?: string[];
    allowed_methods?: string[];
    expires_at?: string;
  },
) {
  return requestJson<{ ok: true; grant: V4Grant }>(
    connection,
    `/v4/access-requests/${encodeURIComponent(id)}/approve`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function denyV4AccessRequest(connection: ConsoleConnection, id: string) {
  return requestJson<{ ok: true; status: "denied" }>(
    connection,
    `/v4/access-requests/${encodeURIComponent(id)}/deny`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function fetchV4Grants(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V4Grant[] }>(connection, "/v4/grants");
}

export async function revokeV4Grant(connection: ConsoleConnection, grantId: string) {
  return requestJson<{ ok: true; status: "revoked" }>(
    connection,
    `/v4/grants/${encodeURIComponent(grantId)}/revoke`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

// --- Devices (iOS authenticator) ---

export type V4Device = {
  id: string;
  platform: string;
  device_name: string;
  status: "active" | "revoked";
  has_push_token: boolean;
  key_registered: boolean;
  last_seen_at: string | null;
  created_at: string;
};

export async function createV4DevicePairingCode(connection: ConsoleConnection) {
  return requestJson<{
    ok: true;
    pairing_code: string;
    qr_payload: string;
    expires_at: string;
    instructions: string;
  }>(connection, "/v4/devices/pairing-codes", { method: "POST", body: JSON.stringify({}) });
}

export async function fetchV4Devices(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V4Device[] }>(connection, "/v4/devices");
}

export async function revokeV4Device(connection: ConsoleConnection, deviceId: string) {
  return requestJson<{ ok: true; status: "revoked" }>(
    connection,
    `/v4/devices/${encodeURIComponent(deviceId)}`,
    { method: "DELETE" },
  );
}

export async function fetchV4AgentId(connection: ConsoleConnection) {
  return requestJson<{
    ok: true;
    user_id: string;
    has_active_share_code: boolean;
    share_code_expires_at: string | null;
    share_with_agent: string;
  }>(connection, "/v4/users/me/agent-id");
}

export async function createV4ShareCode(connection: ConsoleConnection) {
  return requestJson<{
    ok: true;
    user_id: string;
    share_code: string;
    expires_at: string;
    share_with_agent: string;
  }>(connection, "/v4/users/share-codes", { method: "POST", body: JSON.stringify({}) });
}
