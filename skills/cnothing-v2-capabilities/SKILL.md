---
name: cnothing-v2-capabilities
description: Use when an AI agent invokes CNothing v2.5 capabilities or requests user OAuth approval. Agents never receive tokens — users connect OAuth in the browser.
---

# CNothing v2.5 Capabilities

## Core rule

**Agents receive capability grants only. Never OAuth tokens, API keys, or client secrets.**

## Platform path (default)

1. Admin configures OAuth providers (`/providers` or env vars synced via `POST /v2/admin/oauth/sync-env`)
2. Admin imports OpenAPI/MCP specs (`/import`) and activates capabilities
3. User connects OAuth once (`/connect`)
4. Agent discovers → requests authorization → user approves at `approval_url` → invokes

No custom connector deployment required for most third-party APIs.

## Primary APIs (v2.5)

| Surface | Endpoint / Tool | Auth |
| --- | --- | --- |
| Discover | `GET /v2/agent/capabilities` / MCP `list_capabilities` | `Bearer agent_...` |
| Authorize | `POST /v2/agent/authorizations` / MCP `request_authorization` | `Bearer agent_...` |
| Poll | `GET /v2/agent/authorizations/{id}` / MCP `get_authorization_status` | `Bearer agent_...` |
| Invoke | `POST /v2/agent/invoke` / MCP `invoke_capability` | `Bearer agent_...` |
| Grants | `GET /v2/agent/grants` / MCP `list_grants` | `Bearer agent_...` |

Legacy v2 endpoints (`POST /v2/capabilities/invoke`, `POST /v2/authorize/request`) remain for older integrations.

## Authorization flow

1. Agent: `request_authorization` with a single `capability` (**omit `user_id`**).
2. Response: `approval_url` e.g. `https://cnothing.com/approve/{uuid}`.
3. User: open link → select OAuth connection → approve.
4. Agent: poll authorization status until `approved`.
5. Agent: `invoke_capability` with `capability` + `input`.

Say to the user: **"Open this link and approve the capability: {approval_url}"**

## SDK example

```ts
import { CNothingAgentClient } from "cnothing";

const agent = new CNothingAgentClient({
  baseUrl: "https://cnothing.com",
  accessToken: process.env.AGENT_ACCESS_TOKEN!,
});

const auth = await agent.requestAuthorization({
  capability: "github.create_issue",
  reason: "Create an issue on your behalf",
});

await agent.invoke({
  capability: "github.create_issue",
  input: { owner: "org", repo: "repo", title: "Bug report" },
});
```

## Never do this

- Do not ask users for OAuth tokens, `session_token`, or `user_id`.
- Do not use v1 `kv_*` / `authai_*` tools for new integrations.
- Do not deploy `examples/*-connector` unless you need a custom callback integration.

## Links

- OpenAPI v2.5: `/openapi-v2.5.json`
- MCP workflow: `resource://cnothing/v2-user-authorization`
- Provider templates: `GET /v2/platform/provider-templates`
- Getting started: `/getting-started.md`
