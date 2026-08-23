const SECRET_FIELD_PATTERNS = [
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /client[_-]?secret/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /^authorization$/i,
  /authorization[_-]?(token|header|credential|code)$/i,
  /bearer/i,
  /password/i,
  /secret/i,
  /credential/i,
  /encrypted/i,
  /^cookie$/i,
  /session[_-]?cookie/i,
  /mfa[_-]?secret/i,
  /recovery[_-]?code/i,
  /ssh[_-]?private[_-]?key/i,
  /browser[_-]?session/i,
];

const NON_SECRET_FIELD_NAMES = new Set([
  "authorization_id",
  "authorization_request_id",
  "confirmation_id",
  "connection_id",
  "grant_id",
  "request_id",
]);

const REDACTED = "[REDACTED]";

export function isSecretFieldName(name: string): boolean {
  if (NON_SECRET_FIELD_NAMES.has(name)) {
    return false;
  }
  return SECRET_FIELD_PATTERNS.some((pattern) => pattern.test(name));
}

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 12) {
    return REDACTED;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    if (/^(agent_|enrs_|Bearer |gho_|ghp_|ghu_|ghs_|ghr_)/i.test(value)) {
      return REDACTED;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, depth + 1));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretFieldName(key)) {
        result[key] = REDACTED;
      } else {
        result[key] = redactSecrets(nested, depth + 1);
      }
    }
    return result;
  }
  return value;
}

export function redactLogMessage(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [REDACTED]")
    .replace(/access_token[=:]\s*["']?[^"'\s&]+/gi, "access_token=[REDACTED]")
    .replace(/refresh_token[=:]\s*["']?[^"'\s&]+/gi, "refresh_token=[REDACTED]")
    .replace(/enrollment_secret[=:]\s*["']?[^"'\s&]+/gi, "enrollment_secret=[REDACTED]")
    .replace(/client_secret[=:]\s*["']?[^"'\s&]+/gi, "client_secret=[REDACTED]");
}

export function sanitizeAgentResponse<T>(value: T): T {
  return redactSecrets(value) as T;
}

export function stripInvocationConfig(config: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...config };
  delete safe.client_secret;
  delete safe.api_key;
  delete safe.access_token;
  delete safe.refresh_token;
  delete safe.private_key;
  delete safe.headers;
  if (safe.auth && typeof safe.auth === "object") {
    safe.auth = { type: (safe.auth as { type?: string }).type ?? "configured" };
  }
  return safe;
}
