---
name: cnothing-v2-capabilities
description: Use when an AI agent needs to invoke CNothing v2 capabilities, request user authorization, or integrate via MCP invoke_capability without handling secrets.
---

# CNothing v2 Capabilities

Reference skill for the Agent Capability Authorization Platform.

## Primary APIs

| Surface | Endpoint / Tool | Auth |
| --- | --- | --- |
| Invoke | `POST /v2/capabilities/invoke` / MCP `invoke_capability` | `Bearer agent_...` |
| Authorize | `POST /v2/authorize/request` / MCP `request_authorization` | `Bearer agent_...` |
| Discover | `GET /v2/capabilities` / MCP `list_capabilities` | Public |
| JWKS | `GET /v2/jwks` | Public (Connectors verify grants) |

## Invoke Request

```json
{
  "capability": "slack.post_message",
  "input": {
    "channel": "C0123456789",
    "text": "Hello from agent"
  },
  "user_id": "user123",
  "reason": "Notify on-call rotation",
  "confirmation_id": "optional-after-user-approval"
}
```

### Responses

- **200** — `{ ok: true, result: {...} }` — business result from Connector
- **202** — `{ ok: false, pending: true, confirmation_id, expires_at }` — user must confirm in Console
- **403** — missing grant or policy denied

## Authorization Flow

1. Agent calls `request_authorization` with `capabilities: ["github.create_issue"]`.
2. Response includes `approval_url` (Console `/authorize/:id`).
3. User signs in (`/login`, OIDC or login token) and approves.
4. CNothing issues Grants; agent can invoke.

## Policy Engine

Capabilities have `risk_level` (PUBLIC → CONFIDENTIAL). Policies may:

- `allow` — invoke immediately
- `deny` — block
- `require_user_confirmation` — return 202 pending
- `require_explicit_reason` — agent must pass `reason`

## Connectors

CNothing forwards invokes to Connector `callback_url` with a short-lived Capability Grant JWT. Connectors:

- Verify JWT via `GET /v2/jwks`
- Execute third-party API with **local credentials**
- Return `{ ok: true, result }` — never include raw secrets

Example connectors: GitHub (3031), Slack (3032), Webhook (3033).

## MCP Example

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "invoke_capability",
    "arguments": {
      "agent_access_token": "agent_...",
      "capability": "webhook.notify",
      "input": {
        "title": "Deploy complete",
        "message": "v2.0.0 rolled out",
        "severity": "info"
      }
    }
  }
}
```

## Never Do This

- Do not use v1 `kv_read` / `kv_save` for new integrations.
- Do not ask users for API keys in agent context — use Grants + Connectors.
- Do not decrypt Capability Grant JWTs in the agent — only Connectors verify them.

## Links

- OpenAPI: `/openapi-v2.json`
- Platform: `/v2/platform/status`
- Audit: `/v2/audit` (admin)
