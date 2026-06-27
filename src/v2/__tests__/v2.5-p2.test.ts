import { describe, expect, test } from "bun:test";
import { readCapabilityInvocationType } from "../http-invocation.executor";

describe("mcp invocation config", () => {
  test("reads mcp invocation type from capability", () => {
    expect(
      readCapabilityInvocationType({
        invocation_type: "mcp",
        metadata: {},
      }),
    ).toBe("mcp");
  });
});

describe("security middleware helpers", () => {
  test("redacts bearer tokens in request logs", async () => {
    const { redactLogMessage } = await import("../secret-redaction");
    expect(redactLogMessage("Authorization: Bearer secret.token.value")).toContain("[REDACTED]");
  });
});
