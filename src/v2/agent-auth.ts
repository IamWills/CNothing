import { UnauthorizedError, ValidationError } from "../utils/errors";
import { findAgentByAccessToken } from "./v2.repository";

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization")?.trim();
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}

export async function requireAgentFromRequest(request: Request) {
  const token = readBearerToken(request);
  if (!token) {
    throw new UnauthorizedError("Agent access token required", {
      error_code: "missing_agent_token",
    });
  }

  const agent = await findAgentByAccessToken(token);
  if (!agent) {
    throw new UnauthorizedError("Invalid or inactive agent token", {
      error_code: "invalid_agent_token",
    });
  }

  return agent;
}

export function readRequiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${field} is required`, {
      error_code: "missing_field",
      field,
    });
  }
  return value.trim();
}

export function readOptionalObject(body: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = body[field];
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`, {
      error_code: "invalid_field",
      field,
    });
  }
  return value as Record<string, unknown>;
}
