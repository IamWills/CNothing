import { timingSafeEqual } from "node:crypto";
import config from "../config";
import { UnauthorizedError } from "../utils/errors";

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Service credential (KEYSERVICE_BEARER_TOKEN / CN_SERVICE_TOKEN).
 * For bootstrap, recovery, and trusted automation — not Human Console login.
 */
export function requireServiceCredential(request: Request): void {
  const expected = config.bearerToken;

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing service bearer token", {
      error_code: "missing_service_credential",
    });
  }

  const supplied = authorization.slice("Bearer ".length).trim();
  if (!supplied || !safeEquals(supplied, expected)) {
    throw new UnauthorizedError("Invalid service bearer token", {
      error_code: "invalid_service_credential",
    });
  }
}

export function isServiceCredentialRequest(request: Request): boolean {
  const expected = config.bearerToken;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return false;
  }
  const supplied = authorization.slice("Bearer ".length).trim();
  return Boolean(supplied && safeEquals(supplied, expected));
}
