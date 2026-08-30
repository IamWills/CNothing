import type { AgentToolName } from "./types";

const emptyParameters = {} as const;

export type AgentToolDefinition = {
  name: AgentToolName;
  title: string;
  description: string;
  parameters: Record<
    string,
    {
      type: string;
      required?: boolean;
      description?: string;
      enum?: string[];
    }
  >;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
};

export const AGENT_TOOLS: readonly AgentToolDefinition[] = [
  {
    name: "list_grants",
    title: "List approved API grants",
    description:
      "Call this first when a task needs a third-party API. Reuse an active grant whose provider and allowed_hosts cover the request. If none matches, continue with list_providers and request_access.",
    parameters: emptyParameters,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_providers",
    title: "List available OAuth providers",
    description:
      "List providers that CNothing is configured to connect. Use the exact returned slug in request_access. If the required provider is absent, call request_access with issuer or discovery_url (or pass an https issuer as provider) so CNothing can propose it for operator review.",
    parameters: emptyParameters,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "request_access",
    title: "Request user-approved API access",
    description:
      "Create one approval request for a configured provider. Pass user_id when the conversation already contains the user's CNothing ID, GitHub username, or u_ share code so the CNothing iOS app can receive a push. Never pause just to ask for user_id: omit it when unknown. Relay the returned user_action.message and exact approval_url unchanged, then call get_access_status at retry_after_seconds.",
    parameters: {
      provider: {
        type: "string",
        required: true,
        description: "Exact provider slug from list_providers, or an https issuer URL to propose an unknown provider.",
      },
      reason: {
        type: "string",
        required: true,
        description: "Short task-specific reason shown to the user.",
      },
      user_id: {
        type: "string",
        description: "Optional known CNothing ID, GitHub username, or u_ share code for iOS push routing.",
      },
      hosts: {
        type: "array",
        description: "Optional narrower host allowlist. Omit to use provider defaults.",
      },
      callback_url: {
        type: "string",
        description: "Optional HTTPS webhook for the approval decision.",
      },
      issuer: {
        type: "string",
        description: "Optional issuer URL. Required to propose a provider that is not yet in the registry.",
      },
      discovery_url: {
        type: "string",
        description: "Optional OIDC discovery or OAuth authorization-server metadata URL.",
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "get_access_status",
    title: "Check an access request",
    description:
      "Check a previously created access request. While pending, wait retry_after_seconds before calling again. When approved, save grant_id and continue with proxy_request. When denied or expired, stop and explain the status to the user.",
    parameters: {
      access_request_id: { type: "string", required: true, description: "Access request id from request_access." },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "proxy_request",
    title: "Call an approved third-party API",
    description:
      "Call an HTTPS API through an active grant. CNothing injects and refreshes the user's OAuth credential server-side. Use only a URL covered by allowed_hosts. Do not provide Authorization or Cookie headers. If the grant is revoked or expired, call request_access again. If the response status is approval_required, relay the exact approval_url, poll get_access_status, then retry this same proxy_request.",
    parameters: {
      grant_id: { type: "string", required: true, description: "Active grant id." },
      method: {
        type: "string",
        required: true,
        enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
        description: "HTTP method.",
      },
      url: { type: "string", required: true, description: "HTTPS URL covered by the grant allowed_hosts." },
      headers: { type: "object", description: "Optional non-credential request headers." },
      body: { type: "any", description: "Optional JSON value or string request body." },
      idempotency_key: { type: "string", description: "Optional key so retries of a write do not execute twice." },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
] as const;

export const AGENT_WORKFLOW = `# CNothing v4 agent workflow

Host plugin (not the model): if no agent token is configured, POST /v4/agent-enrollments, store enrollment_secret locally, open approval_url, poll until approved, then store the agent token. Never return enrollment_secret or access_token from a tool. Spec: https://cnothing.com/plugin.md

1. Call \`list_grants\` and reuse a matching active grant.
2. If no grant matches, call \`list_providers\` and select the exact provider slug. If the provider is missing, call \`request_access\` with \`issuer\` or an https provider URL to propose it; tell the user an operator must review it at the returned console_url, then retry.
3. Call \`request_access\` with a short reason. Include a known user ID only when it is already available; otherwise omit it.
4. Relay \`user_action.message\` and \`approval_url\` exactly. A paired CNothing iOS device may also receive a push notification.
5. Call \`get_access_status\` no faster than \`retry_after_seconds\` until approved.
6. Call \`proxy_request\` with the returned \`grant_id\` and an HTTPS URL on an allowed host.
7. If \`proxy_request\` returns \`status: approval_required\`, relay the exact \`approval_url\`, poll \`get_access_status\`, then retry the same \`proxy_request\`. Do not invent a new execute tool.

The user performs browser sign-in, provider connection, agent pairing, and approval. CNothing keeps OAuth credentials inside its encrypted vault and injects them only at the proxy boundary.`;

export const AGENT_INSTRUCTIONS = `CNothing lets an authenticated agent call a user-approved third-party API without receiving the user's credentials.

The host plugin must already hold an agent token, or it must complete POST /v4/agent-enrollments itself and store the claimed token locally. Never ask the user or the model for an agent token, enrollment_secret, password, or OAuth credential. See https://cnothing.com/plugin.md.

Start with list_grants and reuse an active grant for the required provider when possible. If there is no active grant, call list_providers, then request_access. Relay user_action.message and the exact approval_url unchanged. If pushed_to_devices is greater than zero, also tell the user to check the CNothing iOS notification. Poll get_access_status no faster than retry_after_seconds. After approval, use proxy_request for API calls. If proxy_request returns status approval_required, relay that approval_url, poll, then retry the same proxy_request.

The user completes sign-in, provider connection, agent pairing, and approval in CNothing.`;
