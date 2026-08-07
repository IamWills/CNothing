export const MCP_PROTOCOL_VERSION = "2026-07-28";
export const MCP_LEGACY_PROTOCOL_VERSION = "2025-11-25";
export const MCP_SERVER_NAME = "cnothing-v4";
export const MCP_SERVER_VERSION = "4.0.0";
export const MCP_WORKFLOW_URI = "resource://cnothing/v4-workflow";

export const MCP_SERVER_INSTRUCTIONS = `CNothing lets an authenticated agent call a user-approved third-party API without receiving the user's credentials.

Start with list_grants and reuse an active grant for the required provider when possible. If there is no active grant, call list_providers, then request_access. Relay user_action.message and the exact approval_url unchanged. If pushed_to_devices is greater than zero, also tell the user to check the CNothing iOS notification. Poll get_access_status no faster than retry_after_seconds. After approval, use proxy_request for API calls.

The user completes sign-in, provider connection, and approval in CNothing. Never request or accept a password, personal access token, OAuth token, session cookie, or client secret.`;

const emptyInput = { type: "object", properties: {}, additionalProperties: false } as const;
const standardOutput = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    status: { type: "string" },
    next_action: { type: "string" },
  },
  additionalProperties: true,
} as const;

export const MCP_TOOLS = [
  {
    name: "list_grants",
    title: "List approved API grants",
    description:
      "Call this first when a task needs a third-party API. Reuse an active grant whose provider and allowed_hosts cover the request. If none matches, continue with list_providers and request_access.",
    inputSchema: emptyInput,
    outputSchema: standardOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_providers",
    title: "List available OAuth providers",
    description:
      "List providers that CNothing is configured to connect. Use the exact returned slug in request_access. If the required provider is absent or not connectable, report that an operator must configure it.",
    inputSchema: emptyInput,
    outputSchema: standardOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "request_access",
    title: "Request user-approved API access",
    description:
      "Create one approval request for a configured provider. Pass user_id when the conversation already contains the user's CNothing ID, GitHub username, or u_ share code so the CNothing iOS app can receive a push. Never pause just to ask for user_id: omit it when unknown. Relay the returned user_action.message and exact approval_url unchanged, then call get_access_status at retry_after_seconds.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", minLength: 1, description: "Exact provider slug from list_providers." },
        reason: { type: "string", minLength: 1, maxLength: 500, description: "Short task-specific reason shown to the user." },
        user_id: { type: "string", minLength: 1, description: "Optional known CNothing ID, GitHub username, or u_ share code for iOS push routing." },
        hosts: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true, description: "Optional narrower host allowlist. Omit to use provider defaults." },
        callback_url: { type: "string", format: "uri", description: "Optional HTTPS webhook for the approval decision." },
      },
      required: ["provider", "reason"],
      additionalProperties: false,
    },
    outputSchema: standardOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "get_access_status",
    title: "Check an access request",
    description:
      "Check a previously created access request. While pending, wait retry_after_seconds before calling again. When approved, save grant_id and continue with proxy_request. When denied or expired, stop and explain the status to the user.",
    inputSchema: {
      type: "object",
      properties: { access_request_id: { type: "string", minLength: 1 } },
      required: ["access_request_id"],
      additionalProperties: false,
    },
    outputSchema: standardOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "proxy_request",
    title: "Call an approved third-party API",
    description:
      "Call an HTTPS API through an active grant. CNothing injects and refreshes the user's OAuth credential server-side. Use only a URL covered by allowed_hosts. Do not provide Authorization or Cookie headers. If the grant is revoked or expired, call request_access again.",
    inputSchema: {
      type: "object",
      properties: {
        grant_id: { type: "string", minLength: 1 },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] },
        url: { type: "string", format: "uri", pattern: "^https://" },
        headers: { type: "object", additionalProperties: { type: "string" }, description: "Optional non-credential request headers." },
        body: { description: "Optional JSON value or string request body." },
      },
      required: ["grant_id", "method", "url"],
      additionalProperties: false,
    },
    outputSchema: standardOutput,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
] as const;

export const MCP_WORKFLOW_MARKDOWN = `# CNothing v4 agent workflow

1. Call \`list_grants\` and reuse a matching active grant.
2. If no grant matches, call \`list_providers\` and select the exact provider slug.
3. Call \`request_access\` with a short reason. Include a known user ID only when it is already available; otherwise omit it.
4. Relay \`user_action.message\` and \`approval_url\` exactly. A paired CNothing iOS device may also receive a push notification.
5. Call \`get_access_status\` no faster than \`retry_after_seconds\` until approved.
6. Call \`proxy_request\` with the returned \`grant_id\` and an HTTPS URL on an allowed host.

The user performs browser sign-in, provider connection, and approval. CNothing keeps OAuth credentials inside its encrypted vault and injects them only at the proxy boundary.`;

export type McpToolName = (typeof MCP_TOOLS)[number]["name"];
