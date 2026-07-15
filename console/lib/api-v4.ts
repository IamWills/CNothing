import type { ConsoleConnection } from "@/lib/api";
import type { V25OAuthConnection } from "@/lib/api-v2";

export type V4AccessRequest = {
  ok: true;
  access_request_id: string;
  agent_id: string;
  provider: string;
  requested_hosts: string[];
  reason: string | null;
  status: "pending" | "approved" | "denied" | "expired";
  expires_at: string;
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

export async function fetchV4Connections(connection: ConsoleConnection) {
  return requestJson<{ ok: true; items: V25OAuthConnection[] }>(connection, "/v4/connections");
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
