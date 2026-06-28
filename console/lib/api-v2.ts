import type { ConsoleConnection } from "@/lib/api";

export type V2Agent = {
  id: string;
  name: string;
  owner_user_id: string;
  status: string;
  public_key_pem: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type V2Connector = {
  id: string;
  provider: string;
  display_name: string;
  callback_url: string;
  jwks_url: string | null;
  status: string;
};

export type V2Capability = {
  id: string;
  name: string;
  description: string;
  connector_id: string;
  capability_type: string;
  scopes: string[];
  risk_level: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  provider_id?: string | null;
  display_name?: string | null;
  connection_required?: boolean;
  source?: string | null;
  invocation_type?: string | null;
  invocation_config?: Record<string, unknown>;
  policy_config?: Record<string, unknown>;
  status?: string;
};

export type V2Grant = {
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

export type V2AuthorizationRequest = {
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
  redirect_uri: string | null;
  state: string | null;
  reason: string | null;
  capabilities: Array<{
    name: string;
    description: string;
    capability_type: string;
    risk_level: string;
    scopes: string[];
  }>;
};

export type V2PendingConfirmation = {
  id: string;
  user_id: string;
  agent_id: string;
  capability_id: string;
  capability_name: string;
  agent_name: string;
  input: Record<string, unknown>;
  reason: string | null;
  expires_at: string;
  created_at: string;
};

export type V2AuditEvent = {
  id: string;
  user_id: string | null;
  agent_id: string | null;
  capability_name: string;
  connector_id: string | null;
  provider_id?: string | null;
  connection_id?: string | null;
  policy_decision: string;
  status: string;
  request_id: string | null;
  error_code: string | null;
  input_hash?: string | null;
  output_hash?: string | null;
  success?: boolean | null;
  risk_level?: string | null;
  created_at: string;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

type RequestOptions = RequestInit & {
  userSessionToken?: string | undefined;
};

function withSessionOptions(userSessionToken?: string): Pick<RequestOptions, "userSessionToken"> {
  return userSessionToken ? { userSessionToken } : {};
}

async function requestJson<T>(
  connection: ConsoleConnection,
  path: string,
  init?: RequestOptions,
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
    credentials: init?.credentials ?? "include",
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

export async function fetchV2Agents(connection: ConsoleConnection, ownerUserId?: string) {
  const query = ownerUserId ? `?owner_user_id=${encodeURIComponent(ownerUserId)}` : "";
  return requestJson<{ ok: true; items: V2Agent[] }>(connection, `/v2/agents${query}`);
}

export async function registerV2Agent(
  connection: ConsoleConnection,
  payload: {
    name: string;
    owner_user_id: string;
    public_key_pem?: string;
    metadata?: Record<string, unknown>;
  },
) {
  return requestJson<{ ok: true; agent: V2Agent; access_token: string }>(
    connection,
    "/v2/agents/register",
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function fetchV2Connectors(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V2Connector[] }>(connection, "/v2/connectors");
}

export async function registerV2Connector(
  connection: ConsoleConnection,
  payload: Record<string, unknown>,
) {
  return requestJson<{ ok: true; connector: V2Connector }>(connection, "/v2/connectors/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchV2Capabilities(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V2Capability[] }>(connection, "/v2/capabilities");
}

export async function registerV2Capability(
  connection: ConsoleConnection,
  payload: Record<string, unknown>,
) {
  return requestJson<{ ok: true; capability: V2Capability }>(
    connection,
    "/v2/capabilities/register",
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function fetchV2Grants(connection: ConsoleConnection, filter?: {
  user_id?: string;
  agent_id?: string;
}) {
  const params = new URLSearchParams();
  if (filter?.user_id) params.set("user_id", filter.user_id);
  if (filter?.agent_id) params.set("agent_id", filter.agent_id);
  const query = params.toString() ? `?${params.toString()}` : "";
  return requestJson<{ ok: true; items: V2Grant[] }>(connection, `/v2/grants${query}`);
}

export async function createV2Grant(connection: ConsoleConnection, payload: Record<string, unknown>) {
  return requestJson<{ ok: true; grant: V2Grant & { capability: string } }>(connection, "/v2/grants", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function revokeV2Grant(connection: ConsoleConnection, grantId: string) {
  return requestJson<{ ok: true; grant: V2Grant }>(connection, "/v2/grants/revoke", {
    method: "POST",
    body: JSON.stringify({ grant_id: grantId }),
  });
}

export async function fetchAuthorizationRequest(connection: ConsoleConnection, requestId: string) {
  return requestJson<{ ok: true; authorization_request: V2AuthorizationRequest }>(
    connection,
    `/v2/authorize/${encodeURIComponent(requestId)}`,
  );
}

export async function approveAuthorizationRequest(
  connection: ConsoleConnection,
  payload: { authorization_request_id: string; granted_capabilities?: string[] },
  userSessionToken?: string,
) {
  return requestJson<{ ok: true }>(connection, "/v2/authorize/approve", {
    method: "POST",
    body: JSON.stringify(payload),
    ...(withSessionOptions(userSessionToken)),
  });
}

export async function denyAuthorizationRequest(
  connection: ConsoleConnection,
  authorizationRequestId: string,
  userSessionToken?: string,
) {
  return requestJson<{ ok: true }>(connection, "/v2/authorize/deny", {
    method: "POST",
    body: JSON.stringify({ authorization_request_id: authorizationRequestId }),
    ...(withSessionOptions(userSessionToken)),
  });
}

export async function fetchPendingConfirmations(
  connection: ConsoleConnection,
  userSessionToken?: string,
) {
  return requestJson<{ ok: true; items: V2PendingConfirmation[] }>(
    connection,
    "/v2/confirmations/pending",
    withSessionOptions(userSessionToken),
  );
}

export async function approvePendingConfirmation(
  connection: ConsoleConnection,
  confirmationId: string,
  userSessionToken?: string,
) {
  return requestJson<{ ok: true }>(connection, "/v2/confirmations/approve", {
    method: "POST",
    body: JSON.stringify({ confirmation_id: confirmationId }),
    ...withSessionOptions(userSessionToken),
  });
}

export async function rejectPendingConfirmation(
  connection: ConsoleConnection,
  confirmationId: string,
  userSessionToken?: string,
) {
  return requestJson<{ ok: true }>(connection, "/v2/confirmations/reject", {
    method: "POST",
    body: JSON.stringify({ confirmation_id: confirmationId }),
    ...withSessionOptions(userSessionToken),
  });
}

export async function fetchV2Audit(connection: ConsoleConnection, limit = 50) {
  return requestJson<{ ok: true; items: V2AuditEvent[] }>(
    connection,
    `/v2/audit?limit=${limit}`,
  );
}

export async function issueLoginToken(connection: ConsoleConnection, userId: string) {
  return requestJson<{ ok: true; login_token: string; user_id: string; expires_at: string }>(
    connection,
    "/v2/auth/login-tokens",
    {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    },
  );
}

export async function loginUser(
  connection: ConsoleConnection,
  payload: { user_id: string; login_token: string },
) {
  return requestJson<{ ok: true; session_token: string; user_id: string; expires_at: string }>(
    connection,
    "/v2/auth/login",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchCurrentUser(connection: ConsoleConnection, userSessionToken: string) {
  return requestJson<{ ok: true; user_id: string; expires_at: string; session_id: string }>(
    connection,
    "/v2/auth/me",
    { userSessionToken },
  );
}

export async function logoutUser(connection: ConsoleConnection, userSessionToken: string) {
  return requestJson<{ ok: true; revoked: boolean }>(connection, "/v2/auth/logout", {
    method: "POST",
    userSessionToken,
  });
}

export type V2PlatformStatus = {
  ok: true;
  platform: {
    name: string;
    version: string;
    primary_api: string;
    openapi: string;
    jwks: string;
  };
  v1: {
    deprecated: boolean;
    sunset_at: string;
    successor_version: string;
    successor_openapi: string;
    migration_guide: string;
    replacement: string;
  };
  counts: {
    agents: number;
    capabilities: number;
    connectors: number;
    active_grants: number;
  };
};

export type V2MigrationGuide = {
  ok: true;
  guide: {
    summary: string;
    sunset_at: string;
    steps: string[];
    mappings: Array<{ namespace_pattern: string; suggested_capability: string }>;
  };
};

export type V2KvInventoryItem = {
  client_uuid: string;
  namespace: string;
  record_key: string;
  value_fingerprint: string;
  updated_at: string;
  suggested_capability: string | null;
};

export type V2OidcProvider = {
  id: string;
  name: string;
  display_name: string;
  issuer: string;
  scopes: string;
};

export async function fetchPlatformStatus(connection: ConsoleConnection) {
  return requestJson<V2PlatformStatus>(connection, "/v2/platform/status");
}

export async function fetchMigrationGuide(connection: ConsoleConnection) {
  return requestJson<V2MigrationGuide>(connection, "/v2/platform/migration");
}

export async function fetchKvInventory(connection: ConsoleConnection, limit = 500) {
  return requestJson<{ ok: true; items: V2KvInventoryItem[]; total: number }>(
    connection,
    `/v2/admin/migration/kv-inventory?limit=${limit}`,
  );
}

export async function migrateKvToCredential(
  connection: ConsoleConnection,
  payload: {
    client_uuid: string;
    namespace: string;
    record_key: string;
    connector_id: string;
    owner_user_id: string;
  },
) {
  return requestJson<{ ok: true; migration: Record<string, unknown> }>(
    connection,
    "/v2/admin/migration/kv-to-credential",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export type V2AuthProvider = {
  type: "github" | "oidc";
  name: string;
  display_name: string;
  start_path: string;
};

export async function fetchAuthMe(connection: ConsoleConnection) {
  return requestJson<{
    ok: true;
    user_id: string;
    expires_at: string;
    session_id: string;
  }>(connection, "/v2/auth/me");
}

export async function fetchAuthProviders(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V2AuthProvider[] }>(connection, "/v2/auth/providers");
}

export function buildGitHubStartUrl(connection: ConsoleConnection, redirectAfter: string) {
  const params = new URLSearchParams({ redirect_after: redirectAfter });
  return `${normalizeBaseUrl(connection.baseUrl)}/v2/auth/github/start?${params.toString()}`;
}

export async function fetchOidcProviders(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V2OidcProvider[] }>(connection, "/v2/auth/oidc/providers");
}

export function buildOidcStartUrl(connection: ConsoleConnection, providerName: string, redirectAfter: string) {
  const params = new URLSearchParams({ redirect_after: redirectAfter });
  return `${normalizeBaseUrl(connection.baseUrl)}/v2/auth/oidc/${encodeURIComponent(providerName)}/start?${params.toString()}`;
}

export type V25OAuthProvider = {
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

export type V25OAuthProviderAdmin = V25OAuthProvider & {
  authorization_url: string | null;
  token_url: string | null;
  userinfo_url: string | null;
  revoke_url: string | null;
  client_id: string | null;
  has_client_secret: boolean;
  pkce_required: boolean;
};

export type V25OAuthConnection = {
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

export async function fetchOAuthProviders(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V25OAuthProvider[] }>(connection, "/v2/oauth/providers");
}

export async function fetchOAuthProvidersAdmin(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V25OAuthProviderAdmin[] }>(
    connection,
    "/v2/admin/oauth/providers",
  );
}

export async function createOAuthProvider(
  connection: ConsoleConnection,
  payload: {
    slug: string;
    display_name: string;
    auth_type?: string;
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
  return requestJson<{ ok: true; provider: V25OAuthProvider }>(connection, "/v2/oauth/providers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateOAuthProviderCredentials(
  connection: ConsoleConnection,
  providerId: string,
  payload: { client_id: string; client_secret?: string },
) {
  return requestJson<{ ok: true; provider: V25OAuthProviderAdmin }>(
    connection,
    `/v2/oauth/providers/${encodeURIComponent(providerId)}/credentials`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}

export async function startOAuthConnect(
  connection: ConsoleConnection,
  payload: { provider_slug: string; redirect_after?: string; scopes?: string[] },
) {
  return requestJson<{ ok: true; authorization_url: string }>(connection, "/v2/oauth/connect/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchOAuthConnections(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V25OAuthConnection[] }>(connection, "/v2/oauth/connections");
}

export async function revokeOAuthConnection(connection: ConsoleConnection, connectionId: string) {
  return requestJson<{ ok: true }>(
    connection,
    `/v2/oauth/connections/${encodeURIComponent(connectionId)}`,
    { method: "DELETE" },
  );
}

export async function approveV25Authorization(
  connection: ConsoleConnection,
  authorizationId: string,
  payload: { connection_id: string; scopes?: string[]; expires_at?: string },
) {
  return requestJson<{ ok: true }>(
    connection,
    `/v2/approve/${encodeURIComponent(authorizationId)}`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export type V25ImportCandidate = {
  name: string;
  display_name: string;
  description: string;
  capability_type: string;
  risk_level: string;
  required_scopes: string[];
  enabled: boolean;
  invocation_type?: string;
  invocation_config?: Record<string, unknown>;
};

export type V25ImportJob = {
  id: string;
  import_type: "openapi" | "mcp";
  status: string;
  candidate_count: number;
  candidates: V25ImportCandidate[];
  error_message: string | null;
  provider_id: string | null;
  source_url?: string | null;
  source_filename?: string | null;
  created_at: string;
  updated_at: string;
};

export async function importOpenApiSpec(
  connection: ConsoleConnection,
  payload: {
    content?: string;
    url?: string;
    filename?: string;
    provider_id?: string;
    provider_slug?: string;
  },
) {
  return requestJson<{ ok: true; job: V25ImportJob }>(connection, "/v2/import/openapi", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchOpenApiImportJob(connection: ConsoleConnection, jobId: string) {
  return requestJson<{ ok: true; job: V25ImportJob }>(
    connection,
    `/v2/import/openapi/${encodeURIComponent(jobId)}`,
  );
}

export async function activateOpenApiCapabilities(
  connection: ConsoleConnection,
  payload: {
    job_id: string;
    candidate_names: string[];
    provider_id?: string;
    provider_slug?: string;
    connector_id?: string;
  },
) {
  return requestJson<{ ok: true; activated: number }>(connection, "/v2/capabilities/from-openapi", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function importMcpManifestSpec(
  connection: ConsoleConnection,
  payload: {
    manifest: Record<string, unknown>;
    provider_id?: string;
    provider_slug?: string;
  },
) {
  return requestJson<{ ok: true; job: V25ImportJob }>(connection, "/v2/import/mcp", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchMcpImportJob(connection: ConsoleConnection, jobId: string) {
  return requestJson<{ ok: true; job: V25ImportJob }>(
    connection,
    `/v2/import/mcp/${encodeURIComponent(jobId)}`,
  );
}

export async function activateMcpCapabilities(
  connection: ConsoleConnection,
  payload: {
    job_id: string;
    candidate_names: string[];
    provider_id?: string;
    provider_slug?: string;
    connector_id?: string;
  },
) {
  return requestJson<{ ok: true; activated: number }>(connection, "/v2/capabilities/from-mcp", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
