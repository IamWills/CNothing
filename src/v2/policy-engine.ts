import type { CapabilityRecord, PolicyDecision, PolicyRecord } from "./v2.entity";

function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return name === pattern;
}

function policyMatches(policy: PolicyRecord, capability: CapabilityRecord): boolean {
  if (!policy.enabled) return false;
  if (policy.capability_id && policy.capability_id !== capability.id) return false;
  if (policy.capability_pattern && !matchesPattern(capability.name, policy.capability_pattern)) {
    return false;
  }
  if (policy.risk_level && policy.risk_level !== capability.risk_level) return false;
  if (policy.capability_type && policy.capability_type !== capability.capability_type) return false;
  return true;
}

export function evaluatePolicy(
  capability: CapabilityRecord,
  policies: PolicyRecord[],
): PolicyDecision {
  const sorted = [...policies].sort((a, b) => a.priority - b.priority);
  const matched = sorted.filter((policy) => policyMatches(policy, capability));

  for (const policy of matched) {
    if (policy.action !== "allow") {
      return {
        action: policy.action,
        matched_policy_id: policy.id,
        reason:
          typeof policy.metadata.reason === "string"
            ? policy.metadata.reason
            : `Policy ${policy.id} requires ${policy.action}`,
      };
    }
  }

  if (capability.risk_level === "HIGH" || capability.risk_level === "CONFIDENTIAL") {
    return {
      action: "require_user_confirmation",
      matched_policy_id: null,
      reason: `Default policy for ${capability.risk_level} risk capability`,
    };
  }

  if (capability.capability_type === "CONFIDENTIAL_QUERY") {
    return {
      action: "require_user_confirmation",
      matched_policy_id: null,
      reason: "Confidential query requires user confirmation",
    };
  }

  return {
    action: "allow",
    matched_policy_id: null,
    reason: null,
  };
}
