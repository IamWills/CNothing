import config from "../../config";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors";
import { AuthorizationService } from "../../v2/authorization-service";
import {
  confirmPendingConfirmation,
  findAuthorizationRequest,
  findPendingConfirmation,
  listAuthorizationRequests,
  listPendingConfirmations,
  rejectPendingConfirmation,
} from "../../v2/v2.repository";
import type { ApprovalType, UnifiedApprovalView } from "../v3.entity";
import {
  findApprovalById,
  findApprovalByToken,
  findExecutionById,
  listApprovals,
  listExecutions,
  updateExecution,
} from "../gateway.repository";
import { approvalEngine } from "./approval-engine";
// Resume invoke is lazy-imported to avoid circular deps with the gateway.

const authorizationService = new AuthorizationService();

function connectUrl(agentId?: string): string {
  const base = config.consoleUrl?.replace(/\/+$/, "") ?? config.publicBaseUrl;
  const qs = new URLSearchParams({ provider: "github" });
  if (agentId) qs.set("agent_id", agentId);
  return `${base}/connect?${qs.toString()}`;
}

function normalizeGrantStatus(status: string, expiresAt: string): string {
  if (status === "denied") return "rejected";
  if (status === "pending" && new Date(expiresAt).getTime() < Date.now()) return "expired";
  return status;
}

function fromCapApproval(a: Awaited<ReturnType<typeof findApprovalById>>): UnifiedApprovalView | null {
  if (!a) return null;
  let status = a.status;
  if (status === "pending" && new Date(a.expires_at).getTime() < Date.now()) {
    status = "expired";
  }
  return {
    approval_id: a.id,
    approval_type: a.approval_type ?? "execution_confirmation",
    execution_id: a.execution_id,
    status,
    risk_level: a.risk_level,
    safe_summary: a.safe_input_summary ?? a.input_summary,
    expires_at: a.expires_at,
    capability_id: a.capability_id,
    agent_id: a.agent_id,
    user_id: a.user_id,
    policy_id: a.policy_id,
    scopes: a.scopes,
    resource_key: a.resource_key,
    connection_url: null,
    approved_at: a.approved_at,
    rejected_at: a.rejected_at,
    cancelled_at: a.cancelled_at,
    created_at: a.created_at,
  };
}

function fromAuthorizationRequest(
  r: NonNullable<Awaited<ReturnType<typeof findAuthorizationRequest>>>,
): UnifiedApprovalView {
  const caps = r.requested_capabilities;
  return {
    approval_id: r.id,
    approval_type: "capability_grant",
    execution_id: null,
    status: normalizeGrantStatus(r.status, r.expires_at),
    risk_level: null,
    safe_summary:
      r.reason?.trim() ||
      (caps.length ? `Grant capabilities: ${caps.join(", ")}` : "Capability grant request"),
    expires_at: r.expires_at,
    capability_id: caps[0] ?? null,
    agent_id: r.agent_id,
    user_id: r.user_id,
    policy_id: null,
    scopes: [],
    resource_key: null,
    connection_url: null,
    approved_at: r.approved_at,
    rejected_at: r.denied_at,
    cancelled_at: null,
    created_at: r.created_at,
  };
}

function fromPendingConfirmation(
  c: NonNullable<Awaited<ReturnType<typeof findPendingConfirmation>>>,
): UnifiedApprovalView {
  let status = "pending";
  if (c.confirmed_at) status = "approved";
  else if (c.rejected_at) status = "rejected";
  else if (new Date(c.expires_at).getTime() < Date.now()) status = "expired";

  return {
    approval_id: c.id,
    approval_type: "execution_confirmation",
    execution_id: null,
    status,
    risk_level: "HIGH",
    safe_summary: c.reason?.trim() || "Legacy invoke confirmation required",
    expires_at: c.expires_at,
    capability_id: c.capability_id,
    agent_id: c.agent_id,
    user_id: c.user_id,
    policy_id: null,
    scopes: [],
    resource_key: null,
    connection_url: null,
    approved_at: c.confirmed_at,
    rejected_at: c.rejected_at,
    cancelled_at: null,
    created_at: c.created_at,
  };
}

function fromReconnectExecution(
  e: NonNullable<Awaited<ReturnType<typeof findExecutionById>>>,
): UnifiedApprovalView {
  return {
    approval_id: e.id,
    approval_type: "reauthentication",
    execution_id: e.id,
    status: e.status === "reconnect_required" ? "pending" : e.status,
    risk_level: null,
    safe_summary: e.error_message || "OAuth reconnect required before execution can continue",
    expires_at: null,
    capability_id: e.capability_id,
    agent_id: e.agent_id,
    user_id: e.user_id,
    policy_id: null,
    scopes: [],
    resource_key: null,
    connection_url: connectUrl(e.agent_id),
    approved_at: null,
    rejected_at: null,
    cancelled_at: null,
    created_at: e.created_at,
  };
}

export class UnifiedApprovalService {
  /**
   * Federated list: cap_approvals + authorization grants + legacy confirmations + reconnect executions.
   */
  async list(input: {
    user_id?: string;
    agent_id?: string;
    status?: string;
    approval_type?: ApprovalType;
    limit?: number;
  }): Promise<UnifiedApprovalView[]> {
    const limit = Math.min(input.limit ?? 100, 200);
    const items: UnifiedApprovalView[] = [];

    const includeExecution =
      !input.approval_type || input.approval_type === "execution_confirmation";
    const includeGrant = !input.approval_type || input.approval_type === "capability_grant";
    const includeReauth = !input.approval_type || input.approval_type === "reauthentication";

    if (includeExecution) {
      const cap = await listApprovals({
        user_id: input.user_id,
        agent_id: input.agent_id,
        status: input.status as never,
        approval_type: input.approval_type === "execution_confirmation" ? "execution_confirmation" : undefined,
        limit,
      });
      for (const row of cap) {
        const view = fromCapApproval(row);
        if (view) items.push(view);
      }

      // Legacy pending confirmations (only pending-shaped rows from list helper)
      if (!input.status || input.status === "pending") {
        const confirmations = await listPendingConfirmations({
          user_id: input.user_id,
        });
        for (const c of confirmations) {
          if (input.agent_id && c.agent_id !== input.agent_id) continue;
          items.push(fromPendingConfirmation(c));
        }
      }
    }

    if (includeGrant) {
      const grants = await listAuthorizationRequests({
        user_id: input.user_id,
        agent_id: input.agent_id,
        status:
          input.status === "rejected"
            ? "denied"
            : (input.status as "pending" | "approved" | "denied" | "expired" | undefined),
        limit,
      });
      for (const g of grants) {
        items.push(fromAuthorizationRequest(g));
      }
    }

    if (includeReauth && (!input.status || input.status === "pending")) {
      const reconnects = await listExecutions({
        user_id: input.user_id,
        agent_id: input.agent_id,
        status: "reconnect_required",
        limit,
      });
      for (const e of reconnects) {
        items.push(fromReconnectExecution(e));
      }
    }

    items.sort((a, b) => {
      const at = a.created_at ? Date.parse(a.created_at) : 0;
      const bt = b.created_at ? Date.parse(b.created_at) : 0;
      return bt - at;
    });

    return items.slice(0, limit);
  }

  async get(approvalId: string): Promise<UnifiedApprovalView | null> {
    const cap = await findApprovalById(approvalId);
    if (cap) return fromCapApproval(cap);

    const grant = await findAuthorizationRequest(approvalId);
    if (grant) return fromAuthorizationRequest(grant);

    const confirmation = await findPendingConfirmation(approvalId);
    if (confirmation) return fromPendingConfirmation(confirmation);

    const execution = await findExecutionById(approvalId);
    if (execution && execution.status === "reconnect_required") {
      return fromReconnectExecution(execution);
    }

    return null;
  }

  async decide(input: {
    approval_id: string;
    decision: "approved" | "rejected";
    decided_by: string;
    token?: string | null;
    granted_capabilities?: string[];
    request?: Request;
  }): Promise<{ view: UnifiedApprovalView; execution?: unknown; grants?: unknown }> {
    const existing = await this.get(input.approval_id);
    if (!existing) throw new NotFoundError("Approval not found");

    if (input.token) {
      const byToken = await findApprovalByToken(input.token);
      if (!byToken || byToken.id !== input.approval_id) {
        throw new ForbiddenError("Invalid approval token", { error_code: "invalid_token" });
      }
    } else if (existing.user_id && existing.user_id !== input.decided_by) {
      // unbound grant user_ids may be placeholders — authorizationService handles bind
      if (existing.approval_type !== "capability_grant") {
        throw new ForbiddenError("Not allowed to decide this approval");
      }
    }

    if (existing.status !== "pending") {
      throw new ConflictError(`Approval is already ${existing.status}`);
    }

    if (existing.approval_type === "capability_grant") {
      if (input.decision === "approved") {
        const result = await authorizationService.approveRequest({
          id: input.approval_id,
          grantedCapabilities: input.granted_capabilities,
          boundUserId: input.decided_by,
        });
        const view = await this.get(input.approval_id);
        return { view: view!, grants: result.grants };
      }
      await authorizationService.denyRequest(input.approval_id);
      const view = await this.get(input.approval_id);
      return { view: view! };
    }

    if (existing.approval_type === "reauthentication") {
      if (input.decision === "approved") {
        throw new ValidationError(
          "Reauthentication requires OAuth reconnect via connection_url, not approve",
          {
            error_code: "reauthentication_required",
            connection_url: existing.connection_url,
          },
        );
      }
      // Reject = cancel the blocked execution
      if (existing.execution_id) {
        const now = new Date().toISOString();
        await updateExecution(existing.execution_id, {
          status: "cancelled",
          error_code: "reauth_rejected",
          error_message: "User rejected reconnect requirement",
          finished_at: now,
          completed_at: now,
        });
      }
      const view = await this.get(input.approval_id);
      return {
        view: view ?? {
          ...existing,
          status: "cancelled",
        },
      };
    }

    // execution_confirmation — cap_approvals or legacy confirmations
    const cap = await findApprovalById(input.approval_id);
    if (cap) {
      const updated = await approvalEngine.decide({
        approval_id: input.approval_id,
        decision: input.decision,
        decided_by: input.decided_by,
      });
      if (!updated) throw new NotFoundError("Approval not found or already decided");

      let execution: unknown = null;
      if (input.decision === "approved") {
        try {
          const { findAgentById } = await import("../../v2/v2.repository");
          const { capabilityInvocationGateway } = await import(
            "../invocation/capability-invocation.gateway"
          );
          const agent = await findAgentById(updated.agent_id);
          if (agent) {
            const snapshot = approvalEngine.getInputSnapshot(updated);
            execution = await capabilityInvocationGateway.invoke({
              agent,
              capability_id: updated.capability_id,
              user_id: updated.user_id,
              payload: snapshot,
              approval_id: updated.id,
              request: input.request,
            });
          }
        } catch (err) {
          execution = {
            status: "failed",
            error: {
              code: "resume_failed",
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }

      return { view: fromCapApproval(updated)!, execution };
    }

    const confirmation = await findPendingConfirmation(input.approval_id);
    if (confirmation) {
      if (input.decision === "approved") {
        await confirmPendingConfirmation(input.approval_id);
      } else {
        await rejectPendingConfirmation(input.approval_id);
      }
      const view = await this.get(input.approval_id);
      return { view: view! };
    }

    throw new NotFoundError("Approval not found");
  }
}

export const unifiedApprovalService = new UnifiedApprovalService();
