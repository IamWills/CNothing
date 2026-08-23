import { requireServiceCredential } from "../v4/operator-auth";
import { NotFoundError, ValidationError } from "../utils/errors";
import { parseJsonBody } from "../utils/http";
import { readOptionalObject, readRequiredString, requireAgentFromRequest } from "../v4/agent-auth";
import { listAuthProviders } from "../v4/auth-providers.service";
import { githubOAuthService } from "../v4/github-oauth.service";
import { oidcService } from "../v4/oidc.service";
import { oauthConnectionService, oauthProviderService } from "../v4/oauth-connection.service";
import { clearUserSessionCookie } from "../v4/session-cookie";
import {
  readUserSessionToken,
  requireAdmin,
  requireUser,
  requireUserSession,
  userSessionService,
} from "../v4/user-session";
import { bootstrapFirstAdmin, demoteUser, promoteUser, readAdminRequestId } from "../v4/admin.service";
import { createAgent, listAgents, revokeAgent } from "../v4/platform.repository";
import {
  agentEnrollmentService,
  readEnrollmentSecret,
} from "../v4/agent-enrollment.service";

function inferBaseUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("Host") || requestUrl.host;
  const proto = forwardedProto || requestUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

async function requireAdminOrAgent(request: Request) {
  if (readUserSessionToken(request)) {
    const { user } = await requireAdmin(request);
    return { actor: "admin" as const, user };
  }
  const agent = await requireAgentFromRequest(request);
  return { actor: "agent" as const, agent };
}

/** OAuth callbacks are exact v4 contracts registered with each provider. */
export async function handleOAuthCallbackRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const apiBaseUrl = inferBaseUrl(request);

  const connectionMatch = path.match(/^\/v4\/oauth\/callback\/([^/]+)$/);
  if (request.method === "GET" && connectionMatch) {
    const providerSlug = decodeURIComponent(connectionMatch[1]!);
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
      oauthApiVersion: "v4",
    });
    if (result.session_cookie) {
      return new Response(null, {
        status: 302,
        headers: { Location: result.redirect_url, "Set-Cookie": result.session_cookie },
      });
    }
    return Response.redirect(result.redirect_url, 302);
  }

  const githubLoginMatch =
    path === "/v4/auth/github/callback" ||
    path === "/v3/auth/github/callback" ||
    path === "/v2/auth/github/callback";
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

  const oidcLoginMatch = path.match(/^\/v4\/auth\/oidc\/([^/]+)\/callback$/);
  if (request.method === "GET" && oidcLoginMatch) {
    const providerName = decodeURIComponent(oidcLoginMatch[1]!);
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

  if (request.method === "POST" && path === "/v4/auth/logout") {
    const result = await userSessionService.logout(request);
    return Response.json(result, {
      headers: { "Set-Cookie": clearUserSessionCookie() },
    });
  }

  if (request.method === "GET" && path === "/v4/auth/me") {
    return Response.json(await userSessionService.me(request));
  }

  if (request.method === "POST" && path === "/v4/admin/bootstrap") {
    requireServiceCredential(request);
    const body = await parseJsonBody(request);
    const user = await bootstrapFirstAdmin({
      userId: readRequiredString(body, "user_id"),
      requestId: readAdminRequestId(request),
    });
    return Response.json({
      ok: true,
      user_id: user.id,
      role: user.role,
    });
  }

  if (request.method === "POST" && path === "/v4/admin/users/promote") {
    const { user: actor } = await requireAdmin(request);
    const body = await parseJsonBody(request);
    const user = await promoteUser({
      userId: readRequiredString(body, "user_id"),
      actorUserId: actor.id,
      requestId: readAdminRequestId(request),
    });
    return Response.json({ ok: true, user_id: user.id, role: user.role });
  }

  if (request.method === "POST" && path === "/v4/admin/users/demote") {
    const { user: actor } = await requireAdmin(request);
    const body = await parseJsonBody(request);
    const user = await demoteUser({
      userId: readRequiredString(body, "user_id"),
      actorUserId: actor.id,
      requestId: readAdminRequestId(request),
    });
    return Response.json({ ok: true, user_id: user.id, role: user.role });
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
    await requireAdmin(request);
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

  // --- Agent enrollment (plugin host only; never an MCP tool) ---

  if (request.method === "POST" && path === "/v4/agent-enrollments") {
    const raw = await request.text();
    let parsed: unknown = {};
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw new ValidationError("Request body must be valid JSON");
      }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ValidationError("Request body must be a JSON object");
    }
    const body = parsed as Record<string, unknown>;
    const created = await agentEnrollmentService.create({
      request,
      apiBaseUrl,
      client_name: typeof body.client_name === "string" ? body.client_name : undefined,
      client_uri: body.client_uri,
      software_id: body.software_id,
    });
    return Response.json(created, { status: 201 });
  }

  if (segments.length >= 2 && segments[0] === "v4" && segments[1] === "agent-enrollments") {
    const enrollmentId = decodeURIComponent(segments[2] ?? "");
    if (!enrollmentId) throw new ValidationError("enrollment id is required");

    if (request.method === "GET" && segments.length === 3) {
      const secret = readEnrollmentSecret(request);
      if (secret) {
        return Response.json(
          await agentEnrollmentService.poll({ id: enrollmentId, secret, apiBaseUrl }),
        );
      }
      return Response.json(await agentEnrollmentService.publicStatus(enrollmentId, apiBaseUrl));
    }

    if (request.method === "POST" && segments.length === 4 && segments[3] === "approve") {
      const { user } = await requireUser(request);
      return Response.json(
        await agentEnrollmentService.approve({
          id: enrollmentId,
          userId: user.id,
          apiBaseUrl,
        }),
      );
    }

    if (request.method === "POST" && segments.length === 4 && segments[3] === "deny") {
      const { user } = await requireUser(request);
      return Response.json(await agentEnrollmentService.deny({ id: enrollmentId, userId: user.id }));
    }
  }

  // --- Agents ---

  // Operator mint remains admin-only. Anonymous self-registration is still
  // refused: plugins create a pending enrollment, and a signed-in user must
  // approve it before an Agent identity exists.
  if (request.method === "POST" && path === "/v4/agents") {
    await requireAdmin(request);
    const body = await parseJsonBody(request);
    const created = await createAgent({
      name: readRequiredString(body, "name"),
      owner_user_id: readRequiredString(body, "owner_user_id"),
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
        next_step:
          "Store this token in the host secret store (CNOTHING_AGENT_TOKEN or the plugin token file). Never paste it into a chat, tool argument, or MCP result.",
      },
      { status: 201 },
    );
  }

  if (request.method === "GET" && path === "/v4/agents") {
    const { user } = await requireUser(request);
    const ownerUserId =
      user.role === "admin"
        ? url.searchParams.get("owner_user_id")?.trim() || undefined
        : user.id;
    const items = await listAgents({ owner_user_id: ownerUserId });
    return Response.json({ ok: true, items });
  }

  if (request.method === "DELETE" && segments.length === 3 && segments[1] === "agents") {
    const { user } = await requireUser(request);
    const revoked = await revokeAgent({
      id: decodeURIComponent(segments[2] ?? ""),
      ...(user.role === "admin" ? {} : { owner_user_id: user.id }),
    });
    if (!revoked) throw new NotFoundError("Agent not found or already revoked");
    return Response.json({ ok: true, revoked: true });
  }

  // --- OAuth providers (operator managed) ---

  if (request.method === "GET" && path === "/v4/providers/admin") {
    await requireAdmin(request);
    const items = await oauthProviderService.listAdminProviders();
    return Response.json({ ok: true, items });
  }

  if (request.method === "POST" && path === "/v4/providers/proposals") {
    await requireAdminOrAgent(request);
    const body = await parseJsonBody(request);
    const provider = await oauthProviderService.proposeProvider({
      slug: typeof body.slug === "string" ? body.slug : undefined,
      display_name: typeof body.display_name === "string" ? body.display_name : undefined,
      discovery_url: typeof body.discovery_url === "string" ? body.discovery_url : undefined,
      issuer: typeof body.issuer === "string" ? body.issuer : undefined,
    });
    return Response.json({ ok: true, provider }, { status: 201 });
  }

  if (request.method === "POST" && path === "/v4/providers") {
    await requireAdmin(request);
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
    await requireAdmin(request);
    const body = await parseJsonBody(request);
    const provider = await oauthProviderService.updateProviderCredentials({
      id: decodeURIComponent(segments[2] ?? ""),
      client_id: readRequiredString(body, "client_id"),
      client_secret: typeof body.client_secret === "string" ? body.client_secret : undefined,
    });
    return Response.json({ ok: true, provider });
  }

  if (request.method === "PATCH" && segments.length === 3 && segments[1] === "providers") {
    await requireAdmin(request);
    const body = await parseJsonBody(request);
    const provider = await oauthProviderService.updateProvider({
      id: decodeURIComponent(segments[2] ?? ""),
      display_name: typeof body.display_name === "string" ? body.display_name : undefined,
      discovery_url: typeof body.discovery_url === "string" ? body.discovery_url : undefined,
      issuer: typeof body.issuer === "string" ? body.issuer : undefined,
      authorization_url: typeof body.authorization_url === "string" ? body.authorization_url : undefined,
      token_url: typeof body.token_url === "string" ? body.token_url : undefined,
      userinfo_url: typeof body.userinfo_url === "string" ? body.userinfo_url : undefined,
      revoke_url: typeof body.revoke_url === "string" ? body.revoke_url : undefined,
      jwks_url: typeof body.jwks_url === "string" ? body.jwks_url : undefined,
      default_scopes: Array.isArray(body.default_scopes) ? body.default_scopes.map(String) : undefined,
      supported_scopes: Array.isArray(body.supported_scopes) ? body.supported_scopes.map(String) : undefined,
      login_enabled: typeof body.login_enabled === "boolean" ? body.login_enabled : undefined,
      status: body.status === "active" || body.status === "disabled" ? body.status : undefined,
      reviewed: body.reviewed === true,
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

  return null;
}
