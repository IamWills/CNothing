import { describe, expect, test } from "bun:test";
import { CNothingAgentClient, CNothingAgentError } from "../agent-client";

function mockFetch(handlers: Record<string, (init?: RequestInit) => Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url).pathname;
    const handler = handlers[path];
    if (!handler) {
      return Response.json({ error: { message: `Unhandled path: ${path}` } }, { status: 404 });
    }
    return handler(init);
  }) as typeof fetch;
}

describe("CNothingAgentClient v2.5", () => {
  test("listCapabilities uses /v2/agent/capabilities", async () => {
    const fetchImpl = mockFetch({
      "/v2/agent/capabilities": () =>
        Response.json({
          ok: true,
          items: [
            {
              name: "github.create_issue",
              display_name: "Create Issue",
              description: "Create a GitHub issue",
              capability_type: "ACTION",
              risk_level: "MEDIUM",
              required_scopes: ["repo"],
              input_schema: {},
              output_schema: {},
              connection_required: true,
              authorized: false,
              grant_status: null,
            },
          ],
        }),
    });

    const client = new CNothingAgentClient({
      baseUrl: "http://127.0.0.1:3021",
      accessToken: "agent-token",
      fetch: fetchImpl,
    });

    expect(client.version).toBe("v2.5");
    const items = await client.listCapabilities();
    expect(items[0]?.name).toBe("github.create_issue");
    expect(items[0]?.authorized).toBe(false);
  });

  test("invoke uses /v2/agent/invoke and surfaces authorization_required", async () => {
    const fetchImpl = mockFetch({
      "/v2/agent/invoke": () =>
        Response.json(
          {
            ok: false,
            error_code: "authorization_required",
            message: "Authorization required for this capability",
            approval_url: "https://cnothing.com/approve/abc",
          },
          { status: 403 },
        ),
    });

    const client = new CNothingAgentClient({
      baseUrl: "http://127.0.0.1:3021",
      accessToken: "agent-token",
      fetch: fetchImpl,
    });

    await expect(
      client.invoke({ capability: "github.create_issue", input: { owner: "a", repo: "b", title: "t" } }),
    ).rejects.toMatchObject({
      name: "CNothingAgentError",
      statusCode: 403,
    });

    try {
      await client.invoke({ capability: "github.create_issue" });
    } catch (error) {
      expect(error).toBeInstanceOf(CNothingAgentError);
      expect((error as CNothingAgentError).isAuthorizationRequired).toBe(true);
    }
  });

  test("requestAuthorization posts single capability to v2.5 endpoint", async () => {
    const fetchImpl = mockFetch({
      "/v2/agent/authorizations": (init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { capability?: string };
        expect(body.capability).toBe("github.create_issue");
        return Response.json(
          {
            authorization_id: "auth-1",
            approval_url: "https://cnothing.com/approve/auth-1",
            status: "pending",
          },
          { status: 201 },
        );
      },
    });

    const client = new CNothingAgentClient({
      baseUrl: "http://127.0.0.1:3021",
      accessToken: "agent-token",
      fetch: fetchImpl,
    });

    const result = await client.requestAuthorization({
      capability: "github.create_issue",
      reason: "Need to file bugs",
    });

    expect(result).toMatchObject({
      authorization_id: "auth-1",
      status: "pending",
    });
  });

  test("listGrants and revokeGrant use v2.5 grant endpoints", async () => {
    const fetchImpl = mockFetch({
      "/v2/agent/grants": () =>
        Response.json({
          ok: true,
          items: [{ id: "grant-1", capability: "github.create_issue", status: "approved" }],
        }),
      "/v2/agent/grants/revoke": (init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { grant_id?: string };
        expect(body.grant_id).toBe("grant-1");
        return Response.json({ ok: true, grant_id: "grant-1", status: "revoked" });
      },
    });

    const client = new CNothingAgentClient({
      baseUrl: "http://127.0.0.1:3021",
      accessToken: "agent-token",
      fetch: fetchImpl,
    });

    const grants = await client.listGrants();
    expect(grants[0]?.id).toBe("grant-1");

    const revoked = await client.revokeGrant("grant-1");
    expect(revoked.status).toBe("revoked");
  });
});

describe("CNothingAgentClient legacy v2", () => {
  test("uses legacy invoke path when apiVersion is v2", async () => {
    let invokedPath = "";
    const fetchImpl = (async (input: RequestInfo | URL) => {
      invokedPath = new URL(typeof input === "string" ? input : input.toString()).pathname;
      return Response.json({ ok: true, request_id: "r1", capability: "search.query", result: {} });
    }) as typeof fetch;

    const client = new CNothingAgentClient({
      baseUrl: "http://127.0.0.1:3021",
      accessToken: "agent-token",
      apiVersion: "v2",
      fetch: fetchImpl,
    });

    await client.invoke({ capability: "search.query" });
    expect(invokedPath).toBe("/v2/capabilities/invoke");
  });
});
