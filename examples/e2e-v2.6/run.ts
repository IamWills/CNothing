/**
 * CNothing v2.6 zero-code OAuth + OpenAPI import E2E.
 *
 * Usage:
 *   CNOTHING_BASE_URL=http://127.0.0.1:3021 \
 *   CNOTHING_ADMIN_TOKEN=... \
 *   bun run examples/e2e-v2.6/run.ts
 */

const baseUrl = (process.env.CNOTHING_BASE_URL ?? "http://127.0.0.1:3021").replace(/\/+$/, "");
const adminToken = process.env.CNOTHING_ADMIN_TOKEN ?? process.env.KEYSERVICE_BEARER_TOKEN ?? "";

if (!adminToken) {
  throw new Error("CNOTHING_ADMIN_TOKEN or KEYSERVICE_BEARER_TOKEN is required");
}

async function request<T>(
  path: string,
  init?: RequestInit & { admin?: boolean; agentToken?: string },
): Promise<{ status: number; data: T; text: string }> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (init?.agentToken) {
    headers.set("authorization", `Bearer ${init.agentToken}`);
  } else if (init?.admin !== false) {
    headers.set("authorization", `Bearer ${adminToken}`);
  }

  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : ({} as T);
  return { status: response.status, data, text };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNoSecrets(text: string): void {
  const forbidden = [
    /access_token/i,
    /refresh_token/i,
    /client_secret/i,
    /encrypted_client_secret/i,
    /code_verifier/i,
  ];
  for (const pattern of forbidden) {
    assert(!pattern.test(text), `Agent-visible response leaked secret pattern: ${pattern}`);
  }
}

const mockOpenApi = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Mock GitHub", version: "1.0.0" },
  servers: [{ url: "https://api.github.mock" }],
  components: {
    securitySchemes: {
      oauth: {
        type: "oauth2",
        flows: { authorizationCode: { scopes: { "read:user": "Read user profile" } } },
      },
    },
  },
  paths: {
    "/user": {
      get: {
        operationId: "getAuthenticatedUser",
        summary: "Get the authenticated user",
        security: [{ oauth: ["read:user"] }],
        responses: { "200": { description: "OK" } },
      },
    },
  },
});

async function main() {
  console.log("v2.6 E2E: platform status");
  const status = await request<{ ok: boolean; version?: string }>("/v2.6/platform/status", {
    admin: false,
  });
  assert(status.data.ok, "Platform status failed");
  assert(status.data.version === "2.6.0", "Expected v2.6.0");

  console.log("v2.6 E2E: list oauth providers (admin registry)");
  const providers = await request<{ ok: true; items: Array<{ slug: string }> }>(
    "/v2.6/oauth/providers",
  );
  assert(providers.data.items.some((item) => item.slug === "github"), "GitHub provider missing");

  console.log("v2.6 E2E: import OpenAPI and generate capability");
  const importJob = await request<{ ok: true; job: { id: string; candidates: Array<{ name: string }> } }>(
    "/v2.6/import/openapi",
    {
      method: "POST",
      body: JSON.stringify({
        content: mockOpenApi,
        provider_slug: "github",
        filename: "github-mock.json",
      }),
    },
  );
  assert(importJob.status === 201, "OpenAPI import failed");
  const candidateName = importJob.data.job.candidates[0]?.name;
  assert(candidateName, "Expected candidate capability");

  const activated = await request<{ ok: true; activated: number }>(
    "/v2.6/capabilities/generate-from-openapi",
    {
      method: "POST",
      body: JSON.stringify({
        job_id: importJob.data.job.id,
        candidate_names: [candidateName],
        provider_slug: "github",
      }),
    },
  );
  assert(activated.data.activated === 1, "Capability activation failed");

  console.log("v2.6 E2E: register agent");
  const agent = await request<{ ok: true; access_token: string; agent: { id: string } }>(
    "/v2/agents/register",
    {
      method: "POST",
      body: JSON.stringify({
        name: "e2e-v26-agent",
        owner_user_id: "e2e-user",
      }),
    },
  );
  const agentToken = agent.data.access_token;

  console.log("v2.6 E2E: agent list_capabilities (no secrets)");
  const caps = await request<{ ok: true; items: Array<{ name: string }> }>("/v2.6/agent/capabilities", {
    agentToken,
    admin: false,
  });
  assertNoSecrets(caps.text);
  assert(
    caps.data.items.some((item) => item.name === candidateName),
    `Expected imported capability ${candidateName}`,
  );

  console.log("v2.6 E2E: agent request_authorization");
  const auth = await request<{ authorization_id?: string; approval_url?: string }>(
    "/v2.6/agent/authorizations",
    {
      method: "POST",
      agentToken,
      admin: false,
      body: JSON.stringify({ capability: candidateName, reason: "v2.6 e2e" }),
    },
  );
  assertNoSecrets(auth.text);
  assert(auth.status === 201, "Authorization request failed");

  console.log("v2.6 E2E: MCP tools/list exposes only v2.6 agent tools");
  const mcpList = await request<{ result?: { tools?: Array<{ name: string }> } }>("/mcp/message", {
    admin: false,
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const toolNames = mcpList.data.result?.tools?.map((tool) => tool.name) ?? [];
  assert(toolNames.length === 6, "Expected exactly 6 MCP tools");
  assert(!toolNames.includes("kv_save"), "Legacy kv_save must not be listed");

  console.log("v2.6 E2E: legacy MCP tool call blocked");
  const blocked = await request<{ error?: { message?: string } }>("/mcp/message", {
    admin: false,
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "kv_save", arguments: {} },
    }),
  });
  assert(blocked.data.error?.message?.includes("not available"), "Legacy tool should be blocked");

  console.log("v2.6 E2E: PASSED (connect + approve + invoke require live OAuth — run manually with real provider)");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
