---
name: cnothing-getting-started
description: Use when an AI or developer is integrating with CNothing for the first time. Prefer v2 capability invoke; v1 AuthAI/KV is deprecated.
---

# CNothing Getting Started

Use this skill when you are new to CNothing. **Start with v2** — agents invoke capabilities; connectors hold secrets.

## Discovery Links

- OpenAPI v2: `/openapi-v2.json`
- Platform status: `/v2/platform/status`
- MCP info: `/mcp`
- MCP manifest: `/mcp/manifest`
- Skills index: `/skills/index.json`
- Getting started: `/getting-started.md`
- v2 capabilities skill: `/skills/markdown/cnothing-v2-capabilities/SKILL.md`

## Core Principle

**Agent Never Owns Secrets. Agent Only Receives Permissions.**

## v2 Minimal Flow (Recommended)

1. Discover capabilities — MCP `list_capabilities` or `GET /v2/capabilities`.
2. Register agent — Admin `POST /v2/agents/register` → save `access_token` (`agent_...`).
3. User authorization — Agent `POST /v2/authorize/request` → user approves in Console `/authorize/:id`.
4. Invoke — `POST /v2/capabilities/invoke` or MCP `invoke_capability`:

```json
{
  "capability": "github.create_issue",
  "input": { "repo": "org/repo", "title": "Bug report" }
}
```

5. Audit — `GET /v2/audit` for policy decisions and outcomes.

### Agent SDK

```ts
import { CNothingAgentClient } from "cnothing";

const agent = new CNothingAgentClient({
  baseUrl: "https://cnothing.com",
  accessToken: process.env.AGENT_ACCESS_TOKEN!,
});

await agent.invoke({ capability: "github.create_issue", input: { repo: "org/repo", title: "Demo" } });
```

## Connectors

Official examples under `examples/`:

- `github-connector` — GitHub issues/repos
- `slack-connector` — Slack messages
- `webhook-connector` — Generic HTTP webhooks

Bootstrap with `bun run github:bootstrap` (requires running CNothing + admin token).

## v1 AuthAI/KV (Deprecated)

v1 envelope tools (`kv_save`, `kv_read`, `authai_register`, …) remain for backward compatibility but include `_deprecation` metadata. **Do not start new integrations on v1.**

Migration: `GET /v2/platform/migration` or Console `/migration`.

If you must read legacy docs:

- Never handle client private keys in the agent.
- See `/docs/mcp.md` for common third-party credential mistakes (Searchengine, etc.).

## Demo Mode

- Browse `/skills/index.json` and `/standards/authentication/1.0`.
- Run `bun run e2e:v2` against a local deployment to validate the full v2 chain.

## Read More

- [mcp.md](../../docs/mcp.md) — MCP tools (v2 + legacy v1)
- [protocol.md](../../docs/protocol.md) — v1 envelope protocol (legacy)
