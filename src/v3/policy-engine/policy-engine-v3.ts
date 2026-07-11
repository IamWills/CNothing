import type { ApprovalPolicy, CapabilityRecord, JsonObject, RiskLevel } from "../../v2/v2.entity";
import type { AgentRecord } from "../../v2/v2.entity";
import type { CapabilityPermissionRecord } from "../v3.entity";
import {
  incrementRateLimitBucket,
  listCapabilityPermissions,
} from "../gateway.repository";
import { listTrustPolicies, type TrustPolicyRecord } from "./policy.repository";
import { summarizeInputForApproval } from "./approval-helpers";

export { deriveResourceKey, summarizeInputForApproval } from "./approval-helpers";

const RISK_ORDER: Record<string, number> = {
  PUBLIC: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CONFIDENTIAL: 4,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export type PolicyDecisionKind =
  | "allow"
  | "deny"
  | "require_approval"
  | "require_reauth";

export type PolicyRiskLevel = "low" | "medium" | "high" | "critical";

/**
 * Canonical Policy Engine decision (Execution Trust Layer contract).
 */
export type PolicyDecisionV3 = {
  decision: PolicyDecisionKind;
  reason: string;
  matched_policy_id: string | null;
  risk_level: PolicyRiskLevel;
  /** @deprecated use decision */
  action: PolicyDecisionKind;
  matched_permission_id: string | null;
  rate_limited?: boolean;
  force_approval_policy?: ApprovalPolicy;
  effects_applied?: string[];
};

function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*") && !pattern.endsWith(".*")) {
    return name.startsWith(pattern.slice(0, -1));
  }
  if (pattern.endsWith(".*")) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return name === pattern;
}

function mapCapabilityRisk(risk: RiskLevel | string): PolicyRiskLevel {
  const upper = String(risk).toUpperCase();
  if (upper === "PUBLIC" || upper === "LOW") return "low";
  if (upper === "MEDIUM") return "medium";
  if (upper === "HIGH") return "high";
  if (upper === "CONFIDENTIAL") return "critical";
  const lower = String(risk).toLowerCase();
  if (lower === "low" || lower === "medium" || lower === "high" || lower === "critical") {
    return lower;
  }
  return "medium";
}

function inTimeWindow(policy: TrustPolicyRecord, now = new Date()): boolean {
  if (!policy.time_window_start && !policy.time_window_end) return true;
  // Simple HH:MM UTC window (production can expand to IANA tz)
  const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  if (policy.time_window_start && hhmm < policy.time_window_start) return false;
  if (policy.time_window_end && hhmm > policy.time_window_end) return false;
  return true;
}

function permissionMatches(
  permission: CapabilityPermissionRecord,
  input: { agent: AgentRecord; capability: CapabilityRecord },
): boolean {
  if (permission.agent_id && permission.agent_id !== input.agent.id) return false;
  if (permission.capability_id && permission.capability_id !== input.capability.id) return false;
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
    if (!matchesPattern(provider, permission.provider_pattern)) return false;
  }
  return true;
}

function trustPolicyMatches(
  policy: TrustPolicyRecord,
  input: { agent: AgentRecord; capability: CapabilityRecord },
): boolean {
  if (policy.agent_id && policy.agent_id !== input.agent.id) return false;
  if (policy.capability_id && policy.capability_id !== input.capability.id) return false;
  if (
    policy.capability_pattern &&
    !matchesPattern(input.capability.name, policy.capability_pattern)
  ) {
    return false;
  }
  if (policy.provider_pattern) {
    const provider =
      input.capability.provider ??
      (input.capability.name.includes(".")
        ? input.capability.name.split(".")[0]!
        : "");
    if (!matchesPattern(provider, policy.provider_pattern)) return false;
  }
  if (policy.agent_allowlist.length > 0 && !policy.agent_allowlist.includes(input.agent.id)) {
    return false;
  }
  if (policy.provider_allowlist.length > 0) {
    const provider =
      input.capability.provider ??
      (input.capability.name.includes(".")
        ? input.capability.name.split(".")[0]!
        : "");
    if (!policy.provider_allowlist.includes(provider)) return false;
  }
  return true;
}

function decisionOf(
  decision: PolicyDecisionKind,
  reason: string,
  matched_policy_id: string | null,
  risk_level: PolicyRiskLevel,
  extra?: Partial<PolicyDecisionV3>,
): PolicyDecisionV3 {
  return {
    decision,
    action: decision,
    reason,
    matched_policy_id,
    matched_permission_id: matched_policy_id,
    risk_level,
    ...extra,
  };
}

/**
 * Evaluate Policy Engine for a capability invocation.
 * Priority: deny > require_reauth > require_approval > allow
 * Policy deny always beats Grant allow.
 */
export async function evaluateCapabilityPolicy(input: {
  agent: AgentRecord;
  capability: CapabilityRecord;
  payload?: JsonObject;
}): Promise<PolicyDecisionV3> {
  const effectsApplied: string[] = [];
  const capRisk = mapCapabilityRisk(input.capability.risk_level);

  const [trustPolicies, permissions] = await Promise.all([
    listTrustPolicies(),
    listCapabilityPermissions(),
  ]);

  const matchedTrust = trustPolicies.filter((p) =>
    trustPolicyMatches(p, { agent: input.agent, capability: input.capability }),
  );
  const matchedPerms = permissions.filter((p) =>
    permissionMatches(p, { agent: input.agent, capability: input.capability }),
  );

  // --- Trust policies first (independent Policy Engine) ---
  for (const policy of matchedTrust) {
    effectsApplied.push(policy.effect);

    if (policy.effect === "deny" || policy.destructive_action_block) {
      return decisionOf(
        "deny",
        typeof policy.metadata.reason === "string"
          ? policy.metadata.reason
          : policy.description || "Denied by policy",
        policy.id,
        policy.risk_level,
        { effects_applied: effectsApplied },
      );
    }

    if (policy.effect === "require_reauth" || policy.require_reauth) {
      return decisionOf(
        "require_reauth",
        typeof policy.metadata.reason === "string"
          ? policy.metadata.reason
          : "Re-authentication required",
        policy.id,
        policy.risk_level,
        { effects_applied: effectsApplied },
      );
    }

    if (policy.effect === "time_window" || policy.time_window_start || policy.time_window_end) {
      if (!inTimeWindow(policy)) {
        return decisionOf(
          "deny",
          "Outside allowed time window",
          policy.id,
          policy.risk_level,
          { effects_applied: effectsApplied },
        );
      }
    }

    if (policy.effect === "rate_limit" || (policy.rate_limit_per_minute && policy.rate_limit_per_minute > 0)) {
      const limit = policy.rate_limit_per_minute ?? 0;
      if (limit > 0) {
        const windowStart = new Date();
        windowStart.setSeconds(0, 0);
        const count = await incrementRateLimitBucket({
          bucket_key: `policy:${policy.id}:agent:${input.agent.id}`,
          window_start: windowStart,
        });
        if (count > limit) {
          return decisionOf("deny", "Rate limit exceeded", policy.id, policy.risk_level, {
            rate_limited: true,
            effects_applied: effectsApplied,
          });
        }
      }
    }

    if (policy.effect === "scope_limit" && policy.scope_limit.length > 0) {
      const needed = input.capability.scopes;
      const allowed = new Set(policy.scope_limit);
      if (needed.some((s) => !allowed.has(s))) {
        return decisionOf(
          "deny",
          "Capability scopes exceed policy scope_limit",
          policy.id,
          policy.risk_level,
          { effects_applied: effectsApplied },
        );
      }
    }

    if (policy.effect === "resource_constraint" && input.payload) {
      const constraint = policy.resource_constraint;
      if (constraint && typeof constraint === "object") {
        for (const [key, expected] of Object.entries(constraint)) {
          if (expected !== undefined && input.payload[key] !== undefined) {
            if (String(input.payload[key]) !== String(expected)) {
              return decisionOf(
                "deny",
                `Resource constraint violated for ${key}`,
                policy.id,
                policy.risk_level,
                { effects_applied: effectsApplied },
              );
            }
          }
        }
      }
    }

    if (policy.effect === "agent_allowlist" && policy.agent_allowlist.length > 0) {
      if (!policy.agent_allowlist.includes(input.agent.id)) {
        return decisionOf(
          "deny",
          "Agent not in allowlist",
          policy.id,
          policy.risk_level,
          { effects_applied: effectsApplied },
        );
      }
    }

    if (policy.effect === "provider_allowlist" && policy.provider_allowlist.length > 0) {
      const provider =
        input.capability.provider ??
        (input.capability.name.includes(".")
          ? input.capability.name.split(".")[0]!
          : "");
      if (!policy.provider_allowlist.includes(provider)) {
        return decisionOf(
          "deny",
          "Provider not in allowlist",
          policy.id,
          policy.risk_level,
          { effects_applied: effectsApplied },
        );
      }
    }

    if (policy.effect === "require_approval") {
      const approvalPolicy =
        typeof policy.metadata.approval_policy === "string"
          ? (policy.metadata.approval_policy as ApprovalPolicy)
          : input.capability.approval_policy && input.capability.approval_policy !== "none"
            ? input.capability.approval_policy
            : "every_time";
      return decisionOf(
        "require_approval",
        typeof policy.metadata.reason === "string"
          ? policy.metadata.reason
          : "Policy requires human approval",
        policy.id,
        policy.risk_level,
        {
          force_approval_policy: approvalPolicy,
          effects_applied: effectsApplied,
        },
      );
    }
  }

  // --- Legacy capability_permissions (deny still wins) ---
  for (const permission of matchedPerms) {
    effectsApplied.push(permission.effect);

    if (permission.effect === "deny") {
      return decisionOf(
        "deny",
        typeof permission.metadata.reason === "string"
          ? permission.metadata.reason
          : "Capability denied by policy",
        permission.id,
        capRisk,
        { effects_applied: effectsApplied },
      );
    }

    if (permission.effect === "require_reauth") {
      return decisionOf(
        "require_reauth",
        "Re-authentication required by capability permission",
        permission.id,
        capRisk,
        { effects_applied: effectsApplied },
      );
    }

    if (permission.max_risk_level) {
      const maxRisk = RISK_ORDER[permission.max_risk_level] ?? 4;
      const current = RISK_ORDER[input.capability.risk_level] ?? 2;
      if (current > maxRisk) {
        return decisionOf(
          "deny",
          `Capability risk ${input.capability.risk_level} exceeds max ${permission.max_risk_level}`,
          permission.id,
          capRisk,
          { effects_applied: effectsApplied },
        );
      }
    }

    if (permission.rate_limit_per_minute && permission.rate_limit_per_minute > 0) {
      const windowStart = new Date();
      windowStart.setSeconds(0, 0);
      const count = await incrementRateLimitBucket({
        bucket_key: `agent:${input.agent.id}:cap:${input.capability.id}`,
        window_start: windowStart,
      });
      if (count > permission.rate_limit_per_minute) {
        return decisionOf("deny", "Rate limit exceeded", permission.id, capRisk, {
          rate_limited: true,
          effects_applied: effectsApplied,
        });
      }
    }

    if (permission.effect === "require_approval" || permission.require_approval === true) {
      return decisionOf(
        "require_approval",
        typeof permission.metadata.reason === "string"
          ? permission.metadata.reason
          : "Policy requires human approval",
        permission.id,
        capRisk,
        {
          force_approval_policy:
            input.capability.approval_policy && input.capability.approval_policy !== "none"
              ? input.capability.approval_policy
              : "every_time",
          effects_applied: effectsApplied,
        },
      );
    }
  }

  // Capability-level approval_policy
  if (input.capability.approval_policy && input.capability.approval_policy !== "none") {
    return decisionOf(
      "require_approval",
      `Capability approval_policy=${input.capability.approval_policy}`,
      null,
      capRisk,
      {
        force_approval_policy: input.capability.approval_policy,
        effects_applied: effectsApplied,
      },
    );
  }

  // Default: deny destructive names if no explicit allow matched
  const lower = input.capability.name.toLowerCase();
  if (
    lower.includes(".delete") ||
    lower.includes("delete_") ||
    lower.includes(".destroy")
  ) {
    const hasAllow =
      matchedTrust.some((p) => p.effect === "allow") ||
      matchedPerms.some((p) => p.effect === "allow");
    if (!hasAllow) {
      return decisionOf(
        "deny",
        "Destructive actions are denied by default",
        null,
        "critical",
        { effects_applied: [...effectsApplied, "destructive_action_block"] },
      );
    }
  }

  const allowId =
    matchedTrust.find((p) => p.effect === "allow")?.id ??
    matchedPerms.find((p) => p.effect === "allow")?.id ??
    null;

  return decisionOf("allow", "Allowed by default policy", allowId, capRisk, {
    effects_applied: effectsApplied,
  });
}

export function riskRequiresApproval(risk: RiskLevel): boolean {
  return risk === "HIGH" || risk === "CONFIDENTIAL";
}

/** Agent-safe view of a policy decision (no internal secrets). */
export function publicPolicyDecision(decision: PolicyDecisionV3): {
  decision: PolicyDecisionKind;
  reason: string;
  matched_policy_id: string | null;
  risk_level: PolicyRiskLevel;
} {
  return {
    decision: decision.decision,
    reason: decision.reason,
    matched_policy_id: decision.matched_policy_id,
    risk_level: decision.risk_level,
  };
}

export type { TrustPolicyRecord };
