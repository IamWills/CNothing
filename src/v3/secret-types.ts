import type { SecretType } from "../v3.entity";

/** Normalize legacy aliases to canonical secret types. */
export function normalizeSecretType(type: SecretType | string): SecretType {
  switch (type) {
    case "access_token":
      return "oauth_access_token";
    case "refresh_token":
      return "oauth_refresh_token";
    case "session_cookie":
      return "cookie";
    case "private_key":
      return "ssh_private_key";
    default:
      return type as SecretType;
  }
}

/** Types accepted when looking up (includes legacy aliases). */
export function secretTypeLookupVariants(type: SecretType | string): SecretType[] {
  const canonical = normalizeSecretType(type);
  const variants = new Set<SecretType>([canonical, type as SecretType]);
  if (canonical === "oauth_access_token") variants.add("access_token");
  if (canonical === "oauth_refresh_token") variants.add("refresh_token");
  if (canonical === "cookie") variants.add("session_cookie");
  if (canonical === "ssh_private_key") variants.add("private_key");
  return [...variants];
}
