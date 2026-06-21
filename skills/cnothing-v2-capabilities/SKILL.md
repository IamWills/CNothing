---
name: cnothing-v2-capabilities
description: Use when an AI agent needs to invoke CNothing v2 capabilities or request user GitHub authorization. MCP cannot log users into GitHub — send approval_url to the human browser.
---

# CNothing v2 Capabilities

## GitHub login — agent vs human

**There is no MCP tool for GitHub login.**

| Agent | Human |
| --- | --- |
| `request_authorization` → send `approval_url` | Open `https://cnothing.com/authorize/{id}` in browser |
| Poll `GET /v2/authorize/{id}` | Click **Sign in with GitHub** on that page |
| `invoke_capability` | Click **Allow selected capabilities** |

Never ask the user for `session_token`, `login_token`, `user_id`, or GitHub tokens.

Read MCP resource: **`resource://cnothing/v2-user-authorization`**

## Primary APIs

| Surface | Endpoint / Tool | Auth |
| --- | --- | --- |
| Invoke | `POST /v2/capabilities/invoke` / MCP `invoke_capability` | `Bearer agent_...` |
| Authorize | `POST /v2/authorize/request` / MCP `request_authorization` | `Bearer agent_...` |
| Discover | `GET /v2/capabilities` / MCP `list_capabilities` | Public |
| Poll approval | `GET /v2/authorize/{id}` | Public |

## Authorization Flow

1. Agent: `request_authorization` with `capabilities` only (**omit `user_id`**).
2. Response: `approval_url` e.g. `https://cnothing.com/authorize/{uuid}`.
3. User: open link → GitHub sign-in → Allow.
4. Agent: poll until `status === "approved"`.
5. Agent: `invoke_capability` (**omit `user_id`** when single grant).

## Invoke Example

```json
{
  "agent_access_token": "agent_...",
  "capability": "github.list_repositories",
  "input": { "per_page": 10 }
}
```

## Never Do This

- Do not use `authai_register` for user GitHub OAuth.
- Do not call `GET /v2/auth/github/start` from the agent (browser only).
- Do not ask users to paste tokens from `/login`.
- Do not use v1 `kv_read` / `kv_save` for new GitHub or Search integrations.

## Links

- MCP workflow: `resource://cnothing/v2-user-authorization`
- OpenAPI: `/openapi-v2.json`
- Platform: `/v2/platform/status`
