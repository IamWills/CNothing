/** Sentinel stored on authorization requests until the user signs in and approves. */
export const PENDING_AUTHORIZATION_USER_ID = "__pending__";

export function isPendingAuthorizationUserId(userId: string | null | undefined): boolean {
  return userId === PENDING_AUTHORIZATION_USER_ID;
}

export function resolveAuthorizationUserId(input?: string | null): string {
  const trimmed = input?.trim();
  if (!trimmed || isPendingAuthorizationUserId(trimmed)) {
    return PENDING_AUTHORIZATION_USER_ID;
  }
  return trimmed;
}
