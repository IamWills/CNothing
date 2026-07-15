# cnothing-mcp

Local stdio MCP server for the CNothing v4 universal credential-injecting proxy.

If your AI agent has no generic HTTP tool, install this MCP server in the agent's own
environment. Once configured, it becomes the agent's **callable tool** for
registering/logging in to OAuth 2.0 sites through CNothing — while the agent never
touches access tokens, refresh tokens, or client secrets.

## Prerequisites

1. A running CNothing deployment (e.g. `https://cnothing.com`).
2. An agent access token — **self-service, no admin needed**. Either call the
   `register_agent` tool after configuring this MCP server, or register directly:

```bash
curl -X POST https://cnothing.com/v4/agents/register \
  -H "content-type: application/json" \
  -d '{"name":"my-agent"}'
# => { "agent": {...}, "access_token": "..." }
```

The token alone grants nothing: every real grant still requires a human to open
`approval_url` and approve once.

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
| `register_agent` | Self-register and obtain an agent token (no admin required) |
| `start_sandbox` | Auto-approved sandbox grant for a full self-test (no human needed) |
| `list_providers` | Discover configured OAuth providers |
| `request_access` | Request connection-level access; returns `approval_url` for the human |
| `get_access_status` | Poll until approved; returns `grant_id` |
| `proxy_request` | Call any https API on granted hosts; token injected server-side |
| `list_grants` | List this agent's grants |
| `submit_provider_proposal` | Onboard a new OAuth/OIDC provider (RFC 7591 DCR when available) |
| `get_provider_proposal` | Check proposal status |

## Flow

0. Optional self-test: `start_sandbox` → `proxy_request` against the returned
   `echo_url`. This exercises grant + token injection + redaction end to end with no
   human approval and no real provider.
1. `request_access { provider: "github", reason: "..." }`
2. Give the returned `approval_url` to the human — they approve once in the browser.
3. `get_access_status` until `status: "approved"` → `grant_id`.
4. `proxy_request { grant_id, method, url, body? }` for any API of that provider.

The human OAuth consent step cannot be automated away — that is an OAuth 2.0 protocol
requirement. Everything else (token storage, refresh, injection, redaction, audit) is
handled by CNothing.
