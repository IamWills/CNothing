import { describe, expect, test } from "bun:test";

import {
  buildMandateConstraints,
  evaluateMandateForRequest,
  mandateFromGrantRow,
  mandateIsRevokedOrExpired,
  resolveMandateConstraints,
  toGrantPublic,
  type GrantRow,
} from "../mandate";

function grantRow(overrides: Partial<GrantRow> = {}): GrantRow {
  return {
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
    },
    actions: [],
    revoked_at: null,
    ...overrides,
  };
}

describe("mandate constraint envelope", () => {
  test("buildMandateConstraints stores the current HTTP-level fields", () => {
    expect(
      buildMandateConstraints({
        hosts: ["api.github.com"],
        methods: ["GET"],
        expires_at: "2026-12-01T00:00:00.000Z",
      }),
    ).toEqual({
      hosts: ["api.github.com"],
      methods: ["GET"],
      expires_at: "2026-12-01T00:00:00.000Z",
    });
  });

  test("empty constraints fall back to the original grant columns", () => {
    expect(
      resolveMandateConstraints(
        grantRow({
          allowed_hosts: ["api.github.com"],
          allowed_methods: ["GET"],
          expires_at: "2026-12-01T00:00:00.000Z",
          constraints: {},
        }),
      ),
    ).toEqual({
      hosts: ["api.github.com"],
      methods: ["GET"],
      expires_at: "2026-12-01T00:00:00.000Z",
    });
  });

  test("an explicit null expires_at in constraints wins over the column", () => {
    expect(
      resolveMandateConstraints(
        grantRow({
          expires_at: "2026-12-01T00:00:00.000Z",
          constraints: { hosts: ["api.github.com"], methods: ["GET"], expires_at: null },
        }),
      ).expires_at,
    ).toBeNull();
  });

  test("maps a grant row to a Mandate whose principal is the granting user", () => {
    const mandate = mandateFromGrantRow(grantRow());
    expect(mandate.principal).toEqual({ type: "user", id: "github:alice" });
    expect(mandate.issued_at).toBe("2026-01-01T00:00:00.000Z");
    expect(mandate.hosts).toEqual(["api.github.com"]);
    expect(mandate.actions).toEqual([]);
  });

  test("the v4 grant wire shape keeps allowed_hosts and adds constraints", () => {
    const publicGrant = toGrantPublic(mandateFromGrantRow(grantRow()));
    expect(publicGrant.allowed_hosts).toEqual(["api.github.com"]);
    expect(publicGrant.allowed_methods).toEqual(["GET", "POST"]);
    expect(publicGrant.constraints).toEqual({
      hosts: ["api.github.com"],
      methods: ["GET", "POST"],
      expires_at: null,
    });
    expect(publicGrant.principal).toEqual({ type: "user", id: "github:alice" });
  });
});

describe("evaluateMandateForRequest", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");

  test("allows a request inside the host and method constraints", () => {
    expect(
      evaluateMandateForRequest({
        mandate: mandateFromGrantRow(grantRow()),
        method: "post",
        host: "api.github.com",
        now,
      }),
    ).toEqual({ allowed: true });
  });

  test("rejects a host outside the allowlist", () => {
    const decision = evaluateMandateForRequest({
      mandate: mandateFromGrantRow(grantRow()),
      method: "GET",
      host: "evil.example.com",
      now,
    });
    expect(decision).toMatchObject({ allowed: false, error_code: "host_not_allowed" });
  });

  test("rejects a method outside the allowlist", () => {
    const decision = evaluateMandateForRequest({
      mandate: mandateFromGrantRow(grantRow()),
      method: "DELETE",
      host: "api.github.com",
      now,
    });
    expect(decision).toMatchObject({ allowed: false, error_code: "method_not_allowed" });
  });

  test("rejects an expired mandate", () => {
    const mandate = mandateFromGrantRow(
      grantRow({
        expires_at: "2026-01-01T00:00:00.000Z",
        constraints: {
          hosts: ["api.github.com"],
          methods: ["GET"],
          expires_at: "2026-01-01T00:00:00.000Z",
        },
      }),
    );
    expect(mandateIsRevokedOrExpired(mandate, now)?.error_code).toBe("grant_expired");
  });

  test("rejects a revoked mandate even if status has not been read from the row", () => {
    const mandate = mandateFromGrantRow(
      grantRow({
        status: "revoked",
        revoked_at: "2026-05-01T00:00:00.000Z",
      }),
    );
    expect(mandateIsRevokedOrExpired(mandate, now)?.error_code).toBe("grant_revoked");
  });

  test("unknown future constraint keys are ignored (opt-in)", () => {
    const decision = evaluateMandateForRequest({
      mandate: mandateFromGrantRow(
        grantRow({
          constraints: {
            hosts: ["api.github.com"],
            methods: ["GET"],
            expires_at: null,
            max_amount: 1000,
            currency: "USD",
            approval_required: true,
          },
        }),
      ),
      method: "GET",
      host: "api.github.com",
      now,
    });
    expect(decision).toEqual({ allowed: true });
  });
});
