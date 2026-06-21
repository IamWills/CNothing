/**
 * Bootstrap the built-in Search connector and capabilities on CNothing.
 *
 * Usage:
 *   CNOTHING_BASE_URL=https://cnothing.com \
 *   CNOTHING_ADMIN_TOKEN=... \
 *   bun run examples/search-connector/bootstrap.ts
 */

const baseUrl = (process.env.CNOTHING_BASE_URL ?? "http://127.0.0.1:3021").replace(/\/+$/, "");
const adminToken = process.env.CNOTHING_ADMIN_TOKEN ?? process.env.KEYSERVICE_BEARER_TOKEN ?? "";

if (!adminToken) {
  throw new Error("CNOTHING_ADMIN_TOKEN or KEYSERVICE_BEARER_TOKEN is required");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new Error(
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message ?? "Request failed")
        : `Request failed: ${response.status}`,
    );
  }
  return data as T;
}

const result = await request<{ ok: true; connector_id: string; capabilities: string[] }>(
  "/v2/admin/search/bootstrap",
  { method: "POST", body: "{}" },
);

console.log(
  JSON.stringify(
    {
      ok: true,
      connector_id: result.connector_id,
      capabilities: result.capabilities,
      next_steps: [
        "Ensure KEYSERVICE_SEARCH_API_URL=https://search.morethinkings.com on the server",
        "User signs in (GitHub/OIDC), then POST /v2/auth/search/link with cnothing_user_session cookie",
        "Grant search.query to your agent, then invoke with user_id=github:<login>",
        `curl -sS -X POST ${baseUrl}/v2/capabilities/invoke -H 'Authorization: Bearer <agent_token>' -H 'Content-Type: application/json' -d '{\"capability\":\"search.query\",\"input\":{\"query\":\"example\",\"limit\":5},\"user_id\":\"github:<login>\"}'`,
      ],
    },
    null,
    2,
  ),
);
