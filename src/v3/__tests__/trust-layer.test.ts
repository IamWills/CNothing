import { describe, expect, test } from "bun:test";
import {
  redactDom,
  sanitizeAgentFacing,
  sanitizeDeep,
  sanitizeLog,
  sanitizeWorkerResult,
} from "../sanitizer/sanitizer";
import {
  createAuditChainId,
  verifyAuditChain,
} from "../audit/audit-chain-hash";
import {
  deriveResourceKey,
  summarizeInputForApproval,
} from "../policy-engine/approval-helpers";
import { normalizeSecretType, secretTypeLookupVariants } from "../secret-types";
import type { CapabilityRecord } from "../../v2/v2.entity";
import { V3_PRINCIPLES, V3_PRODUCT, V3_TAGLINE } from "../v3.entity";

function fakeCapability(overrides: Partial<CapabilityRecord>): CapabilityRecord {
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

describe("Execution Trust Layer positioning", () => {
  test("product is Execution Trust Layer for AI Agents", () => {
    expect(V3_PRODUCT).toBe("Execution Trust Layer for AI Agents");
    expect(V3_TAGLINE).toContain("without exposing secrets");
    expect(V3_PRINCIPLES).toContain("Agent thinks.");
    expect(V3_PRINCIPLES).toContain("cnothing executes.");
    expect(V3_PRINCIPLES).toContain("Secrets never leave cnothing.");
  });
});

describe("1. Agent cannot read secrets (sanitizer)", () => {
  test("strips access_token, refresh_token, Authorization, cookie", () => {
    const sanitized = sanitizeAgentFacing({
      user: { login: "octocat" },
      access_token: "gho_secret_should_not_leak",
      refresh_token: "refresh_secret",
      headers: { Authorization: "Bearer gho_secret", cookie: "session=abc" },
      password: "hunter2",
      api_key: "sk-test",
      private_key: "-----BEGIN RSA PRIVATE KEY-----",
      mfa_secret: "otpauth://",
      recovery_code: "ABCD-1234",
    });
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("gho_secret");
    expect(text).not.toContain("refresh_secret");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("sk-test");
    expect(text).not.toContain("BEGIN RSA");
    expect(text).not.toContain("otpauth");
    expect(text).not.toContain("ABCD-1234");
    expect(text).toContain("octocat");
    expect(text).toContain("REDACTED");
  });
});

describe("3. Logs never contain real secret values", () => {
  test("sanitizeLog redacts Bearer and tokens", () => {
    const log = sanitizeLog(
      "Authorization: Bearer gho_REALTOKEN123 calling access_token=gho_REALTOKEN123 cookie=session=xyz",
    );
    expect(log).not.toContain("gho_REALTOKEN123");
    expect(log).not.toContain("session=xyz");
    expect(log).toContain("REDACTED");
  });
});

describe("13. Worker output passes Sanitizer", () => {
  test("sanitizeWorkerResult recursively cleans nested payloads", () => {
    const result = sanitizeWorkerResult({
      ok: true,
      body: { access_token: "gho_x", login: "a" },
      error: { message: "fail", authorization: "Bearer x" },
      logs: ["Bearer gho_abc"],
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain("gho_x");
    expect(text).not.toContain("gho_abc");
    expect(text).toContain("a");
  });

  test("redactDom removes password values", () => {
    const html = redactDom('<input type="password" value="secret123">');
    expect(html).not.toContain("secret123");
    expect(html).toContain("REDACTED");
  });
});

describe("gateway response contracts", () => {
  test("completed response has no secrets", () => {
    const response = sanitizeAgentFacing({
      status: "completed",
      execution_id: "exec-1",
      result: { login: "octocat", access_token: "gho_leak" },
    });
    expect(response.status).toBe("completed");
    expect(JSON.stringify(response)).not.toContain("gho_leak");
  });

  test("5. create_repo pending_approval shape", () => {
    const response = sanitizeAgentFacing({
      status: "pending_approval",
      approval_id: "appr-1",
      approval_url: "https://cnothing.com/dashboard/approvals/appr-1?token=appr_xxx",
      safe_summary: "name=demo-repo, private=true",
      execution_id: "exec-1",
      audit_chain_id: "ach_abc",
    });
    expect(response.status).toBe("pending_approval");
    expect(response.execution_id).toBe("exec-1");
  });

  test("7. delete_repo denied shape", () => {
    const response = sanitizeAgentFacing({
      status: "denied",
      execution_id: "exec-1",
      error: {
        code: "policy_denied",
        message: "Destructive actions denied by default",
        recoverable: false,
      },
    });
    expect(response.status).toBe("denied");
    expect(response.error.code).toBe("policy_denied");
  });

  test("9. reconnect_required shape", () => {
    const response = sanitizeAgentFacing({
      status: "reconnect_required",
      execution_id: "exec-1",
      connection_url: "https://cnothing.com/connect?provider=github",
      error: {
        code: "reconnect_required",
        message: "OAuth connection requires reconnection",
        recoverable: true,
      },
    });
    expect(response.status).toBe("reconnect_required");
    expect(response.connection_url).toContain("/connect");
  });

  test("10. dry_run completed shape", () => {
    const response = sanitizeAgentFacing({
      status: "completed",
      result: {
        dry_run: true,
        capability: "github.create_repo",
        policy: {
          decision: "require_approval",
          reason: "high risk",
          matched_policy_id: "p1",
          risk_level: "high",
        },
        approval_required: true,
        would_execute: false,
        safe_summary: "name=alpha",
        execution_plan: { worker_type: "oauth_api", risk_level: "HIGH", timeout_ms: 30000 },
        estimated_impact: {
          side_effects: false,
          requires_human_approval: true,
          requires_oauth: true,
          scopes: ["repo"],
        },
      },
      execution_id: "exec-1",
      audit_id: "a1",
    });
    expect(response.status).toBe("completed");
    expect(response.result.dry_run).toBe(true);
    expect(response.result.approval_required).toBe(true);
    expect(response.result.would_execute).toBe(false);
  });
});

describe("InvokeRequest OpenAPI production fields", () => {
  test("InvokeRequest and CapabilityInvokeRequest document idempotency_key, dry_run, timeout_ms", async () => {
    const doc = await Bun.file(
      new URL("../../../openapi-v3.json", import.meta.url),
    ).json();
    const legacy = doc.components.schemas.InvokeRequest.properties;
    const canonical = doc.components.schemas.CapabilityInvokeRequest.properties;
    for (const schema of [legacy, canonical]) {
      expect(schema.idempotency_key).toBeTruthy();
      expect(schema.dry_run).toBeTruthy();
      expect(schema.timeout_ms).toBeTruthy();
      expect(schema.reason).toBeTruthy();
    }
    expect(doc.components.schemas.DryRunPreview).toBeTruthy();
  });
});

describe("OpenAPI response schemas are production-complete", () => {
  test("invoke endpoints expose typed responses for all lifecycle statuses", async () => {
    const doc = await Bun.file(
      new URL("../../../openapi-v3.json", import.meta.url),
    ).json();
    const schemas = doc.components.schemas;
    for (const name of [
      "InvokeCompletedResponse",
      "InvokePendingApprovalResponse",
      "InvokeDeniedResponse",
      "InvokeReconnectRequiredResponse",
      "InvokeFailedResponse",
      "StructuredError",
      "ErrorResponse",
      "ExecutionObject",
      "LegacyAgentInvokeCompletedResponse",
      "LegacyAgentInvokePendingApprovalResponse",
      "CapabilityInvokeResponse",
    ]) {
      expect(schemas[name]).toBeTruthy();
    }
    expect(schemas.CapabilityInvokeResponse.discriminator.propertyName).toBe("status");

    const canonical =
      doc.paths["/api/v3/capabilities/{capabilityId}/invoke"].post.responses;
    expect(canonical["200"].content["application/json"].schema.$ref).toContain(
      "InvokeCompletedResponse",
    );
    expect(canonical["202"].content["application/json"].schema.$ref).toContain(
      "InvokePendingApprovalResponse",
    );
    expect(canonical["403"].content["application/json"].schema.$ref).toContain(
      "InvokeDeniedResponse",
    );
    expect(canonical["409"].content["application/json"].schema.$ref).toContain(
      "InvokeReconnectRequiredResponse",
    );
    expect(canonical["400"].content["application/json"].schema.$ref).toContain(
      "InvokeFailedResponse",
    );

    const legacy = doc.paths["/v3/agent/invoke"].post.responses;
    expect(legacy["200"].content["application/json"].schema.$ref).toContain(
      "LegacyAgentInvokeCompletedResponse",
    );
    expect(legacy["202"].content["application/json"].schema.$ref).toContain(
      "LegacyAgentInvokePendingApprovalResponse",
    );

    const exec = doc.paths["/api/v3/executions/{executionId}"].get.responses["200"];
    expect(exec.content["application/json"].schema.$ref).toContain("ExecutionObject");
  });
});

describe("12. Audit chain integrity", () => {
  test("createAuditChainId format", () => {
    expect(createAuditChainId()).toMatch(/^ach_[a-f0-9]+$/);
  });

  test("verifyAuditChain detects broken links", () => {
    const events = [
      { prev_hash: null, chain_hash: "aaa" },
      { prev_hash: "aaa", chain_hash: "bbb" },
    ];
    expect(verifyAuditChain(events).valid).toBe(true);

    events[1]!.prev_hash = "wrong";
    expect(verifyAuditChain(events).valid).toBe(false);
    expect(verifyAuditChain(events).broken_at).toBe(1);
  });
});

describe("vault secret types", () => {
  test("2. canonical types cover required secret kinds", () => {
    expect(normalizeSecretType("access_token")).toBe("oauth_access_token");
    expect(normalizeSecretType("refresh_token")).toBe("oauth_refresh_token");
    expect(normalizeSecretType("password")).toBe("password");
    expect(normalizeSecretType("mfa_secret")).toBe("mfa_secret");
    expect(secretTypeLookupVariants("oauth_access_token")).toContain("access_token");
  });
});

describe("approval helpers", () => {
  test("safe summary for create_repo", () => {
    const summary = summarizeInputForApproval({
      name: "demo-repo",
      private: true,
    });
    expect(summary).toContain("name=demo-repo");
  });

  test("deriveResourceKey for create_repo", () => {
    expect(
      deriveResourceKey(fakeCapability({ name: "github.create_repo" }), {
        name: "hello",
        org: "acme",
      }),
    ).toBe("acme/hello");
  });
});

describe("execution workers interfaces", () => {
  test("BrowserWorker exposes MFA / redact ops", async () => {
    const { BrowserWorker } = await import("../workers/browser.worker");
    const worker = new BrowserWorker();
    expect(worker.name).toBe("BrowserWorker");
    const mfa = await worker.wait_for_mfa("s1", "enter code");
    expect(mfa.status).toBe("waiting_for_mfa");
    expect(worker.redact_dom('<input value="x">')).toContain("REDACTED");
  });

  test("stub workers are production interfaces", async () => {
    const { SshWorker, ApiKeyWorker, WebhookWorker, ManualWorker } = await import(
      "../workers/stubs"
    );
    expect(new SshWorker().name).toBe("SshWorker");
    expect(new ApiKeyWorker().name).toBe("ApiKeyWorker");
    expect(new WebhookWorker().name).toBe("WebhookWorker");
    expect(new ManualWorker().name).toBe("ManualWorker");
  });
});

describe("14. Policy decision contract", () => {
  test("public decision shape", () => {
    const view = {
      decision: "deny" as const,
      reason: "Destructive actions denied by default",
      matched_policy_id: "policy-github-delete-repo-deny",
      risk_level: "critical" as const,
    };
    expect(view.decision).toBe("deny");
    expect(view.matched_policy_id).toBe("policy-github-delete-repo-deny");
    expect(view.risk_level).toBe("critical");
  });
});

describe("Execution API OpenAPI contract", () => {
  test("public openapi-v3.json documents execution poll/cancel/retry", async () => {
    const doc = await Bun.file(
      new URL("../../../openapi-v3.json", import.meta.url),
    ).json();
    expect(doc.paths["/api/v3/executions"]?.get).toBeTruthy();
    expect(doc.paths["/api/v3/executions/{executionId}"]?.get).toBeTruthy();
    expect(doc.paths["/api/v3/executions/{executionId}/cancel"]?.post).toBeTruthy();
    expect(doc.paths["/api/v3/executions/{executionId}/retry"]?.post).toBeTruthy();
    expect(doc.paths["/v3/executions"]?.get).toBeTruthy();
    expect(doc.paths["/v3/executions/{executionId}"]?.get).toBeTruthy();
    expect(doc.components.schemas.ExecutionStatus.enum).toContain("pending_approval");
    expect(doc.components.schemas.ExecutionStatus.enum).toContain("reconnect_required");
  });
});

describe("Unified Approval OpenAPI contract", () => {
  test("public openapi-v3.json documents unified approvals", async () => {
    const doc = await Bun.file(
      new URL("../../../openapi-v3.json", import.meta.url),
    ).json();
    expect(doc.paths["/api/v3/approvals"]?.get).toBeTruthy();
    expect(doc.paths["/api/v3/approvals/{id}"]?.get).toBeTruthy();
    expect(doc.paths["/api/v3/approvals/{id}/approve"]?.post).toBeTruthy();
    expect(doc.paths["/api/v3/approvals/{id}/reject"]?.post).toBeTruthy();
    expect(doc.paths["/v3/approvals"]?.get).toBeTruthy();
    expect(doc.paths["/v3/approvals/{id}/approve"]?.post).toBeTruthy();
    expect(doc.components.schemas.ApprovalType.enum).toEqual([
      "capability_grant",
      "execution_confirmation",
      "reauthentication",
    ]);
    expect(doc.paths["/v3/authorize/approve"]?.post?.deprecated).toBe(true);
    expect(doc.paths["/v3/confirmations/pending"]?.get?.deprecated).toBe(true);
  });
});
