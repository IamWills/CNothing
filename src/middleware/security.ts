import { createHash } from "node:crypto";
import config from "../config";
import { redactLogMessage } from "../v2/secret-redaction";

type Bucket = {
  count: number;
  resetAt: number;
};

const rateLimitBuckets = new Map<string, Bucket>();
const replayCache = new Map<string, number>();

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.KEYSERVICE_RATE_LIMIT_PER_MINUTE ?? "120");
const REPLAY_TTL_MS = Number(process.env.KEYSERVICE_REPLAY_TTL_SECONDS ?? "300") * 1000;
const REPLAY_PATH_EXACT = new Set([
  "/v2/agent/invoke",
  "/v2/capabilities/invoke",
  "/v3/agent/invoke",
]);

function isReplayProtectedPath(pathname: string): boolean {
  if (REPLAY_PATH_EXACT.has(pathname)) return true;
  return (
    /^\/api\/v3\/capabilities\/[^/]+\/invoke$/.test(pathname) ||
    /^\/v3\/capabilities\/[^/]+\/invoke$/.test(pathname)
  );
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwarded || realIp || "unknown";
}

function pruneExpiredEntries(now: number): void {
  if (rateLimitBuckets.size > 10_000) {
    for (const [key, bucket] of rateLimitBuckets) {
      if (bucket.resetAt <= now) {
        rateLimitBuckets.delete(key);
      }
    }
  }
  if (replayCache.size > 10_000) {
    for (const [key, expiresAt] of replayCache) {
      if (expiresAt <= now) {
        replayCache.delete(key);
      }
    }
  }
}

function checkRateLimit(request: Request, pathname: string): Response | null {
  if (!pathname.startsWith("/v2/") && !pathname.startsWith("/v4/")) {
    return null;
  }

  const now = Date.now();
  pruneExpiredEntries(now);

  const key = `${clientKey(request)}:${pathname.split("/").slice(0, 4).join("/")}`;
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    return Response.json(
      {
        error: {
          type: "TooManyRequests",
          message: "Rate limit exceeded. Try again later.",
          error_code: "rate_limit_exceeded",
        },
      },
      {
        status: 429,
        headers: {
          "retry-after": String(Math.ceil((bucket.resetAt - now) / 1000)),
        },
      },
    );
  }

  return null;
}

async function checkReplayProtection(request: Request, pathname: string): Promise<Response | null> {
  if (request.method !== "POST" || !isReplayProtectedPath(pathname)) {
    return null;
  }

  let requestId = request.headers.get("x-cnothing-request-id")?.trim() ?? "";
  if (!requestId) {
    try {
      const cloned = request.clone();
      const body = (await cloned.json()) as { request_id?: string };
      requestId = body.request_id?.trim() ?? "";
    } catch {
      return null;
    }
  }

  if (!requestId) {
    return null;
  }

  const agentAuth = request.headers.get("authorization")?.trim() ?? "";
  const dedupeKey = createHash("sha256")
    .update(`${pathname}:${agentAuth}:${requestId}`)
    .digest("hex");

  const now = Date.now();
  const expiresAt = replayCache.get(dedupeKey);
  if (expiresAt && expiresAt > now) {
    return Response.json(
      {
        error: {
          type: "ConflictError",
          message: "Duplicate request_id detected",
          error_code: "replay_detected",
        },
      },
      { status: 409 },
    );
  }

  replayCache.set(dedupeKey, now + REPLAY_TTL_MS);
  return null;
}

export function logRequest(input: {
  method: string;
  pathname: string;
  status: number;
  durationMs: number;
  requestId?: string | null;
}): void {
  const message = redactLogMessage(
    `${input.method} ${input.pathname} ${input.status} ${input.durationMs}ms request_id=${input.requestId ?? "-"}`,
  );
  // eslint-disable-next-line no-console
  console.log(`[${config.serviceName}] ${message}`);
}

export async function applySecurityMiddleware(
  request: Request,
  pathname: string,
  next: () => Promise<Response>,
): Promise<Response> {
  const rateLimited = checkRateLimit(request, pathname);
  if (rateLimited) {
    return rateLimited;
  }

  const replayBlocked = await checkReplayProtection(request, pathname);
  if (replayBlocked) {
    return replayBlocked;
  }

  const started = Date.now();
  const response = await next();
  logRequest({
    method: request.method,
    pathname,
    status: response.status,
    durationMs: Date.now() - started,
    requestId: request.headers.get("x-cnothing-request-id"),
  });
  return response;
}
