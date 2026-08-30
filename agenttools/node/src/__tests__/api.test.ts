import { expect, test } from "bun:test";

import { createCNothingAgent } from "../index";
import { MemoryCredentialStore } from "../index";

test("public SDK has no getToken and returns enrollment_required without secrets", async () => {
  const agent = createCNothingAgent({
    store: new MemoryCredentialStore(),
    fetch: async () =>
      new Response(
        JSON.stringify({
          enrollment_id: "enr-1",
          enrollment_secret: "enrs_secret",
          approval_url: "https://cnothing.com/approve-agent/enr-1",
          user_code: "ZZ11-YY22",
          expires_at: "2099-01-01T00:00:00.000Z",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
  });

  expect(Object.getOwnPropertyNames(Object.getPrototypeOf(agent))).not.toContain("getToken");
  const identity = await agent.ensureIdentity();
  expect(identity.status).toBe("enrollment_required");
  expect(JSON.stringify(identity)).not.toContain("enrs_");
});
