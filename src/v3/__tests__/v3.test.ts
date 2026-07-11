import { describe, expect, test } from "bun:test";
import {
  assertSafePublicUrl,
  validatePublicMetadataUrls,
} from "../url-safety.service";

describe("v3 URL safety", () => {
  test("allows public https URLs", () => {
    const parsed = assertSafePublicUrl("https://github.com/login/oauth/authorize", "authorization_url");
    expect(parsed.hostname).toBe("github.com");
  });

  test("blocks localhost SSRF", () => {
    expect(() => assertSafePublicUrl("http://127.0.0.1/admin", "discovery_url")).toThrow();
    expect(() => assertSafePublicUrl("http://localhost/.well-known/openid-configuration", "discovery_url")).toThrow();
  });

  test("blocks private IPv4", () => {
    expect(() => assertSafePublicUrl("https://192.168.1.1/token", "token_url")).toThrow();
    expect(() => assertSafePublicUrl("https://10.0.0.1/token", "token_url")).toThrow();
  });

  test("blocks metadata endpoints", () => {
    expect(() =>
      assertSafePublicUrl("http://metadata.google.internal/computeMetadata/v1/", "discovery_url"),
    ).toThrow();
  });

  test("collects validation errors for multiple URLs", () => {
    const errors = validatePublicMetadataUrls({
      authorization_url: "https://oauth.example.com/authorize",
      token_url: "http://127.0.0.1/token",
    });
    expect(errors.length).toBe(1);
  });
});

describe("v3 platform constants", () => {
  test("defines trust broker modules including gateway extensions", async () => {
    const { V3_MODULES, V3_PRINCIPLES, V3_VERSION, V3_PRODUCT } = await import("../v3.entity");
    expect(V3_VERSION).toBe("3.0.0");
    expect(V3_PRODUCT).toBe("Execution Trust Layer for AI Agents");
    expect(V3_MODULES.length).toBeGreaterThanOrEqual(8);
    expect(V3_PRINCIPLES).toContain("Agent Never Owns Secrets.");
    expect(V3_PRINCIPLES).toContain("Agent thinks.");
    expect(V3_MODULES).toContain("secret_vault");
    expect(V3_MODULES).toContain("approval_engine");
    expect(V3_MODULES).toContain("execution_workers");
  });
});
