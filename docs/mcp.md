# CNothing v4 MCP

CNothing MCP exposes five tools. The Agent credential belongs in the transport configuration, never in tool arguments.

The hosted and stdio transports implement the stateless MCP `2026-07-28` contract (`server/discover`, per-request metadata, routing headers, and cache hints) and retain the 2025-era initialize handshake for existing clients.

| Tool | Required use |
|---|---|
| `list_grants` | First call. Reuse an active grant when its provider and allowed hosts match. |
| `list_providers` | Discover the exact configured provider slug when no grant matches. |
| `request_access` | Create a user approval request. Relay the returned message and URL unchanged. |
| `get_access_status` | Check the decision no faster than `retry_after_seconds`. |
| `proxy_request` | Call an HTTPS API on an approved host. CNothing injects credentials. |

For hosted MCP, send the Agent token in the HTTP `Authorization: Bearer ...` header. For stdio, set `CNOTHING_AGENT_TOKEN` in the MCP server environment.

When `request_access` returns `pushed_to_devices > 0`, tell the user to check the CNothing iOS notification. Always provide `approval_url` as a fallback. The Agent must not open OAuth pages or ask the user for credentials.
