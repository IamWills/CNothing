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
import { providerProposalService } from "../v3/provider-proposal.service";
import { secretVaultService } from "../v3/secret-vault.service";
import { deviceFlowService } from "../v3/device-flow.service";
import { getV3PlatformStatus } from "../v3/v3-platform.service";
import { assertSafePublicUrlWithDns } from "../v3/url-safety.service";
import { resolveConnectionTenant } from "../v3/tenant-context.service";
import { revokeGrant } from "../v2/v2.repository";
import { normalizeTenantId } from "../v3/tenant-context.service";
import type { ProviderProposalInput } from "../v3/v3.entity";
import type { AgentRecord } from "../v2/v2.entity";

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
    openapi_url: typeof body.openapi_url === "string" ? body.openapi_url : undefined,
    mcp_url: typeof body.mcp_url === "string" ? body.mcp_url : undefined,
    scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    logo_url: typeof body.logo_url === "string" ? body.logo_url : undefined,
    api_base_url: typeof body.api_base_url === "string" ? body.api_base_url : undefined,
    risk_suggestion: typeof body.risk_suggestion === "string" ? body.risk_suggestion : undefined,
    slug: typeof body.slug === "string" ? body.slug : undefined,
  };
}

export async function handleV3PlatformRequest(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/v3/platform/status") {
    return Response.json({ ok: true, ...(await getV3PlatformStatus()) });
  }
  return null;
}

export async function handleV3ProviderRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);

  if (request.method === "POST" && path === "/v3/providers/proposals") {
    const agent = await requireAgentFromRequest(request);
    const body = await parseJsonBody(request);
    const apiBaseUrl = inferBaseUrl(request);
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
    segments[0] === "v3" &&
    segments[1] === "providers" &&
    segments[2] === "proposals"
  ) {
    const agent = await requireAgentFromRequest(request);
    const proposalId = decodeURIComponent(segments[3] ?? "");
    const proposal = await providerProposalService.getProposal({
      agent,
      proposalId,
    });
    return Response.json(sanitizeAgentResponse({ ok: true, proposal }));
  }

  if (request.method === "GET" && path === "/v3/providers") {
    const items = await oauthProviderService.listPublicProviders();
    return Response.json(sanitizeAgentResponse({ ok: true, items }));
  }

  if (
    request.method === "GET" &&
    segments.length === 3 &&
    segments[0] === "v3" &&
    segments[1] === "providers"
  ) {
    const provider = await oauthProviderService.getProvider(decodeURIComponent(segments[2] ?? ""));
    return Response.json(sanitizeAgentResponse({ ok: true, provider }));
  }

  return null;
}

export async function handleV3OAuthRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);
  const apiBaseUrl = inferBaseUrl(request);

  if (request.method === "POST" && path === "/v3/oauth/connect/start") {
    const session = await requireUserSession(request);
    const body = await parseJsonBody(request);
    const tenantId = resolveConnectionTenant({
      request,
      explicitTenantId: typeof body.tenant_id === "string" ? body.tenant_id : undefined,
    });
    const result = await oauthConnectionService.startConnect({
      providerId: typeof body.provider_id === "string" ? body.provider_id : undefined,
      providerSlug: typeof body.provider_slug === "string" ? body.provider_slug : undefined,
      userId: session.user_id,
      apiBaseUrl,
      redirectAfter: typeof body.redirect_after === "string" ? body.redirect_after : undefined,
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : undefined,
      oauthApiVersion: "v3",
      tenantId,
    });
    return Response.json(result);
  }

  if (request.method === "POST" && path === "/v3/oauth/device/start") {
    const session = await requireUserSession(request);
    const body = await parseJsonBody(request);
    const result = await deviceFlowService.startDeviceFlow({
      request,
      providerId: typeof body.provider_id === "string" ? body.provider_id : undefined,
      providerSlug: typeof body.provider_slug === "string" ? body.provider_slug : undefined,
      userId: session.user_id,
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : undefined,
      tenantId: typeof body.tenant_id === "string" ? body.tenant_id : undefined,
    });
    return Response.json(result, { status: 201 });
  }

  if (request.method === "POST" && path === "/v3/oauth/device/poll") {
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
    request.method === "GET" &&
    segments.length === 4 &&
    segments[0] === "v3" &&
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
      oauthApiVersion: "v3",
    });
    return Response.redirect(result.redirect_url, 302);
  }

  if (request.method === "GET" && path === "/v3/oauth/connections") {
    const session = await requireUserSession(request);
    const tenantId = resolveConnectionTenant({ request });
    const items = await oauthConnectionService.listConnections(session.user_id, tenantId);
    return Response.json({ ok: true, items });
  }

  if (
    request.method === "DELETE" &&
    segments.length === 4 &&
    segments[0] === "v3" &&
    segments[1] === "oauth" &&
    segments[2] === "connections"
  ) {
    const session = await requireUserSession(request);
    const connectionId = decodeURIComponent(segments[3] ?? "");
    await oauthConnectionService.revokeConnection(connectionId, session.user_id);
    return Response.json({ ok: true });
  }

  return null;
}

async function fetchSafeUrlContent(url: string): Promise<string> {
  await assertSafePublicUrlWithDns(url, "url");
  const response = await fetch(url);
  if (!response.ok) {
    throw new ValidationError(`Failed to fetch URL (${response.status})`);
  }
  return response.text();
}

export async function handleV3ImportRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);

  const resolveAuth = async (): Promise<{ agent?: AgentRecord; isAdmin: boolean }> => {
    const authHeader = request.headers.get("authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
      try {
        const agent = await requireAgentFromRequest(request);
        return { agent, isAdmin: false };
      } catch {
        requireAdminAccess(request);
        return { isAdmin: true };
      }
    }
    requireAdminAccess(request);
    return { isAdmin: true };
  };

  if (request.method === "POST" && path === "/v3/import/openapi") {
    await resolveAuth();
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
        content = await fetchSafeUrlContent(body.url);
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

  if (request.method === "POST" && path === "/v3/import/mcp") {
    await resolveAuth();
    const body = await parseJsonBody(request);
    let manifest: Record<string, unknown>;
    if (typeof body.url === "string") {
      const content = await fetchSafeUrlContent(body.url);
      manifest = JSON.parse(content) as Record<string, unknown>;
    } else {
      manifest = (body.manifest as Record<string, unknown>) ?? (body as Record<string, unknown>);
    }
    const job = await importMcpManifest({
      manifest,
      providerId: typeof body.provider_id === "string" ? body.provider_id : undefined,
      providerSlug: typeof body.provider_slug === "string" ? body.provider_slug : undefined,
    });
    return Response.json({ ok: true, job: sanitizeImportJob(job) }, { status: 201 });
  }

  if (
    request.method === "GET" &&
    segments.length === 4 &&
    segments[0] === "v3" &&
    segments[1] === "import"
  ) {
    await resolveAuth();
    const importType = segments[2];
    const jobId = decodeURIComponent(segments[3] ?? "");
    const job = await findImportJob(jobId);
    if (!job || (importType !== "openapi" && importType !== "mcp")) {
      throw new NotFoundError("Import job not found");
    }
    return Response.json({ ok: true, job: sanitizeImportJob(job) });
  }

  if (request.method === "POST" && path === "/v3/capabilities/generate-from-openapi") {
    requireUserSession(request);
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

  if (request.method === "POST" && path === "/v3/capabilities/generate-from-mcp") {
    requireUserSession(request);
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

  return null;
}

export async function handleV3AdminRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);

  if (request.method === "GET" && path === "/v3/admin/vault/secrets") {
    requireAdminAccess(request);
    const ownerType = url.searchParams.get("owner_type");
    const ownerId = url.searchParams.get("owner_id");
    if (!ownerType || !ownerId) {
      throw new ValidationError("owner_type and owner_id query parameters are required");
    }
    const items = await secretVaultService.listSecretMetadata({
      owner_type: ownerType as "provider" | "connection" | "user" | "agent" | "system",
      owner_id: ownerId,
    });
    return Response.json({ ok: true, items });
  }

  if (request.method === "GET" && path === "/v3/capabilities") {
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
          scopes: Array.isArray(row.scopes) ? row.scopes : [],
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

  if (request.method === "POST" && path === "/v3/agents/register") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const { createAgent } = await import("../v2/v2.repository");
    const created = await createAgent({
      name: readRequiredString(body, "name"),
      owner_user_id: readRequiredString(body, "owner_user_id"),
      tenant_id:
        typeof body.tenant_id === "string" ? normalizeTenantId(body.tenant_id) : undefined,
      public_key_pem: typeof body.public_key_pem === "string" ? body.public_key_pem : undefined,
      metadata: readOptionalObject(body, "metadata"),
    });
    return Response.json({
      ok: true,
      agent: {
        id: created.agent.id,
        name: created.agent.name,
        owner_user_id: created.agent.owner_user_id,
        tenant_id: created.agent.tenant_id,
        status: created.agent.status,
        created_at: created.agent.created_at,
        updated_at: created.agent.updated_at,
        public_key_pem: created.agent.public_key_pem,
        metadata: created.agent.metadata,
      },
      access_token: created.access_token,
    });
  }

  if (request.method === "GET" && path === "/v3/agents") {
    requireAdminAccess(request);
    const { listAgents } = await import("../v2/v2.repository");
    const ownerUserId = url.searchParams.get("owner_user_id")?.trim() || undefined;
    const tenantId = url.searchParams.get("tenant_id")?.trim() || undefined;
    const items = await listAgents({
      owner_user_id: ownerUserId,
      tenant_id: tenantId ? normalizeTenantId(tenantId) : undefined,
    });
    return Response.json({ ok: true, items });
  }

  if (request.method === "POST" && path === "/v3/grants") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const { createGrant, findAgentById, findCapabilityByName } = await import("../v2/v2.repository");
    const capabilityName = readRequiredString(body, "capability");
    const capability = await findCapabilityByName(capabilityName);
    if (!capability) {
      throw new ValidationError(`Capability not found: ${capabilityName}`, {
        error_code: "capability_not_found",
      });
    }
    const agentId = readRequiredString(body, "agent_id");
    const agent = await findAgentById(agentId);
    if (!agent) {
      throw new NotFoundError("Agent not found");
    }
    const grant = await createGrant({
      user_id: readRequiredString(body, "user_id"),
      agent_id: agentId,
      capability_id: capability.id,
      tenant_id: agent.tenant_id,
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : capability.scopes,
      expires_at: typeof body.expires_at === "string" ? body.expires_at : undefined,
      metadata: readOptionalObject(body, "metadata"),
      provider_id: typeof body.provider_id === "string" ? body.provider_id : undefined,
      connection_id: typeof body.connection_id === "string" ? body.connection_id : undefined,
      grant_status: "approved",
    });
    return Response.json({
      ok: true,
      grant: {
        ...grant,
        capability: capability.name,
        capability_name: capability.name,
        agent_name: agent.name,
        connector_provider: capability.name.split(".")[0] ?? "",
      },
    });
  }

  if (request.method === "GET" && path === "/v3/grants") {
    requireAdminAccess(request);
    const { listGrantSummaries } = await import("../v2/v2.repository");
    const tenantId = url.searchParams.get("tenant_id")?.trim() || undefined;
    const items = await listGrantSummaries({
      user_id: url.searchParams.get("user_id")?.trim() || undefined,
      agent_id: url.searchParams.get("agent_id")?.trim() || undefined,
      tenant_id: tenantId ? normalizeTenantId(tenantId) : undefined,
    });
    return Response.json({ ok: true, items });
  }

  if (request.method === "POST" && path === "/v3/grants/revoke") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const grant = await revokeGrant(readRequiredString(body, "grant_id"));
    return Response.json({ ok: true, grant });
  }

  if (request.method === "GET" && path === "/v3/audit") {
    requireAdminAccess(request);
    const { pool } = await import("../db");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const result = await pool.query(
      `
        SELECT id, event_type, agent_id, user_id, provider_id, capability_id,
               grant_id, policy_id, execution_id, latency_ms, result_hash, metadata, created_at
        FROM cap_trust_audit
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    );
    return Response.json({
      ok: true,
      items: result.rows.map((row) =>
        sanitizeAgentResponse({
          id: String(row.id),
          event_type: String(row.event_type),
          agent_id: row.agent_id ? String(row.agent_id) : null,
          user_id: row.user_id ? String(row.user_id) : null,
          provider_id: row.provider_id ? String(row.provider_id) : null,
          capability_id: row.capability_id ? String(row.capability_id) : null,
          grant_id: row.grant_id ? String(row.grant_id) : null,
          policy_id: row.policy_id ? String(row.policy_id) : null,
          execution_id: row.execution_id ? String(row.execution_id) : null,
          latency_ms: row.latency_ms ? Number(row.latency_ms) : null,
          result_hash: row.result_hash ? String(row.result_hash) : null,
          metadata: row.metadata ?? {},
          created_at: String(row.created_at),
        }),
      ),
    });
  }

  return null;
}

export async function handleV3AuthPlatformRequest(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  const isAuthPlatformRoute =
    path === "/v3/auth/providers" ||
    path === "/v3/auth/oidc/providers" ||
    path.startsWith("/v3/auth/github/") ||
    (path.startsWith("/v3/auth/oidc/") && (path.endsWith("/start") || path.endsWith("/callback")));

  if (!isAuthPlatformRoute) {
    return null;
  }

  const { handleV2PlatformRequest } = await import("./v2-platform.api");
  return handleV2PlatformRequest(rewriteRequestPath(request, "/v3/", "/v2/"));
}

export async function handleV3SessionRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);

  const exactSessionRoutes = new Set([
    "/v3/auth/login",
    "/v3/auth/logout",
    "/v3/auth/me",
    "/v3/auth/login-tokens",
    "/v3/authorize/approve",
    "/v3/authorize/deny",
    "/v3/confirmations/pending",
    "/v3/confirmations/approve",
    "/v3/confirmations/reject",
  ]);

  const isAuthorizeGet =
    request.method === "GET" &&
    segments.length === 3 &&
    segments[0] === "v3" &&
    segments[1] === "authorize";

  if (!exactSessionRoutes.has(path) && !isAuthorizeGet) {
    return null;
  }

  const { handleV2Request } = await import("./v2.api");
  return handleV2Request(rewriteRequestPath(request, "/v3/", "/v2/"));
}

export async function handleV3ApproveRequest(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (request.method !== "POST" || !path.startsWith("/v3/approve/")) {
    return null;
  }
  const { handleV25ApproveRequest } = await import("./v2.5.api");
  const rewritten = new URL(request.url);
  rewritten.pathname = path.replace("/v3/approve/", "/v2/approve/");
  return handleV25ApproveRequest(new Request(rewritten, request));
}

export async function handleV3AgentRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/v3/agent/capabilities") {
    const agent = await requireAgentFromRequest(request);
    const items = await agentAuthorizationV25Service.listCapabilitiesForAgent(agent);
    return Response.json(sanitizeAgentResponse({ ok: true, items }));
  }

  if (request.method === "POST" && path === "/v3/agent/authorizations") {
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

  if (request.method === "GET" && path.startsWith("/v3/agent/authorizations/")) {
    const agent = await requireAgentFromRequest(request);
    const authorizationId = decodeURIComponent(path.split("/").pop() ?? "");
    const result = await agentAuthorizationV25Service.getAuthorizationStatus(authorizationId, agent);
    return Response.json(result);
  }

  if (request.method === "GET" && path === "/v3/agent/grants") {
    const agent = await requireAgentFromRequest(request);
    const items = await agentAuthorizationV25Service.listGrantsForAgent(agent.id);
    return Response.json(sanitizeAgentResponse({ ok: true, items }));
  }

  if (request.method === "POST" && path === "/v3/agent/grants/revoke") {
    const agent = await requireAgentFromRequest(request);
    const body = await parseJsonBody(request);
    const grantId = readRequiredString(body, "grant_id");
    const revoked = await revokeGrant(grantId);
    if (!revoked || revoked.agent_id !== agent.id) {
      throw new NotFoundError("Grant not found for this agent");
    }
    return Response.json(sanitizeAgentResponse({ ok: true, grant_id: grantId, status: "revoked" }));
  }

  if (request.method === "POST" && path === "/v3/agent/invoke") {
    const agent = await requireAgentFromRequest(request);
    const body = await parseJsonBody(request);
    try {
      // Prefer v3 capability gateway (approval_policy / idempotency / sanitized contract).
      // Fall back to legacy confirmation flow when confirmation_id is present.
      if (typeof body.confirmation_id === "string" && body.confirmation_id.trim()) {
        const result = await invocationGatewayService.invoke({
          agent,
          body: {
            capability: readRequiredString(body, "capability"),
            input: readOptionalObject(body, "input"),
            reason: typeof body.reason === "string" ? body.reason : undefined,
            confirmation_id: body.confirmation_id,
            request_id: typeof body.request_id === "string" ? body.request_id : undefined,
          },
        });
        if ("pending" in result && result.pending) {
          return Response.json(sanitizeAgentResponse(result), { status: 202 });
        }
        return Response.json(result);
      }

      const { invokeViaLegacyAgentApi } = await import("../v3/invocation/capability-invocation.gateway");
      const result = await invokeViaLegacyAgentApi({
        agent,
        capability: readRequiredString(body, "capability"),
        user_id: typeof body.user_id === "string" ? body.user_id : undefined,
        payload: readOptionalObject(body, "input"),
        request,
      });
      if (
        result &&
        typeof result === "object" &&
        "pending_approval" in result &&
        (result as { pending_approval?: boolean }).pending_approval
      ) {
        return Response.json(sanitizeAgentResponse(result), { status: 202 });
      }
      return Response.json(sanitizeAgentResponse(result));
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

  return null;
}

export async function handleV3Request(request: Request): Promise<Response | null> {
  const handlers = [
    handleV3PlatformRequest,
    handleV3ProviderRequest,
    handleV3OAuthRequest,
    handleV3ImportRequest,
    handleV3AdminRequest,
    handleV3AuthPlatformRequest,
    handleV3SessionRequest,
    handleV3ApproveRequest,
    handleV3AgentRequest,
  ];

  for (const handler of handlers) {
    const response = await handler(request);
    if (response) {
      return response;
    }
  }

  return null;
}
