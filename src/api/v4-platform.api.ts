import { requireAdminAccess } from "../admin/admin-auth";
import { NotFoundError, ValidationError } from "../utils/errors";
import { parseJsonBody } from "../utils/http";
import { readOptionalObject, readRequiredString, requireAgentFromRequest } from "../v2/agent-auth";
import { listAuthProviders } from "../v2/auth-providers.service";
import { githubOAuthService } from "../v2/github-oauth.service";
import { oidcService } from "../v2/oidc.service";
import { oauthConnectionService, oauthProviderService } from "../v2/oauth-connection.service";
import { createOAuthConnection, createOAuthProvider, findOAuthProviderBySlug } from "../v2/oauth.repository";
import { sanitizeAgentResponse } from "../v2/secret-redaction";
import { buildUserSessionCookie, clearUserSessionCookie } from "../v2/session-cookie";
import {
  readRequiredLoginFields,
  requireUserSession,
  userSessionService,
} from "../v2/user-session";
import { deviceFlowService } from "../v3/device-flow.service";
import { providerProposalService } from "../v3/provider-proposal.service";
import { normalizeTenantId } from "../v3/tenant-context.service";
import type { ProviderProposalInput } from "../v3/v3.entity";
import config from "../config";

function inferBaseUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("Host") || requestUrl.host;
  const proto = forwardedProto || requestUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

function readProposalInput(body: Record<string, unknown>): ProviderProposalInput {
  return {
    provider_name: readRequiredString(body, "provider_name"),
    issuer_url: typeof body.issuer_url === "string" ? body.issuer_url : undefined,
    discovery_url: typeof body.discovery_url === "string" ? body.discovery_url : undefined,
    authorization_url: typeof body.authorization_url === "string" ? body.authorization_url : undefined,
    token_url: typeof body.token_url === "string" ? body.token_url : undefined,
    jwks_url: typeof body.jwks_url === "string" ? body.jwks_url : undefined,
    userinfo_url: typeof body.userinfo_url === "string" ? body.userinfo_url : undefined,
    registration_endpoint:
      typeof body.registration_endpoint === "string" ? body.registration_endpoint : undefined,
    scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    api_base_url: typeof body.api_base_url === "string" ? body.api_base_url : undefined,
    slug: typeof body.slug === "string" ? body.slug : undefined,
  };
}

/**
 * OAuth callback URLs are external contracts: they are registered inside
 * third-party OAuth apps and identity providers. The legacy /v2 and /v3
 * callback paths therefore stay mounted forever (as stable webhook URLs),
 * even though the /v2 and /v3 APIs themselves are decommissioned.
 */
export async function handleOAuthCallbackRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const apiBaseUrl = inferBaseUrl(request);

  // Connection callbacks: /{v2|v2.6|v3|v4}/oauth/callback/{slug}
  const connectionMatch = path.match(/^\/(v2|v2\.6|v3|v4)\/oauth\/callback\/([^/]+)$/);
  if (request.method === "GET" && connectionMatch) {
    const apiVersion = connectionMatch[1] as "v2" | "v2.6" | "v3" | "v4";
    const providerSlug = decodeURIComponent(connectionMatch[2]!);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      throw new ValidationError("Missing OAuth callback parameters");
    }
    const result = await oauthConnectionService.handleCallback({
      providerSlug,
      code,
      state,
      apiBaseUrl,
      oauthApiVersion: apiVersion,
    });
    if (result.session_cookie) {
      return new Response(null, {
        status: 302,
        headers: { Location: result.redirect_url, "Set-Cookie": result.session_cookie },
      });
    }
    return Response.redirect(result.redirect_url, 302);
  }

  // Console login callbacks: /{v2|v4}/auth/github/callback
  const githubLoginMatch = path.match(/^\/(v2|v4)\/auth\/github\/callback$/);
  if (request.method === "GET" && githubLoginMatch) {
    const code = url.searchParams.get("code")?.trim();
    const state = url.searchParams.get("state")?.trim();
    if (!code || !state) {
      throw new ValidationError("code and state are required", { error_code: "missing_field" });
    }
    const result = await githubOAuthService.handleCallback({ code, state, apiBaseUrl });
    return new Response(null, {
      status: 302,
      headers: { Location: result.redirect_url, "Set-Cookie": result.session_cookie },
    });
  }

  // Console login callbacks: /{v2|v4}/auth/oidc/{name}/callback
  const oidcLoginMatch = path.match(/^\/(v2|v4)\/auth\/oidc\/([^/]+)\/callback$/);
  if (request.method === "GET" && oidcLoginMatch) {
    const providerName = decodeURIComponent(oidcLoginMatch[2]!);
    const code = url.searchParams.get("code")?.trim();
    const state = url.searchParams.get("state")?.trim();
    if (!code || !state) {
      throw new ValidationError("code and state are required", { error_code: "missing_field" });
    }
    const result = await oidcService.handleCallback({ providerName, code, state, apiBaseUrl });
    return new Response(null, {
      status: 302,
      headers: { Location: result.redirect_url, "Set-Cookie": result.session_cookie },
    });
  }

  return null;
}

export async function handleV4PlatformRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);
  const apiBaseUrl = inferBaseUrl(request);

  // --- User sessions ---

  if (request.method === "POST" && path === "/v4/auth/login") {
    const body = await parseJsonBody(request);
    const { userId, loginToken } = readRequiredLoginFields(body);
    const result = await userSessionService.login({ userId, loginToken });
    return Response.json(result, {
      headers: { "Set-Cookie": buildUserSessionCookie(result.session_token) },
    });
  }

  if (request.method === "POST" && path === "/v4/auth/logout") {
    const result = await userSessionService.logout(request);
    return Response.json(result, {
      headers: { "Set-Cookie": clearUserSessionCookie() },
    });
  }

  if (request.method === "GET" && path === "/v4/auth/me") {
    return Response.json(await userSessionService.me(request));
  }

  if (request.method === "POST" && path === "/v4/auth/login-tokens") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const result = await userSessionService.issueLoginToken({
      userId: readRequiredString(body, "user_id"),
      createdBy: "admin",
      ttlSeconds:
        typeof body.ttl_seconds === "number" ? Math.trunc(body.ttl_seconds) : undefined,
    });
    return Response.json(result, { status: 201 });
  }

  // --- Console login providers (GitHub / OIDC) ---

  if (request.method === "GET" && path === "/v4/auth/providers") {
    return Response.json(await listAuthProviders(apiBaseUrl));
  }

  if (request.method === "GET" && path === "/v4/auth/oidc/providers") {
    return Response.json(await oidcService.listPublicProviders());
  }

  if (request.method === "GET" && path === "/v4/auth/github/start") {
    const redirectAfter = url.searchParams.get("redirect_after")?.trim() || undefined;
    const result = await githubOAuthService.startAuthorization({
      apiBaseUrl,
      ...(redirectAfter ? { redirectAfter } : {}),
    });
    return Response.redirect(result.authorization_url, 302);
  }

  if (
    request.method === "GET" &&
    path.startsWith("/v4/auth/oidc/") &&
    path.endsWith("/start")
  ) {
    const providerName = decodeURIComponent(segments[3] ?? "");
    const redirectAfter = url.searchParams.get("redirect_after")?.trim() || undefined;
    const result = await oidcService.startAuthorization({
      providerName,
      apiBaseUrl,
      redirectAfter,
    });
    return Response.redirect(result.authorization_url, 302);
  }

  if (
    request.method === "GET" &&
    path.startsWith("/v4/auth/oauth/") &&
    path.endsWith("/start")
  ) {
    const providerSlug = decodeURIComponent(segments[3] ?? "");
    const redirectAfter = url.searchParams.get("redirect_after")?.trim() || undefined;
    const result = await oauthConnectionService.startLogin({
      providerSlug,
      apiBaseUrl,
      redirectAfter,
    });
    return Response.redirect(result.authorization_url, 302);
  }

  if (request.method === "POST" && path === "/v4/admin/oidc/providers") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    return Response.json(
      await oidcService.registerProvider({
        name: readRequiredString(body, "name"),
        display_name: readRequiredString(body, "display_name"),
        issuer: readRequiredString(body, "issuer"),
        client_id: readRequiredString(body, "client_id"),
        client_secret: readRequiredString(body, "client_secret"),
        scopes: typeof body.scopes === "string" ? body.scopes : undefined,
      }),
      { status: 201 },
    );
  }

  // --- Agents ---

  // Self-service registration: an agent token by itself grants nothing —
  // every proxy grant still requires an explicit user approval — so open
  // registration is safe (protected by the global /v4 rate limiter).
  if (request.method === "POST" && path === "/v4/agents/register") {
    const body = await parseJsonBody(request);
    const ownerUserId =
      typeof body.owner_user_id === "string" && body.owner_user_id.trim()
        ? body.owner_user_id.trim()
        : "self-registered";
    const { createAgent } = await import("../v2/v2.repository");
    const created = await createAgent({
      name: readRequiredString(body, "name"),
      owner_user_id: ownerUserId,
      tenant_id:
        typeof body.tenant_id === "string" ? normalizeTenantId(body.tenant_id) : undefined,
      metadata: readOptionalObject(body, "metadata"),
    });
    return Response.json(
      {
        ok: true,
        agent: {
          id: created.agent.id,
          name: created.agent.name,
          owner_user_id: created.agent.owner_user_id,
          tenant_id: created.agent.tenant_id,
          status: created.agent.status,
          created_at: created.agent.created_at,
        },
        access_token: created.access_token,
        next_steps: {
          sandbox: "POST /v4/sandbox/start — full self-test without human approval",
          request_access:
            "POST /v4/access-requests — real providers require the user to open approval_url",
        },
      },
      { status: 201 },
    );
  }

  if (request.method === "GET" && path === "/v4/agents") {
    requireAdminAccess(request);
    const { listAgents } = await import("../v2/v2.repository");
    const ownerUserId = url.searchParams.get("owner_user_id")?.trim() || undefined;
    const items = await listAgents({ owner_user_id: ownerUserId });
    return Response.json({ ok: true, items });
  }

  // --- OAuth providers (admin management + agent proposals) ---

  if (request.method === "POST" && path === "/v4/providers/proposals") {
    const agent = await requireAgentFromRequest(request);
    const body = await parseJsonBody(request);
    const proposal = await providerProposalService.submitProposal({
      agent,
      body: readProposalInput(body),
      apiBaseUrl,
    });
    return Response.json(sanitizeAgentResponse({ ok: true, proposal }), { status: 201 });
  }

  if (
    request.method === "GET" &&
    segments.length === 4 &&
    segments[1] === "providers" &&
    segments[2] === "proposals"
  ) {
    const agent = await requireAgentFromRequest(request);
    const proposal = await providerProposalService.getProposal({
      agent,
      proposalId: decodeURIComponent(segments[3] ?? ""),
    });
    return Response.json(sanitizeAgentResponse({ ok: true, proposal }));
  }

  if (request.method === "GET" && path === "/v4/providers/admin") {
    requireAdminAccess(request);
    const items = await oauthProviderService.listAdminProviders();
    return Response.json({ ok: true, items });
  }

  if (request.method === "POST" && path === "/v4/providers") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const provider = await oauthProviderService.createProvider({
      slug: readRequiredString(body, "slug"),
      display_name: readRequiredString(body, "display_name"),
      auth_type: (body.auth_type as "oauth2" | "oidc" | "api_key" | "custom") ?? "oauth2",
      discovery_url: typeof body.discovery_url === "string" ? body.discovery_url : undefined,
      issuer: typeof body.issuer === "string" ? body.issuer : undefined,
      authorization_url: typeof body.authorization_url === "string" ? body.authorization_url : undefined,
      token_url: typeof body.token_url === "string" ? body.token_url : undefined,
      userinfo_url: typeof body.userinfo_url === "string" ? body.userinfo_url : undefined,
      revoke_url: typeof body.revoke_url === "string" ? body.revoke_url : undefined,
      client_id: typeof body.client_id === "string" ? body.client_id : undefined,
      client_secret: typeof body.client_secret === "string" ? body.client_secret : undefined,
      default_scopes: Array.isArray(body.default_scopes) ? body.default_scopes.map(String) : undefined,
      supported_scopes: Array.isArray(body.supported_scopes) ? body.supported_scopes.map(String) : undefined,
      pkce_required: body.pkce_required !== false,
    });
    return Response.json({ ok: true, provider }, { status: 201 });
  }

  if (
    request.method === "PATCH" &&
    segments.length === 4 &&
    segments[1] === "providers" &&
    segments[3] === "credentials"
  ) {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const provider = await oauthProviderService.updateProviderCredentials({
      id: decodeURIComponent(segments[2] ?? ""),
      client_id: readRequiredString(body, "client_id"),
      client_secret: typeof body.client_secret === "string" ? body.client_secret : undefined,
    });
    return Response.json({ ok: true, provider });
  }

  if (
    request.method === "GET" &&
    segments.length === 3 &&
    segments[1] === "providers" &&
    segments[2] !== "admin"
  ) {
    const provider = await oauthProviderService.getProvider(decodeURIComponent(segments[2] ?? ""));
    return Response.json({ ok: true, provider });
  }

  // --- OAuth connections (user) ---

  if (request.method === "POST" && path === "/v4/oauth/connect/start") {
    const session = await requireUserSession(request);
    const body = await parseJsonBody(request);
    const result = await oauthConnectionService.startConnect({
      providerId: typeof body.provider_id === "string" ? body.provider_id : undefined,
      providerSlug: typeof body.provider_slug === "string" ? body.provider_slug : undefined,
      userId: session.user_id,
      apiBaseUrl,
      redirectAfter: typeof body.redirect_after === "string" ? body.redirect_after : undefined,
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : undefined,
    });
    return Response.json(result);
  }

  if (request.method === "POST" && path === "/v4/oauth/device/start") {
    const session = await requireUserSession(request);
    const body = await parseJsonBody(request);
    const result = await deviceFlowService.startDeviceFlow({
      request,
      providerId: typeof body.provider_id === "string" ? body.provider_id : undefined,
      providerSlug: typeof body.provider_slug === "string" ? body.provider_slug : undefined,
      userId: session.user_id,
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : undefined,
    });
    return Response.json(result, { status: 201 });
  }

  if (request.method === "POST" && path === "/v4/oauth/device/poll") {
    const session = await requireUserSession(request);
    const body = await parseJsonBody(request);
    const result = await deviceFlowService.pollDeviceFlow({
      sessionId: readRequiredString(body, "session_id"),
      userId: session.user_id,
      apiBaseUrl,
    });
    return Response.json(result);
  }

  if (
    request.method === "DELETE" &&
    segments.length === 3 &&
    segments[1] === "connections"
  ) {
    const session = await requireUserSession(request);
    const connectionId = decodeURIComponent(segments[2] ?? "");
    await oauthConnectionService.revokeConnection(connectionId, session.user_id);
    return Response.json({ ok: true });
  }

  // --- Internal E2E seeds (disabled unless KEYSERVICE_E2E_INTERNAL=1) ---

  if (path.startsWith("/v4/internal/e2e/")) {
    if (!config.e2eInternalEnabled) {
      throw new ValidationError("E2E internal endpoints are disabled", {
        error_code: "e2e_internal_disabled",
      });
    }
    requireAdminAccess(request);

    if (request.method === "POST" && path === "/v4/internal/e2e/seed-oauth-connection") {
      const body = await parseJsonBody(request);
      const providerSlug = readRequiredString(body, "provider_slug");
      const provider = await findOAuthProviderBySlug(providerSlug);
      if (!provider) {
        throw new NotFoundError(`OAuth provider not found: ${providerSlug}`);
      }
      const userId = readRequiredString(body, "user_id");
      const connection = await createOAuthConnection({
        user_id: userId,
        provider_id: provider.id,
        provider_account_id: `e2e-${userId}`,
        display_name: `E2E ${providerSlug}`,
        access_token: readRequiredString(body, "access_token"),
        scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : provider.default_scopes,
        metadata: { source: "e2e_seed" },
      });
      return Response.json({
        ok: true,
        connection: { id: connection.id, provider_slug: providerSlug, user_id: userId },
      });
    }

    if (request.method === "POST" && path === "/v4/internal/e2e/seed-provider") {
      const body = await parseJsonBody(request);
      const mockBaseUrl = readRequiredString(body, "mock_base_url").replace(/\/+$/, "");
      const slug =
        typeof body.slug === "string" && body.slug.trim()
          ? body.slug.trim()
          : `e2e-provider-${Date.now()}`;
      const provider = await createOAuthProvider({
        slug,
        display_name: "E2E Mock Provider",
        auth_type: "oauth2",
        authorization_url: `${mockBaseUrl}/authorize`,
        token_url: `${mockBaseUrl}/token`,
        userinfo_url: `${mockBaseUrl}/userinfo`,
        device_authorization_endpoint: `${mockBaseUrl}/device/code`,
        client_id: "e2e-client",
        client_secret: "e2e-secret",
        default_scopes: ["read"],
        supported_scopes: ["read"],
        pkce_required: false,
        token_auth_method: "client_secret_post",
      });
      return Response.json({ ok: true, provider: { id: provider.id, slug: provider.slug } });
    }
  }

  return null;
}
