import { createAgent, createUserSession, ensureUser, setUserRole } from "../../v4/platform.repository";
import { createOAuthConnection, createOAuthProvider } from "../../v4/oauth.repository";
import { generateUserSessionToken, hashSessionToken } from "../../v4/user-session";
import type { AgentRecord, UserRecord, UserRole } from "../../v4/platform.entity";
import type { OAuthConnectionRecord, OAuthProviderRecord } from "../../v4/oauth.entity";

let sequence = 0;

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

export async function givenUser(
  overrides: { user_id?: string; role?: UserRole } = {},
): Promise<UserRecord> {
  const user = await ensureUser(overrides.user_id ?? unique("github:user"));
  if (overrides.role && overrides.role !== user.role) {
    return setUserRole({ id: user.id, role: overrides.role });
  }
  return user;
}

export async function givenUserSession(
  overrides: { user_id?: string; role?: UserRole } = {},
): Promise<{ user: UserRecord; token: string }> {
  const user = await givenUser(overrides);
  const token = generateUserSessionToken();
  await createUserSession({
    user_id: user.id,
    session_token_hash: hashSessionToken(token),
    ttl_seconds: 3600,
  });
  return { user, token };
}

export async function givenAgent(
  overrides: { name?: string; owner_user_id?: string } = {},
): Promise<{ agent: AgentRecord; accessToken: string }> {
  const created = await createAgent({
    name: overrides.name ?? unique("test-agent"),
    owner_user_id: overrides.owner_user_id ?? "github:owner",
  });
  return { agent: created.agent, accessToken: created.access_token };
}

export async function givenProvider(
  overrides: {
    slug?: string;
    apiHosts?: string[];
    client_id?: string;
    client_secret?: string;
  } = {},
): Promise<OAuthProviderRecord> {
  const slug = overrides.slug ?? unique("provider");
  return createOAuthProvider({
    slug,
    display_name: slug,
    auth_type: "oauth2",
    authorization_url: `https://${slug}.example.com/authorize`,
    token_url: `https://${slug}.example.com/token`,
    client_id: overrides.client_id ?? "test-client-id",
    client_secret: overrides.client_secret ?? "test-client-secret",
    default_scopes: ["repo"],
    metadata: { api_hosts: overrides.apiHosts ?? ["api.github.com"] },
  });
}

export async function givenConnection(input: {
  providerId: string;
  userId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}): Promise<OAuthConnectionRecord> {
  return createOAuthConnection({
    user_id: input.userId ?? "github:alice",
    provider_id: input.providerId,
    provider_account_id: unique("account"),
    display_name: "Test Account",
    access_token: input.accessToken ?? "gho_test_access_token_value",
    ...(input.refreshToken ? { refresh_token: input.refreshToken } : {}),
    ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
    scopes: ["repo"],
  });
}

/** Minimal upstream stub so proxy tests never make a real network call. */
export function stubUpstreamFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): { calls: Array<{ url: string; init: RequestInit }>; restore: () => void } {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof globalThis.fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export function asPendingAccess<T extends { status?: unknown }>(
  result: T,
): T & { access_request_id: string; approval_url: string; status: "pending" } {
  if (!("access_request_id" in result) || typeof (result as { access_request_id?: unknown }).access_request_id !== "string") {
    throw new Error("expected a pending access request");
  }
  return result as T & { access_request_id: string; approval_url: string; status: "pending" };
}

export function asMandateApproval<T extends { grant?: unknown }>(
  result: T,
): T & { grant: NonNullable<T["grant"]> } {
  if (!("grant" in result) || result.grant == null) {
    throw new Error("expected a mandate to be minted");
  }
  return result as T & { grant: NonNullable<T["grant"]> };
}

export function asExecutedProxy<T extends { status: unknown }>(
  result: T,
): T & { status: number; headers: Record<string, string>; body: unknown; truncated: boolean } {
  if (typeof result.status !== "number" || !("headers" in result)) {
    throw new Error("expected an executed proxy response");
  }
  return result as T & {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    truncated: boolean;
  };
}
