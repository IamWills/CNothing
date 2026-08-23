# cnothing-mcp

stdio MCP adapter for CNothing v4.

If `CNOTHING_AGENT_TOKEN` is unset, the adapter starts user-approved enrollment (`POST /v4/agent-enrollments`), shows only `approval_url` and `user_code` to the model, and writes the claimed token to `CNOTHING_AGENT_TOKEN_FILE` (default `~/.config/cnothing/agent.token`). Spec: https://cnothing.com/plugin.md

Supports MCP `2026-07-28` and retains compatibility with the supported 2025/2024 initialization flow.

```json
{
  "mcpServers": {
    "cnothing": {
      "command": "bun",
      "args": ["run", "/path/to/packages/cnothing-mcp/src/index.ts"],
      "env": {
        "CNOTHING_BASE_URL": "https://cnothing.com"
      }
    }
  }
}
```

The adapter enrolls when no token is configured. `CNOTHING_AGENT_TOKEN` remains a valid host-only override. Never put the token in tool arguments or chat.

Tools: `list_grants`, `list_providers`, `request_access`, `get_access_status`, `proxy_request`.
