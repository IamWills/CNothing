import { describe, expect, test } from "bun:test";
import {
  isSecretFieldName,
  redactLogMessage,
  redactSecrets,
  sanitizeAgentResponse,
} from "../secret-redaction";

describe("isSecretFieldName", () => {
  test("flags credential-bearing field names", () => {
    for (const name of [
      "access_token",
      "refreshToken",
      "client_secret",
      "api_key",
      "authorization",
      "cookie",
      "password",
      "encrypted_access_token",
    ]) {
      expect(isSecretFieldName(name)).toBe(true);
    }
  });

  test("keeps identifiers that merely mention authorization", () => {
    for (const name of ["grant_id", "connection_id", "request_id", "authorization_request_id"]) {
      expect(isSecretFieldName(name)).toBe(false);
    }
  });
});

describe("redactSecrets", () => {
  test("redacts nested credential fields while preserving structure", () => {
    expect(
      redactSecrets({
        id: "grant-1",
        connection: { access_token: "gho_secret", scopes: ["repo"] },
        items: [{ client_secret: "shh" }],
      }),
    ).toEqual({
      id: "grant-1",
      connection: { access_token: "[REDACTED]", scopes: ["repo"] },
      items: [{ client_secret: "[REDACTED]" }],
    });
  });

  test("redacts token-shaped values even under a harmless key", () => {
    expect(redactSecrets({ note: "gho_abc123", other: "plain text" })).toEqual({
      note: "[REDACTED]",
      other: "plain text",
    });
  });

  test("stops runaway recursion", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 20; i += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    expect(() => sanitizeAgentResponse(deep)).not.toThrow();
  });
});

describe("redactLogMessage", () => {
  test("masks bearer tokens and OAuth parameters", () => {
    const message = redactLogMessage(
      "POST /token Authorization: Bearer gho_abc.def-123 access_token=xyz client_secret=shh",
    );
    expect(message).not.toContain("gho_abc.def-123");
    expect(message).not.toContain("xyz");
    expect(message).not.toContain("shh");
    expect(message).toContain("[REDACTED]");
  });
});
