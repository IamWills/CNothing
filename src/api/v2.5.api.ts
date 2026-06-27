import { requireAdminAccess } from "../admin/admin-auth";
import config from "../config";
import { NotFoundError, ValidationError } from "../utils/errors";
import { parseJsonBody } from "../utils/http";
import { readOptionalObject, readRequiredString, requireAgentFromRequest } from "../v2/agent-auth";
import { agentAuthorizationV25Service } from "../v2/agent-authorization-v25.service";
import { invocationGatewayService } from "../v2/invocation-gateway.service";
import { oauthConnectionService, oauthProviderService } from "../v2/oauth-connection.service";
import { sanitizeAgentResponse } from "../v2/secret-redaction";
import { activateOpenApiCandidates, activateMcpCandidates, findImportJob, importMcpManifest, importOpenApi } from "../v2/import.service";
import { revokeGrant } from "../v2/v2.repository";
import { getV25PlatformStatus } from "../v2/v2.5-bootstrap.service";
import { requireUserSession } from "../v2/user-session";

function inferBaseUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("Host") || requestUrl.host;
  const proto = forwardedProto || requestUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

export async function handleV25AgentRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);
  const apiBaseUrl = inferBaseUrl(request);

  if (request.method === "GET" && path === "/v2/agent/capabilities") {
    const agent = await requireAgentFromRequest(request);
    const items = await agentAuthorizationV25Service.listCapabilitiesForAgent(agent);
    return Response.json(sanitizeAgentResponse({ ok: true, items }));
  }

  if (request.method === "POST" && path === "/v2/agent/authorizations") {
    const agent = await requireAgentFromRequest(request);
    const body = await parseJsonBody(request);
    const result = await agentAuthorizationV25Service.requestAuthorization({
      agent,
      body: {
        capability: readRequiredString(body, "capability"),
        requested_scopes: Array.isArray(body.requested_scopes)
          ? body.requested_scopes.map(String)
          : undefined,
        reason: typeof body.reason === "string" ? body.reason : undefined,
      },
      apiBaseUrl,
    });
    return Response.json(result, { status: 201 });
  }

  if (
    request.method === "GET" &&
    segments.length === 4 &&
    segments[0] === "v2" &&
    segments[1] === "agent" &&
    segments[2] === "authorizations"
  ) {
    const agent = await requireAgentFromRequest(request);
    const authorizationId = decodeURIComponent(segments[3] ?? "");
    const result = await agentAuthorizationV25Service.getAuthorizationStatus(authorizationId, agent);
    return Response.json(result);
  }

  if (request.method === "POST" && path === "/v2/agent/invoke") {
    const agent = await requireAgentFromRequest(request);
    const body = await parseJsonBody(request);
    try {
      const result = await invocationGatewayService.invoke({
        agent,
        body: {
          capability: readRequiredString(body, "capability"),
          input: readOptionalObject(body, "input"),
          reason: typeof body.reason === "string" ? body.reason : undefined,
          confirmation_id:
            typeof body.confirmation_id === "string" ? body.confirmation_id : undefined,
          request_id: typeof body.request_id === "string" ? body.request_id : undefined,
        },
      });
      if ("pending" in result && result.pending) {
        return Response.json(sanitizeAgentResponse(result), { status: 202 });
      }
      return Response.json(result);
    } catch (error) {
      if (
        error instanceof Error &&
        "details" in error &&
        typeof (error as { details?: { error_code?: string } }).details?.error_code === "string" &&
        (error as { details?: { error_code?: string } }).details?.error_code === "authorization_required"
      ) {
        const details = (error as { details?: Record<string, unknown> }).details ?? {};
        return Response.json(
          sanitizeAgentResponse({
            ok: false,
            error_code: "authorization_required",
            message: error.message,
            ...details,
          }),
          { status: 403 },
        );
      }
      throw error;
    }
  }

  if (request.method === "GET" && path === "/v2/agent/grants") {
    const agent = await requireAgentFromRequest(request);
    const items = await agentAuthorizationV25Service.listGrantsForAgent(agent.id);
    return Response.json(sanitizeAgentResponse({ ok: true, items }));
  }

  if (request.method === "POST" && path === "/v2/agent/grants/revoke") {
    const agent = await requireAgentFromRequest(request);
    const body = await parseJsonBody(request);
    const grantId = readRequiredString(body, "grant_id");
    const revoked = await revokeGrant(grantId);
    if (!revoked) {
      throw new NotFoundError("Grant not found");
    }
    if (revoked.agent_id !== agent.id) {
      throw new ValidationError("Grant does not belong to this agent");
    }
    return Response.json(sanitizeAgentResponse({ ok: true, grant_id: grantId, status: "revoked" }));
  }

  return Response.json({ error: { type: "NotFoundError", message: `Route not found: ${path}` } }, { status: 404 });
}

export async function handleV25OAuthRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);
  const apiBaseUrl = inferBaseUrl(request);

  if (request.method === "GET" && path === "/v2/oauth/providers") {
    const items = await oauthProviderService.listPublicProviders();
    return Response.json({ ok: true, items });
  }

  if (request.method === "POST" && path === "/v2/oauth/providers") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const provider = await oauthProviderService.createProvider({
      slug: readRequiredString(body, "slug"),
      display_name: readRequiredString(body, "display_name"),
      auth_type: (body.auth_type as "oauth2" | "oidc" | "api_key" | "custom") ?? "oauth2",
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
    request.method === "GET" &&
    segments.length === 4 &&
    segments[0] === "v2" &&
    segments[1] === "oauth" &&
    segments[2] === "providers"
  ) {
    const provider = await oauthProviderService.getProvider(decodeURIComponent(segments[3] ?? ""));
    return Response.json({ ok: true, provider });
  }

  if (request.method === "POST" && path === "/v2/oauth/connect/start") {
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
    request.method === "GET" &&
    segments.length === 4 &&
    segments[0] === "v2" &&
    segments[1] === "oauth" &&
    segments[2] === "callback"
  ) {
    const providerSlug = decodeURIComponent(segments[3] ?? "");
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
    });
    return Response.redirect(result.redirect_url, 302);
  }

  if (request.method === "GET" && path === "/v2/oauth/connections") {
    const session = await requireUserSession(request);
    const items = await oauthConnectionService.listConnections(session.user_id);
    return Response.json({ ok: true, items });
  }

  if (
    request.method === "DELETE" &&
    segments.length === 4 &&
    segments[0] === "v2" &&
    segments[1] === "oauth" &&
    segments[2] === "connections"
  ) {
    const session = await requireUserSession(request);
    const connectionId = decodeURIComponent(segments[3] ?? "");
    await oauthConnectionService.revokeConnection(connectionId, session.user_id);
    return Response.json({ ok: true });
  }

  return Response.json({ error: { type: "NotFoundError", message: `Route not found: ${path}` } }, { status: 404 });
}

export async function handleV25ImportRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);

  if (request.method === "POST" && path === "/v2/import/openapi") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    let content = typeof body.content === "string" ? body.content : "";
    if (!content && typeof body.url === "string") {
      const response = await fetch(body.url);
      content = await response.text();
    }
    if (!content) {
      throw new ValidationError("content or url is required");
    }
    const job = await importOpenApi({
      content,
      sourceUrl: typeof body.url === "string" ? body.url : undefined,
      sourceFilename: typeof body.filename === "string" ? body.filename : undefined,
      providerId: typeof body.provider_id === "string" ? body.provider_id : undefined,
      providerSlug: typeof body.provider_slug === "string" ? body.provider_slug : undefined,
    });
    return Response.json({ ok: true, job: sanitizeJob(job) }, { status: 201 });
  }

  if (
    request.method === "GET" &&
    segments.length === 4 &&
    segments[0] === "v2" &&
    segments[1] === "import" &&
    segments[2] === "openapi"
  ) {
    requireAdminAccess(request);
    const job = await findImportJob(decodeURIComponent(segments[3] ?? ""));
    if (!job) {
      throw new NotFoundError("Import job not found");
    }
    return Response.json({ ok: true, job: sanitizeJob(job) });
  }

  if (request.method === "POST" && path === "/v2/capabilities/from-openapi") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const result = await activateOpenApiCandidates({
      jobId: readRequiredString(body, "job_id"),
      candidateNames: Array.isArray(body.candidate_names)
        ? body.candidate_names.map(String)
        : [],
      connectorId: readRequiredString(body, "connector_id"),
      providerId: typeof body.provider_id === "string" ? body.provider_id : undefined,
    });
    return Response.json({ ok: true, ...result });
  }

  if (request.method === "POST" && path === "/v2/import/mcp") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const job = await importMcpManifest({
      manifest: (body.manifest as Record<string, unknown>) ?? body,
      providerId: typeof body.provider_id === "string" ? body.provider_id : undefined,
      providerSlug: typeof body.provider_slug === "string" ? body.provider_slug : undefined,
    });
    return Response.json({ ok: true, job: sanitizeJob(job) }, { status: 201 });
  }

  if (
    request.method === "GET" &&
    segments.length === 4 &&
    segments[0] === "v2" &&
    segments[1] === "import" &&
    segments[2] === "mcp"
  ) {
    requireAdminAccess(request);
    const job = await findImportJob(decodeURIComponent(segments[3] ?? ""));
    if (!job) {
      throw new NotFoundError("Import job not found");
    }
    return Response.json({ ok: true, job: sanitizeJob(job) });
  }

  if (request.method === "POST" && path === "/v2/capabilities/from-mcp") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const result = await activateMcpCandidates({
      jobId: readRequiredString(body, "job_id"),
      candidateNames: Array.isArray(body.candidate_names)
        ? body.candidate_names.map(String)
        : [],
      connectorId: readRequiredString(body, "connector_id"),
      providerId: typeof body.provider_id === "string" ? body.provider_id : undefined,
    });
    return Response.json({ ok: true, ...result });
  }

  return Response.json({ error: { type: "NotFoundError", message: `Route not found: ${path}` } }, { status: 404 });
}

export async function handleV25PlatformRequest(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/v2/platform/v2.5/status") {
    return Response.json({ ok: true, ...(await getV25PlatformStatus()) });
  }
  return null;
}

function sanitizeJob(job: Awaited<ReturnType<typeof findImportJob>>) {
  if (!job) {
    return null;
  }
  return sanitizeAgentResponse({
    id: job.id,
    import_type: job.import_type,
    status: job.status,
    candidate_count: job.candidate_count,
    candidates: job.candidates.map((candidate) => ({
      name: candidate.name,
      display_name: candidate.display_name,
      description: candidate.description,
      capability_type: candidate.capability_type,
      risk_level: candidate.risk_level,
      required_scopes: candidate.required_scopes,
      enabled: candidate.enabled,
    })),
    error_message: job.error_message,
    created_at: job.created_at,
    updated_at: job.updated_at,
  });
}

export async function handleV25ApproveRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 3 || segments[0] !== "v2" || segments[1] !== "approve") {
    return Response.json({ error: { type: "NotFoundError", message: "Not found" } }, { status: 404 });
  }

  const session = await requireUserSession(request);
  const body = await parseJsonBody(request);
  const authorizationId = decodeURIComponent(segments[2] ?? "");
  const result = await agentAuthorizationV25Service.approveWithConnection({
    authorizationId,
    userId: session.user_id,
    connectionId: readRequiredString(body, "connection_id"),
    grantedScopes: Array.isArray(body.scopes) ? body.scopes.map(String) : undefined,
    expiresAt: typeof body.expires_at === "string" ? body.expires_at : undefined,
  });
  return Response.json(result);
}
