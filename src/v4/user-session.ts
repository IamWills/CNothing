import { createHmac, randomBytes } from "node:crypto";
import config from "../config";
import { ForbiddenError, UnauthorizedError } from "../utils/errors";
import type { UserRecord, UserSessionRecord } from "./platform.entity";
import { ensureUser, findUserById, findUserSessionByToken, revokeUserSession } from "./platform.repository";

export function hashSessionToken(token: string): string {
  return createHmac("sha256", config.masterKey).update(`user-session:${token}`).digest("hex");
}

export function generateUserSessionToken(): string {
  return `usr_${randomBytes(32).toString("base64url")}`;
}

export function readUserSessionToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization")?.trim();
  if (authorization) {
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
    if (bearer?.startsWith("usr_")) {
      return bearer;
    }
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

export async function requireUser(
  request: Request,
): Promise<{ session: UserSessionRecord; user: UserRecord }> {
  const session = await requireUserSession(request);
  const user = (await findUserById(session.user_id)) ?? (await ensureUser(session.user_id));
  return { session, user };
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

/** Human session plus server-side admin role. Role is always re-read from cap_users. */
export async function requireAdmin(
  request: Request,
): Promise<{ session: UserSessionRecord; user: UserRecord }> {
  const authenticated = await requireUser(request);
  if (authenticated.user.role !== "admin") {
    throw new ForbiddenError("Admin role required", {
      error_code: "admin_required",
    });
  }
  return authenticated;
}

export class UserSessionService {
  async logout(request: Request) {
    const token = readUserSessionToken(request);
    if (!token) {
      return { ok: true as const, revoked: false };
    }
    const revoked = await revokeUserSession(hashSessionToken(token));
    return { ok: true as const, revoked: Boolean(revoked) };
  }

  async me(request: Request) {
    const { session, user } = await requireUser(request);
    return {
      ok: true as const,
      user_id: session.user_id,
      role: user.role,
      expires_at: session.expires_at,
      session_id: session.id,
    };
  }
}

export const userSessionService = new UserSessionService();
