export type AuthaiPublicKey = {
  algorithm: string;
  key_id: string;
  public_key_pem: string;
  public_key_fingerprint: string;
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
};

export type SkillEntry = {
  id: string;
  name: string;
  description: string;
  file_path: string;
  body_markdown: string;
};

export type ClientSummary = {
  client_uuid: string;
  public_key_fingerprint: string;
  key_alg: string;
  key_id: string | null;
  client_label: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  namespace_count: number;
  kv_count: number;
  last_activity_at: string | null;
};

export type NamespaceSummary = {
  namespace: string;
  key_count: number;
  last_updated_at: string | null;
};

export type KvRecordSummary = {
  id: string;
  client_uuid: string;
  namespace: string;
  record_key: string;
  value_fingerprint: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_read_at: string | null;
};

export type KvValueResponse = {
  ok: true;
  client_uuid: string;
  namespace: string;
  key: string;
  value: unknown;
  metadata: Record<string, unknown>;
  value_fingerprint: string;
  updated_at: string;
  last_read_at: string | null;
};

export type RegisterClientResponse = {
  ok: true;
  client_uuid: string;
  client_key_fingerprint: string;
  authai_public_key: AuthaiPublicKey;
  challenge_for_client: Record<string, unknown>;
  challenge_id: string;
  challenge_expires_at: string;
};

export type ConsoleConnection = {
  baseUrl: string;
  adminToken: string;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

async function requestJson<T>(
  connection: ConsoleConnection,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  if (connection.adminToken.trim()) {
    headers.set("authorization", `Bearer ${connection.adminToken.trim()}`);
  }

  const response = await fetch(`${normalizeBaseUrl(connection.baseUrl)}${path}`, {
    ...init,
    headers,
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

export async function fetchAuthaiPublicKey(connection: ConsoleConnection) {
  return requestJson<{ ok: true; authai_public_key: AuthaiPublicKey }>(
    connection,
    "/v1/authai/public-key",
  );
}

export async function fetchMcpCatalog(connection: ConsoleConnection) {
  return requestJson<{ ok: true; tools: McpTool[]; resources: McpResource[] }>(
    connection,
    "/v1/catalog/mcp",
  );
}

export async function fetchSkills(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: SkillEntry[] }>(connection, "/v1/catalog/skills");
}

export async function fetchClients(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: ClientSummary[] }>(connection, "/v1/admin/clients");
}

export async function registerClient(
  connection: ConsoleConnection,
  payload: Record<string, unknown>,
) {
  return requestJson<RegisterClientResponse>(connection, "/v1/admin/clients/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchNamespaces(connection: ConsoleConnection, clientUuid: string) {
  return requestJson<{ ok: true; client_uuid: string; items: NamespaceSummary[] }>(
    connection,
    `/v1/admin/clients/${clientUuid}/namespaces`,
  );
}

export async function fetchKvList(
  connection: ConsoleConnection,
  clientUuid: string,
  namespace: string,
) {
  const params = new URLSearchParams({ namespace });
  return requestJson<{ ok: true; client_uuid: string; namespace: string; items: KvRecordSummary[] }>(
    connection,
    `/v1/admin/clients/${clientUuid}/kv?${params.toString()}`,
  );
}

export async function fetchKvValue(
  connection: ConsoleConnection,
  clientUuid: string,
  namespace: string,
  key: string,
) {
  const params = new URLSearchParams({ namespace, key });
  return requestJson<KvValueResponse>(
    connection,
    `/v1/admin/clients/${clientUuid}/kv/value?${params.toString()}`,
  );
}

export async function savePlaintextKv(
  connection: ConsoleConnection,
  clientUuid: string,
  payload: {
    namespace: string;
    items: Array<{ key: string; value: unknown; metadata?: Record<string, unknown> }>;
  },
) {
  return requestJson<{ ok: true; client_uuid: string; namespace: string; saved_keys: string[] }>(
    connection,
    `/v1/admin/clients/${clientUuid}/kv/save`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}
