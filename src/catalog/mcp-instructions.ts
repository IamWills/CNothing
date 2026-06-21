/**
 * MCP initialize instructions — returned to AI agents on connect.
 * v2 capability platform is primary; v1 AuthAI/KV remains for backward compatibility only.
 */
export const MCP_SERVER_INSTRUCTIONS = `
# CNothing v2 — Agent Capability Authorization Platform

**Agent Never Owns Secrets. Agent Only Receives Permissions.**

CNothing v2 lets AI agents invoke **capabilities** (e.g. \`github.list_repositories\`, \`search.query\`) without ever seeing API keys, OAuth tokens, \`user_id\`, or user session tokens.

## Correct agent workflow (never ask the user for tokens)

1. **Discover** — \`list_capabilities\`
2. **Authorize** — \`request_authorization\` with \`capabilities\` only (omit \`user_id\`)
3. **Send the user the \`approval_url\`** from the response — user signs in with GitHub/OIDC in the browser and clicks Allow
4. **Poll** — \`GET /v2/authorize/{id}\` until \`status\` is \`approved\`; read \`user_id\` from the response if needed
5. **Invoke** — \`invoke_capability\` with \`capability\` + \`input\` only (omit \`user_id\` when a single grant exists)

**Never ask the human for:** \`session_token\`, \`login_token\`, \`user_id\`, GitHub tokens, or CNothing client private keys.

Example authorization:

\`\`\`json
{
  "name": "request_authorization",
  "arguments": {
    "agent_access_token": "agent_...",
    "capabilities": ["github.list_repositories", "search.query"],
    "reason": "List your repos and search docs on your behalf"
  }
}
\`\`\`

Then tell the user: "Open this link to approve: {approval_url}"

Example invoke (after approval):

\`\`\`json
{
  "name": "invoke_capability",
  "arguments": {
    "agent_access_token": "agent_...",
    "capability": "github.list_repositories",
    "input": { "per_page": 10 }
  }
}
\`\`\`

REST equivalent: \`POST /v2/capabilities/invoke\` with \`Authorization: Bearer agent_...\`.

## v1 AuthAI/KV (deprecated)

Tools \`kv_save\`, \`kv_read\`, \`authai_register\`, and related AuthAI envelope tools are **deprecated**.

**Do not start new integrations on v1.** Use v2 capabilities instead.

Migration guide: \`GET /v2/platform/migration\`

Read \`/openapi-v2.json\`, \`/docs/mcp.md\`, and \`/standards/registration-hub\` for full details.
`.trim();
