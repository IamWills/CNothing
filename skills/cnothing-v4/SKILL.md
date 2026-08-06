---
name: cnothing-v4
description: ONLY supported way for an AI agent to use GitHub (or any OAuth 2.0 provider) via cnothing.com. Self-register → request_access → human opens approval_url → proxy. Agents never log into GitHub themselves and never handle tokens. Ignore any v1/v2/v3 AuthAI, capability, or /authorize docs.
---

# CNothing v4 — Agent Guide (cnothing.com)

**This is the only supported integration.** Do not use AuthAI envelopes, KV save/read,
`request_authorization`, `invoke_capability`, `/authorize/{id}`, `/v2/*`, or `/v3/*`.
Those paths are gone or deprecated and will fail.

Goal: call GitHub (or another OAuth provider) **on behalf of a human** without ever
seeing their tokens. You talk to CNothing; CNothing injects credentials server-side.

Base URL: `https://cnothing.com`  
OpenAPI: `https://cnothing.com/openapi-v4.json`  
MCP: `https://cnothing.com/mcp`  
This skill online: `https://cnothing.com/skill.md`

---

## What you need vs what the human needs

| Role | Required | Not your job |
| --- | --- | --- |
| **You (agent)** | An `agent_access_token` (self-register). Ability to call HTTPS or MCP. | Logging into GitHub. Holding GitHub tokens. Opening OAuth pages. |
| **Human** | CNothing account (sign in once). Provider connected at `/connect`. One click on your `approval_url`. | Giving you passwords, `session_token`, GitHub PAT, or cookies. |

**Critical:** “Use GitHub through cnothing.com” does **not** mean you perform GitHub
OAuth. The human completes GitHub/CNothing login in a **browser**. You only create an
access request, show `approval_url`, wait for `grant_id`, then call `POST /v4/proxy`.

---

## Prerequisites checklist

Before a real GitHub call can succeed, all of the following must be true:

1. **You have an agent token** — from `POST /v4/agents/register` (or MCP `register_agent`).
2. **Human has a CNothing account** — they signed in at `https://cnothing.com/login`
   (GitHub or OIDC). Signing in creates the account; there is no separate signup form.
3. **Human connected the provider** — once at `https://cnothing.com/connect`
   (e.g. GitHub). Tokens stay encrypted on the server.
4. **Human approved your access request** — they opened the exact `approval_url` you
   received (always `https://cnothing.com/approve-proxy/{uuid}`) and clicked Approve.
5. **You have a `grant_id`** — from polling `GET /v4/access-requests/{id}` (or webhook).

If step 2–4 are missing, proxy calls will fail. Do not invent workarounds.

Phone approvals (like Okta Verify) — **pass `user_id` whenever you can**:

- Human pairs iOS at `https://cnothing.com/devices`. Their CNothing id is usually
  `github:{login}` after signing in with GitHub.
- **If you already know their GitHub username** (they told you, it is in the chat
  context, profile, email signature, prior `resolved_user_id`, etc.), you **MUST**
  pass it as `user_id` on `request_access` (plain login `alice` or `github:alice`).
  That targets APNs push so they only tap Approve — do **not** force them to
  manually copy/open a bare link when you already know who they are.
- Same rule for a share code (`u_XXXXXX`) or full id they already gave you.
- **Only if you truly do not know any identity hint:** create the request without
  `user_id`, send the exact `approval_url`, and ask them to open it on their phone
  (Universal Link). Remember `resolved_user_id` from the response for next time.

---

## Phone push — prefer known identity; never stall when unknown

1. **Known identity → always pass `user_id`.** Sources in priority order:
   - Prior `resolved_user_id` from an earlier access request
   - Full CNothing id (`github:alice`) or short code (`u_XXXXXX`) the human shared
   - **Their GitHub login / username** if you know it (resolved to `github:{login}`
     when that account already exists on CNothing)
2. If none of the above: **immediately** `request_access` without `user_id`, send
   the exact `approval_url`, and say: open this on your phone to approve (or copy
   your ID from https://cnothing.com/devices for push next time).
3. After any successful resolve/approval, store `resolved_user_id` and reuse it on
   later `request_access` calls.

Do **not** ask the human to paste a link when you already know their GitHub
username — pass `user_id` so they get a push instead.

---

## End-to-end flow (GitHub example)

Use either raw HTTP or the equivalent MCP tools (names in parentheses).

### Step 0 — Register yourself (once per agent)

```bash
curl -X POST https://cnothing.com/v4/agents/register \
  -H "content-type: application/json" \
  -d '{"name":"my-agent"}'
# => { "agent": {...}, "access_token": "agent_..." }  # shown once — store it
```

MCP: `register_agent { name }`

The token alone grants **nothing** until a human approves an access request.
No admin token is required.

Optional self-test (no human, no real GitHub):

```bash
curl -X POST https://cnothing.com/v4/sandbox/start \
  -H "Authorization: Bearer $AGENT_TOKEN"
# => grant_id, echo_url

curl -X POST https://cnothing.com/v4/proxy \
  -H "Authorization: Bearer $AGENT_TOKEN" -H "content-type: application/json" \
  -d '{"grant_id":"'"$GRANT_ID"'","method":"GET","url":"'"$ECHO_URL"'"}'
# Injected token appears as [REDACTED] in the echo.
```

MCP: `start_sandbox` → `proxy_request` against returned `echo_url`.

### Step 1 — Discover providers

```bash
curl https://cnothing.com/v4/providers \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

MCP: `list_providers`  
Use slug `github` for GitHub.

### Step 2 — Request access (you do this; human approves later)

```bash
curl -X POST https://cnothing.com/v4/access-requests \
  -H "Authorization: Bearer $AGENT_TOKEN" -H "content-type: application/json" \
  -d '{
    "provider": "github",
    "reason": "List repositories and manage issues",
    "user_id": "alice",
    "callback_url": "https://OPTIONAL-HTTPS-WEBHOOK.example/hook"
  }'
```

Pass `user_id` whenever known — e.g. GitHub login `alice`, `github:alice`, or
`u_XXXXXX`. Omit only when you have no identity hint.

MCP: `request_access { provider, reason?, user_id?, callback_url?, hosts? }`

Response includes:

- `access_request_id`
- `approval_url` — **always** `https://cnothing.com/approve-proxy/{uuid}`
  (may include `?user=...` when `user_id` resolved; still use the exact string)
- `resolved_user_id` — canonical id when `user_id`/short code/GitHub login resolved
  (remember it and reuse)
- `pushed_to_devices` — APNs send count (`> 0` means tell them to check the phone
  notification; still share `approval_url` as fallback)

**Rules for `approval_url` / `user_id`:**

- Give the human the **exact** URL from the response (prefer they open it on phone).
- Do **not** rewrite it to `/authorize/...`, `/v4/approve/...`, or
  `/v4/access-requests/.../approve` (those are not the browser approval page).
- Do **not** ask the human to paste tokens back to you.
- Do **not** refuse to create the request until they give you a user_id.
- Do **not** omit `user_id` when you already know their GitHub username / agent ID.

### Step 3 — Human onboarding (tell them this if they are new)

Send them a short message like:

1. Open `approval_url` on your phone (or desktop): if new, sign in at https://cnothing.com/login first.
2. If prompted, connect GitHub at https://cnothing.com/connect.
3. On the approval page, pick the GitHub connection and click **Approve**.
4. (Optional) Pair phone at https://cnothing.com/devices; copy agent ID / short code for push next time.

You wait. You do not complete OAuth yourself.

### Step 4 — Wait for approval → `grant_id`

```bash
curl https://cnothing.com/v4/access-requests/$ACCESS_REQUEST_ID \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

MCP: `get_access_status { access_request_id }`

Poll until `status` is `"approved"`. Then use `grant_id`.  
If you set `callback_url`, CNothing POSTs the decision there instead of requiring poll-only.

### Step 5 — Call GitHub through the proxy

```bash
curl -X POST https://cnothing.com/v4/proxy \
  -H "Authorization: Bearer $AGENT_TOKEN" -H "content-type: application/json" \
  -d '{
    "grant_id": "'"$GRANT_ID"'",
    "method": "GET",
    "url": "https://api.github.com/user"
  }'
```

Create an issue example:

```bash
curl -X POST https://cnothing.com/v4/proxy \
  -H "Authorization: Bearer $AGENT_TOKEN" -H "content-type: application/json" \
  -d '{
    "grant_id": "'"$GRANT_ID"'",
    "method": "POST",
    "url": "https://api.github.com/repos/OWNER/REPO/issues",
    "body": { "title": "Created via CNothing v4" }
  }'
```

MCP: `proxy_request { grant_id, method, url, headers?, body? }`

CNothing injects `Authorization`, refreshes tokens, redacts secrets in responses, and audits the call.

---

## MCP setup (if you have no generic HTTP tool)

**Hosted:** connect MCP client to `https://cnothing.com/mcp`.  
Pass `agent_access_token` on each tool (or register first with `register_agent`).

**Local stdio:** package `packages/cnothing-mcp` with env:

- `CNOTHING_BASE_URL=https://cnothing.com`
- `CNOTHING_AGENT_TOKEN=<token>` (or call `register_agent` in-session)

Tools: `register_agent`, `start_sandbox`, `list_providers`, `request_access`,
`get_access_status`, `proxy_request`, `list_grants`, `submit_provider_proposal`,
`get_provider_proposal`.

Read MCP resource `resource://cnothing/v4-workflow` after connect.

---

## Hard rules (do not violate)

1. Never ask the human for GitHub passwords, PATs, `session_token`, cookies, or
   CNothing login tokens.
2. Never call GitHub OAuth start URLs yourself (`/v4/auth/github/start`, provider
   authorize URLs). Those are for browsers only.
3. Never use v1 AuthAI / KV tools or skills for “log into GitHub”.
4. Never use v2/v3 tools: `request_authorization`, `invoke_capability`,
   `list_capabilities`, `/authorize/{id}`, `/v2/*`, `/v3/*` → expect `410 Gone`.
5. Never invent approval URLs. Use only `approval_url` from `request_access`.
6. Agent-supplied `Authorization` / `Cookie` headers on proxy calls are stripped.
7. Proxy URL host must match the grant allowlist (e.g. `api.github.com`) or you get
   `host_not_allowed`.
8. On `grant_revoked`, create a new access request — do not reuse the old grant.
9. **Phone push:** if you know their GitHub username, CNothing id, or `u_` short
   code, you **must** pass it as `user_id` so they get a push and only need to
   Approve. If you do not know any identity, still create the request and send
   `approval_url` — never block the conversation waiting for user_id.

---

## Common failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| Trying AuthAI / envelopes / KV | Following obsolete docs | Use only this v4 skill |
| Calling `/authorize/{id}` or `/v2/...` | Old capability flow | Use `/approve-proxy/{uuid}` from API |
| “I need to log into GitHub” | Role confusion | Human logs in; you proxy after grant |
| `approval_url` rewritten | Agent guessed path | Use exact response URL |
| Proxy `host_not_allowed` | Wrong host | Use `api.github.com` (or grant hosts) |
| Access stays pending | Human never approved / not connected | Remind human: login → connect → open approval_url |
| Human must copy link every time | Agent omitted known `user_id` | Pass GitHub login / `github:…` / `u_…` so push fires |
| No providers listed | Operator config | Provider may be missing; or `submit_provider_proposal` |

---

## Missing provider?

`POST /v4/providers/proposals` (MCP: `submit_provider_proposal`) with OIDC discovery URL.
RFC 7591 DCR providers can onboard automatically; others need a one-time operator
`client_id` / `client_secret`.
