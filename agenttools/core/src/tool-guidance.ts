import type { AgentToolName, JsonObject } from "./types";

/** Keep hosted MCP and local REST-backed tools on the same model-facing contract. */
export function guideToolResult(name: AgentToolName, value: JsonObject): JsonObject {
  if (name === "list_grants") {
    const items = Array.isArray(value.items) ? value.items : [];
    const usable = items.some((item) => item && typeof item === "object"
      && item.status === "active" && (!item.expires_at || Date.parse(item.expires_at) > Date.now()));
    return { ...value, next_action: usable ? "reuse_active_grant" : "call_list_providers" };
  }
  if (name === "list_providers") return { ...value, next_action: "call_request_access" };
  if (name === "get_access_status") {
    if (value.status === "pending") return {
      ...value, next_action: "wait_for_user", retry_after_seconds: value.retry_after_seconds ?? 5,
      instruction: "Keep this access_request_id. Pending is not an error. Wait for the user; do not create another request or attempt OAuth yourself. If the user is not ready, return the approval link and resume this request later.",
    };
    if (value.status === "approved" && value.grant_id) return {
      ...value,
      next_action: value.type === "transaction" ? "retry_same_proxy_request" : "call_proxy_request",
      instruction: value.type === "transaction"
        ? "Retry the original proxy_request with the same arguments and idempotency_key."
        : "API access is approved. Use grant_id with proxy_request; no token exchange, browser login, or further approval request is needed. For GitHub, GET https://api.github.com/user verifies the connected account.",
    };
    if (value.status === "denied" || value.status === "expired") return {
      ...value, next_action: "none",
      instruction: "Stop and report this status. Request new access only if the user explicitly wants to try again.",
    };
  }
  if (name === "proxy_request" && typeof value.status === "number") return {
    ...value, http_status: value.status, status: "ok", next_action: "none",
  };
  return value;
}
