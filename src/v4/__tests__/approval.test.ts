import { describe, expect, test } from "bun:test";

import {
  approvalFromAccessRow,
  approvalIsPending,
  buildDelegationResource,
  toAccessRequestPublic,
  type AccessRequestRow,
} from "../approval";

function accessRow(overrides: Partial<AccessRequestRow> = {}): AccessRequestRow {
  return {
    id: "req-1",
    agent_id: "agent-1",
    provider_slug: "github",
    requested_hosts: ["api.github.com"],
    reason: "Create an issue",
    status: "pending",
    user_id: null,
    user_hint: "github:alice",
    callback_url: null,
    connection_id: null,
    grant_id: null,
    expires_at: "2026-12-01T00:00:00.000Z",
    decided_at: null,
    metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    approval_type: "delegation",
    principal_type: "user",
    principal_id: "github:alice",
    action: "delegate",
    resource: { provider: "github", hosts: ["api.github.com"] },
    context: {},
    risk: null,
    decision: null,
    ...overrides,
  };
}

describe("approval request mapping", () => {
  test("a legacy row without new columns is a delegation approval", () => {
    const approval = approvalFromAccessRow(
      accessRow({
        approval_type: undefined,
        principal_id: undefined,
        action: undefined,
        resource: undefined,
        decision: undefined,
      }),
    );
    expect(approval.type).toBe("delegation");
    expect(approval.action).toBe("delegate");
    expect(approval.principal).toEqual({ type: "user", id: "github:alice" });
    expect(approval.resource).toEqual({ provider: "github", hosts: ["api.github.com"] });
  });

  test("the v4 wire shape keeps access_request_id and adds type", () => {
    const publicRequest = toAccessRequestPublic(approvalFromAccessRow(accessRow()));
    expect(publicRequest.access_request_id).toBe("req-1");
    expect(publicRequest.provider).toBe("github");
    expect(publicRequest.type).toBe("delegation");
    expect(publicRequest.mandate_id).toBeNull();
    expect(publicRequest.decision).toBeNull();
  });

  test("an approved row exposes the minted mandate as mandate_id", () => {
    const approval = approvalFromAccessRow(
      accessRow({
        status: "approved",
        grant_id: "grant-1",
        user_id: "github:alice",
        decided_at: "2026-01-02T00:00:00.000Z",
        decision: {
          verdict: "approved",
          decided_by: "github:alice",
          decided_at: "2026-01-02T00:00:00.000Z",
          mandate_id: "grant-1",
        },
      }),
    );
    expect(approval.mandate_id).toBe("grant-1");
    expect(approval.decision).toMatchObject({
      verdict: "approved",
      mandate_id: "grant-1",
      decided_by: "github:alice",
    });
  });

  test("pending expires according to expires_at", () => {
    const approval = approvalFromAccessRow(accessRow());
    expect(approvalIsPending(approval, new Date("2026-06-01T00:00:00.000Z"))).toBe(true);
    expect(approvalIsPending(approval, new Date("2027-01-01T00:00:00.000Z"))).toBe(false);
  });

  test("buildDelegationResource is the phase-3 resource envelope", () => {
    expect(buildDelegationResource({ provider: "github", hosts: ["api.github.com"] })).toEqual({
      provider: "github",
      hosts: ["api.github.com"],
    });
  });
});
