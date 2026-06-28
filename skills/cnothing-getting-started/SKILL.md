---
name: cnothing-getting-started
description: Use when an AI or developer is integrating with CNothing for the first time. Prefer v2.5 OAuth broker + capability gateway; v1 AuthAI/KV is deprecated.
---

# CNothing Getting Started

Use this skill when you are new to CNothing. **Start with v2.5** — connect OAuth once, import capabilities, agents invoke by name.

## Discovery Links

- OpenAPI v2.5: `/openapi-v2.5.json`
- OpenAPI v2 (legacy): `/openapi-v2.json`
- Platform status: `/v2/platform/status`
- MCP info: `/mcp`
- MCP manifest: `/mcp/manifest`
- Skills index: `/skills/index.json`
- Getting started: `/getting-started.md`

## Core Principle

**Agent Never Owns Secrets. Agent Only Receives Capability Grants.**

## v2.5 Platform Flow (Recommended)

No custom connector deployment required for most third-party APIs.

1. **Providers** — Admin registers OAuth client credentials (`/providers` or `POST /v2/oauth/providers`).
2. **Import** — Admin uploads OpenAPI or MCP manifest (`/import`), binds provider, activates capabilities.
3. **Connect** — User links OAuth once (`/connect`).
4. **Agent** — Register agent (`POST /v2/agents/register`) → save `access_token`.
5. **Authorize** — `request_authorization` with `capability` → user opens `approval_url` → approves with OAuth connection.
6. **Invoke** — `invoke_capability` or `POST /v2/agent/invoke`.
7. **Audit** — `GET /v2/audit`.

MCP resource with full browser OAuth flow: **`resource://cnothing/v2-user-authorization`**

### Agent SDK (default v2.5)

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
// Send auth.approval_url to the user

await agent.invoke({
  capability: "github.create_issue",
  input: { owner: "org", repo: "repo", title: "Demo" },
});
```

## Legacy v2 Connectors (Advanced)

Example connector apps under `examples/*-connector` remain for custom callback integrations.
Prefer OAuth + Import for new third-party platforms.

## v1 AuthAI/KV (Deprecated)

v1 envelope tools (`kv_save`, `kv_read`, `authai_register`, …) remain for backward compatibility.
**Do not start new integrations on v1.**

Migration: `GET /v2/platform/migration` or Console `/migration`.

## Demo Mode

- Browse `/skills/index.json` and `/standards/authentication/1.0`.
- Run `bun run e2e:v2.5` against a local deployment to validate the full v2.5 chain.

## Read More

- [mcp.md](../../docs/mcp.md) — MCP tools
- [protocol.md](../../docs/protocol.md) — v1 envelope protocol (legacy)
