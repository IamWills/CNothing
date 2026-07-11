import { describe, expect, test, mock, beforeEach } from "bun:test";
import type { CapabilityRecord, AgentRecord } from "../../v2/v2.entity";
import type { TrustPolicyRecord } from "../policy-engine/policy.repository";

function fakeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    name: "test-agent",
    public_key_pem: null,
    owner_user_id: "user-1",
    tenant_id: "default",
    status: "active",
    metadata: {},
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function fakeCapability(overrides: Partial<CapabilityRecord> = {}): CapabilityRecord {
  return {
    id: "cap-1",
    connector_id: "conn-1",
    name: "github.get_user",
    description: "test",
    capability_type: "QUERY",
    input_schema: {},
    output_schema: {},
    scopes: ["read:user"],
    risk_level: "LOW",
    status: "active",
    metadata: {},
    provider_id: null,
    display_name: "Get User",
    connection_required: true,
    source: "provider_template",
    invocation_type: "builtin",
    invocation_config: {},
    policy_config: {},
    execution_type: "oauth_api",
    approval_policy: "none",
    owner_user_id: null,
    provider: "github",
    deleted_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function fakeTrustPolicy(overrides: Partial<TrustPolicyRecord>): TrustPolicyRecord {
  return {
    id: "policy-1",
    name: "test",
    description: "",
    capability_id: null,
    capability_pattern: null,
    provider_pattern: null,
    agent_id: null,
    agent_allowlist: [],
    provider_allowlist: [],
    effect: "allow",
    risk_level: "medium",
    rate_limit_per_minute: null,
    time_window_start: null,
    time_window_end: null,
    time_window_tz: "UTC",
    resource_constraint: {},
    scope_limit: [],
    destructive_action_block: false,
    require_reauth: false,
    priority: 100,
    enabled: true,
    status: "active",
    tenant_id: "default",
    metadata: {},
    created_at: "",
    updated_at: "",
    deleted_at: null,
    ...overrides,
  };
}

describe("14. Policy Engine — deny beats grant allow", () => {
  beforeEach(() => {
    mock.restore();
  });

  test("github.delete_repo default deny without explicit allow", async () => {
    mock.module("../policy-engine/policy.repository", () => ({
      listTrustPolicies: async () => [],
    }));
    mock.module("../gateway.repository", () => ({
      listCapabilityPermissions: async () => [],
      incrementRateLimitBucket: async () => 1,
    }));

    // Re-import after mock
    const { evaluateCapabilityPolicy } = await import(
      `../policy-engine/policy-engine-v3.ts?t=${Date.now()}`
    );

    const decision = await evaluateCapabilityPolicy({
      agent: fakeAgent(),
      capability: fakeCapability({
        name: "github.delete_repo",
        risk_level: "HIGH",
        approval_policy: "none",
      }),
    });

    expect(decision.decision).toBe("deny");
    expect(decision.reason).toContain("Destructive");
    expect(decision.risk_level).toBe("critical");
  });

  test("explicit deny policy wins even if capability would otherwise allow", async () => {
    mock.module("../policy-engine/policy.repository", () => ({
      listTrustPolicies: async () => [
        fakeTrustPolicy({
          id: "policy-github-delete-repo-deny",
          capability_pattern: "github.delete_repo",
          effect: "deny",
          risk_level: "critical",
          priority: 10,
          destructive_action_block: true,
          metadata: { reason: "Destructive actions denied by default" },
        }),
        fakeTrustPolicy({
          id: "policy-allow-all",
          capability_pattern: "*",
          effect: "allow",
          risk_level: "low",
          priority: 999,
        }),
      ],
    }));
    mock.module("../gateway.repository", () => ({
      listCapabilityPermissions: async () => [
        {
          id: "perm-allow",
          agent_id: null,
          capability_id: null,
          capability_pattern: "github.*",
          provider_pattern: null,
          effect: "allow",
          require_approval: false,
          max_risk_level: null,
          rate_limit_per_minute: null,
          status: "active",
          metadata: {},
          created_at: "",
          updated_at: "",
        },
      ],
      incrementRateLimitBucket: async () => 1,
    }));

    const { evaluateCapabilityPolicy } = await import(
      `../policy-engine/policy-engine-v3.ts?t=${Date.now() + 1}`
    );

    const decision = await evaluateCapabilityPolicy({
      agent: fakeAgent(),
      capability: fakeCapability({ name: "github.delete_repo", risk_level: "HIGH" }),
    });

    expect(decision.decision).toBe("deny");
    expect(decision.matched_policy_id).toBe("policy-github-delete-repo-deny");
  });

  test("github.create_repo require_approval", async () => {
    mock.module("../policy-engine/policy.repository", () => ({
      listTrustPolicies: async () => [
        fakeTrustPolicy({
          id: "policy-github-create-repo-approval",
          capability_pattern: "github.create_repo",
          effect: "require_approval",
          risk_level: "high",
          priority: 20,
          metadata: {
            reason: "Repository creation requires human approval",
            approval_policy: "every_time",
          },
        }),
      ],
    }));
    mock.module("../gateway.repository", () => ({
      listCapabilityPermissions: async () => [],
      incrementRateLimitBucket: async () => 1,
    }));

    const { evaluateCapabilityPolicy } = await import(
      `../policy-engine/policy-engine-v3.ts?t=${Date.now() + 2}`
    );

    const decision = await evaluateCapabilityPolicy({
      agent: fakeAgent(),
      capability: fakeCapability({
        name: "github.create_repo",
        risk_level: "HIGH",
        approval_policy: "every_time",
      }),
    });

    expect(decision.decision).toBe("require_approval");
    expect(decision.matched_policy_id).toBe("policy-github-create-repo-approval");
    expect(decision.force_approval_policy).toBe("every_time");
  });

  test("github.get_user allow", async () => {
    mock.module("../policy-engine/policy.repository", () => ({
      listTrustPolicies: async () => [
        fakeTrustPolicy({
          id: "policy-github-get-user-allow",
          capability_pattern: "github.get_user",
          effect: "allow",
          risk_level: "low",
          priority: 50,
        }),
      ],
    }));
    mock.module("../gateway.repository", () => ({
      listCapabilityPermissions: async () => [],
      incrementRateLimitBucket: async () => 1,
    }));

    const { evaluateCapabilityPolicy, publicPolicyDecision } = await import(
      `../policy-engine/policy-engine-v3.ts?t=${Date.now() + 3}`
    );

    const decision = await evaluateCapabilityPolicy({
      agent: fakeAgent(),
      capability: fakeCapability({ name: "github.get_user" }),
    });

    expect(decision.decision).toBe("allow");
    const pub = publicPolicyDecision(decision);
    expect(pub.decision).toBe("allow");
    expect(pub.matched_policy_id).toBe("policy-github-get-user-allow");
    expect(pub.risk_level).toBe("low");
    expect(typeof pub.reason).toBe("string");
  });
});
