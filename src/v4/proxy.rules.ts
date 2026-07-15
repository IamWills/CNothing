/** Pure request/response rules for the v4 credential-injecting proxy. */

export const DEFAULT_ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

/** Headers the agent may never set: the platform owns credentials and transport. */
const BLOCKED_REQUEST_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "expect",
  "te",
  "trailer",
  "keep-alive",
]);

const BLOCKED_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "www-authenticate",
  "proxy-authenticate",
  "transfer-encoding",
  "connection",
  "content-encoding",
  "content-length",
]);

export function isBlockedResponseHeader(name: string): boolean {
  return BLOCKED_RESPONSE_HEADERS.has(name.toLowerCase());
}

export function matchAllowedHost(host: string, allowedHosts: string[]): boolean {
  const normalized = host.toLowerCase();
  return allowedHosts.some((entry) => {
    const allowed = entry.trim().toLowerCase();
    if (!allowed) return false;
    if (allowed.startsWith("*.")) {
      const suffix = allowed.slice(1); // ".example.com"
      return normalized.endsWith(suffix) && normalized.length > suffix.length;
    }
    return normalized === allowed;
  });
}

export function sanitizeAgentHeaders(headers: Record<string, unknown>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = key.trim().toLowerCase();
    if (
      !name ||
      BLOCKED_REQUEST_HEADERS.has(name) ||
      name.startsWith("proxy-") ||
      name.startsWith("x-forwarded-")
    ) {
      continue;
    }
    if (typeof value === "string") {
      safe[name] = value;
    }
  }
  return safe;
}

export function redactTokenOccurrences(text: string, secrets: string[]): string {
  let output = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) {
      output = output.split(secret).join("[REDACTED]");
    }
  }
  return output;
}

export function normalizeHosts(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const hosts = values
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean)
    .map((value) => value.replace(/^https?:\/\//, "").split("/")[0]!)
    // URL.hostname never includes a port, so allowlist entries must not either
    .map((value) => (value.startsWith("[") ? value : value.split(":")[0]!))
    .filter(Boolean);
  return [...new Set(hosts)];
}
