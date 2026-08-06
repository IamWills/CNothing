# cnothing-mcp

Local stdio MCP server for **CNothing v4 only** (cnothing.com universal proxy).

This is the agent's callable tool for using GitHub (or any OAuth 2.0 provider) through
CNothing. The agent never logs into GitHub and never sees tokens.

Do **not** follow AuthAI / KV / v2 capability docs (`request_authorization`,
`invoke_capability`, `/authorize/{id}`). Those are obsolete.

## Prerequisites

1. A running CNothing deployment (e.g. `https://cnothing.com`).
2. An agent access token — **self-service**. Call `register_agent` after configure, or:

```bash
curl -X POST https://cnothing.com/v4/agents/register \
  -H "content-type: application/json" \
  -d '{"name":"my-agent"}'
# => { "agent": {...}, "access_token": "..." }
```

3. For real provider calls, the **human** must:
   - Sign in at `https://cnothing.com/login`
   - Connect the provider at `https://cnothing.com/connect`
   - Approve via phone push (when you pass `user_id`) or open the exact `approval_url`

When you know the human's GitHub username, CNothing id, or `u_` short code, **always**
pass it as `user_id` on `request_access` so they get a push and only need to Approve.

## Configure in your MCP client

Cursor (`~/.cursor/mcp.json`) or Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cnothing": {
      "command": "bun",
      "args": ["run", "/path/to/keyservice/packages/cnothing-mcp/src/index.ts"],
      "env": {
        "CNOTHING_BASE_URL": "https://cnothing.com",
        "CNOTHING_AGENT_TOKEN": "<agent access token>"
      }
    }
  }
}
```

## Tools

| Tool | Purpose |
| --- | --- |
| `register_agent` | Self-register; obtain agent token (no admin) |
| `start_sandbox` | Auto-approved sandbox grant for self-test |
| `list_providers` | Discover OAuth provider slugs |
| `request_access` | Request access; returns exact `approval_url` for the human |
| `get_access_status` | Poll until `approved` → `grant_id` |
| `proxy_request` | Call any https API on granted hosts; token injected server-side |
| `list_grants` | List grants |
| `submit_provider_proposal` | Propose a new OAuth/OIDC provider |
| `get_provider_proposal` | Check proposal status |

## Flow

0. Optional: `start_sandbox` → `proxy_request` on `echo_url` (no human).
1. `request_access { provider: "github", reason: "...", user_id?: "alice" }` —
   **pass `user_id` whenever you know** their GitHub login / `github:…` / `u_` code.
2. If `pushed_to_devices > 0`, tell them to Approve on the phone; always also share
   the exact `approval_url` (`https://cnothing.com/approve-proxy/{uuid}`) as fallback.
   Never rewrite it.
3. `get_access_status` until `status: "approved"` → `grant_id`.
4. `proxy_request { grant_id, method, url, body? }` for any API of that provider.

Full agent skill: `https://cnothing.com/skill.md`
