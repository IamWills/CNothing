import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/cnothing_test";
process.env.KEYSERVICE_MASTER_KEY ??= Buffer.alloc(32).toString("base64url");
process.env.KEYSERVICE_BEARER_TOKEN ??= "test-admin-token";

const { handleMcpMessage, processMcpRequest } = await import("../mcp-handler");

const modernMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

describe("CNothing v4 MCP contract", () => {
  test("exposes only the five production workflow tools", async () => {
    const response = await processMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const result = response?.result as { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> };
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "list_grants",
      "list_providers",
      "request_access",
      "get_access_status",
      "proxy_request",
    ]);
    for (const tool of result.tools) {
      expect(JSON.stringify(tool.inputSchema)).not.toContain("agent_access_token");
    }
  });

  test("keeps the 2025-era initialize handshake compatible", async () => {
    const response = await processMcpRequest({
      jsonrpc: "2.0",
      id: "init",
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    });
    expect(response?.result).toMatchObject({
      protocolVersion: "2025-11-25",
      serverInfo: { name: "cnothing-v4", version: "4.0.0" },
      capabilities: { tools: { listChanged: false }, resources: { subscribe: false } },
    });
  });

  test("advertises the stateless MCP 2026-07-28 contract", async () => {
    const response = await processMcpRequest({
      jsonrpc: "2.0",
      id: "discover",
      method: "server/discover",
      params: { _meta: modernMeta },
    });
    expect(response?.result).toMatchObject({
      resultType: "complete",
      supportedVersions: ["2026-07-28", "2025-11-25", "2025-06-18", "2024-11-05"],
      capabilities: { tools: { listChanged: false }, resources: { subscribe: false } },
      ttlMs: 300000,
      cacheScope: "public",
    });
  });

  test("requires matching modern HTTP routing headers", async () => {
    const response = await handleMcpMessage(
      new Request("https://cnothing.test/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/list",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "resources/list",
          params: { _meta: modernMeta },
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: -32020 } });
  });

  test("does not respond to notifications", async () => {
    expect(
      await processMcpRequest({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ).toBeNull();
  });

  test("requires transport-authenticated agent for tool calls", async () => {
    const response = await processMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_grants", arguments: {} },
    });
    expect(response?.error).toMatchObject({
      code: -32001,
      data: { status: "enrollment_required", next_action: "complete_host_enrollment" },
    });
    expect(JSON.stringify(response)).not.toMatch(/"access_token"/);
    expect(JSON.stringify(response)).not.toContain("enrs_");
  });
});
