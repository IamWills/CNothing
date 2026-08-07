---
name: cnothing-v4
description: Use a user-approved OAuth connection to call third-party APIs without receiving user credentials. Reuse a grant, request approval when needed, then call through the CNothing proxy.
---

# CNothing v4 Agent workflow

Use CNothing when a task requires an API protected by a user's OAuth account.

## Required sequence

1. Call `list_grants` first.
2. Reuse an active grant only when its provider and `allowed_hosts` cover the intended request.
3. If no grant matches, call `list_providers` and select the exact provider slug.
4. Call `request_access` with a short, task-specific reason.
5. If the conversation already contains the user's CNothing ID, GitHub username, or `u_` share code, pass it as `user_id` so a paired iOS device can receive a push. If it is unknown, omit it and continue.
6. Relay `user_action.message` and the exact `approval_url` unchanged. When `pushed_to_devices` is positive, also tell the user to check the CNothing iOS notification.
7. Call `get_access_status` no faster than `retry_after_seconds`.
8. After approval, call `proxy_request` with the returned `grant_id` and an HTTPS URL covered by `allowed_hosts`.

## Role boundary

The user signs in, connects the Provider, and approves access in CNothing. The Agent calls only the CNothing tools or v4 API. Never request or accept passwords, personal access tokens, OAuth tokens, refresh tokens, cookies, session tokens, or client secrets.

Do not add `Authorization` or `Cookie` to `proxy_request`; CNothing strips those headers and injects the approved Provider credential inside the proxy.

## Recovery

- No matching grant: call `list_providers`, then `request_access`.
- Provider missing or not connectable: tell the user an operator must configure it.
- Approval pending: wait for `retry_after_seconds`; keep the exact approval URL available.
- Grant revoked or expired: request access again.
- Host not allowed: use a URL from the grant's `allowed_hosts`; do not broaden the grant without a new user approval.

Hosted MCP: `https://cnothing.com/mcp`
OpenAPI: `https://cnothing.com/openapi.json`
