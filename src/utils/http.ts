import { ValidationError } from "./errors";

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const parsed = (await request.json().catch(() => null)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
