# CNothing agent plugin contract

This is the minimum standard a host plugin must implement to use CNothing. An agent that can write plugins should implement this contract rather than asking a human to paste secrets or to invent a CNothing-specific integration.

CNothing is new. Hosts are not expected to ship a built-in CNothing plugin. The plugin an agent writes **holds identity**. The model **must never see** the enrollment secret or the agent token.

## Discovery

| Resource | URL |
|---|---|
| This document | `https://cnothing.com/plugin.md` |
| Machine-readable contract | `https://cnothing.com/plugin.json` |
| MCP info | `https://cnothing.com/.well-known/mcp` |
| MCP manifest | `https://cnothing.com/mcp/manifest` |
| Agent skill | `https://cnothing.com/skill.md` |
| OpenAPI | `https://cnothing.com/openapi.json` |
| Hosted MCP | `https://cnothing.com/mcp` |

Read `/plugin.json` first when generating a plugin.

## Hard rules

1. **Host holds secrets.** `enrollment_secret` and `agent_…` tokens live only in the process environment, OS keychain, or a `0600` file. They are not MCP tool arguments, tool results, chat text, or logs.
2. **Enrollment is not an MCP tool.** `POST /v4/agent-enrollments` and the subsequent poll run inside the plugin process. If those HTTP responses are forwarded to the model, the plugin is incorrect.
3. **No anonymous Agent identity.** Creating an enrollment does not mint an Agent. A signed-in user must approve it. Until then, `tools/call` and `/v4/proxy` fail.
4. **Do not ask the user for a token.** Relay `user_action.message`, `approval_url`, and `user_code` unchanged. Compare the pairing code. Never accept a password, OAuth token, or `agent_…` value from the user or the model.
5. **After pairing, reuse the stored token.** Do not enroll again on every request.

## Identity bootstrap (required)

When the host has no agent token:

1. `POST /v4/agent-enrollments` with JSON `{ "client_name": "<runtime name>" }`. Optional `client_uri` (https) and `software_id`.
2. Store `enrollment_secret` locally. Show the user only `approval_url` and `user_code`.
3. Poll `GET /v4/agent-enrollments/{enrollment_id}` no faster than `retry_after_seconds`, with `Authorization: Bearer <enrollment_secret>`.
4. On `status: pending`, keep waiting. On `denied` or `expired`, stop or restart enrollment.
5. On `status: approved` with `access_token`, write the token to the secret store, delete the enrollment secret, and never print the token.
6. Later polls return `token_delivered: true` without the token.

The user opens `approval_url` (`/approve-agent/{id}`), signs in, confirms the pairing code, and approves. CNothing then creates the Agent owned by that user. The Console does not display the token.

Operator recovery (`POST /v4/agents`, admin only) may mint a token into a secret manager. That path is not for the model and must not be copied into chat.

## Authenticated API (after pairing)

Transport:

- Hosted MCP: `Authorization: Bearer agent_…` on `POST /mcp`. Never in tool arguments.
- stdio MCP: `CNOTHING_AGENT_TOKEN` or the plugin token file.
- REST: the same bearer on `/v4/*`.

Required sequence:

1. `list_grants` / `GET /v4/grants`
2. If no matching active grant: `list_providers` / `GET /v4/providers`
3. `request_access` / `POST /v4/access-requests`
4. Relay `approval_url`; poll `get_access_status` / `GET /v4/access-requests/{id}`
5. `proxy_request` / `POST /v4/proxy`

Do not send `Authorization` or `Cookie` inside `proxy_request`. CNothing injects the user's provider credential.

## MCP 2026-07-28 hosted client

If the plugin speaks hosted MCP `2026-07-28`, each request must include:

- Header `mcp-protocol-version: 2026-07-28`
- Header `mcp-method` matching the JSON-RPC method
- Header `mcp-name` matching `tools/call` name or `resources/read` URI
- `params._meta["io.modelcontextprotocol/protocolVersion"]` matching the header
- `params._meta["io.modelcontextprotocol/clientCapabilities"]` as an object

Use `server/discover` instead of `initialize` on that version. Legacy `initialize` remains for 2025/2024 clients.

## Minimum host capabilities

The plugin, not the model, must be able to:

- Store a secret out of model context
- Make HTTPS requests to CNothing
- Present an `https` URL and a short pairing code to the user
- Poll with a backoff of at least `retry_after_seconds`
- Attach the agent bearer token on later calls

If the host cannot store a secret, it cannot use CNothing.

## Reference implementation

`agenttools/mcp` is a stdio adapter that enrolls when `CNOTHING_AGENT_TOKEN` is missing, writes the claimed token to a `0600` file, and never returns it from a tool. `agenttools/node` (`cnothing-agent`) is the same core for programmatic hosts.
