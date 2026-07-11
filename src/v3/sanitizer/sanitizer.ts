/**
 * Unified Sanitization Layer for Execution Trust Layer.
 * All Worker outputs and Agent-facing responses must pass through this module.
 * Never returns secret plaintext to agents, logs, or API responses.
 */

import {
  redactLogMessage,
  redactSecrets,
  sanitizeAgentResponse,
} from "../../v2/secret-redaction";

const FORBIDDEN_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "authorization",
  "cookie",
  "set-cookie",
  "set_cookie",
  "password",
  "api_key",
  "apiKey",
  "private_key",
  "privateKey",
  "client_secret",
  "clientSecret",
  "mfa_secret",
  "mfaSecret",
  "recovery_code",
  "recoveryCode",
  "ssh_private_key",
  "session_cookie",
  "browser_session",
]);

const FORBIDDEN_HEADER_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
]);

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/-/g, "_");
}

function isForbiddenKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (FORBIDDEN_KEYS.has(normalized)) return true;
  if (FORBIDDEN_HEADER_KEYS.has(key.trim().toLowerCase())) return true;
  return (
    /access[_-]?token/i.test(key) ||
    /refresh[_-]?token/i.test(key) ||
    /client[_-]?secret/i.test(key) ||
    /private[_-]?key/i.test(key) ||
    /mfa[_-]?secret/i.test(key) ||
    /recovery[_-]?code/i.test(key) ||
    /^authorization$/i.test(key) ||
    /^cookie$/i.test(key) ||
    /^set-cookie$/i.test(key) ||
    /api[_-]?key/i.test(key)
  );
}

/**
 * Recursively sanitize headers, body, error, and logs.
 * Removes or redacts all secret-bearing fields.
 */
export function sanitizeDeep(value: unknown, depth = 0): unknown {
  if (depth > 16) return "[REDACTED]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    if (/^(Bearer |gho_|ghp_|ghu_|ghs_|ghr_|sk-|xox[baprs]-)/i.test(value)) {
      return "[REDACTED]";
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDeep(item, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenKey(key)) {
        result[key] = "[REDACTED]";
        continue;
      }
      // Special-case nested headers / body / error / logs
      if (
        key === "headers" ||
        key === "body" ||
        key === "error" ||
        key === "logs" ||
        key === "request" ||
        key === "response"
      ) {
        result[key] = sanitizeDeep(nested, depth + 1);
        continue;
      }
      result[key] = sanitizeDeep(nested, depth + 1);
    }
    return result;
  }

  return value;
}

/** Sanitize Worker execution result before returning to Agent. */
export function sanitizeWorkerResult<T>(result: T): T {
  return sanitizeDeep(sanitizeAgentResponse(result)) as T;
}

/** Sanitize any Agent-facing API response. */
export function sanitizeAgentFacing<T>(value: T): T {
  return sanitizeDeep(sanitizeAgentResponse(value)) as T;
}

/** Sanitize log lines (never emit real tokens). */
export function sanitizeLog(message: string): string {
  return redactLogMessage(
    message
      .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [REDACTED]")
      .replace(/gho_[A-Za-z0-9]+/gi, "[REDACTED]")
      .replace(/ghp_[A-Za-z0-9]+/gi, "[REDACTED]")
      .replace(/cookie[=:]\s*["']?[^"'\s;]+/gi, "cookie=[REDACTED]"),
  );
}

/** Redact DOM / HTML snippets for BrowserWorker. */
export function redactDom(html: string): string {
  return html
    .replace(/type=["']password["'][^>]*>/gi, 'type="password" value="[REDACTED]">')
    .replace(/value=["'][^"']*["']/gi, 'value="[REDACTED]"')
    .replace(/Authorization:\s*[^\n<]+/gi, "Authorization: [REDACTED]")
    .replace(/cookie[=:]\s*[^;\s<]+/gi, "cookie=[REDACTED]");
}

/** Redact screenshot metadata (never attach raw pixels with secrets in alt/text). */
export function redactScreenshotMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return sanitizeDeep({
    ...meta,
    raw_bytes: undefined,
    pixel_data: undefined,
    note: "Screenshot binary retained server-side only; agent receives metadata.",
  }) as Record<string, unknown>;
}

export { redactSecrets, sanitizeAgentResponse };
