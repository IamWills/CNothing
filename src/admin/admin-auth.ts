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

export function requireAdminAccess(request: Request): void {
  const expected = config.bearerToken?.trim();
  if (!expected) {
    return;
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing admin bearer token");
  }

  const supplied = authorization.slice("Bearer ".length).trim();
  if (!supplied || !safeEquals(supplied, expected)) {
    throw new UnauthorizedError("Invalid admin bearer token");
  }
}
