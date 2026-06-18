/**
 * End-to-end v2 flow test against a running CNothing instance.
 *
 * Prerequisites:
 *   - CNothing running (bun run dev)
 *   - Migrations applied (bun run migrate)
 *   - KEYSERVICE_BEARER_TOKEN set on server
 *
 * Usage:
 *   CNOTHING_BASE_URL=http://127.0.0.1:3021 \
 *   CNOTHING_ADMIN_TOKEN=... \
 *   bun run examples/e2e-v2/run.ts
 */

import { createConnectorHandler } from "../../src/connector-sdk/index";

const baseUrl = (process.env.CNOTHING_BASE_URL ?? "http://127.0.0.1:3021").replace(/\/+$/, "");
const adminToken = process.env.CNOTHING_ADMIN_TOKEN ?? process.env.KEYSERVICE_BEARER_TOKEN ?? "";
const testUserId = process.env.E2E_USER_ID ?? "e2e-user";
const capabilityName = "e2e.echo";

if (!adminToken) {
  throw new Error("CNOTHING_ADMIN_TOKEN or KEYSERVICE_BEARER_TOKEN is required");
}

type Json = Record<string, unknown>;

async function request<T>(
  path: string,
  init?: RequestInit & { admin?: boolean; agentToken?: string },
): Promise<{ status: number; data: T }> {
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
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message ?? "Request failed")
        : `HTTP ${response.status}`;
    throw new Error(`${init?.method ?? "GET"} ${path}: ${message}`);
  }
  return { status: response.status, data };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fetchPublicKeyPem(): Promise<string> {
  const response = await fetch(`${baseUrl}/v1/authai/public-key`);
  const payload = (await response.json()) as {
    authai_public_key?: { public_key_pem?: string };
  };
  const pem = payload.authai_public_key?.public_key_pem?.trim();
  if (!pem) throw new Error("Unable to fetch CNothing public key");
  return pem;
}

const steps: string[] = [];

async function main() {
  steps.push("health");
  const status = await request<{ ok: true; platform: { version: string } }>(
    "/v2/platform/status",
    { admin: false },
  );
  assert(status.data.platform.version === "2.0.0", "Unexpected platform version");

  steps.push("mock-connector");
  const publicKeyPem = await fetchPublicKeyPem();

  let connectorId = "";
  const listenPort = 3099 + Math.floor(Math.random() * 1000);

  const placeholderServer = Bun.serve({
    port: listenPort,
    fetch: () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  });

  const callbackUrl = `http://127.0.0.1:${listenPort}`;

  try {
    steps.push("register-connector");
    const connectorResponse = await request<{ ok: true; connector: { id: string } }>(
      "/v2/connectors/register",
      {
        method: "POST",
        body: JSON.stringify({
          provider: "e2e",
          display_name: "E2E Echo Connector",
          callback_url: callbackUrl,
          metadata: { e2e: true },
        }),
      },
    );
    connectorId = connectorResponse.data.connector.id;
  } finally {
    placeholderServer.stop();
  }

  const server = Bun.serve({
    port: listenPort,
    fetch: createConnectorHandler({
      connectorId,
      cnothingPublicKeyPem: publicKeyPem,
      executeCapability: async (input) => ({
        echo: input.input,
        capability: input.capability,
        agent_id: input.agent_id,
        user_id: input.user_id,
      }),
    }),
  });

  try {
    steps.push("register-capability");
    await request("/v2/capabilities/register", {
      method: "POST",
      body: JSON.stringify({
        connector_id: connectorId,
        name: capabilityName,
        description: "E2E echo capability",
        capability_type: "QUERY",
        risk_level: "LOW",
        scopes: ["e2e.echo"],
        input_schema: { type: "object" },
      }),
    });

    steps.push("register-agent");
    const agentResponse = await request<{
      ok: true;
      agent: { id: string };
      access_token: string;
    }>("/v2/agents/register", {
      method: "POST",
      body: JSON.stringify({
        name: `e2e-agent-${Date.now()}`,
        owner_user_id: testUserId,
      }),
    });
    const agentId = agentResponse.data.agent.id;
    const accessToken = agentResponse.data.access_token;

    steps.push("create-grant");
    await request("/v2/grants", {
      method: "POST",
      body: JSON.stringify({
        user_id: testUserId,
        agent_id: agentId,
        capability: capabilityName,
      }),
    });

    steps.push("invoke");
    const invokeResponse = await request<{ ok: true; result: Json }>(
      "/v2/capabilities/invoke",
      {
        method: "POST",
        agentToken: accessToken,
        admin: false,
        body: JSON.stringify({
          capability: capabilityName,
          input: { message: "hello-e2e", ts: new Date().toISOString() },
        }),
      },
    );

    assert(invokeResponse.data.ok === true, "Invoke did not return ok");
    const result = invokeResponse.data.result as Json;
    assert(result.capability === capabilityName, "Echo capability mismatch");
    assert(
      (result.echo as Json)?.message === "hello-e2e",
      "Echo payload mismatch",
    );

    steps.push("audit");
    const auditResponse = await request<{ ok: true; items: Array<{ capability_name: string; status: string }> }>(
      "/v2/audit?limit=5",
    );
    const recent = auditResponse.data.items.find((item) => item.capability_name === capabilityName);
    assert(recent?.status === "success", "Expected successful audit event");

    console.log(
      JSON.stringify(
        {
          ok: true,
          steps,
          connector_id: connectorId,
          agent_id: agentId,
          capability: capabilityName,
          invoke_result: invokeResponse.data.result,
        },
        null,
        2,
      ),
    );
  } finally {
    server.stop();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        steps,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
