import type { ApprovalPolicy, CapabilityRecord, JsonObject, RiskLevel } from "../../v2/v2.entity";
import type { AgentRecord } from "../../v2/v2.entity";
import type { CapabilityPermissionRecord } from "../v3.entity";
import {
  incrementRateLimitBucket,
  listCapabilityPermissions,
} from "../gateway.repository";
import { deriveResourceKey, summarizeInputForApproval } from "./approval-helpers";

export { deriveResourceKey, summarizeInputForApproval } from "./approval-helpers";

const RISK_ORDER: Record<string, number> = {
  PUBLIC: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CONFIDENTIAL: 4,
};

export type PolicyDecisionV3 = {
  action: "allow" | "deny" | "require_approval";
  reason: string;
  matched_permission_id: string | null;
  rate_limited?: boolean;
  force_approval_policy?: ApprovalPolicy;
};

function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return name === pattern;
}

function permissionMatches(
  permission: CapabilityPermissionRecord,
  input: {
    agent: AgentRecord;
    capability: CapabilityRecord;
  },
): boolean {
  if (permission.agent_id && permission.agent_id !== input.agent.id) {
    return false;
  }
  if (permission.capability_id && permission.capability_id !== input.capability.id) {
    return false;
  }
  if (
    permission.capability_pattern &&
    !matchesPattern(input.capability.name, permission.capability_pattern)
  ) {
    return false;
  }
  if (permission.provider_pattern) {
    const provider =
      input.capability.provider ??
      (input.capability.name.includes(".")
        ? input.capability.name.split(".")[0]!
        : "");
    if (!matchesPattern(provider, permission.provider_pattern)) {
      return false;
    }
  }
  return true;
}

export async function evaluateCapabilityPolicy(input: {
  agent: AgentRecord;
  capability: CapabilityRecord;
}): Promise<PolicyDecisionV3> {
  const permissions = await listCapabilityPermissions();
  const matched = permissions.filter((permission) =>
    permissionMatches(permission, {
      agent: input.agent,
      capability: input.capability,
    }),
  );

  for (const permission of matched) {
    if (permission.effect === "deny") {
      return {
        action: "deny",
        reason:
          typeof permission.metadata.reason === "string"
            ? permission.metadata.reason
            : "Capability denied by policy",
        matched_permission_id: permission.id,
      };
    }

    if (permission.max_risk_level) {
      const capRisk = RISK_ORDER[input.capability.risk_level] ?? 2;
      const maxRisk = RISK_ORDER[permission.max_risk_level] ?? 4;
      if (capRisk > maxRisk) {
        return {
          action: "deny",
          reason: `Capability risk ${input.capability.risk_level} exceeds max ${permission.max_risk_level}`,
          matched_permission_id: permission.id,
        };
      }
    }

    if (permission.rate_limit_per_minute && permission.rate_limit_per_minute > 0) {
      const windowStart = new Date();
      windowStart.setSeconds(0, 0);
      const bucketKey = `agent:${input.agent.id}:cap:${input.capability.id}`;
      const count = await incrementRateLimitBucket({
        bucket_key: bucketKey,
        window_start: windowStart,
      });
      if (count > permission.rate_limit_per_minute) {
        return {
          action: "deny",
          reason: "Rate limit exceeded",
          matched_permission_id: permission.id,
          rate_limited: true,
        };
      }
    }

    if (permission.effect === "require_approval" || permission.require_approval === true) {
      return {
        action: "require_approval",
        reason:
          typeof permission.metadata.reason === "string"
            ? permission.metadata.reason
            : "Policy requires human approval",
        matched_permission_id: permission.id,
        force_approval_policy:
          input.capability.approval_policy && input.capability.approval_policy !== "none"
            ? input.capability.approval_policy
            : "every_time",
      };
    }
  }

  // Capability-level approval_policy
  if (
    input.capability.approval_policy &&
    input.capability.approval_policy !== "none"
  ) {
    return {
      action: "require_approval",
      reason: `Capability approval_policy=${input.capability.approval_policy}`,
      matched_permission_id: null,
      force_approval_policy: input.capability.approval_policy,
    };
  }

  // Default: deny destructive names if no explicit allow matched
  const lower = input.capability.name.toLowerCase();
  if (
    lower.includes(".delete") ||
    lower.includes("delete_") ||
    lower.includes(".destroy")
  ) {
    const hasAllow = matched.some((p) => p.effect === "allow");
    if (!hasAllow) {
      return {
        action: "deny",
        reason: "Destructive actions are denied by default",
        matched_permission_id: null,
      };
    }
  }

  return {
    action: "allow",
    reason: "Allowed by default policy",
    matched_permission_id: matched.find((p) => p.effect === "allow")?.id ?? null,
  };
}

export function riskRequiresApproval(risk: RiskLevel): boolean {
  return risk === "HIGH" || risk === "CONFIDENTIAL";
}
