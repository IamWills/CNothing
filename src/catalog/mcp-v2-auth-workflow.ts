/**
 * Canonical v2 user authorization + GitHub sign-in workflow for MCP resources and initialize instructions.
 * Agents MUST read this before attempting GitHub login or asking users for tokens.
 */
export const MCP_V2_AUTH_WORKFLOW_MARKDOWN = `
# CNothing v2 — User Authorization & GitHub Sign-In (READ FIRST)

## Critical: MCP is NOT where humans log in to GitHub

Connecting to **https://cnothing.com/mcp** gives the **agent** JSON-RPC tools (\`invoke_capability\`, \`request_authorization\`, …).

**There is no MCP tool to log a human into GitHub.** GitHub sign-in happens only in the **user's web browser** on **https://cnothing.com**, after the agent sends an **approval link**.

| Role | What they do | Where |
| --- | --- | --- |
| **AI Agent** | Call \`request_authorization\`, send user the \`approval_url\`, poll status, then \`invoke_capability\` | MCP \`POST /mcp\` or REST \`/v2/*\` with **agent access token** |
| **Human user** | Open \`approval_url\` in a browser → Sign in with GitHub → click **Allow** | **https://cnothing.com/authorize/{id}** (Console) |

**Never ask the user for:** \`session_token\`, \`login_token\`, \`user_id\`, GitHub access tokens, or CNothing client private keys.

---

## End-to-end flow (GitHub + capabilities e.g. \`github.list_repositories\`)

### Step 1 — Agent requests authorization (MCP)

\`\`\`json
{
  "method": "tools/call",
  "params": {
    "name": "request_authorization",
    "arguments": {
      "agent_access_token": "agent_...",
      "capabilities": ["github.list_repositories", "search.query"],
      "reason": "Access your GitHub repos and search on your behalf"
    }
  }
}
\`\`\`

**Do NOT pass \`user_id\`.** CNothing binds the user when they approve in the browser.

Response (example):

\`\`\`json
{
  "authorization_request": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "pending",
    "approval_url": "https://cnothing.com/authorize/550e8400-e29b-41d4-a716-446655440000"
  }
}
\`\`\`

### Step 2 — Agent sends the human ONE link (browser only)

Tell the user in plain language:

> Please open this link in your browser, sign in with GitHub if asked, and click **Allow selected capabilities**:  
> **https://cnothing.com/authorize/{id}**

The agent must **not** open GitHub OAuth itself and must **not** call \`GET /v2/auth/github/start\` — that endpoint redirects browsers, not agents.

### Step 3 — What happens in the browser (user side)

1. User opens \`approval_url\` → Console page **Authorize Agent**
2. If not signed in → user clicks **Sign in with GitHub** on that same page
3. Browser goes to GitHub → user approves CNothing OAuth app
4. Browser returns to \`/authorize/{id}\` with an HttpOnly session cookie (no token in URL)
5. User clicks **Allow selected capabilities**
6. CNothing creates **Grants** linking \`github:{login}\` → agent → capabilities  
   (Search capabilities also trigger backend Search account link — no KV)

### Step 4 — Agent polls until approved (REST)

\`GET https://cnothing.com/v2/authorize/{id}\` (no auth required to read status)

Wait until \`status\` is \`approved\`. Then note \`user_id\` (e.g. \`github:octocat\`) — optional; invoke often works without it.

### Step 5 — Agent invokes (MCP)

\`\`\`json
{
  "method": "tools/call",
  "params": {
    "name": "invoke_capability",
    "arguments": {
      "agent_access_token": "agent_...",
      "capability": "github.list_repositories",
      "input": { "per_page": 10 }
    }
  }
}
\`\`\`

**Omit \`user_id\`** when this agent has a single active grant for that capability.

CNothing uses the grant, loads the user's GitHub credential on the server, and returns repo metadata. The agent never sees the GitHub token.

---

## Common mistakes (why agents get confused)

| Mistake | Why it fails |
| --- | --- |
| Agent calls \`authai_register\` to "log in" | v1 identity for KV — **not** user GitHub OAuth |
| Agent sends user to \`/login\` and asks to copy \`session_token\` | Deprecated; tokens must not be shared with agents |
| Agent calls \`GET /v2/auth/github/start\` | Browser redirect — not for programmatic agent use |
| Agent asks user for \`github:username\` before authorization | Unnecessary; user identity is bound at approve time |
| Agent invokes before user clicks Allow | \`403 grant_not_found\` — run Step 1–4 first |

---

## Quick reference URLs (production)

| Purpose | URL |
| --- | --- |
| MCP endpoint | \`POST https://cnothing.com/mcp\` |
| List capabilities | MCP \`list_capabilities\` or \`GET /v2/capabilities\` |
| Request authorization | MCP \`request_authorization\` or \`POST /v2/authorize/request\` |
| User approval page | \`https://cnothing.com/authorize/{id}\` |
| Poll authorization status | \`GET /v2/authorize/{id}\` |
| Invoke capability | MCP \`invoke_capability\` or \`POST /v2/capabilities/invoke\` |
| OpenAPI v2 | \`GET /openapi-v2.json\` |
| This workflow (MCP resource) | \`resource://cnothing/v2-user-authorization\` |

---

## v1 AuthAI / KV

Deprecated. Do not use \`kv_save\`, \`kv_read\`, or \`authai_register\` for new GitHub or Search integrations. Use capabilities + \`request_authorization\` instead.
`.trim();

export const MCP_V2_AUTH_WORKFLOW_URI = "resource://cnothing/v2-user-authorization";
