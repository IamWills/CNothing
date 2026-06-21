import { randomUUID } from "node:crypto";
import config from "../config";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../utils/errors";
import { signCapabilityGrant } from "./grant-token";
import { evaluatePolicy } from "./policy-engine";
import type {
  AgentRecord,
  InvokeCapabilityInput,
  InvokeCapabilityResult,
  InvokePendingConfirmation,
  JsonObject,
} from "./v2.entity";
import {
  executePlatformCapability,
  PLATFORM_CONNECTOR_PROVIDER,
} from "./platform-connector.executor";
import {
  executeSearchCapability,
} from "./search-connector.executor";
import { SEARCH_CONNECTOR_PROVIDER } from "./search-credential.service";
import {
  confirmPendingConfirmation,
  createPendingConfirmation,
  findActiveGrant,
  findActiveGrantsForAgentCapability,
  findCapabilityByName,
  findConnectorById,
  findPendingConfirmation,
  listPolicies,
  writeInvokeAudit,
} from "./v2.repository";

type InvokeContext = {
  agent: AgentRecord;
  body: InvokeCapabilityInput;
};

async function resolveInvokeUserId(input: {
  agent: AgentRecord;
  capabilityId: string;
  explicitUserId?: string;
}): Promise<string> {
  const explicit = input.explicitUserId?.trim();
  if (explicit) {
    return explicit;
  }

  const grants = await findActiveGrantsForAgentCapability({
    agent_id: input.agent.id,
    capability_id: input.capabilityId,
  });
  const userIds = [...new Set(grants.map((grant) => grant.user_id))];

  if (userIds.length === 1) {
    return userIds[0]!;
  }

  if (userIds.length === 0) {
    throw new ForbiddenError(
      "No active authorization grant for this capability. Call request_authorization and ask the user to open approval_url.",
      {
        error_code: "grant_not_found",
        hint: "Do not ask the user for session_token, user_id, or login_token. Use request_authorization instead.",
      },
    );
  }

  throw new ForbiddenError(
    "Multiple users have granted this capability to this agent. Specify user_id only when disambiguation is required.",
    {
      error_code: "ambiguous_user_grant",
      user_ids: userIds,
    },
  );
}

export class CapabilityService {
  async invoke(context: InvokeContext): Promise<InvokeCapabilityResult | InvokePendingConfirmation> {
    const requestId = context.body.request_id ?? randomUUID();
    const capabilityName = context.body.capability?.trim();
    if (!capabilityName) {
      throw new ValidationError("capability is required", {
        error_code: "missing_field",
        field: "capability",
      });
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
      explicitUserId: context.body.user_id,
    });
    const input = (context.body.input ?? {}) as JsonObject;

    if (context.body.confirmation_id) {
      return this.invokeWithConfirmation({
        context,
        capabilityName,
        capability,
        connector,
        userId,
        input,
        requestId,
      });
    }

    const grant = await findActiveGrant({
      user_id: userId,
      agent_id: context.agent.id,
      capability_id: capability.id,
    });
    if (!grant) {
      await writeInvokeAudit({
        user_id: userId,
        agent_id: context.agent.id,
        capability_id: capability.id,
        capability_name: capabilityName,
        connector_id: connector.id,
        policy_decision: "deny",
        status: "failed",
        request_id: requestId,
        error_code: "grant_not_found",
      });
      throw new ForbiddenError("No active authorization grant for this capability", {
        error_code: "grant_not_found",
        capability: capabilityName,
        user_id: userId,
        agent_id: context.agent.id,
        hint: "Use request_authorization and have the user approve at approval_url. Never ask the user for tokens.",
      });
    }

    const policies = await listPolicies();
    const decision = evaluatePolicy(capability, policies);

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
        metadata: { reason: decision.reason },
      });
      throw new ForbiddenError(decision.reason ?? "Policy denied this capability invocation", {
        error_code: "policy_denied",
        policy_decision: decision,
      });
    }

    if (
      decision.action === "require_user_confirmation" ||
      decision.action === "require_step_up_auth" ||
      decision.action === "require_explicit_reason"
    ) {
      if (decision.action === "require_explicit_reason" && !context.body.reason?.trim()) {
        throw new ValidationError("reason is required for this capability", {
          error_code: "missing_reason",
        });
      }

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
        metadata: { confirmation_id: pending.id },
      });

      return {
        ok: false,
        pending: true,
        confirmation_id: pending.id,
        policy_decision: decision,
        expires_at: pending.expires_at,
        message: "User confirmation required before executing this capability",
      };
    }

    return this.executeViaConnector({
      agent: context.agent,
      userId,
      capability,
      connector,
      input,
      grantScopes: grant.scopes,
      requestId,
      policyDecision: decision.action,
    });
  }

  private async invokeWithConfirmation(input: {
    context: InvokeContext;
    capabilityName: string;
    capability: Awaited<ReturnType<typeof findCapabilityByName>>;
    connector: NonNullable<Awaited<ReturnType<typeof findConnectorById>>>;
    userId: string;
    input: JsonObject;
    requestId: string;
  }): Promise<InvokeCapabilityResult> {
    if (!input.capability) {
      throw new NotFoundError(`Capability not found: ${input.capabilityName}`);
    }

    const confirmationId = input.context.body.confirmation_id?.trim();
    if (!confirmationId) {
      throw new ValidationError("confirmation_id is required", {
        error_code: "missing_field",
        field: "confirmation_id",
      });
    }

    const pending = await findPendingConfirmation(confirmationId);
    if (!pending) {
      throw new NotFoundError("Confirmation request not found");
    }
    if (pending.agent_id !== input.context.agent.id || pending.capability_id !== input.capability.id) {
      throw new ForbiddenError("Confirmation does not match this agent or capability");
    }
    if (pending.rejected_at) {
      throw new ConflictError("Confirmation was rejected");
    }
    if (pending.expires_at <= new Date().toISOString()) {
      throw new ConflictError("Confirmation expired");
    }

    const confirmed = pending.confirmed_at
      ? pending
      : await confirmPendingConfirmation(confirmationId);
    if (!confirmed?.confirmed_at) {
      throw new ConflictError("Confirmation not yet approved by user", {
        error_code: "confirmation_pending",
        confirmation_id: confirmationId,
      });
    }

    const grant = await findActiveGrant({
      user_id: input.userId,
      agent_id: input.context.agent.id,
      capability_id: input.capability.id,
    });
    if (!grant) {
      throw new ForbiddenError("No active authorization grant for this capability", {
        error_code: "grant_not_found",
      });
    }

    return this.executeViaConnector({
      agent: input.context.agent,
      userId: input.userId,
      capability: input.capability,
      connector: input.connector,
      input: pending.input,
      grantScopes: grant.scopes,
      requestId: input.requestId,
      policyDecision: "require_user_confirmation",
    });
  }

  private async executeViaConnector(input: {
    agent: AgentRecord;
    userId: string;
    capability: NonNullable<Awaited<ReturnType<typeof findCapabilityByName>>>;
    connector: NonNullable<Awaited<ReturnType<typeof findConnectorById>>>;
    input: JsonObject;
    grantScopes: string[];
    requestId: string;
    policyDecision: string;
  }): Promise<InvokeCapabilityResult> {
    const effectiveScopes =
      input.grantScopes.length > 0 ? input.grantScopes : input.capability.scopes;

    const grantToken = signCapabilityGrant({
      privateKeyPem: config.authaiPrivateKeyPem,
      keyId: config.authaiKeyId,
      payload: {
        iss: "cnothing",
        sub: `agent:${input.agent.id}`,
        aud: input.connector.id,
        user: input.userId,
        capability: input.capability.name,
        scope: effectiveScopes,
        exp: Math.floor(Date.now() / 1000) + 120,
      },
      ttlSeconds: 120,
    });

    let connectorResult: unknown;
    try {
      if (input.connector.provider === PLATFORM_CONNECTOR_PROVIDER) {
        connectorResult = await executePlatformCapability({
          capability: input.capability.name,
          input: input.input,
          user_id: input.userId,
          agent_id: input.agent.id,
        });
      } else if (input.connector.provider === SEARCH_CONNECTOR_PROVIDER) {
        connectorResult = await executeSearchCapability({
          capability: input.capability.name,
          input: input.input,
          user_id: input.userId,
          agent_id: input.agent.id,
        });
      } else {
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
            agent_id: input.agent.id,
          }),
        });

        const text = await response.text();
        const parsed = text ? (JSON.parse(text) as unknown) : null;
        if (!response.ok) {
          const message =
            parsed && typeof parsed === "object" && "error" in parsed
              ? String((parsed as { error?: { message?: string } }).error?.message ?? "Connector error")
              : `Connector returned ${response.status}`;
          throw new Error(message);
        }
        connectorResult =
          parsed && typeof parsed === "object" && "result" in parsed
            ? (parsed as { result: unknown }).result
            : parsed;
      }
    } catch (error) {
      await writeInvokeAudit({
        user_id: input.userId,
        agent_id: input.agent.id,
        capability_id: input.capability.id,
        capability_name: input.capability.name,
        connector_id: input.connector.id,
        policy_decision: input.policyDecision,
        status: "failed",
        request_id: input.requestId,
        error_code: "connector_error",
        metadata: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }

    await writeInvokeAudit({
      user_id: input.userId,
      agent_id: input.agent.id,
      capability_id: input.capability.id,
      capability_name: input.capability.name,
      connector_id: input.connector.id,
      policy_decision: input.policyDecision,
      status: "success",
      request_id: input.requestId,
    });

    return {
      ok: true,
      request_id: input.requestId,
      capability: input.capability.name,
      result: connectorResult,
    };
  }
}
