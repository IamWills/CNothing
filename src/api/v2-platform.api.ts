import { requireAdminAccess } from "../admin/admin-auth";
import config from "../config";
import { ValidationError } from "../utils/errors";
import { parseJsonBody } from "../utils/http";
import { getV1SunsetDate, v1DeprecationMeta } from "../v2/deprecation";
import { kvMigrationService } from "../v2/kv-migration.service";
import { oidcService } from "../v2/oidc.service";
import { githubOAuthService } from "../v2/github-oauth.service";
import { listAuthProviders } from "../v2/auth-providers.service";
import { bootstrapV2Platform } from "../v2/platform-bootstrap.service";
import { readRequiredString } from "../v2/agent-auth";
import { listAgents, listCapabilities, listConnectors, listGrantSummaries } from "../v2/v2.repository";
import {
  getSearchLinkStatus,
  linkSearchAccountForUser,
} from "../v2/search-credential.service";
import { bootstrapSearchConnector, ensureSearchGrantsForUser } from "../v2/search-bootstrap.service";
import { isSearchIntegrationEnabled } from "../v2/search-api.client";
import { requireUserSession } from "../v2/user-session";

function inferBaseUrl(request: Request): string {
  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("Host") || requestUrl.host;
  const proto = forwardedProto || requestUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

export async function handleV2PlatformRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const baseUrl = inferBaseUrl(request);

  if (request.method === "GET" && path === "/v2/platform/status") {
    const [agents, capabilities, connectors, grants, authProviders] = await Promise.all([
      listAgents(),
      listCapabilities(),
      listConnectors(),
      listGrantSummaries(),
      listAuthProviders(baseUrl),
    ]);

    return Response.json({
      ok: true,
      platform: {
        name: config.serviceName,
        version: "2.0.0",
        primary_api: "/v2/capabilities/invoke",
        openapi: `${baseUrl}/openapi-v2.json`,
        jwks: `${baseUrl}/v2/jwks`,
      },
      v1: v1DeprecationMeta(baseUrl),
      auth: {
        providers: authProviders.items,
        github_oauth: githubOAuthService.isEnabled(),
        auto_bootstrap: config.v2AutoBootstrap,
        auto_grant_low_risk: config.autoGrantLowRiskCapabilities,
        platform_agent: config.platformAgentName,
        search: {
          enabled: isSearchIntegrationEnabled(),
          api_url: config.searchApiBaseUrl ?? null,
          auto_bootstrap: config.searchAutoBootstrap,
        },
      },
      counts: {
        agents: agents.length,
        capabilities: capabilities.length,
        connectors: connectors.length,
        active_grants: grants.length,
      },
    });
  }

  if (request.method === "GET" && path === "/v2/platform/migration") {
    return Response.json(kvMigrationService.getMigrationGuide());
  }

  if (request.method === "GET" && path === "/v2/auth/providers") {
    return Response.json(await listAuthProviders(baseUrl));
  }

  if (request.method === "GET" && path === "/v2/auth/oidc/providers") {
    return Response.json(await oidcService.listPublicProviders());
  }

  if (request.method === "GET" && path === "/v2/auth/github/start") {
    const redirectAfter = url.searchParams.get("redirect_after")?.trim() || undefined;
    const result = await githubOAuthService.startAuthorization({
      apiBaseUrl: baseUrl,
      redirectAfter,
    });
    return Response.redirect(result.authorization_url, 302);
  }

  if (request.method === "GET" && path === "/v2/auth/github/callback") {
    const code = url.searchParams.get("code")?.trim();
    const state = url.searchParams.get("state")?.trim();
    if (!code || !state) {
      throw new ValidationError("code and state are required", { error_code: "missing_field" });
    }
    const result = await githubOAuthService.handleCallback({
      code,
      state,
      apiBaseUrl: baseUrl,
    });
    return Response.redirect(result.redirect_url, 302);
  }

  if (
    request.method === "GET" &&
    path.startsWith("/v2/auth/oidc/") &&
    path.endsWith("/start")
  ) {
    const segments = path.split("/").filter(Boolean);
    const providerName = decodeURIComponent(segments[3] ?? "");
    const redirectAfter = url.searchParams.get("redirect_after")?.trim() || undefined;
    const result = await oidcService.startAuthorization({
      providerName,
      apiBaseUrl: baseUrl,
      redirectAfter,
    });
    return Response.redirect(result.authorization_url, 302);
  }

  if (
    request.method === "GET" &&
    path.startsWith("/v2/auth/oidc/") &&
    path.endsWith("/callback")
  ) {
    const segments = path.split("/").filter(Boolean);
    const providerName = decodeURIComponent(segments[3] ?? "");
    const code = url.searchParams.get("code")?.trim();
    const state = url.searchParams.get("state")?.trim();
    if (!code || !state) {
      throw new ValidationError("code and state are required", { error_code: "missing_field" });
    }

    const result = await oidcService.handleCallback({
      providerName,
      code,
      state,
      apiBaseUrl: baseUrl,
    });

    const redirectTarget =
      result.redirect_after ||
      config.consoleUrl ||
      `${baseUrl.replace(/\/+$/, "")}/login?session=${encodeURIComponent(result.session_token)}&user_id=${encodeURIComponent(result.user_id)}`;

    const redirectUrl = new URL(redirectTarget);
    redirectUrl.searchParams.set("session_token", result.session_token);
    redirectUrl.searchParams.set("user_id", result.user_id);
    return Response.redirect(redirectUrl.toString(), 302);
  }

  if (request.method === "GET" && path === "/v2/admin/migration/kv-inventory") {
    requireAdminAccess(request);
    const limit = Number(url.searchParams.get("limit") ?? "500");
    return Response.json(await kvMigrationService.getInventory(limit));
  }

  if (request.method === "POST" && path === "/v2/admin/migration/kv-to-credential") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const result = await kvMigrationService.migrateRecordToCredential({
      client_uuid: readRequiredString(body, "client_uuid"),
      namespace: readRequiredString(body, "namespace"),
      record_key: readRequiredString(body, "record_key"),
      connector_id: readRequiredString(body, "connector_id"),
      owner_user_id: readRequiredString(body, "owner_user_id"),
    });
    return Response.json(result);
  }

  if (request.method === "POST" && path === "/v2/admin/platform/bootstrap") {
    requireAdminAccess(request);
    const body = (await parseJsonBody(request).catch(() => ({}))) as Record<string, unknown>;
    const result = await bootstrapV2Platform({
      apiBaseUrl: baseUrl,
      force: body.force === true,
    });
    return Response.json(result);
  }

  if (request.method === "POST" && path === "/v2/admin/search/bootstrap") {
    requireAdminAccess(request);
    const result = await bootstrapSearchConnector({ apiBaseUrl: baseUrl });
    return Response.json(result);
  }

  if (request.method === "GET" && path === "/v2/auth/search/status") {
    const session = await requireUserSession(request);
    return Response.json({
      ok: true,
      user_id: session.user_id,
      ...(await getSearchLinkStatus(session.user_id)),
    });
  }

  if (request.method === "POST" && path === "/v2/auth/search/link") {
    const session = await requireUserSession(request);
    const body = (await parseJsonBody(request).catch(() => ({}))) as Record<string, unknown>;
    const label = typeof body.label === "string" ? body.label.trim() : undefined;
    const result = await linkSearchAccountForUser({
      userId: session.user_id,
      label,
    });
    const granted = await ensureSearchGrantsForUser(session.user_id);
    return Response.json({ ...result, grants: granted });
  }

  if (request.method === "POST" && path === "/v2/admin/search/link") {
    requireAdminAccess(request);
    const body = await parseJsonBody(request);
    const userId = readRequiredString(body, "user_id");
    const label = typeof body.label === "string" ? body.label.trim() : undefined;
    const result = await linkSearchAccountForUser({ userId, label });
    const granted = await ensureSearchGrantsForUser(userId);
    return Response.json({ ...result, grants: granted });
  }

  if (request.method === "POST" && path === "/v2/admin/oidc/providers") {
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

  throw new ValidationError(`Unsupported route: ${request.method} ${path}`, {
    error_code: "route_not_found",
  });
}

export { getV1SunsetDate };
