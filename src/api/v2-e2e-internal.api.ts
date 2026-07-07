import { requireAdminAccess } from "../admin/admin-auth";
import config from "../config";
import { ValidationError } from "../utils/errors";
import { agentAuthorizationV25Service } from "../v2/agent-authorization-v25.service";
import { createOAuthConnection, findOAuthProviderBySlug } from "../v2/oauth.repository";
import { parseJsonBody } from "../utils/http";
import { readRequiredString } from "../v2/agent-auth";

function assertE2eInternalEnabled(): void {
  if (!config.e2eInternalEnabled) {
    throw new ValidationError("E2E internal endpoints are disabled", {
      error_code: "e2e_internal_disabled",
    });
  }
}

export async function handleV2E2eInternalRequest(request: Request): Promise<Response> {
  assertE2eInternalEnabled();
  requireAdminAccess(request);

  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "POST" && path === "/v2/internal/e2e/seed-oauth-connection") {
    const body = await parseJsonBody(request);
    const userId = readRequiredString(body, "user_id");
    const providerSlug = readRequiredString(body, "provider_slug");
    const accessToken = readRequiredString(body, "access_token");
    const provider = await findOAuthProviderBySlug(providerSlug);
    if (!provider) {
      throw new ValidationError(`OAuth provider not found: ${providerSlug}`);
    }

    const connection = await createOAuthConnection({
      user_id: userId,
      provider_id: provider.id,
      provider_account_id:
        typeof body.account_id === "string" && body.account_id.trim()
          ? body.account_id.trim()
          : `e2e-${userId}`,
      display_name:
        typeof body.display_name === "string" && body.display_name.trim()
          ? body.display_name.trim()
          : `E2E ${providerSlug}`,
      access_token: accessToken,
      scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : provider.default_scopes,
      metadata: { source: "e2e_seed" },
    });

    return Response.json({
      ok: true,
      connection: {
        id: connection.id,
        provider_slug: providerSlug,
        user_id: userId,
      },
    });
  }

  if (request.method === "POST" && path === "/v2/internal/e2e/seed-device-flow-provider") {
    const body = await parseJsonBody(request);
    const mockBaseUrl = readRequiredString(body, "mock_base_url").replace(/\/+$/, "");
    const slug =
      typeof body.slug === "string" && body.slug.trim()
        ? body.slug.trim()
        : `e2e-device-${Date.now()}`;

    const { createOAuthProvider } = await import("../v2/oauth.repository");
    const provider = await createOAuthProvider({
      slug,
      display_name: "E2E Device Flow Mock",
      auth_type: "oauth2",
      authorization_url: `${mockBaseUrl}/authorize`,
      token_url: `${mockBaseUrl}/token`,
      userinfo_url: `${mockBaseUrl}/userinfo`,
      device_authorization_endpoint: `${mockBaseUrl}/device/code`,
      client_id: "e2e-device-client",
      client_secret: "e2e-device-secret",
      default_scopes: ["read"],
      supported_scopes: ["read"],
      pkce_required: false,
      token_auth_method: "client_secret_post",
    });

    return Response.json({
      ok: true,
      provider: {
        id: provider.id,
        slug: provider.slug,
      },
    });
  }

  if (request.method === "POST" && path === "/v2/internal/e2e/approve-authorization") {
    const body = await parseJsonBody(request);
    const result = await agentAuthorizationV25Service.approveWithConnection({
      authorizationId: readRequiredString(body, "authorization_id"),
      userId: readRequiredString(body, "user_id"),
      connectionId: readRequiredString(body, "connection_id"),
      grantedScopes: Array.isArray(body.scopes) ? body.scopes.map(String) : undefined,
    });
    return Response.json(result);
  }

  throw new ValidationError(`Unsupported E2E route: ${request.method} ${path}`, {
    error_code: "route_not_found",
  });
}
