import type { Mandate, MandateConstraints } from "./mandate";

export type PolicyDecision =
  | { decision: "allow" }
  | { decision: "approval_required"; reason: string; action: string }
  | { decision: "deny"; reason: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Classify a proxied call into a coarse action name. Used as Transaction.action
 * and shown on the approval. Not a policy language.
 */
export function classifyProxyAction(method: string, url: URL): string {
  const normalized = method.trim().toUpperCase();
  if (
    normalized === "POST" &&
    url.hostname.toLowerCase() === "api.github.com" &&
    /^\/repos\/[^/]+\/[^/]+\/issues$/.test(url.pathname)
  ) {
    return "issues.create";
  }
  return `http.${normalized.toLowerCase()}`;
}

function optedIntoApproval(constraints: MandateConstraints, method: string): boolean {
  if (constraints.require_approval === true) {
    return true;
  }
  const methods = constraints.approval_required_methods;
  return Array.isArray(methods) && methods.map((item) => item.toUpperCase()).includes(method);
}

/**
 * Tiny internal decision function. Default is allow: a mandate that never
 * opted into require_approval keeps today's credential-proxy behaviour.
 * GET/HEAD/OPTIONS stay allow even after opt-in so read traffic is not gated.
 */
export function evaluatePolicy(input: {
  method: string;
  url: URL;
  mandate: Mandate;
}): PolicyDecision {
  const method = input.method.trim().toUpperCase();
  if (!method) {
    return { decision: "deny", reason: "method is required" };
  }

  if (!optedIntoApproval(input.mandate.constraints, method)) {
    return { decision: "allow" };
  }

  if (SAFE_METHODS.has(method)) {
    return { decision: "allow" };
  }

  const action = classifyProxyAction(method, input.url);
  return {
    decision: "approval_required",
    reason: `Mandate requires approval for ${action} (${method} ${input.url.hostname}${input.url.pathname})`,
    action,
  };
}
