import config from "../config";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errors";
import { assertSafePublicUrlWithDns } from "../v3/url-safety.service";
import { redactSecrets } from "../v2/secret-redaction";
import type { AgentRecord } from "../v2/v2.entity";
import type { OAuthConnectionRecord } from "../v2/v2.5.entity";
import {
  findOAuthConnectionById,
  findOAuthProviderById,
  findOAuthProviderBySlug,
  getConnectionAccessToken,
  touchOAuthConnection,
} from "../v2/oauth.repository";
import { oauthConnectionService } from "../v2/oauth-connection.service";
import {
  createProxyAccessRequest,
  createProxyGrant,
  decideProxyAccessRequest,
  findProxyAccessRequest,
  findProxyGrantById,
  listPendingAccessRequestsForUser,
  listProxyGrantsForAgent,
  listProxyGrantsForUser,
  revokeProxyGrant,
  touchProxyGrant,
  writeProxyRequestAudit,
  type ProxyGrantRecord,
} from "./proxy.repository";
import { sendApprovalPush } from "./apns.service";
import { dispatchAccessRequestCallback, validateCallbackUrl } from "./callback.service";
import { listActivePushDevices } from "./device.repository";

import {
  DEFAULT_ALLOWED_METHODS,
  isBlockedResponseHeader,
  matchAllowedHost,
  normalizeHosts,
  redactTokenOccurrences,
  sanitizeAgentHeaders,
} from "./proxy.rules";

const PROXY_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BODY_BYTES = 1 * 1024 * 1024;

function providerDefaultHosts(provider: {
  metadata: Record<string, unknown>;
  userinfo_url: string | null;
}): string[] {
  const fromMetadata = normalizeHosts(provider.metadata.api_hosts);
  if (fromMetadata.length > 0) {
    return fromMetadata;
  }
  if (provider.userinfo_url) {
    try {
      return [new URL(provider.userinfo_url).hostname.toLowerCase()];
    } catch {
      return [];
    }
  }
  return [];
}

async function resolveAccessToken(connection: OAuthConnectionRecord): Promise<{
  token: string;
  connection: OAuthConnectionRecord;
}> {
  let current = connection;
  if (current.status === "revoked" || current.status === "reconnect_required") {
    throw new ForbiddenError("OAuth connection requires reconnection", {
      error_code: "reconnect_required",
      connection_id: current.id,
    });
  }

  if (current.expires_at && new Date(current.expires_at).getTime() < Date.now() + 60_000) {
    await oauthConnectionService.refreshConnectionTokens(current.id);
    const refreshed = await findOAuthConnectionById(current.id);
    if (!refreshed || refreshed.status !== "active") {
      throw new ForbiddenError("OAuth connection requires reconnection", {
        error_code: "reconnect_required",
        connection_id: current.id,
      });
    }
    current = refreshed;
  }

  await touchOAuthConnection(current.id);
  const token = await getConnectionAccessToken(current);
  return { token, connection: current };
}

export class ProxyService {
  async requestAccess(input: {
    agent: AgentRecord;
    provider: string;
    hosts?: unknown;
    reason?: string;
    userId?: string;
    callbackUrl?: string;
    apiBaseUrl: string;
  }) {
    const provider = await findOAuthProviderBySlug(input.provider.trim().toLowerCase());
    if (!provider) {
      throw new NotFoundError(`OAuth provider not found: ${input.provider}`);
    }

    const requestedHosts = normalizeHosts(input.hosts);
    const hosts = requestedHosts.length > 0 ? requestedHosts : providerDefaultHosts(provider);
    if (hosts.length === 0) {
      throw new ValidationError(
        "hosts is required: this provider has no default API hosts configured",
        { error_code: "missing_hosts" },
      );
    }

    const userHint = input.userId?.trim() || undefined;
    const callbackUrl = input.callbackUrl?.trim()
      ? await validateCallbackUrl(input.callbackUrl)
      : undefined;

    const request = await createProxyAccessRequest({
      agent_id: input.agent.id,
      provider_slug: provider.slug,
      requested_hosts: hosts,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(userHint ? { user_hint: userHint } : {}),
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      metadata: { provider_id: provider.id },
    });

    // Known user → push the approval to their paired authenticator devices
    // (Microsoft Authenticator style). Failure to push never fails the request;
    // the approval_url and iOS polling still work.
    let pushedToDevices = 0;
    if (userHint) {
      try {
        const devices = await listActivePushDevices(userHint);
        const result = await sendApprovalPush({
          devices,
          accessRequestId: request.id,
          provider: provider.slug,
          agentName: input.agent.name,
          reason: input.reason ?? null,
        });
        pushedToDevices = result.sent;
      } catch (error) {
        console.warn(
          `[v4-push] failed for ${request.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const approvalBase = config.consoleUrl?.replace(/\/+$/, "") ?? input.apiBaseUrl.replace(/\/+$/, "");
    const userQuery = userHint ? `?user=${encodeURIComponent(userHint)}` : "";

    // Agent-facing guidance: how the human can enable phone approvals when the
    // request could not be pushed to any paired device.
    const humanOnboarding =
      userHint && pushedToDevices === 0
        ? `No paired phone found for user "${userHint}". Tell the human: 1) sign in at ${approvalBase}/login (GitHub/OIDC — signing in creates the account); 2) open ${approvalBase}/devices, generate the pairing QR, install the CNothing iOS app and scan it. Future approvals will then arrive as push notifications. For now, use approval_url in a browser.`
        : undefined;

    return {
      ok: true as const,
      access_request_id: request.id,
      status: request.status,
      provider: provider.slug,
      requested_hosts: request.requested_hosts,
      // Browser page in Console — NOT an API path. Do not rewrite this URL.
      approval_url: `${approvalBase}/approve-proxy/${request.id}${userQuery}`,
      human_instruction:
        "Give the human this exact approval_url. Do not invent /v4/approve/... or /v4/access-requests/.../approve — those are not browser pages.",
      pushed_to_devices: pushedToDevices,
      callback_registered: Boolean(callbackUrl),
      ...(humanOnboarding ? { human_onboarding: humanOnboarding } : {}),
      expires_at: request.expires_at,
    };
  }

  /** Pending approvals targeted at this user (for the iOS authenticator app). */
  async listPendingForUser(userId: string) {
    const requests = await listPendingAccessRequestsForUser(userId);
    return requests.map((request) => ({
      access_request_id: request.id,
      agent_id: request.agent_id,
      provider: request.provider_slug,
      requested_hosts: request.requested_hosts,
      reason: request.reason,
      status: request.status,
      expires_at: request.expires_at,
      created_at: request.created_at,
    }));
  }

  async getAccessStatus(id: string, agent: AgentRecord) {
    const request = await findProxyAccessRequest(id);
    if (!request || request.agent_id !== agent.id) {
      throw new NotFoundError("Access request not found");
    }
    return {
      ok: true as const,
      access_request_id: request.id,
      status: request.status,
      provider: request.provider_slug,
      requested_hosts: request.requested_hosts,
      grant_id: request.grant_id,
      connection_id: request.connection_id,
      expires_at: request.expires_at,
      decided_at: request.decided_at,
    };
  }

  /** User-facing view for the approval page (no agent token required). */
  async getAccessRequestForApproval(id: string) {
    const request = await findProxyAccessRequest(id);
    if (!request) {
      throw new NotFoundError("Access request not found");
    }
    return request;
  }

  async approveAccess(input: {
    accessRequestId: string;
    userId: string;
    connectionId: string;
    allowedHosts?: unknown;
    allowedMethods?: unknown;
    expiresAt?: string;
  }) {
    const request = await findProxyAccessRequest(input.accessRequestId);
    if (!request) {
      throw new NotFoundError("Access request not found");
    }
    if (request.status !== "pending") {
      throw new ValidationError(`Access request is already ${request.status}`, {
        error_code: "access_request_not_pending",
      });
    }
    if (new Date(request.expires_at).getTime() < Date.now()) {
      throw new ValidationError("Access request has expired", {
        error_code: "access_request_expired",
      });
    }

    const connection = await findOAuthConnectionById(input.connectionId);
    if (!connection || connection.user_id !== input.userId) {
      throw new ForbiddenError("Connection not found or not owned by this user", {
        error_code: "connection_not_owned",
      });
    }
    if (connection.status !== "active") {
      throw new ValidationError("Connection is not active", {
        error_code: "connection_not_active",
      });
    }

    const provider = await findOAuthProviderById(connection.provider_id);
    if (!provider || provider.slug !== request.provider_slug) {
      throw new ValidationError("Connection provider does not match the requested provider", {
        error_code: "provider_mismatch",
      });
    }

    const overrideHosts = normalizeHosts(input.allowedHosts);
    const allowedHosts = overrideHosts.length > 0 ? overrideHosts : request.requested_hosts;
    const allowedMethods = Array.isArray(input.allowedMethods)
      ? input.allowedMethods.map((method) => String(method).toUpperCase()).filter(Boolean)
      : DEFAULT_ALLOWED_METHODS;

    const grant = await createProxyGrant({
      agent_id: request.agent_id,
      user_id: input.userId,
      connection_id: connection.id,
      provider_id: provider.id,
      allowed_hosts: allowedHosts,
      allowed_methods: allowedMethods,
      expires_at: input.expiresAt ?? null,
      metadata: { access_request_id: request.id },
    });

    await decideProxyAccessRequest({
      id: request.id,
      status: "approved",
      user_id: input.userId,
      connection_id: connection.id,
      grant_id: grant.id,
    });

    if (request.callback_url) {
      dispatchAccessRequestCallback({
        callbackUrl: request.callback_url,
        accessRequestId: request.id,
        status: "approved",
        provider: provider.slug,
        grantId: grant.id,
        agentId: request.agent_id,
      });
    }

    return {
      ok: true as const,
      grant: {
        id: grant.id,
        agent_id: grant.agent_id,
        connection_id: grant.connection_id,
        provider: provider.slug,
        allowed_hosts: grant.allowed_hosts,
        allowed_methods: grant.allowed_methods,
        expires_at: grant.expires_at,
        status: grant.status,
      },
    };
  }

  async denyAccess(input: { accessRequestId: string; userId: string }) {
    const request = await findProxyAccessRequest(input.accessRequestId);
    if (!request) {
      throw new NotFoundError("Access request not found");
    }
    if (request.status !== "pending") {
      throw new ValidationError(`Access request is already ${request.status}`, {
        error_code: "access_request_not_pending",
      });
    }
    await decideProxyAccessRequest({
      id: request.id,
      status: "denied",
      user_id: input.userId,
    });

    if (request.callback_url) {
      dispatchAccessRequestCallback({
        callbackUrl: request.callback_url,
        accessRequestId: request.id,
        status: "denied",
        provider: request.provider_slug,
        agentId: request.agent_id,
      });
    }

    return { ok: true as const, status: "denied" as const };
  }

  async listGrants(input: { agentId?: string; userId?: string }) {
    const grants = input.agentId
      ? await listProxyGrantsForAgent(input.agentId)
      : input.userId
        ? await listProxyGrantsForUser(input.userId)
        : [];
    return grants.map((grant) => ({
      id: grant.id,
      agent_id: grant.agent_id,
      connection_id: grant.connection_id,
      provider_id: grant.provider_id,
      allowed_hosts: grant.allowed_hosts,
      allowed_methods: grant.allowed_methods,
      status: grant.status,
      expires_at: grant.expires_at,
      last_used_at: grant.last_used_at,
      created_at: grant.created_at,
    }));
  }

  async revokeGrant(input: { grantId: string; userId: string }) {
    const revoked = await revokeProxyGrant(input.grantId, input.userId);
    if (!revoked) {
      throw new NotFoundError("Grant not found or already revoked");
    }
    return { ok: true as const, status: "revoked" as const };
  }

  private async requireActiveGrant(input: {
    agent: AgentRecord;
    grantId: string;
  }): Promise<ProxyGrantRecord> {
    const grant = await findProxyGrantById(input.grantId);
    if (!grant || grant.agent_id !== input.agent.id) {
      throw new NotFoundError("Grant not found");
    }
    if (grant.status !== "active") {
      throw new ForbiddenError("Grant has been revoked", { error_code: "grant_revoked" });
    }
    if (grant.expires_at && new Date(grant.expires_at).getTime() < Date.now()) {
      throw new ForbiddenError("Grant has expired", { error_code: "grant_expired" });
    }
    return grant;
  }

  async proxy(input: {
    agent: AgentRecord;
    grantId: string;
    method: string;
    url: string;
    headers?: Record<string, unknown>;
    body?: unknown;
  }) {
    const startedAt = Date.now();
    const grant = await this.requireActiveGrant({ agent: input.agent, grantId: input.grantId });

    const method = input.method.trim().toUpperCase();
    if (!grant.allowed_methods.includes(method)) {
      throw new ForbiddenError(`Method not allowed by grant: ${method}`, {
        error_code: "method_not_allowed",
        allowed_methods: grant.allowed_methods,
      });
    }

    // KEYSERVICE_E2E_INTERNAL=1 relaxes https/SSRF checks so E2E can target a
    // local mock upstream. Never enable it in production (same switch as the
    // /v2/internal/e2e seed endpoints).
    let parsedUrl: URL;
    if (config.e2eInternalEnabled) {
      try {
        parsedUrl = new URL(input.url.trim());
      } catch {
        throw new ValidationError("Invalid url", { error_code: "invalid_url" });
      }
    } else {
      parsedUrl = await assertSafePublicUrlWithDns(input.url, "url");
      if (parsedUrl.protocol !== "https:") {
        throw new ValidationError("Only https URLs are allowed", {
          error_code: "https_required",
        });
      }
    }
    if (!matchAllowedHost(parsedUrl.hostname, grant.allowed_hosts)) {
      throw new ForbiddenError(`Host not allowed by grant: ${parsedUrl.hostname}`, {
        error_code: "host_not_allowed",
        allowed_hosts: grant.allowed_hosts,
      });
    }

    const connection = await findOAuthConnectionById(grant.connection_id);
    if (!connection) {
      throw new ForbiddenError("OAuth connection no longer exists", {
        error_code: "reconnect_required",
      });
    }

    const audit = async (details: {
      status_code?: number | null;
      success: boolean;
      error_code?: string | null;
    }) => {
      await writeProxyRequestAudit({
        grant_id: grant.id,
        agent_id: input.agent.id,
        connection_id: grant.connection_id,
        method,
        url_host: parsedUrl.hostname,
        url_path: parsedUrl.pathname,
        duration_ms: Date.now() - startedAt,
        ...details,
      });
    };

    let token: string;
    try {
      const resolved = await resolveAccessToken(connection);
      token = resolved.token;
    } catch (error) {
      await audit({ success: false, error_code: "reconnect_required" });
      throw error;
    }

    const headers = sanitizeAgentHeaders(input.headers ?? {});
    headers.authorization = `${connection.token_type || "Bearer"} ${token}`;
    if (!headers["user-agent"]) {
      headers["user-agent"] = "CNothing-Proxy/1.0";
    }

    let requestBody: string | undefined;
    if (input.body !== undefined && input.body !== null && method !== "GET" && method !== "HEAD") {
      requestBody = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
      if (Buffer.byteLength(requestBody, "utf8") > MAX_BODY_BYTES) {
        throw new ValidationError("Request body too large (max 1MB)", {
          error_code: "body_too_large",
        });
      }
      if (!headers["content-type"] && typeof input.body !== "string") {
        headers["content-type"] = "application/json";
      }
    }

    let upstream: Response;
    try {
      upstream = await fetch(parsedUrl.toString(), {
        method,
        headers,
        ...(requestBody !== undefined ? { body: requestBody } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      });
    } catch (error) {
      await audit({ success: false, error_code: "upstream_unreachable" });
      throw new ValidationError("Upstream request failed", {
        error_code: "upstream_unreachable",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const rawBody = Buffer.from(await upstream.arrayBuffer());
    const truncated = rawBody.byteLength > MAX_RESPONSE_BYTES;
    const bodyText = redactTokenOccurrences(
      rawBody.subarray(0, MAX_RESPONSE_BYTES).toString("utf8"),
      [token],
    );

    const contentType = upstream.headers.get("content-type") ?? "";
    let responseBody: unknown = bodyText;
    if (contentType.includes("application/json")) {
      try {
        responseBody = redactSecrets(JSON.parse(bodyText));
      } catch {
        responseBody = bodyText;
      }
    }

    const responseHeaders: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      if (!isBlockedResponseHeader(key)) {
        responseHeaders[key.toLowerCase()] = redactTokenOccurrences(value, [token]);
      }
    });

    await touchProxyGrant(grant.id);
    await audit({ status_code: upstream.status, success: upstream.ok });

    return {
      ok: true as const,
      status: upstream.status,
      headers: responseHeaders,
      body: responseBody,
      truncated,
    };
  }
}

export const proxyService = new ProxyService();
