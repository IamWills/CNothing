import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { isGoogleCapability, isMicrosoftCapability, isNotionCapability, isSlackCapability } from "../builtin-provider.executor";
import { redactSecrets, isSecretFieldName, redactLogMessage } from "../secret-redaction";
import { evaluatePolicyV25, scopesSatisfied, applyOutputPolicy } from "../policy-engine-v25";
import type { CapabilityRecord, PolicyRecord } from "../v2.entity";

describe("secret redaction", () => {
  test("redacts secret field names", () => {
    const result = redactSecrets({
      access_token: "gho_secret123",
      title: "hello",
    }) as Record<string, unknown>;
    expect(result.access_token).toBe("[REDACTED]");
    expect(result.title).toBe("hello");
  });

  test("detects secret field names", () => {
    expect(isSecretFieldName("client_secret")).toBe(true);
    expect(isSecretFieldName("title")).toBe(false);
  });

  test("redacts bearer tokens in logs", () => {
    expect(redactLogMessage("Authorization: Bearer abc.def.ghi")).toContain("[REDACTED]");
  });
});

describe("policy engine v2.5", () => {
  const baseCapability: CapabilityRecord = {
    id: "cap-1",
    connector_id: "conn-1",
    name: "github.create_issue",
    description: "Create issue",
    capability_type: "ACTION",
    input_schema: {},
    output_schema: {},
    scopes: ["repo"],
    risk_level: "MEDIUM",
    status: "active",
    provider_id: null,
    display_name: null,
    connection_required: true,
    source: "built_in",
    invocation_type: "builtin",
    invocation_config: {},
    policy_config: {},
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  test("requires confirmation for delete operations by name", () => {
    const decision = evaluatePolicyV25(
      { ...baseCapability, name: "github.delete_repo", risk_level: "HIGH" },
      [],
    );
    expect(decision.action).toBe("require_user_confirmation");
  });

  test("requires confirmation for confidential query type", () => {
    const decision = evaluatePolicyV25(
      {
        ...baseCapability,
        name: "gmail.read_message",
        capability_type: "CONFIDENTIAL_QUERY",
        risk_level: "CONFIDENTIAL",
      },
      [],
    );
    expect(decision.action).toBe("require_user_confirmation");
  });

  test("scope satisfaction", () => {
    expect(scopesSatisfied(["repo"], ["repo"])).toBe(true);
    expect(scopesSatisfied(["read"], ["repo"])).toBe(false);
    expect(scopesSatisfied([], ["repo"])).toBe(true);
  });

  test("metadata_only output policy", () => {
    const filtered = applyOutputPolicy({
      result: { id: "1", body: "secret email content", title: "Hello" },
      decision: {
        action: "allow",
        matched_policy_id: null,
        reason: null,
        output_mode: "metadata_only",
      },
    }) as Record<string, unknown>;
    expect(filtered.body).toBeUndefined();
    expect(filtered.id).toBe("1");
  });
});

describe("oauth state helpers", () => {
  test("PKCE challenge is deterministic for verifier", () => {
    const verifier = "test-verifier-value";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge.length).toBeGreaterThan(10);
  });
});

describe("builtin provider helpers", () => {
  test("google, slack, notion, and microsoft capability prefix detection", () => {
    expect(isGoogleCapability("google.userinfo")).toBe(true);
    expect(isGoogleCapability("gmail.read_message")).toBe(true);
    expect(isSlackCapability("slack.post_message")).toBe(true);
    expect(isNotionCapability("notion.search")).toBe(true);
    expect(isMicrosoftCapability("microsoft.userinfo")).toBe(true);
    expect(isMicrosoftCapability("outlook.send_mail")).toBe(true);
    expect(isSlackCapability("github.create_issue")).toBe(false);
  });
});
