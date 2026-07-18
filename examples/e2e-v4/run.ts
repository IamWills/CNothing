/**
 * CNothing v4 Universal Credential-Injecting Proxy E2E.
 *
 * Flow under test:
 *   1. Seed an OAuth provider + connection (mock upstream, internal endpoints)
 *   2. Agent requests connection-level access (POST /v4/access-requests)
 *   3. User approves with a user session (POST /v4/access-requests/{id}/approve)
 *   4. Agent calls an arbitrary upstream API through POST /v4/proxy
 *      — the platform injects the token; the agent never sees it
 *   5. Redaction, host allowlist, header stripping, and revocation checks
 *
 * Usage:
 *   CNOTHING_BASE_URL=http://127.0.0.1:3021 \
 *   CNOTHING_ADMIN_TOKEN=... \
 *   KEYSERVICE_E2E_INTERNAL=1 (on the server) \
 *   bun run examples/e2e-v4/run.ts
 */

const baseUrl = (process.env.CNOTHING_BASE_URL ?? "http://127.0.0.1:3021").replace(/\/+$/, "");
const adminToken = process.env.CNOTHING_ADMIN_TOKEN ?? process.env.KEYSERVICE_BEARER_TOKEN ?? "";
const testUserId = process.env.E2E_USER_ID ?? "e2e-v4-user";
const mockPort = Number(process.env.CNOTHING_E2E_MOCK_UPSTREAM_PORT ?? "3199");
const MOCK_ACCESS_TOKEN = "e2e_v4_upstream_token_1234567890";

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

async function loginUserSession(userId: string): Promise<string> {
  const tokenIssue = await request<{ ok: true; login_token: string }>("/v4/auth/login-tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
  assert(tokenIssue.status === 201, `login token issue failed: ${tokenIssue.text}`);

  const login = await request<{ ok: true; session_token: string }>("/v4/auth/login", {
    admin: false,
    method: "POST",
    body: JSON.stringify({ user_id: userId, login_token: tokenIssue.data.login_token }),
  });
  assert(login.status === 200, `login failed: ${login.text}`);
  return login.data.session_token;
}

async function main() {
  // Captures agent callback deliveries (access_request.decided events).
  const callbackDeliveries: Array<Record<string, unknown>> = [];

  // Mock upstream API: verifies the injected Authorization header and
  // deliberately echoes the token so we can prove the proxy redacts it.
  const mockServer = Bun.serve({
    port: mockPort,
    fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization") ?? "";

      if (url.pathname === "/agent-callback" && req.method === "POST") {
        return req.json().then((body) => {
          callbackDeliveries.push(body as Record<string, unknown>);
          return Response.json({ received: true });
        });
      }

      if (url.pathname === "/api/hello") {
        if (auth !== `Bearer ${MOCK_ACCESS_TOKEN}`) {
          return Response.json({ error: "bad_token", received: auth }, { status: 401 });
        }
        return Response.json({
          message: "hello from upstream",
          method: req.method,
          echo_token: MOCK_ACCESS_TOKEN,
          got_cookie: req.headers.get("cookie"),
          got_custom: req.headers.get("x-e2e-custom"),
        });
      }

      if (url.pathname === "/api/items" && req.method === "POST") {
        return req.json().then((body) =>
          Response.json({ created: true, item: body }, { status: 201 }),
        );
      }

      return Response.json({ message: "not found" }, { status: 404 });
    },
  });

  try {
    const mockBaseUrl = `http://127.0.0.1:${mockPort}`;

    console.log("v4 E2E: seed mock provider");
    const seed = await request<{ ok?: true; provider?: { slug: string } }>(
      "/v4/internal/e2e/seed-provider",
      { method: "POST", body: JSON.stringify({ mock_base_url: mockBaseUrl }) },
    );
    assert(seed.status === 200, `seed provider failed (set KEYSERVICE_E2E_INTERNAL=1): ${seed.text}`);
    const providerSlug = seed.data.provider!.slug;

    console.log("v4 E2E: seed OAuth connection for user");
    const seedConnection = await request<{ ok: true; connection: { id: string } }>(
      "/v4/internal/e2e/seed-oauth-connection",
      {
        method: "POST",
        body: JSON.stringify({
          user_id: testUserId,
          provider_slug: providerSlug,
          access_token: MOCK_ACCESS_TOKEN,
        }),
      },
    );
    assert(seedConnection.status === 200, seedConnection.text);
    const connectionId = seedConnection.data.connection.id;

    console.log("v4 E2E: user login + agent register");
    const userSessionToken = await loginUserSession(testUserId);
    const agentRegister = await request<{
      ok: true;
      agent: { id: string };
      access_token: string;
    }>("/v4/agents/register", {
      method: "POST",
      body: JSON.stringify({ name: `e2e-v4-agent-${Date.now()}`, owner_user_id: testUserId }),
    });
    assert(agentRegister.status === 200 || agentRegister.status === 201, agentRegister.text);
    const agentToken = agentRegister.data.access_token;
    assert(agentToken, "expected agent access_token");

    console.log("v4 E2E: agent requests connection-level access");
    const accessRequest = await request<{
      ok: true;
      access_request_id: string;
      approval_url: string;
      status: string;
    }>("/v4/access-requests", {
      admin: false,
      agentToken,
      method: "POST",
      body: JSON.stringify({
        provider: providerSlug,
        hosts: ["127.0.0.1"],
        reason: "v4 e2e universal proxy",
      }),
    });
    assert(accessRequest.status === 201, accessRequest.text);
    assert(accessRequest.data.status === "pending", "expected pending access request");
    assert(accessRequest.data.approval_url.includes("/approve-proxy/"), "expected approval_url");
    const accessRequestId = accessRequest.data.access_request_id;

    console.log("v4 E2E: user approves with connection");
    const approve = await request<{ ok: true; grant: { id: string; allowed_hosts: string[] } }>(
      `/v4/access-requests/${accessRequestId}/approve`,
      {
        admin: false,
        userSessionToken,
        method: "POST",
        body: JSON.stringify({ connection_id: connectionId }),
      },
    );
    assert(approve.status === 201, approve.text);
    const grantId = approve.data.grant.id;

    console.log("v4 E2E: agent polls access request status");
    const statusPoll = await request<{ ok: true; status: string; grant_id: string }>(
      `/v4/access-requests/${accessRequestId}`,
      { admin: false, agentToken },
    );
    assert(statusPoll.status === 200, statusPoll.text);
    assert(statusPoll.data.status === "approved", statusPoll.text);
    assert(statusPoll.data.grant_id === grantId, "expected grant_id in status");

    console.log("v4 E2E: proxy GET with token injection + redaction");
    const proxyGet = await request<{
      ok: true;
      status: number;
      body: { message: string; echo_token: string; got_cookie: unknown; got_custom: string | null };
    }>("/v4/proxy", {
      admin: false,
      agentToken,
      method: "POST",
      body: JSON.stringify({
        grant_id: grantId,
        method: "GET",
        url: `${mockBaseUrl}/api/hello`,
        headers: {
          // Both must be stripped by the proxy:
          authorization: "Bearer forged-token",
          cookie: "session=stolen",
          // Custom header must pass through:
          "x-e2e-custom": "hello-header",
        },
      }),
    });
    assert(proxyGet.status === 200, proxyGet.text);
    assert(proxyGet.data.status === 200, `upstream rejected: ${proxyGet.text}`);
    assert(proxyGet.data.body.message === "hello from upstream", proxyGet.text);
    assert(proxyGet.data.body.echo_token === "[REDACTED]", "token must be redacted in response");
    assert(!proxyGet.text.includes(MOCK_ACCESS_TOKEN), "raw token must never reach the agent");
    assert(proxyGet.data.body.got_cookie === null, "cookie header must be stripped");
    assert(proxyGet.data.body.got_custom === "hello-header", "custom header must pass through");

    console.log("v4 E2E: proxy POST with JSON body");
    const proxyPost = await request<{
      ok: true;
      status: number;
      body: { created: boolean; item: { name: string } };
    }>("/v4/proxy", {
      admin: false,
      agentToken,
      method: "POST",
      body: JSON.stringify({
        grant_id: grantId,
        method: "POST",
        url: `${mockBaseUrl}/api/items`,
        body: { name: "e2e-item" },
      }),
    });
    assert(proxyPost.status === 200, proxyPost.text);
    assert(proxyPost.data.status === 201, proxyPost.text);
    assert(proxyPost.data.body.item.name === "e2e-item", proxyPost.text);

    console.log("v4 E2E: host outside allowlist is rejected");
    const blockedHost = await request<{ error?: { details?: { error_code?: string } } }>(
      "/v4/proxy",
      {
        admin: false,
        agentToken,
        method: "POST",
        body: JSON.stringify({
          grant_id: grantId,
          method: "GET",
          url: "https://api.github.com/user",
        }),
      },
    );
    assert(blockedHost.status === 403, `expected 403, got ${blockedHost.status}: ${blockedHost.text}`);
    assert(
      blockedHost.data.error?.details?.error_code === "host_not_allowed",
      blockedHost.text,
    );

    console.log("v4 E2E: user lists and revokes grant");
    const grants = await request<{ ok: true; items: Array<{ id: string }> }>("/v4/grants", {
      admin: false,
      userSessionToken,
    });
    assert(grants.status === 200, grants.text);
    assert(grants.data.items.some((item) => item.id === grantId), "expected grant in user list");

    const revoke = await request<{ ok: true; status: string }>(`/v4/grants/${grantId}/revoke`, {
      admin: false,
      userSessionToken,
      method: "POST",
      body: JSON.stringify({}),
    });
    assert(revoke.status === 200, revoke.text);

    console.log("v4 E2E: revoked grant can no longer proxy");
    const afterRevoke = await request<{ error?: { details?: { error_code?: string } } }>(
      "/v4/proxy",
      {
        admin: false,
        agentToken,
        method: "POST",
        body: JSON.stringify({
          grant_id: grantId,
          method: "GET",
          url: `${mockBaseUrl}/api/hello`,
        }),
      },
    );
    assert(afterRevoke.status === 403, `expected 403 after revoke: ${afterRevoke.text}`);
    assert(
      afterRevoke.data.error?.details?.error_code === "grant_revoked",
      afterRevoke.text,
    );

    console.log("v4 E2E: device pairing (iOS authenticator flow)");
    const pairingCodeResponse = await request<{ ok: true; pairing_code: string }>(
      "/v4/devices/pairing-codes",
      { admin: false, userSessionToken, method: "POST", body: JSON.stringify({}) },
    );
    assert(pairingCodeResponse.status === 201, pairingCodeResponse.text);

    const pair = await request<{
      ok: true;
      device: { id: string; user_id: string };
      session_token: string;
    }>("/v4/devices/pair", {
      admin: false,
      method: "POST",
      body: JSON.stringify({
        pairing_code: pairingCodeResponse.data.pairing_code,
        device_name: "e2e-iphone",
        platform: "ios",
      }),
    });
    assert(pair.status === 201, pair.text);
    assert(pair.data.device.user_id === testUserId, "device bound to wrong user");
    const deviceSessionToken = pair.data.session_token;
    const deviceId = pair.data.device.id;

    const reusedCode = await request("/v4/devices/pair", {
      admin: false,
      method: "POST",
      body: JSON.stringify({ pairing_code: pairingCodeResponse.data.pairing_code }),
    });
    assert(reusedCode.status === 401, "pairing code must be single-use");

    const pushToken = await request<{ ok: true }>(`/v4/devices/${deviceId}/push-token`, {
      admin: false,
      userSessionToken: deviceSessionToken,
      method: "POST",
      body: JSON.stringify({ push_token: "e2e-apns-token", push_environment: "sandbox" }),
    });
    assert(pushToken.status === 200, pushToken.text);

    const devices = await request<{ ok: true; items: Array<{ id: string; has_push_token: boolean }> }>(
      "/v4/devices",
      { admin: false, userSessionToken },
    );
    assert(devices.status === 200, devices.text);
    assert(
      devices.data.items.some((item) => item.id === deviceId && item.has_push_token),
      "expected paired device with push token",
    );

    console.log("v4 E2E: targeted access request (user_id + callback_url)");
    const targetedRequest = await request<{
      ok: true;
      access_request_id: string;
      approval_url: string;
      callback_registered: boolean;
    }>("/v4/access-requests", {
      admin: false,
      agentToken,
      method: "POST",
      body: JSON.stringify({
        provider: providerSlug,
        hosts: ["127.0.0.1"],
        reason: "v4 e2e targeted approval",
        user_id: testUserId,
        callback_url: `${mockBaseUrl}/agent-callback`,
      }),
    });
    assert(targetedRequest.status === 201, targetedRequest.text);
    assert(targetedRequest.data.callback_registered === true, "expected callback_registered");
    assert(
      targetedRequest.data.approval_url.includes(`user=${encodeURIComponent(testUserId)}`),
      "approval_url must carry the user context",
    );
    const targetedId = targetedRequest.data.access_request_id;

    console.log("v4 E2E: device sees the pending request (polling path)");
    const pending = await request<{ ok: true; items: Array<{ access_request_id: string }> }>(
      "/v4/access-requests/pending",
      { admin: false, userSessionToken: deviceSessionToken },
    );
    assert(pending.status === 200, pending.text);
    assert(
      pending.data.items.some((item) => item.access_request_id === targetedId),
      "device must see the targeted pending request",
    );

    console.log("v4 E2E: approve from the device, agent gets the callback");
    const deviceApprove = await request<{ ok: true; grant: { id: string } }>(
      `/v4/access-requests/${targetedId}/approve`,
      {
        admin: false,
        userSessionToken: deviceSessionToken,
        method: "POST",
        body: JSON.stringify({ connection_id: connectionId }),
      },
    );
    assert(deviceApprove.status === 201, deviceApprove.text);

    let callbackArrived = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (
        callbackDeliveries.some(
          (delivery) =>
            delivery.access_request_id === targetedId && delivery.status === "approved",
        )
      ) {
        callbackArrived = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(callbackArrived, "agent callback was not delivered after approval");

    console.log("v4 E2E: revoke device");
    const revokeDevice = await request<{ ok: true }>(`/v4/devices/${deviceId}`, {
      admin: false,
      userSessionToken,
      method: "DELETE",
    });
    assert(revokeDevice.status === 200, revokeDevice.text);

    console.log("v4 E2E: all checks passed");
  } finally {
    mockServer.stop(true);
  }
}

void main();
