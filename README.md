# CNothing

中文说明：[README.CN.MD](./README.CN.MD)

**CNothing v4** is a universal credential-injecting proxy for AI agents.
After one human approval per OAuth provider, an agent can call **any HTTPS API** of that
provider. The agent never sees access tokens, refresh tokens, or client secrets.

Production: [https://cnothing.com](https://cnothing.com)

## Agent documentation (start here)

| Resource | URL / path |
| --- | --- |
| **Primary skill (required reading)** | [`skills/cnothing-v4/SKILL.md`](./skills/cnothing-v4/SKILL.md) → `https://cnothing.com/skill.md` |
| MCP guide | [`docs/mcp.md`](./docs/mcp.md) |
| OpenAPI | [`openapi-v4.json`](./openapi-v4.json) → `https://cnothing.com/openapi-v4.json` |
| Hosted MCP | `https://cnothing.com/mcp` |
| Local MCP | [`packages/cnothing-mcp`](./packages/cnothing-mcp) |

**Only v4 is supported for agents.** Ignore AuthAI envelopes, KV save/read,
`request_authorization`, `invoke_capability`, `/authorize/{id}`, `/v2/*`, and `/v3/*`.

## What agents and humans each do

| Role | Does | Does not |
| --- | --- | --- |
| **Agent** | Register → `request_access` (**pass `user_id` when GitHub username known**) → show exact `approval_url` / push → poll for `grant_id` → `POST /v4/proxy` | Log into GitHub; hold tokens; invent approval URLs |
| **Human** | Sign in at `/login`, connect provider at `/connect`, Approve via phone push or `approval_url` | Paste passwords/PATs/session tokens to the agent |

```text
0. Agent self-registers          →  POST /v4/agents/register { name }
1. Human connects provider once  →  https://cnothing.com/connect
2. Agent requests access         →  POST /v4/access-requests { provider, reason? }
3. Human approves once           →  exact approval_url (/approve-proxy/{uuid})
4. Agent calls any API           →  POST /v4/proxy { grant_id, method, url, body? }
```

Optional self-test without a human: `POST /v4/sandbox/start` then proxy the returned `echo_url`.

### Example (after grant)

```bash
curl -X POST https://cnothing.com/v4/proxy \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "grant_id": "…",
    "method": "GET",
    "url": "https://api.github.com/user"
  }'
```

Security (server-enforced): injected `Authorization`; agent auth/cookie headers stripped;
HTTPS + SSRF checks + host allowlist; token refresh; response redaction; audited grants.

## MCP for agents

- **Hosted:** `https://cnothing.com/mcp` — tools: `register_agent`, `start_sandbox`,
  `list_providers`, `request_access`, `get_access_status`, `proxy_request`, …
- **Local stdio:** configure `CNOTHING_BASE_URL` + `CNOTHING_AGENT_TOKEN` in
  [`packages/cnothing-mcp`](./packages/cnothing-mcp).

## Human console

- Login: `https://cnothing.com/login`
- Connect providers: `https://cnothing.com/connect`
- Approve agent requests: `https://cnothing.com/approve-proxy/{uuid}` (from API only)
- Phone approvals (optional): `https://cnothing.com/devices` + iOS app — see [`iOS/README.md`](./iOS/README.md)

## Older API versions

| Version | Status |
| --- | --- |
| **v4** | Current — use this |
| **v2 / v3** | Removed — `410 Gone` (legacy OAuth callback paths still aliased) |
| **v1 AuthAI + KV** | Deprecated compatibility only — **not** for GitHub/agent OAuth |

## Local development

```bash
cp .env.example .env
# set DATABASE_URL, KEYSERVICE_GITHUB_OAUTH_CLIENT_ID/SECRET, etc.
bun install
bun run migrate
bun run dev          # API :3021
bun run console:dev  # Console :3022
```

Verify:

```bash
curl http://127.0.0.1:3021/health
curl http://127.0.0.1:3021/openapi-v4.json | head
curl http://127.0.0.1:3021/skill.md | head
curl http://127.0.0.1:3021/mcp
```

E2E: `bun run e2e:v4`. Deploy: [`deploy/README.md`](./deploy/README.md).
CI on `main`: typecheck, build, migrate, tests, `e2e:v4`.

## Repository

- [https://github.com/IamWills/CNothing](https://github.com/IamWills/CNothing)
