import { expect, test } from "bun:test";

import { createCNothingAgent, MemoryCredentialStore } from "cnothing-agent";

import { handleMcpMessage } from "../server";

test("tools/call without a token returns enrollment_required and no secrets", async () => {
  const lines: string[] = [];
  const agent = createCNothingAgent({
    store: new MemoryCredentialStore(),
    fetch: async () =>
      new Response(
        JSON.stringify({
          enrollment_id: "enr-1",
          enrollment_secret: "enrs_secret",
          approval_url: "https://cnothing.com/approve-agent/enr-1",
          user_code: "AA11-BB22",
          expires_at: "2099-01-01T00:00:00.000Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
  });

  await handleMcpMessage(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_grants", arguments: {} },
    },
    { agent, write: (line) => lines.push(line) },
  );

  expect(lines).toHaveLength(1);
  const payload = JSON.parse(lines[0] ?? "{}") as {
    result: { structuredContent: { status: string }; content: Array<{ text: string }> };
  };
  expect(payload.result.structuredContent.status).toBe("enrollment_required");
  expect(JSON.stringify(payload)).not.toContain("enrs_");
  expect(JSON.stringify(payload)).not.toContain("agent_");
  expect(payload.result.content[0]?.text).toContain("approval_url");
});
