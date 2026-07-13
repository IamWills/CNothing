import config from "../../config";
import type { AgentRecord, CapabilityRecord, JsonObject } from "../../v2/v2.entity";
import type { ApprovalPolicy } from "../../v2/v2.entity";
import type { ApprovalRecord } from "../v3.entity";
import { writeTrustAudit } from "../v3.repository";
import {
  consumeApproval,
  createApproval,
  decideApproval,
  expireStaleApprovals,
  findApprovalById,
  findReusableApproval,
  listApprovals,
} from "../gateway.repository";
import {
  deriveResourceKey,
  summarizeInputForApproval,
} from "../policy-engine/approval-helpers";
import { sanitizeDeep } from "../sanitizer/sanitizer";

function approvalTtlSeconds(): number {
  const raw = Number(process.env.KEYSERVICE_APPROVAL_URL_TTL_SECONDS ?? "900");
  if (!Number.isFinite(raw) || raw < 60 || raw > 86400) {
    return 900;
  }
  return Math.trunc(raw);
}

function buildApprovalUrl(approvalId: string, token: string): string {
  const base = config.consoleUrl?.replace(/\/+$/, "") ?? config.publicBaseUrl;
  return `${base}/dashboard/approvals/${approvalId}?token=${encodeURIComponent(token)}`;
}

export type ApprovalRequirement = {
  required: boolean;
  policy: ApprovalPolicy;
  reusable: ApprovalRecord | null;
};

export class ApprovalEngine {
  async evaluateRequirement(input: {
    user_id: string;
    agent: AgentRecord;
    capability: CapabilityRecord;
    payload: JsonObject;
    forced_policy?: ApprovalPolicy;
  }): Promise<ApprovalRequirement> {
    await expireStaleApprovals();

    const policy =
      input.forced_policy ??
      input.capability.approval_policy ??
      "none";

    if (policy === "none") {
      return { required: false, policy, reusable: null };
    }

    const resourceKey = deriveResourceKey(input.capability, input.payload);
    const scopesKey = [...input.capability.scopes].sort().join(",");

    const reusable = await findReusableApproval({
      user_id: input.user_id,
      agent_id: input.agent.id,
      capability_id: input.capability.id,
      resource_key: resourceKey,
      scopes_key: scopesKey,
      policy,
    });

    if (reusable) {
      return { required: false, policy, reusable };
    }

    return { required: true, policy, reusable: null };
  }

  async requestApproval(input: {
    user_id: string;
    agent: AgentRecord;
    capability: CapabilityRecord;
    payload: JsonObject;
    input_hash?: string | null;
    policy: ApprovalPolicy;
    tenant_id?: string;
    execution_id?: string | null;
    policy_id?: string | null;
  }): Promise<{
    approval: ApprovalRecord;
    approval_url: string;
    safe_summary: string;
  }> {
    const resourceKey = deriveResourceKey(input.capability, input.payload);
    const safeSummary = summarizeInputForApproval(input.payload);
    const expiresAt = new Date(Date.now() + approvalTtlSeconds() * 1000).toISOString();

    const { approval, approval_token } = await createApproval({
      user_id: input.user_id,
      agent_id: input.agent.id,
      capability_id: input.capability.id,
      requested_action: input.capability.name,
      input_summary: safeSummary,
      input_hash: input.input_hash,
      risk_level: input.capability.risk_level,
      scopes: input.capability.scopes,
      resource_key: resourceKey,
      expires_at: expiresAt,
      tenant_id: input.tenant_id,
      execution_id: input.execution_id,
      policy_id: input.policy_id,
      approval_type: "execution_confirmation",
      metadata: {
        approval_policy: input.policy,
        scopes_key: [...input.capability.scopes].sort().join(","),
        capability_name: input.capability.name,
        // Never persist raw secrets in approval metadata
        input_snapshot: sanitizeDeep(input.payload) as JsonObject,
        execution_id: input.execution_id ?? null,
        policy_id: input.policy_id ?? null,
      },
    });

    await writeTrustAudit({
      event_type: "approval_requested",
      agent_id: input.agent.id,
      user_id: input.user_id,
      capability_id: input.capability.id,
      approval_id: approval.id,
      execution_id: input.execution_id ?? null,
      policy_id: input.policy_id ?? null,
      input_summary: safeSummary,
      risk_level: input.capability.risk_level,
      result: "pending",
      metadata: {
        approval_policy: input.policy,
        resource_key: resourceKey,
      },
    });

    return {
      approval,
      approval_url: buildApprovalUrl(approval.id, approval_token),
      safe_summary: safeSummary,
    };
  }

  async getApprovalStatus(approvalId: string): Promise<{
    approval_id: string;
    approval_type: string;
    status: string;
    capability_id: string;
    agent_id: string;
    execution_id: string | null;
    policy_id: string | null;
    safe_summary: string;
    risk_level: string;
    expires_at: string;
    approved_at: string | null;
    rejected_at: string | null;
    cancelled_at: string | null;
  } | null> {
    await expireStaleApprovals();
    const approval = await findApprovalById(approvalId);
    if (!approval) return null;

    let status = approval.status;
    if (status === "pending" && new Date(approval.expires_at).getTime() < Date.now()) {
      status = "expired";
    }

    return {
      approval_id: approval.id,
      approval_type: approval.approval_type ?? "execution_confirmation",
      status,
      capability_id: approval.capability_id,
      agent_id: approval.agent_id,
      execution_id: approval.execution_id,
      policy_id: approval.policy_id,
      safe_summary: approval.safe_input_summary ?? approval.input_summary,
      risk_level: approval.risk_level,
      expires_at: approval.expires_at,
      approved_at: approval.approved_at,
      rejected_at: approval.rejected_at,
      cancelled_at: approval.cancelled_at,
    };
  }

  async markConsumed(approvalId: string): Promise<ApprovalRecord | null> {
    return consumeApproval(approvalId);
  }

  async decide(input: {
    approval_id: string;
    decision: "approved" | "rejected";
    decided_by: string;
  }): Promise<ApprovalRecord | null> {
    const updated = await decideApproval({
      id: input.approval_id,
      decision: input.decision,
      decided_by: input.decided_by,
    });

    if (updated) {
      await writeTrustAudit({
        event_type: "approval_decided",
        agent_id: updated.agent_id,
        user_id: updated.user_id,
        capability_id: updated.capability_id,
        approval_id: updated.id,
        input_summary: updated.input_summary,
        risk_level: updated.risk_level,
        result: input.decision,
        metadata: { decided_by: input.decided_by },
      });
    }

    return updated;
  }

  async listForUser(userId: string, status?: ApprovalRecord["status"]) {
    return listApprovals({ user_id: userId, status, limit: 100 });
  }

  getInputSnapshot(approval: ApprovalRecord): JsonObject {
    const snapshot = approval.metadata.input_snapshot;
    if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
      return snapshot as JsonObject;
    }
    return {};
  }
}

export const approvalEngine = new ApprovalEngine();
