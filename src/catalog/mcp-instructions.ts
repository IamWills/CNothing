export const MCP_SERVER_INSTRUCTIONS = `CNothing v4 — ONLY supported agent path for cnothing.com.

Ignore AuthAI, KV envelopes, request_authorization, invoke_capability, /authorize/{id},
/v2/*, /v3/*. Those are removed or deprecated and will fail.

You never log into GitHub yourself. The human completes OAuth in a browser or the
CNothing iOS app. You obtain a grant, then call APIs through the credential-injecting
proxy. You never see tokens.

Prerequisites (all required for a real provider call):
1. You have agent_access_token (register_agent or POST /v4/agents/register).
2. Human signed in at https://cnothing.com/login (creates account).
3. Human connected the provider once at https://cnothing.com/connect.
4. Human approved your access request via the exact approval_url (or phone push).
5. You have grant_id from get_access_status (or callback_url webhook).

Workflow:
0. register_agent { name } — if you have no token. Optionally start_sandbox +
   proxy_request(echo_url) to self-test without a human.
1. list_providers — use slug e.g. "github".
2. request_access { provider, reason?, user_id?, callback_url?, hosts? } —
   returns access_request_id + approval_url (+ resolved_user_id, pushed_to_devices).
   approval_url is ALWAYS https://cnothing.com/approve-proxy/{uuid} (may include ?user=).
   NEVER rewrite it. Always show the exact approval_url to the human as fallback.
   user_id: MUST pass when known — full id (github:alice), short code (u_XXXXXX), or
   their GitHub login/username if you already know it (chat context, prior
   resolved_user_id, etc.). That enables phone push so they only tap Approve.
   Do NOT omit user_id just to send a bare link when you know who they are.
   If you truly do NOT have any identity: still call request_access NOW and send
   approval_url — do NOT block asking for user_id. Prefer they open the link on phone
   (Universal Link opens the iOS app). Remember resolved_user_id for later calls.
   Pass callback_url (https) to get a POST on decide instead of poll-only.
3. get_access_status { access_request_id } — poll until status "approved" → grant_id.
4. proxy_request { grant_id, method, url, headers?, body? } — any https API on granted
   hosts (e.g. GET https://api.github.com/user). CNothing injects Authorization,
   refreshes tokens, redacts secrets, audits.

Human onboarding (relay when they are new):
1. https://cnothing.com/login — sign in with GitHub/OIDC.
2. https://cnothing.com/connect — connect the provider once.
3. Open your approval_url (phone preferred) or Approve from the push notification.
4. Optional: https://cnothing.com/devices — pair iPhone; copy agent ID or short code
   for push on future requests.

Hard rules:
- Never ask for passwords, PATs, session_token, cookies, or login tokens.
- Never call GitHub/CNothing OAuth start URLs yourself (browser-only).
- Never invent approval URLs.
- When you know their GitHub username / agent ID / short code, always pass user_id.
- Never block the flow solely to obtain user_id — if unknown, send approval_url instead.
- Agent Authorization/Cookie headers on proxy calls are stripped.
- Host must match grant allowlist or host_not_allowed.
- On grant_revoked, request_access again.

Missing or unconfigured provider: submit_provider_proposal with OIDC discovery URL (RFC 7591 DCR when available). If you get provider_exists with connectable=true, use that slug with request_access — do not re-propose.

Auth: every tool except register_agent requires agent_access_token.
Primary skill: https://cnothing.com/skill.md
OpenAPI: https://cnothing.com/openapi-v4.json`;
