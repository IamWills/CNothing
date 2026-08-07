import { ValidationError } from "./errors";
import config from "../config";

function allowedBrowserOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const value of [config.consoleUrl, config.publicBaseUrl]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Configuration validation reports invalid public URLs at startup.
    }
  }
  return origins;
}

export function isAllowedBrowserOrigin(origin: string): boolean {
  return allowedBrowserOrigins().has(origin);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-CNothing-Request-Id",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };

  if (origin && isAllowedBrowserOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers.Vary = "Origin";
  } else if (origin) {
    headers.Vary = "Origin";
  }

  return headers;
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const parsed = (await request.json().catch(() => null)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
