import { randomUUID } from "node:crypto";
import config from "../config";
import { NotFoundError, ValidationError } from "../utils/errors";
import { sanitizeAgentResponse } from "./secret-redaction";
import type { AgentRecord } from "./v2.entity";
import type { AgentAuthorizationRequest, AgentAuthorizationResponse, AgentCapabilityView } from "./v2.5.entity";
import {
  approveAuthorizationRequest,
  bindAuthorizationRequestUser,
  createAuthorizationRequest,
  createGrant,
  findActiveGrantsForAgentCapability,
  findAgentById,
  findAuthorizationRequest,
  findCapabilityByName,
  listCapabilities,
} from "./v2.repository";
import {
  isPendingAuthorizationUserId,
} from "./authorization-user";
import { emitPlatformWebhook } from "./platform-webhook.service";
import { findOAuthProviderBySlug } from "./oauth.repository";

export class AgentAuthorizationV25Service {
  async listCapabilitiesForAgent(agent: AgentRecord): Promise<AgentCapabilityView[]> {
    const capabilities = await listCapabilities();
    const views: AgentCapabilityView[] = [];

    for (const capability of capabilities) {
      if (capability.status !== "active") {
        continue;
      }
      const grants = await findActiveGrantsForAgentCapability({
        agent_id: agent.id,
        capability_id: capability.id,
      });
      const grant = grants[0];

      views.push({
        name: capability.name,
        display_name: capability.display_name ?? capability.name,
        description: capability.description,
        capability_type: capability.capability_type,
        risk_level: capability.risk_level,
        required_scopes: capability.scopes,
        input_schema: capability.input_schema,
        output_schema: capability.output_schema,
        connection_required: capability.connection_required,
        authorized: grants.length > 0,
        grant_status: grant
          ? ((grant.grant_status as AgentCapabilityView["grant_status"]) ?? "approved")
          : null,
      });
    }

    return views;
  }

  async requestAuthorization(input: {
    agent: AgentRecord;
    body: AgentAuthorizationRequest;
    apiBaseUrl: string;
  }): Promise<AgentAuthorizationResponse> {
    const capabilityName = input.body.capability?.trim();
    if (!capabilityName) {
      throw new ValidationError("capability is required", { error_code: "missing_field" });
    }

    const capability = await findCapabilityByName(capabilityName);
    if (!capability) {
      throw new NotFoundError(`Capability not found: ${capabilityName}`);
    }

    const requestedScopes =
      input.body.requested_scopes && input.body.requested_scopes.length > 0
        ? input.body.requested_scopes
        : capability.scopes;

    const request = await createAuthorizationRequest({
      user_id: `pending:${randomUUID()}`,
      agent_id: input.agent.id,
      requested_capabilities: [capabilityName],
      reason: input.body.reason,
      metadata: {
        requested_scopes: requestedScopes,
        capability_id: capability.id,
        risk_level: capability.risk_level,
      },
    });

    const approvalBase = config.consoleUrl?.replace(/\/+$/, "") ?? input.apiBaseUrl.replace(/\/+$/, "");
    const approvalUrl = `${approvalBase}/approve/${request.id}`;

    return sanitizeAgentResponse({
      authorization_id: request.id,
      approval_url: approvalUrl,
      status: "pending" as const,
    }) as AgentAuthorizationResponse;
  }

  async getAuthorizationStatus(authorizationId: string, agent: AgentRecord) {
    const request = await findAuthorizationRequest(authorizationId);
    if (!request || request.agent_id !== agent.id) {
      throw new NotFoundError("Authorization not found");
    }

    const capability = await findCapabilityByName(request.requested_capabilities[0] ?? "");
    return sanitizeAgentResponse({
      authorization_id: request.id,
      status: request.status,
      capability: request.requested_capabilities[0] ?? null,
      granted_capabilities: request.granted_capabilities,
      expires_at: request.expires_at,
      approved_at: request.approved_at,
      denied_at: request.denied_at,
      capability_details: capability
        ? {
            name: capability.name,
            risk_level: capability.risk_level,
            scopes: capability.scopes,
          }
        : null,
    });
  }

  async approveWithConnection(input: {
    authorizationId: string;
    userId: string;
    connectionId: string;
    grantedScopes?: string[];
    expiresAt?: string;
  }) {
    let request = await findAuthorizationRequest(input.authorizationId);
    if (!request) {
      throw new NotFoundError("Authorization request not found");
    }

    if (isPendingAuthorizationUserId(request.user_id)) {
      const bound = await bindAuthorizationRequestUser({
        id: request.id,
        user_id: input.userId,
      });
      if (!bound) {
        throw new ValidationError("Unable to bind user to authorization request");
      }
      request = bound;
    }

    const capabilityName = request.requested_capabilities[0];
    const capability = capabilityName ? await findCapabilityByName(capabilityName) : null;
    if (!capability) {
      throw new NotFoundError("Capability not found");
    }

    const providerSlug = capability.name.split(".")[0];
    const provider = providerSlug ? await findOAuthProviderBySlug(providerSlug) : null;

    const approved = await approveAuthorizationRequest({
      id: input.authorizationId,
      granted_capabilities: [capability.name],
    });
    if (!approved) {
      throw new ValidationError("Unable to approve authorization request");
    }

    const scopes =
      input.grantedScopes && input.grantedScopes.length > 0
        ? input.grantedScopes
        : capability.scopes;

    const grant = await createGrant({
      user_id: input.userId,
      agent_id: request.agent_id,
      capability_id: capability.id,
      scopes,
      expires_at: input.expiresAt,
      provider_id: provider?.id,
      connection_id: input.connectionId,
      grant_status: "approved",
      metadata: {
        authorization_request_id: request.id,
        connection_id: input.connectionId,
      },
    });

    void emitPlatformWebhook({
      event: "grant.approved",
      payload: {
        grant_id: grant.id,
        agent_id: request.agent_id,
        user_id: input.userId,
        capability: capability.name,
        connection_id: input.connectionId,
        provider_id: provider?.id ?? null,
      },
    });

    return {
      ok: true as const,
      authorization_request: approved,
      grant: {
        id: grant.id,
        capability: capability.name,
        scopes: grant.scopes,
        expires_at: grant.expires_at,
        status: "approved",
      },
    };
  }

  async listGrantsForAgent(agentId: string, userId?: string) {
    const agent = await findAgentById(agentId);
    if (!agent) {
      throw new NotFoundError("Agent not found");
    }
    const { listGrantSummaries } = await import("./v2.repository");
    const grants = await listGrantSummaries(userId ? { user_id: userId, agent_id: agentId } : { agent_id: agentId });
    return grants.map((grant) =>
      sanitizeAgentResponse({
        id: grant.id,
        capability: grant.capability_name,
        agent_name: grant.agent_name,
        scopes: grant.scopes,
        expires_at: grant.expires_at,
        revoked: grant.revoked,
        status: grant.grant_status ?? (grant.revoked ? "revoked" : "approved"),
        connection_id: grant.connection_id,
        provider_id: grant.provider_id,
        last_used_at: grant.last_used_at,
        created_at: grant.created_at,
      }),
    );
  }
}

export const agentAuthorizationV25Service = new AgentAuthorizationV25Service();
