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
  hashPayload,
  touchOAuthConnection,
} from "../../v2/oauth.repository";
import { oauthConnectionService } from "../../v2/oauth-connection.service";
import { applyOutputPolicy, evaluatePolicyV25, scopesSatisfied } from "../../v2/policy-engine-v25";
import { normalizeTenantId } from "../tenant-context.service";
import type { InvokeGatewayResponse } from "../v3.entity";
import {
  cancelApproval,
  createExecution,
  createWorkerRun,
  findApprovalById,
  findExecutionById,
  findExecutionByIdempotency,
  finishWorkerRun,
  updateExecution,
} from "../gateway.repository";
import { approvalEngine } from "../approval-engine/approval-engine";
import {
  evaluateCapabilityPolicy,
  publicPolicyDecision,
  summarizeInputForApproval,
} from "../policy-engine/policy-engine-v3";
import { resolveWorker } from "../workers";
import { WorkerNotImplementedError } from "../workers/types";
import {
  appendAuditChainEvent,
  createAuditChainId,
} from "../audit/audit-chain";
import { sanitizeAgentFacing, sanitizeWorkerResult } from "../sanitizer/sanitizer";

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

function connectUrlForProvider(provider = "github", agentId?: string): string {
  const base = config.consoleUrl?.replace(/\/+$/, "") ?? config.publicBaseUrl;
  const qs = new URLSearchParams({ provider });
  if (agentId) qs.set("agent_id", agentId);
  return `${base}/connect?${qs.toString()}`;
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

async function ensureConnectionReady(input: {
  userId: string;
  connectionId: string | null;
  capabilityName: string;
  agentTenantId?: string;
}): Promise<void> {
  if (!input.connectionId) {
    // Legacy github credential path is resolved inside OAuthApiWorker
    if (input.capabilityName.startsWith("github.")) {
      return;
    }
    return;
  }

  let connection = await findOAuthConnectionById(input.connectionId);
  if (!connection || connection.status === "revoked") {
    throw new ForbiddenError("OAuth connection unavailable", {
      error_code: "reconnect_required",
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

  // Server-side refresh only — plaintext never returned to gateway
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
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`Worker timed out after ${ms}ms`);
      (err as Error & { details?: { error_code: string } }).details = {
        error_code: "timeout",
      };
      reject(err);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function resolveCapability(idOrName: string): Promise<CapabilityRecord> {
  const byId = await findCapabilityById(idOrName);
  if (byId && !byId.deleted_at) return byId;

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
    timeout_ms?: number;
    reason?: string;
    trace_id?: string;
    request?: Request;
  }): Promise<InvokeGatewayResponse> {
    const { ip, user_agent } = clientMeta(input.request);
    const capability = await resolveCapability(input.capability_id);
    const payload = (input.payload ?? {}) as JsonObject;
    const inputHash = hashPayload(payload);
    const dryRun = Boolean(input.dry_run);
    const inputSummary = summarizeInputForApproval(payload);
    const auditChainId = createAuditChainId();
    const safeInput = sanitizeAgentFacing(payload) as JsonObject;
    const reason = input.reason?.trim() || null;
    const traceId = input.trace_id?.trim() || null;
    const timeoutMsRequested =
      typeof input.timeout_ms === "number" && input.timeout_ms > 0
        ? Math.min(Math.trunc(input.timeout_ms), 300_000)
        : null;

    if (capability.name === "github.oauth.connect") {
      return this.handleOAuthConnect({
        agent: input.agent,
        capability,
        user_id: input.user_id,
        dryRun,
        ip,
        user_agent,
        inputSummary,
        auditChainId,
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
      status: "created",
      input_hash: inputHash,
      dry_run: dryRun,
      tenant_id: normalizeTenantId(input.agent.tenant_id),
      audit_chain_id: auditChainId,
      safe_input: safeInput,
      metadata: {
        capability_name: capability.name,
        ...(reason ? { reason } : {}),
        ...(traceId ? { trace_id: traceId } : {}),
        ...(timeoutMsRequested ? { timeout_ms: timeoutMsRequested } : {}),
      },
    });

    await appendAuditChainEvent({
      audit_chain_id: auditChainId,
      event_type: "capability_invoked",
      execution_id: execution.id,
      agent_id: input.agent.id,
      user_id: input.user_id ?? null,
      capability_id: capability.id,
      input_summary: inputSummary,
      risk_level: capability.risk_level,
      ip,
      user_agent,
      result: "created",
      metadata: {
        dry_run: dryRun,
        capability_name: capability.name,
        ...(reason ? { reason } : {}),
        ...(traceId ? { trace_id: traceId } : {}),
      },
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
          status: "policy_checking",
          user_id: userId,
          metadata: { ...execution.metadata, user_id: userId },
        })) ?? execution;

      const grant = await findActiveGrant({
        user_id: userId,
        agent_id: input.agent.id,
        capability_id: capability.id,
      });

      if (!grant) {
        return this.failExecution({
          executionId: execution.id,
          auditChainId,
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
      }

      if (!scopesSatisfied(grant.scopes, capability.scopes)) {
        return this.failExecution({
          executionId: execution.id,
          auditChainId,
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

      // Legacy v2.5 policy (deny still applies)
      const legacyPolicies = await listPolicies();
      const legacyDecision = evaluatePolicyV25(capability, legacyPolicies);
      if (legacyDecision.action === "deny") {
        return this.denyExecution({
          executionId: execution.id,
          auditChainId,
          message: legacyDecision.reason ?? "Policy denied this capability invocation",
          agent: input.agent,
          capability,
          userId,
          ip,
          user_agent,
          inputSummary,
          policyDecision: {
            decision: "deny",
            reason: legacyDecision.reason ?? "legacy deny",
            matched_policy_id: null,
            risk_level: "critical",
          },
        });
      }

      // Independent Policy Engine (deny beats grant allow)
      const policyDecision = await evaluateCapabilityPolicy({
        agent: input.agent,
        capability,
        payload,
      });

      await updateExecution(execution.id, {
        policy_decision: publicPolicyDecision(policyDecision) as unknown as JsonObject,
      });

      await appendAuditChainEvent({
        audit_chain_id: auditChainId,
        event_type: "policy_evaluated",
        execution_id: execution.id,
        agent_id: input.agent.id,
        user_id: userId,
        capability_id: capability.id,
        policy_id: policyDecision.matched_policy_id,
        input_summary: inputSummary,
        risk_level: policyDecision.risk_level,
        ip,
        user_agent,
        result: policyDecision.decision,
        metadata: publicPolicyDecision(policyDecision) as unknown as JsonObject,
      });

      if (policyDecision.decision === "deny") {
        return this.denyExecution({
          executionId: execution.id,
          auditChainId,
          message: policyDecision.reason,
          agent: input.agent,
          capability,
          userId,
          ip,
          user_agent,
          inputSummary,
          policyDecision: publicPolicyDecision(policyDecision),
          rateLimited: policyDecision.rate_limited,
        });
      }

      if (policyDecision.decision === "require_reauth") {
        return this.reconnectResponse({
          executionId: execution.id,
          auditChainId,
          agent: input.agent,
          capability,
          userId,
          ip,
          user_agent,
          inputSummary,
          message: policyDecision.reason,
        });
      }

      // Resume after approval
      let approvalId: string | null = input.approval_id ?? null;
      if (approvalId) {
        const status = await approvalEngine.getApprovalStatus(approvalId);
        if (!status || status.status !== "approved") {
          return this.failExecution({
            executionId: execution.id,
            auditChainId,
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
        await updateExecution(execution.id, { status: "approved", approval_id: approvalId });
        await appendAuditChainEvent({
          audit_chain_id: auditChainId,
          event_type: "approval_approved",
          execution_id: execution.id,
          agent_id: input.agent.id,
          user_id: userId,
          capability_id: capability.id,
          approval_id: approvalId,
          result: "approved",
          input_summary: inputSummary,
          risk_level: capability.risk_level,
        });
      } else if (policyDecision.decision === "require_approval") {
        const requirement = await approvalEngine.evaluateRequirement({
          user_id: userId,
          agent: input.agent,
          capability,
          payload,
          forced_policy: policyDecision.force_approval_policy,
        });

        if (requirement.required) {
          // dry_run: preview approval requirement without creating an approval or side effects
          if (dryRun) {
            return this.completeDryRun({
              executionId: execution.id,
              auditChainId,
              capability,
              policyDecision: publicPolicyDecision(policyDecision),
              approvalRequired: true,
              approvalPolicy: requirement.policy,
              inputSummary,
              timeoutMs: timeoutMsRequested,
              reason,
            });
          }

          const requested = await approvalEngine.requestApproval({
            user_id: userId,
            agent: input.agent,
            capability,
            payload,
            input_hash: inputHash,
            policy: requirement.policy,
            execution_id: execution.id,
            policy_id: policyDecision.matched_policy_id,
          });

          await updateExecution(execution.id, {
            status: "pending_approval",
            approval_id: requested.approval.id,
          });

          await appendAuditChainEvent({
            audit_chain_id: auditChainId,
            event_type: "approval_requested",
            execution_id: execution.id,
            agent_id: input.agent.id,
            user_id: userId,
            capability_id: capability.id,
            approval_id: requested.approval.id,
            policy_id: policyDecision.matched_policy_id,
            input_summary: inputSummary,
            risk_level: policyDecision.risk_level,
            ip,
            user_agent,
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
              audit_chain_id: auditChainId,
              input_summary: inputSummary,
            },
          });

          return sanitizeAgentFacing({
            status: "pending_approval",
            approval_id: requested.approval.id,
            approval_url: requested.approval_url,
            safe_summary: requested.safe_summary,
            execution_id: execution.id,
            audit_chain_id: auditChainId,
          });
        }

        approvalId = requirement.reusable?.id ?? null;
      }

      if (dryRun) {
        return this.completeDryRun({
          executionId: execution.id,
          auditChainId,
          capability,
          policyDecision: publicPolicyDecision(policyDecision),
          approvalRequired: false,
          approvalPolicy: null,
          inputSummary,
          timeoutMs: timeoutMsRequested,
          reason,
          approvalId,
        });
      }

      const connectionId =
        grant.connection_id ??
        (typeof grant.metadata.connection_id === "string"
          ? grant.metadata.connection_id
          : null);

      try {
        await ensureConnectionReady({
          userId,
          connectionId,
          capabilityName: capability.name,
          agentTenantId: input.agent.tenant_id,
        });
      } catch (error) {
        const code =
          error && typeof error === "object" && "details" in error
            ? String(
                (error as { details?: { error_code?: string } }).details?.error_code ?? "",
              )
            : "";
        if (code === "reconnect_required") {
          return this.reconnectResponse({
            executionId: execution.id,
            auditChainId,
            agent: input.agent,
            capability,
            userId,
            ip,
            user_agent,
            inputSummary,
            message:
              error instanceof Error
                ? error.message
                : "OAuth connection requires reconnection",
          });
        }
        throw error;
      }

      const secretRefs = connectionId
        ? [`connection:${connectionId}:oauth_access_token`]
        : capability.name.startsWith("github.")
          ? [`user:${userId}:github_oauth`]
          : [];

      const worker = resolveWorker(capability);
      const timeoutMs = timeoutMsRequested ?? worker.timeoutMs();

      await updateExecution(execution.id, {
        status: "running",
        approval_id: approvalId,
        connection_id: connectionId,
        worker_type: worker.name,
        provider_id: capability.provider_id,
      });

      const workerRunId = await createWorkerRun({
        execution_id: execution.id,
        worker_type: worker.name,
        status: "running",
      });

      await appendAuditChainEvent({
        audit_chain_id: auditChainId,
        event_type: "worker_started",
        execution_id: execution.id,
        agent_id: input.agent.id,
        user_id: userId,
        capability_id: capability.id,
        result: worker.name,
        metadata: { worker_type: worker.name, timeout_ms: timeoutMs },
      });

      const workerResult = await withTimeout(
        worker.execute({
          execution_id: execution.id,
          capability,
          agent: input.agent,
          user_id: userId,
          input: payload,
          safe_input: safeInput,
          // Plaintext never crosses gateway → worker boundary
          access_token: null,
          secret_refs: secretRefs,
          connection_id: connectionId,
          policy_decision: publicPolicyDecision(policyDecision),
          approval_id: approvalId,
          dry_run: false,
          timeout_ms: timeoutMs,
          audit_chain_id: auditChainId,
        }),
        timeoutMs,
      );

      await appendAuditChainEvent({
        audit_chain_id: auditChainId,
        event_type: "third_party_called",
        execution_id: execution.id,
        agent_id: input.agent.id,
        user_id: userId,
        capability_id: capability.id,
        result: "ok",
        metadata: { worker_type: worker.name },
      });

      const filtered = applyOutputPolicy({
        result: workerResult.result,
        decision: legacyDecision,
      });
      const sanitized = sanitizeWorkerResult(filtered);

      await appendAuditChainEvent({
        audit_chain_id: auditChainId,
        event_type: "result_sanitized",
        execution_id: execution.id,
        agent_id: input.agent.id,
        user_id: userId,
        capability_id: capability.id,
        result: "ok",
        result_hash: hashValue(sanitized),
      });

      const auditId = randomUUID();
      const now = new Date().toISOString();
      await touchGrantLastUsed(grant.id);
      await finishWorkerRun({ id: workerRunId, status: "completed" });
      await updateExecution(execution.id, {
        status: "completed",
        approval_id: approvalId,
        result_hash: hashValue(sanitized),
        result_payload: (sanitized && typeof sanitized === "object"
          ? (sanitized as JsonObject)
          : { value: sanitized }) as JsonObject,
        sanitized_output: (sanitized && typeof sanitized === "object"
          ? (sanitized as JsonObject)
          : { value: sanitized }) as JsonObject,
        finished_at: now,
        completed_at: now,
      });

      if (approvalId) {
        await approvalEngine.markConsumed(approvalId);
      }

      await writeInvokeAudit({
        user_id: userId,
        agent_id: input.agent.id,
        capability_id: capability.id,
        capability_name: capability.name,
        connector_id: connector.id,
        policy_decision: policyDecision.decision,
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
          audit_chain_id: auditChainId,
          input_summary: inputSummary,
          ip,
          user_agent,
        },
      });

      await appendAuditChainEvent({
        audit_chain_id: auditChainId,
        event_type: "execution_completed",
        execution_id: execution.id,
        agent_id: input.agent.id,
        user_id: userId,
        capability_id: capability.id,
        approval_id: approvalId,
        result: "success",
        result_hash: hashValue(sanitized),
        input_summary: inputSummary,
        risk_level: capability.risk_level,
        ip,
        user_agent,
      });

      return sanitizeAgentFacing({
        status: "completed",
        result: sanitized,
        execution_id: execution.id,
        audit_id: auditId,
        audit_chain_id: auditChainId,
      });
    } catch (error) {
      if (error instanceof WorkerNotImplementedError) {
        return this.failExecution({
          executionId: execution.id,
          auditChainId,
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

      if (code === "timeout") {
        const now = new Date().toISOString();
        await updateExecution(execution.id, {
          status: "timeout",
          error_code: "timeout",
          error_message: message,
          finished_at: now,
          completed_at: now,
        });
        await appendAuditChainEvent({
          audit_chain_id: auditChainId,
          event_type: "execution_failed",
          execution_id: execution.id,
          agent_id: input.agent.id,
          capability_id: capability.id,
          result: "timeout",
          metadata: { error_code: "timeout" },
        });
        return sanitizeAgentFacing({
          status: "failed",
          execution_id: execution.id,
          audit_chain_id: auditChainId,
          error: {
            code: "timeout",
            message,
            recoverable: true,
          },
        });
      }

      if (code === "reconnect_required") {
        return this.reconnectResponse({
          executionId: execution.id,
          auditChainId,
          agent: input.agent,
          capability,
          userId: input.user_id,
          ip,
          user_agent,
          inputSummary,
          message,
        });
      }

      const recoverable = code === "authorization_required";
      return this.failExecution({
        executionId: execution.id,
        auditChainId,
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
    return sanitizeAgentFacing({
      execution_id: execution.id,
      status: execution.status,
      agent_id: execution.agent_id,
      user_id: execution.user_id,
      capability_id: execution.capability_id,
      provider_id: execution.provider_id,
      connection_id: execution.connection_id,
      approval_id: execution.approval_id,
      policy_decision: execution.policy_decision,
      worker_type: execution.worker_type,
      idempotency_key: execution.idempotency_key,
      error_code: execution.error_code,
      error_message: execution.error_message,
      dry_run: execution.dry_run,
      started_at: execution.started_at,
      completed_at: execution.completed_at ?? execution.finished_at,
      audit_chain_id: execution.audit_chain_id,
      result: execution.status === "completed" ? execution.sanitized_output ?? execution.result_payload : undefined,
    });
  }

  /**
   * Cancel a non-terminal execution. Agents may only cancel their own executions.
   */
  async cancelExecution(input: {
    execution_id: string;
    agent_id?: string;
    user_id?: string;
    reason?: string;
  }) {
    const execution = await findExecutionById(input.execution_id);
    if (!execution) return null;

    if (input.agent_id && execution.agent_id !== input.agent_id) {
      throw new ForbiddenError("Not allowed to cancel this execution", {
        error_code: "execution_forbidden",
      });
    }
    if (input.user_id && execution.user_id && execution.user_id !== input.user_id) {
      throw new ForbiddenError("Not allowed to cancel this execution", {
        error_code: "execution_forbidden",
      });
    }

    const cancellable = new Set([
      "created",
      "pending",
      "policy_checking",
      "pending_approval",
      "approved",
      "running",
    ]);
    if (!cancellable.has(execution.status)) {
      throw new ValidationError(
        `Execution status '${execution.status}' cannot be cancelled`,
        { error_code: "execution_not_cancellable", status: execution.status },
      );
    }

    const now = new Date().toISOString();
    await updateExecution(execution.id, {
      status: "cancelled",
      error_code: "cancelled",
      error_message: input.reason?.trim() || "Cancelled by caller",
      finished_at: now,
      completed_at: now,
    });

    if (execution.approval_id) {
      const approval = await findApprovalById(execution.approval_id);
      if (approval?.status === "pending") {
        await cancelApproval(execution.approval_id);
      }
    }

    if (execution.audit_chain_id) {
      await appendAuditChainEvent({
        audit_chain_id: execution.audit_chain_id,
        event_type: "execution_failed",
        execution_id: execution.id,
        agent_id: execution.agent_id,
        user_id: execution.user_id,
        capability_id: execution.capability_id,
        approval_id: execution.approval_id,
        result: "cancelled",
        metadata: { reason: input.reason ?? null },
      });
    }

    return this.getExecution(execution.id);
  }

  /**
   * Retry a failed/timeout/cancelled/reconnect_required execution by re-invoking
   * with the stored safe_input. Returns a new execution lifecycle response.
   */
  async retryExecution(input: {
    execution_id: string;
    agent: AgentRecord;
    request?: Request;
  }): Promise<InvokeGatewayResponse> {
    const execution = await findExecutionById(input.execution_id);
    if (!execution) {
      throw new NotFoundError("Execution not found");
    }
    if (execution.agent_id !== input.agent.id) {
      throw new ForbiddenError("Not allowed to retry this execution", {
        error_code: "execution_forbidden",
      });
    }

    const retryable = new Set(["failed", "timeout", "cancelled", "reconnect_required"]);
    if (!retryable.has(execution.status)) {
      throw new ValidationError(
        `Execution status '${execution.status}' cannot be retried`,
        { error_code: "execution_not_retryable", status: execution.status },
      );
    }

    const payload = (execution.safe_input ?? {}) as JsonObject;
    return this.invoke({
      agent: input.agent,
      capability_id: execution.capability_id,
      user_id: execution.user_id ?? undefined,
      payload,
      dry_run: execution.dry_run,
      request: input.request,
      // new idempotency: do not reuse old key
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
    auditChainId: string;
  }): Promise<InvokeGatewayResponse> {
    const connectUrl = connectUrlForProvider("github", input.agent.id);
    const execution = await createExecution({
      agent_id: input.agent.id,
      user_id: input.user_id ?? null,
      capability_id: input.capability.id,
      status: "completed",
      dry_run: input.dryRun,
      audit_chain_id: input.auditChainId,
      metadata: { capability_name: input.capability.name },
    });
    const now = new Date().toISOString();
    await updateExecution(execution.id, {
      status: "completed",
      result_payload: { connect_url: connectUrl, provider: "github" },
      sanitized_output: { connect_url: connectUrl, provider: "github" },
      result_hash: hashValue({ connect_url: connectUrl }),
      finished_at: now,
      completed_at: now,
    });

    await appendAuditChainEvent({
      audit_chain_id: input.auditChainId,
      event_type: "capability_invoked",
      execution_id: execution.id,
      agent_id: input.agent.id,
      user_id: input.user_id ?? null,
      capability_id: input.capability.id,
      ip: input.ip,
      user_agent: input.user_agent,
      input_summary: input.inputSummary,
      risk_level: input.capability.risk_level,
      result: "success",
    });

    return sanitizeAgentFacing({
      status: "completed",
      result: {
        connect_url: connectUrl,
        provider: "github",
        message: "User must complete OAuth connect in browser. Agent never receives tokens.",
      },
      execution_id: execution.id,
      audit_id: randomUUID(),
      audit_chain_id: input.auditChainId,
    });
  }

  private async denyExecution(input: {
    executionId: string;
    auditChainId: string;
    message: string;
    agent: AgentRecord;
    capability: CapabilityRecord;
    userId?: string;
    ip: string | null;
    user_agent: string | null;
    inputSummary: string;
    policyDecision: {
      decision: string;
      reason: string;
      matched_policy_id: string | null;
      risk_level: string;
    };
    rateLimited?: boolean;
  }): Promise<InvokeGatewayResponse> {
    const now = new Date().toISOString();
    await updateExecution(input.executionId, {
      status: "denied",
      error_code: input.rateLimited ? "rate_limited" : "policy_denied",
      error_message: input.message,
      policy_decision: input.policyDecision as unknown as JsonObject,
      finished_at: now,
      completed_at: now,
    });

    await appendAuditChainEvent({
      audit_chain_id: input.auditChainId,
      event_type: "execution_denied",
      execution_id: input.executionId,
      agent_id: input.agent.id,
      user_id: input.userId ?? null,
      capability_id: input.capability.id,
      policy_id: input.policyDecision.matched_policy_id,
      ip: input.ip,
      user_agent: input.user_agent,
      input_summary: input.inputSummary,
      risk_level: input.policyDecision.risk_level,
      result: "denied",
      metadata: input.policyDecision as unknown as JsonObject,
    });

    await writeInvokeAudit({
      user_id: input.userId ?? null,
      agent_id: input.agent.id,
      capability_id: input.capability.id,
      capability_name: input.capability.name,
      policy_decision: "deny",
      status: "denied",
      request_id: input.executionId,
      error_code: "policy_denied",
      success: false,
      risk_level: input.capability.risk_level,
      metadata: {
        execution_id: input.executionId,
        audit_chain_id: input.auditChainId,
        input_summary: input.inputSummary,
      },
    });

    return sanitizeAgentFacing({
      status: "denied",
      execution_id: input.executionId,
      audit_chain_id: input.auditChainId,
      error: {
        code: input.rateLimited ? "rate_limited" : "policy_denied",
        message: input.message,
        recoverable: false,
      },
    });
  }

  private async reconnectResponse(input: {
    executionId: string;
    auditChainId: string;
    agent: AgentRecord;
    capability: CapabilityRecord;
    userId?: string;
    ip: string | null;
    user_agent: string | null;
    inputSummary: string;
    message: string;
  }): Promise<InvokeGatewayResponse> {
    const connectionUrl = connectUrlForProvider(
      input.capability.provider ?? "github",
      input.agent.id,
    );
    const now = new Date().toISOString();
    await updateExecution(input.executionId, {
      status: "reconnect_required",
      error_code: "reconnect_required",
      error_message: input.message,
      finished_at: now,
      completed_at: now,
    });

    await appendAuditChainEvent({
      audit_chain_id: input.auditChainId,
      event_type: "reconnect_required",
      execution_id: input.executionId,
      agent_id: input.agent.id,
      user_id: input.userId ?? null,
      capability_id: input.capability.id,
      ip: input.ip,
      user_agent: input.user_agent,
      input_summary: input.inputSummary,
      risk_level: input.capability.risk_level,
      result: "reconnect_required",
    });

    return sanitizeAgentFacing({
      status: "reconnect_required",
      execution_id: input.executionId,
      connection_url: connectionUrl,
      audit_chain_id: input.auditChainId,
      error: {
        code: "reconnect_required",
        message: input.message,
        recoverable: true,
      },
    });
  }

  private async completeDryRun(input: {
    executionId: string;
    auditChainId: string;
    capability: CapabilityRecord;
    policyDecision: ReturnType<typeof publicPolicyDecision>;
    approvalRequired: boolean;
    approvalPolicy: string | null;
    inputSummary: string;
    timeoutMs: number | null;
    reason: string | null;
    approvalId?: string | null;
  }): Promise<InvokeGatewayResponse> {
    let workerType: string | null = null;
    try {
      workerType = resolveWorker(input.capability).name;
    } catch {
      workerType = input.capability.execution_type ?? null;
    }

    const result = {
      dry_run: true as const,
      capability: input.capability.name,
      policy: input.policyDecision,
      approval_required: input.approvalRequired,
      approval_policy: input.approvalPolicy,
      would_execute: !input.approvalRequired,
      safe_summary: input.inputSummary,
      reason: input.reason,
      execution_plan: {
        worker_type: workerType,
        execution_type: input.capability.execution_type ?? null,
        risk_level: input.capability.risk_level,
        timeout_ms: input.timeoutMs,
      },
      estimated_impact: {
        side_effects: !input.approvalRequired,
        requires_human_approval: input.approvalRequired,
        requires_oauth: Boolean(input.capability.provider_id),
        scopes: input.capability.scopes ?? [],
      },
    };

    const auditId = randomUUID();
    const now = new Date().toISOString();
    await updateExecution(input.executionId, {
      status: "completed",
      approval_id: input.approvalId ?? null,
      result_hash: hashValue(result),
      result_payload: result as JsonObject,
      sanitized_output: result as JsonObject,
      finished_at: now,
      completed_at: now,
    });
    await appendAuditChainEvent({
      audit_chain_id: input.auditChainId,
      event_type: "execution_completed",
      execution_id: input.executionId,
      capability_id: input.capability.id,
      result: "dry_run",
      input_summary: input.inputSummary,
      risk_level: input.capability.risk_level,
      metadata: {
        approval_required: input.approvalRequired,
        policy: input.policyDecision,
      },
    });

    return sanitizeAgentFacing({
      status: "completed",
      result,
      execution_id: input.executionId,
      audit_id: auditId,
      audit_chain_id: input.auditChainId,
    });
  }

  private async failExecution(input: {
    executionId: string;
    auditChainId: string;
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
    const now = new Date().toISOString();
    await updateExecution(input.executionId, {
      status: "failed",
      error_code: input.code,
      error_message: input.message,
      finished_at: now,
      completed_at: now,
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
        audit_chain_id: input.auditChainId,
        input_summary: input.inputSummary,
        ip: input.ip,
        user_agent: input.user_agent,
      },
    });

    await appendAuditChainEvent({
      audit_chain_id: input.auditChainId,
      event_type: "execution_failed",
      execution_id: input.executionId,
      agent_id: input.agent.id,
      user_id: input.userId ?? null,
      capability_id: input.capability.id,
      approval_id: input.approvalId ?? null,
      ip: input.ip,
      user_agent: input.user_agent,
      input_summary: input.inputSummary,
      risk_level: input.capability.risk_level,
      result: "failed",
      metadata: { error_code: input.code },
    });

    return sanitizeAgentFacing({
      status: "failed",
      error: {
        code: input.code,
        message: input.message,
        recoverable: input.recoverable,
      },
      execution_id: input.executionId,
      audit_id: randomUUID(),
      audit_chain_id: input.auditChainId,
    });
  }

  private responseFromExecution(execution: {
    id: string;
    status: string;
    approval_id: string | null;
    error_code: string | null;
    error_message: string | null;
    result_payload: JsonObject | null;
    sanitized_output?: JsonObject | null;
    audit_chain_id?: string | null;
  }): InvokeGatewayResponse {
    if (execution.status === "pending_approval" && execution.approval_id) {
      const base = config.consoleUrl?.replace(/\/+$/, "") ?? config.publicBaseUrl;
      return sanitizeAgentFacing({
        status: "pending_approval",
        approval_id: execution.approval_id,
        approval_url: `${base}/dashboard/approvals/${execution.approval_id}`,
        safe_summary: "Previously requested approval (idempotent replay)",
        execution_id: execution.id,
        audit_chain_id: execution.audit_chain_id ?? undefined,
      });
    }

    if (execution.status === "completed") {
      return sanitizeAgentFacing({
        status: "completed",
        result: execution.sanitized_output ?? execution.result_payload ?? {},
        execution_id: execution.id,
        audit_id: randomUUID(),
        audit_chain_id: execution.audit_chain_id ?? undefined,
      });
    }

    if (execution.status === "denied") {
      return sanitizeAgentFacing({
        status: "denied",
        execution_id: execution.id,
        audit_chain_id: execution.audit_chain_id ?? undefined,
        error: {
          code: execution.error_code ?? "policy_denied",
          message: execution.error_message ?? "Denied by policy",
          recoverable: false,
        },
      });
    }

    if (execution.status === "reconnect_required") {
      return sanitizeAgentFacing({
        status: "reconnect_required",
        execution_id: execution.id,
        connection_url: connectUrlForProvider("github"),
        audit_chain_id: execution.audit_chain_id ?? undefined,
        error: {
          code: "reconnect_required",
          message: execution.error_message ?? "Reconnection required",
          recoverable: true,
        },
      });
    }

    return sanitizeAgentFacing({
      status: "failed",
      error: {
        code: execution.error_code ?? "execution_failed",
        message: execution.error_message ?? "Execution failed",
        recoverable: execution.error_code === "reconnect_required",
      },
      execution_id: execution.id,
      audit_id: randomUUID(),
      audit_chain_id: execution.audit_chain_id ?? undefined,
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
  idempotency_key?: string;
  dry_run?: boolean;
  timeout_ms?: number;
  reason?: string;
  trace_id?: string;
  approval_id?: string;
  request?: Request;
}): Promise<unknown> {
  const response = await capabilityInvocationGateway.invoke({
    agent: input.agent,
    capability_id: input.capability,
    user_id: input.user_id,
    payload: input.payload,
    idempotency_key: input.idempotency_key,
    dry_run: input.dry_run,
    timeout_ms: input.timeout_ms,
    reason: input.reason,
    trace_id: input.trace_id,
    approval_id: input.approval_id,
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
      audit_chain_id: response.audit_chain_id,
    };
  }

  if (response.status === "denied") {
    throw new ForbiddenError(response.error.message, { error_code: "policy_denied" });
  }

  if (response.status === "reconnect_required") {
    throw new ForbiddenError(response.error?.message ?? "reconnect required", {
      error_code: "reconnect_required",
      connection_url: response.connection_url,
    });
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
    audit_chain_id: response.audit_chain_id,
  };
}
