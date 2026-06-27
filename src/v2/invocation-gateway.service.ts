import { randomUUID } from "node:crypto";
import config from "../config";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors";
import { signCapabilityGrant } from "./grant-token";
import { evaluatePolicyV25, applyOutputPolicy, scopesSatisfied } from "./policy-engine-v25";
import {
  findOAuthConnectionById,
  getConnectionAccessToken,
  hashPayload,
  touchOAuthConnection,
} from "./oauth.repository";
import { oauthConnectionService } from "./oauth-connection.service";
import {
  executePlatformCapability,
  PLATFORM_CONNECTOR_PROVIDER,
} from "./platform-connector.executor";
import { executeSearchCapability } from "./search-connector.executor";
import { SEARCH_CONNECTOR_PROVIDER } from "./search-credential.service";
import { sanitizeAgentResponse } from "./secret-redaction";
import type {
  AgentRecord,
  InvokeCapabilityResult,
  InvokePendingConfirmation,
  JsonObject,
} from "./v2.entity";
import type { AgentInvokeRequest } from "./v2.5.entity";
import {
  confirmPendingConfirmation,
  createPendingConfirmation,
  findActiveGrant,
  findActiveGrantsForAgentCapability,
  findCapabilityByName,
  findConnectorById,
  findPendingConfirmation,
  listPolicies,
  touchGrantLastUsed,
  writeInvokeAudit,
} from "./v2.repository";
import {
  executeHttpCapability,
  readCapabilityInvocationType,
} from "./http-invocation.executor";
import { executeMcpCapability } from "./mcp-invocation.executor";

type InvokeContext = {
  agent: AgentRecord;
  body: AgentInvokeRequest;
};

async function resolveInvokeUserId(input: {
  agent: AgentRecord;
  capabilityId: string;
}): Promise<string> {
  const grants = await findActiveGrantsForAgentCapability({
    agent_id: input.agent.id,
    capability_id: input.capabilityId,
  });
  const userIds = [...new Set(grants.map((grant) => grant.user_id))];

  if (userIds.length === 1) {
    return userIds[0]!;
  }
  if (userIds.length === 0) {
    throw new ForbiddenError("No active authorization grant for this capability", {
      error_code: "authorization_required",
      hint: "Call POST /v2/agent/authorizations and have the user approve at approval_url",
    });
  }
  throw new ForbiddenError("Multiple users have granted this capability to this agent", {
    error_code: "ambiguous_user_grant",
    user_ids: userIds,
  });
}

async function resolveAccessToken(input: {
  userId: string;
  connectionId: string | null;
  capabilityName: string;
}): Promise<string | null> {
  if (input.connectionId) {
    let connection = await findOAuthConnectionById(input.connectionId);
    if (!connection || connection.status === "revoked") {
      throw new ForbiddenError("OAuth connection unavailable", {
        error_code: "connection_unavailable",
      });
    }

    if (
      connection.expires_at &&
      new Date(connection.expires_at).getTime() < Date.now() + 60_000
    ) {
      await oauthConnectionService.refreshConnectionTokens(connection.id);
      connection = await findOAuthConnectionById(connection.id);
      if (!connection || connection.status === "reconnect_required") {
        throw new ForbiddenError("OAuth connection requires reconnection", {
          error_code: "reconnect_required",
        });
      }
    }

    await touchOAuthConnection(connection.id);
    return getConnectionAccessToken(connection);
  }

  if (input.capabilityName.startsWith("github.")) {
    const { resolveGitHubAccessToken } = await import("./github-credential.service");
    return resolveGitHubAccessToken(input.userId);
  }

  return null;
}

export class InvocationGatewayService {
  async invoke(
    context: InvokeContext,
  ): Promise<InvokeCapabilityResult | InvokePendingConfirmation> {
    const requestId = context.body.request_id ?? randomUUID();
    const capabilityName = context.body.capability?.trim();
    if (!capabilityName) {
      throw new ValidationError("capability is required", { error_code: "missing_field" });
    }

    const capability = await findCapabilityByName(capabilityName);
    if (!capability) {
      await writeInvokeAudit({
        agent_id: context.agent.id,
        capability_name: capabilityName,
        policy_decision: "n/a",
        status: "failed",
        request_id: requestId,
        error_code: "capability_not_found",
        success: false,
      });
      throw new NotFoundError(`Capability not found: ${capabilityName}`);
    }

    const connector = await findConnectorById(capability.connector_id);
    if (!connector || connector.status !== "active") {
      throw new NotFoundError(`Connector unavailable for capability: ${capabilityName}`);
    }

    const userId = await resolveInvokeUserId({
      agent: context.agent,
      capabilityId: capability.id,
    });
    const input = (context.body.input ?? {}) as JsonObject;
    const inputHash = hashPayload(input);

    if (context.body.confirmation_id) {
      return this.invokeWithConfirmation({
        context,
        capability,
        connector,
        userId,
        requestId,
        inputHash,
      });
    }

    const grant = await findActiveGrant({
      user_id: userId,
      agent_id: context.agent.id,
      capability_id: capability.id,
    });

    if (!grant) {
      const approvalBase = config.consoleUrl?.replace(/\/+$/, "") ?? config.publicBaseUrl;
      await writeInvokeAudit({
        user_id: userId,
        agent_id: context.agent.id,
        capability_id: capability.id,
        capability_name: capabilityName,
        connector_id: connector.id,
        policy_decision: "deny",
        status: "failed",
        request_id: requestId,
        error_code: "authorization_required",
        input_hash: inputHash,
        success: false,
        risk_level: capability.risk_level,
      });
      throw new ForbiddenError("Authorization required for this capability", {
        error_code: "authorization_required",
        capability: capabilityName,
        approval_url: `${approvalBase}/approve/pending?capability=${encodeURIComponent(capabilityName)}&agent_id=${encodeURIComponent(context.agent.id)}`,
        hint: "Request authorization via POST /v2/agent/authorizations",
      });
    }

    const grantMetadata = grant.metadata ?? {};
    const connectionId = grant.connection_id ?? (
      typeof grantMetadata.connection_id === "string" ? grantMetadata.connection_id : null
    );
    const providerId = grant.provider_id ?? capability.provider_id;

    if (!scopesSatisfied(grant.scopes, capability.scopes)) {
      throw new ForbiddenError("Grant scopes insufficient for capability", {
        error_code: "insufficient_scope",
      });
    }

    const policies = await listPolicies();
    const decision = evaluatePolicyV25(capability, policies);

    if (decision.action === "deny") {
      await writeInvokeAudit({
        user_id: userId,
        agent_id: context.agent.id,
        capability_id: capability.id,
        capability_name: capabilityName,
        connector_id: connector.id,
        policy_decision: decision.action,
        status: "denied",
        request_id: requestId,
        error_code: "policy_denied",
        input_hash: inputHash,
        success: false,
        risk_level: capability.risk_level,
      });
      throw new ForbiddenError(decision.reason ?? "Policy denied this capability invocation", {
        error_code: "policy_denied",
      });
    }

    if (
      decision.action === "require_user_confirmation" ||
      decision.action === "require_step_up_auth" ||
      decision.action === "require_explicit_reason"
    ) {
      const pending = await createPendingConfirmation({
        user_id: userId,
        agent_id: context.agent.id,
        capability_id: capability.id,
        input,
        reason: decision.reason ?? undefined,
      });

      await writeInvokeAudit({
        user_id: userId,
        agent_id: context.agent.id,
        capability_id: capability.id,
        capability_name: capabilityName,
        connector_id: connector.id,
        policy_decision: decision.action,
        status: "pending_confirmation",
        request_id: requestId,
        input_hash: inputHash,
        success: false,
        risk_level: capability.risk_level,
        metadata: { confirmation_id: pending.id },
      });

      return sanitizeAgentResponse({
        ok: false,
        pending: true,
        confirmation_id: pending.id,
        policy_decision: decision,
        expires_at: pending.expires_at,
        message: "User confirmation required before executing this capability",
      }) as InvokePendingConfirmation;
    }

    return this.execute({
      agent: context.agent,
      userId,
      capability,
      connector,
      input,
      grant,
      grantScopes: grant.scopes,
      connectionId,
      providerId,
      requestId,
      policyDecision: decision,
      inputHash,
    });
  }

  private async invokeWithConfirmation(input: {
    context: InvokeContext;
    capability: NonNullable<Awaited<ReturnType<typeof findCapabilityByName>>>;
    connector: NonNullable<Awaited<ReturnType<typeof findConnectorById>>>;
    userId: string;
    requestId: string;
    inputHash: string;
  }): Promise<InvokeCapabilityResult> {
    const confirmationId = input.context.body.confirmation_id?.trim();
    if (!confirmationId) {
      throw new ValidationError("confirmation_id is required");
    }

    const pending = await findPendingConfirmation(confirmationId);
    if (!pending) {
      throw new NotFoundError("Confirmation request not found");
    }
    if (pending.agent_id !== input.context.agent.id || pending.capability_id !== input.capability.id) {
      throw new ForbiddenError("Confirmation does not match this agent or capability");
    }

    const confirmed = pending.confirmed_at
      ? pending
      : await confirmPendingConfirmation(confirmationId);
    if (!confirmed?.confirmed_at) {
      throw new ConflictError("Confirmation not yet approved by user", {
        error_code: "confirmation_pending",
      });
    }

    const grant = await findActiveGrant({
      user_id: input.userId,
      agent_id: input.context.agent.id,
      capability_id: input.capability.id,
    });
    if (!grant) {
      throw new ForbiddenError("No active authorization grant");
    }

    const grantMetadata = grant.metadata ?? {};
    const connectionId = grant.connection_id ?? (
      typeof grantMetadata.connection_id === "string" ? grantMetadata.connection_id : null
    );
    const providerId = grant.provider_id ?? input.capability.provider_id;

    const policies = await listPolicies();
    const decision = evaluatePolicyV25(input.capability, policies);

    return this.execute({
      agent: input.context.agent,
      userId: input.userId,
      capability: input.capability,
      connector: input.connector,
      input: pending.input,
      grant,
      grantScopes: grant.scopes,
      connectionId,
      providerId,
      requestId: input.requestId,
      policyDecision: decision,
      inputHash: input.inputHash,
    });
  }

  private async execute(input: {
    agent: AgentRecord;
    userId: string;
    capability: NonNullable<Awaited<ReturnType<typeof findCapabilityByName>>>;
    connector: NonNullable<Awaited<ReturnType<typeof findConnectorById>>>;
    input: JsonObject;
    grant: NonNullable<Awaited<ReturnType<typeof findActiveGrant>>>;
    grantScopes: string[];
    connectionId: string | null;
    providerId: string | null;
    requestId: string;
    policyDecision: ReturnType<typeof evaluatePolicyV25>;
    inputHash: string;
  }): Promise<InvokeCapabilityResult> {
    let connectorResult: unknown;

    try {
      connectorResult = await this.executeCapability({
        capability: input.capability,
        connector: input.connector,
        input: input.input,
        userId: input.userId,
        agentId: input.agent.id,
        connectionId: input.connectionId,
        grantScopes: input.grantScopes,
        requestId: input.requestId,
      });
    } catch (error) {
      await writeInvokeAudit({
        user_id: input.userId,
        agent_id: input.agent.id,
        capability_id: input.capability.id,
        capability_name: input.capability.name,
        connector_id: input.connector.id,
        provider_id: input.providerId ?? undefined,
        connection_id: input.connectionId ?? undefined,
        policy_decision: input.policyDecision.action,
        status: "failed",
        request_id: input.requestId,
        error_code: "connector_error",
        input_hash: input.inputHash,
        success: false,
        risk_level: input.capability.risk_level,
        metadata: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }

    const filtered = applyOutputPolicy({
      result: connectorResult,
      decision: input.policyDecision,
    });
    const outputHash = hashPayload(filtered);

    await touchGrantLastUsed(input.grant.id);

    await writeInvokeAudit({
      user_id: input.userId,
      agent_id: input.agent.id,
      capability_id: input.capability.id,
      capability_name: input.capability.name,
      connector_id: input.connector.id,
      provider_id: input.providerId ?? undefined,
      connection_id: input.connectionId ?? undefined,
      policy_decision: input.policyDecision.action,
      status: "success",
      request_id: input.requestId,
      input_hash: input.inputHash,
      output_hash: outputHash,
      success: true,
      risk_level: input.capability.risk_level,
      metadata: {
        output_mode: input.policyDecision.output_mode ?? "full",
        result_count: Array.isArray(filtered) ? filtered.length : undefined,
      },
    });

    return sanitizeAgentResponse({
      ok: true,
      request_id: input.requestId,
      capability: input.capability.name,
      result: filtered,
    }) as InvokeCapabilityResult;
  }

  private async executeCapability(input: {
    capability: NonNullable<Awaited<ReturnType<typeof findCapabilityByName>>>;
    connector: NonNullable<Awaited<ReturnType<typeof findConnectorById>>>;
    input: JsonObject;
    userId: string;
    agentId: string;
    connectionId: string | null;
    grantScopes: string[];
    requestId: string;
  }): Promise<unknown> {
    const accessToken = await resolveAccessToken({
      userId: input.userId,
      connectionId: input.connectionId,
      capabilityName: input.capability.name,
    });

    const invocationType = readCapabilityInvocationType(input.capability);
    if (invocationType === "http") {
      return executeHttpCapability({
        capability: input.capability,
        payload: input.input,
        accessToken: accessToken ?? undefined,
      });
    }

    if (invocationType === "mcp") {
      return executeMcpCapability({
        capability: input.capability,
        payload: input.input,
        accessToken: accessToken ?? undefined,
      });
    }

    if (input.connector.provider === PLATFORM_CONNECTOR_PROVIDER) {
      return executePlatformCapability({
        capability: input.capability.name,
        input: input.input,
        user_id: input.userId,
        agent_id: input.agentId,
        access_token: accessToken ?? undefined,
      });
    }

    if (input.connector.provider === SEARCH_CONNECTOR_PROVIDER) {
      return executeSearchCapability({
        capability: input.capability.name,
        input: input.input,
        user_id: input.userId,
        agent_id: input.agentId,
      });
    }

    const grantToken = signCapabilityGrant({
      privateKeyPem: config.authaiPrivateKeyPem,
      keyId: config.authaiKeyId,
      payload: {
        iss: "cnothing",
        sub: `agent:${input.agentId}`,
        aud: input.connector.id,
        user: input.userId,
        capability: input.capability.name,
        scope: input.grantScopes.length > 0 ? input.grantScopes : input.capability.scopes,
        exp: Math.floor(Date.now() / 1000) + 120,
      },
      ttlSeconds: 120,
    });

    const response = await fetch(input.connector.callback_url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${grantToken}`,
        "x-cnothing-request-id": input.requestId,
      },
      body: JSON.stringify({
        grant: grantToken,
        capability: input.capability.name,
        input: input.input,
        user_id: input.userId,
        agent_id: input.agentId,
      }),
    });

    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      throw new Error(`Connector returned ${response.status}`);
    }
    return parsed && typeof parsed === "object" && "result" in parsed
      ? (parsed as { result: unknown }).result
      : parsed;
  }
}

export const invocationGatewayService = new InvocationGatewayService();
