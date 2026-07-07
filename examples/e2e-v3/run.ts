/**
 * CNothing v3.0 Universal Trust Broker E2E.
 *
 * Usage:
 *   CNOTHING_BASE_URL=http://127.0.0.1:3021 \
 *   CNOTHING_ADMIN_TOKEN=... \
 *   KEYSERVICE_E2E_INTERNAL=1 \
 *   bun run examples/e2e-v3/run.ts
 */

const baseUrl = (process.env.CNOTHING_BASE_URL ?? "http://127.0.0.1:3021").replace(/\/+$/, "");
const adminToken = process.env.CNOTHING_ADMIN_TOKEN ?? process.env.KEYSERVICE_BEARER_TOKEN ?? "";
const testUserId = process.env.E2E_USER_ID ?? "e2e-v3-user";

if (!adminToken) {
  throw new Error("CNOTHING_ADMIN_TOKEN or KEYSERVICE_BEARER_TOKEN is required");
}

async function request<T>(
  path: string,
  init?: RequestInit & { admin?: boolean; agentToken?: string; userSessionToken?: string },
): Promise<{ status: number; data: T; text: string }> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (init?.userSessionToken) {
    headers.set("authorization", `Bearer ${init.userSessionToken}`);
  } else if (init?.agentToken) {
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
    /encrypted_client_secret/i,
    /code_verifier/i,
    /private_key/i,
    /session_cookie/i,
  ];
  for (const pattern of forbidden) {
    assert(!pattern.test(text), `Response leaked secret pattern: ${pattern}`);
  }
}

async function loginV3UserSession(userId: string): Promise<string> {
  const tokenIssue = await request<{ ok: true; login_token: string }>("/v3/auth/login-tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
  assert(tokenIssue.status === 201, `login token issue failed: ${tokenIssue.text}`);

  const login = await request<{ ok: true; session_token: string; user_id: string }>(
    "/v3/auth/login",
    {
      admin: false,
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        login_token: tokenIssue.data.login_token,
      }),
    },
  );
  assert(login.status === 200, `login failed: ${login.text}`);
  assert(login.data.user_id === userId, "expected matching user_id");
  assertNoSecrets(login.text);
  return login.data.session_token;
}

async function main() {
  console.log("v3 E2E: platform status");
  const status = await request<{ ok: boolean; version?: string; product?: string }>(
    "/v3/platform/status",
    { admin: false },
  );
  assert(status.status === 200, `platform status failed: ${status.text}`);
  assert(status.data.version === "3.0.0", "expected version 3.0.0");
  assert(status.data.product?.includes("Trust Broker"), "expected Trust Broker product name");
  console.log("  version:", status.data.version);

  console.log("v3 E2E: user session (login-tokens + login + me)");
  const userSessionToken = await loginV3UserSession(testUserId);
  const me = await request<{ ok: true; user_id: string }>("/v3/auth/me", {
    admin: false,
    userSessionToken,
  });
  assert(me.status === 200, me.text);
  assert(me.data.user_id === testUserId, "expected /v3/auth/me user_id");

  console.log("v3 E2E: register agent");
  const agentRegister = await request<{ ok: true; agent: { id: string; access_token: string } }>(
    "/v3/agents/register",
    {
      method: "POST",
      body: JSON.stringify({
        name: `e2e-v3-agent-${Date.now()}`,
        owner_user_id: testUserId,
      }),
    },
  );
  assert(agentRegister.status === 200 || agentRegister.status === 201, agentRegister.text);
  const agentToken = agentRegister.data.agent.access_token;
  assertNoSecrets(agentRegister.text);

  console.log("v3 E2E: agent lists capabilities");
  const capabilities = await request<{ ok: true; items: unknown[] }>("/v3/agent/capabilities", {
    agentToken,
    admin: false,
  });
  assert(capabilities.status === 200, capabilities.text);
  assertNoSecrets(capabilities.text);

  console.log("v3 E2E: agent submits provider proposal (manual OAuth endpoints)");
  const proposal = await request<{
    ok: true;
    proposal: { id: string; status: string; proposed_slug: string };
  }>("/v3/providers/proposals", {
    agentToken,
    admin: false,
    method: "POST",
    body: JSON.stringify({
      provider_name: `E2E Mock ${Date.now()}`,
      authorization_url: "https://oauth.example.com/authorize",
      token_url: "https://oauth.example.com/token",
      scopes: ["read:user"],
      description: "v3 e2e mock provider",
    }),
  });
  assert(proposal.status === 201, proposal.text);
  assertNoSecrets(proposal.text);

  console.log("v3 E2E: authorization request view via /v3/authorize/{id}");
  const authRequest = await request<{
    authorization_id: string;
    approval_url: string;
    status: string;
  }>("/v3/agent/authorizations", {
    method: "POST",
    agentToken,
    admin: false,
    body: JSON.stringify({
      capability: "github.create_issue",
      reason: "v3 e2e authorization view",
    }),
  });
  assert(authRequest.status === 201, authRequest.text);
  const authorizationId = authRequest.data.authorization_id;
  const authView = await request<{ ok: true; authorization_request: { id: string; status: string } }>(
    `/v3/authorize/${encodeURIComponent(authorizationId)}`,
    { admin: false },
  );
  assert(authView.status === 200, authView.text);
  assert(authView.data.authorization_request.id === authorizationId, "expected authorization id");

  console.log("v3 E2E: pending confirmations via /v3/confirmations/pending");
  await request("/v3/grants", {
    method: "POST",
    body: JSON.stringify({
      user_id: testUserId,
      agent_id: agentRegister.data.agent.id,
      capability: "github.delete_repo",
    }),
  });
  const highRisk = await request<{
    pending?: boolean;
    confirmation_id?: string;
  }>("/v3/agent/invoke", {
    method: "POST",
    agentToken,
    admin: false,
    body: JSON.stringify({
      capability: "github.delete_repo",
      input: { owner: "e2e-test", repo: "e2e-test" },
    }),
  });
  assert(highRisk.status === 202, highRisk.text);
  assert(highRisk.data.pending === true, "expected pending invoke");
  const pending = await request<{ ok: true; items: Array<{ id: string }> }>(
    "/v3/confirmations/pending",
    { admin: false, userSessionToken },
  );
  assert(pending.status === 200, pending.text);
  assert(
    pending.data.items.some((item) => item.id === highRisk.data.confirmation_id),
    "expected pending confirmation for user",
  );

  console.log("v3 E2E: OAuth device flow");
  const mockPort = Number(process.env.CNOTHING_E2E_MOCK_DEVICE_PORT ?? "3198");
  const approvedDeviceCodes = new Set<string>();

  const mockServer = Bun.serve({
    port: mockPort,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/device/code" && req.method === "POST") {
        const deviceCode = `device_${Date.now()}`;
        return Response.json({
          device_code: deviceCode,
          user_code: "ABCD-EFGH",
          verification_uri: `${url.origin}/device/verify`,
          verification_uri_complete: `${url.origin}/device/verify?user_code=ABCD-EFGH`,
          expires_in: 300,
          interval: 1,
        });
      }

      if (url.pathname === "/device/approve" && req.method === "POST") {
        return req
          .json()
          .then((body: { user_code?: string }) => {
            if (body.user_code === "ABCD-EFGH") {
              approvedDeviceCodes.add("latest");
            }
            return Response.json({ ok: true });
          })
          .catch(() => Response.json({ error: "invalid" }, { status: 400 }));
      }

      if (url.pathname === "/token" && req.method === "POST") {
        return req
          .text()
          .then((bodyText) => {
            const form = new URLSearchParams(bodyText);
            const grantType = form.get("grant_type");
            if (grantType !== "urn:ietf:params:oauth:grant-type:device_code") {
              return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
            }
            if (!approvedDeviceCodes.has("latest")) {
              return Response.json({ error: "authorization_pending" }, { status: 400 });
            }
            return Response.json({
              access_token: "e2e_device_access_token",
              token_type: "Bearer",
              scope: "read",
            });
          })
          .catch(() => Response.json({ error: "invalid_request" }, { status: 400 }));
      }

      if (url.pathname === "/userinfo" && req.method === "GET") {
        return Response.json({
          sub: "e2e-device-account",
          name: "E2E Device User",
        });
      }

      return Response.json({ message: "not found" }, { status: 404 });
    },
  });

  try {
    const mockBaseUrl = `http://127.0.0.1:${mockPort}`;
    const seed = await request<{ ok?: true; provider?: { slug: string } }>(
      "/v2/internal/e2e/seed-device-flow-provider",
      {
        method: "POST",
        body: JSON.stringify({ mock_base_url: mockBaseUrl }),
      },
    );

    if (seed.status !== 200) {
      console.log(
        `Skipping device flow: internal seed returned ${seed.status} (set KEYSERVICE_E2E_INTERNAL=1)`,
      );
    } else {
      const providerSlug = seed.data.provider!.slug;

      const deviceStart = await request<{
        ok: true;
        session_id: string;
        user_code: string;
      }>("/v3/oauth/device/start", {
        admin: false,
        userSessionToken,
        method: "POST",
        body: JSON.stringify({ provider_slug: providerSlug }),
      });
      assert(deviceStart.status === 201 || deviceStart.status === 200, deviceStart.text);
      assert(deviceStart.data.user_code === "ABCD-EFGH", "expected mock user_code");
      assertNoSecrets(deviceStart.text);

      await fetch(`${mockBaseUrl}/device/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_code: "ABCD-EFGH" }),
      });

      let completed = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const poll = await request<{
          ok: true;
          status: string;
          connection_id?: string;
        }>("/v3/oauth/device/poll", {
          admin: false,
          userSessionToken,
          method: "POST",
          body: JSON.stringify({ session_id: deviceStart.data.session_id }),
        });
        assert(poll.status === 200, poll.text);
        if (poll.data.status === "completed") {
          assert(typeof poll.data.connection_id === "string", "expected connection_id");
          completed = true;
          break;
        }
        await Bun.sleep(300);
      }
      assert(completed, "device flow did not complete after polling");

      const connections = await request<{ ok: true; items: Array<{ provider_slug: string }> }>(
        "/v3/oauth/connections",
        { admin: false, userSessionToken },
      );
      assert(connections.status === 200, connections.text);
      assert(
        connections.data.items.some((item) => item.provider_slug === providerSlug),
        "expected device-flow connection in /v3/oauth/connections",
      );
    }
  } finally {
    mockServer.stop(true);
  }

  console.log("v3 E2E: list public providers");
  const providers = await request<{ ok: true; items: unknown[] }>("/v3/providers", {
    admin: false,
  });
  assert(providers.status === 200, providers.text);
  assertNoSecrets(providers.text);

  console.log("v3 E2E: trust audit (admin, metadata only)");
  const audit = await request<{ ok: true; items: unknown[] }>("/v3/audit?limit=5");
  assert(audit.status === 200, audit.text);
  assertNoSecrets(audit.text);

  console.log("v3 E2E: all checks passed");
}

void main();
