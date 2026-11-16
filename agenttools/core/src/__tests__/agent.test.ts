import { expect, test } from "bun:test";

import { createCNothingAgent } from "../agent";
import { MemoryCredentialStore } from "../memory-store";
import { containsHostSecret } from "../redaction";

type MockCall = { url: string; init?: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("ensureIdentity starts enrollment and never returns secrets", async () => {
  const calls: MockCall[] = [];
  const store = new MemoryCredentialStore();
  const agent = createCNothingAgent({
    store,
    clientName: "test-runtime",
    softwareId: "test",
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      return jsonResponse(201, {
        enrollment_id: "enr-1",
        enrollment_secret: "enrs_host_only",
        approval_url: "https://cnothing.com/approve-agent/enr-1",
        user_code: "AB12-CD34",
        expires_at: "2099-01-01T00:00:00.000Z",
        retry_after_seconds: 5,
      });
    },
  });

  const identity = await agent.ensureIdentity();
  expect(identity.status).toBe("enrollment_required");
  expect("enrollment_secret" in identity).toBe(false);
  expect(JSON.stringify(identity)).not.toContain("enrs_");
  expect(calls[0]?.url).toContain("/v4/agent-enrollments");
  expect(await store.readEnrollment()).not.toBeNull();
});

test("second poll claims the token into the store and listGrants uses it", async () => {
  const store = new MemoryCredentialStore();
  let enrollments = 0;
  const agent = createCNothingAgent({
    store,
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/v4/agent-enrollments") && method === "POST") {
        enrollments += 1;
        return jsonResponse(201, {
          enrollment_id: "enr-1",
          enrollment_secret: "enrs_host_only",
          approval_url: "https://cnothing.com/approve-agent/enr-1",
          user_code: "AB12-CD34",
          expires_at: "2099-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/v4/agent-enrollments/enr-1")) {
        return jsonResponse(200, {
          status: "approved",
          access_token: "agent_claimed_token",
        });
      }
      if (url.endsWith("/v4/grants")) {
        const auth = new Headers(init?.headers).get("authorization");
        expect(auth).toBe("Bearer agent_claimed_token");
        return jsonResponse(200, { ok: true, grants: [] });
      }
      return jsonResponse(404, { error: { message: url } });
    },
  });

  const first = await agent.listGrants();
  expect(first).toMatchObject({ status: "enrollment_required" });
  expect(containsHostSecret(first)).toBe(false);

  const second = await agent.listGrants();
  expect(second).toMatchObject({ ok: true, grants: [] });
  expect(enrollments).toBe(1);
  expect(await store.readToken()).toBe("agent_claimed_token");
  expect(await store.readEnrollment()).toBeNull();
  expect("getToken" in agent).toBe(false);
});

test("proxy_request strips credential headers before calling the API", async () => {
  const store = new MemoryCredentialStore();
  await store.writeToken("agent_ready");
  let body: Record<string, unknown> = {};
  const agent = createCNothingAgent({
    store,
    fetch: async (input, init) => {
      if (String(input).endsWith("/v4/proxy")) {
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return jsonResponse(200, { ok: true, status: "ok" });
      }
      return jsonResponse(404, {});
    },
  });

  await agent.proxyRequest({
    grant_id: "gr_1",
    method: "GET",
    url: "https://api.github.com/user",
    headers: {
      Authorization: "Bearer stolen",
      Cookie: "session=1",
      Accept: "application/json",
    },
  });

  expect(body.headers).toEqual({ Accept: "application/json" });
});

test("GitHub flow pairs once, preserves pending request, then verifies API access without tokens", async () => {
  const store = new MemoryCredentialStore();
  const calls: string[] = [];
  let checks = 0;
  const agent = createCNothingAgent({ store, fetch: async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/v4/agent-enrollments") return jsonResponse(201, {
      enrollment_id: "pairing-1", enrollment_secret: "enrs_private",
      approval_url: "https://cnothing.com/approve-agent/pairing-1", user_code: "ABCD",
    });
    if (path === "/v4/agent-enrollments/pairing-1") return jsonResponse(200, {
      status: "approved", access_token: "agent_private",
    });
    if (path === "/v4/grants") return jsonResponse(200, { ok: true, items: [] });
    if (path === "/v4/providers") return jsonResponse(200, { ok: true, items: [{ slug: "github" }] });
    if (path === "/v4/access-requests") return jsonResponse(201, {
      ok: true, status: "pending", access_request_id: "access-1",
      approval_url: "https://cnothing.com/approve-proxy/access-1",
    });
    if (path === "/v4/access-requests/access-1") {
      checks++;
      return jsonResponse(200, checks === 1 ? {
        ok: true, status: "pending", access_request_id: "access-1", waiting_for: "provider_connection",
      } : { ok: true, type: "delegation", status: "approved", grant_id: "grant-1" });
    }
    if (path === "/v4/proxy") {
      expect(JSON.parse(String(init?.body))).toEqual({ grant_id: "grant-1", method: "GET", url: "https://api.github.com/user" });
      return jsonResponse(200, { ok: true, status: 200, body: { login: "alice" } });
    }
    return jsonResponse(404, {});
  } });
  expect(await agent.listGrants()).toMatchObject({ status: "enrollment_required", resume_tool: "list_grants" });
  expect(await agent.listGrants()).toMatchObject({ next_action: "call_list_providers" });
  expect(await agent.listProviders()).toMatchObject({ next_action: "call_request_access" });
  expect(await agent.requestAccess({ provider: "github", reason: "Verify my GitHub account" })).toMatchObject({ access_request_id: "access-1" });
  expect(await agent.getAccessStatus({ access_request_id: "access-1" })).toMatchObject({ status: "pending", retry_after_seconds: 5, next_action: "wait_for_user" });
  const approved = await agent.getAccessStatus({ access_request_id: "access-1" });
  expect(approved).toMatchObject({ next_action: "call_proxy_request", grant_id: "grant-1" });
  expect(containsHostSecret(approved)).toBe(false);
  expect(await agent.proxyRequest({ grant_id: "grant-1", method: "GET", url: "https://api.github.com/user" })).toMatchObject({ status: "ok", http_status: 200, body: { login: "alice" } });
  expect(calls.filter((call) => call === "POST /v4/agent-enrollments")).toHaveLength(1);
  expect(calls.filter((call) => call === "POST /v4/access-requests")).toHaveLength(1);
});

test("API errors retain actionable details instead of prompting blind retries", async () => {
  const store = new MemoryCredentialStore();
  await store.writeToken("agent_ready");
  const agent = createCNothingAgent({ store, fetch: async () => jsonResponse(400, {
    error: { message: "Missing hosts", details: { error_code: "missing_hosts" } },
  }) });
  expect(await agent.requestAccess({ provider: "custom", reason: "Read" })).toMatchObject({
    ok: false, http_status: 400, error: { message: "Missing hosts", details: { error_code: "missing_hosts" } },
  });
});
