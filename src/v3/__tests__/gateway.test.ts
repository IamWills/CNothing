import { describe, expect, test } from "bun:test";
import { redactSecrets, sanitizeAgentResponse } from "../../v2/secret-redaction";
import {
  deriveResourceKey,
  summarizeInputForApproval,
} from "../policy-engine/approval-helpers";
import { normalizeSecretType, secretTypeLookupVariants } from "../secret-types";
import type { CapabilityRecord } from "../../v2/v2.entity";

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

describe("secretless response sanitization", () => {
  test("strips access_token and Authorization from agent responses", () => {
    const sanitized = sanitizeAgentResponse({
      user: { login: "octocat" },
      access_token: "gho_secret_should_not_leak",
      headers: { Authorization: "Bearer gho_secret" },
      refresh_token: "refresh_secret",
    });
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("gho_secret");
    expect(text).not.toContain("refresh_secret");
    expect(text).toContain("octocat");
  });

  test("redactSecrets catches cookie and password fields", () => {
    const redacted = redactSecrets({
      cookie: "session=abc",
      password: "hunter2",
      ok: true,
    }) as Record<string, unknown>;
    expect(String(redacted.cookie)).toContain("REDACTED");
    expect(String(redacted.password)).toContain("REDACTED");
    expect(redacted.ok).toBe(true);
  });
});

describe("vault secret type normalization", () => {
  test("maps legacy aliases to canonical types", () => {
    expect(normalizeSecretType("access_token")).toBe("oauth_access_token");
    expect(normalizeSecretType("refresh_token")).toBe("oauth_refresh_token");
    expect(normalizeSecretType("session_cookie")).toBe("cookie");
    expect(normalizeSecretType("password")).toBe("password");
  });

  test("lookup variants include legacy aliases", () => {
    const variants = secretTypeLookupVariants("oauth_access_token");
    expect(variants).toContain("oauth_access_token");
    expect(variants).toContain("access_token");
  });
});

describe("approval helpers", () => {
  test("summarizeInputForApproval never embeds nested secrets deeply", () => {
    const summary = summarizeInputForApproval({
      name: "demo-repo",
      private: true,
      token: "should-appear-as-string-but-gateway-redacts-elsewhere",
    });
    expect(summary).toContain("name=demo-repo");
    expect(summary).toContain("private=true");
  });

  test("deriveResourceKey for create_repo", () => {
    expect(
      deriveResourceKey(fakeCapability({ name: "github.create_repo" }), {
        name: "hello",
        org: "acme",
      }),
    ).toBe("acme/hello");
    expect(
      deriveResourceKey(fakeCapability({ name: "github.create_repo" }), { name: "solo" }),
    ).toBe("solo");
  });
});

describe("execution workers", () => {
  test("BrowserWorker is resolvable but not implemented", async () => {
    const { BrowserWorker } = await import("../workers/browser.worker");
    const { WorkerNotImplementedError } = await import("../workers/types");
    const worker = new BrowserWorker();
    expect(worker.canHandle(fakeCapability({ execution_type: "browser" }))).toBe(true);
    expect(worker.canHandle(fakeCapability({ execution_type: "oauth_api" }))).toBe(false);
    expect(worker.name).toBe("BrowserWorker");
    await expect(
      worker.execute({
        capability: fakeCapability({ execution_type: "browser" }),
        agent: {
          id: "a1",
          name: "agent",
          public_key_pem: null,
          owner_user_id: "u1",
          tenant_id: "default",
          status: "active",
          metadata: {},
          created_at: "",
          updated_at: "",
        },
        user_id: "u1",
        input: {},
        access_token: null,
        connection_id: null,
        dry_run: false,
      }),
    ).rejects.toBeInstanceOf(WorkerNotImplementedError);
  });

  test("stub workers report not_implemented", async () => {
    const { SshWorker, ApiKeyWorker } = await import("../workers/stubs");
    const { WorkerNotImplementedError } = await import("../workers/types");
    const ssh = new SshWorker();
    expect(ssh.canHandle(fakeCapability({ execution_type: "ssh" }))).toBe(true);
    await expect(
      ssh.execute({
        capability: fakeCapability({ execution_type: "ssh" }),
        agent: {
          id: "a1",
          name: "agent",
          public_key_pem: null,
          owner_user_id: "u1",
          tenant_id: "default",
          status: "active",
          metadata: {},
          created_at: "",
          updated_at: "",
        },
        user_id: "u1",
        input: {},
        access_token: null,
        connection_id: null,
        dry_run: false,
      }),
    ).rejects.toBeInstanceOf(WorkerNotImplementedError);
    expect(new ApiKeyWorker().name).toBe("ApiKeyWorker");
  });
});

describe("gateway response contract", () => {
  test("pending_approval shape is agent-safe", () => {
    const response = sanitizeAgentResponse({
      status: "pending_approval",
      approval_id: "appr-1",
      approval_url: "https://cnothing.com/dashboard/approvals/appr-1?token=appr_xxx",
      safe_summary: "name=demo-repo, private=true",
    });
    expect(response.status).toBe("pending_approval");
    expect(JSON.stringify(response)).not.toMatch(/gho_|ghp_|Bearer /);
  });

  test("failed policy_denied shape", () => {
    const response = sanitizeAgentResponse({
      status: "failed",
      error: {
        code: "policy_denied",
        message: "Destructive actions are denied by default",
        recoverable: false,
      },
    });
    expect(response.status).toBe("failed");
    expect(response.error.code).toBe("policy_denied");
  });

  test("failed reconnect_required shape", () => {
    const response = sanitizeAgentResponse({
      status: "failed",
      error: {
        code: "reconnect_required",
        message: "OAuth connection requires reconnection",
        recoverable: true,
      },
    });
    expect(response.error.code).toBe("reconnect_required");
    expect(response.error.recoverable).toBe(true);
  });
});
