import config from "../config";
import type { McpResourceDescriptor, McpToolDescriptor } from "./catalog.entity";
import { MCP_SERVER_INSTRUCTIONS } from "./mcp-instructions";

export const MCP_V4_WORKFLOW_URI = "resource://cnothing/v4-workflow";

const MCP_TOOLS: McpToolDescriptor[] = [
  {
    name: "register_agent",
    description:
      "Self-register this agent with CNothing and receive an agent_access_token. No admin token needed: an agent token by itself grants nothing until a human approves an access request. Store the returned token securely — it is shown only once.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "A human-readable name for this agent." },
        metadata: { type: "object", description: "Optional metadata (purpose, owner, ...)." },
      },
      required: ["name"],
    },
    useCases: ["First step when the agent has no agent_access_token yet."],
  },
  {
    name: "start_sandbox",
    description:
      "Provision a fully auto-approved sandbox grant so the agent can self-test the entire v4 flow (access request → grant → credential-injecting proxy → redaction) WITHOUT any human approval or real OAuth provider. Returns grant_id and an echo_url to call via proxy_request.",
    inputSchema: {
      type: "object",
      properties: {
        agent_access_token: { type: "string", description: "Agent bearer token." },
      },
      required: ["agent_access_token"],
    },
    useCases: ["End-to-end self-test before requesting access to a real provider."],
  },
  {
    name: "list_providers",
    description:
      "List OAuth 2.0 providers configured on CNothing (github, google, slack, ...). Use this to discover which provider slug to pass to request_access.",
    inputSchema: {
      type: "object",
      properties: {
        agent_access_token: {
          type: "string",
          description: "Agent bearer token issued via POST /v4/agents/register.",
        },
      },
      required: ["agent_access_token"],
    },
    useCases: ["Discover connectable providers before requesting access."],
  },
  {
    name: "request_access",
    description:
      "Request connection-level access to one OAuth provider. Returns access_request_id, approval_url (always /approve-proxy/{id}), resolved_user_id, and pushed_to_devices. ALWAYS pass user_id when you know the human's GitHub login, github:… id, or u_ short code so they get a phone push; only omit when unknown, then still send the exact approval_url — do not block.",
    inputSchema: {
      type: "object",
      properties: {
        agent_access_token: { type: "string", description: "Agent bearer token." },
        provider: {
          type: "string",
          description: "Provider slug, e.g. github",
          examples: ["github", "google"],
        },
        hosts: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional host allowlist for the grant, e.g. [\"api.github.com\"]. Defaults to the provider's known API hosts.",
        },
        reason: { type: "string", description: "Shown to the user on the approval page." },
        user_id: {
          type: "string",
          description:
            "Pass whenever known: CNothing id (github:alice), short code (u_XXXXXX), or GitHub login/username. Enables APNs push so the human only Approves. Omit only if unknown — then send approval_url; do not block.",
        },
        callback_url: {
          type: "string",
          description:
            "Optional https URL. When the user approves/denies, CNothing POSTs { event, access_request_id, status, grant_id } to it, so you don't need to poll.",
        },
      },
      required: ["agent_access_token", "provider"],
    },
    useCases: [
      "First step before calling any third-party API: obtain a user-approved grant.",
    ],
  },
  {
    name: "get_access_status",
    description:
      "Poll an access request until the user decides. When status is approved, the response contains grant_id for proxy_request.",
    inputSchema: {
      type: "object",
      properties: {
        agent_access_token: { type: "string", description: "Agent bearer token." },
        access_request_id: { type: "string" },
      },
      required: ["agent_access_token", "access_request_id"],
    },
  },
  {
    name: "proxy_request",
    description:
      "Call ANY https API of the granted provider through the CNothing credential-injecting proxy. CNothing injects the user's OAuth token server-side (auto-refreshing it), so the agent never sees credentials. The URL host must match the grant's allowlist. Responses are redacted: any token occurrence becomes [REDACTED].",
    inputSchema: {
      type: "object",
      properties: {
        agent_access_token: { type: "string", description: "Agent bearer token." },
        grant_id: { type: "string", description: "Approved grant id from get_access_status." },
        method: {
          type: "string",
          description: "HTTP method",
          examples: ["GET", "POST", "PATCH", "DELETE"],
        },
        url: {
          type: "string",
          description: "Full https URL, e.g. https://api.github.com/user/repos",
        },
        headers: {
          type: "object",
          description:
            "Optional extra headers (accept, content-type, ...). Authorization/cookie headers are ignored — CNothing injects auth itself.",
        },
        body: {
          description: "Optional request body (JSON object or string).",
        },
      },
      required: ["agent_access_token", "grant_id", "method", "url"],
    },
    useCases: [
      "GET https://api.github.com/user/repos after a github grant.",
      "POST https://api.github.com/repos/{owner}/{repo}/issues to create an issue.",
    ],
  },
  {
    name: "list_grants",
    description: "List this agent's connection-level grants (active and revoked).",
    inputSchema: {
      type: "object",
      properties: {
        agent_access_token: { type: "string", description: "Agent bearer token." },
      },
      required: ["agent_access_token"],
    },
  },
  {
    name: "submit_provider_proposal",
    description:
      "Onboard an OAuth 2.0 / OIDC provider that is missing or not yet connectable. Provide a discovery/issuer URL; if the provider supports RFC 7591 Dynamic Client Registration, CNothing registers an OAuth client automatically, otherwise an operator must configure client credentials once. If the slug already exists and is connectable, you get provider_exists — use request_access with that slug instead.",
    inputSchema: {
      type: "object",
      properties: {
        agent_access_token: { type: "string", description: "Agent bearer token." },
        provider_name: { type: "string", description: "Human-readable provider name." },
        discovery_url: {
          type: "string",
          description: "OIDC discovery document URL (.well-known/openid-configuration).",
        },
        issuer_url: { type: "string", description: "OIDC issuer URL (discovery inferred)." },
        authorization_url: { type: "string" },
        token_url: { type: "string" },
        registration_endpoint: {
          type: "string",
          description: "RFC 7591 Dynamic Client Registration endpoint, if known.",
        },
        scopes: { type: "array", items: { type: "string" } },
        slug: { type: "string", description: "Optional provider slug suggestion." },
      },
      required: ["agent_access_token", "provider_name"],
    },
  },
  {
    name: "get_provider_proposal",
    description: "Check the status of a provider proposal submitted by this agent.",
    inputSchema: {
      type: "object",
      properties: {
        agent_access_token: { type: "string", description: "Agent bearer token." },
        proposal_id: { type: "string" },
      },
      required: ["agent_access_token", "proposal_id"],
    },
  },
];

const MCP_V4_WORKFLOW_MARKDOWN = `# CNothing v4 workflow (only supported path)

Do **not** use AuthAI, KV, \`request_authorization\`, \`invoke_capability\`,
\`/authorize/{id}\`, \`/v2/*\`, or \`/v3/*\`.

You never log into GitHub. The human completes OAuth in a browser. You proxy after a grant.

## Prerequisites

1. \`agent_access_token\` (via \`register_agent\`)
2. Human signed in at https://cnothing.com/login
3. Human connected provider at https://cnothing.com/connect
4. Human approved your exact \`approval_url\`
5. You have \`grant_id\`

## Steps

0. \`register_agent { name }\` → store \`agent_access_token\`.
   Optional: \`start_sandbox\` → \`proxy_request\` on \`echo_url\` (no human).
1. \`list_providers\` → slug e.g. \`github\`.
2. \`request_access { provider: "github", reason: "...", user_id?: "..." }\`.
   **If you know their GitHub username / \`github:…\` id / \`u_\` short code / prior
   \`resolved_user_id\`, you MUST pass it as \`user_id\`** so they get a phone push and
   only tap Approve. Do not make them manually copy a link when you already know who
   they are. Omit \`user_id\` only when unknown — then still call this and send the
   exact \`approval_url\` (do not block).
   → \`{ access_request_id, approval_url, resolved_user_id, pushed_to_devices }\`.
   \`approval_url\` is always \`https://cnothing.com/approve-proxy/{uuid}\` (may include
   \`?user=\`). Never rewrite it. Always share it as fallback.
3. Human: Approve from push notification, or open \`approval_url\`.
4. \`get_access_status\` until \`status: "approved"\` → \`grant_id\`.
5. \`proxy_request { grant_id, method, url, body? }\` e.g.
   - \`GET https://api.github.com/user\`
   - \`POST https://api.github.com/repos/OWNER/REPO/issues\`

## Rules

- Never ask for passwords, PATs, session tokens, or cookies.
- Never call OAuth start URLs yourself (browser-only).
- When you know their GitHub username / agent ID / short code, always pass \`user_id\`.
- Never block waiting for user_id when unknown — send approval_url instead.
- Agent \`Authorization\`/\`Cookie\` on proxy calls are stripped.
- Host must match grant allowlist or \`host_not_allowed\`.
- On \`grant_revoked\`, request access again.

Primary skill: https://cnothing.com/skill.md
`;

const MCP_RESOURCES: McpResourceDescriptor[] = [
  {
    uri: MCP_V4_WORKFLOW_URI,
    name: "CNothing v4 agent workflow",
    description:
      "How an agent obtains a user-approved grant and calls third-party APIs through the credential-injecting proxy.",
    mimeType: "text/markdown",
  },
  {
    uri: "resource://cnothing/instructions",
    name: "Server instructions",
    description: "Condensed instructions for using the CNothing v4 MCP tools.",
    mimeType: "text/plain",
  },
];

export function listMcpTools(): McpToolDescriptor[] {
  return MCP_TOOLS;
}

export function listMcpResources(): McpResourceDescriptor[] {
  return MCP_RESOURCES;
}

export function readMcpResource(uri: string): {
  uri: string;
  mimeType: string;
  text: string;
} {
  if (uri === MCP_V4_WORKFLOW_URI) {
    return { uri, mimeType: "text/markdown", text: MCP_V4_WORKFLOW_MARKDOWN };
  }
  return {
    uri: "resource://cnothing/instructions",
    mimeType: "text/plain",
    text: `${MCP_SERVER_INSTRUCTIONS}\n\nService: ${config.serviceName}`,
  };
}
