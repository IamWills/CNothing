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
