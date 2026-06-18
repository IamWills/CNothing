import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import config from "../config";
import { UnauthorizedError, ValidationError } from "../utils/errors";
import type { JsonObject, UserSessionRecord } from "./v2.entity";
import {
  consumeLoginToken,
  createLoginToken,
  createUserSession,
  findUserSessionByToken,
  revokeUserSession,
} from "./v2.repository";

export function hashSessionToken(token: string): string {
  return createHmac("sha256", config.masterKey).update(`user-session:${token}`).digest("hex");
}

function hashLoginToken(token: string): string {
  return createHmac("sha256", config.masterKey).update(`login-token:${token}`).digest("hex");
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function generateUserSessionToken(): string {
  return `usr_${randomBytes(32).toString("base64url")}`;
}

export function generateLoginTokenValue(): string {
  return `login_${randomBytes(24).toString("base64url")}`;
}

export function readUserSessionToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization")?.trim();
  if (authorization) {
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
    if (bearer?.startsWith("usr_")) {
      return bearer;
    }
  }

  const headerToken = request.headers.get("X-User-Session")?.trim();
  if (headerToken?.startsWith("usr_")) {
    return headerToken;
  }

  const cookieHeader = request.headers.get("Cookie") ?? "";
  const match = /(?:^|;\s*)cnothing_user_session=([^;]+)/.exec(cookieHeader);
  const cookieToken = match?.[1]?.trim();
  return cookieToken?.startsWith("usr_") ? decodeURIComponent(cookieToken) : null;
}

export async function requireUserSession(request: Request): Promise<UserSessionRecord> {
  const token = readUserSessionToken(request);
  if (!token) {
    throw new UnauthorizedError("User session required", {
      error_code: "missing_user_session",
    });
  }

  const session = await findUserSessionByToken(hashSessionToken(token));
  if (!session) {
    throw new UnauthorizedError("Invalid or expired user session", {
      error_code: "invalid_user_session",
    });
  }

  return session;
}

export async function requireUserSessionForUser(request: Request, userId: string): Promise<UserSessionRecord> {
  const session = await requireUserSession(request);
  if (session.user_id !== userId) {
    throw new UnauthorizedError("User session does not match authorization subject", {
      error_code: "user_session_mismatch",
      expected_user_id: userId,
    });
  }
  return session;
}

export function isAdminRequest(request: Request): boolean {
  const expected = config.bearerToken?.trim();
  if (!expected) {
    return false;
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return false;
  }
  const supplied = authorization.slice("Bearer ".length).trim();
  return Boolean(supplied && safeEquals(supplied, expected));
}

export class UserSessionService {
  async issueLoginToken(input: {
    userId: string;
    createdBy?: string;
    ttlSeconds?: number;
    metadata?: JsonObject;
  }) {
    const token = generateLoginTokenValue();
    const record = await createLoginToken({
      user_id: input.userId,
      token_hash: hashLoginToken(token),
      ttl_seconds: input.ttlSeconds ?? config.userLoginTokenTtlSeconds,
      created_by: input.createdBy ?? null,
      metadata: input.metadata,
    });

    return {
      ok: true as const,
      login_token: token,
      user_id: record.user_id,
      expires_at: record.expires_at,
    };
  }

  async login(input: { userId: string; loginToken: string }) {
    const consumed = await consumeLoginToken({
      user_id: input.userId,
      token_hash: hashLoginToken(input.loginToken),
    });
    if (!consumed) {
      throw new UnauthorizedError("Invalid or expired login token", {
        error_code: "invalid_login_token",
      });
    }

    const sessionToken = generateUserSessionToken();
    const session = await createUserSession({
      user_id: input.userId,
      session_token_hash: hashSessionToken(sessionToken),
      ttl_seconds: config.userSessionTtlSeconds,
      metadata: {
        login_token_id: consumed.id,
      },
    });

    return {
      ok: true as const,
      session_token: sessionToken,
      user_id: session.user_id,
      expires_at: session.expires_at,
    };
  }

  async logout(request: Request) {
    const token = readUserSessionToken(request);
    if (!token) {
      return { ok: true as const, revoked: false };
    }
    const revoked = await revokeUserSession(hashSessionToken(token));
    return { ok: true as const, revoked: Boolean(revoked) };
  }

  async me(request: Request) {
    const session = await requireUserSession(request);
    return {
      ok: true as const,
      user_id: session.user_id,
      expires_at: session.expires_at,
      session_id: session.id,
    };
  }
}

export const userSessionService = new UserSessionService();

export function readRequiredLoginFields(body: Record<string, unknown>): { userId: string; loginToken: string } {
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const loginToken = typeof body.login_token === "string" ? body.login_token.trim() : "";
  if (!userId) {
    throw new ValidationError("user_id is required", { error_code: "missing_field", field: "user_id" });
  }
  if (!loginToken) {
    throw new ValidationError("login_token is required", {
      error_code: "missing_field",
      field: "login_token",
    });
  }
  return { userId, loginToken };
}
