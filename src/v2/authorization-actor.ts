import { UnauthorizedError } from "../utils/errors";
import type { UserSessionRecord } from "./v2.entity";
import { isAdminRequest, requireUserSessionForUser } from "./user-session";

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

export async function requireUserScopedAction(
  request: Request,
  userId: string,
): Promise<AuthorizationActor> {
  return requireAuthorizationActor(request, userId);
}
