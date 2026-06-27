import type { CapabilityRecord, JsonObject, PolicyRecord } from "./v2.entity";
import type { PolicyDecisionV25 } from "./v2.5.entity";
import { evaluatePolicy } from "./policy-engine";

function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return name === pattern;
}

function inferRiskFromName(name: string): "HIGH" | "CONFIDENTIAL_QUERY" | null {
  const lower = name.toLowerCase();
  if (
    lower.includes(".delete") ||
    lower.includes("delete_") ||
    lower.includes(".payment") ||
    lower.includes(".transfer") ||
    lower.includes(".admin")
  ) {
    return "HIGH";
  }
  if (
    lower.includes("read_message") ||
    lower.includes("read_email") ||
    lower.includes("read_file") ||
    lower.includes("private")
  ) {
    return "CONFIDENTIAL_QUERY";
  }
  return null;
}

function readPolicyConfig(capability: CapabilityRecord): JsonObject {
  const metadata = capability.metadata ?? {};
  if (metadata.policy_config && typeof metadata.policy_config === "object") {
    return metadata.policy_config as JsonObject;
  }
  return {};
}

export function evaluatePolicyV25(
  capability: CapabilityRecord,
  policies: PolicyRecord[],
): PolicyDecisionV25 {
  const base = evaluatePolicy(capability, policies);
  const policyConfig = readPolicyConfig(capability);
  const nameRisk = inferRiskFromName(capability.name);

  if (policyConfig.deny === true) {
    return {
      action: "deny",
      matched_policy_id: null,
      reason: "Capability policy_config denies invocation",
    };
  }

  if (nameRisk === "HIGH" && base.action === "allow") {
    return {
      action: "require_user_confirmation",
      matched_policy_id: null,
      reason: "High-risk operation requires user confirmation",
    };
  }

  if (
    (nameRisk === "CONFIDENTIAL_QUERY" || capability.capability_type === "CONFIDENTIAL_QUERY") &&
    base.action === "allow"
  ) {
    return {
      action: "require_user_confirmation",
      matched_policy_id: null,
      reason: "Confidential query requires user confirmation",
      output_mode: policyConfig.metadata_only ? "metadata_only" : policyConfig.summarize_only ? "summary" : "full",
    };
  }

  const decision: PolicyDecisionV25 = {
    action: base.action,
    matched_policy_id: base.matched_policy_id,
    reason: base.reason,
    output_mode: "full",
  };

  if (policyConfig.metadata_only === true) {
    decision.output_mode = "metadata_only";
  } else if (policyConfig.summarize_only === true) {
    decision.output_mode = "summary";
  }

  if (Array.isArray(policyConfig.redact_output)) {
    decision.redact_fields = policyConfig.redact_output.map(String);
    if (decision.output_mode === "full") {
      decision.output_mode = "redacted";
    }
  }

  if (typeof policyConfig.max_result_count === "number") {
    decision.max_result_count = Math.trunc(policyConfig.max_result_count);
  }

  if (Array.isArray(policyConfig.block_sensitive_fields)) {
    decision.redact_fields = [
      ...(decision.redact_fields ?? []),
      ...policyConfig.block_sensitive_fields.map(String),
    ];
  }

  return decision;
}

export function applyOutputPolicy(input: {
  result: unknown;
  decision: PolicyDecisionV25;
}): unknown {
  const { result, decision } = input;

  if (decision.output_mode === "metadata_only" && result && typeof result === "object") {
    if (Array.isArray(result)) {
      return { count: result.length, items: result.map((item) => extractMetadata(item)) };
    }
    return extractMetadata(result);
  }

  if (decision.output_mode === "summary") {
    if (typeof result === "string") {
      return { summary: result.slice(0, 200), truncated: result.length > 200 };
    }
    if (Array.isArray(result)) {
      return { count: result.length, summary: `Returned ${result.length} items` };
    }
    return { summary: "Result available", type: typeof result };
  }

  let output = result;

  if (decision.max_result_count && Array.isArray(output)) {
    output = output.slice(0, decision.max_result_count);
  }

  if (decision.redact_fields && decision.redact_fields.length > 0 && output && typeof output === "object") {
    output = redactFields(output, decision.redact_fields);
  }

  return output;
}

function extractMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return { type: typeof value };
  }
  if (Array.isArray(value)) {
    return { type: "array", count: value.length };
  }
  const obj = value as Record<string, unknown>;
  const meta: Record<string, unknown> = {};
  for (const key of ["id", "name", "title", "status", "created_at", "updated_at", "url", "html_url", "number"]) {
    if (key in obj) {
      meta[key] = obj[key];
    }
  }
  return meta;
}

function redactFields(value: unknown, fields: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactFields(item, fields));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const result = { ...(value as Record<string, unknown>) };
  for (const field of fields) {
    if (field in result) {
      result[field] = "[REDACTED]";
    }
  }
  return result;
}

export function scopesSatisfied(grantScopes: string[], requiredScopes: string[]): boolean {
  if (requiredScopes.length === 0) {
    return true;
  }
  if (grantScopes.length === 0) {
    return true;
  }
  return requiredScopes.every((scope) =>
    grantScopes.some((granted) => granted === scope || granted.endsWith(scope) || scope.endsWith(granted)),
  );
}
