import { requireAdminAccess } from "../admin/admin-auth";
import config from "../config";
import { NotFoundError, ValidationError } from "../utils/errors";
import { parseJsonBody } from "../utils/http";
import {
  readOptionalObject,
  readRequiredString,
  requireAgentFromRequest,
} from "../v2/agent-auth";
import { requireAuthorizationActor, requireAuthorizationActorForRequest } from "../v2/authorization-actor";
import { resolveAuthorizationUserId } from "../v2/authorization-user";
import { AuthorizationService } from "../v2/authorization-service";
import { CapabilityService } from "../v2/capability-service";
import { linkSearchAccountForUser } from "../v2/search-credential.service";
import { buildUserSessionCookie, clearUserSessionCookie } from "../v2/session-cookie";
import { getCapabilityGrantJwks, getIssuerMetadata } from "../v2/jwks";
import {
  isAdminRequest,
  readRequiredLoginFields,
  requireUserSession,
  userSessionService,
} from "../v2/user-session";
import {
  confirmPendingConfirmation,
  createAgent,
  createCapability,
  createConnector,
  createGrant,
  findAgentById,
  findAuthorizationRequest,
  findCapabilityByName,
  findPendingConfirmation,
  listAgents,
  listCapabilities,
  listConnectors,
  listGrantSummaries,
  listInvokeAudit,
  listPendingConfirmations,
  rejectPendingConfirmation,
  revokeGrant,
} from "../v2/v2.repository";

const capabilityService = new CapabilityService();
const authorizationService = new AuthorizationService();

function readStringArray(body: Record<string, unknown>, field: string): string[] | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array`, {
      error_code: "invalid_field",
      field,
    });
  }
  return value.map(String);
}

function readRequiredStringArray(body: Record<string, unknown>, field: string): string[] {
  const value = readStringArray(body, field);
  if (!value || value.length === 0) {
    throw new ValidationError(`${field} is required`, {
      error_code: "missing_field",
      field,
    });
  }
  return value;
}

function inferBaseUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("Host") || requestUrl.host;
  const proto = forwardedProto || requestUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

function mapAuthorizationStatus(view: Awaited<ReturnType<AuthorizationService["getRequestView"]>>) {
  return {
    id: view.id,
    status: view.status,
    user_id: view.user_id,
    agent_id: view.agent_id,
    agent_name: view.agent_name,
    requested_capabilities: view.requested_capabilities,
    granted_capabilities: view.granted_capabilities,
    expires_at: view.expires_at,
    approved_at: view.approved_at,
    denied_at: view.denied_at,
    redirect_uri: view.redirect_uri,
    state: view.state,
    reason: view.reason,
    capabilities: view.capabilities,
  };
}

export async function handleV2Request(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const segments = path.split("/").filter(Boolean);

  if (request.method === "GET" && path === "/v2/jwks") {
    return Response.json(getCapabilityGrantJwks(), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }

  if (request.method === "GET" && path === "/v2/.well-known/openid-configuration") {
    return Response.json(getIssuerMetadata(inferBaseUrl(request)), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }

  if (request.method === "POST" && path === "/v2/auth/login") {
    const body = await parseJsonBody(request);
    const { userId, loginToken } = readRequiredLoginFields(body);
    const result = await userSessionService.login({ userId, loginToken });
    return Response.json(result, {
      headers: {
        "Set-Cookie": buildUserSessionCookie(result.session_token),
      },
    });
  }

  if (request.method === "POST" && path === "/v2/auth/logout") {
    const result = await userSessionService.logout(request);
    return Response.json(result, {
      headers: {
        "Set-Cookie": clearUserSessionCookie(),
      },
    });
  }

  if (request.method === "GET" && path === "/v2/auth/me") {
    return Response.json(await userSessionService.me(request));
  }

  if (request.method === "POST" && path === "/v2/auth/login-tokens") {
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

  if (request.method === "POST" && path === "/v2/capabilities/invoke") {
    const agent = await requireAgentFromRequest(request);
    const body = await parseJsonBody(request);
    const result = await capabilityService.invoke({
      agent,
      body: {
        capability: readRequiredString(body, "capability"),
        input: readOptionalObject(body, "input"),
        user_id: typeof body.user_id === "string" ? body.user_id : undefined,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        confirmation_id:
          typeof body.confirmation_id === "string" ? body.confirmation_id : undefined,
        request_id: typeof body.request_id === "string" ? body.request_id : undefined,
      },
    });

    if ("pending" in result && result.pending) {
      return Response.json(result, { status: 202 });
    }

    return Response.json(result);
  }

  if (request.method === "GET" && path === "/v2/capabilities") {
    const items = await listCapabilities();
    return Response.json({
      ok: true,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        connector_id: item.connector_id,
        capability_type: item.capability_type,
        scopes: item.scopes,
        risk_level: item.risk_level,
        input_schema: item.input_schema,
        output_schema: item.output_schema,
        provider_id: item.provider_id,
        display_name: item.display_name,
        connection_required: item.connection_required,
        source: item.source,
        invocation_type: item.invocation_type,
        invocation_config: item.invocation_config,
        policy_config: item.policy_config,
        status: item.status,
      })),
    });
  }

  if (request.method === "GET" && segments.length === 3 && segments[0] === "v2" && segments[1] === "capabilities") {
    const capability = await findCapabilityByName(decodeURIComponent(segments[2] ?? ""));
    if (!capability) {
      return Response.json(
        { error: { type: "NotFoundError", message: "Capability not found" } },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, capability });
  }

  if (request.method === "GET" && path === "/v2/connectors") {
    const items = await listConnectors();
    return Response.json({
      ok: true,
      items: items.map((item) => ({
        id: item.id,
        provider: item.provider,
        display_name: item.display_name,
        callback_url: item.callback_url,
        jwks_url: item.jwks_url,
        status: item.status,
      })),
    });
  }

  if (request.method === "POST" && path === "/v2/authorize/request") {
    const agent = await requireAgentFromRequest(request);
    const body = await parseJsonBody(request);
    const capabilities = readRequiredStringArray(body, "capabilities");
    const userId =
      typeof body.user_id === "string" && body.user_id.trim()
        ? body.user_id.trim()
        : resolveAuthorizationUserId(undefined);

    const result = await authorizationService.createRequest({
      agentId: agent.id,
      userId,
      capabilities,
      redirectUri: typeof body.redirect_uri === "string" ? body.redirect_uri : undefined,
      state: typeof body.state === "string" ? body.state : undefined,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      consoleBaseUrl: config.consoleUrl,
      apiBaseUrl: inferBaseUrl(request),
    });

    return Response.json(result, { status: 201 });
  }

  if (request.method === "GET" && segments.length === 3 && segments[0] === "v2" && segments[1] === "authorize") {
    const requestId = decodeURIComponent(segments[2] ?? "");
    const view = await authorizationService.getRequestView(requestId);
    return Response.json({
      ok: true,
      authorization_request: mapAuthorizationStatus(view),
    });
  }

  if (request.method === "POST" && path === "/v2/authorize/approve") {
    const body = await parseJsonBody(request);
    const requestId = readRequiredString(body, "authorization_request_id");
    const authRequest = await findAuthorizationRequest(requestId);
    if (!authRequest) {
      throw new NotFoundError("Authorization request not found");
    }
    const actor = await requireAuthorizationActorForRequest(request, authRequest);
    const boundUserId = actor.kind === "user" ? actor.session.user_id : undefined;
    const result = await authorizationService.approveRequest({
      id: requestId,
      grantedCapabilities: readStringArray(body, "granted_capabilities"),
      grantExpiresAt: typeof body.grant_expires_at === "string" ? body.grant_expires_at : undefined,
      boundUserId,
    });

    if (boundUserId && result.grants.some((grant) => String(grant.capability).startsWith("search."))) {
      try {
        await linkSearchAccountForUser({ userId: boundUserId });
      } catch {
        // Search link is best-effort during authorization; invoke will prompt if still missing.
      }
    }

    return Response.json(result);
  }

  if (request.method === "POST" && path === "/v2/authorize/deny") {
    const body = await parseJsonBody(request);
    const requestId = readRequiredString(body, "authorization_request_id");
    const authRequest = await findAuthorizationRequest(requestId);
    if (!authRequest) {
      throw new NotFoundError("Authorization request not found");
    }
    await requireAuthorizationActorForRequest(request, authRequest);
    const result = await authorizationService.denyRequest(requestId);
    return Response.json(result);
  }

  if (request.method === "POST" && path === "/v2/agents/register") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const created = await createAgent({
      name: readRequiredString(body, "name"),
      owner_user_id: readRequiredString(body, "owner_user_id"),
      tenant_id: typeof body.tenant_id === "string" ? body.tenant_id : undefined,
      public_key_pem:
        typeof body.public_key_pem === "string" ? body.public_key_pem : undefined,
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
      },
      access_token: created.access_token,
    });
  }

  if (request.method === "GET" && path === "/v2/agents") {
    requireAdminAccess(request);
    const ownerUserId = url.searchParams.get("owner_user_id")?.trim() || undefined;
    const tenantId = url.searchParams.get("tenant_id")?.trim() || undefined;
    const items = await listAgents({
      owner_user_id: ownerUserId,
      tenant_id: tenantId,
    });
    return Response.json({ ok: true, items });
  }

  if (request.method === "GET" && segments.length === 3 && segments[0] === "v2" && segments[1] === "agents") {
    requireAdminAccess(request);
    const agent = await findAgentById(decodeURIComponent(segments[2] ?? ""));
    if (!agent) {
      return Response.json({ error: { type: "NotFoundError", message: "Agent not found" } }, { status: 404 });
    }
    return Response.json({ ok: true, agent });
  }

  if (request.method === "POST" && path === "/v2/connectors/register") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const connector = await createConnector({
      provider: readRequiredString(body, "provider"),
      display_name: readRequiredString(body, "display_name"),
      callback_url: readRequiredString(body, "callback_url"),
      public_key_pem:
        typeof body.public_key_pem === "string" ? body.public_key_pem : undefined,
      jwks_url: typeof body.jwks_url === "string" ? body.jwks_url : undefined,
      metadata: readOptionalObject(body, "metadata"),
    });
    return Response.json({ ok: true, connector });
  }

  if (request.method === "POST" && path === "/v2/capabilities/register") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const capability = await createCapability({
      connector_id: readRequiredString(body, "connector_id"),
      name: readRequiredString(body, "name"),
      description: typeof body.description === "string" ? body.description : undefined,
      capability_type:
        typeof body.capability_type === "string"
          ? (body.capability_type as "ACTION" | "QUERY" | "CONFIDENTIAL_QUERY")
          : undefined,
      input_schema: readOptionalObject(body, "input_schema"),
      output_schema: readOptionalObject(body, "output_schema"),
      scopes: readStringArray(body, "scopes"),
      risk_level:
        typeof body.risk_level === "string"
          ? (body.risk_level as "PUBLIC" | "LOW" | "MEDIUM" | "HIGH" | "CONFIDENTIAL")
          : undefined,
      metadata: readOptionalObject(body, "metadata"),
    });
    return Response.json({ ok: true, capability });
  }

  if (request.method === "POST" && path === "/v2/grants") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const capabilityName = readRequiredString(body, "capability");
    const capability = await findCapabilityByName(capabilityName);
    if (!capability) {
      throw new ValidationError(`Capability not found: ${capabilityName}`, {
        error_code: "capability_not_found",
      });
    }
    const grant = await createGrant({
      user_id: readRequiredString(body, "user_id"),
      agent_id: readRequiredString(body, "agent_id"),
      capability_id: capability.id,
      scopes: readStringArray(body, "scopes") ?? capability.scopes,
      expires_at: typeof body.expires_at === "string" ? body.expires_at : undefined,
      metadata: readOptionalObject(body, "metadata"),
    });
    return Response.json({
      ok: true,
      grant: {
        ...grant,
        capability: capability.name,
      },
    });
  }

  if (request.method === "GET" && path === "/v2/grants") {
    requireAdminAccess(request);
    const items = await listGrantSummaries({
      user_id: url.searchParams.get("user_id")?.trim() || undefined,
      agent_id: url.searchParams.get("agent_id")?.trim() || undefined,
    });
    return Response.json({ ok: true, items });
  }

  if (request.method === "POST" && path === "/v2/grants/revoke") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const grant = await revokeGrant(readRequiredString(body, "grant_id"));
    return Response.json({ ok: true, grant });
  }

  if (request.method === "GET" && path === "/v2/confirmations/pending") {
    let userId = url.searchParams.get("user_id")?.trim() || undefined;
    if (!isAdminRequest(request)) {
      const session = await requireUserSession(request);
      userId = session.user_id;
    } else {
      requireAdminAccess(request);
    }
    const items = await listPendingConfirmations({ user_id: userId });
    return Response.json({ ok: true, items });
  }

  if (request.method === "POST" && path === "/v2/confirmations/approve") {
    const body = await parseJsonBody(request);
    const confirmationId = readRequiredString(body, "confirmation_id");
    const pending = await findPendingConfirmation(confirmationId);
    if (!pending) {
      throw new NotFoundError("Confirmation request not found");
    }
    await requireAuthorizationActor(request, pending.user_id);
    const confirmed = await confirmPendingConfirmation(confirmationId);
    return Response.json({ ok: true, confirmation: confirmed });
  }

  if (request.method === "POST" && path === "/v2/confirmations/reject") {
    const body = await parseJsonBody(request);
    const confirmationId = readRequiredString(body, "confirmation_id");
    const pending = await findPendingConfirmation(confirmationId);
    if (!pending) {
      throw new NotFoundError("Confirmation request not found");
    }
    await requireAuthorizationActor(request, pending.user_id);
    const rejected = await rejectPendingConfirmation(confirmationId);
    return Response.json({ ok: true, confirmation: rejected });
  }

  if (request.method === "GET" && path === "/v2/audit") {
    requireAdminAccess(request);
    const items = await listInvokeAudit({
      limit: Number(url.searchParams.get("limit") ?? "50"),
      agent_id: url.searchParams.get("agent_id")?.trim() || undefined,
      user_id: url.searchParams.get("user_id")?.trim() || undefined,
    });
    return Response.json({ ok: true, items });
  }

  throw new ValidationError(`Unsupported route: ${request.method} ${path}`, {
    error_code: "route_not_found",
  });
}
