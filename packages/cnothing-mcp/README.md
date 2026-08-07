# cnothing-mcp

stdio MCP adapter for CNothing v4.

Supports MCP `2026-07-28` and retains compatibility with the supported 2025/2024 initialization flow.

```json
{
  "mcpServers": {
    "cnothing": {
      "command": "bun",
      "args": ["run", "/path/to/packages/cnothing-mcp/src/index.ts"],
      "env": {
        "CNOTHING_BASE_URL": "https://cnothing.com",
        "CNOTHING_AGENT_TOKEN": "agent_..."
      }
    }
  }
}
```

Create and revoke Agent identities in the authenticated CNothing Console. The token is read from the process environment and is not exposed as a tool argument.

Tools: `list_grants`, `list_providers`, `request_access`, `get_access_status`, `proxy_request`.
