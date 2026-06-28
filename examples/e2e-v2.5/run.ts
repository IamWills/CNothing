/**
 * CNothing v2.5 E2E tests (GitHub happy path subset + authorization_required).
 *
 * Usage:
 *   CNOTHING_BASE_URL=http://127.0.0.1:3021 \
 *   CNOTHING_ADMIN_TOKEN=... \
 *   bun run examples/e2e-v2.5/run.ts
 */

const baseUrl = (process.env.CNOTHING_BASE_URL ?? "http://127.0.0.1:3021").replace(/\/+$/, "");
const adminToken = process.env.CNOTHING_ADMIN_TOKEN ?? process.env.KEYSERVICE_BEARER_TOKEN ?? "";
const testUserId = process.env.E2E_USER_ID ?? "e2e-user";

if (!adminToken) {
  throw new Error("CNOTHING_ADMIN_TOKEN or KEYSERVICE_BEARER_TOKEN is required");
}

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
  return { status: response.status, data };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("v2.5 E2E: platform status");
  const status = await request<{ ok: boolean; version?: string }>("/v2/platform/v2.5/status", {
    admin: false,
  });
  assert(status.data.ok, "Platform status failed");
  assert(status.data.version === "2.5.0", "Expected v2.5.0");

  console.log("v2.5 E2E: list oauth providers");
  const providers = await request<{ ok: true; items: Array<{ slug: string }> }>(
    "/v2/oauth/providers",
    { admin: false },
  );
  assert(providers.data.items.some((item) => item.slug === "github"), "GitHub provider missing");

  console.log("v2.5 E2E: register agent");
  const agent = await request<{ ok: true; access_token: string; agent: { id: string } }>(
    "/v2/agents/register",
    {
      method: "POST",
      body: JSON.stringify({
        name: "e2e-v25-agent",
        owner_user_id: "e2e-user",
      }),
    },
  );
  const agentToken = agent.data.access_token;

  console.log("v2.5 E2E: list agent capabilities");
  const caps = await request<{ ok: true; items: Array<{ name: string }> }>("/v2/agent/capabilities", {
    agentToken,
    admin: false,
  });
  assert(Array.isArray(caps.data.items), "Expected capabilities list");

  console.log("v2.5 E2E: unauthorized invoke returns authorization_required");
  const denied = await request<{ error_code?: string; ok?: boolean }>("/v2/agent/invoke", {
    method: "POST",
    agentToken,
    admin: false,
    body: JSON.stringify({
      capability: "github.create_issue",
      input: { owner: "test", repo: "test", title: "E2E" },
    }),
  });
  assert(denied.status === 403, "Expected 403 for unauthorized invoke");
  const errorPayload = denied.data as { error?: { details?: { error_code?: string } }; error_code?: string };
  const errorCode =
    errorPayload.error_code ??
    errorPayload.error?.details?.error_code ??
    (denied.data as { error_code?: string }).error_code;
  assert(errorCode === "authorization_required", "Expected authorization_required");

  console.log("v2.5 E2E: request authorization");
  const auth = await request<{
    authorization_id: string;
    approval_url: string;
    status: string;
  }>("/v2/agent/authorizations", {
    method: "POST",
    agentToken,
    admin: false,
    body: JSON.stringify({
      capability: "github.create_issue",
      reason: "E2E test",
    }),
  });
  assert(auth.status === 201, "Expected 201 for authorization request");
  assert(auth.data.approval_url.includes("/approve/"), "Expected approval_url");
  assert(!JSON.stringify(auth.data).includes("access_token"), "Must not leak tokens");

  console.log("v2.5 E2E: high-risk invoke returns pending confirmation (scenario C)");
  await request("/v2/grants", {
    method: "POST",
    body: JSON.stringify({
      user_id: testUserId,
      agent_id: agent.data.agent.id,
      capability: "github.delete_repo",
    }),
  });
  const highRisk = await request<{
    pending?: boolean;
    confirmation_id?: string;
    policy_decision?: { action?: string };
  }>("/v2/agent/invoke", {
    method: "POST",
    agentToken,
    admin: false,
    body: JSON.stringify({
      capability: "github.delete_repo",
      input: { owner: "e2e-test", repo: "e2e-test" },
    }),
  });
  assert(highRisk.status === 202, "Expected 202 for high-risk pending confirmation");
  assert(highRisk.data.pending === true, "Expected pending=true");
  assert(typeof highRisk.data.confirmation_id === "string" && highRisk.data.confirmation_id.length > 0, "Expected confirmation_id");
  assert(
    highRisk.data.policy_decision?.action === "require_user_confirmation",
    "Expected require_user_confirmation policy",
  );
  assert(!JSON.stringify(highRisk.data).includes("access_token"), "Must not leak tokens in pending response");

  const scenarioAEnabled = process.env.CNOTHING_E2E_SCENARIO_A !== "0";
  if (scenarioAEnabled) {
    console.log("v2.5 E2E: scenario A — OAuth seed + invoke success (mock GitHub)");
    const mockPort = Number(process.env.CNOTHING_E2E_MOCK_GITHUB_PORT ?? "3199");

    const mockServer = Bun.serve({
      port: mockPort,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/user" && req.method === "GET") {
          return Response.json({ id: 42, login: "e2e-user", name: "E2E User" });
        }
        if (url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/issues$/) && req.method === "POST") {
          return Response.json({
            id: 1,
            number: 101,
            html_url: "https://github.com/e2e-org/e2e-repo/issues/101",
            title: "E2E issue",
          });
        }
        return Response.json({ message: "not found" }, { status: 404 });
      },
    });

    try {
      const seed = await request<{ ok?: true; connection?: { id: string }; error?: { message?: string } }>(
        "/v2/internal/e2e/seed-oauth-connection",
        {
          method: "POST",
          body: JSON.stringify({
            user_id: testUserId,
            provider_slug: "github",
            access_token: "gho_e2e_mock_token",
            account_id: "42",
            display_name: "E2E User",
          }),
        },
      );

      if (seed.status !== 200) {
        console.log(
          `Skipping scenario A: internal seed returned ${seed.status} (${seed.data.error?.message ?? "disabled"})`,
        );
      } else {
        const connectionId = seed.data.connection!.id;

        const authA = await request<{ authorization_id: string }>("/v2/agent/authorizations", {
          method: "POST",
          agentToken,
          admin: false,
          body: JSON.stringify({
            capability: "github.create_issue",
            reason: "E2E scenario A",
          }),
        });
        assert(authA.status === 201, "Expected authorization request for scenario A");

        const approved = await request<{ ok: true; grant: { id: string } }>(
          "/v2/internal/e2e/approve-authorization",
          {
            method: "POST",
            body: JSON.stringify({
              authorization_id: authA.data.authorization_id,
              user_id: testUserId,
              connection_id: connectionId,
            }),
          },
        );
        assert(approved.status === 200, "Expected e2e approve-authorization to succeed");

        const invoke = await request<{ ok?: boolean; result?: { issue_number?: number } }>(
          "/v2/agent/invoke",
          {
            method: "POST",
            agentToken,
            admin: false,
            body: JSON.stringify({
              capability: "github.create_issue",
              input: { owner: "e2e-org", repo: "e2e-repo", title: "E2E issue" },
            }),
          },
        );
        assert(invoke.status === 200, "Expected successful invoke in scenario A");
        assert(invoke.data.ok === true, "Expected ok=true");
        assert(invoke.data.result?.issue_number === 101, "Expected mocked issue number");
        assert(!JSON.stringify(invoke.data).includes("gho_e2e_mock_token"), "Must not leak OAuth token");
      }
    } finally {
      mockServer.stop();
    }
  }

  console.log("v2.5 E2E: scenario D — OpenAPI import + activate + invoke");
  const mockHttpPort = Number(process.env.CNOTHING_E2E_MOCK_HTTP_PORT ?? "3200");
  const mockHttpServer = Bun.serve({
    port: mockHttpPort,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/widgets" && req.method === "GET") {
        return Response.json({ items: [{ id: "w1", name: "Widget One" }] });
      }
      return Response.json({ message: "not found" }, { status: 404 });
    },
  });

  try {
    const openApiDoc = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "E2E Widgets" },
      servers: [{ url: `http://127.0.0.1:${mockHttpPort}` }],
      paths: {
        "/widgets": {
          get: { operationId: "listWidgets", summary: "List widgets" },
        },
      },
    });

    const importJob = await request<{
      ok: true;
      job: { id: string; status: string; candidates: Array<{ name: string }> };
    }>("/v2/import/openapi", {
      method: "POST",
      body: JSON.stringify({ content: openApiDoc, provider_slug: "e2ewidgets" }),
    });
    assert(importJob.status === 201, "Expected OpenAPI import 201");
    assert(importJob.data.job.status === "completed", "Expected completed import job");
    const candidateName = importJob.data.job.candidates[0]?.name;
    assert(candidateName === "e2ewidgets.listWidgets", `Unexpected candidate: ${candidateName}`);

    const activated = await request<{ ok: true; activated: number }>("/v2/capabilities/from-openapi", {
      method: "POST",
      body: JSON.stringify({
        job_id: importJob.data.job.id,
        candidate_names: [candidateName!],
      }),
    });
    assert(activated.data.activated === 1, "Expected one activated capability");

    await request("/v2/grants", {
      method: "POST",
      body: JSON.stringify({
        user_id: testUserId,
        agent_id: agent.data.agent.id,
        capability: candidateName,
      }),
    });

    const importedInvoke = await request<{ ok?: boolean; result?: { items?: unknown[] } }>(
      "/v2/agent/invoke",
      {
        method: "POST",
        agentToken,
        admin: false,
        body: JSON.stringify({
          capability: candidateName,
          input: {},
        }),
      },
    );
    assert(importedInvoke.status === 200, "Expected successful OpenAPI import invoke");
    assert(importedInvoke.data.ok === true, "Expected ok=true");
    assert(Array.isArray(importedInvoke.data.result?.items), "Expected widgets array in result");
  } finally {
    mockHttpServer.stop();
  }

  console.log("v2.5 E2E: all checks passed");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
