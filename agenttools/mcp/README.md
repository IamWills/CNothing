# cnothing-mcp

stdio MCP adapter for CNothing v4. Enrollment and the agent token stay in this process. Spec: https://cnothing.com/plugin.md

```json
{
  "mcpServers": {
    "cnothing": {
      "command": "bun",
      "args": ["run", "/path/to/agenttools/mcp/src/index.ts"],
      "env": {
        "CNOTHING_BASE_URL": "https://cnothing.com"
      }
    }
  }
}
```

Tools: `list_grants`, `list_providers`, `request_access`, `get_access_status`, `proxy_request`.
