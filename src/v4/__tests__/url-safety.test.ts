import { describe, expect, test } from "bun:test";
import { assertSafePublicUrl, validatePublicMetadataUrls } from "../url-safety.service";

function blockedCode(rawUrl: string): string {
  try {
    assertSafePublicUrl(rawUrl);
    return "allowed";
  } catch (error) {
    const details = (error as { details?: { error_code?: string } }).details;
    return details?.error_code ?? "unknown";
  }
}

describe("assertSafePublicUrl", () => {
  test("allows ordinary public https URLs", () => {
    expect(assertSafePublicUrl("https://api.github.com/user").hostname).toBe("api.github.com");
  });

  test("blocks loopback and internal metadata hostnames", () => {
    for (const url of [
      "https://localhost/admin",
      "https://app.localhost/admin",
      "https://127.0.0.1/admin",
      "https://0.0.0.0/admin",
      "https://metadata.google.internal/computeMetadata/v1/",
    ]) {
      expect(blockedCode(url)).toBe("ssrf_blocked");
    }
  });

  test("blocks private, link-local, and carrier-grade NAT ranges", () => {
    for (const url of [
      "https://10.1.2.3/",
      "https://172.16.0.1/",
      "https://172.31.255.255/",
      "https://192.168.1.1/",
      "https://169.254.169.254/latest/meta-data",
      "https://100.64.0.1/",
      "https://[::1]/",
    ]) {
      expect(blockedCode(url)).toBe("ssrf_blocked");
    }
  });

  test("allows public IPv4 that merely looks adjacent to private ranges", () => {
    expect(blockedCode("https://172.32.0.1/")).toBe("allowed");
    expect(blockedCode("https://11.0.0.1/")).toBe("allowed");
  });

  test("rejects non-http protocols and malformed input", () => {
    expect(blockedCode("file:///etc/passwd")).toBe("unsupported_url_protocol");
    expect(blockedCode("gopher://example.com/")).toBe("unsupported_url_protocol");
    expect(blockedCode("not a url")).toBe("invalid_url");
  });
});

describe("validatePublicMetadataUrls", () => {
  test("collects one error per unsafe field and ignores blanks", () => {
    const errors = validatePublicMetadataUrls({
      authorization_url: "https://issuer.example.com/authorize",
      token_url: "https://127.0.0.1/token",
      userinfo_url: undefined,
      jwks_url: "http://169.254.169.254/keys",
    });
    expect(errors).toHaveLength(2);
    expect(errors.join(" ")).toContain("token_url");
    expect(errors.join(" ")).toContain("jwks_url");
  });
});
