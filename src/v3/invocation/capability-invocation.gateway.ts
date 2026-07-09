import { createHash, randomUUID } from "node:crypto";
import config from "../../config";
import { ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors";
import type { AgentRecord, CapabilityRecord, JsonObject } from "../../v2/v2.entity";
import {
  findActiveGrant,
  findActiveGrantsForAgentCapability,
  findCapabilityById,
  findCapabilityByName,
  findConnectorById,
  listPolicies,
  touchGrantLastUsed,
  writeInvokeAudit,
} from "../../v2/v2.repository";
import {
  findOAuthConnectionById,
  getConnectionAccessToken,
  hashPayload,
  touchOAuthConnection,
} from "../../v2/oauth.repository";
import { oauthConnectionService } from "../../v2/oauth-connection.service";
import { applyOutputPolicy, evaluatePolicyV25, scopesSatisfied } from "../../v2/policy-engine-v25";
import { sanitizeAgentResponse } from "../../v2/secret-redaction";
import { normalizeTenantId } from "../tenant-context.service";
import { writeTrustAudit } from "../v3.repository";
import type { InvokeGatewayResponse } from "../v3.entity";
import {
  createExecution,
  findExecutionById,
  findExecutionByIdempotency,
  updateExecution,
} from "../gateway.repository";
import { approvalEngine } from "../approval-engine/approval-engine";
import { evaluateCapabilityPolicy, summarizeInputForApproval } from "../policy-engine/policy-engine-v3";
import { resolveWorker } from "../workers";
import { WorkerNotImplementedError } from "../workers/types";

function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function clientMeta(request?: Request): { ip: string | null; user_agent: string | null } {
  if (!request) return { ip: null, user_agent: null };
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || null,
    user_agent: request.headers.get("user-agent"),
  };
}

async function resolveUserId(input: {
  agent: AgentRecord;
  capabilityId: string;
  explicitUserId?: string;
}): Promise<string> {
  if (input.explicitUserId?.trim()) {
    return input.explicitUserId.trim();
  }

  const grants = await findActiveGrantsForAgentCapability({
    agent_id: input.agent.id,
    capability_id: input.capabilityId,
  });
  const userIds = [...new Set(grants.map((g) => g.user_id))];

  if (userIds.length === 1) return userIds[0]!;
  if (userIds.length === 0) {
    throw new ForbiddenError("No active authorization grant for this capability", {
      error_code: "authorization_required",
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
  agentTenantId?: string;
}): Promise<string | null> {
  if (!input.connectionId) {
    if (input.capabilityName.startsWith("github.")) {
      const { resolveGitHubAccessToken } = await import("../../v2/github-credential.service");
      return resolveGitHubAccessToken(input.userId);
    }
    return null;
  }

  let connection = await findOAuthConnectionById(input.connectionId);
  if (!connection || connection.status === "revoked") {
    throw new ForbiddenError("OAuth connection unavailable", {
      error_code: "connection_unavailable",
    });
  }

  if (connection.status === "reconnect_required") {
    throw new ForbiddenError("OAuth connection requires reconnection", {
      error_code: "reconnect_required",
    });
  }

  if (input.agentTenantId) {
    if (normalizeTenantId(connection.tenant_id) !== normalizeTenantId(input.agentTenantId)) {
      throw new ForbiddenError("OAuth connection tenant mismatch", {
        error_code: "tenant_mismatch",
      });
    }
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

async function resolveCapability(idOrName: string): Promise<CapabilityRecord> {
  const byId = await findCapabilityById(idOrName);
  if (byId && !byId.deleted_at) return byId;

  // Alias: github.list_repos -> github.list_repositories
  const aliases: Record<string, string> = {
    "github.list_repos": "github.list_repositories",
    "github.list_repositories": "github.list_repositories",
  };
  const resolvedName = aliases[idOrName] ?? idOrName;
  const byName = await findCapabilityByName(resolvedName);
  if (byName && !byName.deleted_at) return byName;

  throw new NotFoundError(`Capability not found: ${idOrName}`);
}

export class CapabilityInvocationGateway {
  async invoke(input: {
    agent: AgentRecord;
    capability_id: string;
    user_id?: string;
    payload?: JsonObject;
    idempotency_key?: string;
    dry_run?: boolean;
    approval_id?: string;
    request?: Request;
  }): Promise<InvokeGatewayResponse> {
    const { ip, user_agent } = clientMeta(input.request);
    const capability = await resolveCapability(input.capability_id);
    const payload = (input.payload ?? {}) as JsonObject;
    const inputHash = hashPayload(payload);
    const dryRun = Boolean(input.dry_run);
    const inputSummary = summarizeInputForApproval(payload);

    // Special-case: github.oauth.connect returns connect URL without secrets
    if (capability.name === "github.oauth.connect") {
      return this.handleOAuthConnect({
        agent: input.agent,
        capability,
        user_id: input.user_id,
        dryRun,
        ip,
        user_agent,
        inputSummary,
      });
    }

    if (input.idempotency_key) {
      const existing = await findExecutionByIdempotency({
        agent_id: input.agent.id,
        capability_id: capability.id,
        idempotency_key: input.idempotency_key,
      });
      if (existing) {
        return this.responseFromExecution(existing);
      }
    }

    let execution = await createExecution({
      agent_id: input.agent.id,
      user_id: input.user_id ?? null,
      capability_id: capability.id,
      idempotency_key: input.idempotency_key ?? null,
      status: "pending",
      input_hash: inputHash,
      dry_run: dryRun,
      tenant_id: normalizeTenantId(input.agent.tenant_id),
      metadata: { capability_name: capability.name },
    });

    try {
      const connector = await findConnectorById(capability.connector_id);
      if (!connector || connector.status !== "active") {
        throw new NotFoundError(`Connector unavailable for capability: ${capability.name}`);
      }

      const userId = await resolveUserId({
        agent: input.agent,
        capabilityId: capability.id,
        explicitUserId: input.user_id,
      });

      execution =
        (await updateExecution(execution.id, {
          status: "running",
          metadata: { ...execution.metadata, user_id: userId },
        })) ?? execution;

      const grant = await findActiveGrant({
        user_id: userId,
        agent_id: input.agent.id,
        capability_id: capability.id,
      });

      if (!grant) {
        const failed = await this.failExecution({
          executionId: execution.id,
          code: "authorization_required",
          message: "Authorization required for this capability",
          recoverable: true,
          agent: input.agent,
          capability,
          userId,
          ip,
          user_agent,
          inputSummary,
        });
        return failed;
      }

      if (!scopesSatisfied(grant.scopes, capability.scopes)) {
        return this.failExecution({
          executionId: execution.id,
          code: "insufficient_scope",
          message: "Grant scopes insufficient for capability",
          recoverable: true,
          agent: input.agent,
          capability,
          userId,
          ip,
          user_agent,
          inputSummary,
        });
      }

      // Legacy v2.5 policy engine (deny / confirmation)
      const legacyPolicies = await listPolicies();
      const legacyDecision = evaluatePolicyV25(capability, legacyPolicies);
      if (legacyDecision.action === "deny") {
        return this.failExecution({
          executionId: execution.id,
          code: "policy_denied",
          message: legacyDecision.reason ?? "Policy denied this capability invocation",
          recoverable: false,
          agent: input.agent,
          capability,
          userId,
          ip,
          user_agent,
          inputSummary,
        });
      }

      // v3 capability permissions
      const policyDecision = await evaluateCapabilityPolicy({
        agent: input.agent,
        capability,
      });

      if (policyDecision.action === "deny") {
        return this.failExecution({
          executionId: execution.id,
          code: policyDecision.rate_limited ? "rate_limited" : "policy_denied",
          message: policyDecision.reason,
          recoverable: Boolean(policyDecision.rate_limited),
          agent: input.agent,
          capability,
          userId,
          ip,
          user_agent,
          inputSummary,
        });
      }

      // Resume after approval
      let approvalId: string | null = input.approval_id ?? null;
      if (approvalId) {
        const status = await approvalEngine.getApprovalStatus(approvalId);
        if (!status || status.status !== "approved") {
          return this.failExecution({
            executionId: execution.id,
            code: "approval_not_approved",
            message: `Approval status is ${status?.status ?? "missing"}`,
            recoverable: true,
            agent: input.agent,
            capability,
            userId,
            ip,
            user_agent,
            inputSummary,
            approvalId,
          });
        }
      } else if (policyDecision.action === "require_approval") {
        const requirement = await approvalEngine.evaluateRequirement({
          user_id: userId,
          agent: input.agent,
          capability,
          payload,
          forced_policy: policyDecision.force_approval_policy,
        });

        if (requirement.required) {
          const requested = await approvalEngine.requestApproval({
            user_id: userId,
            agent: input.agent,
            capability,
            payload,
            input_hash: inputHash,
            policy: requirement.policy,
          });

          await updateExecution(execution.id, {
            status: "pending_approval",
            approval_id: requested.approval.id,
          });

          await writeTrustAudit({
            event_type: "invocation",
            agent_id: input.agent.id,
            user_id: userId,
            capability_id: capability.id,
            execution_id: execution.id,
            approval_id: requested.approval.id,
            ip,
            user_agent,
            input_summary: inputSummary,
            risk_level: capability.risk_level,
            result: "pending_approval",
          });

          await writeInvokeAudit({
            user_id: userId,
            agent_id: input.agent.id,
            capability_id: capability.id,
            capability_name: capability.name,
            connector_id: connector.id,
            policy_decision: "require_approval",
            status: "pending_approval",
            request_id: execution.id,
            error_code: null,
            input_hash: inputHash,
            success: false,
            risk_level: capability.risk_level,
            metadata: {
              approval_id: requested.approval.id,
              execution_id: execution.id,
              input_summary: inputSummary,
            },
          });

          return sanitizeAgentResponse({
            status: "pending_approval",
            approval_id: requested.approval.id,
            approval_url: requested.approval_url,
            safe_summary: requested.safe_summary,
            execution_id: execution.id,
          });
        }

        approvalId = requirement.reusable?.id ?? null;
      }

      if (dryRun) {
        const result = {
          dry_run: true,
          capability: capability.name,
          policy: policyDecision.action,
          would_execute: true,
        };
        const auditId = randomUUID();
        await updateExecution(execution.id, {
          status: "completed",
          approval_id: approvalId,
          result_hash: hashValue(result),
          result_payload: result as JsonObject,
          finished_at: new Date().toISOString(),
        });
        return sanitizeAgentResponse({
          status: "completed",
          result,
          execution_id: execution.id,
          audit_id: auditId,
        });
      }

      const connectionId =
        grant.connection_id ??
        (typeof grant.metadata.connection_id === "string"
          ? grant.metadata.connection_id
          : null);

      const accessToken = await resolveAccessToken({
        userId,
        connectionId,
        capabilityName: capability.name,
        agentTenantId: input.agent.tenant_id,
      });

      const worker = resolveWorker(capability);
      const workerResult = await worker.execute({
        capability,
        agent: input.agent,
        user_id: userId,
        input: payload,
        access_token: accessToken,
        connection_id: connectionId,
        dry_run: false,
        timeout_ms: worker.timeoutMs(),
      });

      const filtered = applyOutputPolicy({
        result: workerResult.result,
        decision: legacyDecision,
      });
      const sanitized = sanitizeAgentResponse(filtered);
      const auditId = randomUUID();

      await touchGrantLastUsed(grant.id);
      await updateExecution(execution.id, {
        status: "completed",
        approval_id: approvalId,
        result_hash: hashValue(sanitized),
        result_payload: (sanitized && typeof sanitized === "object"
          ? (sanitized as JsonObject)
          : { value: sanitized }) as JsonObject,
        finished_at: new Date().toISOString(),
      });

      await writeInvokeAudit({
        user_id: userId,
        agent_id: input.agent.id,
        capability_id: capability.id,
        capability_name: capability.name,
        connector_id: connector.id,
        policy_decision: policyDecision.action,
        status: "completed",
        request_id: execution.id,
        input_hash: inputHash,
        output_hash: hashValue(sanitized),
        success: true,
        risk_level: capability.risk_level,
        metadata: {
          execution_id: execution.id,
          approval_id: approvalId,
          audit_id: auditId,
          input_summary: inputSummary,
          ip,
          user_agent,
        },
      });

      await writeTrustAudit({
        event_type: "execution",
        agent_id: input.agent.id,
        user_id: userId,
        capability_id: capability.id,
        execution_id: execution.id,
        approval_id: approvalId,
        result_hash: hashValue(sanitized),
        ip,
        user_agent,
        input_summary: inputSummary,
        risk_level: capability.risk_level,
        result: "success",
      });

      return sanitizeAgentResponse({
        status: "completed",
        result: sanitized,
        execution_id: execution.id,
        audit_id: auditId,
      });
    } catch (error) {
      if (error instanceof WorkerNotImplementedError) {
        return this.failExecution({
          executionId: execution.id,
          code: "not_implemented",
          message: error.message,
          recoverable: false,
          agent: input.agent,
          capability,
          ip,
          user_agent,
          inputSummary,
        });
      }

      const code =
        error && typeof error === "object" && "details" in error
          ? String(
              (error as { details?: { error_code?: string } }).details?.error_code ??
                "execution_failed",
            )
          : "execution_failed";
      const message = error instanceof Error ? error.message : String(error);
      const recoverable = code === "reconnect_required" || code === "authorization_required";

      return this.failExecution({
        executionId: execution.id,
        code,
        message,
        recoverable,
        agent: input.agent,
        capability,
        ip,
        user_agent,
        inputSummary,
      });
    }
  }

  async getExecution(executionId: string) {
    const execution = await findExecutionById(executionId);
    if (!execution) return null;
    return sanitizeAgentResponse({
      execution_id: execution.id,
      status: execution.status,
      capability_id: execution.capability_id,
      approval_id: execution.approval_id,
      error_code: execution.error_code,
      error_message: execution.error_message,
      dry_run: execution.dry_run,
      started_at: execution.started_at,
      finished_at: execution.finished_at,
      result: execution.status === "completed" ? execution.result_payload : undefined,
    });
  }

  private async handleOAuthConnect(input: {
    agent: AgentRecord;
    capability: CapabilityRecord;
    user_id?: string;
    dryRun: boolean;
    ip: string | null;
    user_agent: string | null;
    inputSummary: string;
  }): Promise<InvokeGatewayResponse> {
    const base = config.consoleUrl?.replace(/\/+$/, "") ?? config.publicBaseUrl;
    const connectUrl = `${base}/connect?provider=github&agent_id=${encodeURIComponent(input.agent.id)}`;
    const execution = await createExecution({
      agent_id: input.agent.id,
      user_id: input.user_id ?? null,
      capability_id: input.capability.id,
      status: "completed",
      dry_run: input.dryRun,
      metadata: { capability_name: input.capability.name },
    });
    await updateExecution(execution.id, {
      status: "completed",
      result_payload: { connect_url: connectUrl, provider: "github" },
      result_hash: hashValue({ connect_url: connectUrl }),
      finished_at: new Date().toISOString(),
    });

    await writeTrustAudit({
      event_type: "invocation",
      agent_id: input.agent.id,
      user_id: input.user_id ?? null,
      capability_id: input.capability.id,
      execution_id: execution.id,
      ip: input.ip,
      user_agent: input.user_agent,
      input_summary: input.inputSummary,
      risk_level: input.capability.risk_level,
      result: "success",
    });

    return sanitizeAgentResponse({
      status: "completed",
      result: {
        connect_url: connectUrl,
        provider: "github",
        message: "User must complete OAuth connect in browser. Agent never receives tokens.",
      },
      execution_id: execution.id,
      audit_id: randomUUID(),
    });
  }

  private async failExecution(input: {
    executionId: string;
    code: string;
    message: string;
    recoverable: boolean;
    agent: AgentRecord;
    capability: CapabilityRecord;
    userId?: string;
    ip: string | null;
    user_agent: string | null;
    inputSummary: string;
    approvalId?: string | null;
  }): Promise<InvokeGatewayResponse> {
    await updateExecution(input.executionId, {
      status: "failed",
      error_code: input.code,
      error_message: input.message,
      finished_at: new Date().toISOString(),
      approval_id: input.approvalId ?? null,
    });

    await writeInvokeAudit({
      user_id: input.userId ?? null,
      agent_id: input.agent.id,
      capability_id: input.capability.id,
      capability_name: input.capability.name,
      policy_decision: input.code === "policy_denied" ? "deny" : "n/a",
      status: "failed",
      request_id: input.executionId,
      error_code: input.code,
      success: false,
      risk_level: input.capability.risk_level,
      metadata: {
        execution_id: input.executionId,
        input_summary: input.inputSummary,
        ip: input.ip,
        user_agent: input.user_agent,
      },
    });

    await writeTrustAudit({
      event_type: "execution",
      agent_id: input.agent.id,
      user_id: input.userId ?? null,
      capability_id: input.capability.id,
      execution_id: input.executionId,
      approval_id: input.approvalId ?? null,
      ip: input.ip,
      user_agent: input.user_agent,
      input_summary: input.inputSummary,
      risk_level: input.capability.risk_level,
      result: "failed",
      metadata: { error_code: input.code },
    });

    return sanitizeAgentResponse({
      status: "failed",
      error: {
        code: input.code,
        message: input.message,
        recoverable: input.recoverable,
      },
      execution_id: input.executionId,
      audit_id: randomUUID(),
    });
  }

  private responseFromExecution(execution: {
    id: string;
    status: string;
    approval_id: string | null;
    error_code: string | null;
    error_message: string | null;
    result_payload: JsonObject | null;
  }): InvokeGatewayResponse {
    if (execution.status === "pending_approval" && execution.approval_id) {
      const base = config.consoleUrl?.replace(/\/+$/, "") ?? config.publicBaseUrl;
      return sanitizeAgentResponse({
        status: "pending_approval",
        approval_id: execution.approval_id,
        approval_url: `${base}/dashboard/approvals/${execution.approval_id}`,
        safe_summary: "Previously requested approval (idempotent replay)",
        execution_id: execution.id,
      });
    }

    if (execution.status === "completed") {
      return sanitizeAgentResponse({
        status: "completed",
        result: execution.result_payload ?? {},
        execution_id: execution.id,
        audit_id: randomUUID(),
      });
    }

    return sanitizeAgentResponse({
      status: "failed",
      error: {
        code: execution.error_code ?? "execution_failed",
        message: execution.error_message ?? "Execution failed",
        recoverable: execution.error_code === "reconnect_required",
      },
      execution_id: execution.id,
      audit_id: randomUUID(),
    });
  }
}

export const capabilityInvocationGateway = new CapabilityInvocationGateway();

/** Compatibility helper: map legacy /v3/agent/invoke body into gateway. */
export async function invokeViaLegacyAgentApi(input: {
  agent: AgentRecord;
  capability: string;
  user_id?: string;
  payload?: JsonObject;
  request?: Request;
}): Promise<unknown> {
  const response = await capabilityInvocationGateway.invoke({
    agent: input.agent,
    capability_id: input.capability,
    user_id: input.user_id,
    payload: input.payload,
    request: input.request,
  });

  if (response.status === "pending_approval") {
    return {
      ok: false,
      pending_approval: true,
      approval_id: response.approval_id,
      approval_url: response.approval_url,
      safe_summary: response.safe_summary,
      execution_id: response.execution_id,
    };
  }

  if (response.status === "failed") {
    if (response.error.code === "policy_denied") {
      throw new ForbiddenError(response.error.message, { error_code: "policy_denied" });
    }
    if (response.error.code === "reconnect_required") {
      throw new ForbiddenError(response.error.message, { error_code: "reconnect_required" });
    }
    if (response.error.code === "authorization_required") {
      throw new ForbiddenError(response.error.message, {
        error_code: "authorization_required",
      });
    }
    throw new ValidationError(response.error.message, { error_code: response.error.code });
  }

  return {
    ok: true,
    result: response.result,
    execution_id: response.execution_id,
    audit_id: response.audit_id,
  };
}
