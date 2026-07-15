---
name: cnothing-v4
description: Use when an AI agent needs to call third-party OAuth 2.0 APIs (GitHub, Google, any provider) on behalf of a user through the CNothing v4 credential-injecting proxy, or needs to install the CNothing MCP as its callable tool. Agents never receive tokens.
---

# CNothing v4 — Universal Credential-Injecting Proxy

Use this skill when an AI agent needs to call third-party APIs (GitHub, Google, Slack,
or any OAuth 2.0 provider) on behalf of a human user **without ever handling tokens,
API keys, or client secrets**.

## What CNothing does

CNothing stores the user's OAuth connections server-side (encrypted). After one human
approval per provider, the agent can call **any https API of that provider** through
`POST /v4/proxy`; CNothing injects the `Authorization` header, auto-refreshes tokens,
redacts secrets from responses, and audits every call.

## Prerequisites

- An agent access token (`AGENT_TOKEN`). Self-service — register yourself:

```bash
curl -X POST https://cnothing.com/v4/agents/register \
  -H "content-type: application/json" \
  -d '{"name":"my-agent"}'
# => { "agent": {...}, "access_token": "agent_..." }  # shown once, store it
```

  No admin token is needed: an agent token alone grants nothing until a human
  approves an access request.
- Base URL: `https://cnothing.com` (or your deployment).

## Self-test without a human (sandbox)

Verify the entire mechanics before involving a real provider or user:

```bash
curl -X POST https://cnothing.com/v4/sandbox/start \
  -H "Authorization: Bearer $AGENT_TOKEN"
# => { "grant_id": "...", "echo_url": "https://cnothing.com/v4/sandbox/echo", ... }

curl -X POST https://cnothing.com/v4/proxy \
  -H "Authorization: Bearer $AGENT_TOKEN" -H "content-type: application/json" \
  -d '{"grant_id":"'$GRANT_ID'","method":"GET","url":"https://cnothing.com/v4/sandbox/echo?hello=world"}'
# The echo shows the forwarded request; the injected token appears as [REDACTED].
```

The sandbox grant is auto-approved because it can only reach CNothing's own echo
endpoint with a throwaway token. Real providers always require one human approval.

## Workflow (plain HTTP)

1. Discover providers:

```bash
curl https://cnothing.com/v4/providers
```

2. Request connection-level access:

```bash
curl -X POST https://cnothing.com/v4/access-requests \
  -H "Authorization: Bearer $AGENT_TOKEN" -H "content-type: application/json" \
  -d '{"provider":"github","reason":"Manage issues for the user"}'
```

Response contains `access_request_id` and `approval_url`.

3. Send `approval_url` to the human. They open it in a browser, sign in to CNothing,
   pick (or create) their GitHub connection, and click Approve — once.

4. Poll until approved:

```bash
curl https://cnothing.com/v4/access-requests/$ID \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

`status: "approved"` includes `grant_id`.

5. Call any API through the proxy:

```bash
curl -X POST https://cnothing.com/v4/proxy \
  -H "Authorization: Bearer $AGENT_TOKEN" -H "content-type: application/json" \
  -d '{
    "grant_id": "'$GRANT_ID'",
    "method": "POST",
    "url": "https://api.github.com/repos/OWNER/REPO/issues",
    "body": { "title": "Created via CNothing v4 proxy" }
  }'
```

## No HTTP tool? Use MCP

If your runtime has no generic HTTP tool, configure the CNothing MCP server instead —
it exposes the same workflow as callable tools (`register_agent`, `start_sandbox`,
`list_providers`, `request_access`, `get_access_status`, `proxy_request`,
`list_grants`, `submit_provider_proposal`).

- Hosted (remote MCP): `https://cnothing.com/mcp` — pass `agent_access_token` in tool
  arguments.
- Local (stdio MCP): install the `cnothing-mcp` package from `packages/cnothing-mcp`,
  configure env `CNOTHING_BASE_URL` and `CNOTHING_AGENT_TOKEN` in your MCP client
  config (Cursor, Claude Desktop, etc.).

## Rules

- Never ask users for tokens or passwords; never try to bypass the approval step.
- Agent-supplied `authorization`/`cookie` headers are stripped by the proxy.
- URL hosts must match the grant's allowlist (`host_not_allowed` otherwise).
- Handle `grant_revoked` by requesting access again.
- Providers missing from `/v4/providers` can be onboarded via
  `POST /v4/providers/proposals` (OIDC discovery + RFC 7591 DCR when available).
