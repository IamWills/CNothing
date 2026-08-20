import { describe, expect, test } from "bun:test";

import { classifyProxyAction, evaluatePolicy } from "../policy";
import { mandateFromGrantRow, type GrantRow } from "../mandate";

function mandate(overrides: Partial<GrantRow["constraints"]> = {}) {
  return mandateFromGrantRow({
    id: "grant-1",
    agent_id: "agent-1",
    user_id: "github:alice",
    connection_id: "conn-1",
    provider_id: "provider-1",
    allowed_hosts: ["api.github.com"],
    allowed_methods: ["GET", "POST"],
    status: "active",
    expires_at: null,
    last_used_at: null,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    principal_type: "user",
    principal_id: "github:alice",
    constraints: {
      hosts: ["api.github.com"],
      methods: ["GET", "POST"],
      expires_at: null,
      ...overrides,
    },
    actions: [],
    revoked_at: null,
  });
}

describe("policy engine", () => {
  test("allows reads and writes when the mandate has not opted in", () => {
    expect(
      evaluatePolicy({
        method: "POST",
        url: new URL("https://api.github.com/repos/acme/app/issues"),
        mandate: mandate(),
      }),
    ).toEqual({ decision: "allow" });
    expect(
      evaluatePolicy({
        method: "GET",
        url: new URL("https://api.github.com/user"),
        mandate: mandate({ require_approval: true }),
      }),
    ).toEqual({ decision: "allow" });
  });

  test("requires approval for a GitHub issue create when the mandate opts in", () => {
    const decision = evaluatePolicy({
      method: "POST",
      url: new URL("https://api.github.com/repos/acme/app/issues"),
      mandate: mandate({ require_approval: true }),
    });
    expect(decision).toMatchObject({
      decision: "approval_required",
      action: "issues.create",
    });
  });

  test("classifies only the issues collection POST as issues.create", () => {
    expect(
      classifyProxyAction("POST", new URL("https://api.github.com/repos/acme/app/issues")),
    ).toBe("issues.create");
    expect(
      classifyProxyAction("POST", new URL("https://api.github.com/repos/acme/app/issues/1/comments")),
    ).toBe("http.post");
  });

  test("can opt a single method in via approval_required_methods", () => {
    const decision = evaluatePolicy({
      method: "DELETE",
      url: new URL("https://api.github.com/user/emails"),
      mandate: mandate({
        methods: ["GET", "POST", "DELETE"],
        approval_required_methods: ["DELETE"],
      }),
    });
    expect(decision.decision).toBe("approval_required");
    expect(
      evaluatePolicy({
        method: "POST",
        url: new URL("https://api.github.com/user/emails"),
        mandate: mandate({ approval_required_methods: ["DELETE"] }),
      }),
    ).toEqual({ decision: "allow" });
  });
});
