export const MCP_SERVER_INSTRUCTIONS = `CNothing v4 — ONLY supported agent path for cnothing.com.

Ignore AuthAI, KV envelopes, request_authorization, invoke_capability, /authorize/{id},
/v2/*, /v3/*. Those are removed or deprecated and will fail.

You never log into GitHub yourself. The human completes OAuth in a browser. You obtain a
grant, then call APIs through the credential-injecting proxy. You never see tokens.

Prerequisites (all required for a real provider call):
1. You have agent_access_token (register_agent or POST /v4/agents/register).
2. Human signed in at https://cnothing.com/login (creates account).
3. Human connected the provider once at https://cnothing.com/connect.
4. Human approved your access request via the exact approval_url you received.
5. You have grant_id from get_access_status (or callback_url webhook).

Workflow:
0. register_agent { name } — if you have no token. Optionally start_sandbox +
   proxy_request(echo_url) to self-test without a human.
1. list_providers — use slug e.g. "github".
2. request_access { provider, reason?, user_id?, callback_url?, hosts? } —
   returns access_request_id + approval_url.
   approval_url is ALWAYS https://cnothing.com/approve-proxy/{uuid}.
   NEVER rewrite to /authorize/..., /v4/approve/..., or /v4/access-requests/.../approve.
   Show the exact approval_url to the human.
   If you know their CNothing user_id, pass it for iOS push approval.
   Pass callback_url (https) to get a POST on decide instead of poll-only.
3. get_access_status { access_request_id } — poll until status "approved" → grant_id.
4. proxy_request { grant_id, method, url, headers?, body? } — any https API on granted
   hosts (e.g. GET https://api.github.com/user). CNothing injects Authorization,
   refreshes tokens, redacts secrets, audits.

Human onboarding (relay when they are new):
1. https://cnothing.com/login — sign in with GitHub/OIDC.
2. https://cnothing.com/connect — connect the provider once.
3. Open your approval_url → Approve.
4. Optional: https://cnothing.com/devices — pair iPhone for push approvals.

Hard rules:
- Never ask for passwords, PATs, session_token, cookies, or login tokens.
- Never call GitHub/CNothing OAuth start URLs yourself (browser-only).
- Never invent approval URLs.
- Agent Authorization/Cookie headers on proxy calls are stripped.
- Host must match grant allowlist or host_not_allowed.
- On grant_revoked, request_access again.

Missing provider: submit_provider_proposal with OIDC discovery URL (RFC 7591 DCR when available).

Auth: every tool except register_agent requires agent_access_token.
Primary skill: https://cnothing.com/skill.md
OpenAPI: https://cnothing.com/openapi-v4.json`;
