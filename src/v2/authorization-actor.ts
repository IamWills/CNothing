import { UnauthorizedError } from "../utils/errors";
import type { AuthorizationRequestRecord, UserSessionRecord } from "./v2.entity";
import {
  isPendingAuthorizationUserId,
} from "./authorization-user";
import { isAdminRequest, requireUserSession, requireUserSessionForUser } from "./user-session";

export type AuthorizationActor =
  | { kind: "admin" }
  | { kind: "user"; session: UserSessionRecord };

export async function requireAuthorizationActor(
  request: Request,
  userId: string,
): Promise<AuthorizationActor> {
  if (isAdminRequest(request)) {
    return { kind: "admin" };
  }

  try {
    const session = await requireUserSessionForUser(request, userId);
    return { kind: "user", session };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    throw error;
  }
}

export async function requireAuthorizationActorForRequest(
  request: Request,
  authRequest: AuthorizationRequestRecord,
): Promise<AuthorizationActor> {
  if (isPendingAuthorizationUserId(authRequest.user_id)) {
    if (isAdminRequest(request)) {
      return { kind: "admin" };
    }
    const session = await requireUserSession(request);
    return { kind: "user", session };
  }
  return requireAuthorizationActor(request, authRequest.user_id);
}

export async function requireUserScopedAction(
  request: Request,
  userId: string,
): Promise<AuthorizationActor> {
  return requireAuthorizationActor(request, userId);
}
