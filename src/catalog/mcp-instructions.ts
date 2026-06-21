import { MCP_V2_AUTH_WORKFLOW_URI } from "./mcp-v2-auth-workflow";

/**
 * MCP initialize instructions — returned to AI agents on connect.
 * v2 capability platform is primary; v1 AuthAI/KV remains for backward compatibility only.
 */
export const MCP_SERVER_INSTRUCTIONS = `
# CNothing v2 — Agent Capability Authorization Platform

**READ FIRST:** MCP tools run on the **agent** side. **Humans never log in to GitHub through MCP.**
GitHub sign-in happens in the **user's browser** at the \`approval_url\` from \`request_authorization\`.

Full step-by-step workflow (GitHub + capabilities): MCP resource **${MCP_V2_AUTH_WORKFLOW_URI}**
(or \`resources/read\` with that URI immediately after \`initialize\`).

## Agent vs human — who does what

| | Agent (you) | Human user |
| --- | --- | --- |
| Auth | \`agent_access_token\` only | Browser session on cnothing.com (GitHub OAuth) |
| GitHub login | **Cannot** — no MCP tool for this | Opens \`approval_url\`, clicks **Sign in with GitHub**, then **Allow** |
| Secrets | **Never** receive GitHub token, session_token, or user_id from user | Never paste tokens into chat |

## Correct workflow (5 steps)

1. **Discover** — \`list_capabilities\`
2. **Authorize** — \`request_authorization\` with \`capabilities\` only (**omit \`user_id\`**)
3. **Send link** — give user \`authorization_request.approval_url\` (e.g. \`https://cnothing.com/authorize/{uuid}\`)
4. **Poll** — \`GET /v2/authorize/{id}\` until \`status\` is \`approved\`
5. **Invoke** — \`invoke_capability\` with \`capability\` + \`input\` (**omit \`user_id\`** when one grant exists)

**Never ask the human for:** \`session_token\`, \`login_token\`, \`user_id\`, GitHub tokens, or CNothing private keys.

### Example: request authorization

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

Say to the user: **"Open this link in your browser, sign in with GitHub if prompted, and click Allow: {approval_url}"**

### Example: invoke (after approval)

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

REST: \`POST /v2/capabilities/invoke\` with header \`Authorization: Bearer agent_...\`.

## Do NOT use these for GitHub user login

- \`authai_register\` / \`kv_save\` — deprecated v1; not user OAuth
- \`GET /v2/auth/github/start\` — browser redirect only; not for agents
- Console \`/login\` + copy \`session_token\` — never share tokens with the agent

## v1 AuthAI/KV (deprecated)

Do not start new integrations on v1. Migration: \`GET /v2/platform/migration\`

Docs: \`/openapi-v2.json\`, \`${MCP_V2_AUTH_WORKFLOW_URI}\`, \`/getting-started.md\`
`.trim();
