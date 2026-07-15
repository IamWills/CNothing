import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ALLOWED_METHODS,
  isBlockedResponseHeader,
  matchAllowedHost,
  normalizeHosts,
  redactTokenOccurrences,
  sanitizeAgentHeaders,
} from "../proxy.rules";

describe("matchAllowedHost", () => {
  test("matches exact host case-insensitively", () => {
    expect(matchAllowedHost("API.GitHub.com", ["api.github.com"])).toBe(true);
    expect(matchAllowedHost("api.github.com", ["github.com"])).toBe(false);
  });

  test("matches wildcard subdomains but not the bare domain", () => {
    expect(matchAllowedHost("sheets.googleapis.com", ["*.googleapis.com"])).toBe(true);
    expect(matchAllowedHost("googleapis.com", ["*.googleapis.com"])).toBe(false);
  });

  test("rejects suffix-forgery hosts", () => {
    expect(matchAllowedHost("evil-api.github.com.attacker.io", ["api.github.com"])).toBe(false);
    expect(matchAllowedHost("notgoogleapis.com", ["*.googleapis.com"])).toBe(false);
  });

  test("empty allowlist rejects everything", () => {
    expect(matchAllowedHost("api.github.com", [])).toBe(false);
  });
});

describe("sanitizeAgentHeaders", () => {
  test("strips credential and transport headers", () => {
    const result = sanitizeAgentHeaders({
      Authorization: "Bearer stolen",
      Cookie: "session=1",
      Host: "evil.com",
      "Content-Length": "999",
      "X-Forwarded-For": "1.2.3.4",
      "Proxy-Authorization": "Basic x",
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    });
    expect(result).toEqual({
      "content-type": "application/json",
      accept: "application/vnd.github+json",
    });
  });

  test("drops non-string values", () => {
    expect(sanitizeAgentHeaders({ "x-count": 5, "x-ok": "yes" })).toEqual({ "x-ok": "yes" });
  });
});

describe("redactTokenOccurrences", () => {
  test("replaces every token occurrence", () => {
    const text = "token=gho_abcdefgh1234 and again gho_abcdefgh1234";
    expect(redactTokenOccurrences(text, ["gho_abcdefgh1234"])).toBe(
      "token=[REDACTED] and again [REDACTED]",
    );
  });

  test("ignores short secrets to avoid corrupting the body", () => {
    expect(redactTokenOccurrences("value=abc", ["abc"])).toBe("value=abc");
  });
});

describe("normalizeHosts", () => {
  test("normalizes urls, casing, and duplicates", () => {
    expect(
      normalizeHosts(["https://API.GitHub.com/v3", "api.github.com", " *.googleapis.com "]),
    ).toEqual(["api.github.com", "*.googleapis.com"]);
  });

  test("returns empty array for non-arrays", () => {
    expect(normalizeHosts("api.github.com")).toEqual([]);
    expect(normalizeHosts(undefined)).toEqual([]);
  });
});

describe("response header policy", () => {
  test("blocks cookie and auth negotiation headers", () => {
    expect(isBlockedResponseHeader("Set-Cookie")).toBe(true);
    expect(isBlockedResponseHeader("WWW-Authenticate")).toBe(true);
    expect(isBlockedResponseHeader("x-ratelimit-remaining")).toBe(false);
  });
});

describe("defaults", () => {
  test("default methods cover standard REST verbs without CONNECT/TRACE", () => {
    expect(DEFAULT_ALLOWED_METHODS).toContain("GET");
    expect(DEFAULT_ALLOWED_METHODS).toContain("DELETE");
    expect(DEFAULT_ALLOWED_METHODS).not.toContain("CONNECT");
    expect(DEFAULT_ALLOWED_METHODS).not.toContain("TRACE");
  });
});
