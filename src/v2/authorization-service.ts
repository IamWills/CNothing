import { ConflictError, NotFoundError, ValidationError } from "../utils/errors";
import type { AuthorizationRequestView } from "./v2.entity";
import {
  approveAuthorizationRequest,
  createAuthorizationRequest,
  createGrant,
  denyAuthorizationRequest,
  findAgentById,
  findAuthorizationRequest,
  findCapabilitiesByNames,
  findCapabilityByName,
} from "./v2.repository";

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(`${field} must be a non-empty array`, {
      error_code: "invalid_field",
      field,
    });
  }
  return value.map(String);
}

export class AuthorizationService {
  async createRequest(input: {
    agentId: string;
    userId: string;
    capabilities: string[];
    redirectUri?: string;
    state?: string;
    reason?: string;
    consoleBaseUrl?: string;
    apiBaseUrl: string;
  }) {
    const agent = await findAgentById(input.agentId);
    if (!agent || agent.status !== "active") {
      throw new NotFoundError("Agent not found or inactive");
    }

    const uniqueCapabilities = [...new Set(input.capabilities.map((name) => name.trim()).filter(Boolean))];
    const knownCapabilities = await findCapabilitiesByNames(uniqueCapabilities);
    const knownNames = new Set(knownCapabilities.map((item) => item.name));
    const unknown = uniqueCapabilities.filter((name) => !knownNames.has(name));
    if (unknown.length > 0) {
      throw new ValidationError(`Unknown capabilities: ${unknown.join(", ")}`, {
        error_code: "capability_not_found",
        unknown,
      });
    }

    const request = await createAuthorizationRequest({
      user_id: input.userId,
      agent_id: input.agentId,
      requested_capabilities: uniqueCapabilities,
      redirect_uri: input.redirectUri,
      state: input.state,
      reason: input.reason,
    });

    const approvalBase = input.consoleBaseUrl?.replace(/\/+$/, "") ?? input.apiBaseUrl.replace(/\/+$/, "");
    const approvalPath = input.consoleBaseUrl
      ? `/authorize/${request.id}`
      : `/v2/authorize/${request.id}`;

    return {
      ok: true as const,
      authorization_request: {
        id: request.id,
        status: request.status,
        user_id: request.user_id,
        agent_id: request.agent_id,
        agent_name: agent.name,
        requested_capabilities: request.requested_capabilities,
        expires_at: request.expires_at,
        approval_url: `${approvalBase}${approvalPath}`,
        state: request.state,
      },
    };
  }

  async getRequestView(id: string): Promise<AuthorizationRequestView> {
    const request = await findAuthorizationRequest(id);
    if (!request) {
      throw new NotFoundError("Authorization request not found");
    }

    const agent = await findAgentById(request.agent_id);
    const capabilities = await findCapabilitiesByNames(request.requested_capabilities);

    return {
      ...request,
      agent_name: agent?.name ?? request.agent_id,
      capabilities: capabilities.map((capability) => ({
        name: capability.name,
        description: capability.description,
        capability_type: capability.capability_type,
        risk_level: capability.risk_level,
        scopes: capability.scopes,
      })),
    };
  }

  async approveRequest(input: {
    id: string;
    grantedCapabilities?: string[];
    grantExpiresAt?: string;
  }) {
    const before = await findAuthorizationRequest(input.id);
    if (!before) {
      throw new NotFoundError("Authorization request not found");
    }
    if (before.status === "expired") {
      throw new ConflictError("Authorization request expired");
    }
    if (before.status === "denied") {
      throw new ConflictError("Authorization request was denied");
    }
    if (before.status === "approved") {
      return {
        ok: true as const,
        authorization_request: before,
        grants: [],
      };
    }

    const grantedNames =
      input.grantedCapabilities && input.grantedCapabilities.length > 0
        ? input.grantedCapabilities
        : before.requested_capabilities;

    const approved = await approveAuthorizationRequest({
      id: input.id,
      granted_capabilities: grantedNames,
    });
    if (!approved) {
      throw new ConflictError("Unable to approve authorization request");
    }

    const grants = [];
    for (const capabilityName of approved.granted_capabilities) {
      const capability = await findCapabilityByName(capabilityName);
      if (!capability) {
        continue;
      }
      const grant = await createGrant({
        user_id: approved.user_id,
        agent_id: approved.agent_id,
        capability_id: capability.id,
        scopes: capability.scopes,
        expires_at: input.grantExpiresAt,
        metadata: {
          authorization_request_id: approved.id,
        },
      });
      grants.push({
        ...grant,
        capability: capability.name,
      });
    }

    return {
      ok: true as const,
      authorization_request: approved,
      grants,
    };
  }

  async denyRequest(id: string) {
    const denied = await denyAuthorizationRequest(id);
    if (!denied) {
      throw new ConflictError("Unable to deny authorization request");
    }
    return { ok: true as const, authorization_request: denied };
  }
}
