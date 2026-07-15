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
      "Request connection-level access to one OAuth provider. Returns access_request_id and approval_url. Show approval_url to the human user — they approve ONCE in the CNothing Console by selecting one of their OAuth connections (signing in to the provider in the browser if needed). The agent cannot and must not perform this browser step itself.",
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
      "Onboard a NEW OAuth 2.0 / OIDC provider that CNothing doesn't know yet. Provide a discovery/issuer URL; if the provider supports RFC 7591 Dynamic Client Registration, CNothing registers an OAuth client automatically, otherwise an operator must configure client credentials once.",
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

const MCP_V4_WORKFLOW_MARKDOWN = `# CNothing v4 workflow for agents

CNothing is a universal credential-injecting proxy: after one human approval, an agent
can call any API of an OAuth 2.0 provider without ever touching tokens.

## Steps

0. No token yet? \`register_agent\` with \`{ name }\` — self-service, returns
   \`agent_access_token\` (shown once; store it securely). Optionally verify the whole
   mechanics first with \`start_sandbox\` + \`proxy_request\` against the returned
   \`echo_url\` — no human approval needed for the sandbox.
1. \`list_providers\` — find the provider slug (e.g. \`github\`).
2. \`request_access\` with \`{ provider: "github", reason: "..." }\`.
   - Response: \`{ access_request_id, approval_url }\`.
   - Give \`approval_url\` to the human. They open it in a browser, sign in to CNothing,
     pick (or create) their GitHub connection, and click Approve. This happens once.
3. \`get_access_status\` with \`{ access_request_id }\` — poll every few seconds until
   \`status: "approved"\`; the response then contains \`grant_id\`.
4. \`proxy_request\` with \`{ grant_id, method, url, headers?, body? }\` — any https API
   on the granted hosts. Examples:
   - \`GET https://api.github.com/user/repos\`
   - \`POST https://api.github.com/repos/OWNER/REPO/issues\` with a JSON body.

## Rules

- Never ask the human for tokens, passwords, or API keys.
- The \`Authorization\` header is injected by CNothing; anything you supply is stripped.
- Hosts outside the grant's allowlist are rejected (\`host_not_allowed\`).
- All responses are redacted server-side; a token can never leak to the agent.
- Grants can be revoked by the user at any time; handle \`grant_revoked\` gracefully by
  requesting access again.

## Provider missing?

Use \`submit_provider_proposal\` with the provider's OIDC discovery URL. Providers with
RFC 7591 Dynamic Client Registration onboard fully automatically; others need a one-time
operator configuration of client credentials.
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
