import config from "../config";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errors";
import { assertSafePublicUrlWithDns } from "./url-safety.service";
import { redactSecrets } from "./secret-redaction";
import type { AgentRecord } from "./platform.entity";
import type { OAuthConnectionRecord } from "./oauth.entity";
import {
  findOAuthConnectionById,
  findOAuthProviderById,
  findOAuthProviderByIssuer,
  findOAuthProviderBySlug,
  getConnectionAccessToken,
  isOAuthProviderAvailable,
  toProviderAdmin,
  touchOAuthConnection,
  type OAuthProviderAdminView,
} from "./oauth.repository";
import { oauthConnectionService, oauthProviderService } from "./oauth-connection.service";
import { approvalService } from "./approval.service";
import { toAccessRequestPublic } from "./approval";
import {
  approveAccessRequestWithGrant,
  findProxyGrantById,
  listProxyGrantsForAgent,
  listProxyGrantsForUser,
  revokeProxyGrant,
  touchProxyGrant,
  updateProxyGrantConstraints,
  writeProxyRequestAudit,
  type ProxyGrantRecord,
} from "./proxy.repository";
import { sendApprovalPush } from "./apns.service";
import { dispatchAccessRequestCallback, validateCallbackUrl } from "./callback.service";
import { listActivePushDevices } from "./device.repository";
import { resolveAgentUserHint } from "./share-code.service";
import { evaluateMandateForRequest, mandateFromGrantRow, mandateIsRevokedOrExpired, toGrantPublic, buildMandateConstraints } from "./mandate";
import { evaluatePolicy } from "./policy";
import { slugFromIssuerOrHost } from "./provider-registry";
import {
  transactionIntentService,
  type ApprovalRequiredEnvelope,
  type DeniedEnvelope,
} from "./transaction.service";
import type { JsonObject } from "./platform.entity";

import {
  DEFAULT_ALLOWED_METHODS,
  isBlockedResponseHeader,
  normalizeHosts,
  redactTokenOccurrences,
  sanitizeAgentHeaders,
} from "./proxy.rules";

const PROXY_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_BODY_BYTES = 1 * 1024 * 1024;

function looksLikeHttpsUrl(value: string): boolean {
  return /^https:\/\//i.test(value.trim());
}

function providerReviewRequired(
  provider: OAuthProviderAdminView,
  apiBaseUrl: string,
) {
  const consoleBase = config.consoleUrl?.replace(/\/+$/, "") ?? apiBaseUrl.replace(/\/+$/, "");
  const hasCredentials = Boolean(provider.client_id?.trim()) || provider.has_client_secret;
  const dcr = provider.validation?.dynamic_client_registration;
  let message = `Provider "${provider.slug}" is in the registry as ${provider.registry_status} and is not connectable yet. Ask the operator to open ${consoleBase}/providers, review it, add credentials if needed, then Activate. Then retry request_access with provider="${provider.slug}".`;
  if (dcr?.ok) {
    message = `Provider "${provider.slug}" was discovered and RFC 7591 registered a client. Ask the operator to review and Activate it at ${consoleBase}/providers, then retry request_access with provider="${provider.slug}".`;
  } else if (dcr?.attempted && dcr.error) {
    message = `Provider "${provider.slug}" was discovered, but automatic client registration failed (${dcr.error}). Ask the operator to paste client credentials at ${consoleBase}/providers, Activate, then retry request_access.`;
  } else if (!hasCredentials) {
    message = `Provider "${provider.slug}" was proposed and needs operator review at ${consoleBase}/providers. After it is Active, retry request_access with provider="${provider.slug}".`;
  }
  return {
    ok: true as const,
    status: "provider_review_required" as const,
    provider: provider.slug,
    provider_id: provider.id,
    registry_status: provider.registry_status,
    connectable: provider.connectable,
    has_client_credentials: hasCredentials,
    dynamic_client_registration: dcr ?? null,
    console_url: `${consoleBase}/providers`,
    next_action: "wait_for_operator" as const,
    human_instruction: message,
  };
}

async function resolveOrProposeProvider(input: {
  provider: string;
  issuer?: string;
  discoveryUrl?: string;
}): Promise<
  | { kind: "available"; provider: Awaited<ReturnType<typeof findOAuthProviderBySlug>> & {} }
  | { kind: "review"; view: OAuthProviderAdminView }
  | { kind: "missing" }
> {
  const raw = input.provider.trim();
  let slug = raw.toLowerCase();
  let issuer = input.issuer?.trim();
  const discoveryUrl = input.discoveryUrl?.trim();
  if (!issuer && looksLikeHttpsUrl(raw)) {
    issuer = raw.replace(/\/+$/, "");
    slug = slugFromIssuerOrHost(issuer);
  }

  const bySlug = slug ? await findOAuthProviderBySlug(slug) : null;
  const byIssuer = !bySlug && issuer ? await findOAuthProviderByIssuer(issuer) : null;
  const existing = bySlug ?? byIssuer;
  if (existing) {
    if (isOAuthProviderAvailable(existing)) {
      return { kind: "available", provider: existing };
    }
    return { kind: "review", view: toProviderAdmin(existing) };
  }

  if (!issuer && !discoveryUrl) {
    return { kind: "missing" };
  }

  const proposed = await oauthProviderService.proposeProvider({
    slug,
    display_name: slug,
    issuer,
    discovery_url: discoveryUrl,
  });
  return { kind: "review", view: proposed };
}

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
    issuer?: string;
    discoveryUrl?: string;
    apiBaseUrl: string;
  }) {
    const resolvedProvider = await resolveOrProposeProvider({
      provider: input.provider,
      issuer: input.issuer,
      discoveryUrl: input.discoveryUrl,
    });
    if (resolvedProvider.kind === "missing") {
      throw new NotFoundError(
        `OAuth provider not found: ${input.provider}. Pass issuer or discovery_url to propose it for operator review.`,
      );
    }
    if (resolvedProvider.kind === "review") {
      return providerReviewRequired(resolvedProvider.view, input.apiBaseUrl);
    }
    const provider = resolvedProvider.provider;
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

    const resolved = await resolveAgentUserHint(input.userId);
    const userHint = resolved.userId;
    const callbackUrl = input.callbackUrl?.trim()
      ? await validateCallbackUrl(input.callbackUrl)
      : undefined;

    const request = await approvalService.createDelegation({
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
          userId: userHint,
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
    let humanOnboarding: string | undefined;
    if (resolved.unresolved) {
      humanOnboarding = `Could not resolve "${resolved.unresolved}" to a CNothing user. Ask the human to open ${approvalBase}/devices, copy their agent ID or share code, and send it to you — or just give them approval_url to open on their phone. Do not block waiting for user_id.`;
    } else if (!userHint) {
      humanOnboarding = `No user_id provided. If you know the human's GitHub username, CNothing id (github:…), or u_ short code, call request_access again WITH user_id so they get a phone push. Otherwise send this exact approval_url (best opened on their phone). They can also copy their agent ID from ${approvalBase}/devices. Do not block waiting for user_id.`;
    } else if (pushedToDevices === 0) {
      humanOnboarding = `No paired phone found for user "${userHint}". Tell the human: 1) sign in at ${approvalBase}/login; 2) open ${approvalBase}/devices, generate the pairing QR, install the CNothing iOS app and scan it. For now, open approval_url (on phone or desktop).`;
    }

    return {
      ok: true as const,
      access_request_id: request.id,
      status: request.status,
      provider: provider.slug,
      requested_hosts: request.requested_hosts,
      // Browser page in Console — NOT an API path. Do not rewrite this URL.
      approval_url: `${approvalBase}/approve-proxy/${request.id}${userQuery}`,
      human_instruction: userHint
        ? "If pushed_to_devices > 0, tell the human to check their phone notification. Always also share approval_url as a fallback (phone Universal Link or browser)."
        : "Give the human this exact approval_url — prefer they open it on their phone. If you already know their GitHub username, prefer re-requesting with user_id for push. Do not invent /v4/approve/... paths. Do not block waiting for user_id.",
      pushed_to_devices: pushedToDevices,
      resolved_user_id: userHint ?? null,
      callback_registered: Boolean(callbackUrl),
      ...(humanOnboarding ? { human_onboarding: humanOnboarding } : {}),
      expires_at: request.expires_at,
    };
  }

  /** Pending approvals targeted at this user (for the iOS authenticator app). */
  async listPendingForUser(userId: string) {
    const requests = await approvalService.listPendingForPrincipal(userId);
    return requests.map(toAccessRequestPublic);
  }

  async getAccessStatus(id: string, agent: AgentRecord) {
    const request = await approvalService.get(id);
    if (!request || request.agent_id !== agent.id) {
      throw new NotFoundError("Access request not found");
    }
    return {
      ok: true as const,
      ...toAccessRequestPublic(request),
    };
  }

  /**
   * User-facing view for the approval page (no agent token required).
   * When the agent omitted user_id, opening this page while signed in claims the
   * request for that user so the paired iPhone can poll/push it.
   */
  async getAccessRequestForApproval(id: string, viewerUserId?: string) {
    let request = await approvalService.get(id);
    if (!request) {
      throw new NotFoundError("Access request not found");
    }

    if (
      viewerUserId &&
      request.status === "pending" &&
      new Date(request.expires_at).getTime() >= Date.now() &&
      !request.user_hint &&
      !request.principal.id
    ) {
      const claimed = await approvalService.claimForPrincipal(request.id, viewerUserId);
      if (claimed) {
        request = claimed;
        try {
          const devices = await listActivePushDevices(viewerUserId);
          await sendApprovalPush({
            devices,
            accessRequestId: request.id,
            provider: request.provider_slug,
            agentName: request.agent_id,
            reason: request.reason,
            userId: viewerUserId,
          });
        } catch (error) {
          console.warn(
            `[v4-push] claim-time push failed for ${request.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    return request;
  }

  async approveAccess(input: {
    accessRequestId: string;
    userId: string;
    connectionId?: string;
    allowedHosts?: unknown;
    allowedMethods?: unknown;
    expiresAt?: string;
    requireApproval?: boolean;
  }) {
    const request = await approvalService.requirePending(input.accessRequestId, input.userId);

    if (request.type === "transaction") {
      const transaction = await transactionIntentService.authorize(request.id, input.userId);
      if (request.callback_url) {
        dispatchAccessRequestCallback({
          callbackUrl: request.callback_url,
          accessRequestId: request.id,
          status: "approved",
          provider: request.provider_slug,
          grantId: transaction.mandate_id,
          agentId: request.agent_id,
        });
      }
      return {
        ok: true as const,
        status: "approved" as const,
        transaction_id: transaction.id,
        access_request_id: request.id,
        mandate_id: transaction.mandate_id,
        grant_id: transaction.mandate_id,
      };
    }

    if (!input.connectionId?.trim()) {
      throw new ValidationError("connection_id is required", { error_code: "missing_field", field: "connection_id" });
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

    // The checks above produce good error messages, but only this call decides:
    // it claims the pending request and mints the grant atomically, so parallel
    // approvals cannot each create one.
    const grant = await approveAccessRequestWithGrant({
      access_request_id: request.id,
      user_id: input.userId,
      connection_id: connection.id,
      provider_id: provider.id,
      allowed_hosts: allowedHosts,
      allowed_methods: allowedMethods,
      expires_at: input.expiresAt ?? null,
      metadata: { access_request_id: request.id },
      require_approval: input.requireApproval,
    });
    if (!grant) {
      throw await approvalService.noLongerPending(request.id);
    }

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
        ...toGrantPublic(mandateFromGrantRow(grant)),
        provider: provider.slug,
      },
    };
  }

  async denyAccess(input: { accessRequestId: string; userId: string }) {
    const request = await approvalService.requirePending(input.accessRequestId, input.userId);
    await approvalService.deny({
      id: request.id,
      principalId: input.userId,
    });
    if (request.type === "transaction") {
      await transactionIntentService.deny(request.id, input.userId);
    }

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
    return grants.map((grant) => toGrantPublic(mandateFromGrantRow(grant)));
  }

  async revokeGrant(input: { grantId: string; userId: string }) {
    const revoked = await revokeProxyGrant(input.grantId, input.userId);
    if (!revoked) {
      throw new NotFoundError("Grant not found or already revoked");
    }
    return { ok: true as const, status: "revoked" as const };
  }

  async updateGrant(input: { grantId: string; userId: string; requireApproval: boolean }) {
    const grant = await findProxyGrantById(input.grantId);
    if (!grant || grant.user_id !== input.userId) {
      throw new NotFoundError("Grant not found");
    }
    if (grant.status !== "active") {
      throw new ValidationError("Only an active grant can be updated", {
        error_code: "grant_not_active",
      });
    }
    const mandate = mandateFromGrantRow(grant);
    const constraints = buildMandateConstraints({
      hosts: mandate.hosts,
      methods: mandate.methods,
      expires_at: mandate.expires_at,
      require_approval: input.requireApproval,
      approval_required_methods: mandate.constraints.approval_required_methods,
    });
    const updated = await updateProxyGrantConstraints(grant.id, constraints);
    if (!updated) {
      throw new NotFoundError("Grant not found");
    }
    return toGrantPublic(mandateFromGrantRow(updated));
  }

  private async requireActiveGrant(input: {
    agent: AgentRecord;
    grantId: string;
  }): Promise<ProxyGrantRecord> {
    const grant = await findProxyGrantById(input.grantId);
    if (!grant || grant.agent_id !== input.agent.id) {
      throw new NotFoundError("Grant not found");
    }
    const mandate = mandateFromGrantRow(grant);
    const inactive = mandateIsRevokedOrExpired(mandate);
    if (inactive) {
      throw new ForbiddenError(inactive.reason, { error_code: inactive.error_code });
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
    idempotencyKey?: string;
    apiBaseUrl?: string;
  }): Promise<
    | {
        ok: true;
        status: number;
        headers: Record<string, string>;
        body: unknown;
        truncated: boolean;
        transaction_id?: string;
        external_reference?: string | null;
      }
    | ApprovalRequiredEnvelope
    | DeniedEnvelope
  > {
    const startedAt = Date.now();
    const grant = await this.requireActiveGrant({ agent: input.agent, grantId: input.grantId });
    const mandate = mandateFromGrantRow(grant);

    const method = input.method.trim().toUpperCase();
    const parsedUrl = await assertSafePublicUrlWithDns(input.url, "url");
    if (parsedUrl.protocol !== "https:") {
      throw new ValidationError("Only https URLs are allowed", {
        error_code: "https_required",
      });
    }

    const decision = evaluateMandateForRequest({
      mandate,
      method,
      host: parsedUrl.hostname,
    });
    if (!decision.allowed) {
      throw new ForbiddenError(decision.reason, {
        error_code: decision.error_code,
        ...(decision.allowed_hosts ? { allowed_hosts: decision.allowed_hosts } : {}),
        ...(decision.allowed_methods ? { allowed_methods: decision.allowed_methods } : {}),
      });
    }

    const policy = evaluatePolicy({ method, url: parsedUrl, mandate });
    if (policy.decision === "deny") {
      throw new ForbiddenError(policy.reason, { error_code: "policy_denied" });
    }

    const apiBaseUrl = input.apiBaseUrl?.replace(/\/+$/, "") || config.publicBaseUrl.replace(/\/+$/, "");

    if (policy.decision === "approval_required") {
      const ensured = await transactionIntentService.ensureProposed({
        agent: input.agent,
        mandate,
        method,
        url: parsedUrl,
        action: policy.action,
        reason: policy.reason,
        body: input.body,
        idempotencyKey: input.idempotencyKey,
        apiBaseUrl,
      });
      if (ensured.kind === "proposed") {
        await writeProxyRequestAudit({
          grant_id: grant.id,
          agent_id: input.agent.id,
          connection_id: grant.connection_id,
          method,
          url_host: parsedUrl.hostname,
          url_path: parsedUrl.pathname,
          duration_ms: Date.now() - startedAt,
          success: true,
          error_code: null,
          transaction_id: ensured.transaction.id,
          approval_request_id: ensured.envelope.request_id,
          policy_decision: "approval_required",
        });
        return ensured.envelope;
      }
      if (ensured.kind === "denied") {
        return ensured.envelope;
      }
      if (ensured.kind === "committed" && ensured.transaction.result) {
        const stored = ensured.transaction.result;
        return {
          ok: true as const,
          status: typeof stored.status === "number" ? stored.status : 200,
          headers:
            stored.headers && typeof stored.headers === "object" && !Array.isArray(stored.headers)
              ? (stored.headers as Record<string, string>)
              : {},
          body: stored.body,
          truncated: stored.truncated === true,
          transaction_id: ensured.transaction.id,
          external_reference: ensured.transaction.external_reference,
        };
      }

      const claimed = await transactionIntentService.claimExecution(ensured.transaction.id);
      if (claimed.status === "committed" && claimed.result) {
        const stored = claimed.result;
        return {
          ok: true as const,
          status: typeof stored.status === "number" ? stored.status : 200,
          headers:
            stored.headers && typeof stored.headers === "object" && !Array.isArray(stored.headers)
              ? (stored.headers as Record<string, string>)
              : {},
          body: stored.body,
          truncated: stored.truncated === true,
          transaction_id: claimed.id,
          external_reference: claimed.external_reference,
        };
      }

      let executed: {
        ok: true;
        status: number;
        headers: Record<string, string>;
        body: unknown;
        truncated: boolean;
      };
      try {
        executed = await this.executeProxiedRequest({
          agent: input.agent,
          grant,
          method,
          parsedUrl,
          headers: input.headers,
          body: input.body,
          startedAt,
          transactionId: claimed.id,
          approvalRequestId: claimed.approval_request_id,
          policyDecision: "allow",
        });
      } catch (error) {
        await transactionIntentService.complete(
          claimed.id,
          { error: error instanceof Error ? error.message : String(error) },
          "failed",
        );
        throw error;
      }
      const resultPayload: JsonObject = {
        status: executed.status,
        headers: executed.headers,
        body: executed.body,
        truncated: executed.truncated,
      };
      const completed = await transactionIntentService.complete(
        claimed.id,
        resultPayload,
        executed.status >= 200 && executed.status < 300 ? "committed" : "failed",
      );
      return {
        ...executed,
        transaction_id: claimed.id,
        external_reference: completed?.external_reference ?? null,
      };
    }

    return this.executeProxiedRequest({
      agent: input.agent,
      grant,
      method,
      parsedUrl,
      headers: input.headers,
      body: input.body,
      startedAt,
      policyDecision: "allow",
    });
  }

  private async executeProxiedRequest(input: {
    agent: AgentRecord;
    grant: ProxyGrantRecord;
    method: string;
    parsedUrl: URL;
    headers?: Record<string, unknown>;
    body?: unknown;
    startedAt: number;
    transactionId?: string | null;
    approvalRequestId?: string | null;
    policyDecision?: string | null;
  }) {
    const grant = input.grant;
    const method = input.method;
    const parsedUrl = input.parsedUrl;

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
        duration_ms: Date.now() - input.startedAt,
        transaction_id: input.transactionId ?? null,
        approval_request_id: input.approvalRequestId ?? null,
        policy_decision: input.policyDecision ?? null,
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
