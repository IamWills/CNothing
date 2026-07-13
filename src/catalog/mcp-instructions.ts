import { MCP_V2_AUTH_WORKFLOW_URI } from "./mcp-v2-auth-workflow";

/**
 * MCP initialize instructions — returned to AI agents on connect.
 * v2.5 OAuth broker + capability gateway is primary; v1 AuthAI/KV is deprecated.
 */
export const MCP_SERVER_INSTRUCTIONS = `
# CNothing v2.5 — Universal OAuth Broker + Capability Gateway

**READ FIRST:** Agents never receive OAuth tokens, refresh tokens, client secrets, or API keys.
Humans connect OAuth providers once in the browser; agents receive capability grants only.

Full workflow: MCP resource **${MCP_V2_AUTH_WORKFLOW_URI}**
(or \`resources/read\` with that URI immediately after \`initialize\`).

## Platform path (recommended — no custom connector)

1. Admin registers OAuth providers (\`/providers\` or \`POST /v2/oauth/providers\`)
2. Admin imports OpenAPI/MCP specs (\`/import\`) and activates capabilities
3. User connects OAuth at \`/connect\`
4. Agent discovers → requests authorization → user approves at \`approval_url\` → invokes

## Agent vs human

| | Agent (you) | Human user |
| --- | --- | --- |
| Auth | \`agent_access_token\` only | Browser OAuth at \`approval_url\` / \`/connect\` |
| Secrets | **Never** receive OAuth tokens or API keys | Tokens stored encrypted by CNothing |
| Third-party APIs | \`invoke_capability\` by business name | Approves grants in browser |

## Correct workflow (v2.5)

1. **Discover** — \`list_capabilities\` or \`GET /v2/agent/capabilities\`
2. **Authorize** — \`request_authorization\` with a single \`capability\` (**omit \`user_id\`**)
3. **Send link** — give user \`approval_url\` (e.g. \`https://cnothing.com/approve/{uuid}\`)
4. **Poll** — \`get_authorization_status\` until approved
5. **Invoke** — \`invoke_capability\` with \`capability\` + \`input\`

REST: \`POST /v2/agent/invoke\` with header \`Authorization: Bearer agent_...\`.

**v3 Execution Trust Layer (recommended for new agents):**
\`POST /api/v3/capabilities/{capabilityId}/invoke\` (canonical; documented in \`/openapi-v3.json\` and \`/api/v3/openapi.json\`).
Body should include production fields: \`idempotency_key\`, \`dry_run\`, \`timeout_ms\`, \`reason\` (optional \`trace_id\`).
Aliases: \`POST /v3/capabilities/{capabilityId}/invoke\`, legacy \`POST /v3/agent/invoke\` (same fields).
Poll async / long tasks: \`GET /api/v3/executions\`, \`GET /api/v3/executions/{executionId}\` (aliases under \`/v3/executions*\`). Cancel/retry: \`POST .../cancel\`, \`POST .../retry\`.
Unified Approvals: \`GET /api/v3/approvals\`, \`GET /api/v3/approvals/{id}\`, \`POST .../approve\`, \`POST .../reject\` (\`approval_type\`: capability_grant | execution_confirmation | reauthentication). Legacy \`/v3/authorize*\` and \`/v3/confirmations*\` remain as compatibility aliases.

SDK default: \`apiVersion: "v2.5"\` on \`CNothingAgentClient\`.

### Example: request authorization

\`\`\`json
{
  "name": "request_authorization",
  "arguments": {
    "agent_access_token": "agent_...",
    "capability": "github.create_issue",
    "reason": "Create an issue on your behalf"
  }
}
\`\`\`

### Example: invoke (after approval)

\`\`\`json
{
  "name": "invoke_capability",
  "arguments": {
    "agent_access_token": "agent_...",
    "capability": "github.create_issue",
    "input": { "owner": "org", "repo": "repo", "title": "Bug report" }
  }
}
\`\`\`

## Legacy v2 connector path

Custom \`examples/*-connector\` apps remain for advanced integrations.
New third-party APIs should use OAuth + OpenAPI/MCP import instead.

## v1 AuthAI/KV (deprecated)

Do not start new integrations on v1. Migration: \`GET /v2/platform/migration\`

Docs: \`/openapi-v2.5.json\`, \`${MCP_V2_AUTH_WORKFLOW_URI}\`, \`/getting-started.md\`
`.trim();
