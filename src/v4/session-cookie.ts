import config from "../config";

const SESSION_COOKIE_NAME = "cnothing_user_session";

export function buildUserSessionCookie(sessionToken: string): string {
  const maxAge = config.userSessionTtlSeconds;
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (config.publicBaseUrl.startsWith("https://")) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function clearUserSessionCookie(): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (config.publicBaseUrl.startsWith("https://")) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export { SESSION_COOKIE_NAME };
