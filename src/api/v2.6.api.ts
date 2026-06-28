import { requireAdminAccess } from "../admin/admin-auth";
import { NotFoundError, ValidationError } from "../utils/errors";
import { parseJsonBody } from "../utils/http";
import { readOptionalObject, readRequiredString, requireAgentFromRequest } from "../v2/agent-auth";
import { agentAuthorizationV25Service } from "../v2/agent-authorization-v25.service";
import { invocationGatewayService } from "../v2/invocation-gateway.service";
import { oauthConnectionService, oauthProviderService } from "../v2/oauth-connection.service";
import { sanitizeAgentResponse } from "../v2/secret-redaction";
import {
  activateOpenApiCandidates,
  activateMcpCandidates,
  findImportJob,
  importMcpManifest,
  importOpenApi,
} from "../v2/import.service";
import { requireUserSession } from "../v2/user-session";
import {
  handleV25ApproveRequest,
  handleV25ImportRequest,
  handleV25OAuthRequest,
} from "./v2.5.api";

function inferBaseUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("Host") || requestUrl.host;
  const proto = forwardedProto || requestUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

function rewriteRequestPath(request: Request, fromPrefix: string, toPrefix: string): Request {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(fromPrefix, toPrefix);
  return new Request(url, request);
}

function sanitizeImportJob(job: Awaited<ReturnType<typeof findImportJob>>) {
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
      invocation_type: candidate.invocation_type,
      input_schema: candidate.input_schema,
      output_schema: candidate.output_schema,
    })),
    provider_id: job.provider_id,
    error_message: job.error_message,
    created_at: job.created_at,
    updated_at: job.updated_at,
  });
}


export async function handleV26OAuthRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);
  const apiBaseUrl = inferBaseUrl(request);

  if (request.method === "POST" && path === "/v2.6/oauth/providers/discover") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const discovered = await oauthProviderService.discoverProvider({
      discovery_url: typeof body.discovery_url === "string" ? body.discovery_url : undefined,
      issuer: typeof body.issuer === "string" ? body.issuer : undefined,
    });
    return Response.json({ ok: true, discovered });
  }

  if (request.method === "GET" && path === "/v2.6/oauth/providers") {
    requireAdminAccess(request);
    const items = await oauthProviderService.listAdminProviders();
    return Response.json({ ok: true, items });
  }

  if (request.method === "POST" && path === "/v2.6/oauth/providers") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const provider = await oauthProviderService.createProvider({
      slug: readRequiredString(body, "slug"),
      display_name: readRequiredString(body, "display_name"),
      auth_type: (body.auth_type as "oauth2" | "oidc" | "api_key" | "custom") ?? "oauth2",
      issuer: typeof body.issuer === "string" ? body.issuer : undefined,
      discovery_url: typeof body.discovery_url === "string" ? body.discovery_url : undefined,
      authorization_url: typeof body.authorization_url === "string" ? body.authorization_url : undefined,
      token_url: typeof body.token_url === "string" ? body.token_url : undefined,
      userinfo_url: typeof body.userinfo_url === "string" ? body.userinfo_url : undefined,
      revoke_url: typeof body.revoke_url === "string" ? body.revoke_url : undefined,
      jwks_url: typeof body.jwks_url === "string" ? body.jwks_url : undefined,
      client_id: typeof body.client_id === "string" ? body.client_id : undefined,
      client_secret: typeof body.client_secret === "string" ? body.client_secret : undefined,
      default_scopes: Array.isArray(body.default_scopes) ? body.default_scopes.map(String) : undefined,
      supported_scopes: Array.isArray(body.supported_scopes) ? body.supported_scopes.map(String) : undefined,
      pkce_required: body.pkce_required !== false,
      token_auth_method:
        typeof body.token_auth_method === "string"
          ? (body.token_auth_method as "client_secret_basic" | "client_secret_post" | "none")
          : undefined,
    });
    return Response.json({ ok: true, provider }, { status: 201 });
  }

  if (
    request.method === "GET" &&
    segments.length === 4 &&
    segments[0] === "v2.6" &&
    segments[1] === "oauth" &&
    segments[2] === "providers"
  ) {
    requireAdminAccess(request);
    const { findOAuthProviderById, toProviderAdmin } = await import("../v2/oauth.repository");
    const provider = await findOAuthProviderById(decodeURIComponent(segments[3] ?? ""));
    if (!provider) {
      throw new NotFoundError("OAuth provider not found");
    }
    return Response.json({ ok: true, provider: toProviderAdmin(provider) });
  }

  if (request.method === "POST" && path === "/v2.6/oauth/connect/start") {
    const session = await requireUserSession(request);
    const body = await parseJsonBody(request);
    const result = await oauthConnectionService.startConnect({
      providerId: typeof body.provider_id === "string" ? body.provider_id : undefined,
      providerSlug: typeof body.provider_slug === "string" ? body.provider_slug : undefined,
      userId: session.user_id,
      apiBaseUrl,
      redirectAfter: typeof body.redirect_after === "string" ? body.redirect_after : undefined,
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : undefined,
      oauthApiVersion: "v2.6",
    });
    return Response.json(result);
  }

  if (
    request.method === "GET" &&
    segments.length === 4 &&
    segments[0] === "v2.6" &&
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
      oauthApiVersion: "v2.6",
    });
    return Response.redirect(result.redirect_url, 302);
  }

  if (request.method === "GET" && path === "/v2.6/oauth/connections") {
    const session = await requireUserSession(request);
    const items = await oauthConnectionService.listConnections(session.user_id);
    return Response.json({ ok: true, items });
  }

  if (
    request.method === "DELETE" &&
    segments.length === 4 &&
    segments[0] === "v2.6" &&
    segments[1] === "oauth" &&
    segments[2] === "connections"
  ) {
    const session = await requireUserSession(request);
    const connectionId = decodeURIComponent(segments[3] ?? "");
    await oauthConnectionService.revokeConnection(connectionId, session.user_id);
    return Response.json({ ok: true });
  }

  return handleV25OAuthRequest(rewriteRequestPath(request, "/v2.6/", "/v2/"));
}

export async function handleV26ImportRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);

  if (request.method === "POST" && path === "/v2.6/import/openapi") {
    requireAdminAccess(request);
    const contentType = request.headers.get("content-type") ?? "";
    let content = "";
    let sourceUrl: string | undefined;
    let sourceFilename: string | undefined;
    let providerId: string | undefined;
    let providerSlug: string | undefined;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (file instanceof File) {
        content = await file.text();
        sourceFilename = file.name;
      }
      providerId = typeof form.get("provider_id") === "string" ? String(form.get("provider_id")) : undefined;
      providerSlug =
        typeof form.get("provider_slug") === "string" ? String(form.get("provider_slug")) : undefined;
    } else {
      const body = await parseJsonBody(request);
      content = typeof body.content === "string" ? body.content : "";
      if (!content && typeof body.url === "string") {
        sourceUrl = body.url;
        const response = await fetch(body.url);
        content = await response.text();
      }
      sourceFilename = typeof body.filename === "string" ? body.filename : undefined;
      providerId = typeof body.provider_id === "string" ? body.provider_id : undefined;
      providerSlug = typeof body.provider_slug === "string" ? body.provider_slug : undefined;
    }

    if (!content) {
      throw new ValidationError("content, url, or file upload is required");
    }

    const job = await importOpenApi({
      content,
      sourceUrl,
      sourceFilename,
      providerId,
      providerSlug,
    });
    return Response.json({ ok: true, job: sanitizeImportJob(job) }, { status: 201 });
  }

  if (
    request.method === "GET" &&
    segments.length === 4 &&
    segments[0] === "v2.6" &&
    segments[1] === "import" &&
    segments[2] === "openapi"
  ) {
    requireAdminAccess(request);
    const job = await findImportJob(decodeURIComponent(segments[3] ?? ""));
    if (!job) {
      throw new NotFoundError("Import job not found");
    }
    return Response.json({ ok: true, job: sanitizeImportJob(job) });
  }

  if (request.method === "POST" && path === "/v2.6/capabilities/generate-from-openapi") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const result = await activateOpenApiCandidates({
      jobId: readRequiredString(body, "job_id"),
      candidateNames: Array.isArray(body.candidate_names)
        ? body.candidate_names.map(String)
        : [],
      connectorId: typeof body.connector_id === "string" ? body.connector_id : undefined,
      providerId: typeof body.provider_id === "string" ? body.provider_id : undefined,
      providerSlug: typeof body.provider_slug === "string" ? body.provider_slug : undefined,
    });
    return Response.json({ ok: true, ...result });
  }

  if (request.method === "POST" && path === "/v2.6/capabilities/generate-from-mcp") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const result = await activateMcpCandidates({
      jobId: readRequiredString(body, "job_id"),
      candidateNames: Array.isArray(body.candidate_names)
        ? body.candidate_names.map(String)
        : [],
      connectorId: typeof body.connector_id === "string" ? body.connector_id : undefined,
      providerId: typeof body.provider_id === "string" ? body.provider_id : undefined,
      providerSlug: typeof body.provider_slug === "string" ? body.provider_slug : undefined,
    });
    return Response.json({ ok: true, ...result });
  }

  return handleV25ImportRequest(rewriteRequestPath(request, "/v2.6/", "/v2/"));
}

export async function handleV26ApproveRequest(request: Request): Promise<Response> {
  return handleV25ApproveRequest(rewriteRequestPath(request, "/v2.6/", "/v2/"));
}

export async function handleV26PlatformRequest(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/v2.6/platform/status") {
    const { getV25PlatformStatus } = await import("../v2/v2.5-bootstrap.service");
    return Response.json({ ok: true, ...(await getV25PlatformStatus()), version: "2.6.0" });
  }
  return null;
}

export async function handleV26CapabilitiesRequest(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/v2.6/capabilities") {
    requireAdminAccess(request);
    const { pool } = await import("../db");
    const result = await pool.query(
      `
        SELECT id, name, display_name, description, capability_type, scopes, risk_level,
               status, provider_id, source, invocation_type, policy_config, connection_required
        FROM cap_capabilities
        ORDER BY name ASC
      `,
    );
    return Response.json({
      ok: true,
      items: result.rows.map((row) =>
        sanitizeAgentResponse({
          id: String(row.id),
          name: String(row.name),
          display_name: row.display_name ? String(row.display_name) : String(row.name),
          description: String(row.description ?? ""),
          capability_type: String(row.capability_type),
          required_scopes: Array.isArray(row.scopes) ? row.scopes : [],
          risk_level: String(row.risk_level),
          status: String(row.status),
          provider_id: row.provider_id ? String(row.provider_id) : null,
          source: row.source ? String(row.source) : null,
          invocation_type: row.invocation_type ? String(row.invocation_type) : null,
          policy_config: row.policy_config ?? {},
          connection_required: Boolean(row.connection_required),
        }),
      ),
    });
  }
  return null;
}

export async function handleV26AgentInvokeOnly(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/v2.6/agent/capabilities") {
    const agent = await requireAgentFromRequest(request);
    const items = await agentAuthorizationV25Service.listCapabilitiesForAgent(agent);
    return Response.json(sanitizeAgentResponse({ ok: true, items }));
  }

  if (request.method === "POST" && path === "/v2.6/agent/authorizations") {
    const agent = await requireAgentFromRequest(request);
    const body = await parseJsonBody(request);
    const apiBaseUrl = inferBaseUrl(request);
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
    path.startsWith("/v2.6/agent/authorizations/")
  ) {
    const agent = await requireAgentFromRequest(request);
    const authorizationId = decodeURIComponent(path.split("/").pop() ?? "");
    const result = await agentAuthorizationV25Service.getAuthorizationStatus(authorizationId, agent);
    return Response.json(result);
  }

  if (request.method === "POST" && path === "/v2.6/agent/invoke") {
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

  return Response.json(
    { error: { type: "NotFoundError", message: `Route not found: ${path}` } },
    { status: 404 },
  );
}
