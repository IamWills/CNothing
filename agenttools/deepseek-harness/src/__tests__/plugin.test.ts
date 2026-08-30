import { expect, test } from "bun:test";

import { createCNothingAgent, MemoryCredentialStore } from "cnothing-agent";

import { apply, createCNothingTools, inject, name } from "../plugin";
import type { ToolDefinition } from "../dsh-types";

test("plugin metadata matches the DeepSeek Cordis contract", () => {
  expect(name).toBe("cnothing");
  expect(inject).toEqual(["tools"]);
});

test("apply registers the five CNothing tools", () => {
  const registered: ToolDefinition[] = [];
  apply({
    tools: {
      register(definition) {
        registered.push(definition);
        return () => undefined;
      },
    },
  });
  expect(registered.map((tool) => tool.name)).toEqual([
    "list_grants",
    "list_providers",
    "request_access",
    "get_access_status",
    "proxy_request",
  ]);
});

test("tool output render never includes host secrets", async () => {
  const agent = createCNothingAgent({
    store: new MemoryCredentialStore(),
    fetch: async () =>
      new Response(
        JSON.stringify({
          enrollment_id: "enr-1",
          enrollment_secret: "enrs_secret",
          approval_url: "https://cnothing.com/approve-agent/enr-1",
          user_code: "CC33-DD44",
          expires_at: "2099-01-01T00:00:00.000Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
  });
  const [listGrants] = createCNothingTools(agent);
  const value = await listGrants?.execute({});
  const rendered = listGrants?.output.render({}, value) ?? [];
  expect(JSON.stringify(value)).not.toContain("enrs_");
  expect(rendered[0]?.text).toContain("enrollment_required");
  expect(rendered[0]?.text).not.toContain("enrs_");
});
